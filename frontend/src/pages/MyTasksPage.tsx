import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { tasksApi } from '../api/endpoints';
import type { Task } from '../types';
import { Topbar } from '../components/Topbar';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { StatusBadge } from '../ui/StatusBadge';
import { PriorityFlag } from '../ui/PriorityFlag';
import { formatDate } from '../lib/format';
import { cn } from '../lib/cn';

type BucketKey = 'overdue' | 'today' | 'week' | 'later' | 'none';

const BUCKETS: { key: BucketKey; label: string; hint?: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No due date' },
];

function bucketOf(task: Task): BucketKey {
  if (!task.dueDate) return 'none';
  const due = new Date(task.dueDate);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const endOfWeek = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (due < startOfToday) return 'overdue';
  if (due < endOfToday) return 'today';
  if (due < endOfWeek) return 'week';
  return 'later';
}

export function MyTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    tasksApi
      .mine()
      .then((list) => mounted && setTasks(list))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const groups = useMemo(() => {
    const map = new Map<BucketKey, Task[]>();
    for (const t of tasks) {
      const key = bucketOf(t);
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return map;
  }, [tasks]);

  return (
    <>
      <Topbar crumbs={[{ label: 'My tasks' }]} />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-5">
            <h1 className="font-display text-2xl font-semibold text-ink">My tasks</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Everything assigned to you across all open projects, deadline first.
            </p>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <Spinner /> Loading…
            </div>
          )}

          {!loading && tasks.length === 0 && (
            <p className="rounded-lg bg-surface p-6 text-center text-sm text-ink-muted shadow-card">
              Nothing on your plate. Open a project board to pick something up.
            </p>
          )}

          <div className="space-y-6">
            {BUCKETS.map(({ key, label }) => {
              const items = groups.get(key);
              if (!items?.length) return null;
              return (
                <section key={key}>
                  <h2
                    className={cn(
                      'mb-2 text-[11px] font-medium uppercase tracking-[0.14em]',
                      key === 'overdue' ? 'text-status-dnd' : 'text-ink-subtle',
                    )}
                  >
                    {label}
                    <span className="ml-2 font-mono normal-case tracking-normal">
                      {items.length}
                    </span>
                  </h2>
                  <ul className="space-y-1.5">
                    {items.map((t) => (
                      <li key={t.id}>
                        <Link
                          to={`/projects/${t.projectId}?task=${t.id}`}
                          className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2.5 shadow-card transition hover:bg-surface-hover"
                        >
                          <span className="shrink-0 font-mono text-[11px] uppercase text-ink-subtle">
                            {t.project?.key ?? '?'}-{t.number}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">
                            {t.title}
                          </span>
                          {t.dueDate && (
                            <span
                              className={cn(
                                'inline-flex shrink-0 items-center gap-1 text-[11px]',
                                key === 'overdue' ? 'text-status-dnd' : 'text-ink-muted',
                              )}
                            >
                              <Icon.Calendar size={11} />
                              {formatDate(t.dueDate)}
                            </span>
                          )}
                          <PriorityFlag priority={t.priority} showLabel={false} />
                          <StatusBadge status={t.status} />
                          <span className="hidden max-w-[140px] truncate text-[11px] text-ink-subtle sm:block">
                            {t.project?.name}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
