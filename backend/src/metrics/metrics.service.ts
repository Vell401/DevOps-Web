import { Injectable } from '@nestjs/common';

export interface SlowQuery {
  model: string;
  action: string;
  durationMs: number;
  at: string;
}

export interface RealtimeStats {
  connections: number;
  onlineUsers: number;
}

export interface RateLimitSnapshot {
  total: number;
  byRoute: { route: string; count: number }[];
}

/** How many recent slow queries to retain in the ring buffer. */
const SLOW_QUERY_BUFFER = 50;

/**
 * In-memory, process-local store for operational metrics shown in the admin
 * panel: recent slow queries, rate-limit hits, and the latest realtime
 * connection snapshot. Everything here resets on restart and is per-instance
 * (not shared across replicas) — fine for a single-node demo deployment.
 */
@Injectable()
export class MetricsService {
  private slowQueries: SlowQuery[] = [];
  private throttleByRoute = new Map<string, number>();
  private throttleTotal = 0;
  private realtimeStats: RealtimeStats = { connections: 0, onlineUsers: 0 };

  /** Record a query that exceeded the slow threshold. Params are intentionally
   *  excluded by the caller so no personal data is ever stored here. */
  recordSlowQuery(q: { model: string; action: string; durationMs: number }): void {
    this.slowQueries.unshift({
      model: q.model,
      action: q.action,
      durationMs: Math.round(q.durationMs),
      at: new Date().toISOString(),
    });
    if (this.slowQueries.length > SLOW_QUERY_BUFFER) {
      this.slowQueries.length = SLOW_QUERY_BUFFER;
    }
  }

  recentSlowQueries(): SlowQuery[] {
    return [...this.slowQueries];
  }

  recordThrottle(route: string): void {
    this.throttleTotal += 1;
    this.throttleByRoute.set(route, (this.throttleByRoute.get(route) ?? 0) + 1);
  }

  rateLimitSnapshot(): RateLimitSnapshot {
    const byRoute = [...this.throttleByRoute.entries()]
      .map(([route, count]) => ({ route, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    return { total: this.throttleTotal, byRoute };
  }

  setRealtime(stats: RealtimeStats): void {
    this.realtimeStats = stats;
  }

  realtime(): RealtimeStats {
    return this.realtimeStats;
  }
}
