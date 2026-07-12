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

/** One minute of HTTP traffic. Keeping the breakdown per-minute lets the
 *  snapshot report counts/latency over a rolling window instead of since boot. */
interface HttpMinuteBucket {
  minute: number;
  count: number;
  durationSum: number;
  byClass: Record<string, number>;
  byMethod: Map<string, number>;
}

/** How many recent slow queries to retain in the ring buffer. */
const SLOW_QUERY_BUFFER = 50;
/** Length of the rolling window (minutes) the HTTP card is computed over — the
 *  throughput chart, the headline request count, the status/method breakdown
 *  and the latency average all cover this window, not the whole process life. */
const HTTP_WINDOW_MINUTES = 60;

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

  // HTTP throughput as per-minute buckets, fed by the metrics middleware. Every
  // figure the snapshot reports (count, status/method breakdown, latency) is
  // summed across the retained buckets, so the card reflects a rolling window
  // rather than a lifetime total. Buckets older than the window are dropped.
  private httpBuckets: HttpMinuteBucket[] = [];

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
    const cls = `${Math.floor(status / 100)}xx`;
    const minute = Math.floor(Date.now() / 60000);

    let bucket = this.httpBuckets[this.httpBuckets.length - 1];
    if (!bucket || bucket.minute !== minute) {
      bucket = { minute, count: 0, durationSum: 0, byClass: {}, byMethod: new Map() };
      this.httpBuckets.push(bucket);
      if (this.httpBuckets.length > HTTP_WINDOW_MINUTES) this.httpBuckets.shift();
    }
    bucket.count += 1;
    bucket.durationSum += dur;
    bucket.byClass[cls] = (bucket.byClass[cls] ?? 0) + 1;
    bucket.byMethod.set(method, (bucket.byMethod.get(method) ?? 0) + 1);
  }

  httpSnapshot(): HttpSnapshot {
    // Everything below is summed over the last HTTP_WINDOW_MINUTES: the chart
    // fills idle gaps with zeroes to stay continuous, and the count / breakdown
    // / latency cover the same window so the card tracks recent conditions
    // rather than a lifetime total.
    const nowMinute = Math.floor(Date.now() / 60000);
    const buckets = new Map(this.httpBuckets.map((b) => [b.minute, b]));
    const perMinute: { minute: string; count: number }[] = [];
    const byClass: Record<string, number> = { '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    const byMethodMap = new Map<string, number>();
    let windowCount = 0;
    let windowDuration = 0;

    for (let i = HTTP_WINDOW_MINUTES - 1; i >= 0; i--) {
      const m = nowMinute - i;
      const bucket = buckets.get(m);
      perMinute.push({
        minute: new Date(m * 60000).toISOString(),
        count: bucket?.count ?? 0,
      });
      if (!bucket) continue;
      windowCount += bucket.count;
      windowDuration += bucket.durationSum;
      for (const [cls, n] of Object.entries(bucket.byClass)) {
        byClass[cls] = (byClass[cls] ?? 0) + n;
      }
      for (const [method, n] of bucket.byMethod) {
        byMethodMap.set(method, (byMethodMap.get(method) ?? 0) + n);
      }
    }

    const byMethod = MetricsService.sortByCountDesc(byMethodMap).map(
      ([method, count]) => ({ method, count }),
    );

    return {
      total: windowCount,
      byClass,
      byMethod,
      avgMs: windowCount ? Math.round(windowDuration / windowCount) : 0,
      perMinute,
    };
  }
}
