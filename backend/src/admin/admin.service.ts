import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { MetricsService } from '../metrics/metrics.service';
import { AdminUpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsStore: MetricsService,
    private readonly cfg: AppConfigService,
  ) {}

  // Cached snapshot of the DB-derived metrics. Populated lazily and reused
  // within `metricsCacheTtlMs` so dashboard polling can't hammer the database.
  private derivedCache: {
    at: number;
    iso: string;
    storage: { totalBytes: number; fileCount: number };
    sessions: number;
  } | null = null;

  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        avatarColor: true,
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
   * Operational metrics for the admin panel: live realtime connections, active
   * sessions, object-storage usage (derived cheaply from attachment rows rather
   * than scanning the bucket), and the in-memory slow-query / rate-limit feeds.
   */
  /**
   * Operational metrics for the admin panel. Designed to be cheap enough to
   * poll: the realtime / slow-query / rate-limit feeds are read from an
   * in-memory store (O(1), updated continuously by the app as events happen,
   * NOT computed here), the process gauges are local syscalls, and the only
   * database work — the storage aggregate and session count — is cached for
   * `metricsCacheTtlMs`, so N admins polling cost at most one query per window.
   */
  async metrics() {
    const derived = await this.derivedMetrics();

    return {
      realtime: this.metricsStore.realtime(),
      sessions: derived.sessions,
      storage: derived.storage,
      slowQueries: this.metricsStore.recentSlowQueries(),
      slowQueryThresholdMs: this.cfg.slowQueryMs,
      rateLimit: this.metricsStore.rateLimitSnapshot(),
      http: this.metricsStore.httpSnapshot(),
      process: {
        uptimeSec: Math.floor(process.uptime()),
        rssMb: Math.round(process.memoryUsage().rss / 1048576),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
        nodeVersion: process.version,
      },
      build: {
        version: this.cfg.appVersion,
        gitSha: this.cfg.gitSha,
        buildTime: this.cfg.buildTime,
        nodeEnv: this.cfg.nodeEnv,
        // Process start derived from uptime — no extra state to track.
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      },
      // When the cached DB figures above were last refreshed, so the UI can
      // show "as of …" rather than implying they're real-time.
      derivedAt: derived.iso,
    };
  }

  /** Storage usage + active sessions, computed from the DB at most once per
   *  cache window. The storage figure is summed from attachment rows rather
   *  than scanning the object store. */
  private async derivedMetrics() {
    const now = Date.now();
    if (this.derivedCache && now - this.derivedCache.at < this.cfg.metricsCacheTtlMs) {
      return this.derivedCache;
    }

    const [storage, sessions] = await Promise.all([
      this.prisma.attachment.aggregate({
        _sum: { size: true },
        _count: { _all: true },
      }),
      this.prisma.refreshToken.count({
        where: { expiresAt: { gt: new Date() } },
      }),
    ]);

    this.derivedCache = {
      at: now,
      iso: new Date(now).toISOString(),
      storage: {
        totalBytes: storage._sum.size ?? 0,
        fileCount: storage._count._all,
      },
      sessions,
    };
    return this.derivedCache;
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
