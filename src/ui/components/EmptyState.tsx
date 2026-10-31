import type { ReactNode } from 'react';
import { Icon } from './Icon';
import './EmptyState.css';

export interface EmptyStateProps {
  /** Defaults to an empty tray. */
  readonly icon?: ReactNode;
  /** What is empty, said plainly: "Nothing in your queue today". */
  readonly title: ReactNode;
  /** Why, and what to do instead. */
  readonly children?: ReactNode;
  /** The one thing to do next. */
  readonly action?: ReactNode;
  readonly headingLevel?: 2 | 3 | undefined;
  readonly className?: string | undefined;
}

/** What a list or screen says when it has nothing to show, and what to do next. */
export function EmptyState({ icon, title, children, action, headingLevel = 2, className }: EmptyStateProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div className={['empty-state', className].filter(Boolean).join(' ')}>
      <div className="empty-state__icon" aria-hidden="true">
        {icon ?? <Icon name="inbox" size={24} />}
      </div>
      <Heading className="empty-state__title">{title}</Heading>
      {children ? <div className="empty-state__body">{children}</div> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
