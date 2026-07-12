import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Panel width in px (capped to 94vw on small screens). */
  width?: number;
}

/**
 * Centered modal shell: a wide panel in the middle of the screen with a dimmed
 * backdrop. Used for the task view (previously a right-side drawer). Caps at
 * 90vh tall — the child is expected to be a `flex flex-col` whose scroll region
 * uses `min-h-0 flex-1 overflow-y-auto`.
 */
export function ModalShell({ open, onClose, children, width = 1100 }: Props) {
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
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-6">
      <button
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/55"
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{ width, maxWidth: '94vw' }}
        className={cn(
          'relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl',
          'bg-surface shadow-drawer ring-1 ring-line animate-[modalin_180ms_ease-out]',
        )}
      >
        {children}
      </div>
      <style>
        {`@keyframes modalin { from { transform: scale(.98) translateY(8px); opacity: 0 } to { transform: scale(1) translateY(0); opacity: 1 } }`}
      </style>
    </div>,
    document.body,
  );
}
