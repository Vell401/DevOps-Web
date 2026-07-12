import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  Activity,
  Attachment,
  Comment,
  Label,
  Task,
  TaskStatus,
  UserLite,
} from '../../types';
import {
  attachmentsApi,
  commentsApi,
  labelsApi,
  tasksApi,
  type TaskBody,
} from '../../api/endpoints';
import { ModalShell } from '../../ui/ModalShell';
import { Avatar, AvatarStack } from '../../ui/Avatar';
import { LabelChip } from '../../ui/LabelChip';
import { Icon } from '../../ui/Icon';
import { Spinner } from '../../ui/Spinner';
import { AutoTextarea } from '../../ui/AutoTextarea';
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
import { apiError } from '../../lib/apiError';
import { mentionedIds, mentionQueryAt } from '../../lib/mentions';
import { MentionText } from '../../ui/MentionText';
import { cn } from '../../lib/cn';
import type { LabelColor } from '../../types';

interface Props {
  taskId: string | null;
  projectKey: string;
  users: UserLite[];
  labels: Label[];
  /** When false, all edits except status changes are visually disabled. */
  canEdit: boolean;
  /** Task deletion is ADMIN+/owner only — separate from everyday editing. */
  canDelete: boolean;
  /** Current viewer's user id — needed for "is this my comment?" checks. */
  currentUserId: string | undefined;
  /** When true, viewer can delete any comment (project ADMIN moderation). */
  canModerateComments: boolean;
  /** False once the project is closed: blocks comment edits for everyone. */
  projectOpen: boolean;
  /**
   * Bumped by the parent whenever a realtime comment event fires for this
   * project (add or delete). When the value changes we re-fetch the comments
   * list so the drawer stays in sync with other clients without F5.
   */
  liveCommentsKey: number;
  /** Any member with access can upload while the project is open. */
  canUpload: boolean;
  /** Bumped on realtime attachment-added/removed events for this project. */
  liveAttachmentsKey: number;
  onClose: () => void;
  onChanged: () => void;
  onLabelsChanged: () => void;
}

type Tab = 'overview' | 'comments' | 'activity' | 'files';

