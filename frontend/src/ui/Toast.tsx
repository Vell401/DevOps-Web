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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const push = useCallback((text: string, tone: ToastMsg['tone'] = 'default') => {
    const id = ++counter;
    setToasts((prev) => [...prev, { id, tone, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Portal to <body> with a high z-index so toasts always sit above modal
          and drawer overlays — they must never be dimmed by a backdrop. */}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                'pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-card animate-[toastin_200ms_ease-out]',
                t.tone === 'error' && 'border-chip-red bg-chip-red/70 text-[#7A2218]',
                t.tone === 'success' && 'border-leaf-200 bg-chip-green text-[#1B6A48]',
                t.tone === 'default' && 'border-line bg-surface text-ink',
              )}
            >
              {t.text}
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
