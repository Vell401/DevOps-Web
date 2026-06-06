import { cn } from '../lib/cn';
import { STATUS_META } from '../lib/meta';
import type { TaskStatus } from '../types';

interface Props {
  status: TaskStatus;
  variant?: 'pill' | 'inline';
  className?: string;
}

export function StatusBadge({ status, variant = 'pill', className }: Props) {
  const meta = STATUS_META[status];
  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs', meta.text, className)}>
        <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
        {meta.label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'chip',
        meta.bg,
        meta.text,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}
