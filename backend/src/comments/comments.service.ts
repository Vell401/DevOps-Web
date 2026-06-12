import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivityService } from '../activity/activity.service';
import { ProjectsService, roleAtLeast } from '../projects/projects.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { CreateCommentDto, UpdateCommentDto } from './dto/create-comment.dto';

const COMMENT_PREVIEW = 120;

const COMMENT_INCLUDE = {
  author: {
    select: { id: true, name: true, email: true, avatarColor: true, avatarKey: true },
  },
  attachments: {
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.CommentInclude;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly activity: ActivityService,
    private readonly projects: ProjectsService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly storage: S3StorageService,
  ) {}

  async listForTask(taskId: string, userId: string) {
    await this.tasks.get(taskId, userId);
    return this.prisma.comment.findMany({
      where: { taskId },
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Mention fan-out shared by create/edit: distinct ids, never the author,
   * and only people who can actually open this project. Mentions of outsiders
   * are silently dropped — notifying someone about a project they cannot see
   * would itself be an information leak.
   */
  private async mentionRecipients(
    projectId: string,
    authorId: string,
    mentions: string[] | undefined,
    excludeIds: string[] = [],
  ): Promise<string[]> {
    if (!mentions?.length) return [];
    const participants = new Set(await this.projects.memberIds(projectId));
    const excluded = new Set(excludeIds);
    return [...new Set(mentions)].filter(
      (id) => id !== authorId && participants.has(id) && !excluded.has(id),
    );
  }

  async create(taskId: string, userId: string, dto: CreateCommentDto) {
    const task = await this.tasks.get(taskId, userId);
    await this.projects.assertNotClosed(task.projectId);
    const body = dto.body.trim();
    const recipientIds = await this.mentionRecipients(
      task.projectId,
      userId,
      dto.mentions,
    );

    // Staged composer attachments must already belong to this task, be
    // uploaded by the comment author, and not be claimed by another comment.
    const attachmentIds = [...new Set(dto.attachmentIds ?? [])];
    if (attachmentIds.length) {
      const owned = await this.prisma.attachment.count({
        where: {
          id: { in: attachmentIds },
          taskId,
          uploaderId: userId,
          commentId: null,
        },
      });
      if (owned !== attachmentIds.length) {
        throw new BadRequestException('One or more attachments are invalid');
      }
    }

    const { comment, mentionNotifications } = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.comment.create({
          data: { body, taskId, authorId: userId },
        });

        if (attachmentIds.length) {
          await tx.attachment.updateMany({
            where: { id: { in: attachmentIds }, taskId, commentId: null },
            data: { commentId: created.id },
          });
        }

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

        const notifications = await this.notifications.notify(
          {
            recipientIds,
            type: NotificationType.MENTIONED,
            actorId: userId,
            taskId,
            commentId: created.id,
          },
          tx,
        );

        const c = await tx.comment.findUniqueOrThrow({
          where: { id: created.id },
          include: COMMENT_INCLUDE,
        });
        return { comment: c, mentionNotifications: notifications };
      },
    );

    this.realtime.emitCommentAdded(task.projectId, taskId, comment);
    // Push each mention straight to the recipient's socket so the bell badge
    // updates without polling.
    for (const n of mentionNotifications) {
      this.realtime.emitNotification(n.userId, n);
    }
    // Surface comment activity into the global inbox of all project members.
    const members = await this.projects.memberIds(task.projectId);
    this.realtime.emitProjectsChangedForUsers([...members, userId]);
    return comment;
  }

  /** Author-only edit. Newly mentioned users get notified; repeats don't. */
  async update(id: string, userId: string, dto: UpdateCommentDto) {
    const existing = await this.prisma.comment.findUnique({
      where: { id },
      include: { task: { select: { id: true, projectId: true } } },
    });
    if (!existing) throw new NotFoundException('Comment not found');
    if (existing.authorId !== userId) {
      throw new ForbiddenException('Only the author can edit a comment');
    }
    await this.projects.assertNotClosed(existing.task.projectId);

    // Don't re-notify people already pinged from this comment's earlier text.
    const alreadyNotified = await this.prisma.notification.findMany({
      where: { commentId: id, type: NotificationType.MENTIONED },
      select: { userId: true },
    });
    const recipientIds = await this.mentionRecipients(
      existing.task.projectId,
      userId,
      dto.mentions,
      alreadyNotified.map((n) => n.userId),
    );

    const { comment, mentionNotifications } = await this.prisma.$transaction(
      async (tx) => {
        const updated = await tx.comment.update({
          where: { id },
          data: { body: dto.body.trim() },
          include: COMMENT_INCLUDE,
        });
        const notifications = await this.notifications.notify(
          {
            recipientIds,
            type: NotificationType.MENTIONED,
            actorId: userId,
            taskId: existing.task.id,
            commentId: id,
          },
          tx,
        );
        return { comment: updated, mentionNotifications: notifications };
      },
    );

    this.realtime.emitCommentUpdated(
      existing.task.projectId,
      existing.task.id,
      comment,
    );
    for (const n of mentionNotifications) {
      this.realtime.emitNotification(n.userId, n);
    }
    return comment;
  }

  async remove(id: string, userId: string): Promise<void> {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      include: {
        attachments: { select: { id: true, key: true } },
        task: {
          select: {
            id: true,
            projectId: true,
          },
        },
      },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    // Author can always delete their own comment. Project ADMINs (and the
    // owner) can moderate anything in their project.
    if (comment.authorId !== userId) {
      const role = await this.projects.roleIn(comment.task.projectId, userId);
      if (!roleAtLeast(role, 'ADMIN')) throw new ForbiddenException();
    }
    await this.projects.assertNotClosed(comment.task.projectId);
    // DB rows for the comment's attachments cascade with the delete; the S3
    // objects are removed best-effort afterwards (orphans are acceptable).
    await this.prisma.comment.delete({ where: { id } });
    for (const att of comment.attachments) {
      try {
        await this.storage.deleteObject(att.key);
      } catch {
        /* orphaned object left in the bucket */
      }
      this.realtime.emitAttachmentRemoved(
        comment.task.projectId,
        comment.task.id,
        att.id,
      );
    }
    this.realtime.emitCommentDeleted(comment.task.projectId, comment.task.id, id);
    const members = await this.projects.memberIds(comment.task.projectId);
    this.realtime.emitProjectsChangedForUsers([...members, userId]);
  }
}
