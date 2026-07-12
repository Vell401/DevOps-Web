import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { notificationsApi } from '../api/endpoints';
import type { AppNotification } from '../types';
import type { LayoutContext } from '../components/Layout';
import { Topbar } from '../components/Topbar';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { useUserRealtime } from '../lib/realtime';
import { timeAgo } from '../lib/format';
import { cn } from '../lib/cn';

const PREVIEW_LENGTH = 180;

function verbOf(type: AppNotification['type']): string {
  switch (type) {
    case 'ASSIGNED':
      return 'assigned you to';
    case 'TASK_STATUS_CHANGED':
      return 'changed the status of';
    case 'DUE_SOON':
      return '';
    default:
      return 'mentioned you in';
  }
}

export function NotificationsPage() {
  const { refreshUnread } = useOutletContext<LayoutContext>();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await notificationsApi.list();
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live-prepend while the page is open (Layout handles the badge + toast).
  const onIncoming = useCallback((n: AppNotification) => {
    setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]));
  }, []);
  useUserRealtime({ notification: onIncoming });

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await notificationsApi.list(nextCursor);
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const open = async (n: AppNotification) => {
    if (!n.readAt) {
      // Optimistic: flip locally, then sync the badge with the server figure.
      setItems((prev) =>
        prev.map((x) =>
          x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x,
        ),
      );
      try {
        await notificationsApi.markRead([n.id]);
      } catch {
        // The row stays marked locally; the next refresh reconciles.
      }
      refreshUnread();
    }
    if (n.task?.project) {
      navigate(`/projects/${n.task.project.id}?task=${n.task.id}`);
    }
  };

  const markAll = async () => {
    try {
      await notificationsApi.markAllRead();
      setItems((prev) =>
        prev.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })),
      );
      refreshUnread();
    } catch {
      toast.push('Could not mark all as read', 'error');
    }
  };

  const hasUnread = items.some((n) => !n.readAt);

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Notifications' }]}
        right={
          <button
            onClick={() => void markAll()}
            disabled={!hasUnread}
            className="btn-secondary h-8 px-3 text-xs disabled:opacity-50"
          >
            <Icon.Check size={13} />
            Mark all as read
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-5">
            <h1 className="font-display text-2xl font-semibold text-ink">
              Notifications
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              Mentions, assignments, status changes and due dates — newest first.
            </p>
          </div>

          {loading && !items.length && (
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <Spinner /> Loading…
            </div>
          )}

          {!loading && items.length === 0 && (
            <p className="rounded-lg bg-surface p-6 text-center text-sm text-ink-muted shadow-card">
              Nothing here yet. You’ll get notified about mentions, new
              assignments, status changes and upcoming deadlines.
            </p>
          )}

          <ul className="space-y-1.5">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => void open(n)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition',
                    n.readAt
                      ? 'border-transparent bg-surface/50 hover:bg-surface'
                      : 'border-line bg-surface shadow-card hover:bg-surface-hover',
                  )}
                >
                  <span
                    className={cn(
                      'mt-2 h-2 w-2 shrink-0 rounded-full',
                      n.readAt ? 'bg-transparent' : 'bg-blurple',
                    )}
                  />
                  <Avatar
                    name={n.actor?.name ?? '?'}
                    color={n.actor?.avatarColor}
                    size="sm"
                    userId={n.actor?.id}
                    avatarKey={n.actor?.avatarKey}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug">
                      <span className={cn('font-medium', n.readAt ? 'text-ink-muted' : 'text-ink')}>
                        {n.type === 'DUE_SOON' ? 'Task' : n.actor?.name ?? 'Someone'}
                      </span>{' '}
                      <span className="text-ink-muted">{verbOf(n.type)}</span>{' '}
                      <span className={cn('font-mono text-[12px]', n.readAt ? 'text-ink-muted' : 'text-ink')}>
                        {n.task?.project
                          ? `${n.task.project.key}-${n.task.number}`
                          : 'a deleted task'}
                      </span>
                      {n.type === 'DUE_SOON' && (
                        <span className="text-ink-muted"> is due within 24 hours</span>
                      )}
                      {n.task && (
                        <span className="text-ink-muted"> · {n.task.title}</span>
                      )}
                    </span>
                    {n.comment && (
                      <span className="mt-1 block truncate text-[13px] text-ink-subtle">
                        {n.comment.body.length > PREVIEW_LENGTH
                          ? `${n.comment.body.slice(0, PREVIEW_LENGTH)}…`
                          : n.comment.body}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] text-ink-subtle">
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {nextCursor && (
            <div className="mt-5 flex justify-center">
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="btn-secondary h-8 px-4 text-xs"
              >
                {loadingMore ? (
                  <>
                    <Spinner /> Loading…
                  </>
                ) : (
                  'Load more'
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
