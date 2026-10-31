import { useId } from 'react';
import './Segmented.css';

export interface SegmentedProps<T extends string> {
  /** The group's visible name. */
  readonly label: string;
  readonly options: readonly T[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * Two or three choices side by side, one picked: radios underneath, so the
 * arrow keys move between them. The picked one is gold (selected).
 */
export function Segmented<T extends string>({ label, options, value, onChange, disabled = false, className }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className={['segmented', className].filter(Boolean).join(' ')} disabled={disabled}>
      <legend className="segmented__legend">{label}</legend>
      <div className="segmented__track" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
        {options.map((option) => (
          <label key={option} className={`segmented__option${value === option ? ' segmented__option--on' : ''}`}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="segmented__input"
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
