import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

/**
 * Shared ioredis connection for cross-replica state (throttler counters,
 * cached admin metrics). Redis is optional: when REDIS_HOST is not set (bare
 * `npm run start:dev`, unit tests) every helper degrades to a no-op and
 * callers fall back to their process-local behaviour.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);
  private readonly client: Redis | null = null;

  constructor(cfg: AppConfigService) {
    if (!cfg.redisEnabled) {
      this.log.log('REDIS_HOST not set — falling back to in-process stores');
      return;
    }
    this.client = new Redis({
      host: cfg.redisHost,
      port: cfg.redisPort,
      maxRetriesPerRequest: 2,
    });
    // ioredis emits connection problems as 'error'; without a listener they
    // become uncaught exceptions and take the whole process down.
    this.client.on('error', (err: Error) =>
      this.log.warn(`Redis error: ${err.message}`),
    );
  }

  /** Raw connection for libraries that take an ioredis client (throttler). */
  get connection(): Redis | null {
    return this.client;
  }

  /** Best-effort JSON read; null on miss, parse error, or no Redis. */
  async getJson<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  /** Best-effort JSON write with a TTL; losing it only costs a re-compute. */
  async setJson(key: string, value: unknown, ttlMs: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'PX', ttlMs);
    } catch {
      // cache write failure is not an error condition for callers
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
