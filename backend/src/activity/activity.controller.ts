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

import { ActivityService } from './activity.service';
import { QueryActivityDto } from './dto/query-activity.dto';
import { PageQueryDto } from '../common/pagination';
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
      select: { projectId: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    const role = await this.projects.roleIn(task.projectId, userId);
    if (!role) throw new ForbiddenException();
  }

  @Get('tasks/:taskId/activity')
  async listForTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Query() query: PageQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertTaskAccess(taskId, user.userId);
    return this.activity.listForTask(taskId, query);
  }

  @Get('projects/:projectId/activity')
  async listForProject(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: PageQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.projects.getAccessible(projectId, user.userId);
    return this.activity.listForProject(projectId, query);
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
    @Query() query: QueryActivityDto,
  ) {
    return this.activity.listForUser(user.userId, query);
  }
}
