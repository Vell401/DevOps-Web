import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivityService } from '../activity/activity.service';
import { ProjectsService } from '../projects/projects.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateCommentDto } from './dto/create-comment.dto';

const COMMENT_PREVIEW = 120;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly activity: ActivityService,
    private readonly projects: ProjectsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async listForTask(taskId: string, userId: string) {
    await this.tasks.get(taskId, userId);
    return this.prisma.comment.findMany({
      where: { taskId },
      include: {
        author: { select: { id: true, name: true, email: true, avatarColor: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(taskId: string, userId: string, dto: CreateCommentDto) {
    const task = await this.tasks.get(taskId, userId);
    await this.projects.assertNotClosed(task.projectId);
    const body = dto.body.trim();

    const comment = await this.prisma.$transaction(async (tx) => {
      const c = await tx.comment.create({
        data: { body, taskId, authorId: userId },
        include: {
          author: { select: { id: true, name: true, email: true, avatarColor: true } },
        },
      });

      await this.activity.log(
        {
          taskId,
          actorId: userId,
          type: ActivityType.COMMENT_ADDED,
          toValue:
            body.length > COMMENT_PREVIEW
              ? `${body.slice(0, COMMENT_PREVIEW)}…`
              : body,
        },
        tx,
      );

      return c;
    });

    this.realtime.emitCommentAdded(task.projectId, taskId, comment);
    // Surface comment activity into the global inbox of all project members.
    const members = await this.projects.memberIds(task.projectId);
    this.realtime.emitProjectsChangedForUsers([...members, userId]);
    return comment;
  }

  async remove(id: string, userId: string): Promise<void> {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      include: {
        task: {
          select: {
            id: true,
            projectId: true,
            project: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    // Author can always delete their own comment. Project owner can moderate
    // anything in their project.
    const isAuthor = comment.authorId === userId;
    const isOwner = comment.task.project.ownerId === userId;
    if (!isAuthor && !isOwner) throw new ForbiddenException();
    await this.projects.assertNotClosed(comment.task.projectId);
    await this.prisma.comment.delete({ where: { id } });
    this.realtime.emitCommentDeleted(comment.task.projectId, comment.task.id, id);
    const members = await this.projects.memberIds(comment.task.projectId);
    this.realtime.emitProjectsChangedForUsers([...members, userId]);
  }
}
