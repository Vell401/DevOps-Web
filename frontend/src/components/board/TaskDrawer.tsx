import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Activity,
  Comment,
  Label,
  Task,
  TaskStatus,
  UserLite,
} from '../../types';
import {
  commentsApi,
  labelsApi,
  tasksApi,
  type TaskBody,
} from '../../api/endpoints';
import { Drawer } from '../../ui/Drawer';
import { Avatar, AvatarStack } from '../../ui/Avatar';
import { LabelChip } from '../../ui/LabelChip';
import { Icon } from '../../ui/Icon';
import { Spinner } from '../../ui/Spinner';
import { Popover, PopoverItem } from '../../ui/Popover';
import { StatusBadge } from '../../ui/StatusBadge';
import { PriorityFlag } from '../../ui/PriorityFlag';
import { useToast } from '../../ui/Toast';
import { ActivityFeed } from './ActivityFeed';
import {
  LABEL_COLORS,
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  STATUS_ORDER,
} from '../../lib/meta';
import { timeAgo, toIsoDateInput } from '../../lib/format';
import { cn } from '../../lib/cn';
import type { LabelColor } from '../../types';

interface Props {
  taskId: string | null;
  projectKey: string;
  users: UserLite[];
  labels: Label[];
  /** When false, all edits except status changes are visually disabled. */
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
  onLabelsChanged: () => void;
}

type Tab = 'overview' | 'comments' | 'activity';

export function TaskDrawer({
  taskId,
  projectKey,
  users,
  labels,
  canEdit,
  onClose,
  onChanged,
  onLabelsChanged,
}: Props) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [comments, setComments] = useState<Comment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const toast = useToast();

  const reload = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const [t, c, a] = await Promise.all([
        tasksApi.get(taskId),
        commentsApi.list(taskId),
        tasksApi.activity(taskId),
      ]);
      setTask(t.data);
      setComments(c.data);
      setActivities(a.data);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (taskId) {
      setTab('overview');
      void reload();
    } else {
      setTask(null);
      setComments([]);
      setActivities([]);
    }
  }, [taskId, reload]);

  const patch = useCallback(
    async (body: TaskBody) => {
      if (!taskId) return;
      try {
        const { data } = await tasksApi.update(taskId, body);
        setTask((prev) => (prev ? { ...prev, ...data } : data));
        const a = await tasksApi.activity(taskId);
        setActivities(a.data);
        onChanged();
      } catch {
        toast.push('Could not update task', 'error');
      }
    },
    [taskId, onChanged, toast],
  );

  const onDelete = async () => {
    if (!task) return;
    if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    try {
      await tasksApi.remove(task.id);
      toast.push('Task deleted', 'success');
      onChanged();
      onClose();
    } catch {
      toast.push('Could not delete task', 'error');
    }
  };

  return (
    <Drawer open={taskId !== null} onClose={onClose} width={560}>
      {loading && !task && (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-muted">
          <Spinner /> <span className="ml-2">Loading task…</span>
        </div>
      )}
      {task && (
        <div className="flex h-full flex-col">
          <DrawerHeader
            task={task}
            projectKey={projectKey}
            canEdit={canEdit}
            onClose={onClose}
            onDelete={onDelete}
          />

          <div className="flex items-center gap-3 border-b border-line px-5">
            <TabBtn active={tab === 'overview'} onClick={() => setTab('overview')}>
              <Icon.Layers size={13} /> Overview
            </TabBtn>
            <TabBtn active={tab === 'comments'} onClick={() => setTab('comments')}>
              <Icon.Activity size={13} /> Comments
              {comments.length > 0 && (
                <span className="ml-1 font-mono text-[10px] text-ink-subtle">
                  {comments.length}
                </span>
              )}
            </TabBtn>
            <TabBtn active={tab === 'activity'} onClick={() => setTab('activity')}>
              <Icon.Activity size={13} /> Activity
            </TabBtn>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
            {tab === 'overview' && (
              <OverviewTab
                task={task}
                users={users}
                labels={labels}
                canEdit={canEdit}
                onPatch={patch}
                onLabelsChanged={onLabelsChanged}
              />
            )}
            {tab === 'comments' && (
              <CommentsTab
                taskId={task.id}
                comments={comments}
                onAdded={reload}
              />
            )}
            {tab === 'activity' && (
              <ActivityFeed events={activities} users={users} labels={labels} />
            )}
          </div>

          <DrawerFooter task={task} />
        </div>
      )}
    </Drawer>
  );
}

