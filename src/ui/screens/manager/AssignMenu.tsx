import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components';

export interface MenuButtonProps {
  /** The button's words, or (with `icon` and no visible words) its accessible name. */
  readonly label: string;
  /** Shown instead of the words: the label then names it for screen readers. */
  readonly icon?: ReactNode;
  /** A count after the words, while something in the panel is on. */
  readonly count?: number | undefined;
  readonly className?: string | undefined;
  /** The panel. `close` shuts it and puts focus back on the button. */
  readonly children: (close: () => void) => ReactNode;
}

/**
 * A button that opens a small panel under it: Filter, and ⋯. It closes on
 * Escape (focus back on the button), on a click outside, or when the panel
 * says so.
 */
export function MenuButton({ label, icon, count, className, children }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const on = count !== undefined && count > 0;
  return (
    <div
      className={['menu', className].filter(Boolean).join(' ')}
      ref={root}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <Button
        ref={button}
        size="small"
        variant={icon ? 'quiet' : 'ghost'}
        className={['menu__button', icon ? 'menu__button--icon' : null].filter(Boolean).join(' ')}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={icon ? label : on ? `${label}, ${count} on` : undefined}
        icon={icon}
        onClick={() => setOpen((o) => !o)}
      >
        {icon ? null : (
          <>
            {label}
            {on ? <span className="menu__count tabular">{count}</span> : null}
          </>
        )}
      </Button>
      {open ? (
        <div className="menu__panel" id={panelId}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

/** Three dots in a row: "more". Decorative; the button's label names it. */
export function MoreIcon({ size = 20 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </svg>
  );
}
