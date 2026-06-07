import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { activityApi, projectsApi, usersApi } from '../api/endpoints';
import type {
  Activity,
  ActivityType,
  Label,
  Project,
  UserLite,
} from '../types';
import { Topbar } from '../components/Topbar';
import { ActivityFeed } from '../components/board/ActivityFeed';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { Popover, PopoverItem } from '../ui/Popover';
import { dayLabel, groupByDay } from '../lib/format';

interface FilterState {
  actorId?: string;
  type?: ActivityType;
  projectId?: string;
}

const TYPE_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: 'CREATED', label: 'Created' },
  { value: 'STATUS_CHANGED', label: 'Status changed' },
  { value: 'ASSIGNEE_CHANGED', label: 'Assigned' },
  { value: 'PRIORITY_CHANGED', label: 'Priority' },
  { value: 'TITLE_CHANGED', label: 'Renamed' },
  { value: 'DESCRIPTION_CHANGED', label: 'Description' },
  { value: 'DUE_DATE_CHANGED', label: 'Due date' },
  { value: 'LABEL_ADDED', label: 'Label added' },
  { value: 'LABEL_REMOVED', label: 'Label removed' },
  { value: 'PARENT_CHANGED', label: 'Parent' },
  { value: 'COMMENT_ADDED', label: 'Comment' },
];

export function ActivityPage() {
  const [events, setEvents] = useState<Activity[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<FilterState>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await activityApi.global(filter);
      setEvents(data);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    Promise.all([usersApi.list(), projectsApi.list()]).then(([u, p]) => {
      setUsers(u.data);
      setProjects(p.data);
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const groups = useMemo(() => groupByDay(events), [events]);
  const labels: Label[] = []; // global feed doesn't include labels list; chips render with id-only

  const selectedActor = users.find((u) => u.id === filter.actorId);
  const selectedProject = projects.find((p) => p.id === filter.projectId);
  const selectedType = TYPE_OPTIONS.find((t) => t.value === filter.type);

  return (
    <>
      <Topbar crumbs={[{ label: 'Activity' }]} />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-5">
            <h1 className="font-display text-2xl font-semibold text-ink">Activity</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Everything happening across your projects, newest first.
            </p>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Popover
              trigger={({ toggle }) => (
                <button onClick={toggle} className="btn-secondary h-7 px-2 text-xs">
                  <Icon.Layers size={12} />
                  {selectedProject ? selectedProject.name : 'Project'}
                </button>
              )}
            >
              {(close) => (
                <>
                  <PopoverItem
                    onClick={() => {
                      setFilter({ ...filter, projectId: undefined });
                      close();
                    }}
                  >
                    Any project
                  </PopoverItem>
                  {projects.map((p) => (
                    <PopoverItem
                      key={p.id}
                      active={filter.projectId === p.id}
                      onClick={() => {
                        setFilter({ ...filter, projectId: p.id });
                        close();
                      }}
                    >
                      <span className="font-mono text-[11px] text-ink-subtle">{p.key}</span>
                      <span className="ml-2">{p.name}</span>
                    </PopoverItem>
                  ))}
                </>
              )}
            </Popover>

            <Popover
              trigger={({ toggle }) => (
                <button onClick={toggle} className="btn-secondary h-7 px-2 text-xs">
                  <Icon.User size={12} />
                  {selectedActor ? selectedActor.name : 'Actor'}
                </button>
              )}
            >
              {(close) => (
                <>
                  <PopoverItem
                    onClick={() => {
                      setFilter({ ...filter, actorId: undefined });
                      close();
                    }}
                  >
                    Any actor
                  </PopoverItem>
                  {users.map((u) => (
                    <PopoverItem
                      key={u.id}
                      active={filter.actorId === u.id}
                      onClick={() => {
                        setFilter({ ...filter, actorId: u.id });
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

            <Popover
              trigger={({ toggle }) => (
                <button onClick={toggle} className="btn-secondary h-7 px-2 text-xs">
                  <Icon.Filter size={12} />
                  {selectedType ? selectedType.label : 'Type'}
                </button>
              )}
            >
              {(close) => (
                <>
                  <PopoverItem
                    onClick={() => {
                      setFilter({ ...filter, type: undefined });
                      close();
                    }}
                  >
                    Any type
                  </PopoverItem>
                  {TYPE_OPTIONS.map((t) => (
                    <PopoverItem
                      key={t.value}
                      active={filter.type === t.value}
                      onClick={() => {
                        setFilter({ ...filter, type: t.value });
                        close();
                      }}
                    >
                      {t.label}
                    </PopoverItem>
                  ))}
                </>
              )}
            </Popover>

            {(filter.actorId || filter.type || filter.projectId) && (
              <button onClick={() => setFilter({})} className="btn-ghost h-7 px-2 text-xs">
                Reset
              </button>
            )}
          </div>

          {loading && !events.length && (
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <Spinner /> Loading…
            </div>
          )}

          {!loading && groups.length === 0 && (
            <p className="rounded-lg bg-surface p-6 text-center text-sm text-ink-muted shadow-card">
              No activity yet. Open a project and create your first task.
            </p>
          )}

          <div className="space-y-5">
            {groups.map(([dayKey, rows]) => (
              <section key={dayKey} className="rounded-lg bg-surface shadow-card">
                <header className="sticky top-0 z-10 rounded-t-lg border-b border-line/40 bg-surface px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                  {dayLabel(dayKey)}
                </header>
                <div className="px-4 py-3">
                  {rows.map((ev) => (
                    <div key={ev.id} className="border-b border-line/30 py-1.5 last:border-0">
                      <ActivityFeed
                        events={[ev]}
                        users={users}
                        labels={labels}
                        projectKey={ev.task?.project?.key ?? ''}
                        showTaskRef
                      />
                      {ev.task?.project && (
                        <div className="ml-9 -mt-1 mb-1">
                          <Link
                            to={`/projects/${ev.task.project.id}`}
                            className="text-[11px] text-ink-subtle hover:text-blurple"
                          >
                            in {ev.task.project.name}
                          </Link>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
