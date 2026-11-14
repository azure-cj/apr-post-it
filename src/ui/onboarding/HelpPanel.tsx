import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon } from '../components';
import { placeCard } from './place';
import { findTarget } from './TourOverlay';
import type { Task } from './tours';
import './onboarding.css';

/**
 * Help, from the sidebar: the getting-started list with how far along the
 * person is, Show me for each thing, the tours again, and What's new. Each
 * item ticks itself off when the person really does it. Esc, ✕ or a click
 * outside closes it.
 */
export function HelpPanel({
  tasks,
  done,
  listHidden,
  onListPage,
  onShow,
  onTour,
  onListingTour,
  onWhatsNew,
  onHideList,
  onShowList,
  onClose,
}: {
  readonly tasks: readonly Task[];
  readonly done: (task: Task) => boolean;
  readonly listHidden: boolean;
  /** On a listing's page: its tour is offered. */
  readonly onListPage: boolean;
  readonly onShow: (task: Task) => void;
  readonly onTour: () => void;
  readonly onListingTour: () => void;
  readonly onWhatsNew: (() => void) | undefined;
  readonly onHideList: () => void;
  readonly onShowList: () => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [at, setAt] = useState({ top: 0, left: 0 });
  const count = tasks.filter(done).length;
  const allDone = count === tasks.length;

  // Beside the Help button, inside the window.
  useLayoutEffect(() => {
    const panel = ref.current;
    const anchor = findTarget('help');
    const r = anchor?.getBoundingClientRect();
    const box = r && r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
    const placed = placeCard(box, { width: panel?.offsetWidth || 360, height: panel?.offsetHeight || 420 }, {
      width: window.innerWidth || 1280,
      height: window.innerHeight || 800,
    });
    setAt((prev) => (prev.top === placed.top && prev.left === placed.left ? prev : { top: placed.top, left: placed.left }));
  });

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
    const before = findTarget('help');
    const onDown = (event: MouseEvent) => {
      const t = event.target;
      if (!(t instanceof Node) || ref.current?.contains(t) || before?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="help"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={{ top: at.top, left: at.left }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="help__head">
        <h2 id={titleId} className="help__title">
          {listHidden ? 'Help' : allDone ? "You're all set" : 'Getting started'}
        </h2>
        <button type="button" className="tour__close" aria-label="Close help" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>

      {listHidden ? null : (
        <>
          <div className="help__progress">
            <span className="meta tabular">
              {count} of {tasks.length} done
            </span>
            <span
              className="help__bar"
              role="progressbar"
              aria-label="Getting started"
              aria-valuemin={0}
              aria-valuemax={tasks.length}
              aria-valuenow={count}
            >
              <span className="help__fill" style={{ width: `${(count / tasks.length) * 100}%` }} />
            </span>
          </div>
          <ol className="help__tasks">
            {tasks.map((task) => {
              const ticked = done(task);
              return (
                <li key={task.id} className={`help__task${ticked ? ' help__task--done' : ''}`}>
                  <span className="help__mark" aria-hidden="true">
                    {ticked ? <Icon name="check" size={14} /> : null}
                  </span>
                  <span className="help__text">
                    <span className="help__label">
                      {task.label}
                      <span className="visually-hidden">{ticked ? ': done' : ': to do'}</span>
                    </span>
                    <span className="help__why meta">{task.why}</span>
                  </span>
                  {ticked ? null : (
                    <Button size="small" variant="quiet" onClick={() => onShow(task)} aria-label={`Show me: ${task.label}`}>
                      Show me
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="help__more">
        <Button ref={firstRef} size="small" onClick={onTour}>
          Take the tour
        </Button>
        {onListPage ? (
          <Button size="small" onClick={onListingTour}>
            Tour this page
          </Button>
        ) : null}
        {onWhatsNew ? (
          <Button size="small" variant="quiet" onClick={onWhatsNew}>
            What's new
          </Button>
        ) : null}
      </div>
      <div className="help__foot">
        {listHidden ? (
          <Button size="small" variant="link" onClick={onShowList}>
            Show the getting-started list
          </Button>
        ) : (
          <Button size="small" variant="link" onClick={onHideList}>
            Hide this list
          </Button>
        )}
      </div>
    </div>,
    document.body,
  );
}
