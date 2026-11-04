import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { initials } from '@/core/types';
import { Icon, type IconName } from './Icon';
import { Badge } from './Pill';
import './TitleBar.css';
import './Sidebar.css';

export interface SidebarNavItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
  /** Open items, shown as a count. Zero or absent shows nothing. */
  readonly count?: number | undefined;
  /** What the count means, for screen readers: "6 to post". */
  readonly countLabel?: string | undefined;
}

export interface SidebarUser {
  readonly name: string;
  /** As shown: "Intern" or "Admin". */
  readonly role: string;
}

export interface SidebarProps {
  /** The role's destinations, in order. */
  readonly nav: readonly SidebarNavItem[];
  /** The nav item for the screen on show: selected, so gold. */
  readonly currentKey?: string | null | undefined;
  readonly user: SidebarUser;
  /** Called instead of following the link, so the app's router can navigate. */
  readonly onNavigate?: ((key: string) => void) | undefined;
  readonly onSignOut?: (() => void) | undefined;
  /** An icon rail when true. */
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  /** Where the brand word leads. */
  readonly brandHref?: string | undefined;
  readonly navLabel?: string | undefined;
  /** The window has no frame: the brand row is also what it is dragged by. */
  readonly dragRegion?: boolean | undefined;
  /** Width changes animate. Off for the first paint, so a remembered state doesn't slide in. */
  readonly animate?: boolean | undefined;
  /** This app's version, shown at the foot. */
  readonly appVersion?: string | undefined;
  /** Looks for a newer version now. Without it, no button. */
  readonly onCheckUpdates?: (() => void) | undefined;
  /** A check is under way. */
  readonly checkingUpdates?: boolean | undefined;
  /** Opens What's new: the version becomes a button. */
  readonly onWhatsNew?: (() => void) | undefined;
}

const isModifiedClick = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

interface Tip {
  readonly text: string;
  readonly top: number;
  readonly left: number;
}

/**
 * The window's left edge: the brand word, the role's nav, and who is signed
 * in. Collapses to an icon rail of 64px, where every icon
 * keeps its name for screen readers and shows it in a tooltip.
 *
 * Icons sit at the same place in both widths, so collapsing only takes the
 * words away: nothing jumps.
 */
