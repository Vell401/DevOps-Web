import { FormEvent, useRef, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../ui/Toast';
import { authApi, usersApi } from '../api/endpoints';
import { tokenStorage } from '../api/client';
import { apiError } from '../lib/apiError';

interface Props {
  open: boolean;
  onClose: () => void;
}

function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ProfileDialog({ open, onClose }: Props) {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const onPickAvatar = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.push('Avatar must be 2 MB or smaller', 'error');
      return;
    }
    setAvatarBusy(true);
    try {
      await usersApi.uploadAvatar(file);
      await refreshUser();
      toast.push('Profile photo updated', 'success');
    } catch (err) {
      toast.push(apiError(err, 'Could not upload photo'), 'error');
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onRemoveAvatar = async () => {
    setAvatarBusy(true);
    try {
      await usersApi.removeAvatar();
      await refreshUser();
      toast.push('Profile photo removed', 'success');
    } catch (err) {
      toast.push(apiError(err, 'Could not remove photo'), 'error');
    } finally {
      setAvatarBusy(false);
    }
  };

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      toast.push('New password must be at least 8 characters', 'error');
      return;
    }
    if (next !== confirm) {
      toast.push('New passwords do not match', 'error');
      return;
    }
    setBusy(true);
    try {
      // The server revokes all refresh sessions and returns a fresh pair so this
      // session stays signed in while other devices are logged out.
      const { data } = await authApi.changePassword(current, next);
      tokenStorage.set(data.accessToken, data.refreshToken);
      reset();
      toast.push('Password changed · other devices were signed out', 'success');
    } catch (err) {
      toast.push(apiError(err, 'Could not change password'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Profile" width={460}>
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar
            name={user.name}
            color={user.avatarColor}
            size="lg"
            userId={user.id}
            avatarKey={user.avatarKey}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-display text-lg font-semibold text-ink">
                {user.name}
              </h3>
              {user.isAdmin && (
                <span className="chip bg-blurple-soft text-[#A8B0F8]">Admin</span>
              )}
            </div>
            <div className="truncate text-sm text-ink-muted">{user.email}</div>
            <div className="mt-0.5 text-[11px] text-ink-subtle">
              Joined {joinedLabel(user.createdAt)}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => void onPickAvatar(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={avatarBusy}
                className="btn-secondary h-7 px-2 text-xs"
              >
                {avatarBusy ? <Spinner /> : <Icon.User size={12} />}
                {user.avatarKey ? 'Change photo' : 'Upload photo'}
              </button>
              {user.avatarKey && (
                <button
                  type="button"
                  onClick={() => void onRemoveAvatar()}
                  disabled={avatarBusy}
                  className="btn-ghost h-7 px-2 text-xs"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="mt-1 text-[10px] text-ink-subtle">
              JPEG, PNG or WebP · up to 2 MB
            </p>
          </div>
        </div>

        <hr className="border-line" />

        <form onSubmit={onSubmit} className="space-y-3">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
            Change password
          </h4>
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current password"
            className="input"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="New password (min 8 characters)"
            className="input"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            className="input"
          />
          <p className="text-[11px] text-ink-subtle">
            Changing your password signs out your other devices.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Close
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || !current || !next || !confirm}
            >
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