function DrawerHeader({
  task,
  projectKey,
  canEdit,
  onClose,
  onDelete,
}: {
  task: Task;
  projectKey: string;
  canEdit: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-5 py-3">
      <span className="kbd font-mono uppercase">
        {projectKey}-{task.number}
      </span>
      <StatusBadge status={task.status} />
      <div className="flex-1" />
      {canEdit && (
        <Popover
          align="end"
          trigger={({ toggle }) => (
            <button
              onClick={toggle}
              className="rounded-sm p-1 text-ink-muted hover:bg-surface-sunken hover:text-ink"
              aria-label="Task menu"
            >
              <Icon.Dots size={16} />
            </button>
          )}
        >
          {(close) => (
            <PopoverItem
              danger
              icon={<Icon.Trash size={13} />}
              onClick={() => {
                close();
                onDelete();
              }}
            >
              Delete task
            </PopoverItem>
          )}
        </Popover>
      )}
      <button
        onClick={onClose}
        className="rounded-sm p-1 text-ink-muted hover:bg-surface-sunken hover:text-ink"
        aria-label="Close drawer"
      >
        <Icon.Close size={16} />
      </button>
    </div>
  );
}

function DrawerFooter({ task }: { task: Task }) {
  return (
    <div className="border-t border-line bg-paper/70 px-5 py-2 text-[11px] text-ink-subtle">
      Created {timeAgo(task.createdAt)} · Updated {timeAgo(task.updatedAt)}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className={cn('tab', active && 'tab-active')}>
      {children}
    </button>
  );
}

