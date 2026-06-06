import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  labelsApi,
  projectsApi,
  tasksApi,
  usersApi,
} from '../api/endpoints';
import type {
  Activity,
  Label,
  Project,
  Task,
  TaskStatus,
  UserLite,
} from '../types';
import { Topbar } from '../components/Topbar';
import { Board } from '../components/board/Board';
import { TaskListView } from '../components/board/TaskListView';
import { ActivityFeed } from '../components/board/ActivityFeed';
import { Filters, type FilterState } from '../components/board/Filters';
import { TaskDrawer } from '../components/board/TaskDrawer';
import { NewTaskDialog } from '../components/board/NewTaskDialog';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { cn } from '../lib/cn';

type View = 'board' | 'list' | 'activity';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('board');
  const [filters, setFilters] = useState<FilterState>({
    q: '',
    labelIds: [],
  });
  const [search, setSearch] = useSearchParams();
  const taskId = search.get('task');
  const setTaskId = useCallback(
    (val: string | null) => {
      const next = new URLSearchParams(search);
      if (val) next.set('task', val);
      else next.delete('task');
      setSearch(next, { replace: true });
    },
    [search, setSearch],
  );
  const [newTaskFor, setNewTaskFor] = useState<TaskStatus | null>(null);
  const toast = useToast();

  const reloadCore = useCallback(async () => {
    if (!id) return;
    const [p, u, l] = await Promise.all([
      projectsApi.get(id),
      usersApi.list(),
      labelsApi.list(id),
    ]);
    setProject(p.data);
    setUsers(u.data);
    setLabels(l.data);
  }, [id]);

  const reloadTasks = useCallback(async () => {
    if (!id) return;
    const { data } = await tasksApi.list(id, {
      q: filters.q || undefined,
      assigneeId: filters.assigneeId,
      labelIds: filters.labelIds.length ? filters.labelIds : undefined,
      priority: filters.priority,
    });
    setTasks(data);
  }, [id, filters]);

  const reloadActivity = useCallback(async () => {
    if (!id) return;
    const { data } = await projectsApi.activity(id);
    setActivities(data);
  }, [id]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([reloadCore(), reloadTasks(), reloadActivity()])
      .catch(() => mounted && toast.push('Could not load project', 'error'))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    void reloadTasks();
  }, [reloadTasks]);

  const onMove = async (taskIdToMove: string, status: TaskStatus) => {
    const before = tasks.find((t) => t.id === taskIdToMove);
    if (!before || before.status === status) return;
    setTasks((prev) =>
      prev.map((t) => (t.id === taskIdToMove ? { ...t, status } : t)),
    );
    try {
      await tasksApi.update(taskIdToMove, { status });
      void reloadActivity();
    } catch {
      toast.push('Could not move task', 'error');
      setTasks((prev) =>
        prev.map((t) => (t.id === taskIdToMove ? { ...t, status: before.status } : t)),
      );
    }
  };

  const filteredTasks = useMemo(() => {
    // server already filtered; for the local q in case server skipped it
    if (!filters.q) return tasks;
    const q = filters.q.toLowerCase();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q),
    );
  }, [tasks, filters.q]);

  if (loading && !project) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-ink-muted">
        <Spinner /> <span className="ml-2">Loading project…</span>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-ink-muted">
        Project not found.{' '}
        <Link to="/projects" className="ml-2 underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <>
      <Topbar
        crumbs={[
          { label: 'Projects', href: '/projects' },
          { label: project.name },
        ]}
        search={{
          value: filters.q,
          onChange: (v) => setFilters({ ...filters, q: v }),
          placeholder: 'Filter tasks…',
        }}
        right={
          <button onClick={() => setNewTaskFor('TODO')} className="btn-accent">
            <Icon.Plus size={14} /> New task
          </button>
        }
      />

      <div className="flex items-end justify-between border-b border-line bg-paper/60 px-5 pt-4 pb-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="kbd font-mono uppercase">{project.key}</span>
            {project.description && (
              <span className="text-xs text-ink-muted">{project.description}</span>
            )}
          </div>
          <h1 className="font-display text-2xl font-semibold text-ink">
            {project.name}
          </h1>
        </div>
        <nav className="flex items-center gap-2">
          <ViewTab active={view === 'board'} onClick={() => setView('board')}>
            <Icon.Board size={14} /> Board
          </ViewTab>
          <ViewTab active={view === 'list'} onClick={() => setView('list')}>
            <Icon.List size={14} /> List
          </ViewTab>
          <ViewTab active={view === 'activity'} onClick={() => setView('activity')}>
            <Icon.Activity size={14} /> Activity
          </ViewTab>
        </nav>
      </div>

      {view !== 'activity' && (
        <Filters
          filters={filters}
          onChange={setFilters}
          users={users}
          labels={labels}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {view === 'board' && (
          <Board
            tasks={filteredTasks}
            projectKey={project.key}
            onOpen={(t) => setTaskId(t)}
            onMove={onMove}
            onQuickAdd={(s) => setNewTaskFor(s)}
          />
        )}
        {view === 'list' && (
          <TaskListView
            tasks={filteredTasks}
            projectKey={project.key}
            onOpen={(t) => setTaskId(t)}
          />
        )}
        {view === 'activity' && (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="mx-auto max-w-2xl rounded-lg border border-line bg-surface p-4 shadow-card">
              <ActivityFeed
                events={activities}
                users={users}
                labels={labels}
                showTaskRef
                projectKey={project.key}
                empty="No activity in this project yet."
              />
            </div>
          </div>
        )}
      </div>

      <TaskDrawer
        taskId={taskId}
        projectKey={project.key}
        users={users}
        labels={labels}
        onClose={() => setTaskId(null)}
        onChanged={() => {
          void reloadTasks();
          void reloadActivity();
        }}
        onLabelsChanged={() => void reloadCore()}
      />

      <NewTaskDialog
        open={newTaskFor !== null}
        onClose={() => setNewTaskFor(null)}
        defaultStatus={newTaskFor ?? 'TODO'}
        projectId={project.id}
        users={users}
        labels={labels}
        onCreated={() => {
          void reloadTasks();
          void reloadActivity();
        }}
      />
    </>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition',
        active
          ? 'bg-surface text-ink shadow-card ring-1 ring-line'
          : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
