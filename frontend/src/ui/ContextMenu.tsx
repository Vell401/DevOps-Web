import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

/** A cursor-positioned menu (portal). Closes on outside click, Escape, scroll
 *  or resize. Used for right-click menus. */
export function ContextMenu({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Keep the menu inside the viewport.
  const left = Math.min(x, window.innerWidth - 196);
  const top = Math.min(y, window.innerHeight - 184);

  return createPortal(
    <div
      ref={ref}
      style={{ top, left }}
      className="fixed z-[70] min-w-[184px] rounded-lg border border-line bg-surface p-1 shadow-drawer"
    >
      {children}
    </div>,
    document.body,
  );
}

export function ContextMenuItem({
  onClick,
  icon,
  danger,
  children,
}: {
  onClick: () => void;
  icon?: ReactNode;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition',
        danger
          ? 'text-status-dnd hover:bg-status-dnd/15'
          : 'text-ink hover:bg-surface-sunken',
      )}
    >
      {icon && <span className="text-ink-muted">{icon}</span>}
      <span className="flex-1">{children}</span>
    </button>
  );
}
