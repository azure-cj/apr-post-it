import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { postLinkProblem } from '@/core/links';
import { normalize } from '@/core/matcher';
import type { Assignment, AssignmentStatus, PostLogEntry, Property } from '@/core/types';
import { Button, CategoryDot, EmptyState, Notice, Pill, TextInput, categoryKind, categoryLabel } from '../../components';
import {
  manilaTime,
  paths,
  sentenceOf,
  useApp,
  useAssignments,
  useDirectoryList,
  useNotify,
  usePosts,
  useUser,
  type FromList,
} from '../../state';
import { longDate } from './format';
import { Waiting } from './shared';
import './QueueScreen.css';

const FROM_QUEUE: FromList = { section: 'queue' };

interface Item {
  readonly assignment: Assignment;
  /** The listing in the directory, when it is still there. */
  readonly property: Property | undefined;
  /** Today's post of it by you: the pending one, or the live one. */
  readonly post: PostLogEntry | undefined;
}

const STATUS_WORD: Record<AssignmentStatus, string> = { 'To post': 'To post', Pending: 'Pending', Posted: 'Posted' };
const STATUS_TONE = { 'To post': 'neutral', Pending: 'warn', Posted: 'ok' } as const;

/**
 * Today's queue, in the order the admin set. The next one to post sits on top
 * with the screen's one gold button; every row opens its listing in one click.
 */
