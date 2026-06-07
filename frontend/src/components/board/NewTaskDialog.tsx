import { FormEvent, useEffect, useState } from 'react';
import type { Label, TaskPriority, TaskStatus, UserLite } from '../../types';
import { Dialog } from '../../ui/Dialog';
import { Spinner } from '../../ui/Spinner';
import { Avatar } from '../../ui/Avatar';
import { LabelChip } from '../../ui/LabelChip';
import { Popover, PopoverItem } from '../../ui/Popover';
import { Icon } from '../../ui/Icon';
import { STATUS_META, STATUS_ORDER, PRIORITY_META, PRIORITY_ORDER } from '../../lib/meta';
import { tasksApi } from '../../api/endpoints';
import { useToast } from '../../ui/Toast';
import { cn } from '../../lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  defaultStatus: TaskStatus;
  users: UserLite[];
  labels: Label[];
  onCreated: () => void;
}

export function NewTaskDialog({
  open,
  onClose,
  projectId,
  defaultStatus,
  users,
  labels,
  onCreated,
}: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setStatus(defaultStatus);
      setTitle('');
      setDescription('');
      setPriority('MEDIUM');
      setAssigneeIds([]);
      setLabelIds([]);
    }
  }, [open, defaultStatus]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await tasksApi.create(projectId, {
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        assigneeIds: assigneeIds.length ? assigneeIds : undefined,
        labelIds: labelIds.length ? labelIds : undefined,
      });
      toast.push('Task created', 'success');
      onCreated();
      onClose();
    } catch {
      toast.push('Could not create task', 'error');
    } finally {
      setBusy(false);
    }
  }

  const selectedAssignees = users.filter((u) => assigneeIds.includes(u.id));
  const selectedLabels = labels.filter((l) => labelIds.includes(l.id));

  return (
    <Dialog open={open} onClose={onClose} title="New task" width={520}>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          autoFocus
          className="w-full rounded-md border-0 bg-transparent px-0 py-1 font-display text-xl font-medium text-ink placeholder:text-ink-subtle focus-visible:shadow-focus"
          placeholder="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          minLength={2}
        />
        <textarea
          className="input min-h-[100px] resize-y"
          placeholder="Add a description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Popover
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} className="btn-secondary h-7 px-2 text-xs">
                <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_META[status].dot)} />
                {STATUS_META[status].label}
                <Icon.Caret size={12} />
              </button>
            )}
          >
            {(close) =>
              STATUS_ORDER.map((s) => (
                <PopoverItem
                  key={s}
                  active={s === status}
                  onClick={() => {
                    setStatus(s);
                    close();
                  }}
                  icon={<span className={cn('h-1.5 w-1.5 rounded-full', STATUS_META[s].dot)} />}
                >
                  {STATUS_META[s].label}
                </PopoverItem>
              ))
            }
          </Popover>

          <Popover
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} className="btn-secondary h-7 px-2 text-xs">
                <Icon.Flag size={12} />
                {PRIORITY_META[priority].label}
              </button>
            )}
          >
            {(close) =>
              PRIORITY_ORDER.map((p) => (
                <PopoverItem
                  key={p}
                  active={p === priority}
                  onClick={() => {
                    setPriority(p);
                    close();
                  }}
                >
                  {PRIORITY_META[p].label}
                </PopoverItem>
              ))
            }
          </Popover>

          <Popover
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} className="btn-secondary h-7 px-2 text-xs">
                <Icon.User size={12} />
                {selectedAssignees.length === 0
                  ? 'Unassigned'
                  : selectedAssignees.length === 1
                    ? selectedAssignees[0].name
                    : `${selectedAssignees.length} assignees`}
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

          <Popover
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} className="btn-secondary h-7 px-2 text-xs">
                <Icon.Tag size={12} />
                {selectedLabels.length === 0
                  ? 'Labels'
                  : `${selectedLabels.length} label${selectedLabels.length > 1 ? 's' : ''}`}
              </button>
            )}
          >
            {() => (
              <>
                {labels.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-ink-subtle">No labels yet</div>
                )}
                {labels.map((l) => {
                  const active = labelIds.includes(l.id);
                  return (
                    <PopoverItem
                      key={l.id}
                      active={active}
                      onClick={() => {
                        setLabelIds((prev) =>
                          active ? prev.filter((x) => x !== l.id) : [...prev, l.id],
                        );
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
              </>
            )}
          </Popover>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="border-paper border-t-paper/40" />}
            Create task
          </button>
        </div>
      </form>
    </Dialog>
  );
}
