import { useEffect, useMemo, useState } from 'react';
import { activityApi, projectsApi } from '../../api/endpoints';
import type {
  Activity,
  ActivityStats,
  ActivityType,
  Label,
  UserLite,
} from '../../types';
import { Avatar } from '../../ui/Avatar';
import { Spinner } from '../../ui/Spinner';
import { Icon } from '../../ui/Icon';
import { Popover, PopoverItem } from '../../ui/Popover';
import { ActivityFeed } from './ActivityFeed';
import { dayLabel, groupByDay } from '../../lib/format';
import { cn } from '../../lib/cn';

interface Props {
  projectId: string;
  projectKey: string;
  users: UserLite[];
  labels: Label[];
  version: number;
}

interface FilterState {
  actorId?: string;
  type?: ActivityType;
}

const TYPE_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: 'CREATED', label: 'Created' },
  { value: 'STATUS_CHANGED', label: 'Status' },
  { value: 'ASSIGNEE_CHANGED', label: 'Assignee' },
  { value: 'PRIORITY_CHANGED', label: 'Priority' },
  { value: 'TITLE_CHANGED', label: 'Title' },
  { value: 'DESCRIPTION_CHANGED', label: 'Description' },
  { value: 'DUE_DATE_CHANGED', label: 'Due date' },
  { value: 'LABEL_ADDED', label: 'Label added' },
  { value: 'LABEL_REMOVED', label: 'Label removed' },
  { value: 'PARENT_CHANGED', label: 'Parent' },
  { value: 'COMMENT_ADDED', label: 'Comment' },
];

