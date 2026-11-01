import { useDeferredValue, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, PAGE_SIZE, Pagination, Pill, SearchBox, usePaged } from '../../components';
import { whoPosted, type WhoPostedMatch } from '@/core/records';
import { initials, type PostLogEntry } from '@/core/types';
import { lastPostWords } from './InternsParts';

/** How many answers show a page. */
export const WHO_POSTED_LIMIT = PAGE_SIZE;

export interface WhoPostedProps {
  readonly posts: readonly PostLogEntry[];
  readonly today: string;
  /** Opens a post's link in the browser. Without it, no Open button. */
  readonly onOpenLink?: ((url: string) => void) | undefined;
}

/**
 * "Who posted?": for an inquiry about a listing on Facebook. Type its name
 * or paste the post's link; the posts that match show right below, newest
 * first, with who posted it, when, as which FB account, and the link.
 * Escape clears it and closes the answers.
 */
export function WhoPosted({ posts, today, onOpenLink }: WhoPostedProps) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const matches = useMemo(() => whoPosted(posts, deferred), [posts, deferred]);
  const q = query.trim();
  const paged = usePaged(matches, WHO_POSTED_LIMIT, deferred.trim());

  const change = (value: string) => setQuery(value);

  // Escape from anywhere in the answers clears the search, back in the box.
  const onResultsKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    change('');
    inputRef.current?.focus();
  };

  return (
    <section className="who-posted" aria-label="Who posted?">
      <SearchBox
        ref={inputRef}
        className="who-posted__search"
        label="Who posted? Search by listing name or Facebook link"
        placeholder="Who posted? Listing name or Facebook link"
        value={query}
        onValueChange={change}
        aria-controls={q ? resultsId : undefined}
      />
      {q ? (
        <div className="who-posted__results" id={resultsId} onKeyDown={onResultsKey}>
          <p className="who-posted__count" role="status">
            {matches.length === 0
              ? `No post matches “${q}”`
              : matches.length === 1
                ? '1 post'
                : `${matches.length.toLocaleString('en-PH')} posts`}
          </p>
          {matches.length > 0 ? (
            <ul className="who-posted__list" ref={paged.topRef} aria-label="Posts">
              {paged.items.map((match, index) => (
                <Answer key={`${index}-${match.date}-${match.time}-${match.intern}`} match={match} today={today} onOpenLink={onOpenLink} />
              ))}
            </ul>
          ) : null}
          <Pagination {...paged.pagination} label="Posts, pages" className="who-posted__pages" />
        </div>
      ) : null}
    </section>
  );
}

function Answer({
  match,
  today,
  onOpenLink,
}: {
  readonly match: WhoPostedMatch;
  readonly today: string;
  readonly onOpenLink?: ((url: string) => void) | undefined;
}) {
  const link = match.link.trim();
  return (
    <li className="who-answer">
      <span className="who-answer__listing">{match.title}</span>
      <span className="who-answer__who">
        <span className="avatar avatar--small" aria-hidden="true">
          {initials(match.intern)}
        </span>
        <span className="who-answer__name">{match.intern}</span>
      </span>
      <span className="who-answer__when tabular">{lastPostWords(match.post, today)}</span>
      <span className="who-answer__account">{match.fbAccount || '–'}</span>
      <span className="who-answer__end">
        <Pill tone={match.status === 'Posted' ? 'ok' : 'warn'} dot>
          {match.status}
        </Pill>
        {link === '' ? (
          <span className="who-answer__nolink">No link</span>
        ) : onOpenLink ? (
          <Button size="small" onClick={() => onOpenLink(link)} aria-label={`Open the post of ${match.title} by ${match.intern}`}>
            Open
          </Button>
        ) : null}
      </span>
    </li>
  );
}
