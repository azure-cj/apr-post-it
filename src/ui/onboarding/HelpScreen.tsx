import { useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Icon, SearchBox } from '../components';
import { GUIDE_GROUPS, matchesTopic, type GuideTopic } from './guide';
import { useOnboarding, type HelpApi } from './Onboarding';
import './onboarding.css';
import './HelpScreen.css';

/**
 * The Help page (1.1.8), from Help in the sidebar: search, the getting-started
 * list, every tour, and the guide. A topic opens beside the list with its
 * steps, and Show me on screen walks the person through it where it happens.
 * The topic open is in the address (`?topic=`), so Back returns to it.
 */
export function HelpScreen() {
  const { help } = useOnboarding();
  return (
    <div className="page help-page">
      <header className="page-header">
        <h1 className="page-header__title" tabIndex={-1}>
          Help
        </h1>
      </header>
      {help ? <HelpContent help={help} /> : <p className="meta">Opening Help…</p>}
    </div>
  );
}

function HelpContent({ help }: { readonly help: HelpApi }) {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const found = useMemo(() => help.topics.filter((t) => matchesTopic(t, query)), [help.topics, query]);
  const asked = params.get('topic');
  // The topic in the address, while it is among the results; else the first result.
  const topic = found.find((t) => t.id === asked) ?? found[0] ?? null;
  const detailRef = useRef<HTMLElement>(null);
  const guideId = useId();

  const pick = (next: GuideTopic) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('topic', next.id);
        return p;
      },
      { replace: true },
    );
    // Stacked on a narrow window, the steps are below the list: bring them into view.
    detailRef.current?.scrollIntoView?.({ block: 'nearest' });
  };

  return (
    <>
      <div className="help-page__search">
        <SearchBox label="Search help" placeholder="Search help: photos, link, flyer…" value={query} onValueChange={setQuery} />
      </div>

      {searching ? null : (
        <div className="help-page__cards">
          <GettingStarted help={help} />
          <Tours help={help} />
        </div>
      )}

      <section className="help-page__guide" aria-labelledby={guideId}>
        <h2 id={guideId} className="help-page__heading">
          {searching ? `${found.length === 1 ? '1 topic' : `${found.length} topics`} for “${query.trim()}”` : 'How do I…'}
        </h2>
        {found.length === 0 ? (
          <p className="meta">Nothing matches. Try another word, like photos, link or flyer.</p>
        ) : (
          <div className="help-page__split">
            <nav className="help-page__topics" aria-label="Topics">
              {GUIDE_GROUPS.map((group) => {
                const inGroup = found.filter((t) => t.group === group);
                if (inGroup.length === 0) return null;
                return (
                  <div key={group} className="help-page__group">
                    <h3 className="help-page__group-title meta">{group}</h3>
                    <ul>
                      {inGroup.map((t) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            className="help-page__topic"
                            aria-current={t.id === topic?.id ? 'true' : undefined}
                            onClick={() => pick(t)}
                          >
                            {t.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </nav>
            {topic ? (
              <article ref={detailRef} className="help-page__detail" aria-labelledby={`${guideId}-topic`}>
                <p className="help-page__group-title meta">{topic.group}</p>
                <h3 id={`${guideId}-topic`} className="help-page__topic-title">
                  {topic.title}
                </h3>
                <ol className="help-page__steps">
                  {topic.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <Button variant="primary" onClick={() => help.showTopic(topic)} aria-label={`Show me on screen: ${topic.title}`}>
                  Show me on screen
                </Button>
                <p className="help-page__note meta">It goes to the right screen and lights up each button. Nothing is posted or saved.</p>
              </article>
            ) : null}
          </div>
        )}
      </section>
    </>
  );
}

function GettingStarted({ help }: { readonly help: HelpApi }) {
  const titleId = useId();
  const { tasks, done } = help;
  const count = tasks.filter(done).length;
  if (help.listHidden || tasks.length === 0) {
    return (
      <section className="help-page__card help-page__card--quiet" aria-label="Getting started">
        <Button size="small" variant="link" onClick={() => help.setListHidden(false)}>
          Show the getting-started list
        </Button>
      </section>
    );
  }
  return (
    <section className="help-page__card" aria-labelledby={titleId}>
      <div className="help-page__card-head">
        <h2 id={titleId} className="help-page__heading">
          {count === tasks.length ? "You're all set" : 'Getting started'}
        </h2>
        <span className="meta tabular">
          {count} of {tasks.length} done
        </span>
      </div>
      <span className="help__bar" role="progressbar" aria-label="Getting started" aria-valuemin={0} aria-valuemax={tasks.length} aria-valuenow={count}>
        <span className="help__fill" style={{ width: `${(count / tasks.length) * 100}%` }} />
      </span>
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
                <span className="meta">{task.why}</span>
              </span>
              {ticked ? null : (
                <Button size="small" variant="quiet" onClick={() => help.showTask(task)} aria-label={`Show me: ${task.label}`}>
                  Show me
                </Button>
              )}
            </li>
          );
        })}
      </ol>
      <Button size="small" variant="link" onClick={() => help.setListHidden(true)}>
        Hide this list
      </Button>
    </section>
  );
}

function Tours({ help }: { readonly help: HelpApi }) {
  const titleId = useId();
  return (
    <section className="help-page__card" aria-labelledby={titleId}>
      <div className="help-page__card-head">
        <h2 id={titleId} className="help-page__heading">
          Tours
        </h2>
        {help.whatsNew ? (
          <Button size="small" variant="quiet" onClick={help.whatsNew}>
            What's new
          </Button>
        ) : null}
      </div>
      <ul className="help-page__tours">
        {help.tours.map((tour) => (
          <li key={tour.id}>
            <button type="button" className="help-page__tour" onClick={() => help.takeTour(tour.id)} aria-label={`Take the tour: ${tour.label}`}>
              <span className="help-page__tour-name">{tour.label}</span>
              <span className="meta">{tour.about}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
