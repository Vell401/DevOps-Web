import { io, Socket } from 'socket.io-client';
import { useEffect } from 'react';
import { tokenStorage } from '../api/client';
import type { Comment, Task } from '../types';

interface ServerEvents {
  'task-upserted': (task: Task) => void;
  'task-deleted': (payload: { taskId: string }) => void;
  'comment-added': (payload: { taskId: string; comment: Comment }) => void;
}

type Handlers = {
  [K in keyof ServerEvents]?: ServerEvents[K];
};

let singleton: Socket | null = null;

function getSocket(): Socket | null {
  const token = tokenStorage.getAccess();
  if (!token) return null;

  if (singleton && singleton.connected) return singleton;
  if (singleton) {
    singleton.disconnect();
  }

  // Origin-relative — Vite dev server proxies, prod nginx forwards /api/socket.io.
  singleton = io({
    path: '/api/socket.io',
    auth: { token },
    transports: ['websocket'],
    autoConnect: true,
  });

  return singleton;
}

/**
 * Subscribe to events for one project. The socket is shared across the app,
 * so this only manages the room subscription + handler attachment.
 */
export function useProjectRealtime(
  projectId: string | undefined,
  handlers: Handlers,
) {
  useEffect(() => {
    if (!projectId) return;
    const socket = getSocket();
    if (!socket) return;

    const subscribe = () => {
      socket.emit('subscribe-project', projectId);
    };

    if (socket.connected) {
      subscribe();
    } else {
      socket.once('connect', subscribe);
    }

    const entries = Object.entries(handlers) as Array<
      [keyof ServerEvents, ServerEvents[keyof ServerEvents]]
    >;
    for (const [ev, fn] of entries) {
      socket.on(ev as string, fn as (...args: unknown[]) => void);
    }

    return () => {
      socket.emit('unsubscribe-project', projectId);
      for (const [ev, fn] of entries) {
        socket.off(ev as string, fn as (...args: unknown[]) => void);
      }
    };
    // Re-subscribe whenever projectId changes; handlers are intentionally
    // not in the deps — consumers should keep them stable (useCallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
}

export function disconnectRealtime() {
  if (singleton) {
    singleton.disconnect();
    singleton = null;
  }
}
