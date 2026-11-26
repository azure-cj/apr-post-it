import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon, SearchBox } from '../components';
import { GUIDE_GROUPS, matchesTopic, type GuideTopic } from './guide';
import { placeCard } from './place';
import { findTarget } from './TourOverlay';
import type { Task } from './tours';
import './onboarding.css';

/**
 * Help, from the sidebar: the getting-started list with how far along the
 * person is, Show me for each thing, the tours again, the guide (how to do
 * each thing, and what to do when something goes wrong), and What's new.
 * Each item ticks itself off when the person really does it. Esc, ✕ or a
 * click outside closes it.
 */
export function HelpPanel({
  tasks,
  done,
  listHidden,
  pageTour,
  onListPage,
  topics,
  onShow,
  onTour,
  onTopic,
  onWhatsNew,
  onHideList,
  onShowList,
  onClose,
}: {
  readonly tasks: readonly Task[];
  readonly done: (task: Task) => boolean;
  readonly listHidden: boolean;
  /** The tour of the screen the person is on, when it has one. */
  readonly pageTour: (() => void) | undefined;
  /** On a listing's page: a topic shown on a listing offers Show me only there. */
  readonly onListPage: boolean;
  /** The guide's topics for this person's role. */
  readonly topics: readonly GuideTopic[];
  readonly onShow: (task: Task) => void;
  readonly onTour: () => void;
  /** A topic's Show me. */
  readonly onTopic: (topic: GuideTopic) => void;
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
  const [query, setQuery] = useState('');
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const found = useMemo(() => topics.filter((t) => matchesTopic(t, query)), [topics, query]);
  const searching = query.trim() !== '';

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
        {pageTour ? (
          <Button size="small" onClick={pageTour}>
            Tour this page
          </Button>
        ) : null}
        {onWhatsNew ? (
          <Button size="small" variant="quiet" onClick={onWhatsNew}>
            What's new
          </Button>
        ) : null}
      </div>
      <section className="help__guide" aria-labelledby={`${titleId}-guide`}>
        <h3 id={`${titleId}-guide`} className="help__sub">
          How do I…
        </h3>
        <SearchBox label="Search help" placeholder="Search help" value={query} onValueChange={setQuery} />
        {found.length === 0 ? (
          <p className="help__none meta">Nothing matches. Try another word, like photos, link or flyer.</p>
        ) : (
          GUIDE_GROUPS.map((group) => {
            const inGroup = found.filter((t) => t.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} className="help__group">
                <h4 className="help__group-title meta">{group}</h4>
                <ul className="help__topics">
                  {inGroup.map((topic) => {
                    const open = searching ? found.length <= 3 || openTopic === topic.id : openTopic === topic.id;
                    const bodyId = `${titleId}-${topic.id}`;
                    return (
                      <li key={topic.id} className={`help__topic${open ? ' is-open' : ''}`}>
                        <button
                          type="button"
                          className="help__topic-head"
                          aria-expanded={open}
                          aria-controls={bodyId}
                          onClick={() => setOpenTopic(openTopic === topic.id && open ? null : topic.id)}
                        >
                          <span className="help__caret" aria-hidden="true" />
                          <span>{topic.title}</span>
                        </button>
                        <div id={bodyId} className="help__topic-body" hidden={!open}>
                          <ol>
                            {topic.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                          {topic.show && (!topic.onListing || onListPage) ? (
                            <Button size="small" variant="quiet" onClick={() => onTopic(topic)} aria-label={`Show me: ${topic.title}`}>
                              Show me
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </section>

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
