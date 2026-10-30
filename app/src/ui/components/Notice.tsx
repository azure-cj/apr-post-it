import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './Notice.css';

export type NoticeTone = 'danger' | 'warn' | 'info' | 'ok';

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly tone: NoticeTone;
  /** A short lead, in the tone's colour: "Copy is blocked". */
  readonly title?: ReactNode;
  /** One control at the end: "Try again". */
  readonly action?: ReactNode;
  /**
   * Announce it when it appears: danger and warn as alerts, info and ok
   * politely. Leave it off for a notice that is there when the screen opens.
   */
  readonly live?: boolean | undefined;
}

const icons: Record<NoticeTone, IconName> = {
  danger: 'fail',
  warn: 'warn',
  info: 'info',
  ok: 'pass',
};

/**
 * Something the person should know, on the screen it concerns. Each tone has
 * its own icon shape, so the tone is never colour alone.
 */
export function Notice({ tone, title, action, live = false, className, children, ...rest }: NoticeProps) {
  const role = live ? (tone === 'danger' || tone === 'warn' ? 'alert' : 'status') : undefined;

  return (
    <div {...rest} role={rest.role ?? role} className={['notice', `notice--${tone}`, className].filter(Boolean).join(' ')}>
      <Icon name={icons[tone]} className="notice__icon" />
      <div className="notice__content">
        {title ? <p className="notice__title">{title}</p> : null}
        {children ? <div className="notice__body">{children}</div> : null}
      </div>
      {action ? <div className="notice__action">{action}</div> : null}
    </div>
  );
}
