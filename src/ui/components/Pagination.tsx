import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefCallback } from 'react';
import './Pagination.css';

/** Ten rows a page: enough to scan in one look, few enough to fit a laptop screen. */
export const PAGE_SIZE = 10;

/** A page number, or a gap between two runs of them. */
export type PageSlot = number | 'gap-start' | 'gap-end';

const range = (from: number, to: number): number[] =>
  from > to ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * The page numbers to show: the first and the last, the current one with
 * `siblings` either side, and a gap (…) where pages are left out. Always the
 * same number of slots once there are enough pages, so the buttons don't move
 * under the pointer as you page: 1 2 3 4 5 … 148, then 1 … 4 5 6 … 148.
 * A gap never hides a single page: that page is shown instead.
 */
export function pageSlots(page: number, count: number, siblings = 1): PageSlot[] {
  if (count < 1) return [];
  const boundary = 1;
  const start = range(1, Math.min(boundary, count));
  const end = range(Math.max(count - boundary + 1, boundary + 1), count);
  const from = Math.max(Math.min(page - siblings, count - boundary - siblings * 2 - 1), boundary + 2);
  const to = Math.min(Math.max(page + siblings, boundary + siblings * 2 + 2), end.length > 0 ? end[0]! - 2 : count - 1);
  return [
    ...start,
    ...(from > boundary + 2 ? (['gap-start'] as const) : boundary + 1 < count - boundary ? [boundary + 1] : []),
    ...range(from, to),
    ...(to < count - boundary - 1 ? (['gap-end'] as const) : count - boundary > boundary ? [count - boundary] : []),
    ...end,
  ];
}

/** "1–10 of 1,474". */
export function rangeLabel(page: number, pageSize: number, total: number): string {
  if (total <= 0) return '0';
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const n = (x: number) => x.toLocaleString('en-PH');
  return `${n(first)}–${n(last)} of ${n(total)}`;
}

export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

export interface PaginationProps {
  /** The page shown, from 1. */
  readonly page: number;
  readonly pageSize?: number | undefined;
  /** How many rows there are in all. */
  readonly total: number;
  readonly onPageChange: (page: number) => void;
  /** The nav's name. Keep "Pages" unless a screen has more than one. */
  readonly label?: string | undefined;
  /** For a side pane: Prev and Next as arrows only, and one page either side of the gaps fewer. */
  readonly compact?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * "1–10 of 1,474" on the left; ‹ Prev, the page numbers with gaps, Next › on
 * the right. Hidden when everything fits on one page. The current page is
 * selected (gold, one of its four jobs) and `aria-current="page"`. The arrow
 * keys, Home and End move between its buttons.
 */
export function Pagination({
  page,
  pageSize = PAGE_SIZE,
  total,
  onPageChange,
  label = 'Pages',
  compact = false,
  className,
}: PaginationProps) {
  const count = pageCountOf(total, pageSize);
  if (total <= pageSize) return null;
  const current = Math.min(Math.max(1, page), count);
  const slots = pageSlots(current, count, compact ? 0 : 1);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1) return;
    let to: number | undefined;
    if (event.key === 'ArrowRight') to = Math.min(buttons.length - 1, at + 1);
    else if (event.key === 'ArrowLeft') to = Math.max(0, at - 1);
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = buttons.length - 1;
    if (to === undefined) return;
    event.preventDefault();
    buttons[to]?.focus();
  };

  return (
    <div className={['pagination', compact ? 'pagination--compact' : null, className].filter(Boolean).join(' ')}>
      <p className="pagination__range tabular">{rangeLabel(current, pageSize, total)}</p>
      <nav className="pagination__nav" aria-label={label} onKeyDown={onKeyDown}>
        <ul className="pagination__list">
          <li>
            <button
              type="button"
              className="pagination__step"
              aria-label="Previous page"
              disabled={current <= 1}
              onClick={() => onPageChange(current - 1)}
            >
              <Chevron to="left" />
              {compact ? null : <span>Prev</span>}
            </button>
          </li>
          {slots.map((slot) =>
            typeof slot === 'number' ? (
              <li key={slot}>
                <button
                  type="button"
                  className={['pagination__page', slot === current ? 'pagination__page--current' : null].filter(Boolean).join(' ')}
                  aria-label={`Page ${slot}`}
                  aria-current={slot === current ? 'page' : undefined}
                  onClick={() => {
                    if (slot !== current) onPageChange(slot);
                  }}
                >
                  {slot.toLocaleString('en-PH')}
                </button>
              </li>
            ) : (
              <li key={slot} className="pagination__gap" aria-hidden="true">
                …
              </li>
            ),
          )}
          <li>
            <button
              type="button"
              className="pagination__step"
              aria-label="Next page"
              disabled={current >= count}
              onClick={() => onPageChange(current + 1)}
            >
              {compact ? null : <span>Next</span>}
              <Chevron to="right" />
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}

