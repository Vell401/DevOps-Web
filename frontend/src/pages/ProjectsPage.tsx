import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { projectsApi } from '../api/endpoints';
import type { Project, UserLite } from '../types';
import { Topbar } from '../components/Topbar';
import { Icon } from '../ui/Icon';
import { Avatar } from '../ui/Avatar';
import { Spinner } from '../ui/Spinner';
import { timeAgo } from '../lib/format';
import { cn } from '../lib/cn';
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
          <button onClick={openCreateProject} className="btn-primary">
            <Icon.Plus size={14} />
            New project
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-8">
        {/* Cap content width on ultra-wide displays; full-bleed up to ~2K. */}
        <div className="mx-auto max-w-[2200px]">
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
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((p) => (
              <li key={p.id}>
                <ProjectCard project={p} />
              </li>
            ))}
            <li>
              <button
                onClick={openCreateProject}
                className="flex h-full min-h-[156px] w-full items-center justify-center rounded-lg border border-dashed border-line-strong bg-transparent text-sm text-ink-muted transition hover:border-blurple hover:bg-surface/50 hover:text-ink"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon.Plus size={14} /> New project
                </span>
              </button>
            </li>
          </ul>
        )}
        </div>
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
      className="group relative flex h-full flex-col gap-4 rounded-lg bg-surface p-5 shadow-card transition hover:bg-surface-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="mb-2 inline-block font-mono text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
            {project.key}
          </span>
          <h3 className="font-display text-lg font-medium leading-tight text-ink line-clamp-2">
            {project.name}
          </h3>
        </div>
        <Icon.ArrowRight
          size={16}
          className="mt-1 text-ink-subtle transition group-hover:translate-x-0.5 group-hover:text-blurple"
        />
      </div>
      {project.description && (
        <p className="text-sm text-ink-muted line-clamp-2">{project.description}</p>
      )}
      <div className="mt-auto space-y-3">
        <div className="flex items-center justify-between gap-2">
          <PeopleRow owner={project.owner} members={project.members} />
          <span
            className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ink-subtle"
            title={`Created ${new Date(project.createdAt).toLocaleString()}`}
          >
            <Icon.Calendar size={11} />
            {timeAgo(project.createdAt)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>
            <span className="text-ink">{done}</span>
            <span className="text-ink-subtle"> / {total}</span> done
          </span>
          <span className="font-mono text-ink-subtle">{progress}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-surface-deep">
          <div
            className="h-full rounded-full bg-status-online transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </Link>
  );
}

/**
 * Avatar stack of the people on a project: the owner first (highlighted with a
 * blurple ring) followed by explicit members. Shows up to four, then "+N".
 */
function PeopleRow({
  owner,
  members,
}: {
  owner?: UserLite;
  members?: UserLite[];
}) {
  const others = (members ?? []).filter((m) => m.id !== owner?.id);
  const people: Array<{ user: UserLite; isOwner: boolean }> = [
    ...(owner ? [{ user: owner, isOwner: true }] : []),
    ...others.map((u) => ({ user: u, isOwner: false })),
  ];

  if (people.length === 0) {
    return <span className="text-[11px] text-ink-subtle">No members</span>;
  }

  const MAX = 4;
  const visible = people.slice(0, MAX);
  const overflow = people.length - visible.length;

  return (
    <span className="inline-flex items-center -space-x-1.5">
      {visible.map(({ user, isOwner }) => (
        <Avatar
          key={user.id}
          name={user.name}
          color={user.avatarColor}
          size="sm"
          title={isOwner ? `${user.name} · owner` : user.name}
          className={cn(isOwner && 'ring-2 ring-blurple/70')}
        />
      ))}
      {overflow > 0 && (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface text-[10px] text-ink-muted ring-1 ring-line">
          +{overflow}
        </span>
      )}
    </span>
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
        <button onClick={onCreate} className="btn-primary mt-4 mx-auto">
          <Icon.Plus size={14} /> Create project
        </button>
      </div>
    </div>
  );
}
