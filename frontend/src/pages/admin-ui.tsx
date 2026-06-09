import { NavLink } from 'react-router-dom';
import { cn } from '../lib/cn';

/** Tab strip shared by the admin sub-pages (Overview / System metrics). */
export function AdminTabs() {
  return (
    <nav className="mb-6 flex gap-1 border-b border-line">
      <AdminTab to="/admin" label="Overview" end />
      <AdminTab to="/admin/metrics" label="System metrics" />
    </nav>
  );
}

function AdminTab({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          '-mb-px border-b-2 px-3 py-2 text-sm transition',
          isActive
            ? 'border-blurple text-ink'
            : 'border-transparent text-ink-muted hover:text-ink',
        )
      }
    >
      {label}
    </NavLink>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle">
      {children}
    </h2>
  );
}

export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
      <div className="text-[11px] uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

export function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={cn('px-3 py-2 text-left font-medium', className)}>{children}</th>
  );
}

export function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={cn('px-3 py-2 align-middle', className)}>{children}</td>;
}

/** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / 1024 ** i;
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}
