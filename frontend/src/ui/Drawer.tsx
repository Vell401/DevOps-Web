import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}

export function Drawer({ open, onClose, children, width = 520 }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) {
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex">
      <button
        aria-label="Close drawer"
        onClick={onClose}
        className="flex-1 bg-black/40 transition"
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex h-full flex-col overflow-hidden bg-surface shadow-drawer animate-[slidein_220ms_ease-out]',
        )}
        style={{ width }}
      >
        {children}
      </aside>
      <style>
        {`@keyframes slidein { from { transform: translateX(24px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}
      </style>
    </div>,
    document.body,
  );
}