export function Sidebar({
  nav,
  currentKey,
  user,
  onNavigate,
  onSignOut,
  collapsed,
  onToggleCollapsed,
  brandHref = '#/',
  navLabel = 'Main',
  dragRegion = false,
  animate = false,
  appVersion,
  onCheckUpdates,
  checkingUpdates = false,
  onWhatsNew,
}: SidebarProps) {
  const asideRef = useRef<HTMLElement>(null);
  const id = useId();
  const [tip, setTip] = useState<Tip | null>(null);

  // A tooltip names what the rail shows only as an icon. Fixed, so the
  // sidebar's overflow can't clip it; dismissed by Escape (WCAG 1.4.13).
  const showTip = useCallback((target: HTMLElement, text: string) => {
    const edge = asideRef.current?.getBoundingClientRect().right ?? 0;
    const box = target.getBoundingClientRect();
    setTip({ text, top: box.top + box.height / 2, left: edge + 8 });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  useEffect(() => {
    if (!tip) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTip(null);
    };
    const onScroll = () => setTip(null);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [tip]);

  // Nothing to name once the words are back.
  useEffect(() => setTip(null), [collapsed]);

  /** Tooltip handlers: shown only in the rail, unless `always`. */
  const tipFor = (text: string, always = false) => {
    const on = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
      if (collapsed || always) showTip(event.currentTarget, text);
    };
    return { onMouseEnter: on, onMouseLeave: hideTip, onFocus: on, onBlur: hideTip };
  };

  const drag = dragRegion ? { 'data-tauri-drag-region': true } : {};
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';

  return (
    <aside
      ref={asideRef}
      id={`${id}-sidebar`}
      className={['sidebar', collapsed ? 'sidebar--collapsed' : '', animate ? 'sidebar--animate' : ''].filter(Boolean).join(' ')}
      aria-label="Sidebar"
    >
      <div className="sidebar__brand-row" {...drag}>
        <a className="sidebar__brand brand-word" href={brandHref} aria-label="APG Post-It" {...tipFor('APG Post-It')}>
          <span className="sidebar__brand-full">
            <span className="brand-word__company">APG</span> <span className="brand-word__product">Post-It</span>
          </span>
          <span className="sidebar__brand-short" aria-hidden="true">
            APG
          </span>
        </a>
      </div>

      <nav className="sidebar__nav" aria-label={navLabel}>
        <ul className="sidebar__list">
          {nav.map((item) => (
            <li key={item.key}>
              <a
                className="sidebar__item"
                href={item.href}
                aria-current={item.key === currentKey ? 'page' : undefined}
                onClick={(event) => {
                  if (!onNavigate || isModifiedClick(event)) return;
                  event.preventDefault();
                  onNavigate(item.key);
                }}
                {...tipFor(item.count ? `${item.label} · ${item.countLabel ?? item.count}` : item.label)}
              >
                <span className="sidebar__label">{item.label}</span>
                <Icon name={item.icon} className="sidebar__icon" />
                {item.count ? <Badge className="sidebar__count" count={item.count} label={item.countLabel} /> : null}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar__spacer" {...drag} />

      <div className="sidebar__footer">
        <div className="sidebar__user" {...tipFor(`${user.name} · ${user.role}`)}>
          <span className="sidebar__who">
            <span className="sidebar__user-name">{user.name}</span>
            <span className="sidebar__user-role">{user.role}</span>
          </span>
          <span className="sidebar__avatar sidebar__avatar--me" aria-hidden="true">
            {initials(user.name)}
          </span>
        </div>
        {onSignOut ? (
          <button type="button" className="sidebar__item sidebar__action" onClick={onSignOut} {...tipFor('Sign out')}>
            <span className="sidebar__label">Sign out</span>
            <Icon name="signOut" className="sidebar__icon" />
          </button>
        ) : null}
        <button
          type="button"
          className="sidebar__item sidebar__action sidebar__toggle"
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          aria-controls={`${id}-sidebar`}
          aria-keyshortcuts="Control+B"
          onClick={onToggleCollapsed}
          {...tipFor(`${toggleLabel} · Ctrl+B`)}
        >
          <span className="sidebar__label">
            {collapsed ? 'Expand' : 'Collapse'}
            <kbd className="sidebar__kbd" aria-hidden="true">
              Ctrl+B
            </kbd>
          </span>
          <Icon name="sidebar" className="sidebar__icon" />
        </button>
        {onCheckUpdates ? (
          <button
            type="button"
            className="sidebar__item sidebar__action"
            onClick={onCheckUpdates}
            disabled={checkingUpdates}
            aria-busy={checkingUpdates || undefined}
            {...tipFor(appVersion ? `Check for updates · v${appVersion}` : 'Check for updates')}
          >
            <span className="sidebar__label">{checkingUpdates ? 'Checking…' : 'Check for updates'}</span>
            <Icon name="refresh" className="sidebar__icon" />
          </button>
        ) : null}
        {appVersion && onWhatsNew ? (
          <button
            type="button"
            className="sidebar__version sidebar__version--link tabular"
            onClick={onWhatsNew}
            aria-label={`Version ${appVersion}: what's new`}
            {...tipFor("What's new")}
          >
            <span className="sidebar__label">Version {appVersion}</span>
            <span className="sidebar__version-short">v{appVersion}</span>
          </button>
        ) : appVersion ? (
          <p className="sidebar__version tabular">
            <span className="sidebar__label">Version {appVersion}</span>
            <span className="sidebar__version-short">v{appVersion}</span>
          </p>
        ) : null}
      </div>

      {tip ? (
        <div className="sidebar__tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>
          {tip.text}
        </div>
      ) : null}
    </aside>
  );
}
