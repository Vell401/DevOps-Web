import { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { CreateProjectDialog } from './CreateProjectDialog';
import { useUserRealtime } from '../lib/realtime';

export function Layout() {
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const openCreate = useCallback(() => setCreateOpen(true), []);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const reloadProjects = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Server tells us when our list of visible projects may have changed —
  // new assignment, project closed/reopened, etc. Bumping refreshKey
  // triggers Sidebar's effect to refetch both active and closed lists.
  useUserRealtime({
    'projects-changed': reloadProjects,
  });

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper bg-noise">
      <Sidebar onCreateProject={openCreate} refreshKey={refreshKey} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet context={{ openCreateProject: openCreate, reloadProjects, refreshKey }} />
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
}
