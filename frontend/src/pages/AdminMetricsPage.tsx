import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../api/endpoints';
import type { AdminMetrics } from '../types';
import { Topbar } from '../components/Topbar';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { timeAgo } from '../lib/format';
import { AdminTabs, SectionTitle, StatCard, formatBytes } from './admin-ui';

// Poll cadence for the live panel. The backend serves the realtime / slow-query
// / rate-limit feeds from memory and caches the DB-derived figures, so polling
// here stays cheap regardless of how many admins are watching.
const POLL_MS = 10_000;

export function AdminMetricsPage() {
  const toast = useToast();
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  // Avoid a toast storm if the endpoint starts failing during polling.
  const erroredRef = useRef(false);

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const { data } = await adminApi.metrics();
        if (!alive) return;
        setMetrics(data);
        erroredRef.current = false;
      } catch {
        if (alive && !erroredRef.current) {
          erroredRef.current = true;
          toast.push('Could not load system metrics', 'error');
        }
      } finally {
        if (alive) setLoading(false);
      }
    };

    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [toast]);

  return (
    <>
      <Topbar crumbs={[{ label: 'Admin' }, { label: 'System metrics' }]} />

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-semibold text-ink">System metrics</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Live operational view. Refreshes every {POLL_MS / 1000}s.
          </p>
        </div>

        <AdminTabs />

        {loading && !metrics && (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> Loading…
          </div>
        )}

        {metrics && (
          <>
            <section className="mb-8">
              <SectionTitle>Realtime &amp; sessions</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard
                  label="WS connections"
                  value={metrics.realtime.connections}
                  sub="live sockets"
                />
                <StatCard
                  label="Online users"
                  value={metrics.realtime.onlineUsers}
                  sub="distinct, realtime"
                />
                <StatCard
                  label="Active sessions"
                  value={metrics.sessions}
                  sub="valid refresh tokens"
                />
                <StatCard
                  label="Storage used"
                  value={formatBytes(metrics.storage.totalBytes)}
                  sub={`${metrics.storage.fileCount} file${metrics.storage.fileCount === 1 ? '' : 's'}`}
                />
                <StatCard
                  label="Rate-limit hits"
                  value={metrics.rateLimit.total}
                  sub="since restart"
                />
              </div>
              <p className="mt-2 text-[11px] text-ink-subtle">
                Storage &amp; sessions cached — as of {timeAgo(metrics.derivedAt)}.
              </p>
            </section>

            <section className="mb-8">
              <SectionTitle>API requests</SectionTitle>
              <div className="rounded-lg border border-line bg-surface p-4 shadow-card">
                <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div>
                    <div className="font-display text-2xl font-semibold text-ink">
                      {metrics.http.total}
                    </div>
                    <div className="text-[11px] uppercase tracking-wide text-ink-subtle">
                      total · {metrics.http.avgMs}ms avg
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['2xx', '3xx', '4xx', '5xx'] as const).map((c) => (
                      <span
                        key={c}
                        className="chip inline-flex items-center gap-1 bg-chip-gray text-ink-muted"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: STATUS_DOT[c] }}
                        />
                        {c} · {metrics.http.byClass[c] ?? 0}
                      </span>
                    ))}
                  </div>
                  {metrics.http.byMethod.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                      {metrics.http.byMethod.map((m) => (
                        <span key={m.method} className="font-mono">
                          {m.method} {m.count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <RequestChart data={metrics.http.perMinute} />
              </div>
            </section>

            <section className="mb-8">
              <SectionTitle>Process</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label="Uptime"
                  value={formatUptime(metrics.process.uptimeSec)}
                />
                <StatCard label="Memory (RSS)" value={`${metrics.process.rssMb} MB`} />
                <StatCard
                  label="Heap used"
                  value={`${metrics.process.heapUsedMb} MB`}
                />
                <StatCard label="Node" value={metrics.process.nodeVersion} />
              </div>
            </section>

            <section className="mb-8">
              <SectionTitle>Build info</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard label="Version" value={metrics.build.version} />
                <StatCard label="Git SHA" value={metrics.build.gitSha} />
                <StatCard label="Environment" value={metrics.build.nodeEnv} />
                <StatCard
                  label="Built"
                  value={
                    metrics.build.buildTime === 'unknown'
                      ? '—'
                      : timeAgo(metrics.build.buildTime)
                  }
                />
                <StatCard label="Started" value={timeAgo(metrics.build.startedAt)} />
              </div>
            </section>

            <div className="grid gap-3 lg:grid-cols-2">
              <MetricPanel
                title="Slow queries"
                aside={`> ${metrics.slowQueryThresholdMs}ms · last ${metrics.slowQueries.length}`}
                empty={metrics.slowQueries.length === 0 ? 'No slow queries recorded.' : null}
              >
                {metrics.slowQueries.map((q, i) => (
                  <li
                    key={`${q.at}-${i}`}
                    className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
                  >
                    <span className="truncate font-mono text-ink-muted">
                      {q.model}.{q.action}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-ink-subtle">{timeAgo(q.at)}</span>
                      <span className="font-mono text-[#883128]">{q.durationMs}ms</span>
                    </span>
                  </li>
                ))}
              </MetricPanel>
              <MetricPanel
                title="Rate-limit hits by route"
                aside={`${metrics.rateLimit.total} total`}
                empty={
                  metrics.rateLimit.byRoute.length === 0
                    ? 'No requests have been throttled.'
                    : null
                }
              >
                {metrics.rateLimit.byRoute.map((r) => (
                  <li
                    key={r.route}
                    className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
                  >
                    <span className="truncate font-mono text-ink-muted">{r.route}</span>
                    <span className="shrink-0 font-mono text-ink">{r.count}</span>
                  </li>
                ))}
              </MetricPanel>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function MetricPanel({
  title,
  aside,
  empty,
  children,
}: {
  title: string;
  aside: string;
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-xs font-medium text-ink">{title}</span>
        <span className="text-[11px] text-ink-subtle">{aside}</span>
      </div>
      {empty ? (
        <p className="px-3 py-4 text-xs text-ink-subtle">{empty}</p>
      ) : (
        <ul className="max-h-56 divide-y divide-line/60 overflow-y-auto scrollbar-thin">
          {children}
        </ul>
      )}
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  '2xx': '#2FA968',
  '3xx': '#6B7280',
  '4xx': '#C9852B',
  '5xx': '#C0392B',
};

function RequestChart({ data }: { data: { minute: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((a, b) => a + b.count, 0);
  return (
    <div>
      <div className="flex h-16 items-end gap-0.5">
        {data.map((d) => (
          <div
            key={d.minute}
            title={`${new Date(d.minute).toLocaleTimeString()} · ${d.count} req`}
            className="flex-1 rounded-t-sm bg-blurple/70 transition hover:bg-blurple"
            style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-subtle">
        <span>30 min ago</span>
        <span>
          {total} reqs · peak {max}/min
        </span>
        <span>now</span>
      </div>
    </div>
  );
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
