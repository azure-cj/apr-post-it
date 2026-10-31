import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import './Dialog.css';

export interface DialogProps {
  readonly title: ReactNode;
  readonly children?: ReactNode;
  /** The buttons, at the bottom right. */
  readonly actions?: ReactNode;
  /** Escape, or the window's own cancel. Ignored while `busy`. */
  readonly onClose: () => void;
  /** Working: Escape does nothing. */
  readonly busy?: boolean | undefined;
  /** Where focus starts: the safe choice, or the first field. Default the dialog itself. */
  readonly initialFocus?: RefObject<HTMLElement> | undefined;
  /** `wide` for a dialog that holds a list or a table. */
  readonly size?: 'regular' | 'wide' | undefined;
  readonly className?: string | undefined;
}

/**
 * A modal question or form, drawn like the shell's confirm dialog. Focus goes
 * in on open and back where it was on close.
 */
export function Dialog({ title, children, actions, onClose, busy = false, initialFocus, size = 'regular', className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    (initialFocus?.current ?? dialog).focus();
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      if (before?.isConnected) before.focus();
    };
    // On open only.
  }, []);

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <dialog
      ref={ref}
      className={['confirm', 'm-dialog', size === 'wide' ? 'm-dialog--wide' : null, className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
    >
      <h2 id={titleId} className="confirm__title">
        {title}
      </h2>
      <div className="m-dialog__body">{children}</div>
      {actions ? <div className="confirm__actions">{actions}</div> : null}
    </dialog>
  );
}
