import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivityService } from '../activity/activity.service';
import { CreateCommentDto } from './dto/create-comment.dto';

const COMMENT_PREVIEW = 120;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly activity: ActivityService,
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
    await this.tasks.get(taskId, userId);
    const body = dto.body.trim();

    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
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

      return comment;
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const comment = await this.prisma.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId) throw new ForbiddenException();
    await this.prisma.comment.delete({ where: { id } });
  }
}
