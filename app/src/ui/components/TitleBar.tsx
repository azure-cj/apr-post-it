import './TitleBar.css';

export interface WindowControlsProps {
  /** Shows Restore in place of Maximize. */
  readonly maximized: boolean;
  readonly onMinimize: () => void;
  readonly onToggleMaximize: () => void;
  /** Asks first: the app shows its confirmation. */
  readonly onClose: () => void;
}

export interface TitleBarProps {
  /**
   * The brand word, for when there is no sidebar to carry it (before sign-in).
   * Where it leads: absent, no brand is drawn.
   */
  readonly brandHref?: string | undefined;
  /**
   * The window's own minimize, maximize and close, drawn because the desktop
   * window has no frame. Absent in a browser. With them the strip is also what
   * the window is dragged by, and double-clicking it maximizes.
   */
  readonly windowControls?: WindowControlsProps | null | undefined;
}

/**
 * The slim strip across the top of the content: the window's drag region and
 * its controls on the desktop, and the brand word before sign-in. Draws
 * nothing when it would hold nothing (signed in, in a browser).
 */
export function TitleBar({ brandHref, windowControls }: TitleBarProps) {
  if (!windowControls && brandHref === undefined) return null;
  // Tauri drags the window from an element carrying this attribute itself, not
  // from its children, so the brand link and the buttons stay clickable.
  const drag = windowControls ? { 'data-tauri-drag-region': true } : {};
  const classes = ['titlebar', windowControls ? 'titlebar--framed' : '', brandHref !== undefined ? 'titlebar--branded' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <header className={classes} {...drag}>
      {brandHref !== undefined ? (
        <a className="titlebar__brand brand-word" href={brandHref}>
          <span className="brand-word__company">APG</span> <span className="brand-word__product">Post-It</span>
        </a>
      ) : null}
      {windowControls ? <WindowControls {...windowControls} /> : null}
    </header>
  );
}

/**
 * Minimize, maximize or restore, and close, at the window's top-right corner
 * as Windows draws them: 46 by 32, glyphs drawn in 10px. Close turns red on
 * hover, as Windows' does, which is danger, not gold.
 */
export function WindowControls({ maximized, onMinimize, onToggleMaximize, onClose }: WindowControlsProps) {
  return (
    <div className="window-controls" role="group" aria-label="Window">
      <button type="button" className="window-controls__button" aria-label="Minimize" title="Minimize" onClick={onMinimize}>
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button
        type="button"
        className="window-controls__button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={onToggleMaximize}
      >
        {maximized ? (
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
            <path d="M0.5 2.5h7v7h-7z" />
            <path d="M2.5 2.5v-2h7v7h-2" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
            <path d="M0.5 0.5h9v9h-9z" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="window-controls__button window-controls__button--close"
        aria-label="Close"
        title="Close"
        onClick={onClose}
      >
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}
