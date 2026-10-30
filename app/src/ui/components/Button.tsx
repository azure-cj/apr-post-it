import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { Spinner } from './Spinner';
import './Button.css';

/**
 * - `primary`: the gold gradient. **One per screen**: the thing this screen is for.
 * - `ghost`: an edged button for every other action. The default.
 * - `quiet`: no edge, for actions that sit inside something else (a bar, a field).
 * - `link`: text that acts, in the info colour, for small secondary actions.
 */
export type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'link';
export type ButtonSize = 'regular' | 'small';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant | undefined;
  /** `regular` is 44px tall, `small` 36px. Ignored by `link`. */
  readonly size?: ButtonSize | undefined;
  /**
   * Working on it. Shows a spinner in place of the icon and ignores clicks, but
   * stays focusable and keeps its width, so focus isn't lost and nothing jumps.
   * Change the label too ("Signing in…") so the wait is said, not just shown.
   */
  readonly busy?: boolean | undefined;
  /** Decorative icon before the label. The label names the button. */
  readonly icon?: ReactNode;
  /** Fill the container's width. */
  readonly block?: boolean | undefined;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'ghost',
    size = 'regular',
    busy = false,
    icon,
    block = false,
    type = 'button',
    className,
    children,
    onClick,
    ...rest
  },
  ref,
) {
  const classes = [
    'button',
    `button--${variant}`,
    variant !== 'link' && size === 'small' ? 'button--small' : null,
    block ? 'button--block' : null,
    busy ? 'button--busy' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      // Also stops a submit button from submitting its form again.
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  const lead = busy ? <Spinner size="small" /> : icon;

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      aria-busy={busy || undefined}
      aria-disabled={busy || rest['aria-disabled'] || undefined}
      onClick={handleClick}
    >
      {lead ? (
        <span className="button__icon" aria-hidden="true">
          {lead}
        </span>
      ) : null}
      <span className="button__label">{children}</span>
    </button>
  );
});