function OverviewTab({
  task,
  users,
  labels,
  canEdit,
  onPatch,
  onLabelsChanged,
}: {
  task: Task;
  users: UserLite[];
  labels: Label[];
  canEdit: boolean;
  onPatch: (body: TaskBody) => void;
  onLabelsChanged: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  // Local pending list of assignee ids — avoids a race when the user picks
  // several people in a row faster than the server can echo back.
  const [pendingAssignees, setPendingAssignees] = useState<string[] | null>(null);
  const effectiveAssigneeIds = pendingAssignees ?? task.assignees.map((a) => a.id);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setPendingAssignees(null);
  }, [task.id, task.title, task.description]);

  // Sync pending → server confirmed once they match (or the drawer switches tasks).
  useEffect(() => {
    if (!pendingAssignees) return;
    const serverIds = new Set(task.assignees.map((a) => a.id));
    const pendingIds = new Set(pendingAssignees);
    if (
      pendingIds.size === serverIds.size &&
      [...pendingIds].every((id) => serverIds.has(id))
    ) {
      setPendingAssignees(null);
    }
  }, [task.assignees, pendingAssignees]);

  const commitTitle = () => {
    if (!canEdit) return;
    const next = title.trim();
    if (next && next !== task.title) onPatch({ title: next });
  };
  const commitDescription = () => {
    if (!canEdit) return;
    const next = description.trim();
    if ((task.description ?? '') !== next) onPatch({ description: next || null });
  };

  const toggleAssignee = (uid: string) => {
    const cur = effectiveAssigneeIds;
    const active = cur.includes(uid);
    const next = active ? cur.filter((x) => x !== uid) : [...cur, uid];
    setPendingAssignees(next);
    onPatch({ assigneeIds: next });
  };

  const assigneeSet = new Set(effectiveAssigneeIds);
  const visibleAssignees = users.filter((u) => assigneeSet.has(u.id));

  return (
    <div className="space-y-5">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        readOnly={!canEdit}
        className={cn(
          'w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 font-display text-2xl font-semibold leading-tight text-ink placeholder:text-ink-subtle',
          canEdit
            ? 'hover:border-line focus:border-ink-muted focus-visible:shadow-focus'
            : 'cursor-default',
        )}
        placeholder="Task title"
      />

      <div className="rounded-md border border-line bg-paper/40 px-3 py-2.5">
        <div className="grid grid-cols-3 gap-y-2 text-xs text-ink-muted">
          <FieldRow label="Status">
            <Popover
              trigger={({ toggle }) => (
                <button onClick={toggle} className="input-flush flex w-full items-center justify-between gap-2 text-xs">
                  <StatusBadge status={task.status} variant="inline" />
                  <Icon.Caret size={12} className="text-ink-subtle" />
                </button>
              )}
            >
              {(close) =>
                STATUS_ORDER.map((s) => (
                  <PopoverItem
                    key={s}
                    active={s === task.status}
                    onClick={() => {
                      if (s !== task.status) onPatch({ status: s });
                      close();
                    }}
                    icon={<span className={cn('h-1.5 w-1.5 rounded-full', STATUS_META[s].dot)} />}
                  >
                    {STATUS_META[s].label}
                  </PopoverItem>
                ))
              }
            </Popover>
          </FieldRow>

          <FieldRow label="Priority">
            {canEdit ? (
              <Popover
                trigger={({ toggle }) => (
                  <button onClick={toggle} className="input-flush flex w-full items-center justify-between gap-2 text-xs">
                    <PriorityFlag priority={task.priority} />
                    <Icon.Caret size={12} className="text-ink-subtle" />
                  </button>
                )}
              >
                {(close) =>
                  PRIORITY_ORDER.map((p) => (
                    <PopoverItem
                      key={p}
                      active={p === task.priority}
                      onClick={() => {
                        if (p !== task.priority) onPatch({ priority: p });
                        close();
                      }}
                    >
                      {PRIORITY_META[p].label}
                    </PopoverItem>
                  ))
                }
              </Popover>
            ) : (
              <div className="px-2 py-1.5">
                <PriorityFlag priority={task.priority} />
              </div>
            )}
          </FieldRow>

          <FieldRow label="Assignees">
            {canEdit ? (
              <Popover
                trigger={({ toggle }) => (
                  <button onClick={toggle} className="input-flush flex w-full items-center justify-between gap-2 text-xs">
                    <AssigneesSummary assignees={visibleAssignees} />
                    <Icon.Caret size={12} className="text-ink-subtle" />
                  </button>
                )}
              >
                {() => (
                  <>
                    {users.map((u) => {
                      const active = assigneeSet.has(u.id);
                      return (
                        <PopoverItem
                          key={u.id}
                          active={active}
                          onClick={() => toggleAssignee(u.id)}
                          icon={
                            <span className="inline-flex h-4 w-4 items-center justify-center">
                              {active ? <Icon.Check size={12} /> : null}
                            </span>
                          }
                        >
                          <span className="flex items-center gap-2">
                            <Avatar name={u.name} color={u.avatarColor} size="xs" />
                            {u.name}
                          </span>
                        </PopoverItem>
                      );
                    })}
                  </>
                )}
              </Popover>
            ) : (
              <div className="px-2 py-1.5">
                <AssigneesSummary assignees={visibleAssignees} />
              </div>
            )}
          </FieldRow>

          <FieldRow label="Due date">
            <input
              type="date"
              value={toIsoDateInput(task.dueDate)}
              onChange={(e) => {
                const v = e.target.value;
                onPatch({ dueDate: v ? new Date(v).toISOString() : null });
              }}
              readOnly={!canEdit}
              disabled={!canEdit}
              className={cn('input-flush text-xs', !canEdit && 'cursor-default opacity-70')}
            />
          </FieldRow>

          <FieldRow label="Labels" full>
            <LabelsPicker
              projectId={task.projectId}
              labels={labels}
              selected={task.labels}
              canEdit={canEdit}
              onChange={(ids) => onPatch({ labelIds: ids })}
              onLabelsChanged={onLabelsChanged}
            />
          </FieldRow>
        </div>
      </div>

      <section>
        <SectionTitle>Description</SectionTitle>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitDescription}
          readOnly={!canEdit}
          placeholder={canEdit ? 'Add more context about this task…' : 'No description'}
          className="input min-h-[120px] resize-y bg-surface text-sm leading-relaxed"
        />
      </section>

      <SubtasksSection
        task={task}
        users={users}
        canEdit={canEdit}
        onChanged={() => onPatch({})}
      />
    </div>
  );
}

