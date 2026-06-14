import { NavLink } from 'react-router-dom';
import type { ServiceStatus } from '../types';
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

/** Visual tone of a card header. Adds `warn` (amber) on top of ServiceStatus. */
export type CardStatus = ServiceStatus | 'warn';

const SERVICE_META: Record<CardStatus, { dot: string; text: string; label: string }> = {
  up: { dot: 'bg-status-online', text: 'text-status-online', label: 'Operational' },
  warn: { dot: 'bg-status-idle', text: 'text-status-idle', label: 'Warning' },
  down: { dot: 'bg-status-dnd', text: 'text-status-dnd', label: 'Unreachable' },
  disabled: { dot: 'bg-status-offline', text: 'text-ink-subtle', label: 'Disabled' },
};

/**
 * Card for one backing service: a status header (coloured dot + state), one
 * headline figure, and a list of secondary key/value rows. Used to build the
 * "Services" grid on the metrics page. `statusLabel` overrides the default
 * wording (e.g. "Stale" for a backup card).
 */
export function ServiceCard({
  name,
  status,
  statusLabel,
  primary,
  primaryLabel,
  rows,
}: {
  name: string;
  status: CardStatus;
  statusLabel?: string;
  primary?: string;
  primaryLabel?: string;
  rows: { label: string; value: string | number }[];
}) {
  const meta = SERVICE_META[status];
  return (
    <div className="flex flex-col rounded-lg border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', meta.dot)} />
          <span className="text-sm font-medium text-ink">{name}</span>
        </div>
        <span className={cn('text-[11px] font-medium uppercase tracking-wide', meta.text)}>
          {statusLabel ?? meta.label}
        </span>
      </div>

      {primary !== undefined && (
        <div className="mb-3">
          <div className="font-display text-2xl font-semibold leading-none text-ink">
            {primary}
          </div>
          {primaryLabel && (
            <div className="mt-1 text-[11px] uppercase tracking-wide text-ink-subtle">
              {primaryLabel}
            </div>
          )}
        </div>
      )}

      <dl className="mt-auto space-y-1.5 border-t border-line/60 pt-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 text-xs">
            <dt className="text-ink-subtle">{r.label}</dt>
            <dd className="truncate font-mono text-ink-muted">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Compact uptime: "5d 3h", "3h 12m", "45m" or "30s". */
export function formatUptime(sec: number): string {
  if (sec <= 0) return '—';
  if (sec < 60) return `${sec}s`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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
