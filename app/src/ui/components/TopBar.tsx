import { useLayoutEffect, useRef, type MouseEvent } from 'react';
import { initials } from '@/core/types';
import { Button } from './Button';
import { Icon } from './Icon';
import { Badge } from './Pill';
import './TopBar.css';

export interface TopBarNavItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  /** Open items, shown as a count. Zero or absent shows nothing. */
  readonly count?: number | undefined;
  /** What the count means, for screen readers: "6 to post". */
  readonly countLabel?: string | undefined;
}

export interface TopBarUser {
  readonly name: string;
  /** As shown: "Intern", "Manager", "Admin". */
  readonly role: string;
}

export interface TopBarProps {
  /** The role's destinations, in order. Empty before sign-in. */
  readonly nav?: readonly TopBarNavItem[] | undefined;
  /** The nav item for the screen on show: selected, so gold. */
  readonly currentKey?: string | null | undefined;
  /** Who is signed in. Absent before sign-in. */
  readonly user?: TopBarUser | null | undefined;
  /** Called instead of following the link, so the app's router can navigate. */
  readonly onNavigate?: ((key: string) => void) | undefined;
  readonly onSignOut?: (() => void) | undefined;
  /** Where the brand word leads. */
  readonly brandHref?: string | undefined;
  readonly navLabel?: string | undefined;
}

export type TopBarLayout = 'one-row' | 'two-rows';

/** Widths in px. `available` is the room inside the bar's padding. */
export interface TopBarMeasurements {
  readonly available: number;
  readonly brand: number;
  readonly nav: number;
  readonly user: number;
  /** The gap between the brand, the nav and the user. */
  readonly gap: number;
}

const sum = (widths: readonly number[], gap: number): number => {
  const present = widths.filter((w) => w > 0);
  return present.reduce((total, w) => total + w, 0) + gap * Math.max(0, present.length - 1);
};

/**
 * The first arrangement that fits: one row (brand, nav, you), then two rows
 * (brand and you, then the nav). If not even that fits, it is still two rows,
 * and the nav wraps.
 */
export function chooseTopBarLayout(m: TopBarMeasurements): TopBarLayout {
  const arrangements: readonly { layout: TopBarLayout; width: number }[] = [
    { layout: 'one-row', width: sum([m.brand, m.nav, m.user], m.gap) },
    { layout: 'two-rows', width: Math.max(sum([m.brand, m.user], m.gap), m.nav) },
  ];
  const fits = arrangements.find((a) => a.width <= m.available);
  return (fits ?? arrangements[arrangements.length - 1]!).layout;
}

const px = (value: string): number => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

const widthOf = (el: Element | null): number => (el ? Math.ceil(el.getBoundingClientRect().width) : 0);

/**
 * Reads what each part needs from the rendered bar. Nav items never shrink or
 * wrap their text, so their sum is the nav's natural width in either layout.
 */
function measure(inner: HTMLElement): TopBarMeasurements {
  const style = getComputedStyle(inner);
  const list = inner.querySelector<HTMLElement>('.topbar__list');
  const items = list ? Array.from(list.children) : [];
  const itemGap = list ? px(getComputedStyle(list).columnGap) : 0;
  return {
    available: widthOf(inner.querySelector('.topbar__room')) - px(style.paddingLeft) - px(style.paddingRight),
    brand: widthOf(inner.querySelector('.topbar__brand')),
    nav: items.reduce((total, el) => total + widthOf(el), 0) + itemGap * Math.max(0, items.length - 1),
    user: widthOf(inner.querySelector('.topbar__user')),
    gap: px(style.columnGap),
  };
}

const isModifiedClick = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

/**
 * The bar across the top of the window: the brand word, the role's nav, who is
 * signed in, and sign out. Its layout is measured, not set by breakpoints, so it
 * follows the text size and the nav a role gets.
 */
export function TopBar({
  nav = [],
  currentKey,
  user,
  onNavigate,
  onSignOut,
  brandHref = '#/',
  navLabel = 'Main',
}: TopBarProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const shape = `${nav.map((i) => i.key).join('|')}#${user ? 'user' : ''}#${onSignOut ? 'out' : ''}`;

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return undefined;

    // Set as an attribute, not state, so the right layout is in place before
    // the frame is painted and nothing flickers while the window is resized.
    const apply = () => {
      const layout = chooseTopBarLayout(measure(inner));
      if (inner.dataset.layout !== layout) inner.dataset.layout = layout;
    };
    apply();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', apply);
      return () => window.removeEventListener('resize', apply);
    }

    // Watch the room (a zero-height strip, so a change of layout can't feed
    // back into it) and every part whose width can change: fonts loading, a
    // count going from 9 to 10.
    const observer = new ResizeObserver(apply);
    inner.querySelectorAll('.topbar__room, .topbar__brand, .topbar__item, .topbar__user').forEach((el) =>
      observer.observe(el),
    );
    return () => observer.disconnect();
  }, [shape]);

  return (
    <header className="topbar">
      <div ref={innerRef} className="topbar__inner">
        <div className="topbar__room" aria-hidden="true" />

        <a className="topbar__brand" href={brandHref}>
          <span className="topbar__company">APG</span> <span className="topbar__product">Post-It</span>
        </a>

        {nav.length > 0 ? (
          <nav className="topbar__nav" aria-label={navLabel}>
            <ul className="topbar__list">
              {nav.map((item) => (
                <li key={item.key} className="topbar__item">
                  <a
                    className="topbar__link"
                    href={item.href}
                    aria-current={item.key === currentKey ? 'page' : undefined}
                    onClick={(event) => {
                      if (!onNavigate || isModifiedClick(event)) return;
                      event.preventDefault();
                      onNavigate(item.key);
                    }}
                  >
                    <span>{item.label}</span>
                    {item.count ? <Badge count={item.count} label={item.countLabel} /> : null}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {user ? (
          <div className="topbar__user">
            <span className="topbar__avatar" aria-hidden="true">
              {initials(user.name)}
            </span>
            <span className="topbar__who">
              <span className="topbar__name">{user.name}</span>
              <span className="topbar__role">{user.role}</span>
            </span>
            {onSignOut ? (
              <Button variant="quiet" size="small" icon={<Icon name="signOut" size={18} />} onClick={onSignOut}>
                Sign out
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
