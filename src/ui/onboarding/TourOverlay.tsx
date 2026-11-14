import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon } from '../components';
import { placeCard, type Box } from './place';
import type { Tour } from './tours';
import './onboarding.css';

/** How long a step waits for its element to appear (a screen still loading) before going on without it. */
export const LOOK_MS = 1500;
const LOOK_EVERY_MS = 100;
/** Room between the element and the spotlight's edge. */
const PAD = 6;

/**
 * Whether a key pressed with focus on `el` is the tour's. A screen may move
 * focus to its heading as it loads, so the keys work from anywhere, except
 * where typing or arrows already mean something, or a question is open.
 */
function keysAreOurs(el: Element | null, card: HTMLElement | null, key: string): boolean {
  if (document.querySelector('dialog[open]')) return false;
  if (el && card?.contains(el)) return true;
  if (key === 'Escape') return true;
  if (!el || el === document.body) return true;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return false;
  if ((el as HTMLElement).isContentEditable) return false;
  // Tabs, charts and page numbers move with the arrows themselves.
  return !el.closest(
    '[role="tablist"], [role="listbox"], [role="slider"], [role="grid"], [role="radiogroup"], nav[aria-label*="age" i], svg',
  );
}

/** The live element a step points at, when it is on screen. */
export function findTarget(name: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
  if (!el || el.closest('[hidden], [inert]')) return null;
  return el;
}

