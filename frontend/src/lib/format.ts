export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - then) / 1000));
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/** Absolute date + time, e.g. "5 Jun 2026, 21:25" — for places that need the
 *  exact moment (admin account-created column) rather than a relative "2d ago". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function toIsoDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateKey(iso: string): string {
  return toIsoDateInput(iso);
}

export function groupByDay<T extends { createdAt: string }>(
  items: T[],
): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = dateKey(it.createdAt);
    const arr = map.get(k) ?? [];
    arr.push(it);
    map.set(k, arr);
  }
  return Array.from(map.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
}

export function dayLabel(key: string): string {
  const today = dateKey(new Date().toISOString());
  if (key === today) return 'Today';
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (key === dateKey(yest.toISOString())) return 'Yesterday';
  return new Date(key).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: new Date(key).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}