function Chevron({ to }: { readonly to: 'left' | 'right' }) {
  return (
    <svg
      className="pagination__chevron"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={to === 'left' ? 'm14.5 6-6 6 6 6' : 'm9.5 6 6 6-6 6'} />
    </svg>
  );
}

// ------------------------------------------------------------------ the hook

/** The page held by someone else (the URL, a store kept across screens) instead of the hook. */
export interface PageControl {
  readonly page: number;
  readonly onPageChange: (page: number) => void;
}

export interface Paged<T> {
  /** The page shown, from 1, kept within the pages there are. */
  readonly page: number;
  readonly pageCount: number;
  /** This page's rows. */
  readonly items: readonly T[];
  /** Goes to a page as the person asked: the list's top comes into view and takes focus. */
  readonly setPage: (page: number) => void;
  /**
   * For the list (or whatever stands at its top): after a page change it is
   * scrolled into view if it is out of sight, and takes focus as a place, so
   * the next Tab is the first row, not back down at the page numbers.
   */
  readonly topRef: RefCallback<HTMLElement>;
  /** Spread onto <Pagination>. */
  readonly pagination: Pick<PaginationProps, 'page' | 'pageSize' | 'total' | 'onPageChange'>;
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Pages of `items`, `pageSize` at a time. Back to page 1 whenever `resetKey`
 * changes: pass what narrows the list (the search, the category, the filters),
 * so a new search starts at its top. When the rows shrink under the page shown
 * (a refresh, an item moved away), it steps back to the last page there is.
 * The page lives in the hook unless `control` holds it (the URL, a store).
 */
export function usePaged<T>(
  items: readonly T[],
  pageSize: number = PAGE_SIZE,
  resetKey?: string | number,
  control?: PageControl,
): Paged<T> {
  const [own, setOwn] = useState({ key: resetKey, page: 1 });
  const keyRef = useRef(resetKey);
  const controlled = control !== undefined;

  // Held here: a new key starts at page 1 in this very render, before any effect.
  let asked = own.page;
  if (!controlled && !Object.is(own.key, resetKey)) {
    asked = 1;
    setOwn({ key: resetKey, page: 1 });
  }
  // Held outside: page 1 at once, and the holder told after the render.
  const keyChanged = !Object.is(keyRef.current, resetKey);
  if (controlled) asked = keyChanged ? 1 : control.page;

  const onControlChange = control?.onPageChange;
  useEffect(() => {
    if (Object.is(keyRef.current, resetKey)) return;
    keyRef.current = resetKey;
    if (onControlChange) onControlChange(1);
  }, [resetKey, onControlChange]);

  const pageCount = pageCountOf(items.length, pageSize);
  const page = Math.min(Math.max(1, Number.isFinite(asked) ? Math.floor(asked) : 1), pageCount);
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  const top = useRef<HTMLElement | null>(null);
  const moved = useRef(false);
  const topRef = useCallback<RefCallback<HTMLElement>>((el) => {
    top.current = el;
    if (el && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    if (el) el.setAttribute('data-paged-top', '');
  }, []);

  const pageRef = useRef(page);
  pageRef.current = page;
  const setPage = useCallback(
    (next: number) => {
      if (next === pageRef.current) return;
      moved.current = true;
      if (onControlChange) onControlChange(next);
      else setOwn((s) => ({ ...s, page: next }));
    },
    [onControlChange],
  );

  // After a page the person asked for: its top in sight, and focus on it.
  useLayoutEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const el = top.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.top < 0 || box.top > window.innerHeight - 48) {
      el.scrollIntoView?.({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    el.focus({ preventScroll: true });
  }, [page]);

  return {
    page,
    pageCount,
    items: pageItems,
    setPage,
    topRef,
    pagination: { page, pageSize, total: items.length, onPageChange: setPage },
  };
}
