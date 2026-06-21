import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Daily prune of expired refresh tokens. Rotation, logout and password changes
 * already delete tokens as they're used, but abandoned sessions (a closed
 * browser, or — as seen during load testing — thousands of logins that never
 * logged out) leave rows that sit in the table indefinitely once their
 * expiresAt has passed. This sweep deletes everything already past expiry so
 * the table stays bounded. The delete is idempotent, so it's safe to run on
 * every replica without a lock (a token's lifetime is still JWT_REFRESH_TTL —
 * this only removes rows that are already dead).
 */
@Injectable()
export class RefreshTokenCleanup {
  private readonly log = new Logger(RefreshTokenCleanup.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneExpired(): Promise<void> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) this.log.log(`Pruned ${count} expired refresh token(s)`);
  }
}
