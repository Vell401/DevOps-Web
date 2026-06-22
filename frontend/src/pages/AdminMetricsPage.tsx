import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../api/endpoints';
import type { AdminMetrics } from '../types';
import { Topbar } from '../components/Topbar';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { cn } from '../lib/cn';
import { timeAgo } from '../lib/format';
import {
  AdminTabs,
  type CardStatus,
  SectionTitle,
  ServiceCard,
  StatCard,
  formatBytes,
  formatUptime,
} from './admin-ui';

type BackupStatus = AdminMetrics['backup']['status'];

// Backup status → card tone + header wording.
const BACKUP_TONE: Record<BackupStatus, CardStatus> = {
  ok: 'up',
  stale: 'warn',
  failed: 'down',
  unknown: 'disabled',
};
const BACKUP_LABEL: Record<BackupStatus, string> = {
  ok: 'Healthy',
  stale: 'Stale',
  failed: 'Failed',
  unknown: 'No data',
};

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
              <SectionTitle>Services</SectionTitle>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ServiceCard
                  name="Backend · API"
                  status={metrics.services.backend.status}
                  primary={`${metrics.services.backend.rssMb} MB`}
                  primaryLabel="resident memory (RSS)"
                  rows={[
                    { label: 'Heap (V8) used', value: `${metrics.services.backend.heapUsedMb} MB` },
                    { label: 'Uptime', value: formatUptime(metrics.services.backend.uptimeSec) },
                    { label: 'Node', value: metrics.services.backend.version },
                  ]}
                />
                <ServiceCard
                  name="PostgreSQL"
                  status={metrics.services.postgres.status}
                  primary={formatBytes(metrics.services.postgres.sizeBytes)}
                  primaryLabel="database on disk"
                  rows={[
                    { label: 'Connections', value: metrics.services.postgres.connections },
                    { label: 'Uptime', value: formatUptime(metrics.services.postgres.uptimeSec) },
                    { label: 'Version', value: metrics.services.postgres.version },
                  ]}
                />
                <ServiceCard
                  name="Redis"
                  status={metrics.services.redis.status}
                  primary={
                    metrics.services.redis.status === 'disabled'
                      ? '—'
                      : formatBytes(metrics.services.redis.usedMemoryBytes)
                  }
                  primaryLabel="memory in use"
                  rows={[
                    { label: 'Keys', value: metrics.services.redis.keys },
                    { label: 'Clients', value: metrics.services.redis.connectedClients },
                    { label: 'Uptime', value: formatUptime(metrics.services.redis.uptimeSec) },
                    { label: 'Version', value: metrics.services.redis.version },
                  ]}
                />
                <ServiceCard
                  name="Object storage · S3"
                  status={metrics.services.objectStorage.status}
                  primary={formatBytes(metrics.services.objectStorage.sizeBytes)}
                  primaryLabel="attachments stored"
                  rows={[
                    { label: 'Files', value: metrics.services.objectStorage.fileCount },
                  ]}
                />
              </div>
              <p className="mt-2 text-[11px] text-ink-subtle">
                Service figures cached — as of {timeAgo(metrics.derivedAt)}.
              </p>
            </section>

            <section className="mb-8">
              <SectionTitle>Backups</SectionTitle>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <ServiceCard
                  name="restic backups"
                  status={BACKUP_TONE[metrics.backup.status]}
                  statusLabel={BACKUP_LABEL[metrics.backup.status]}
                  primary={
                    metrics.backup.lastRunAt ? timeAgo(metrics.backup.lastRunAt) : '—'
                  }
                  primaryLabel="last successful run"
                  rows={[
                    { label: 'Snapshots', value: metrics.backup.snapshots },
                    { label: 'Repo size', value: formatBytes(metrics.backup.repoSizeBytes) },
                    {
                      label: 'Oldest kept',
                      value: metrics.backup.oldest ? timeAgo(metrics.backup.oldest) : '—',
                    },
                    {
                      label: 'Retention',
                      value: metrics.backup.retention
                        ? `${metrics.backup.retention.daily}d / ${metrics.backup.retention.weekly}w / ${metrics.backup.retention.monthly}m`
                        : '—',
                    },
                    {
                      label: 'Integrity check',
                      value:
                        metrics.backup.lastCheckOk === null
                          ? '—'
                          : metrics.backup.lastCheckOk
                            ? 'passed'
                            : 'failed',
                    },
                  ]}
                />

                {/* Last 3 days — a successful day has both a db and a minio snapshot. */}
                <div className="rounded-lg border border-line bg-surface p-4 shadow-card">
                  <div className="mb-3 text-sm font-medium text-ink">Last 3 days</div>
                  {metrics.backup.recentDays.length === 0 ? (
                    <p className="text-xs text-ink-subtle">No snapshot history yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {metrics.backup.recentDays.map((d) => (
                        <li key={d.date} className="flex items-center justify-between text-xs">
                          <span className="text-ink-muted">{dayLabel(d.date)}</span>
                          <span className="flex items-center gap-3">
                            <DayFlag ok={d.db} label="DB" />
                            <DayFlag ok={d.minio} label="files" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Recent snapshot log — the authoritative record of successful runs. */}
                <div className="rounded-lg border border-line bg-surface p-4 shadow-card">
                  <div className="mb-3 text-sm font-medium text-ink">Recent snapshots</div>
                  {metrics.backup.recent.length === 0 ? (
                    <p className="text-xs text-ink-subtle">No snapshots reported.</p>
                  ) : (
                    <ul className="max-h-44 space-y-1.5 overflow-y-auto scrollbar-thin pr-1">
                      {metrics.backup.recent.map((s) => (
                        <li
                          key={s.id}
                          className="flex items-center justify-between gap-2 text-[11px]"
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className={cn(
                                'inline-block w-10 rounded px-1 text-center font-mono uppercase',
                                s.tag === 'db'
                                  ? 'bg-chip-blue text-[#A8B0F8]'
                                  : 'bg-chip-green text-[#7BD0A0]',
                              )}
                            >
                              {s.tag === 'minio' ? 'files' : s.tag || '—'}
                            </span>
                            <span className="text-ink-muted">{timeAgo(s.time)}</span>
                          </span>
                          <span className="font-mono text-ink-subtle">{s.id}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {metrics.backup.status === 'unknown' && (
                <p className="mt-2 text-[11px] text-ink-subtle">
                  No backup status reported yet — the host backup job writes it on
                  its first run.
                </p>
              )}
              {metrics.backup.error && (
                <p className="mt-2 text-[11px] text-status-dnd">
                  Last error: {metrics.backup.error}
                </p>
              )}
            </section>

            <section className="mb-8">
              <SectionTitle>Realtime &amp; sessions</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                  label="Rate-limit hits"
                  value={metrics.rateLimit.total}
                  sub="since restart"
                />
              </div>
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
                    {(['1xx', '2xx', '3xx', '4xx', '5xx'] as const).map((c) => (
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
              <SectionTitle>Build info</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard label="Version" value={metrics.build.version} />
                <StatCard label="Git SHA" value={metrics.build.gitSha} />
                <StatCard label="Environment" value={metrics.build.nodeEnv} />
                <StatCard label="Built" value={buildTimeLabel(metrics.build.buildTime)} />
                <StatCard label="Started" value={buildTimeLabel(metrics.build.startedAt)} />
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
  '1xx': '#3B82F6',
  '2xx': '#2FA968',
  '3xx': '#6B7280',
  '4xx': '#C9852B',
  '5xx': '#C0392B',
};

/** Today / Yesterday / "Jun 16" for the backup 3-day timeline. */
function dayLabel(dateIso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateIso === today) return 'Today';
  if (dateIso === yesterday) return 'Yesterday';
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/** A green ✓ / red ✗ chip for one part (DB / files) of a day's backup. */
function DayFlag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        ok ? 'text-status-online' : 'text-status-dnd',
      )}
    >
      {ok ? '✓' : '✗'} {label}
    </span>
  );
}

// Provenance timestamps may be absent or a sentinel ('unknown', or an empty
// string from a CI expression that resolved to nothing) for images built
// without build-args. Render those as an em dash rather than leaking the
// literal "Invalid Date" that timeAgo() would otherwise return.
function buildTimeLabel(v: string): string {
  if (!v || v === 'unknown' || Number.isNaN(Date.parse(v))) return '—';
  return timeAgo(v);
}

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
        <span>{data.length} min ago</span>
        <span>
          {total} reqs · peak {max}/min
        </span>
        <span>now</span>
      </div>
    </div>
  );
}