function AssigneesSummary({ assignees }: { assignees: UserLite[] }) {
  if (assignees.length === 0) {
    return <span className="text-ink-subtle">Unassigned</span>;
  }
  if (assignees.length === 1) {
    return (
      <span className="flex items-center gap-2 truncate">
        <Avatar
          name={assignees[0].name}
          color={assignees[0].avatarColor}
          size="xs"
        />
        <span className="truncate text-ink">{assignees[0].name}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 truncate">
      <AvatarStack users={assignees} max={4} size="xs" />
      <span className="text-ink">{assignees.length} assignees</span>
    </span>
  );
}

function FieldRow({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className={cn('col-span-1 self-center text-ink-subtle')}>{label}</div>
      <div className={cn(full ? 'col-span-2' : 'col-span-2', 'min-w-0 self-center')}>
        {children}
      </div>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
      {children}
    </h4>
  );
}

function LabelsPicker({
  projectId,
  labels,
  selected,
  canEdit,
  onChange,
  onLabelsChanged,
}: {
  projectId: string;
  labels: Label[];
  selected: Label[];
  canEdit: boolean;
  onChange: (ids: string[]) => void;
  onLabelsChanged: () => void;
}) {
  const selectedIds = useMemo(() => new Set(selected.map((l) => l.id)), [selected]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<LabelColor>('GRAY');
  const toast = useToast();

  async function createLabel(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const { data } = await labelsApi.create(projectId, name, newColor);
      setNewName('');
      onChange([...selected.map((l) => l.id), data.id]);
      onLabelsChanged();
    } catch {
      toast.push('Could not create label', 'error');
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {selected.length === 0 && (
          <span className="text-xs text-ink-subtle">No labels</span>
        )}
        {selected.map((l) => (
          <LabelChip
            key={l.id}
            label={l}
            onRemove={
              canEdit
                ? () => onChange(selected.filter((x) => x.id !== l.id).map((x) => x.id))
                : undefined
            }
          />
        ))}
        {canEdit && (
        <Popover
          trigger={({ toggle }) => (
            <button
              type="button"
              onClick={toggle}
              className="chip border border-dashed border-line-strong text-ink-muted hover:border-ink-muted hover:text-ink"
            >
              <Icon.Plus size={10} /> Add
            </button>
          )}
        >
          {() => (
            <>
              {labels.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-ink-subtle">No labels yet</div>
              )}
              {labels.map((l) => {
                const active = selectedIds.has(l.id);
                return (
                  <PopoverItem
                    key={l.id}
                    active={active}
                    onClick={() => {
                      if (active) {
                        onChange(selected.filter((x) => x.id !== l.id).map((x) => x.id));
                      } else {
                        onChange([...selected.map((x) => x.id), l.id]);
                      }
                    }}
                    icon={
                      <span className="inline-flex h-4 w-4 items-center justify-center">
                        {active ? <Icon.Check size={12} /> : null}
                      </span>
                    }
                  >
                    <LabelChip label={l} />
                  </PopoverItem>
                );
              })}
              <hr className="my-1 border-line" />
              <form onSubmit={createLabel} className="space-y-1.5 p-1.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                  Create new
                </div>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Label name"
                  className="input h-7 px-2 text-xs"
                />
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(LABEL_COLORS) as LabelColor[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewColor(c)}
                      className={cn(
                        'h-5 w-5 rounded-full ring-2 ring-transparent transition',
                        LABEL_COLORS[c].dot,
                        newColor === c && 'ring-ink',
                      )}
                      aria-label={c}
                    />
                  ))}
                </div>
                <button type="submit" className="btn-primary h-7 w-full px-2 text-xs">
                  Create label
                </button>
              </form>
            </>
          )}
        </Popover>
        )}
      </div>
    </div>
  );
}

