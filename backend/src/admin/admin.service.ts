import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { readFile } from 'fs/promises';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { MetricsService } from '../metrics/metrics.service';
import { RedisService } from '../redis/redis.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { MAX_PAGE_SIZE, toPage } from '../common/pagination';
import { AdminUpdateUserDto } from './dto/update-user.dto';

/** State of a backing service shown on the dashboard. */
type ServiceState = 'up' | 'down' | 'disabled';

// A backup run older than this is flagged "stale" (schedule is every 6h, so
// ~7h means at least one run was missed).
const BACKUP_STALE_AFTER_MS = 7 * 60 * 60 * 1000;
// How many recent calendar days to roll up for the dashboard timeline.
const BACKUP_TIMELINE_DAYS = 3;

/** One restic snapshot as recorded in status.json. */
export interface BackupSnapshot {
  time: string;
  tag: string;
  id: string;
}

/** Shape of status.json written by the host restic backup job. */
interface BackupStatusFile {
  lastRun?: string;
  ok?: boolean;
  snapshots?: number;
  repoSizeBytes?: number;
  lastCheck?: { ok?: boolean; at?: string };
  error?: string | null;
  // Enriched fields (present when the host has jq): the recent snapshot log,
  // the oldest retained snapshot, and the configured retention policy.
  recent?: BackupSnapshot[];
  oldest?: string | null;
  retention?: { last: number; daily: number; weekly: number; monthly: number };
}

/**
 * DB / Redis / object-store figures, refreshed at most once per cache window
 * (shared via Redis so N polling admins cost one probe set per window).
 */
interface InfraSnapshot {
  at: number;
  iso: string;
  storage: { totalBytes: number; fileCount: number };
  sessions: number;
  database: {
    ok: boolean;
    sizeBytes: number;
    version: string;
    uptimeSec: number;
    connections: number;
  };
  redis: {
    state: ServiceState;
    usedMemoryBytes: number;
    keys: number;
    version: string;
    uptimeSec: number;
    connectedClients: number;
  };
  objectStorageOk: boolean;
}

