import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { CreateProjectDialog } from './CreateProjectDialog';
import { useUserRealtime } from '../lib/realtime';
import { notificationsApi } from '../api/endpoints';
import { useToast } from '../ui/Toast';
import type { AppNotification } from '../types';

export function Layout() {
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const toast = useToast();

  const openCreate = useCallback(() => setCreateOpen(true), []);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const reloadProjects = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Authoritative unread figure from the server — used on mount and whenever
  // the notifications page marks something read.
  const refreshUnread = useCallback(() => {
    notificationsApi
      .unreadCount()
      .then(setUnreadNotifications)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshUnread();
  }, [refreshUnread]);

  const onNotification = useCallback(
    (n: AppNotification) => {
      setUnreadNotifications((u) => u + 1);
      const who = n.actor?.name ?? 'Someone';
      const where =
        n.task?.project && n.task
          ? `${n.task.project.key}-${n.task.number}`
          : 'a task';
      toast.push(`${who} mentioned you in ${where}`);
    },
    [toast],
  );

  // Server tells us when our list of visible projects may have changed —
  // new assignment, project closed/reopened, etc. Bumping refreshKey
  // triggers Sidebar's effect to refetch both active and closed lists.
  useUserRealtime({
    'projects-changed': reloadProjects,
    notification: onNotification,
  });

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper bg-noise">
      <Sidebar
        onCreateProject={openCreate}
        refreshKey={refreshKey}
        unreadNotifications={unreadNotifications}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet
          context={{
            openCreateProject: openCreate,
            reloadProjects,
            refreshKey,
            unreadNotifications,
            refreshUnread,
          }}
        />
      </div>
      <CreateProjectDialog
        open={createOpen}
        onClose={closeCreate}
        onCreated={reloadProjects}
      />
    </div>
  );
}

export interface LayoutContext {
  openCreateProject: () => void;
  reloadProjects: () => void;
  refreshKey: number;
  unreadNotifications: number;
  refreshUnread: () => void;
}
