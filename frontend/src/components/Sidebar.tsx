import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
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

export function Sidebar({ onCreateProject, refreshKey }: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <aside className="flex h-full w-60 flex-col border-r border-line bg-paper">
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

      <nav className="px-2">
        <NavSection>
          <NavLinkItem to="/projects" icon={<Icon.Layers size={14} />} label="All projects" end />
          <NavLinkItem to="/inbox" icon={<Icon.Activity size={14} />} label="Activity" disabled />
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
            className="rounded-sm p-0.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
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
                    'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm',
                    isActive
                      ? 'bg-surface text-ink shadow-card'
                      : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                  )
                }
              >
                <ProjectGlyph keyText={p.key} />
                <span className="truncate">{p.name}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-auto border-t border-line p-3">
        <div className="flex items-center gap-2">
          <Avatar name={user?.name ?? '?'} color={(user as { avatarColor?: string })?.avatarColor} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{user?.name}</div>
            <div className="truncate text-xs text-ink-subtle">{user?.email}</div>
          </div>
          <button
            onClick={() => {
              void logout().then(() => navigate('/login'));
            }}
            className="rounded-sm p-1 text-ink-muted hover:bg-surface-sunken hover:text-ink"
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
            'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm',
            isActive
              ? 'bg-surface text-ink shadow-card'
              : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
          )
        }
      >
        {icon}
        <span>{label}</span>
      </NavLink>
    </li>
  );
}

function ProjectGlyph({ keyText }: { keyText: string }) {
  // tiny mono badge with project key
  return (
    <span className="inline-flex h-5 min-w-[24px] items-center justify-center rounded-sm bg-surface-sunken px-1 font-mono text-[10px] font-medium text-ink-muted ring-1 ring-line">
      {keyText.slice(0, 4)}
    </span>
  );
}

function BrandMark() {
  return (
    <span
      aria-hidden
      className="relative grid h-8 w-8 place-items-center rounded-md bg-ink text-paper"
    >
      <span className="absolute inset-1 rounded-sm border border-sun-300/60" />
      <span className="relative font-display text-[13px] font-bold">t</span>
    </span>
  );
}
