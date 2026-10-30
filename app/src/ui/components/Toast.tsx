import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import './Toast.css';

export type ToastTone = 'ok' | 'info' | 'warn' | 'danger';

/** How long a toast stays, in ms. Problems stay longer than confirmations. */
export const toastDurations: Record<ToastTone, number> = {
  ok: 4000,
  info: 4000,
  warn: 8000,
  danger: 8000,
};

/** Matches --dur-exit, so the toast is removed once it has faded. */
const EXIT_MS = 150;
const MAX_TOASTS = 3;

const icons: Record<ToastTone, IconName> = {
  ok: 'pass',
  info: 'info',
  warn: 'warn',
  danger: 'fail',
};

export interface ToastProps {
  readonly tone?: ToastTone | undefined;
  readonly children: ReactNode;
  /** Called by the close button, and when the time is up. */
  readonly onDismiss: () => void;
  /** ms before it dismisses itself; `null` stays until closed. */
  readonly duration?: number | null | undefined;
  /** Fading out; set by `useToasts`. */
  readonly leaving?: boolean | undefined;
  readonly dismissLabel?: string | undefined;
}

/**
 * A short confirmation: "Copied. Paste it into Facebook." The timer pauses
 * while the pointer or focus is on it, so it can always be read.
 */
export function Toast({
  tone = 'ok',
  children,
  onDismiss,
  duration,
  leaving = false,
  dismissLabel = 'Dismiss',
}: ToastProps) {
  const ms = duration === undefined ? toastDurations[tone] : duration;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(ms ?? 0);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (ms === null || hovered || focused || leaving) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => dismissRef.current(), Math.max(0, remaining.current));
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [ms, hovered, focused, leaving]);

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  };

  return (
    <div
      className={['toast', `toast--${tone}`, leaving ? 'toast--leaving' : null].filter(Boolean).join(' ')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
    >
      <Icon name={icons[tone]} className="toast__icon" />
      <div className="toast__message">{children}</div>
      <button type="button" className="toast__dismiss" aria-label={dismissLabel} onClick={onDismiss}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

export interface ToastItem {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: ReactNode;
  readonly leaving: boolean;
}

export interface ToastRegionProps {
  readonly toasts: readonly ToastItem[];
  readonly onDismiss: (id: number) => void;
}

/**
 * Where toasts appear: bottom centre of the window. Rendered into <body>, so
 * no container or transform above it can capture its fixed position. The list
 * is a polite live region that exists before anything arrives, so each toast
 * is read out.
 */
export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  return createPortal(
    <div className="toast-region">
      <ol className="toast-region__list" aria-live="polite" aria-relevant="additions text">
        {toasts.map((t) => (
          <li key={t.id} className="toast-region__item">
            <Toast tone={t.tone} leaving={t.leaving} onDismiss={() => onDismiss(t.id)}>
              {t.message}
            </Toast>
          </li>
        ))}
      </ol>
    </div>,
    document.body,
  );
}

export interface Toasts {
  readonly toasts: readonly ToastItem[];
  /** Shows a toast and returns its id. At most three are shown; the oldest goes first. */
  readonly show: (message: ReactNode, tone?: ToastTone) => number;
  readonly dismiss: (id: number) => void;
}

/** The toast queue for one window. Render its `toasts` with `ToastRegion`. */
export function useToasts(): Toasts {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const nextId = useRef(1);
  const removals = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    if (removals.current.has(id)) return;
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    removals.current.set(
      id,
      setTimeout(() => {
        removals.current.delete(id);
        setToasts((all) => all.filter((t) => t.id !== id));
      }, EXIT_MS),
    );
  }, []);

  const show = useCallback((message: ReactNode, tone: ToastTone = 'ok') => {
    const id = nextId.current++;
    setToasts((all) => [...all.filter((t) => !t.leaving).slice(-(MAX_TOASTS - 1)), { id, tone, message, leaving: false }]);
    return id;
  }, []);

  useEffect(() => {
    const pending = removals.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  return { toasts, show, dismiss };
}
