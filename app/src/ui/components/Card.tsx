import { useId, type HTMLAttributes, type ReactNode } from 'react';
import './Card.css';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** The card's heading. With one, the card is a labelled section. */
  readonly title?: ReactNode;
  /** One line under the title. */
  readonly description?: ReactNode;
  /** Controls at the right of the heading: a small button, a link. */
  readonly actions?: ReactNode;
  /** `h2` on a screen, `h3` inside another card's section. */
  readonly headingLevel?: 2 | 3 | undefined;
  /** 24px inside, or 16px for dense cards and narrow panes. */
  readonly padding?: 'regular' | 'tight' | undefined;
}

/**
 * The raised surface: a vertical gradient and a top-lit edge, no shadow.
 */
export function Card({
  title,
  description,
  actions,
  headingLevel = 2,
  padding = 'regular',
  className,
  children,
  ...rest
}: CardProps) {
  const titleId = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const classes = ['card', padding === 'tight' ? 'card--tight' : null, className].filter(Boolean).join(' ');
  const hasHeader = Boolean(title || description || actions);

  if (!title) {
    return (
      <div {...rest} className={classes}>
        {hasHeader ? (
          <div className="card__header">
            {description ? <p className="card__description">{description}</p> : null}
            {actions ? <div className="card__actions">{actions}</div> : null}
          </div>
        ) : null}
        {children}
      </div>
    );
  }

  return (
    <section {...rest} className={classes} aria-labelledby={titleId}>
      <div className="card__header">
        <div className="card__heading">
          <Heading id={titleId} className="card__title">
            {title}
          </Heading>
          {description ? <p className="card__description">{description}</p> : null}
        </div>
        {actions ? <div className="card__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