const INFRA_CACHE_KEY = 'admin:metrics:infra';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsStore: MetricsService,
    private readonly cfg: AppConfigService,
    private readonly redis: RedisService,
    private readonly storage: S3StorageService,
  ) {}

  // Process-local fallback for the infra snapshot, used when Redis is not
  // configured. With Redis, the snapshot lives there so every replica (and
  // every polling admin) shares a single cache window.
  private infraCache: InfraSnapshot | null = null;

  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        avatarColor: true,
        avatarKey: true,
        isAdmin: true,
        blocked: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            projects: true,
            assignedTasks: true,
            comments: true,
          },
        },
      },
    });
    return users.map((u) => ({
      ...u,
      stats: {
        projects: u._count.projects,
        tasks: u._count.assignedTasks,
        comments: u._count.comments,
      },
      _count: undefined,
    }));
  }

  /**
   * Admin-wide project listing: EVERY project (open + closed), regardless of
   * ownership or membership — unlike GET /projects, which is scoped to the
   * caller. Cursor-paginated like the rest of the app, with an optional
   * open/closed filter and a name/key search.
   */
  async listProjects(
    opts: { closed?: boolean; q?: string; cursor?: string; limit?: number } = {},
  ) {
    const limit = opts.limit ?? MAX_PAGE_SIZE;
    const where: Prisma.ProjectWhereInput = {
      ...(opts.closed === undefined
        ? {}
        : { closedAt: opts.closed ? { not: null } : null }),
      ...(opts.q
        ? {
            OR: [
              { name: { contains: opts.q, mode: 'insensitive' } },
              { key: { contains: opts.q, mode: 'insensitive' } },
              { owner: { name: { contains: opts.q, mode: 'insensitive' } } },
              { owner: { email: { contains: opts.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.project.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        closedAt: true,
        createdAt: true,
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarColor: true,
            avatarKey: true,
          },
        },
        _count: { select: { tasks: true, memberships: true } },
      },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    // Total matching the filter (for the "N projects" header) — one count query.
    const total = await this.prisma.project.count({ where });

    const page = toPage(rows, limit);
    if (!page.items.length) return { items: [], nextCursor: page.nextCursor, total };

    // DONE roll-up for just this page (uses the (projectId, status) index).
    const done = await this.prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: page.items.map((p) => p.id) }, status: 'DONE' },
      _count: { _all: true },
    });
    const doneByProject = new Map(done.map((d) => [d.projectId, d._count._all]));

    return {
      items: page.items.map(({ _count, ...p }) => ({
        ...p,
        members: _count.memberships,
        stats: { total: _count.tasks, done: doneByProject.get(p.id) ?? 0 },
      })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  async updateUser(
    targetId: string,
    actingUserId: string,
    dto: AdminUpdateUserDto,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, isAdmin: true },
    });
    if (!target) throw new NotFoundException('User not found');

    // Safety net: don't let the last admin demote themselves.
    if (
      dto.isAdmin === false &&
      target.isAdmin &&
      target.id === actingUserId
    ) {
      const adminCount = await this.prisma.user.count({
        where: { isAdmin: true },
      });
      if (adminCount <= 1) {
        throw new BadRequestException(
          'Cannot demote the last admin — promote another user first',
        );
      }
    }

    // Don't let an admin lock themselves out.
    if (dto.blocked === true && target.id === actingUserId) {
      throw new BadRequestException('Cannot block your own account');
    }

    return this.prisma.$transaction(async (tx) => {
      const data: {
        name?: string;
        isAdmin?: boolean;
        blocked?: boolean;
        passwordHash?: string;
      } = {};
      if (dto.name !== undefined) data.name = dto.name.trim();
      if (dto.isAdmin !== undefined) data.isAdmin = dto.isAdmin;
      if (dto.blocked !== undefined) data.blocked = dto.blocked;
      if (dto.newPassword) {
        data.passwordHash = await bcrypt.hash(dto.newPassword, 12);
        // Revoke all refresh tokens — the user must log in again.
        await tx.refreshToken.deleteMany({ where: { userId: targetId } });
      }

      const updated = await tx.user.update({
        where: { id: targetId },
        data,
        select: {
          id: true,
          email: true,
          name: true,
          avatarColor: true,
          avatarKey: true,
          isAdmin: true,
          blocked: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return updated;
    });
  }

  async deleteUser(targetId: string, actingUserId: string): Promise<void> {
    if (targetId === actingUserId) {
      throw new BadRequestException(
        'Cannot delete your own account from the admin panel',
      );
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, isAdmin: true },
    });
    if (!target) throw new NotFoundException('User not found');

    if (target.isAdmin) {
      const adminCount = await this.prisma.user.count({
        where: { isAdmin: true },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot delete the last admin');
      }
    }

    await this.prisma.user.delete({ where: { id: targetId } });
  }

  async stats() {
    const [users, admins, projects, tasks, comments, recentSignups] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { isAdmin: true } }),
        this.prisma.project.count(),
        this.prisma.task.count(),
        this.prisma.comment.count(),
        this.prisma.user.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            email: true,
            name: true,
            avatarColor: true,
            avatarKey: true,
            createdAt: true,
          },
        }),
      ]);

    const tasksByStatus = await this.prisma.task.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    return {
      users,
      admins,
      projects,
      tasks,
      comments,
      tasksByStatus: tasksByStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
      })),
      recentSignups,
    };
  }

  /**
   * Operational metrics for the admin panel. Designed to be cheap enough to
   * poll: the realtime / slow-query / rate-limit feeds are read from an
   * in-memory store (O(1), updated continuously by the app as events happen,
   * NOT computed here), the process gauges are local syscalls, and the only
   * database work — the storage aggregate and session count — is cached for
   * `metricsCacheTtlMs`, so N admins polling cost at most one query per window.
   */
  async metrics() {
    const infra = await this.infraMetrics();
    const mem = process.memoryUsage();
    const uptimeSec = Math.floor(process.uptime());

    return {
      realtime: this.metricsStore.realtime(),
      sessions: infra.sessions,
      storage: infra.storage,
      slowQueries: this.metricsStore.recentSlowQueries(),
      slowQueryThresholdMs: this.cfg.slowQueryMs,
      rateLimit: this.metricsStore.rateLimitSnapshot(),
      http: this.metricsStore.httpSnapshot(),
      backup: await this.backupStatus(),
      // Per-service health for the "Services" section. The backend reports its
      // own Node.js process gauges; the data stores report through their own
      // protocols (no Docker socket needed).
      services: {
        backend: {
          status: 'up' as ServiceState,
          uptimeSec,
          version: process.version,
          rssMb: Math.round(mem.rss / 1048576),
          heapUsedMb: Math.round(mem.heapUsed / 1048576),
        },
        postgres: {
          status: (infra.database.ok ? 'up' : 'down') as ServiceState,
          sizeBytes: infra.database.sizeBytes,
          version: infra.database.version,
          uptimeSec: infra.database.uptimeSec,
          connections: infra.database.connections,
        },
        redis: {
          status: infra.redis.state,
          usedMemoryBytes: infra.redis.usedMemoryBytes,
          keys: infra.redis.keys,
          version: infra.redis.version,
          uptimeSec: infra.redis.uptimeSec,
          connectedClients: infra.redis.connectedClients,
        },
        objectStorage: {
          status: (infra.objectStorageOk ? 'up' : 'down') as ServiceState,
          sizeBytes: infra.storage.totalBytes,
          fileCount: infra.storage.fileCount,
        },
      },
      build: {
        version: this.cfg.appVersion,
        gitSha: this.cfg.gitSha,
        buildTime: this.cfg.buildTime,
        nodeEnv: this.cfg.nodeEnv,
        // Process start derived from uptime — no extra state to track.
        startedAt: new Date(Date.now() - uptimeSec * 1000).toISOString(),
      },
      // When the cached infra figures above were last refreshed, so the UI can
      // show "as of …" rather than implying they're real-time.
      derivedAt: infra.iso,
    };
  }

  /**
   * Backup health for the dashboard. The host restic job writes a status JSON
   * (no secrets); we only read it. Missing/unreadable → "unknown"; a failed or
   * too-old run is surfaced as failed/stale so the card doubles as a dead-man.
   */
  private async backupStatus() {
    let raw: BackupStatusFile | null = null;
    try {
      raw = JSON.parse(await readFile(this.cfg.backupStatusFile, 'utf8'));
    } catch {
      raw = null;
    }
    const empty = {
      status: 'unknown' as const,
      lastRunAt: null,
      ageSec: null,
      ok: false,
      snapshots: 0,
      repoSizeBytes: 0,
      lastCheckOk: null as boolean | null,
      error: null as string | null,
      oldest: null as string | null,
      retention: null as BackupStatusFile['retention'] | null,
      recentDays: [] as { date: string; db: boolean; minio: boolean; ok: boolean }[],
      recent: [] as BackupSnapshot[],
    };
    if (!raw || !raw.lastRun) return empty;

    const ageMs = Date.now() - new Date(raw.lastRun).getTime();
    const status: 'ok' | 'failed' | 'stale' =
      raw.ok === false ? 'failed' : ageMs > BACKUP_STALE_AFTER_MS ? 'stale' : 'ok';
    return {
      ...empty,
      status,
      lastRunAt: raw.lastRun,
      ageSec: Math.max(0, Math.floor(ageMs / 1000)),
      ok: raw.ok !== false,
      snapshots: raw.snapshots ?? 0,
      repoSizeBytes: raw.repoSizeBytes ?? 0,
      lastCheckOk: raw.lastCheck?.ok ?? null,
      error: raw.error ?? null,
      oldest: raw.oldest ?? null,
      retention: raw.retention ?? null,
      recentDays: this.rollUpBackupDays(raw.recent ?? []),
      recent: (raw.recent ?? []).slice(0, 12),
    };
  }

  /**
   * Per-day success rollup for the last few calendar days (UTC), so the admin
   * card can show a "last 3 days" tick row. A day counts as a successful backup
   * when it has both a `db` and a `minio` snapshot.
   */
  private rollUpBackupDays(
    recent: BackupSnapshot[],
  ): { date: string; db: boolean; minio: boolean; ok: boolean }[] {
    const byDay = new Map<string, { db: boolean; minio: boolean }>();
    for (const s of recent) {
      const day = s.time.slice(0, 10); // YYYY-MM-DD (snapshots are UTC ISO)
      const cur = byDay.get(day) ?? { db: false, minio: false };
      if (s.tag === 'db') cur.db = true;
      if (s.tag === 'minio') cur.minio = true;
      byDay.set(day, cur);
    }
    const out: { date: string; db: boolean; minio: boolean; ok: boolean }[] = [];
    for (let i = 0; i < BACKUP_TIMELINE_DAYS; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const hit = byDay.get(d) ?? { db: false, minio: false };
      out.push({ date: d, db: hit.db, minio: hit.minio, ok: hit.db && hit.minio });
    }
    return out;
  }

  /** DB / Redis / object-store probes, computed at most once per cache window
   *  and shared across replicas via Redis. */
  private async infraMetrics(): Promise<InfraSnapshot> {
    const ttl = this.cfg.metricsCacheTtlMs;
    const now = Date.now();

    // Shared cache first (key expires via PX, the `at` check is a belt-and-
    // braces guard); fall back to the process-local copy without Redis.
    const shared = await this.redis.getJson<InfraSnapshot>(INFRA_CACHE_KEY);
    if (shared && now - shared.at < ttl) return shared;
    if (this.infraCache && now - this.infraCache.at < ttl) {
      return this.infraCache;
    }

    const [storage, sessions, database, redis, objectStorageOk] = await Promise.all([
      this.prisma.attachment.aggregate({
        _sum: { size: true },
        _count: { _all: true },
      }),
      this.prisma.refreshToken.count({ where: { expiresAt: { gt: new Date() } } }),
      this.databaseStats(),
      this.redisStats(),
      this.storage.ping(),
    ]);

    const snapshot: InfraSnapshot = {
      at: now,
      iso: new Date(now).toISOString(),
      storage: {
        totalBytes: storage._sum.size ?? 0,
        fileCount: storage._count._all,
      },
      sessions,
      database,
      redis,
      objectStorageOk,
    };
    this.infraCache = snapshot;
    await this.redis.setJson(INFRA_CACHE_KEY, snapshot, ttl);
    return snapshot;
  }

  /** On-disk size, server version, uptime and live connection count of the
   *  Postgres database. Returns ok:false if the probe query fails. */
  private async databaseStats(): Promise<InfraSnapshot['database']> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ size: number; version: string; uptime: number; connections: number }>
      >(Prisma.sql`
        SELECT pg_database_size(current_database())::float8 AS size,
               current_setting('server_version') AS version,
               EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::int AS uptime,
               (SELECT count(*)::int FROM pg_stat_activity) AS connections
      `);
      const r = rows[0];
      return {
        ok: true,
        sizeBytes: Math.round(r.size),
        version: r.version,
        uptimeSec: r.uptime,
        connections: r.connections,
      };
    } catch {
      return { ok: false, sizeBytes: 0, version: 'unknown', uptimeSec: 0, connections: 0 };
    }
  }

  /** Redis memory / keys / version / uptime, or a disabled/down marker. */
  private async redisStats(): Promise<InfraSnapshot['redis']> {
    if (!this.redis.connection) {
      return {
        state: 'disabled',
        usedMemoryBytes: 0,
        keys: 0,
        version: '—',
        uptimeSec: 0,
        connectedClients: 0,
      };
    }
    const s = await this.redis.stats();
    if (!s) {
      return {
        state: 'down',
        usedMemoryBytes: 0,
        keys: 0,
        version: 'unknown',
        uptimeSec: 0,
        connectedClients: 0,
      };
    }
    return { state: 'up', ...s };
  }

  /** Recent authentication attempts for one user (newest first). */
  async userLogins(userId: string, limit = 25) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.loginEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        success: true,
        ip: true,
        userAgent: true,
        createdAt: true,
      },
    });
  }
}
