import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from './notifications.service';

const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Don't re-notify the same (user, task) within two days, even across restarts. */
const DEDUP_WINDOW_MS = 2 * DUE_SOON_WINDOW_MS;

/**
 * Hourly sweep that creates DUE_SOON notifications for tasks due within the
 * next 24 hours. Dedup is two-layered: a Redis lock keeps multiple backend
 * replicas from running the same hourly sweep, and a per-(user, task) check
 * against existing notifications keeps a single replica from repeating itself.
 */
@Injectable()
export class NotificationsScheduler {
  private readonly log = new Logger(NotificationsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly redis: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async dueSoonSweep(): Promise<void> {
    const hourStamp = new Date().toISOString().slice(0, 13);
    const lock = this.redis.connection;
    if (lock) {
      const acquired = await lock
        .set(`cron:due-soon:${hourStamp}`, '1', 'PX', 90 * 60 * 1000, 'NX')
        .catch(() => 'OK' as const); // Redis down → run anyway, DB dedup holds
      if (acquired !== 'OK') return; // another replica took this hour
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
    const tasks = await this.prisma.task.findMany({
      where: {
        dueDate: { gte: now, lte: horizon },
        status: { not: 'DONE' },
        project: { closedAt: null },
        assignees: { some: {} },
      },
      select: {
        id: true,
        assignees: { select: { id: true } },
      },
    });

    let created = 0;
    for (const task of tasks) {
      for (const assignee of task.assignees) {
        const already = await this.notifications.wasRecentlyNotified(
          assignee.id,
          task.id,
          NotificationType.DUE_SOON,
          DEDUP_WINDOW_MS,
        );
        if (already) continue;
        const [notification] = await this.notifications.notify({
          recipientIds: [assignee.id],
          type: NotificationType.DUE_SOON,
          taskId: task.id,
        });
        this.realtime.emitNotification(assignee.id, notification);
        created += 1;
      }
    }
    if (created > 0) {
      this.log.log(`Due-soon sweep created ${created} notification(s)`);
    }
  }
}
