import { FormEvent, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../ui/Toast';
import { authApi } from '../api/endpoints';
import { tokenStorage } from '../api/client';

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
  const { user } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return null;

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
      const raw = (err as { response?: { data?: { message?: string | string[] } } })
        .response?.data?.message;
      toast.push(Array.isArray(raw) ? raw[0] : raw ?? 'Could not change password', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Profile" width={460}>
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <Avatar name={user.name} color={user.avatarColor} size="lg" />
          <div className="min-w-0">
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
