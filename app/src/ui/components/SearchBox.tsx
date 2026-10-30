import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { Icon } from './Icon';
// The input itself looks exactly like a TextInput's.
import './TextInput.css';
import './SearchBox.css';

export interface SearchBoxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'size'> {
  /** The accessible name, e.g. "Search listings". Not shown: the icon and placeholder say it. */
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** The clear button's name for screen readers. */
  readonly clearLabel?: string | undefined;
}

/**
 * A search field: magnifier, the query, and a clear button once there is one.
 * Escape clears it too. Searching itself is the caller's job, on every change.
 */
export const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(function SearchBox(
  { label, value, onValueChange, clearLabel = 'Clear search', className, onKeyDown, ...rest },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);

  const clear = () => {
    onValueChange('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && value !== '') {
      event.preventDefault();
      event.stopPropagation();
      onValueChange('');
    }
    onKeyDown?.(event);
  };

  return (
    <div className={['searchbox', className].filter(Boolean).join(' ')}>
      <Icon name="search" className="searchbox__icon" />
      <input
        {...rest}
        ref={inputRef}
        type="search"
        className="searchbox__input"
        aria-label={label}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {value !== '' ? (
        <button type="button" className="searchbox__clear" aria-label={clearLabel} onClick={clear}>
          <Icon name="close" size={18} />
        </button>
      ) : null}
    </div>
  );
});
