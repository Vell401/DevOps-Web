import { cn } from '../lib/cn';
import { LABEL_COLORS } from '../lib/meta';
import type { Label } from '../types';

interface Props {
  label: Label;
  onRemove?: () => void;
  size?: 'sm' | 'md';
  className?: string;
}

export function LabelChip({ label, onRemove, size = 'sm', className }: Props) {
  const palette = LABEL_COLORS[label.color];
  return (
    <span
      className={cn(
        'chip group',
        palette.bg,
        palette.text,
        size === 'md' && 'px-2 py-1 text-xs',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', palette.dot)} />
      <span>{label.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 -mr-0.5 opacity-50 hover:opacity-100"
          aria-label={`Remove ${label.name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
