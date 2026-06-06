import { cn } from '../lib/cn';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-ink',
        className,
      )}
      aria-hidden
    />
  );
}
