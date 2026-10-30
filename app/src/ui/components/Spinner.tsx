import './Spinner.css';

export interface SpinnerProps {
  /** 16px inside a button or a line of text; 24px on its own. */
  readonly size?: 'small' | 'regular' | undefined;
  /**
   * What is being waited for, read by screen readers: "Loading listings".
   * Leave it off when the spinner sits inside something that already says so,
   * such as a busy button whose label reads "Signing in…".
   */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}

export function Spinner({ size = 'regular', label, className }: SpinnerProps) {
  const classes = ['spinner', `spinner--${size}`, className].filter(Boolean).join(' ');
  const svg = (
    <svg className="spinner__svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle className="spinner__track" cx="12" cy="12" r="9" />
      <circle className="spinner__arc" cx="12" cy="12" r="9" />
    </svg>
  );

  if (!label) {
    return (
      <span className={classes} aria-hidden="true">
        {svg}
      </span>
    );
  }

  return (
    <span className={classes} role="status">
      {svg}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
