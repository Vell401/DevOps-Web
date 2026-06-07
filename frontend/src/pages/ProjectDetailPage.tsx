import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import {
  labelsApi,
  projectsApi,
  tasksApi,
  usersApi,
} from '../api/endpoints';
import type {
  Label,
  Project,
  Task,
  TaskStatus,
  UserLite,
} from '../types';
import { Topbar } from '../components/Topbar';
import { Board } from '../components/board/Board';
import { TaskListView } from '../components/board/TaskListView';
import { ActivityDashboard } from '../components/board/ActivityDashboard';
import { Filters, type FilterState } from '../components/board/Filters';
import { TaskDrawer } from '../components/board/TaskDrawer';
import { NewTaskDialog } from '../components/board/NewTaskDialog';
import { ProjectMembersDialog } from '../components/board/ProjectMembersDialog';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { Popover, PopoverItem } from '../ui/Popover';
import { timeAgo } from '../lib/format';
import { useProjectRealtime, useUserRealtime } from '../lib/realtime';
import { useAuth } from '../auth/AuthContext';
import { cn } from '../lib/cn';
import type { LayoutContext } from '../components/Layout';

type View = 'board' | 'list' | 'activity';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { reloadProjects } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [activityVersion, setActivityVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [closeBusy, setCloseBusy] = useState(false);
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
  const [membersOpen, setMembersOpen] = useState(false);
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

  const bumpActivity = useCallback(() => setActivityVersion((v) => v + 1), []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([reloadCore(), reloadTasks()])
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
      bumpActivity();
    } catch {
      toast.push('Could not move task', 'error');
      setTasks((prev) =>
        prev.map((t) => (t.id === taskIdToMove ? { ...t, status: before.status } : t)),
      );
    }
  };

  const onCloseProject = async () => {
    if (!project) return;
    if (!confirm(`Close "${project.name}"? It will be moved to the Closed section.`)) {
      return;
    }
    setCloseBusy(true);
    try {
      const { data } = await projectsApi.close(project.id);
      setProject(data);
      toast.push('Project closed', 'success');
      reloadProjects();
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
        'Could not close project';
      toast.push(msg, 'error');
    } finally {
      setCloseBusy(false);
    }
  };

  const onReopenProject = async () => {
    if (!project) return;
    try {
      const { data } = await projectsApi.reopen(project.id);
      setProject(data);
      toast.push('Project reopened', 'success');
      reloadProjects();
    } catch {
      toast.push('Could not reopen project', 'error');
    }
  };

  const unfinishedCount = tasks.filter((t) => t.status !== 'DONE' && !t.parentId).length;
  const canClose = unfinishedCount === 0 && tasks.length > 0;
  const isClosed = !!project?.closedAt;
  const isOwner = !!project && project.ownerId === user?.id;

  // Realtime: merge incoming task changes from other clients into local state
  // and bump activity so the dashboard refreshes.
  useProjectRealtime(project?.id, {
    'task-upserted': (incoming) => {
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === incoming.id);
        if (idx === -1) return [...prev, incoming];
        const next = [...prev];
        next[idx] = { ...next[idx], ...incoming };
        return next;
      });
      bumpActivity();
    },
    'task-deleted': ({ taskId }) => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      bumpActivity();
    },
    'comment-added': () => {
      bumpActivity();
    },
  });

  // Realtime: when project state changes (auto-close, manual close/reopen, or
  // an assignment that doesn't go through this view), re-fetch project core so
  // the banner / "Close project" button reflects reality without a refresh.
  useUserRealtime({
    'projects-changed': () => {
      void reloadCore();
    },
  });

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
          <>
            {!isClosed && isOwner && (
              <button onClick={() => setNewTaskFor('TODO')} className="btn-primary">
                <Icon.Plus size={14} /> New task
              </button>
            )}
            {isOwner && (
              <Popover
                align="end"
                trigger={({ toggle }) => (
                  <button
                    onClick={toggle}
                    className="btn-secondary h-8 w-8 px-0"
                    aria-label="Project menu"
                  >
                    <Icon.Dots size={14} />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <PopoverItem
                      icon={<Icon.User size={13} />}
                      onClick={() => {
                        close();
                        setMembersOpen(true);
                      }}
                    >
                      Manage members
                    </PopoverItem>
                    <hr className="my-1 border-line" />
                    {isClosed ? (
                      <PopoverItem
                        icon={<Icon.ArrowLeft size={13} />}
                        onClick={() => {
                          close();
                          void onReopenProject();
                        }}
                      >
                        Reopen project
                      </PopoverItem>
                    ) : (
                      <PopoverItem
                        icon={<Icon.Check size={13} />}
                        onClick={() => {
                          close();
                          if (canClose) void onCloseProject();
                        }}
                      >
                        <span className={cn(!canClose && 'text-ink-subtle')}>
                          Close project
                          {!canClose && (
                            <span className="ml-2 text-[11px] text-ink-subtle">
                              {tasks.length === 0
                                ? '· no tasks'
                                : `· ${unfinishedCount} unfinished`}
                            </span>
                          )}
                        </span>
                      </PopoverItem>
                    )}
                  </>
                )}
              </Popover>
            )}
          </>
        }
      />

      {isClosed && (
        <div className="flex items-center gap-3 border-b border-status-idle/30 bg-status-idle/10 px-5 py-2.5 text-sm">
          <Icon.Sparkle size={14} className="text-status-idle" />
          <span className="flex-1 text-ink">
            This project was closed {project.closedAt ? timeAgo(project.closedAt) : ''}.
            <span className="ml-1 text-ink-muted">
              {isOwner ? 'Reopen to make changes.' : 'Only the owner can reopen.'}
            </span>
          </span>
          {isOwner && (
            <button
              onClick={() => void onReopenProject()}
              className="btn-ghost h-7 px-2 text-xs"
            >
              Reopen
            </button>
          )}
        </div>
      )}

      <div className="flex items-end justify-between border-b border-line bg-paper/60 px-5 pt-4 pb-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
              {project.key}
            </span>
            {project.description && (
              <span className="text-xs text-ink-muted">{project.description}</span>
            )}
            {closeBusy && <Spinner />}
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
          <ActivityDashboard
            projectId={project.id}
            projectKey={project.key}
            users={users}
            labels={labels}
            version={activityVersion}
          />
        )}
      </div>

      <TaskDrawer
        taskId={taskId}
        projectKey={project.key}
        users={users}
        labels={labels}
        canEdit={isOwner && !isClosed}
        onClose={() => setTaskId(null)}
        onChanged={() => {
          void reloadTasks();
          bumpActivity();
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
          bumpActivity();
        }}
      />

      <ProjectMembersDialog
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        projectId={project.id}
        ownerId={project.ownerId}
        onChanged={reloadProjects}
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
