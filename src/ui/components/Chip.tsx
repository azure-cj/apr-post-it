import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';
import './Chip.css';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  /** Selected is one of gold's four jobs. */
  readonly selected: boolean;
  readonly onSelectedChange?: ((selected: boolean) => void) | undefined;
  /** Something before the label: a category's dot. */
  readonly leading?: ReactNode;
  /** How many this chip would show, e.g. listings in a category. */
  readonly count?: number | undefined;
}

/**
 * A filter you can turn on and off. A toggle button (`aria-pressed`); when
 * selected it turns gold and gains a tick, so the state never rests on colour.
 */
export function Chip({
  selected,
  onSelectedChange,
  leading,
  count,
  className,
  children,
  onClick,
  ...rest
}: ChipProps) {
  return (
    <button
      {...rest}
      type="button"
      className={['chip', selected ? 'chip--selected' : null, className].filter(Boolean).join(' ')}
      aria-pressed={selected}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onSelectedChange?.(!selected);
      }}
    >
      {selected ? <Icon name="check" size={16} className="chip__check" /> : null}
      {leading ? (
        <span className="chip__leading" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="chip__label">{children}</span>
      {count !== undefined ? <span className="chip__count tabular">{count.toLocaleString('en-PH')}</span> : null}
    </button>
  );
}
