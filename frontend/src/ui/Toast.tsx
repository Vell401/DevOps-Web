import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { Icon } from './Icon';

interface ToastMsg {
  id: number;
  tone: 'default' | 'error' | 'success';
  text: string;
}

interface Ctx {
  push: (text: string, tone?: ToastMsg['tone']) => void;
}

const ToastContext = createContext<Ctx | undefined>(undefined);

let counter = 0;

/** Long enough to read a full sentence; errors deserve a bit more time. */
const DISMISS_MS = 6000;
const DISMISS_ERROR_MS = 9000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (text: string, tone: ToastMsg['tone'] = 'default') => {
      const id = ++counter;
      setToasts((prev) => [...prev, { id, tone, text }]);
      setTimeout(() => dismiss(id), tone === 'error' ? DISMISS_ERROR_MS : DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Portal to <body> with a high z-index so toasts always sit above modal
          and drawer overlays — they must never be dimmed by a backdrop. */}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex w-80 flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                // Solid dark pads with white text — translucent chips made the
                // copy illegible against whatever happened to be behind them.
                'pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm text-white shadow-card animate-[toastin_200ms_ease-out]',
                t.tone === 'error' && 'border-status-dnd/50 bg-chip-red',
                t.tone === 'success' && 'border-status-online/50 bg-chip-green',
                t.tone === 'default' && 'border-line-strong bg-surface-deep',
              )}
            >
              <span className="min-w-0 flex-1 break-words leading-snug">{t.text}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="mt-0.5 shrink-0 rounded p-0.5 text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                <Icon.Close size={12} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
      <style>
        {`@keyframes toastin { from { transform: translateY(6px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}
      </style>
    </ToastContext.Provider>
  );
}

export function useToast(): Ctx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