export function ActivityDashboard({
  projectId,
  projectKey,
  users,
  labels,
  version,
}: Props) {
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [events, setEvents] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterState>({});

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      activityApi.projectStats(projectId),
      projectsApi.activity(projectId),
    ])
      .then(([s, e]) => {
        if (!mounted) return;
        setStats(s.data);
        setEvents(e.data);
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [projectId, version]);

  const filtered = useMemo(() => {
    return events.filter((ev) => {
      if (filter.actorId && ev.actorId !== filter.actorId) return false;
      if (filter.type && ev.type !== filter.type) return false;
      return true;
    });
  }, [events, filter]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-5">
      <div className="mx-auto max-w-4xl space-y-6">
        {loading && !stats && (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> Loading dashboard…
          </div>
        )}

        {stats && (
          <>
            <Heatmap stats={stats} />
            <div className="grid gap-4 md:grid-cols-2">
              <TopContributorsCard stats={stats} />
              <MostActiveTasksCard stats={stats} projectKey={projectKey} />
            </div>
          </>
        )}

        <section className="rounded-lg bg-surface shadow-card">
          <header className="flex items-center justify-between border-b border-line/40 px-4 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
              Recent events
            </div>
            <div className="flex items-center gap-2">
              <ActorFilter value={filter.actorId} onChange={(v) => setFilter({ ...filter, actorId: v })} users={users} />
              <TypeFilter value={filter.type} onChange={(v) => setFilter({ ...filter, type: v })} />
              {(filter.actorId || filter.type) && (
                <button
                  onClick={() => setFilter({})}
                  className="btn-ghost h-7 px-2 text-xs"
                >
                  Reset
                </button>
              )}
            </div>
          </header>

          <div className="px-4 py-3">
            {groups.length === 0 && (
              <p className="py-6 text-center text-xs text-ink-subtle">
                No matching activity.
              </p>
            )}
            <div className="space-y-4">
              {groups.map(([dayKey, rows]) => (
                <div key={dayKey}>
                  <div className="sticky top-0 z-10 -mx-4 mb-1.5 bg-surface px-4 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                    {dayLabel(dayKey)}
                  </div>
                  <ActivityFeed
                    events={rows}
                    users={users}
                    labels={labels}
                    projectKey={projectKey}
                    showTaskRef
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Heatmap({ stats }: { stats: ActivityStats }) {
  const max = Math.max(1, ...stats.last30Days.map((d) => d.count));
  return (
    <section className="rounded-lg bg-surface p-4 shadow-card">
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <h3 className="font-display text-base font-medium text-ink">Last 30 days</h3>
          <p className="text-xs text-ink-subtle">
            {stats.totalEvents30d} event{stats.totalEvents30d === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-ink-subtle">
          less
          <span className="h-2.5 w-2.5 rounded-sm bg-surface-deep" />
          <span className="h-2.5 w-2.5 rounded-sm bg-blurple/25" />
          <span className="h-2.5 w-2.5 rounded-sm bg-blurple/50" />
          <span className="h-2.5 w-2.5 rounded-sm bg-blurple/80" />
          <span className="h-2.5 w-2.5 rounded-sm bg-blurple" />
          more
        </div>
      </div>
      <div className="grid grid-cols-10 gap-1 sm:grid-cols-15 md:grid-cols-30">
        {stats.last30Days.map((d) => {
          const level = d.count === 0 ? 0 : Math.min(4, Math.ceil((d.count / max) * 4));
          return (
            <div
              key={d.date}
              title={`${d.date} · ${d.count} event${d.count === 1 ? '' : 's'}`}
              className={cn(
                'aspect-square rounded-sm',
                level === 0 && 'bg-surface-deep',
                level === 1 && 'bg-blurple/25',
                level === 2 && 'bg-blurple/50',
                level === 3 && 'bg-blurple/80',
                level === 4 && 'bg-blurple',
              )}
            />
          );
        })}
      </div>
    </section>
  );
}

function TopContributorsCard({ stats }: { stats: ActivityStats }) {
  return (
    <section className="rounded-lg bg-surface p-4 shadow-card">
      <h3 className="mb-3 font-display text-base font-medium text-ink">
        Top contributors
      </h3>
      {stats.topContributors.length === 0 ? (
        <p className="text-xs text-ink-subtle">No activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {stats.topContributors.map((c) => (
            <li key={c.userId} className="flex items-center gap-2.5">
              <Avatar name={c.name} color={c.avatarColor} size="sm" />
              <span className="flex-1 truncate text-sm text-ink">{c.name}</span>
              <span className="font-mono text-xs text-ink-muted">{c.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MostActiveTasksCard({
  stats,
  projectKey,
}: {
  stats: ActivityStats;
  projectKey: string;
}) {
  return (
    <section className="rounded-lg bg-surface p-4 shadow-card">
      <h3 className="mb-3 font-display text-base font-medium text-ink">
        Most active tasks
      </h3>
      {stats.mostActiveTasks.length === 0 ? (
        <p className="text-xs text-ink-subtle">No activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {stats.mostActiveTasks.map((t) => (
            <li key={t.taskId} className="flex items-center gap-2.5">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                {projectKey}-{t.number}
              </span>
              <span className="flex-1 truncate text-sm text-ink">{t.title}</span>
              <span className="font-mono text-xs text-ink-muted">{t.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActorFilter({
  value,
  onChange,
  users,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  users: UserLite[];
}) {
  const selected = users.find((u) => u.id === value);
  return (
    <Popover
      trigger={({ toggle }) => (
        <button onClick={toggle} className="btn-secondary h-7 px-2 text-xs">
          <Icon.User size={12} />
          {selected ? selected.name : 'Actor'}
        </button>
      )}
    >
      {(close) => (
        <>
          <PopoverItem
            onClick={() => {
              onChange(undefined);
              close();
            }}
          >
            Any actor
          </PopoverItem>
          {users.map((u) => (
            <PopoverItem
              key={u.id}
              active={value === u.id}
              onClick={() => {
                onChange(u.id);
                close();
              }}
              icon={<Avatar name={u.name} color={u.avatarColor} size="xs" />}
            >
              {u.name}
            </PopoverItem>
          ))}
        </>
      )}
    </Popover>
  );
}

function TypeFilter({
  value,
  onChange,
}: {
  value: ActivityType | undefined;
  onChange: (v: ActivityType | undefined) => void;
}) {
  const selected = TYPE_OPTIONS.find((t) => t.value === value);
  return (
    <Popover
      trigger={({ toggle }) => (
        <button onClick={toggle} className="btn-secondary h-7 px-2 text-xs">
          <Icon.Filter size={12} />
          {selected ? selected.label : 'Type'}
        </button>
      )}
    >
      {(close) => (
        <>
          <PopoverItem
            onClick={() => {
              onChange(undefined);
              close();
            }}
          >
            Any type
          </PopoverItem>
          {TYPE_OPTIONS.map((t) => (
            <PopoverItem
              key={t.value}
              active={value === t.value}
              onClick={() => {
                onChange(t.value);
                close();
              }}
            >
              {t.label}
            </PopoverItem>
          ))}
        </>
      )}
    </Popover>
  );
}
