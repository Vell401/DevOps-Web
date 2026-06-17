import { Injectable } from '@nestjs/common';
import { ActivityType, Prisma } from '@prisma/client';
import { MAX_PAGE_SIZE, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

/** Cursor/limit options shared by the activity feed queries. */
export interface ActivityPageOpts {
  cursor?: string;
  limit?: number;
}

export interface ActivityLogInput {
  taskId: string;
  actorId: string;
  type: ActivityType;
  fromValue?: string | null;
  toValue?: string | null;
}

const ACTOR_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarColor: true,
  avatarKey: true,
} as const;

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    input: ActivityLogInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    const client = tx ?? this.prisma;
    return client.activity.create({
      data: {
        taskId: input.taskId,
        actorId: input.actorId,
        type: input.type,
        fromValue: input.fromValue ?? null,
        toValue: input.toValue ?? null,
      },
      select: { id: true },
    });
  }

  // All feeds use cursor pagination with `id` as a tiebreaker: createdAt is
  // not unique (a single task update writes several rows in one transaction),
  // and a cursor over non-deterministic order would skip or duplicate events.

  async listForTask(taskId: string, opts: ActivityPageOpts = {}) {
    const limit = opts.limit ?? MAX_PAGE_SIZE;
    const rows = await this.prisma.activity.findMany({
      where: { taskId },
      include: { actor: { select: ACTOR_SELECT } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, limit);
  }

  async listForProject(projectId: string, opts: ActivityPageOpts = {}) {
    const limit = opts.limit ?? MAX_PAGE_SIZE;
    const rows = await this.prisma.activity.findMany({
      where: { task: { projectId } },
      include: {
        actor: { select: ACTOR_SELECT },
        task: { select: { id: true, title: true, number: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, limit);
  }

  /**
   * Global inbox feed: every event across all projects the user has access
   * to (owner OR member of any role). Optional filters: actorId, type,
   * projectId.
   */
  async listForUser(
    userId: string,
    opts: {
      actorId?: string;
      type?: ActivityType;
      projectId?: string;
    } & ActivityPageOpts = {},
  ) {
    const projectAccess: Prisma.ProjectWhereInput = {
      OR: [{ ownerId: userId }, { memberships: { some: { userId } } }],
    };
    const where: Prisma.ActivityWhereInput = {
      task: opts.projectId
        ? { projectId: opts.projectId, project: projectAccess }
        : { project: projectAccess },
    };
    if (opts.actorId) where.actorId = opts.actorId;
    if (opts.type) where.type = opts.type;

    const limit = opts.limit ?? MAX_PAGE_SIZE;
    const rows = await this.prisma.activity.findMany({
      where,
      include: {
        actor: { select: ACTOR_SELECT },
        task: {
          select: {
            id: true,
            title: true,
            number: true,
            project: { select: { id: true, key: true, name: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, limit);
  }

  /**
   * Stats for the project Activity dashboard: 30-day daily heatmap,
   * top contributors and most-edited tasks.
   */
  async statsForProject(projectId: string) {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);

    const events = await this.prisma.activity.findMany({
      where: { task: { projectId }, createdAt: { gte: since } },
      select: {
        createdAt: true,
        actorId: true,
        taskId: true,
        actor: { select: ACTOR_SELECT },
        task: { select: { id: true, title: true, number: true } },
      },
    });

    // 30-day heatmap (date-string key in local timezone for the server).
    const dayMap = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      dayMap.set(toDateKey(d), 0);
    }
    for (const ev of events) {
      const key = toDateKey(ev.createdAt);
      if (dayMap.has(key)) dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
    }
    const last30Days = Array.from(dayMap.entries()).map(([date, count]) => ({
      date,
      count,
    }));

    // Top contributors over the same window.
    const byActor = new Map<string, { actor: typeof events[number]['actor']; count: number }>();
    for (const ev of events) {
      const entry = byActor.get(ev.actorId) ?? { actor: ev.actor, count: 0 };
      entry.count += 1;
      byActor.set(ev.actorId, entry);
    }
    const topContributors = Array.from(byActor.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((e) => ({
        userId: e.actor.id,
        name: e.actor.name,
        avatarColor: e.actor.avatarColor,
        count: e.count,
      }));

    // Most active tasks over the same window.
    const byTask = new Map<string, { task: typeof events[number]['task']; count: number }>();
    for (const ev of events) {
      const entry = byTask.get(ev.taskId) ?? { task: ev.task, count: 0 };
      entry.count += 1;
      byTask.set(ev.taskId, entry);
    }
    const mostActiveTasks = Array.from(byTask.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((e) => ({
        taskId: e.task.id,
        number: e.task.number,
        title: e.task.title,
        count: e.count,
      }));

    return {
      last30Days,
      topContributors,
      mostActiveTasks,
      totalEvents30d: events.length,
    };
  }
}

function toDateKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
