import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import './MenuButton.css';

export interface MenuButtonProps {
  /** The button's words, or (with `icon` and no visible words) its accessible name. */
  readonly label: string;
  /** Shown instead of the words: the label then names it for screen readers. */
  readonly icon?: ReactNode;
  /** A count after the words, while something in the panel is on. */
  readonly count?: number | undefined;
  /** Words to show instead of the label, such as the choice made ("Name"); the button is then named "label: words". */
  readonly text?: string | undefined;
  /** A decorative icon before the words. */
  readonly leading?: ReactNode;
  readonly className?: string | undefined;
  /** The panel. `close` shuts it and puts focus back on the button. */
  readonly children: (close: () => void) => ReactNode;
}

/**
 * A button that opens a small panel under it: Filter, Sort, and ⋯. It closes on
 * Escape (focus back on the button), on a click outside, or when the panel
 * says so.
 */
export function MenuButton({ label, icon, count, text, leading, className, children }: MenuButtonProps) {
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
        aria-label={icon ? label : on ? `${label}, ${count} on` : text ? `${label}: ${text}` : undefined}
        icon={icon ?? leading}
        onClick={() => setOpen((o) => !o)}
      >
        {icon ? null : (
          <>
            {text ?? label}
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

