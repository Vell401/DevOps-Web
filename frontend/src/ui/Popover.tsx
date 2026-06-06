import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

interface Props {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'start' | 'end';
  className?: string;
}

export function Popover({ trigger, children, align = 'start', className }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className={cn(
            'absolute z-30 mt-1 min-w-[200px] rounded-lg border border-line bg-surface p-1 shadow-drawer',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function PopoverItem({
  children,
  onClick,
  active,
  danger,
  icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition',
        danger
          ? 'text-[#9F2A20] hover:bg-chip-red/40'
          : 'text-ink hover:bg-surface-sunken',
        active && 'bg-surface-sunken',
      )}
    >
      {icon && <span className="text-ink-muted">{icon}</span>}
      <span className="flex-1">{children}</span>
    </button>
  );
}
