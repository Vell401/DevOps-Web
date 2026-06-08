import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ActivityType } from '@prisma/client';

import { ActivityService } from './activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('activity')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller()
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  private async assertTaskAccess(taskId: string, userId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        projectId: true,
        project: {
          select: { ownerId: true, members: { select: { id: true } } },
        },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.project.ownerId === userId) return;
    if (task.project.members.some((m) => m.id === userId)) return;
    const assignedSomewhere = await this.prisma.task.findFirst({
      where: {
        projectId: task.projectId,
        assignees: { some: { id: userId } },
      },
      select: { id: true },
    });
    if (!assignedSomewhere) throw new ForbiddenException();
  }

  @Get('tasks/:taskId/activity')
  async listForTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertTaskAccess(taskId, user.userId);
    return this.activity.listForTask(taskId);
  }

  @Get('projects/:projectId/activity')
  async listForProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.projects.getAccessible(projectId, user.userId);
    return this.activity.listForProject(projectId);
  }

  @Get('projects/:projectId/activity/stats')
  async statsForProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.projects.getAccessible(projectId, user.userId);
    return this.activity.statsForProject(projectId);
  }

  /** Global activity inbox: events across all projects owned by the user. */
  @Get('activity')
  async listForUser(
    @CurrentUser() user: AuthenticatedUser,
    @Query('actorId') actorId?: string,
    @Query('type') type?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.activity.listForUser(user.userId, {
      actorId,
      type: isActivityType(type) ? type : undefined,
      projectId,
    });
  }
}

function isActivityType(v: string | undefined): v is ActivityType {
  if (!v) return false;
  // Must stay in sync with the Prisma `ActivityType` enum in schema.prisma.
  return [
    'CREATED',
    'STATUS_CHANGED',
    'ASSIGNEE_CHANGED',
    'ASSIGNEE_ADDED',
    'ASSIGNEE_REMOVED',
    'PRIORITY_CHANGED',
    'TITLE_CHANGED',
    'DESCRIPTION_CHANGED',
    'DUE_DATE_CHANGED',
    'LABEL_ADDED',
    'LABEL_REMOVED',
    'PARENT_CHANGED',
    'COMMENT_ADDED',
  ].includes(v);
}
