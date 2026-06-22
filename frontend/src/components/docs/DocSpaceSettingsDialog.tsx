import { useEffect, useState } from 'react';
import { docsApi, usersApi } from '../../api/endpoints';
import type { DocMemberInfo, DocRole, DocSpaceDetail, UserLite } from '../../types';
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
  space: DocSpaceDetail;
  onChanged: () => void;
  onDeleted: () => void;
}

const ROLE_OPTIONS: { value: DocRole; label: string; hint: string }[] = [
  { value: 'READER', label: 'Reader', hint: 'View only' },
  { value: 'WRITER', label: 'Writer', hint: 'View & edit pages' },
];
const ROLE_LABEL: Record<DocRole, string> = { READER: 'Reader', WRITER: 'Writer' };

export function DocSpaceSettingsDialog({ open, onClose, space, onChanged, onDeleted }: Props) {
  const toast = useToast();
  const canManage = space.myRole === 'OWNER';
  const [members, setMembers] = useState<DocMemberInfo[]>([]);
  const [allUsers, setAllUsers] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState(space.name);
  const [addQuery, setAddQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(space.name);
    let alive = true;
    setLoading(true);
    Promise.all([docsApi.listMembers(space.id), usersApi.list()])
      .then(([m, u]) => {
        if (alive) {
          setMembers(m.data);
          setAllUsers(u.data);
        }
      })
      .catch(() => alive && toast.push('Could not load members', 'error'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, space.id, space.name, toast]);

  const owner = space.owner;
  const addable = allUsers.filter(
    (u) => u.id !== space.ownerId && !members.some((m) => m.id === u.id),
  );

  const saveName = async () => {
    const n = name.trim();
    if (!n || n === space.name) return;
    try {
      await docsApi.updateSpace(space.id, { name: n });
      onChanged();
      toast.push('Renamed', 'success');
    } catch (err) {
      toast.push(apiError(err, 'Could not rename'), 'error');
    }
  };
  const onAdd = async (userId: string) => {
    try {
      const { data } = await docsApi.addMember(space.id, userId);
      setMembers(data);
      setAddQuery('');
      onChanged();
      toast.push('Member added as Writer', 'success');
    } catch (err) {
      toast.push(apiError(err, 'Could not add member'), 'error');
    }
  };
  const onRole = async (memberId: string, role: DocRole) => {
    try {
      const { data } = await docsApi.updateMember(space.id, memberId, role);
      setMembers(data);
    } catch (err) {
      toast.push(apiError(err, 'Could not change role'), 'error');
    }
  };
  const onRemove = async (memberId: string) => {
    try {
      const { data } = await docsApi.removeMember(space.id, memberId);
      setMembers(data);
      toast.push('Member removed', 'success');
    } catch (err) {
      toast.push(apiError(err, 'Could not remove member'), 'error');
    }
  };
  const onDelete = async () => {
    if (!confirm(`Delete the space "${space.name}" and all its pages? This cannot be undone.`)) {
      return;
    }
    try {
      await docsApi.deleteSpace(space.id);
      onDeleted();
    } catch (err) {
      toast.push(apiError(err, 'Could not delete space'), 'error');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Space settings"
      description="The creator invites people as Reader (view) or Writer (edit). The owner is implicit and can't be removed."
      width={480}
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> Loading…
        </div>
      ) : (
        <div className="space-y-4">
          {canManage && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                Name
              </span>
              <div className="flex gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input flex-1"
                  maxLength={120}
                />
                <button
                  onClick={() => void saveName()}
                  className="btn-secondary text-xs"
                  disabled={!name.trim() || name.trim() === space.name}
                >
                  Save
                </button>
              </div>
            </label>
          )}

          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
              People ({members.length + 1})
            </div>
            <ul className="space-y-1">
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
                  <div className="truncate text-[11px] text-ink-subtle">{owner.email}</div>
                </div>
                <span className="chip bg-blurple-soft text-[#A8B0F8]">Owner</span>
              </li>
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
                      portal
                      align="end"
                      trigger={({ toggle }) => (
                        <button onClick={toggle} className="btn-secondary h-7 px-2 text-xs">
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
                                <span className="text-[10px] text-ink-subtle">{r.hint}</span>
                              </span>
                            </PopoverItem>
                          ))}
                        </>
                      )}
                    </Popover>
                  ) : (
                    <span className="chip bg-chip-gray text-ink-muted">{ROLE_LABEL[m.role]}</span>
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
                portal
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
                      ? 'Everyone is already in this space'
                      : 'Invite a user (joins as Writer)'}
                  </button>
                )}
              >
                {(close) => {
                  const q = addQuery.trim().toLowerCase();
                  const shown = q
                    ? addable.filter(
                        (u) =>
                          u.name.toLowerCase().includes(q) ||
                          u.email.toLowerCase().includes(q),
                      )
                    : addable;
                  return (
                    <div className="w-[260px]">
                      <div className="sticky top-0 z-10 bg-surface pb-1">
                        <input
                          autoFocus
                          value={addQuery}
                          onChange={(e) => setAddQuery(e.target.value)}
                          placeholder="Search people…"
                          className="w-full rounded-md bg-surface-sunken px-2 py-1.5 text-xs text-ink placeholder:text-ink-subtle focus-visible:shadow-focus"
                        />
                      </div>
                      {shown.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-ink-subtle">No matches</div>
                      )}
                      {shown.map((u) => (
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
                    </div>
                  );
                }}
              </Popover>
            </div>
          )}

          {canManage && (
            <div className="border-t border-line pt-3">
              <button
                onClick={() => void onDelete()}
                className="btn-ghost text-xs text-[#883128] hover:bg-chip-red/40"
              >
                <Icon.Trash size={12} /> Delete space
              </button>
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