export function TaskDrawer({
  taskId,
  projectKey,
  users,
  labels,
  canEdit,
  canDelete,
  currentUserId,
  canModerateComments,
  projectOpen,
  liveCommentsKey,
  canUpload,
  liveAttachmentsKey,
  onClose,
  onChanged,
  onLabelsChanged,
}: Props) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [comments, setComments] = useState<Comment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const toast = useToast();

  const reload = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const [t, c, a, att] = await Promise.all([
        tasksApi.get(taskId),
        commentsApi.list(taskId),
        tasksApi.activity(taskId),
        attachmentsApi.list(taskId),
      ]);
      setTask(t.data);
      setComments(c.data);
      setActivities(a);
      setAttachments(att.data);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  // Lightweight refetch of just the task (e.g. after a subtask add/toggle) so
  // the drawer's subtasks list updates without re-pulling comments/files. The
  // PATCH response intentionally omits the subtasks array, so a no-op patch
  // would not surface a newly created subtask — we re-GET the task instead.
  const reloadTask = useCallback(async () => {
    if (!taskId) return;
    const t = await tasksApi.get(taskId);
    setTask(t.data);
  }, [taskId]);

  useEffect(() => {
    if (taskId) {
      setTab('overview');
      void reload();
    } else {
      setTask(null);
      setComments([]);
      setActivities([]);
      setAttachments([]);
    }
  }, [taskId, reload]);

  // Re-fetch comments whenever the parent bumps `liveCommentsKey` (i.e. a
  // realtime comment-added/comment-deleted event for this project fired). We
  // skip the very first render — the main `reload` effect above already fetched
  // them. Bumping the key from 0 → 1 → 2 etc triggers this.
  useEffect(() => {
    if (!taskId || liveCommentsKey === 0) return;
    let cancelled = false;
    void commentsApi.list(taskId).then((r) => {
      if (!cancelled) setComments(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, liveCommentsKey]);

  const onDeleteComment = useCallback(
    async (commentId: string) => {
      try {
        await commentsApi.remove(commentId);
        setComments((prev) => prev.filter((c) => c.id !== commentId));
      } catch {
        toast.push('Could not delete comment', 'error');
      }
    },
    [toast],
  );

  // Re-fetch attachments on realtime attachment events (same pattern as comments).
  useEffect(() => {
    if (!taskId || liveAttachmentsKey === 0) return;
    let cancelled = false;
    void attachmentsApi.list(taskId).then((r) => {
      if (!cancelled) setAttachments(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, liveAttachmentsKey]);

  const reloadAttachments = useCallback(async () => {
    if (!taskId) return;
    const r = await attachmentsApi.list(taskId);
    setAttachments(r.data);
  }, [taskId]);

  const onDeleteAttachment = useCallback(
    async (id: string) => {
      try {
        await attachmentsApi.remove(id);
        setAttachments((prev) => prev.filter((a) => a.id !== id));
      } catch {
        toast.push('Could not delete file', 'error');
      }
    },
    [toast],
  );

  const patch = useCallback(
    async (body: TaskBody) => {
      if (!taskId) return;
      try {
        const { data } = await tasksApi.update(taskId, body);
        setTask((prev) => (prev ? { ...prev, ...data } : data));
        const a = await tasksApi.activity(taskId);
        setActivities(a);
        onChanged();
      } catch (err) {
        toast.push(apiError(err, 'Could not update task'), 'error');
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
    } catch (err) {
      toast.push(apiError(err, 'Could not delete task'), 'error');
    }
  };

  return (
    <ModalShell open={taskId !== null} onClose={onClose} width={1100}>
      {loading && !task && (
        <div className="flex items-center justify-center px-6 py-16 text-sm text-ink-muted">
          <Spinner /> <span className="ml-2">Loading task…</span>
        </div>
      )}
      {task && (
        <div className="flex min-h-0 flex-1 flex-col">
          <DrawerHeader
            task={task}
            projectKey={projectKey}
            canDelete={canDelete}
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
            <TabBtn active={tab === 'files'} onClick={() => setTab('files')}>
              <Icon.Paperclip size={13} /> Files
              {attachments.length > 0 && (
                <span className="ml-1 font-mono text-[10px] text-ink-subtle">
                  {attachments.length}
                </span>
              )}
            </TabBtn>
            <TabBtn active={tab === 'activity'} onClick={() => setTab('activity')}>
              <Icon.Activity size={13} /> Activity
            </TabBtn>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
            {tab === 'overview' && (
              <OverviewTab
                task={task}
                users={users}
                labels={labels}
                canEdit={canEdit}
                onPatch={patch}
                onLabelsChanged={onLabelsChanged}
                onSubtasksChanged={async () => {
                  await reloadTask();
                  onChanged();
                }}
              />
            )}
            {tab === 'comments' && (
              <CommentsTab
                taskId={task.id}
                comments={comments}
                users={users}
                currentUserId={currentUserId}
                canModerateComments={canModerateComments}
                canEditOwn={projectOpen}
                canAttach={canUpload}
                onAdded={reload}
                onUpdated={(c) =>
                  setComments((prev) => prev.map((x) => (x.id === c.id ? c : x)))
                }
                onDeleteComment={onDeleteComment}
              />
            )}
            {tab === 'files' && (
              <AttachmentsTab
                taskId={task.id}
                attachments={attachments}
                canUpload={canUpload}
                canModerate={canModerateComments}
                currentUserId={currentUserId}
                onUploaded={reloadAttachments}
                onDelete={onDeleteAttachment}
              />
            )}
            {tab === 'activity' && (
              <ActivityFeed events={activities} users={users} labels={labels} />
            )}
          </div>

          <DrawerFooter task={task} />
        </div>
      )}
    </ModalShell>
  );
}

function DrawerHeader({
  task,
  projectKey,
  canDelete,
  onClose,
  onDelete,
}: {
  task: Task;
  projectKey: string;
  canDelete: boolean;
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
      {canDelete && (
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
  onSubtasksChanged,
}: {
  task: Task;
  users: UserLite[];
  labels: Label[];
  canEdit: boolean;
  onPatch: (body: TaskBody) => void;
  onLabelsChanged: () => void;
  onSubtasksChanged: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  // Local pending list of assignee ids — avoids a race when the user picks
  // several people in a row faster than the server can echo back.
  const [pendingAssignees, setPendingAssignees] = useState<string[] | null>(null);
  const [assigneeQuery, setAssigneeQuery] = useState('');
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
                  <button
                    onClick={() => {
                      setAssigneeQuery('');
                      toggle();
                    }}
                    className="input-flush flex w-full items-center justify-between gap-2 text-xs"
                  >
                    <AssigneesSummary assignees={visibleAssignees} />
                    <Icon.Caret size={12} className="text-ink-subtle" />
                  </button>
                )}
              >
                {() => {
                  const q = assigneeQuery.trim().toLowerCase();
                  const shown = q
                    ? users.filter(
                        (u) =>
                          u.name.toLowerCase().includes(q) ||
                          u.email.toLowerCase().includes(q),
                      )
                    : users;
                  return (
                    <div className="w-[240px]">
                      <div className="sticky top-0 z-10 bg-surface pb-1">
                        <input
                          autoFocus
                          value={assigneeQuery}
                          onChange={(e) => setAssigneeQuery(e.target.value)}
                          placeholder="Search people…"
                          className="w-full rounded-md bg-surface-sunken px-2 py-1.5 text-xs text-ink placeholder:text-ink-subtle focus-visible:shadow-focus"
                        />
                      </div>
                      <div className="max-h-[260px] overflow-y-auto scrollbar-thin">
                        {shown.length === 0 && (
                          <div className="px-2 py-1.5 text-xs text-ink-subtle">No matches</div>
                        )}
                        {shown.map((u) => {
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
                                <Avatar
                                  name={u.name}
                                  color={u.avatarColor}
                                  size="xs"
                                  userId={u.id}
                                  avatarKey={u.avatarKey}
                                />
                                {u.name}
                              </span>
                            </PopoverItem>
                          );
                        })}
                      </div>
                    </div>
                  );
                }}
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
        <AutoTextarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitDescription}
          readOnly={!canEdit}
          placeholder={canEdit ? 'Add more context about this task…' : 'No description'}
          className="input min-h-[120px] max-h-[55vh] bg-surface text-sm leading-relaxed"
        />
      </section>

      <SubtasksSection
        task={task}
        users={users}
        canEdit={canEdit}
        onChanged={onSubtasksChanged}
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
          userId={assignees[0].id}
          avatarKey={assignees[0].avatarKey}
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
  const [assigneeQuery, setAssigneeQuery] = useState('');
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
    } catch (err) {
      toast.push(apiError(err, 'Could not add subtask'), 'error');
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
                onClick={() => {
                  setAssigneeQuery('');
                  toggle();
                }}
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
            {() => {
              const q = assigneeQuery.trim().toLowerCase();
              const shown = q
                ? users.filter(
                    (u) =>
                      u.name.toLowerCase().includes(q) ||
                      u.email.toLowerCase().includes(q),
                  )
                : users;
              return (
                <div className="w-[240px]">
                  <div className="sticky top-0 z-10 bg-surface pb-1">
                    <input
                      autoFocus
                      value={assigneeQuery}
                      onChange={(e) => setAssigneeQuery(e.target.value)}
                      placeholder="Search people…"
                      className="w-full rounded-md bg-surface-sunken px-2 py-1.5 text-xs text-ink placeholder:text-ink-subtle focus-visible:shadow-focus"
                    />
                  </div>
                  <div className="max-h-[260px] overflow-y-auto scrollbar-thin">
                    {shown.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-ink-subtle">No matches</div>
                    )}
                    {shown.map((u) => {
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
                            <Avatar
                              name={u.name}
                              color={u.avatarColor}
                              size="xs"
                              userId={u.id}
                              avatarKey={u.avatarKey}
                            />
                            {u.name}
                          </span>
                        </PopoverItem>
                      );
                    })}
                  </div>
                </div>
              );
            }}
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
  users,
  currentUserId,
  canModerateComments,
  canEditOwn,
  canAttach,
  onAdded,
  onUpdated,
  onDeleteComment,
}: {
  taskId: string;
  comments: Comment[];
  users: UserLite[];
  currentUserId: string | undefined;
  canModerateComments: boolean;
  /** Authors may edit their own comments while the project is open. */
  canEditOwn: boolean;
  /** EDITOR+ on an open project: show the attach affordance. */
  canAttach: boolean;
  onAdded: () => void;
  onUpdated: (comment: Comment) => void;
  onDeleteComment: (commentId: string) => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  // Active "@query" under the caret (null = autocomplete closed) + the
  // keyboard-highlighted row of the dropdown.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  // Files uploaded from the composer, waiting to be linked on submit.
  const [staged, setStaged] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return users
      .filter(
        (u) =>
          !q ||
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [mention, users]);

  const syncMention = (el: HTMLTextAreaElement) => {
    setMention(mentionQueryAt(el.value, el.selectionStart ?? el.value.length));
    setActiveIdx(0);
  };

  const pick = (u: UserLite) => {
    if (!mention) return;
    const el = inputRef.current;
    const caret = el?.selectionStart ?? body.length;
    const inserted = `@${u.name} `;
    setBody(body.slice(0, mention.start) + inserted + body.slice(caret));
    setMention(null);
    // Re-focus and park the caret right after the inserted mention.
    const pos = mention.start + inserted.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const { data } = await attachmentsApi.upload(taskId, file);
        setStaged((prev) => [...prev, data]);
      }
    } catch (err) {
      toast.push(apiError(err, 'Could not upload file'), 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeStaged = async (att: Attachment) => {
    setStaged((prev) => prev.filter((a) => a.id !== att.id));
    try {
      await attachmentsApi.remove(att.id);
    } catch {
      /* already gone or no permission — the Files tab stays authoritative */
    }
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text && staged.length === 0) return;
    setBusy(true);
    try {
      // Mentions = users whose "@Name" survived editing until submit. The
      // server re-filters to actual project participants.
      await commentsApi.create(
        taskId,
        text || '📎',
        mentionedIds(text, users),
        staged.map((a) => a.id),
      );
      setBody('');
      setStaged([]);
      setMention(null);
      onAdded();
      toast.push('Comment posted', 'success');
    } catch (err) {
      toast.push(apiError(err, 'Could not post comment'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const startEdit = (c: Comment) => {
    setEditingId(c.id);
    setEditBody(c.body);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const text = editBody.trim();
    if (!text) return;
    setEditBusy(true);
    try {
      const { data } = await commentsApi.update(
        editingId,
        text,
        mentionedIds(text, users),
      );
      onUpdated(data);
      setEditingId(null);
    } catch (err) {
      toast.push(apiError(err, 'Could not edit comment'), 'error');
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="rounded-lg border border-line bg-surface p-2">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              syncMention(e.currentTarget);
            }}
            onClick={(e) => syncMention(e.currentTarget)}
            onKeyUp={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                syncMention(e.currentTarget);
              }
            }}
            placeholder="Write a comment… @ to mention"
            rows={3}
            className="w-full resize-none bg-transparent px-2 py-1 text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
            onKeyDown={(e) => {
              // While the @ dropdown is open, the keyboard drives it — plain
              // Enter picks; Cmd/Ctrl+Enter still always submits.
              if (mention && candidates.length && !e.metaKey && !e.ctrlKey) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveIdx((i) => (i + 1) % candidates.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveIdx((i) => (i - 1 + candidates.length) % candidates.length);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  pick(candidates[activeIdx]);
                  return;
                }
                if (e.key === 'Escape') {
                  setMention(null);
                  return;
                }
              }
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                void onSubmit(e as unknown as FormEvent);
              }
            }}
          />
          {mention && candidates.length > 0 && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-card">
              {candidates.map((u, i) => (
                <button
                  type="button"
                  key={u.id}
                  // mousedown (not click) so the textarea doesn't blur first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(u);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition',
                    i === activeIdx
                      ? 'bg-surface-hover text-ink'
                      : 'text-ink-muted',
                  )}
                >
                  <Avatar
                    name={u.name}
                    color={u.avatarColor}
                    size="xs"
                    userId={u.id}
                    avatarKey={u.avatarKey}
                  />
                  <span className="truncate">{u.name}</span>
                  <span className="ml-auto truncate text-[11px] text-ink-subtle">
                    {u.email}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {staged.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pb-2">
            {staged.map((a) => (
              <span
                key={a.id}
                className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border border-line bg-surface-deep px-2 py-1 text-[11px] text-ink-muted"
              >
                {isImageMime(a.mimeType) ? (
                  <Icon.Paperclip size={11} />
                ) : (
                  <Icon.File size={11} />
                )}
                <span className="truncate">{a.filename}</span>
                <button
                  type="button"
                  onClick={() => void removeStaged(a)}
                  aria-label={`Remove ${a.filename}`}
                  className="text-ink-subtle hover:text-ink"
                >
                  <Icon.Close size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-line pt-2">
          <div className="flex items-center gap-2">
            {canAttach && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => void onPickFiles(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="btn-ghost h-7 px-2 text-xs"
                  title="Attach files"
                >
                  {uploading ? <Spinner /> : <Icon.Paperclip size={13} />}
                </button>
              </>
            )}
            <span className="text-[11px] text-ink-subtle">
              @ to mention · Cmd/Ctrl + Enter to send
            </span>
          </div>
          <button
            type="submit"
            className="btn-primary h-7 px-2 text-xs"
            disabled={busy || uploading || (!body.trim() && staged.length === 0)}
          >
            {busy ? <Spinner className="border-paper border-t-paper/40" /> : 'Comment'}
          </button>
        </div>
      </form>
      {comments.length === 0 && (
        <p className="text-xs text-ink-subtle">No comments yet.</p>
      )}
      {/* Newest first: most recent comments sit directly under the input box. */}
      <ul className="space-y-2.5">
        {[...comments]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((c) => {
          // Author can always delete their own; project ADMIN can moderate any.
          const isMine = currentUserId !== undefined && c.authorId === currentUserId;
          const canDeleteComment = isMine || canModerateComments;
          const edited =
            new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime() > 2000;
          return (
            <li
              key={c.id}
              className="group rounded-lg border border-line bg-paper/60 p-3"
            >
              <div className="flex items-center gap-2">
                <Avatar
                  name={c.author?.name ?? '?'}
                  color={c.author?.avatarColor}
                  size="xs"
                  userId={c.author?.id}
                  avatarKey={c.author?.avatarKey}
                />
                <span className="text-xs font-medium text-ink">
                  {c.author?.name ?? 'Unknown'}
                </span>
                <span className="text-[11px] text-ink-subtle">
                  · {timeAgo(c.createdAt)}
                  {edited && <span title="Edited"> · edited</span>}
                </span>
                <span className="ml-auto flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                  {isMine && canEditOwn && editingId !== c.id && (
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      aria-label="Edit comment"
                      title="Edit comment"
                      className="rounded p-1 text-ink-subtle hover:bg-surface-hover hover:text-ink"
                    >
                      <Icon.Edit size={12} />
                    </button>
                  )}
                  {canDeleteComment && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm('Delete this comment?')) return;
                        void onDeleteComment(c.id);
                      }}
                      aria-label="Delete comment"
                      title="Delete comment"
                      className="rounded p-1 text-ink-subtle hover:bg-surface-hover hover:text-ink"
                    >
                      <Icon.Trash size={12} />
                    </button>
                  )}
                </span>
              </div>
              {editingId === c.id ? (
                <div className="mt-1.5 space-y-2">
                  <AutoTextarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="btn-ghost h-7 px-2 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveEdit()}
                      disabled={editBusy || !editBody.trim()}
                      className="btn-primary h-7 px-2 text-xs"
                    >
                      {editBusy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  <MentionText text={c.body} users={users} />
                </p>
              )}
              {c.attachments && c.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.attachments.map((a) => (
                    <CommentFile
                      key={a.id}
                      att={a}
                      onOpenImage={(url) => setLightbox({ url, name: a.filename })}
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {lightbox && (
        <Lightbox
          url={lightbox.url}
          name={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

/** Inline rendering of a comment's attachment: image thumb or file chip. */
function CommentFile({
  att,
  onOpenImage,
}: {
  att: Attachment;
  onOpenImage: (url: string) => void;
}) {
  const image = isImageMime(att.mimeType);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void attachmentsApi
      .download(att.id)
      .then((r) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(r.data);
        setUrl(objectUrl);
      })
      .catch(() => {
        /* leave as a chip; download below still works */
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [att.id, image]);

  if (image && url) {
    return (
      <button
        type="button"
        onClick={() => onOpenImage(url)}
        title={att.filename}
        className="overflow-hidden rounded-md border border-line"
      >
        <img src={url} alt={att.filename} className="h-24 w-36 object-cover" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void downloadAttachment(att)}
      title={`Download ${att.filename}`}
      className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-line bg-surface-deep px-2 py-1.5 text-[11px] text-ink-muted transition hover:text-ink"
    >
      {image ? <Spinner /> : <Icon.File size={12} />}
      <span className="truncate">{att.filename}</span>
      <span className="shrink-0 font-mono text-[10px] text-ink-subtle">
        {formatBytes(att.size)}
      </span>
      <Icon.Download size={11} className="shrink-0" />
    </button>
  );
}

/** Fetch the (auth-protected) bytes and trigger a browser download. */
async function downloadAttachment(att: Attachment): Promise<void> {
  try {
    const r = await attachmentsApi.download(att.id);
    const u = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = u;
    a.download = att.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(u);
  } catch {
    /* ignore */
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

function AttachmentsTab({
  taskId,
  attachments,
  canUpload,
  canModerate,
  currentUserId,
  onUploaded,
  onDelete,
}: {
  taskId: string;
  attachments: Attachment[];
  canUpload: boolean;
  canModerate: boolean;
  currentUserId: string | undefined;
  onUploaded: () => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(
    null,
  );
  const toast = useToast();

  const uploadFiles = async (files: FileList | null) => {
    if (!files || !files.length || busy) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        await attachmentsApi.upload(taskId, f);
      }
      await onUploaded();
    } catch {
      toast.push('Could not upload (file too large or storage error)', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {canUpload && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void uploadFiles(e.dataTransfer.files);
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-7 text-center transition',
            dragOver
              ? 'border-blurple bg-blurple/10'
              : 'border-line-strong hover:border-blurple hover:bg-surface/50',
          )}
        >
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {busy ? (
            <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
              <Spinner /> Uploading…
            </span>
          ) : (
            <>
              <Icon.Paperclip size={18} className="text-ink-subtle" />
              <span className="text-sm text-ink">
                Drop files here or click to upload
              </span>
              <span className="text-[11px] text-ink-subtle">Up to 25 MB each</span>
            </>
          )}
        </label>
      )}

      {attachments.length === 0 ? (
        <p className="text-xs text-ink-subtle">No files attached yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {attachments.map((a) => (
            <AttachmentCard
              key={a.id}
              att={a}
              canDelete={
                (a.uploaderId === currentUserId && canUpload) || canModerate
              }
              onOpenImage={(url) => setLightbox({ url, name: a.filename })}
              onDelete={() => {
                if (confirm('Delete this file?')) void onDelete(a.id);
              }}
            />
          ))}
        </ul>
      )}

      {lightbox && (
        <Lightbox
          url={lightbox.url}
          name={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function AttachmentCard({
  att,
  canDelete,
  onOpenImage,
  onDelete,
}: {
  att: Attachment;
  canDelete: boolean;
  onOpenImage: (url: string) => void;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const image = isImageMime(att.mimeType);

  // Images are private (served via the authenticated API), so fetch the bytes
  // and turn them into an object URL for the <img> thumbnail / lightbox.
  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void attachmentsApi
      .download(att.id)
      .then((r) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(r.data);
        setUrl(objectUrl);
      })
      .catch(() => {
        /* leave as a broken thumb; the download button still works */
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [att.id, image]);

  const download = async () => {
    try {
      const r = await attachmentsApi.download(att.id);
      const u = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = u;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(u);
    } catch {
      /* ignore */
    }
  };

  return (
    <li className="group relative overflow-hidden rounded-lg border border-line bg-paper/60">
      <div className="flex h-28 items-center justify-center bg-surface-deep">
        {image && url ? (
          <button
            type="button"
            onClick={() => onOpenImage(url)}
            className="h-full w-full"
          >
            <img
              src={url}
              alt={att.filename}
              className="h-full w-full object-cover"
            />
          </button>
        ) : image ? (
          <Spinner />
        ) : (
          <Icon.File size={26} className="text-ink-subtle" />
        )}
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span
          className="min-w-0 flex-1 truncate text-[11px] text-ink"
          title={att.filename}
        >
          {att.filename}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-ink-subtle">
          {formatBytes(att.size)}
        </span>
      </div>
      <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={() => void download()}
          title="Download"
          aria-label="Download"
          className="rounded bg-surface-deep/80 p-1 text-ink-muted hover:text-ink"
        >
          <Icon.Download size={13} />
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            title="Delete"
            aria-label="Delete file"
            className="rounded bg-surface-deep/80 p-1 text-ink-muted hover:text-status-dnd"
          >
            <Icon.Trash size={13} />
          </button>
        )}
      </div>
    </li>
  );
}

function Lightbox({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <img
        src={url}
        alt={name}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <Icon.Close size={18} />
      </button>
    </div>,
    document.body,
  );
}

