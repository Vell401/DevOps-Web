import { cn } from '../lib/cn';
import { PRIORITY_META } from '../lib/meta';
import type { TaskPriority } from '../types';

interface Props {
  priority: TaskPriority;
  showLabel?: boolean;
  className?: string;
}

export function PriorityFlag({ priority, showLabel = true, className }: Props) {
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs',
        meta.tone,
        className,
      )}
      title={`${meta.label} priority`}
    >
      <PriorityBars rank={meta.rank} />
      {showLabel && meta.label}
    </span>
  );
}

function PriorityBars({ rank }: { rank: number }) {
  // rank 0 = urgent (3 tall bars), rank 3 = low (1 short bar)
  const bars = [
    rank <= 2 ? 'h-1.5' : 'h-1.5 opacity-30',
    rank <= 1 ? 'h-2.5' : 'h-2.5 opacity-30',
    rank <= 0 ? 'h-3.5' : 'h-3.5 opacity-30',
  ];
  return (
    <span className="inline-flex items-end gap-[2px]">
      {bars.map((cls, i) => (
        <span key={i} className={cn('w-[3px] rounded-[1px] bg-current', cls)} />
      ))}
    </span>
  );
}