export function QueueScreen() {
  const app = useApp();
  const user = useUser();
  const navigate = useNavigate();
  const queue = useAssignments({ maxAgeMs: 15_000, pollMs: 60_000 });
  const posts = usePosts({ maxAgeMs: 15_000 });
  const list = useDirectoryList();
  const today = app.today();

  const items = useMemo((): readonly Item[] => {
    const mine = (queue.data ?? []).filter((a) => a.date === today && a.assignedTo === user.name);
    const todays = (posts.data ?? []).filter((p) => p.date === today && p.postedBy === user.name);
    // A queue item names its listing by folder id, and by name when an older row has no id.
    const byName = new Map((list ?? []).map((p) => [normalize(p.name), p]));
    const rows = mine.map((assignment): Item => {
      const property =
        (assignment.propertyId ? app.directory.get(assignment.propertyId) : undefined) ??
        byName.get(normalize(assignment.propertyName));
      return { assignment, property, post: latestPostOf(todays, assignment) };
    });
    // Pending first (one click once approved), then what is left, then what is done: each in the admin's order.
    const rank = { Pending: 0, 'To post': 1, Posted: 2 } as const;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => rank[a.row.assignment.status] - rank[b.row.assignment.status] || a.index - b.index)
      .map(({ row }) => row);
  }, [queue.data, posts.data, list, today, user.name, app.directory]);

  const toPost = items.filter((i) => i.assignment.status === 'To post');
  const pending = items.filter((i) => i.assignment.status === 'Pending');
  const posted = items.filter((i) => i.assignment.status === 'Posted');
  const next = toPost.find((i) => openable(i, list !== null));
  const rest = items.filter((i) => i !== next);

  const reload = () => {
    queue.reload();
    posts.reload();
  };

  return (
    <div className="page queue">
      <header className="page-header">
        <div className="page-header__row queue__title-row">
          <h1 className="page-header__title" tabIndex={-1}>
            My queue
          </h1>
          <div className="queue__freshness">
            {queue.loading ? (
              <Waiting>{queue.data ? 'Checking…' : 'Loading…'}</Waiting>
            ) : queue.loadedAt !== null ? (
              <>
                <span className="meta">Updated {manilaTime(queue.loadedAt)}</span>
                <Button variant="quiet" size="small" onClick={reload}>
                  Refresh
                </Button>
              </>
            ) : null}
          </div>
        </div>
        <div className="queue__sub">
          <span className="meta">{longDate(today)}</span>
          {items.length > 0 ? (
            <ul className="queue__counts" aria-label="Today's counts">
              <li>
                <span className="tabular">{toPost.length}</span> to post
              </li>
              <li className="queue__count--pending">
                <span className="tabular">{pending.length}</span> pending
              </li>
              <li className="queue__count--posted">
                <span className="tabular">{posted.length}</span> posted
              </li>
            </ul>
          ) : null}
        </div>
      </header>

      {queue.data === null ? (
        queue.error && !queue.loading ? (
          <Notice
            tone="danger"
            live
            title="Your queue didn't load"
            action={
              <Button size="small" onClick={reload}>
                Try again
              </Button>
            }
          >
            {queue.error}
          </Notice>
        ) : (
          <Waiting className="queue__loading">Loading today's queue…</Waiting>
        )
      ) : items.length === 0 ? (
        <EmptyState title="Nothing in your queue today" action={<Button onClick={() => navigate(paths.find)}>Find a property</Button>}>
          You can still find a listing and post it.
        </EmptyState>
      ) : (
        <div className="queue__body">
          {queue.error && !queue.loading ? (
            <Notice tone="warn" title="May be out of date">
              {queue.error}
            </Notice>
          ) : null}
          {posts.error && !posts.data ? <Notice tone="warn">{posts.error}</Notice> : null}

          {next ? (
            <NextUp item={next} />
          ) : toPost.length === 0 && pending.length === 0 ? (
            <Notice tone="ok" title="Queue done">
              All {items.length} posted.
            </Notice>
          ) : null}

          {rest.length > 0 ? (
            <ol className="queue__list" aria-label={next ? 'The rest of today' : 'Today'}>
              {rest.map((item) => (
                <Row
                  key={`${item.assignment.propertyId || item.assignment.propertyName}-${item.assignment.status}`}
                  item={item}
                  listLoaded={list !== null}
                  onChanged={reload}
                />
              ))}
            </ol>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The listing's folder id, when it can be opened. */
function idOf(item: Item): string {
  return item.property?.id ?? item.assignment.propertyId;
}

/** Opened by its folder id; until the list arrives, the queue's own id stands in. */
function openable(item: Item, listLoaded: boolean): boolean {
  return idOf(item) !== '' && !(listLoaded && !item.property);
}

/** The next one to post: the whole card opens it, and it carries the screen's one gold button. */
function NextUp({ item }: { readonly item: Item }) {
  const { assignment, property } = item;
  return (
    <section className="next-up" aria-label="Next up">
      <Link className="next-up__open" to={paths.property(idOf(item))} state={FROM_QUEUE}>
        <span className="next-up__main">
          <span className="next-up__label">Next up</span>
          <span className="next-up__name">{property?.name ?? assignment.propertyName}</span>
          {property ? <Category property={property} /> : null}
        </span>
        <span className="button button--primary queue__go" aria-hidden="true">
          <span className="button__label">Open</span>
        </span>
        <span className="visually-hidden">, next to post</span>
      </Link>
    </section>
  );
}

/** One queue item: name, category, status. The name's link covers the row, so one click opens it. */
function Row({ item, listLoaded, onChanged }: { readonly item: Item; readonly listLoaded: boolean; readonly onChanged: () => void }) {
  const { assignment, property, post } = item;
  const { status } = assignment;
  const canOpen = openable(item, listLoaded);
  const name = property?.name ?? assignment.propertyName;

  return (
    <li className={`queue-item queue-item--${status === 'To post' ? 'to-post' : status.toLowerCase()}${canOpen ? ' queue-item--link' : ''}`}>
      <div className="queue-item__main">
        {canOpen ? (
          <Link className="queue-item__name queue-item__stretch" to={paths.property(idOf(item))} state={FROM_QUEUE}>
            {name}
          </Link>
        ) : (
          <span className="queue-item__name">{name}</span>
        )}
        {property ? (
          <Category property={property} />
        ) : listLoaded ? (
          <span className="meta">Not in the property list. Tell your admin.</span>
        ) : null}
      </div>
      <div className="queue-item__end">
        <Pill tone={STATUS_TONE[status]} dot>
          {STATUS_WORD[status]}
        </Pill>
        {status === 'Pending' ? <PendingActions item={item} onChanged={onChanged} /> : null}
        {status === 'Posted' && post?.postLink ? <ViewPost link={post.postLink} /> : null}
      </div>
    </li>
  );
}

function Category({ property }: { readonly property: Property }) {
  return (
    <span className="queue-item__category">
      <CategoryDot kind={categoryKind(property.category)} />
      {categoryLabel(property.category)}
    </span>
  );
}

/**
 * Approved by the group admin: one click marks it posted, since its link was
 * logged with it. An old pending row logged without a link asks for it first.
 */
function PendingActions({ item, onChanged }: { readonly item: Item; readonly onChanged: () => void }) {
  const app = useApp();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const { assignment, post } = item;
  const needsLink = post !== undefined && !post.postLink.trim();

  const markPosted = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await app.tracker.setStatus(assignment, 'Posted');
      notify(`Marked posted: ${assignment.propertyName}.`);
      onChanged();
    } catch (err) {
      setError(sentenceOf(err));
      setBusy(false);
    }
  };

  const addLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !post) return;
    const live = link.trim();
    const problem = live ? postLinkProblem(live) : 'Paste the post link.';
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await app.tracker.addLink(post, live);
      notify(`Marked posted: ${assignment.propertyName}.`);
      onChanged();
    } catch (err) {
      setError(sentenceOf(err));
      setBusy(false);
    }
  };

  if (needsLink) {
    return (
      <form className="queue-item__form" onSubmit={(e) => void addLink(e)} noValidate>
        <TextInput
          label="Post link"
          type="url"
          inputMode="url"
          placeholder="https://www.facebook.com/…"
          autoComplete="off"
          spellCheck={false}
          value={link}
          readOnly={busy}
          error={error ?? undefined}
          onChange={(event) => {
            setLink(event.target.value);
            if (error) setError(null);
          }}
        />
        <Button type="submit" size="small" busy={busy}>
          {busy ? 'Saving…' : 'Mark posted'}
        </Button>
      </form>
    );
  }

  return (
    <>
      {post?.postLink ? <ViewPost link={post.postLink} /> : null}
      <Button size="small" busy={busy} onClick={() => void markPosted()} aria-label={`Mark ${assignment.propertyName} posted`}>
        {busy ? 'Saving…' : 'Mark posted'}
      </Button>
      {error ? (
        <p className="queue-item__error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function ViewPost({ link }: { readonly link: string }) {
  const app = useApp();
  const notify = useNotify();
  const view = async () => {
    try {
      await app.platform.open(link);
    } catch (err) {
      notify(sentenceOf(err), 'danger');
    }
  };
  return (
    <Button size="small" variant="quiet" onClick={() => void view()}>
      View post
    </Button>
  );
}

/** Today's post of this queue item: by folder id where both have one, else by name. The latest wins. */
function latestPostOf(todays: readonly PostLogEntry[], assignment: Assignment): PostLogEntry | undefined {
  const key = normalize(assignment.propertyName);
  const wanted = assignment.status === 'Pending' ? 'Pending' : 'Posted';
  let found: PostLogEntry | undefined;
  for (const post of todays) {
    const same =
      assignment.propertyId !== '' && post.propertyId !== ''
        ? post.propertyId === assignment.propertyId
        : normalize(post.title) === key;
    if (same && post.status === wanted) found = post;
  }
  return found;
}