const boxOf = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (a !== null && b !== null && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

/**
 * A tour over the live app: the element a step is about is lit, everything
 * else dimmed, and a card beside it says why and what. The app stays usable
 * underneath: the person may click the lit button. Back, Next, Skip tour and
 * ✕ are always there; Esc closes, and ← → move.
 */
export function TourOverlay({
  tour,
  onEnd,
}: {
  readonly tour: Tour;
  /** 'done': the last step's button; 'skipped': ✕, Skip tour or Esc. */
  readonly onEnd: (how: 'done' | 'skipped') => void;
}) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  // The element found for a step; null: shown in the middle.
  const [found, setFound] = useState<{
    readonly at: number;
    readonly el: HTMLElement | null;
  } | null>(null);
  // undefined: still looking for this step's element. Never the last step's.
  const target = found && found.at === index ? found.el : undefined;
  const [box, setBox] = useState<Box | null>(null);
  const [cardSize, setCardSize] = useState({ width: 340, height: 180 });
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const ended = useRef(false);

  const step = tour.steps[index];
  const total = tour.steps.length;
  const last = index === total - 1;
  const hint = tour.id === 'hint';

  const end = useCallback(
    (how: 'done' | 'skipped') => {
      if (ended.current) return;
      ended.current = true;
      onEnd(how);
    },
    [onEnd],
  );

  const go = useCallback(
    (by: 1 | -1) => {
      let next = index + by;
      // The page is up, so an optional step's button that isn't on it now won't come: pass over it at once.
      const missing = (i: number) => {
        const s = tour.steps[i];
        return s?.optional === true && s.target !== undefined && findTarget(s.target) === null;
      };
      if (target) while (next >= 0 && next < total && missing(next)) next += by;
      if (next >= total) return end('done');
      if (next < 0) return;
      setDirection(by);
      setIndex(next);
    },
    [index, total, end, target, tour.steps],
  );

  // Find the step's element, giving a loading screen a moment. An optional
  // step whose element never comes is passed over, the way the person was going.
  useEffect(() => {
    if (!step) return undefined;
    const at = index;
    if (!step.target) {
      setFound({ at, el: null });
      return undefined;
    }
    const name = step.target;
    let waited = 0;
    let timer: number | undefined;
    const look = () => {
      const el = findTarget(name);
      if (el) return setFound({ at, el });
      waited += LOOK_EVERY_MS;
      if (waited < LOOK_MS) {
        timer = window.setTimeout(look, LOOK_EVERY_MS);
        return;
      }
      if (!step.optional) return setFound({ at, el: null });
      const next = index + direction;
      if (next >= total) return end('done');
      if (next < 0) return setFound({ at, el: null });
      setIndex(next);
    };
    look();
    return () => window.clearTimeout(timer);
  }, [step, index, direction, total, end]);

  // Keep the spotlight on the element as the page scrolls, resizes or loads.
  useLayoutEffect(() => {
    if (!target) {
      setBox(null);
      return undefined;
    }
    const r = target.getBoundingClientRect();
    if ((r.top < 0 || r.bottom > window.innerHeight) && typeof target.scrollIntoView === 'function') {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({
        block: 'center',
        behavior: reduce ? 'auto' : 'smooth',
      });
    }
    const update = () => {
      const next = target.isConnected ? boxOf(target) : null;
      setBox((prev) => (sameBox(prev, next) ? prev : next));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(target);
    // Smooth scrolling and late layout move things without an event.
    const tick = window.setInterval(update, 250);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer?.disconnect();
      window.clearInterval(tick);
    };
  }, [target]);

  // The card's own size, for placing it.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const width = card.offsetWidth || 340;
    const height = card.offsetHeight || 180;
    setCardSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  });

  // Focus on the card's main button at each step; back where it was at the end.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (target !== undefined) primaryRef.current?.focus({ preventScroll: true });
  }, [target, index]);

  // Esc closes; the arrows go back and on.
  const keys = useRef({ go, end });
  keys.current = { go, end };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'Escape' && event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      if (!keysAreOurs(document.activeElement, cardRef.current, event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') {
        event.stopPropagation();
        keys.current.end('skipped');
      } else keys.current.go(event.key === 'ArrowRight' ? 1 : -1);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  if (!step) return null;

  const lit = box && box.width > 0 && box.height > 0 ? box : null;
  const view = {
    width: window.innerWidth || 1280,
    height: window.innerHeight || 800,
  };
  const padded = lit
    ? {
        top: lit.top - PAD,
        left: lit.left - PAD,
        width: lit.width + PAD * 2,
        height: lit.height + PAD * 2,
      }
    : null;
  const at = placeCard(padded, cardSize, view);

  const primary = hint ? 'Got it' : last ? 'Done' : index === 0 && !step.target ? 'Show me around' : 'Next';

  return createPortal(
    <div className="tour" data-testid="tour">
      {padded ? (
        <div
          className="tour__spot"
          style={{
            top: padded.top,
            left: padded.left,
            width: padded.width,
            height: padded.height,
          }}
          aria-hidden="true"
        />
      ) : (
        <div className="tour__veil" aria-hidden="true" />
      )}
      {target === undefined ? null : (
        <div
          ref={cardRef}
          className={`tour__card tour__card--${at.side}`}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          style={{ top: at.top, left: at.left }}
        >
          <div className="tour__head">
            {total > 1 ? (
              <>
                <span className="tour__dots" aria-hidden="true">
                  {tour.steps.map((s, i) => (
                    <span
                      key={`${s.title}-${i}`}
                      className={`tour__dot${i === index ? ' tour__dot--on' : i < index ? ' tour__dot--past' : ''}`}
                    />
                  ))}
                </span>
                <span className="tour__count meta tabular">
                  {index + 1} of {total}
                </span>
              </>
            ) : (
              <span />
            )}
            <button type="button" className="tour__close" aria-label="Close the tour" onClick={() => end('skipped')}>
              <Icon name="close" size={16} />
            </button>
          </div>
          <h2 id={titleId} className="tour__title">
            {step.title}
          </h2>
          <p id={bodyId} className="tour__body">
            {step.body}
          </p>
          <div className="tour__actions">
            {total > 1 && !last ? (
              <Button variant="quiet" size="small" onClick={() => end('skipped')}>
                Skip tour
              </Button>
            ) : (
              <span />
            )}
            <span className="tour__nav">
              {index > 0 ? (
                <Button size="small" onClick={() => go(-1)}>
                  Back
                </Button>
              ) : null}
              <Button ref={primaryRef} variant="primary" size="small" onClick={() => go(1)}>
                {primary}
              </Button>
            </span>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
