import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ClosedProjectsPage } from './pages/ClosedProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ActivityPage } from './pages/ActivityPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { AdminPage } from './pages/AdminPage';
import { AdminProjectsPage } from './pages/AdminProjectsPage';
import { AdminMetricsPage } from './pages/AdminMetricsPage';
import { RequireAuth } from './auth/RequireAuth';
import { RequireAdmin } from './auth/RequireAdmin';

// Lazy chunk: the docs page bundles the WYSIWYG editor (~1.3 MB), so it's split
// out and fetched only when the user actually opens /docs.
const DocsPage = lazy(() =>
  import('./pages/DocsPage').then((m) => ({ default: m.DocsPage })),
);

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/closed" element={<ClosedProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/my-tasks" element={<MyTasksPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route
          path="/docs"
          element={
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center text-sm text-ink-muted">
                  Loading…
                </div>
              }
            >
              <DocsPage />
            </Suspense>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/projects"
          element={
            <RequireAdmin>
              <AdminProjectsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/metrics"
          element={
            <RequireAdmin>
              <AdminMetricsPage />
            </RequireAdmin>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
