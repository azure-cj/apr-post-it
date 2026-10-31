import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../../components';
import './intern.css';

/** Back to the list this screen was opened from. A link, so it is a place, not an action. */
export function BackLink({ to, state, children }: { readonly to: string; readonly state?: unknown; readonly children: ReactNode }) {
  return (
    <Link className="back-link" to={to} state={state}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="m14.5 6-6 6 6 6" />
      </svg>
      {children}
    </Link>
  );
}

/** A wait, said in words beside the spinner: "Reading the document…". */
export function Waiting({ children, className }: { readonly children: ReactNode; readonly className?: string | undefined }) {
  return (
    <p className={['waiting', className].filter(Boolean).join(' ')} role="status">
      <Spinner size="small" />
      <span>{children}</span>
    </p>
  );
}

/** A key to press, as the keyboard labels it. */
export function Key({ children }: { readonly children: ReactNode }) {
  return <kbd className="key">{children}</kbd>;
}
