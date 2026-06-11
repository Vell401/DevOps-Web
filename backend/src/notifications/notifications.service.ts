import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { MAX_PAGE_SIZE, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

const NOTIFICATION_INCLUDE = {
  actor: { select: { id: true, name: true, email: true, avatarColor: true } },
  task: {
    select: {
      id: true,
      number: true,
      title: true,
      project: { select: { id: true, key: true, name: true } },
    },
  },
  comment: { select: { id: true, body: true } },
} satisfies Prisma.NotificationInclude;

export type NotificationWithRefs = Prisma.NotificationGetPayload<{
  include: typeof NOTIFICATION_INCLUDE;
}>;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One MENTIONED notification per recipient. Caller is responsible for
   * filtering recipients (no author, project participants only) — this method
   * just persists. Returns full rows (with actor/task/comment) so the caller
   * can broadcast them over websockets without a second query.
   */
  async createMentions(
    input: {
      recipientIds: string[];
      actorId: string;
      taskId: string;
      commentId: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<NotificationWithRefs[]> {
    const client = tx ?? this.prisma;
    const rows: NotificationWithRefs[] = [];
    // Sequential creates: recipient lists are tiny (capped by the mentions DTO)
    // and this usually runs inside the comment-creation transaction.
    for (const userId of input.recipientIds) {
      rows.push(
        await client.notification.create({
          data: {
            userId,
            actorId: input.actorId,
            type: NotificationType.MENTIONED,
            taskId: input.taskId,
            commentId: input.commentId,
          },
          include: NOTIFICATION_INCLUDE,
        }),
      );
    }
    return rows;
  }

  async list(userId: string, opts: { cursor?: string; limit?: number } = {}) {
    const limit = opts.limit ?? MAX_PAGE_SIZE;
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      include: NOTIFICATION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, limit);
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  /** Mark specific notifications read; scoped to the caller's own rows. */
  async markRead(userId: string, ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const res = await this.prisma.notification.updateMany({
      where: { id: { in: ids }, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return res.count;
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return res.count;
  }
}
