import type { MouseEvent, ReactNode } from 'react';

export interface RouteLinkProps {
  /** Where it goes, as the address bar has it: "#/interns?week=2026-11-02". */
  readonly href: string;
  /** Follows it through the app's router. Without it, the link is followed as it is. */
  readonly onNavigate?: (() => void) | undefined;
  readonly className?: string | undefined;
  readonly 'aria-label'?: string | undefined;
  readonly children: ReactNode;
}

/**
 * A link to another screen: a real link (it can be opened, copied, read as a
 * link), followed through the router on a plain click.
 */
export function RouteLink({ href, onNavigate, className = 'button button--link', children, ...rest }: RouteLinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate();
  };
  return (
    <a className={className} href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
