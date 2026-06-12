import { useEffect, useState } from 'react';
import { projectsApi, usersApi } from '../../api/endpoints';
import type { ProjectMemberInfo, ProjectRole, UserLite } from '../../types';
import { Dialog } from '../../ui/Dialog';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { Spinner } from '../../ui/Spinner';
import { Popover, PopoverItem } from '../../ui/Popover';
import { useToast } from '../../ui/Toast';
import { apiError } from '../../lib/apiError';
import { cn } from '../../lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  ownerId: string;
  /** ADMIN+ on an open project: add/remove members and change roles. */
  canManage: boolean;
  onChanged?: () => void;
}

const ROLE_OPTIONS: { value: ProjectRole; label: string; hint: string }[] = [
  { value: 'VIEWER', label: 'Viewer', hint: 'Read & comment only' },
  { value: 'EDITOR', label: 'Editor', hint: 'Create & edit tasks' },
  { value: 'ADMIN', label: 'Admin', hint: 'Manage members & project' },
];

const ROLE_LABEL: Record<ProjectRole, string> = {
  VIEWER: 'Viewer',
  EDITOR: 'Editor',
  ADMIN: 'Admin',
};

export function ProjectMembersDialog({
  open,
  onClose,
  projectId,
  ownerId,
  canManage,
  onChanged,
}: Props) {
  const [members, setMembers] = useState<ProjectMemberInfo[]>([]);
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

  const owner = allUsers.find((u) => u.id === ownerId);
  const addable = allUsers.filter(
    (u) => u.id !== ownerId && !members.some((m) => m.id === u.id),
  );

  const onAdd = async (userId: string) => {
    try {
      // New people start as Editor — the everyday collaborator role; the
      // dropdown on their row changes it afterwards.
      const { data } = await projectsApi.addMember(projectId, userId);
      setMembers(data);
      onChanged?.();
      toast.push('Member added as Editor', 'success');
    } catch (err) {
      toast.push(apiError(err, 'Could not add member'), 'error');
    }
  };

  const onRole = async (memberId: string, role: ProjectRole) => {
    try {
      const { data } = await projectsApi.updateMemberRole(projectId, memberId, role);
      setMembers(data);
      onChanged?.();
    } catch (err) {
      toast.push(apiError(err, 'Could not change role'), 'error');
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
      description="Viewers read and comment, Editors work with tasks, Admins also manage members and the project itself. The owner is implicit and cannot be removed."
      width={480}
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
              People ({members.length + 1})
            </div>
            <ul className="space-y-1">
              {owner && (
                <li className="flex items-center gap-2.5 rounded-md bg-surface-deep px-3 py-2">
                  <Avatar
                    name={owner.name}
                    color={owner.avatarColor}
                    size="sm"
                    userId={owner.id}
                    avatarKey={owner.avatarKey}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{owner.name}</div>
                    <div className="truncate text-[11px] text-ink-subtle">
                      {owner.email}
                    </div>
                  </div>
                  <span className="chip bg-blurple-soft text-[#A8B0F8]">Owner</span>
                </li>
              )}
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2.5 rounded-md bg-surface-deep px-3 py-2"
                >
                  <Avatar
                    name={m.name}
                    color={m.avatarColor}
                    size="sm"
                    userId={m.id}
                    avatarKey={m.avatarKey}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{m.name}</div>
                    <div className="truncate text-[11px] text-ink-subtle">{m.email}</div>
                  </div>
                  {canManage ? (
                    <Popover
                      align="end"
                      trigger={({ toggle }) => (
                        <button
                          onClick={toggle}
                          className="btn-secondary h-7 px-2 text-xs"
                          aria-label={`Change role of ${m.name}`}
                        >
                          {ROLE_LABEL[m.role]}
                          <Icon.Caret size={10} />
                        </button>
                      )}
                    >
                      {(close) => (
                        <>
                          {ROLE_OPTIONS.map((r) => (
                            <PopoverItem
                              key={r.value}
                              active={m.role === r.value}
                              onClick={() => {
                                close();
                                if (m.role !== r.value) void onRole(m.id, r.value);
                              }}
                            >
                              <span className="flex flex-col">
                                <span>{r.label}</span>
                                <span className="text-[10px] text-ink-subtle">
                                  {r.hint}
                                </span>
                              </span>
                            </PopoverItem>
                          ))}
                        </>
                      )}
                    </Popover>
                  ) : (
                    <span
                      className={cn(
                        'chip',
                        m.role === 'ADMIN'
                          ? 'bg-chip-purple text-ink'
                          : 'bg-chip-gray text-ink-muted',
                      )}
                    >
                      {ROLE_LABEL[m.role]}
                    </span>
                  )}
                  {canManage && (
                    <button
                      onClick={() => void onRemove(m.id)}
                      className="btn-ghost h-7 px-2 text-xs"
                      aria-label={`Remove ${m.name}`}
                    >
                      <Icon.Trash size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {canManage && (
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
                      : 'Pick a user to invite (joins as Editor)'}
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
                        icon={
                          <Avatar
                            name={u.name}
                            color={u.avatarColor}
                            size="xs"
                            userId={u.id}
                            avatarKey={u.avatarKey}
                          />
                        }
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
          )}
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
