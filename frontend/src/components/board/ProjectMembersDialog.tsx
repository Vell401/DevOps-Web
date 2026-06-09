import { useEffect, useState } from 'react';
import { projectsApi, usersApi } from '../../api/endpoints';
import type { UserLite } from '../../types';
import { Dialog } from '../../ui/Dialog';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { Spinner } from '../../ui/Spinner';
import { Popover, PopoverItem } from '../../ui/Popover';
import { useToast } from '../../ui/Toast';
import { apiError } from '../../lib/apiError';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  ownerId: string;
  onChanged?: () => void;
}

export function ProjectMembersDialog({
  open,
  onClose,
  projectId,
  ownerId,
  onChanged,
}: Props) {
  const [members, setMembers] = useState<UserLite[]>([]);
  const [allUsers, setAllUsers] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const reload = async () => {
    setLoading(true);
    try {
      const [m, u] = await Promise.all([
        projectsApi.listMembers(projectId),
        usersApi.list(),
      ]);
      setMembers(m.data);
      setAllUsers(u.data);
    } catch {
      toast.push('Could not load members', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const addable = allUsers.filter(
    (u) => u.id !== ownerId && !members.some((m) => m.id === u.id),
  );

  const onAdd = async (userId: string) => {
    try {
      const { data } = await projectsApi.addMember(projectId, userId);
      setMembers(data);
      onChanged?.();
      toast.push('Member added', 'success');
    } catch (err) {
      toast.push(apiError(err, 'Could not add member'), 'error');
    }
  };

  const onRemove = async (userId: string) => {
    try {
      const { data } = await projectsApi.removeMember(projectId, userId);
      setMembers(data);
      onChanged?.();
      toast.push('Member removed', 'success');
    } catch (err) {
      toast.push(apiError(err, 'Could not remove member'), 'error');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Project members"
      description="People here can read the whole project and modify any task. The owner is implicit and cannot be removed."
      width={460}
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
              Members ({members.length})
            </div>
            <ul className="space-y-1">
              {members.length === 0 && (
                <li className="rounded-md bg-surface-deep px-3 py-2 text-xs text-ink-subtle">
                  No explicit members yet. Task assignees still have access.
                </li>
              )}
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2.5 rounded-md bg-surface-deep px-3 py-2"
                >
                  <Avatar name={m.name} color={m.avatarColor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{m.name}</div>
                    <div className="truncate text-[11px] text-ink-subtle">{m.email}</div>
                  </div>
                  <button
                    onClick={() => void onRemove(m.id)}
                    className="btn-ghost h-7 px-2 text-xs"
                    aria-label={`Remove ${m.name}`}
                  >
                    <Icon.Trash size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
              Add member
            </div>
            <Popover
              align="start"
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="btn-secondary h-8 w-full justify-start text-xs"
                  disabled={addable.length === 0}
                >
                  <Icon.Plus size={12} />
                  {addable.length === 0
                    ? 'Everyone is already in this project'
                    : 'Pick a user to invite'}
                </button>
              )}
            >
              {(close) => (
                <>
                  {addable.map((u) => (
                    <PopoverItem
                      key={u.id}
                      onClick={() => {
                        close();
                        void onAdd(u.id);
                      }}
                      icon={<Avatar name={u.name} color={u.avatarColor} size="xs" />}
                    >
                      <span className="flex flex-col">
                        <span>{u.name}</span>
                        <span className="text-[10px] text-ink-subtle">{u.email}</span>
                      </span>
                    </PopoverItem>
                  ))}
                </>
              )}
            </Popover>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end">
        <button onClick={onClose} className="btn-ghost text-xs">
          Done
        </button>
      </div>
    </Dialog>
  );
}
