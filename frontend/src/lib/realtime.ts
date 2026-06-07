import { io, Socket } from 'socket.io-client';
import { useEffect } from 'react';
import { tokenStorage } from '../api/client';
import type { Comment, Task } from '../types';

interface ServerEvents {
  'task-upserted': (task: Task) => void;
  'task-deleted': (payload: { taskId: string }) => void;
  'comment-added': (payload: { taskId: string; comment: Comment }) => void;
}

interface UserEvents {
  'projects-changed': () => void;
}

type Handlers = {
  [K in keyof ServerEvents]?: ServerEvents[K];
};

type UserHandlers = {
  [K in keyof UserEvents]?: UserEvents[K];
};

let singleton: Socket | null = null;

function getSocket(): Socket | null {
  const token = tokenStorage.getAccess();
  if (!token) return null;

  // Always return the existing instance if any — even mid-handshake. socket.io
  // buffers emits/listeners until connection completes. The previous version
  // recreated the socket while it was still connecting, which silently dropped
  // listeners attached by earlier consumers (Layout's projects-changed handler
  // was killed when ProjectDetailPage mounted a beat later).
  if (singleton) return singleton;

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

/**
 * Subscribe to user-scoped events (projects-changed when assignments shift,
 * etc). No project context — the backend auto-joins the user-room on connect.
 */
export function useUserRealtime(handlers: UserHandlers) {
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const entries = Object.entries(handlers) as Array<
      [keyof UserEvents, UserEvents[keyof UserEvents]]
    >;
    for (const [ev, fn] of entries) {
      socket.on(ev as string, fn as (...args: unknown[]) => void);
    }
    return () => {
      for (const [ev, fn] of entries) {
        socket.off(ev as string, fn as (...args: unknown[]) => void);
      }
    };
    // Handlers are intentionally not in deps — pass stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function disconnectRealtime() {
  if (singleton) {
    singleton.disconnect();
    singleton = null;
  }
}
