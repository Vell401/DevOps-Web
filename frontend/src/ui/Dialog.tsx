import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  width?: number;
}

export function Dialog({ open, onClose, title, description, children, width = 440 }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-ink/30"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative w-full rounded-lg border border-line bg-surface shadow-drawer animate-[pop_180ms_ease-out]',
        )}
        style={{ maxWidth: width }}
      >
        {(title || description) && (
          <div className="border-b border-line px-5 py-4">
            {title && <h2 className="font-display text-lg font-medium text-ink">{title}</h2>}
            {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
      <style>
        {`@keyframes pop { from { transform: translateY(8px) scale(0.98); opacity: 0 } to { transform: translateY(0) scale(1); opacity: 1 } }`}
      </style>
    </div>,
    document.body,
  );
}
