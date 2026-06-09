import {
  TextareaHTMLAttributes,
  useCallback,
  useLayoutEffect,
  useRef,
} from 'react';
import { cn } from '../lib/cn';

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Textarea that grows to fit its content as you type, so a long description is
 * shown in full instead of behind an inner scrollbar. Constrain the growth with
 * a `max-h-*` class on the caller — past that it falls back to scrolling so it
 * can never push the surrounding layout off-screen.
 */
export function AutoTextarea({ value, className, onChange, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    // clientHeight reflects any max-height cap from the className; show a
    // scrollbar only once the content actually exceeds it.
    el.style.overflowY = el.scrollHeight > el.clientHeight ? 'auto' : 'hidden';
  }, []);

  // Re-measure whenever the value changes (typing, reset, or external updates).
  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        onChange?.(e);
        resize();
      }}
      className={cn('resize-none overflow-hidden', className)}
      {...rest}
    />
  );
}
