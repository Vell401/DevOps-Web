import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/endpoints';
import type { AdminProject } from '../types';
import { Topbar } from '../components/Topbar';
import { Avatar } from '../ui/Avatar';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { timeAgo } from '../lib/format';
import { cn } from '../lib/cn';
import { AdminTabs, SectionTitle, Th, Td } from './admin-ui';

type ClosedFilter = 'all' | 'open' | 'closed';

const FILTERS: { value: ClosedFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

/** Admin-only listing of EVERY project in the system (open + closed, across all
 *  owners), cursor-paginated with a search box and an open/closed filter. */
export function AdminProjectsPage() {
  const toast = useToast();
  const [items, setItems] = useState<AdminProject[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [closedFilter, setClosedFilter] = useState<ClosedFilter>('all');

  // Debounce the search box so each keystroke doesn't hit the API.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const closedParam =
    closedFilter === 'all' ? undefined : closedFilter === 'closed';

  // Monotonic request id: a fresh reset bumps it, so a slower in-flight
  // loadMore that resolves afterwards is dropped (never appends a stale page).
  const reqId = useRef(0);

  const loadReset = useCallback(async () => {
    const myReq = ++reqId.current;
    setLoading(true);
    try {
      const { data } = await adminApi.listProjects({
        ...(closedParam !== undefined ? { closed: closedParam } : {}),
        ...(debouncedQ ? { q: debouncedQ } : {}),
      });
      if (myReq !== reqId.current) return;
      setItems(data.items);
      setTotal(data.total);
      setCursor(data.nextCursor);
    } catch {
      if (myReq === reqId.current) toast.push('Failed to load projects', 'error');
    } finally {
      if (myReq === reqId.current) setLoading(false);
    }
  }, [closedParam, debouncedQ, toast]);

  useEffect(() => {
    void loadReset();
  }, [loadReset]);

  const loadMore = async () => {
    if (!cursor) return;
    const myReq = reqId.current; // snapshot — a reset would bump this and void us
    setLoadingMore(true);
    try {
      const { data } = await adminApi.listProjects({
        ...(closedParam !== undefined ? { closed: closedParam } : {}),
        ...(debouncedQ ? { q: debouncedQ } : {}),
        cursor,
      });
      if (myReq !== reqId.current) return;
      setItems((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
    } catch {
      toast.push('Failed to load more', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Admin' }, { label: 'All projects' }]}
        search={{ value: q, onChange: setQ, placeholder: 'Search projects…' }}
      />

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-semibold text-ink">Admin panel</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Every project in the system — open and closed, across all owners.
          </p>
        </div>

        <AdminTabs />

        <div className="mb-4 flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setClosedFilter(f.value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition',
                closedFilter === f.value
                  ? 'bg-surface-sunken font-medium text-ink'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> Loading…
          </div>
        ) : (
          <section>
            <SectionTitle>Projects ({total})</SectionTitle>
            <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card scrollbar-thin">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-line bg-paper/60 text-xs uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <Th>Project</Th>
                    <Th>Owner</Th>
                    <Th>Members</Th>
                    <Th>Tasks</Th>
                    <Th>Status</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="border-b border-line/70 last:border-0">
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className="chip bg-chip-gray font-mono text-ink-muted">
                            {p.key}
                          </span>
                          <Link
                            to={`/projects/${p.id}`}
                            className="font-medium text-ink hover:text-blurple hover:underline"
                          >
                            {p.name}
                          </Link>
                        </div>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Avatar name={p.owner.name} color={p.owner.avatarColor} size="xs" />
                          <span className="min-w-0">
                            <span className="block truncate text-ink">{p.owner.name}</span>
                            <span className="block truncate text-xs text-ink-subtle">
                              {p.owner.email}
                            </span>
                          </span>
                        </div>
                      </Td>
                      <Td>
                        <span className="font-mono text-xs">{p.members}</span>
                      </Td>
                      <Td>
                        <span className="font-mono text-xs">
                          {p.stats.done}/{p.stats.total}
                        </span>
                      </Td>
                      <Td>
                        {p.closedAt ? (
                          <span className="chip bg-chip-gray text-ink-muted">Closed</span>
                        ) : (
                          <span className="chip bg-chip-green text-[#1B6A48]">Open</span>
                        )}
                      </Td>
                      <Td>
                        <span className="text-xs text-ink-muted">{timeAgo(p.createdAt)}</span>
                      </Td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-ink-subtle">
                        No projects match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {cursor && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="btn-ghost h-8 px-4 text-sm"
                >
                  {loadingMore && <Spinner className="mr-2" />}
                  Load more
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
