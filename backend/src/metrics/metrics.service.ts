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

export interface HttpSnapshot {
  total: number;
  byClass: Record<string, number>;
  byMethod: { method: string; count: number }[];
  avgMs: number;
  perMinute: { minute: string; count: number }[];
}

/** How many recent slow queries to retain in the ring buffer. */
const SLOW_QUERY_BUFFER = 50;
/** How many one-minute request buckets to keep for the throughput chart. */
const HTTP_MINUTE_BUFFER = 60;
/** How many of those minutes the dashboard chart shows. */
const HTTP_CHART_MINUTES = 30;

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

  // HTTP throughput, accumulated continuously by the metrics middleware.
  private httpTotal = 0;
  private httpByClass: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  private httpByMethod = new Map<string, number>();
  private httpDurationSum = 0;
  private httpPerMinute: { minute: number; count: number }[] = [];

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

  /** Tally one finished HTTP response. Called per-request by the middleware. */
  recordHttp(method: string, status: number, durationMs: number): void {
    this.httpTotal += 1;
    this.httpDurationSum += durationMs;

    const cls = `${Math.floor(status / 100)}xx`;
    if (cls in this.httpByClass) this.httpByClass[cls] += 1;

    this.httpByMethod.set(method, (this.httpByMethod.get(method) ?? 0) + 1);

    const minute = Math.floor(Date.now() / 60000);
    const last = this.httpPerMinute[this.httpPerMinute.length - 1];
    if (last && last.minute === minute) {
      last.count += 1;
    } else {
      this.httpPerMinute.push({ minute, count: 1 });
      if (this.httpPerMinute.length > HTTP_MINUTE_BUFFER) this.httpPerMinute.shift();
    }
  }

  httpSnapshot(): HttpSnapshot {
    // Fill the last N minutes (including idle gaps) so the chart is continuous.
    const nowMinute = Math.floor(Date.now() / 60000);
    const counts = new Map(this.httpPerMinute.map((b) => [b.minute, b.count]));
    const perMinute: { minute: string; count: number }[] = [];
    for (let i = HTTP_CHART_MINUTES - 1; i >= 0; i--) {
      const m = nowMinute - i;
      perMinute.push({
        minute: new Date(m * 60000).toISOString(),
        count: counts.get(m) ?? 0,
      });
    }

    const byMethod = [...this.httpByMethod.entries()]
      .map(([method, count]) => ({ method, count }))
      .sort((a, b) => b.count - a.count);

    return {
      total: this.httpTotal,
      byClass: { ...this.httpByClass },
      byMethod,
      avgMs: this.httpTotal ? Math.round(this.httpDurationSum / this.httpTotal) : 0,
      perMinute,
    };
  }
}
