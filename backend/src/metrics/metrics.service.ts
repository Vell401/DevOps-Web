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
/** Minutes of per-minute request history retained, shown in the throughput
 *  chart, and averaged over for the "recent latency" figure. */
const HTTP_WINDOW_MINUTES = 30;

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
  private httpByClass: Record<string, number> = { '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  private httpByMethod = new Map<string, number>();
  // Per-minute buckets carry their own duration sum so the snapshot can report
  // a windowed average that tracks recent conditions, not a lifetime mean.
  private httpPerMinute: { minute: number; count: number; durationSum: number }[] = [];

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

  /** Sort a count map into [key, count] pairs, highest count first. */
  private static sortByCountDesc(map: Map<string, number>): [string, number][] {
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  rateLimitSnapshot(): RateLimitSnapshot {
    const byRoute = MetricsService.sortByCountDesc(this.throttleByRoute)
      .slice(0, 20)
      .map(([route, count]) => ({ route, count }));
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
    // Guard against a non-monotonic / negative duration (clock skew upstream).
    const dur = Math.max(0, durationMs);
    this.httpTotal += 1;

    const cls = `${Math.floor(status / 100)}xx`;
    if (cls in this.httpByClass) this.httpByClass[cls] += 1;

    this.httpByMethod.set(method, (this.httpByMethod.get(method) ?? 0) + 1);

    const minute = Math.floor(Date.now() / 60000);
    const last = this.httpPerMinute[this.httpPerMinute.length - 1];
    if (last && last.minute === minute) {
      last.count += 1;
      last.durationSum += dur;
    } else {
      this.httpPerMinute.push({ minute, count: 1, durationSum: dur });
      if (this.httpPerMinute.length > HTTP_WINDOW_MINUTES) this.httpPerMinute.shift();
    }
  }

  httpSnapshot(): HttpSnapshot {
    // Fill the last N minutes (including idle gaps) so the chart is continuous,
    // and average latency over that same window so it reflects recent
    // conditions rather than a diluted lifetime mean.
    const nowMinute = Math.floor(Date.now() / 60000);
    const buckets = new Map(this.httpPerMinute.map((b) => [b.minute, b]));
    const perMinute: { minute: string; count: number }[] = [];
    let windowCount = 0;
    let windowDuration = 0;
    for (let i = HTTP_WINDOW_MINUTES - 1; i >= 0; i--) {
      const m = nowMinute - i;
      const bucket = buckets.get(m);
      perMinute.push({
        minute: new Date(m * 60000).toISOString(),
        count: bucket?.count ?? 0,
      });
      if (bucket) {
        windowCount += bucket.count;
        windowDuration += bucket.durationSum;
      }
    }

    const byMethod = MetricsService.sortByCountDesc(this.httpByMethod).map(
      ([method, count]) => ({ method, count }),
    );

    return {
      total: this.httpTotal,
      byClass: { ...this.httpByClass },
      byMethod,
      avgMs: windowCount ? Math.round(windowDuration / windowCount) : 0,
      perMinute,
    };
  }
}
