import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { projectsApi } from '../api/endpoints';
import type { Project } from '../types';
import { Icon } from '../ui/Icon';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../auth/AuthContext';
import { cn } from '../lib/cn';

interface Props {
  onCreateProject: () => void;
  refreshKey: number;
}

const CLOSED_EXPANDED_KEY = 'tracker.sidebar.closedExpanded';

function readClosedExpanded(): boolean {
  try {
    return localStorage.getItem(CLOSED_EXPANDED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function Sidebar({ onCreateProject, refreshKey }: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [closed, setClosed] = useState<Project[] | null>(null);
  const [loading, setLoading] = useState(true);
  // Persist Closed-section open/closed across reloads.
  const [closedExpanded, setClosedExpanded] = useState<boolean>(readClosedExpanded);
  const [loadingClosed, setLoadingClosed] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(CLOSED_EXPANDED_KEY, String(closedExpanded));
    } catch {
      // Ignore quota / privacy-mode errors.
    }
  }, [closedExpanded]);

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

  // Reload closed list whenever the section is expanded or refreshKey bumps.
  useEffect(() => {
    if (!closedExpanded) return;
    let mounted = true;
    setLoadingClosed(true);
    projectsApi
      .list({ closed: true })
      .then((r) => mounted && setClosed(r.data))
      .finally(() => mounted && setLoadingClosed(false));
    return () => {
      mounted = false;
    };
  }, [closedExpanded, refreshKey]);

  return (
    <aside className="flex h-full w-60 flex-col bg-surface-sunken">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <BrandMark />
        <div className="flex-1">
          <div className="font-display text-[15px] font-semibold leading-tight text-ink">
            tracker
          </div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-ink-subtle">
            workspace
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 scrollbar-thin">
        <NavSection>
          <NavLinkItem to="/projects" icon={<Icon.Layers size={14} />} label="All projects" end />
          <NavLinkItem to="/activity" icon={<Icon.Activity size={14} />} label="Activity" />
          {user?.isAdmin && (
            <NavLinkItem to="/admin" icon={<Icon.Sparkle size={14} />} label="Admin" />
          )}
        </NavSection>

        <div className="mt-5 flex items-center justify-between px-3 pb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
            Projects
          </span>
          <button
            onClick={onCreateProject}
            className="rounded-sm p-0.5 text-ink-muted hover:bg-surface-hover hover:text-ink"
            aria-label="Create project"
            title="New project"
          >
            <Icon.Plus size={14} />
          </button>
        </div>
        <ul className="space-y-0.5">
          {loading && (
            <li className="px-3 py-1.5 text-xs text-ink-subtle">Loading…</li>
          )}
          {!loading && projects.length === 0 && (
            <li className="px-3 py-1.5 text-xs text-ink-subtle">
              No projects yet
            </li>
          )}
          {projects.map((p) => (
            <li key={p.id}>
              <NavLink
                to={`/projects/${p.id}`}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition',
                    isActive
                      ? 'bg-surface-hover text-ink'
                      : 'text-ink-muted hover:bg-surface-hover/60 hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-sm bg-blurple" />
                    )}
                    <ProjectGlyph keyText={p.key} active={isActive} />
                    <span className="truncate">{p.name}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

        <ClosedSection
          expanded={closedExpanded}
          onToggle={() => setClosedExpanded((v) => !v)}
          projects={closed}
          loading={loadingClosed}
        />
      </nav>

      <div className="p-2.5">
        <div className="flex items-center gap-2 rounded-md bg-surface-deep px-2.5 py-2">
          <Avatar name={user?.name ?? '?'} color={(user as { avatarColor?: string })?.avatarColor} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{user?.name}</div>
            <div className="truncate text-[11px] text-ink-subtle">{user?.email}</div>
          </div>
          <button
            onClick={() => {
              void logout().then(() => navigate('/login'));
            }}
            className="rounded-sm p-1 text-ink-muted hover:bg-surface-hover hover:text-ink"
            aria-label="Log out"
            title="Log out"
          >
            <Icon.Logout size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function ClosedSection({
  expanded,
  onToggle,
  projects,
  loading,
}: {
  expanded: boolean;
  onToggle: () => void;
  projects: Project[] | null;
  loading: boolean;
}) {
  const count = projects?.length ?? null;
  return (
    <div className="mt-5">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-sm px-3 pb-1.5 text-left"
      >
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle hover:text-ink-muted">
          <Icon.Caret
            size={10}
            className={cn('transition-transform', expanded ? 'rotate-0' : '-rotate-90')}
          />
          Closed
          {count !== null && count > 0 && (
            <span className="font-mono text-[10px] normal-case tracking-normal text-ink-subtle">
              ({count})
            </span>
          )}
        </span>
      </button>
      {expanded && (
        <ul className="space-y-0.5">
          {loading && (
            <li className="px-3 py-1.5 text-xs text-ink-subtle">Loading…</li>
          )}
          {!loading && projects && projects.length === 0 && (
            <li className="px-3 py-1.5 text-xs text-ink-subtle">
              No closed projects
            </li>
          )}
          {projects?.map((p) => (
            <li key={p.id}>
              <NavLink
                to={`/projects/${p.id}`}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition',
                    isActive
                      ? 'bg-surface-hover text-ink-muted'
                      : 'text-ink-subtle hover:bg-surface-hover/60 hover:text-ink-muted',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <ProjectGlyph keyText={p.key} active={isActive} dim />
                    <span className="truncate">{p.name}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
          {projects && projects.length > 0 && (
            <li>
              <Link
                to="/projects/closed"
                className="block px-3 py-1.5 text-[11px] text-ink-subtle hover:text-ink"
              >
                View all closed →
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function NavSection({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-0.5">{children}</ul>;
}

function NavLinkItem({
  to,
  icon,
  label,
  end,
  disabled,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <li>
        <div className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-ink-subtle">
          {icon}
          <span>{label}</span>
          <span className="ml-auto text-[10px] uppercase tracking-wide text-ink-subtle">
            soon
          </span>
        </div>
      </li>
    );
  }
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
          cn(
            'relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition',
            isActive
              ? 'bg-surface-hover text-ink'
              : 'text-ink-muted hover:bg-surface-hover/60 hover:text-ink',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <span className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-sm bg-blurple" />
            )}
            {icon}
            <span>{label}</span>
          </>
        )}
      </NavLink>
    </li>
  );
}

function ProjectGlyph({
  keyText,
  active,
  dim,
}: {
  keyText: string;
  active: boolean;
  dim?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex min-w-[42px] font-mono text-[12px] font-semibold uppercase tracking-wide transition',
        active
          ? 'text-[#A8B0F8]'
          : dim
            ? 'text-ink-subtle group-hover:text-ink-muted'
            : 'text-ink-muted group-hover:text-ink',
      )}
    >
      {keyText.slice(0, 6)}
    </span>
  );
}

function BrandMark() {
  return (
    <span
      aria-hidden
      className="relative grid h-9 w-9 place-items-center rounded-lg bg-blurple text-white shadow-glow"
    >
      <span className="absolute inset-1 rounded-md border border-white/15" />
      <span className="relative font-display text-[15px] font-bold">t</span>
    </span>
  );
}
