import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

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
      select: { project: { select: { ownerId: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.project.ownerId !== userId) throw new ForbiddenException();
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
    await this.projects.getOwned(projectId, user.userId);
    return this.activity.listForProject(projectId);
  }
}
