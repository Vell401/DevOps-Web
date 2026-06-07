import { Icon } from '../ui/Icon';
import { cn } from '../lib/cn';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface Props {
  crumbs: BreadcrumbItem[];
  right?: React.ReactNode;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
}

export function Topbar({ crumbs, right, search }: Props) {
  return (
    <header className="flex h-12 items-center gap-4 border-b border-line/60 bg-paper/85 px-5 backdrop-blur">
      <nav className="flex items-center gap-1.5 text-sm text-ink-muted">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-ink-subtle">/</span>}
            {c.href ? (
              <a href={c.href} className="hover:text-ink">
                {c.label}
              </a>
            ) : (
              <span className={cn(i === crumbs.length - 1 ? 'text-ink' : '')}>
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <div className="flex-1" />

      {search && (
        <div className="relative w-72">
          <Icon.Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
          />
          <input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? 'Search'}
            className="h-8 w-full rounded-md border border-transparent bg-surface-deep pl-8 pr-12 text-sm text-ink placeholder:text-ink-subtle focus:border-blurple focus-visible:shadow-focus"
          />
          <span className="kbd absolute right-2 top-1/2 -translate-y-1/2">⌘ K</span>
        </div>
      )}

      <div className="flex items-center gap-1.5">{right}</div>
    </header>
  );
}
