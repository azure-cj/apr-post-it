import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';
import './TextInput.css';

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Always visible: a placeholder is not a label. */
  readonly label: ReactNode;
  /** Help under the field, read with it by screen readers. */
  readonly hint?: ReactNode;
  /** What's wrong and how to fix it. Marks the field invalid. */
  readonly error?: ReactNode;
  /** Something inside the field's right edge, such as a Show button. */
  readonly end?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, end, id, className, type = 'text', ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `${autoId}input`;
  const hintId = hint ? `${autoId}hint` : null;
  const errorId = error ? `${autoId}error` : null;
  const describedBy =
    [errorId, hintId, rest['aria-describedby']].filter(Boolean).join(' ') || undefined;

  return (
    <div className={['field', error ? 'field--invalid' : null, className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className={['field__control', end ? 'field__control--with-end' : null].filter(Boolean).join(' ')}>
        <input
          {...rest}
          ref={ref}
          id={inputId}
          type={type}
          className="field__input"
          aria-invalid={error ? true : rest['aria-invalid']}
          aria-describedby={describedBy}
        />
        {end ? <div className="field__end">{end}</div> : null}
      </div>
      {error ? (
        <p id={errorId ?? undefined} className="field__error">
          <Icon name="fail" size={16} className="field__error-icon" />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p id={hintId ?? undefined} className="field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
