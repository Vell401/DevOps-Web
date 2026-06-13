import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { MetricsService } from '../metrics/metrics.service';
import { RedisService } from '../redis/redis.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { AdminUpdateUserDto } from './dto/update-user.dto';

/** State of a backing service shown on the dashboard. */
type ServiceState = 'up' | 'down' | 'disabled';

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