function SubtasksSection({
  task,
  users,
  canEdit,
  onChanged,
}: {
  task: Task;
  users: UserLite[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    try {
      await tasksApi.create(task.projectId, {
        title: t,
        parentId: task.id,
        assigneeIds: assigneeIds.length ? assigneeIds : undefined,
      });
      setTitle('');
      setAssigneeIds([]);
      setAddOpen(false);
      onChanged();
      toast.push('Subtask added', 'success');
    } catch {
      toast.push('Could not add subtask', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleSubtask(sub: Task) {
    const next: TaskStatus = sub.status === 'DONE' ? 'TODO' : 'DONE';
    try {
      await tasksApi.update(sub.id, { status: next });
      onChanged();
    } catch {
      toast.push('Could not update subtask', 'error');
    }
  }

  const subtasks = task.subtasks ?? [];
  const done = subtasks.filter((s) => s.status === 'DONE').length;

  return (
    <section>
      <SectionTitle>
        Subtasks
        {subtasks.length > 0 && (
          <span className="ml-2 font-mono text-[10px] text-ink-subtle">
            {done}/{subtasks.length}
          </span>
        )}
      </SectionTitle>
      <ul className="space-y-1">
        {subtasks.map((sub) => (
          <li
            key={sub.id}
            className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-surface-sunken"
          >
            <button
              onClick={() => toggleSubtask(sub)}
              aria-label="Toggle done"
              className={cn(
                'grid h-4 w-4 place-items-center rounded-sm border transition',
                sub.status === 'DONE'
                  ? 'border-leaf-400 bg-leaf-400 text-paper'
                  : 'border-line-strong bg-surface hover:border-ink-muted',
              )}
              title="Toggle done"
            >
              {sub.status === 'DONE' && <Icon.Check size={10} />}
            </button>
            <span
              className={cn(
                'flex-1 text-sm',
                sub.status === 'DONE'
                  ? 'text-ink-subtle line-through'
                  : 'text-ink',
              )}
            >
              {sub.title}
            </span>
            {sub.assignees.length > 0 && (
              <AvatarStack users={sub.assignees} max={3} size="xs" />
            )}
            <StatusBadge status={sub.status} variant="inline" />
          </li>
        ))}
        {subtasks.length === 0 && !addOpen && (
          <li className="text-xs text-ink-subtle">No subtasks yet.</li>
        )}
      </ul>
      {addOpen ? (
        <form
          onSubmit={onAdd}
          className="mt-2 flex items-center gap-2 rounded-md border border-line bg-surface p-2"
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Subtask title"
            className="input h-7 flex-1 px-2 text-xs"
          />
          <Popover
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                className="btn-secondary h-7 px-2 text-xs"
                title="Assignees"
              >
                <Icon.User size={12} />
                {assigneeIds.length === 0
                  ? '—'
                  : assigneeIds.length === 1
                    ? users.find((u) => u.id === assigneeIds[0])?.name?.split(' ')[0] ?? '—'
                    : `${assigneeIds.length}`}
              </button>
            )}
          >
            {() => (
              <>
                {users.map((u) => {
                  const active = assigneeIds.includes(u.id);
                  return (
                    <PopoverItem
                      key={u.id}
                      active={active}
                      onClick={() =>
                        setAssigneeIds((prev) =>
                          active ? prev.filter((x) => x !== u.id) : [...prev, u.id],
                        )
                      }
                      icon={
                        <span className="inline-flex h-4 w-4 items-center justify-center">
                          {active ? <Icon.Check size={12} /> : null}
                        </span>
                      }
                    >
                      <span className="flex items-center gap-2">
                        <Avatar name={u.name} color={u.avatarColor} size="xs" />
                        {u.name}
                      </span>
                    </PopoverItem>
                  );
                })}
              </>
            )}
          </Popover>
          <button type="submit" className="btn-primary h-7 px-2 text-xs" disabled={busy}>
            {busy ? <Spinner /> : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(false)}
            className="btn-ghost h-7 px-2 text-xs"
          >
            ×
          </button>
        </form>
      ) : (
        canEdit && (
          <button
            onClick={() => setAddOpen(true)}
            className="mt-2 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
          >
            <Icon.Plus size={12} /> Add subtask
          </button>
        )
      )}
    </section>
  );
}

function CommentsTab({
  taskId,
  comments,
  onAdded,
}: {
  taskId: string;
  comments: Comment[];
  onAdded: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      await commentsApi.create(taskId, text);
      setBody('');
      onAdded();
    } catch {
      toast.push('Could not post comment', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {comments.length === 0 && (
        <p className="text-xs text-ink-subtle">No comments yet.</p>
      )}
      <ul className="space-y-2.5">
        {comments.map((c) => (
          <li
            key={c.id}
            className="rounded-lg border border-line bg-paper/60 p-3"
          >
            <div className="flex items-center gap-2">
              <Avatar
                name={c.author?.name ?? '?'}
                color={c.author?.avatarColor}
                size="xs"
              />
              <span className="text-xs font-medium text-ink">
                {c.author?.name ?? 'Unknown'}
              </span>
              <span className="text-[11px] text-ink-subtle">
                · {timeAgo(c.createdAt)}
              </span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {c.body}
            </p>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="rounded-lg border border-line bg-surface p-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment… (Cmd/Ctrl+Enter to send)"
          rows={3}
          className="w-full resize-none bg-transparent px-2 py-1 text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              void onSubmit(e as unknown as FormEvent);
            }
          }}
        />
        <div className="flex items-center justify-between border-t border-line pt-2">
          <span className="text-[11px] text-ink-subtle">
            Markdown coming soon · Cmd/Ctrl + Enter to send
          </span>
          <button type="submit" className="btn-primary h-7 px-2 text-xs" disabled={busy || !body.trim()}>
            {busy ? <Spinner className="border-paper border-t-paper/40" /> : 'Comment'}
          </button>
        </div>
      </form>
    </div>
  );
}

