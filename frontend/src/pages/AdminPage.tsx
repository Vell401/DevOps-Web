import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminUpdateUserBody } from '../api/endpoints';
import type { AdminMetrics, AdminStats, AdminUser, LoginEvent } from '../types';
import { Topbar } from '../components/Topbar';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { Dialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { useAuth } from '../auth/AuthContext';
import { STATUS_META } from '../lib/meta';
import { timeAgo } from '../lib/format';
import { cn } from '../lib/cn';

export function AdminPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [loginsFor, setLoginsFor] = useState<AdminUser | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m, u] = await Promise.all([
        adminApi.stats(),
        adminApi.metrics(),
        adminApi.listUsers(),
      ]);
      setStats(s.data);
      setMetrics(m.data);
      setUsers(u.data);
    } catch {
      toast.push('Failed to load admin data', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const patch = async (id: string, body: AdminUpdateUserBody) => {
    try {
      await adminApi.updateUser(id, body);
      toast.push('User updated', 'success');
      await reload();
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
        'Could not update user';
      toast.push(msg, 'error');
    }
  };

  const remove = async (u: AdminUser) => {
    if (
      !confirm(
        `Delete ${u.email}? Their projects, tasks and comments will be removed too. This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await adminApi.deleteUser(u.id);
      toast.push(`Deleted ${u.email}`, 'success');
      await reload();
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
        'Could not delete user';
      toast.push(msg, 'error');
    }
  };

  const toggleBlock = async (u: AdminUser) => {
    if (
      !u.blocked &&
      !confirm(
        `Block ${u.email}? They won't be able to log in until you unblock them. Any active session keeps working until it expires.`,
      )
    ) {
      return;
    }
    await patch(u.id, { blocked: !u.blocked });
  };

  const filtered = filter
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(filter.toLowerCase()) ||
          u.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : users;

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Admin' }]}
        search={{ value: filter, onChange: setFilter, placeholder: 'Search users…' }}
      />

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-semibold text-ink">Admin panel</h1>
          <p className="mt-1 text-sm text-ink-muted">
            System-wide controls. Only users marked as admin can see this page.
          </p>
        </div>

        {loading && !stats && (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> Loading…
          </div>
        )}

        {stats && (
          <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <StatCard label="Users" value={stats.users} sub={`${stats.admins} admin`} />
            <StatCard label="Projects" value={stats.projects} />
            <StatCard label="Tasks" value={stats.tasks} />
            <StatCard label="Comments" value={stats.comments} />
            <StatCard
              label="Open tasks"
              value={
                stats.tasksByStatus
                  .filter((s) => s.status !== 'DONE')
                  .reduce((a, b) => a + b.count, 0)
              }
              sub={`of ${stats.tasks}`}
            />
          </section>
        )}

        {stats && stats.tasksByStatus.length > 0 && (
          <section className="mb-8">
            <SectionTitle>Tasks by status</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {stats.tasksByStatus.map((row) => {
                const meta = STATUS_META[row.status];
                return (
                  <div
                    key={row.status}
                    className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2 shadow-card"
                  >
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                      <span className="text-ink-muted">{meta.label}</span>
                    </span>
                    <span className="font-mono text-sm text-ink">{row.count}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {metrics && <MetricsSection metrics={metrics} />}

        <section>
          <SectionTitle>Users ({filtered.length})</SectionTitle>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card scrollbar-thin">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-line bg-paper/60 text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <Th>User</Th>
                  <Th>Role</Th>
                  <Th>Projects</Th>
                  <Th>Tasks</Th>
                  <Th>Comments</Th>
                  <Th>Last login</Th>
                  <Th>Joined</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const isMe = me?.id === u.id;
                  return (
                    <tr key={u.id} className="border-b border-line/70 last:border-0">
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u.name} color={u.avatarColor} size="sm" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-ink">{u.name}</span>
                              {isMe && (
                                <span className="chip bg-chip-gray text-ink-muted">you</span>
                              )}
                              {u.blocked && (
                                <span className="chip bg-chip-red text-[#883128]">blocked</span>
                              )}
                            </div>
                            <div className="text-xs text-ink-subtle">{u.email}</div>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <button
                          onClick={() => void patch(u.id, { isAdmin: !u.isAdmin })}
                          className={cn(
                            'chip transition',
                            u.isAdmin
                              ? 'bg-chip-purple text-[#54399A] hover:opacity-80'
                              : 'bg-chip-gray text-ink-muted hover:bg-surface-sunken',
                          )}
                          title={u.isAdmin ? 'Demote to regular user' : 'Promote to admin'}
                        >
                          {u.isAdmin ? 'Admin' : 'User'}
                        </button>
                      </Td>
                      <Td>
                        <span className="font-mono text-xs">{u.stats.projects}</span>
                      </Td>
                      <Td>
                        <span className="font-mono text-xs">{u.stats.tasks}</span>
                      </Td>
                      <Td>
                        <span className="font-mono text-xs">{u.stats.comments}</span>
                      </Td>
                      <Td>
                        <span className="text-xs text-ink-muted">
                          {u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'never'}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-xs text-ink-muted">{timeAgo(u.createdAt)}</span>
                      </Td>
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setLoginsFor(u)}
                            className="btn-ghost h-7 px-2 text-xs"
                            title="View login history"
                          >
                            Logins
                          </button>
                          <button
                            onClick={() => void toggleBlock(u)}
                            disabled={isMe}
                            className={cn(
                              'btn-ghost h-7 px-2 text-xs',
                              isMe
                                ? 'opacity-30'
                                : u.blocked
                                  ? 'text-[#1B6A48] hover:bg-chip-green'
                                  : 'text-[#883128] hover:bg-chip-red/40',
                            )}
                            title={
                              isMe
                                ? "Can't block yourself"
                                : u.blocked
                                  ? 'Unblock user'
                                  : 'Block user'
                            }
                          >
                            {u.blocked ? 'Unblock' : 'Block'}
                          </button>
                          <button
                            onClick={() => setResetFor(u)}
                            className="btn-ghost h-7 px-2 text-xs"
                            title="Reset password"
                          >
                            Reset pw
                          </button>
                          <button
                            onClick={() => void remove(u)}
                            disabled={isMe}
                            className={cn(
                              'btn-ghost h-7 px-2 text-xs',
                              isMe ? 'opacity-30' : 'text-[#883128] hover:bg-chip-red/40',
                            )}
                            title={isMe ? "Can't delete yourself" : 'Delete user'}
                          >
                            <Icon.Trash size={13} />
                          </button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {stats && stats.recentSignups.length > 0 && (
          <section className="mt-8">
            <SectionTitle>Recent signups</SectionTitle>
            <ul className="space-y-1.5">
              {stats.recentSignups.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2"
                >
                  <Avatar name={u.name} color={u.avatarColor} size="xs" />
                  <span className="text-sm text-ink">{u.name}</span>
                  <span className="text-xs text-ink-subtle">{u.email}</span>
                  <span className="ml-auto text-xs text-ink-subtle">{timeAgo(u.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <ResetPasswordDialog
        user={resetFor}
        onClose={() => setResetFor(null)}
        onSubmit={async (pw) => {
          if (!resetFor) return;
          await patch(resetFor.id, { newPassword: pw });
          setResetFor(null);
        }}
      />

      <LoginHistoryDialog user={loginsFor} onClose={() => setLoginsFor(null)} />
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
      {children}
    </h2>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
      <div className="text-[11px] uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

function MetricsSection({ metrics }: { metrics: AdminMetrics }) {
  return (
    <section className="mb-8">
      <SectionTitle>System metrics</SectionTitle>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
    </section>
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

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / 1024 ** i;
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-3 py-2 text-left font-medium', className)}>{children}</th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2 align-middle', className)}>{children}</td>;
}

function ResetPasswordDialog({
  user,
  onClose,
  onSubmit,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onSubmit: (pw: string) => Promise<void>;
}) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPw('');
  }, [user?.id]);

  if (!user) return null;
  return (
    <Dialog
      open={user !== null}
      onClose={onClose}
      title="Reset password"
      description={`A new password will be set for ${user.email}. Their existing sessions will be revoked — they'll have to log in again.`}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 8) return;
          setBusy(true);
          try {
            await onSubmit(pw);
            setPw('');
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-subtle">
            New password (min 8 chars)
          </span>
          <input
            autoFocus
            type="text"
            className="input font-mono"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <p className="text-[11px] text-ink-subtle">
          Communicate the new password to the user out of band. The system does not
          email it.
        </p>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || pw.length < 8}>
            {busy && <Spinner className="border-paper border-t-paper/40" />}
            Set new password
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function LoginHistoryDialog({
  user,
  onClose,
}: {
  user: AdminUser | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    setLoading(true);
    setEvents([]);
    adminApi
      .userLogins(user.id)
      .then((r) => alive && setEvents(r.data))
      .catch(() => alive && toast.push('Could not load login history', 'error'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [user, toast]);

  if (!user) return null;
  return (
    <Dialog
      open={user !== null}
      onClose={onClose}
      title="Login history"
      description={`Most recent sign-in attempts for ${user.email}.`}
      width={560}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-ink-muted">
          <Spinner /> Loading…
        </div>
      ) : events.length === 0 ? (
        <p className="py-6 text-sm text-ink-subtle">No login attempts recorded yet.</p>
      ) : (
        <ul className="max-h-[55vh] space-y-1.5 overflow-y-auto scrollbar-thin">
          {events.map((e) => (
            <li key={e.id} className="rounded-md border border-line bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'chip',
                    e.success
                      ? 'bg-chip-green text-[#1B6A48]'
                      : 'bg-chip-red text-[#883128]',
                  )}
                >
                  {e.success ? 'success' : 'failed'}
                </span>
                <span className="text-xs text-ink-subtle">{timeAgo(e.createdAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-muted">
                <span>
                  IP: <span className="font-mono text-ink">{e.ip ?? '—'}</span>
                </span>
                {e.userAgent && (
                  <span className="min-w-0 break-all">
                    UA: <span className="text-ink">{e.userAgent}</span>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
