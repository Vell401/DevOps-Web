import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { projectsApi } from '../api/endpoints';
import type { Project } from '../types';
import { Topbar } from '../components/Topbar';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { useToast } from '../ui/Toast';
import { timeAgo } from '../lib/format';
import { cn } from '../lib/cn';
import type { LayoutContext } from '../components/Layout';

type DateRange = '7d' | '30d' | '90d' | 'all';

export function ClosedProjectsPage() {
  const { reloadProjects } = useOutletContext<LayoutContext>();
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<DateRange>('all');

  const reload = async () => {
    setLoading(true);
    try {
      const { data } = await projectsApi.list({ closed: true });
      setProjects(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cutoff = rangeCutoff(range);
    return projects.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.key.toLowerCase().includes(q)) {
        return false;
      }
      if (cutoff && p.closedAt && new Date(p.closedAt).getTime() < cutoff) {
        return false;
      }
      return true;
    });
  }, [projects, query, range]);

  const onReopen = async (p: Project) => {
    try {
      await projectsApi.reopen(p.id);
      toast.push(`${p.name} reopened`, 'success');
      await reload();
      reloadProjects();
    } catch {
      toast.push('Could not reopen project', 'error');
    }
  };

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Projects', href: '/projects' }, { label: 'Closed' }]}
        search={{ value: query, onChange: setQuery, placeholder: 'Filter closed…' }}
      />

      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink">
              Closed projects
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              Archived projects with all tasks Done. Reopen any to make changes.
            </p>
          </div>
          <RangeChips value={range} onChange={setRange} />
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> Loading…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <p className="rounded-lg bg-surface p-6 text-center text-sm text-ink-muted shadow-card">
            {projects.length === 0
              ? 'No closed projects yet.'
              : 'No closed projects match the current filter.'}
          </p>
        )}

        {!loading && filtered.length > 0 && (
          <div className="overflow-hidden rounded-lg bg-surface shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-xs uppercase tracking-wide text-ink-subtle">
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Key</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tasks</th>
                  <th className="px-4 py-2.5 text-left font-medium">Closed</th>
                  <th className="px-4 py-2.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-line/40 transition last:border-0 hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/projects/${p.id}`}
                        className="font-medium text-ink hover:text-blurple"
                      >
                        {p.name}
                      </Link>
                      {p.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-ink-subtle">
                          {p.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
                        {p.key}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-xs text-ink-muted">
                        {p.stats?.done ?? 0}
                        <span className="text-ink-subtle"> / {p.stats?.total ?? 0}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs text-ink-muted"
                        title={p.closedAt ?? ''}
                      >
                        {p.closedAt ? timeAgo(p.closedAt) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => void onReopen(p)}
                        className="btn-ghost h-7 px-2 text-xs"
                      >
                        <Icon.ArrowLeft size={12} />
                        Reopen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function rangeCutoff(range: DateRange): number | null {
  if (range === 'all') return null;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function RangeChips({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (v: DateRange) => void;
}) {
  const options: { value: DateRange; label: string }[] = [
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: '30 days' },
    { value: '90d', label: '90 days' },
    { value: 'all', label: 'All time' },
  ];
  return (
    <div className="flex items-center gap-1 rounded-md bg-surface p-1 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-sm px-2.5 py-1 transition',
            value === o.value
              ? 'bg-surface-hover text-ink'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
