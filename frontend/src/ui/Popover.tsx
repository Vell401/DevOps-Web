import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

interface Props {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'start' | 'end';
  className?: string;
  /** Render the panel in a portal (fixed-positioned under the trigger) so it is
   *  not clipped by a scrollable / overflow ancestor — e.g. inside a Dialog,
   *  whose `overflow-y-auto` would otherwise cut the dropdown off. */
  portal?: boolean;
}

export function Popover({ trigger, children, align = 'start', className, portal }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      // Clicks inside the trigger wrapper OR the (possibly portalled) panel
      // must not close the popover — only true outside clicks do.
      if (ref.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
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

  // Anchor the portal panel under the trigger using viewport (fixed) coords.
  useLayoutEffect(() => {
    if (!open || !portal || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos(
      align === 'end'
        ? { top: r.bottom + 4, right: window.innerWidth - r.right }
        : { top: r.bottom + 4, left: r.left },
    );
  }, [open, portal, align]);

  const close = () => setOpen(false);

  const panel = open ? (
    <div
      ref={panelRef}
      className={cn(
        'min-w-[200px] rounded-lg border border-line bg-surface p-1 shadow-drawer',
        portal
          ? 'fixed z-[60] max-h-[320px] overflow-y-auto scrollbar-thin'
          : cn('absolute z-30 mt-1', align === 'end' ? 'right-0' : 'left-0'),
        className,
      )}
      style={portal && pos ? { top: pos.top, left: pos.left, right: pos.right } : undefined}
    >
      {children(close)}
    </div>
  ) : null;

  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {portal ? panel && createPortal(panel, document.body) : panel}
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
