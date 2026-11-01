import { forwardRef, useId, useState, type KeyboardEvent } from 'react';
import { Button, CategoryDot, categoryKind, Icon, Pill } from '../../components';
import { cooldown } from '@/core/cooldown';
import { clockTime } from '@/core/records';
import { plural, shortDate, type HeldListing } from '@/core/summary';
import type { PostLogEntry } from '@/core/types';
import { weekLabel } from '@/core/week';
import './InternsParts.css';
import './InternsScreen.css';

/** Posts shown before "Show all". */
export const HISTORY_LIMIT = 8;

export interface RecordsHistoryProps {
  readonly title: string;
  /** Property type, as the newest post has it. */
  readonly type: string;
  /** Every post of the listing, newest first (postsForProperty). */
  readonly posts: readonly PostLogEntry[];
  /** Who holds it in an open queue now, if anyone (heldBy). */
  readonly held: HeldListing | undefined;
  readonly today: string;
  readonly cooldownDays: number;
  readonly onClose: () => void;
  readonly onOpenLink?: ((url: string) => void) | undefined;
}

/**
 * One listing's whole record beside the list: whether it can be posted
 * again, who holds it now, then every post, newest first, with who, when,
 * as which FB account, and the link. Escape or Close shuts it.
 */
export const RecordsHistory = forwardRef<HTMLHeadingElement, RecordsHistoryProps>(function RecordsHistory(
  { title, type, posts, held, today, cooldownDays, onClose, onOpenLink },
  headingRef,
) {
  const titleId = useId();
  const listId = useId();
  const [all, setAll] = useState(false);
  const last = posts[0];
  const state = cooldown(last?.date, today, { cooldownDays });
  const shown = all ? posts : posts.slice(0, HISTORY_LIMIT);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };

  return (
    <aside className="intern-panel record-history" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <div className="record-history__head">
        <h2 id={titleId} ref={headingRef} className="intern-panel__name record-history__title" tabIndex={-1}>
          {title}
        </h2>
        <Button variant="quiet" size="small" className="intern-panel__close" icon={<Icon name="close" size={18} />} onClick={onClose}>
          <span className="visually-hidden">Close</span>
        </Button>
      </div>

      <div className="record-history__tags">
        {state.blocked ? (
          <Pill tone="danger" dot>
            In cooldown
          </Pill>
        ) : (
          <Pill tone="ok" dot>
            Ready to post
          </Pill>
        )}
        <span className="record-history__type">
          <CategoryDot kind={categoryKind(type)} />
          {type || 'Unsorted'}
        </span>
      </div>

      <dl className="record-history__facts">
        <div>
          <dt>Can post again</dt>
          <dd>{state.blocked && state.nextAllowed ? shortDate(state.nextAllowed) : 'Now'}</dd>
        </div>
        <div>
          <dt>Queued</dt>
          <dd>
            {held ? (
              <>
                {held.heldBy} <span className="record-history__note">· {weekLabel(held.week)}</span>
              </>
            ) : (
              <span className="record-history__note">No one</span>
            )}
          </dd>
        </div>
      </dl>

      <section className="record-history__posts" aria-labelledby={`${titleId}-posts`}>
        <h3 id={`${titleId}-posts`} className="panel-group__title">
          Posts <span className="panel-group__count tabular">{posts.length}</span>
        </h3>
        {posts.length === 0 ? (
          <p className="record-history__note">Never posted</p>
        ) : (
          <ol className="record-history__list" id={listId}>
            {shown.map((post, i) => (
              <li key={`${i}-${post.date}-${post.time}`} className="history-post">
                <span className="history-post__when tabular">
                  {shortDate(post.date)}
                  {post.time ? `, ${clockTime(post.time)}` : ''}
                </span>
                <span className="history-post__end">
                  <Pill tone={post.status === 'Posted' ? 'ok' : 'warn'}>{post.status}</Pill>
                  {post.postLink && onOpenLink ? (
                    <Button variant="link" onClick={() => onOpenLink(post.postLink)} aria-label={`Open the post of ${shortDate(post.date)}`}>
                      Open
                    </Button>
                  ) : null}
                </span>
                <span className="history-post__who">
                  {post.postedBy || 'Unknown'}
                  {post.fbAccount ? <span className="record-history__note"> · {post.fbAccount}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
        {posts.length > HISTORY_LIMIT ? (
          <Button variant="link" className="panel-group__more" aria-controls={listId} aria-expanded={all} onClick={() => setAll((a) => !a)}>
            {all ? 'Show fewer' : `Show all ${plural(posts.length, 'post', 'posts')}`}
          </Button>
        ) : null}
      </section>
    </aside>
  );
});
