import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { projectsApi } from '../api/endpoints';
import type { Project } from '../types';
import { Topbar } from '../components/Topbar';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import type { LayoutContext } from '../components/Layout';

export function ProjectsPage() {
  const { openCreateProject, refreshKey } = useOutletContext<LayoutContext>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    projectsApi
      .list()
      .then((r) => mounted && setProjects(r.data))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  const filtered = query
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          p.key.toLowerCase().includes(query.toLowerCase()),
      )
    : projects;

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Projects' }]}
        search={{ value: query, onChange: setQuery, placeholder: 'Search projects' }}
        right={
          <button onClick={openCreateProject} className="btn-accent">
            <Icon.Plus size={14} />
            New project
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mb-8 max-w-3xl">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
            Your projects
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Each project keeps its own board, labels, and history.
          </p>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> Loading projects…
          </div>
        )}

        {!loading && filtered.length === 0 && !query && (
          <EmptyState onCreate={openCreateProject} />
        )}

        {!loading && filtered.length === 0 && query && (
          <p className="text-sm text-ink-muted">No projects match “{query}”.</p>
        )}

        {!loading && filtered.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <li key={p.id}>
                <ProjectCard project={p} />
              </li>
            ))}
            <li>
              <button
                onClick={openCreateProject}
                className="flex h-full min-h-[156px] w-full items-center justify-center rounded-lg border border-dashed border-line-strong bg-transparent text-sm text-ink-muted transition hover:border-ink-muted hover:bg-surface hover:text-ink"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon.Plus size={14} /> New project
                </span>
              </button>
            </li>
          </ul>
        )}
      </div>
    </>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const total = project.stats?.total ?? 0;
  const done = project.stats?.done ?? 0;
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group flex h-full flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-card transition hover:border-ink-muted"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="kbd mb-2 inline-block font-mono uppercase">{project.key}</span>
          <h3 className="font-display text-lg font-medium leading-tight text-ink line-clamp-2">
            {project.name}
          </h3>
        </div>
        <Icon.ArrowRight
          size={16}
          className="mt-1 text-ink-subtle transition group-hover:translate-x-0.5 group-hover:text-ink"
        />
      </div>
      {project.description && (
        <p className="text-sm text-ink-muted line-clamp-2">{project.description}</p>
      )}
      <div className="mt-auto space-y-2">
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>
            <span className="text-ink">{done}</span>
            <span className="text-ink-subtle"> / {total}</span> done
          </span>
          <span className="font-mono text-ink-subtle">{progress}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-leaf-400 transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-line-strong bg-surface/60 py-16">
      <div className="max-w-sm text-center">
        <Icon.Layers size={28} className="mx-auto mb-3 text-ink-subtle" />
        <h3 className="font-display text-lg font-medium text-ink">
          Start with your first project
        </h3>
        <p className="mt-1 text-sm text-ink-muted">
          A project keeps a board, labels, and history for a focused stream of work.
        </p>
        <button onClick={onCreate} className="btn-accent mt-4 mx-auto">
          <Icon.Plus size={14} /> Create project
        </button>
      </div>
    </div>
  );
}
