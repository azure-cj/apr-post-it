import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { normalize } from '@/core/matcher';
import type { Assignment, PostLogEntry, Property } from '@/core/types';
import { Button, CategoryDot, EmptyState, Icon, Notice, Pill, TextInput, categoryKind } from '../../components';
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
import { count, folderLine, isFacebookLink, longDate, shortDate } from './format';
import { Waiting } from './shared';
import './QueueScreen.css';

const FROM_QUEUE: FromList = { section: 'queue' };

interface Item {
  readonly assignment: Assignment;
  /** The listing in the directory, when it is still there. */
  readonly property: Property | undefined;
  /** Today's post of it by you: the pending one waiting for its link, or the live one. */
  readonly post: PostLogEntry | undefined;
}

/**
 * Today's queue, in the order the manager set, worked top to bottom. A post
 * waiting for the group's approval stays pinned on top until its live link is
 * added here; the next one to post carries the screen's one gold button.
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
    // Pending pinned on top, then what is left to post, then what is done: each in the manager's order.
    const rank = { Pending: 0, 'To post': 1, Posted: 2 } as const;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => rank[a.row.assignment.status] - rank[b.row.assignment.status] || a.index - b.index)
      .map(({ row }) => row);
  }, [queue.data, posts.data, list, today, user.name, app.directory]);

  const toPost = items.filter((i) => i.assignment.status === 'To post');
  const pending = items.filter((i) => i.assignment.status === 'Pending');
  const posted = items.filter((i) => i.assignment.status === 'Posted');
  const next = toPost[0];

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
              <Waiting>{queue.data ? 'Checking for changes…' : "Loading today's queue…"}</Waiting>
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
        <p className="page-header__description">{longDate(today)}. In the order your admin set.</p>
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
        <EmptyState
          title="Nothing in your queue today"
          action={<Button onClick={() => navigate(paths.find)}>Find a property</Button>}
        >
          Your admin hasn't assigned anything for {shortDate(today)}. You can still find a listing and post it.
        </EmptyState>
      ) : (
        <div className="queue__body">
          {queue.error && !queue.loading ? (
            <Notice tone="warn" title="This may be out of date">
              {queue.error}
            </Notice>
          ) : null}

          <ul className="queue__stats" aria-label="Today's counts">
            <li className="stat">
              <span className="stat__value">{toPost.length}</span>
              <span className="stat__label">to post</span>
            </li>
            <li className="stat stat--pending">
              <span className="stat__value">{pending.length}</span>
              <span className="stat__label">waiting for a link</span>
            </li>
            <li className="stat stat--posted">
              <span className="stat__value">{posted.length}</span>
              <span className="stat__label">posted</span>
            </li>
          </ul>

          {toPost.length === 0 && pending.length === 0 ? (
            <Notice tone="ok" title="Your queue is done">
              All {count(items.length, 'listing', 'listings')} for today {items.length === 1 ? 'is' : 'are'} posted.
            </Notice>
          ) : null}

          {posts.error && !posts.data ? (
            <Notice tone="warn">
              {posts.error} The times and accounts of today's posts aren't shown until they load.
            </Notice>
          ) : null}

          <ol className="queue__list">
            {items.map((item) => {
              const { status } = item.assignment;
              const key = `${item.assignment.propertyId || item.assignment.propertyName}-${status}`;
              if (status === 'Pending') return <PendingRow key={key} item={item} onDone={reload} />;
              if (status === 'Posted') return <PostedRow key={key} item={item} />;
              return (
                <ToPostRow key={key} item={item} number={toPost.indexOf(item) + 1} next={item === next} listLoaded={list !== null} />
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

/** Waiting for the group to approve it: add the live link here once it is up. */
function PendingRow({ item, onDone }: { readonly item: Item; readonly onDone: () => void }) {
  const app = useApp();
  const user = useUser();
  const notify = useNotify();
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { assignment, post } = item;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const live = link.trim();
    if (!live) return setError('Paste the link of the live post.');
    if (!isFacebookLink(live)) return setError("That isn't a Facebook link. Copy the link from the date under the post.");
    setBusy(true);
    setError(null);
    try {
      // The post logged as pending; or, if its row is not in sight, one that
      // names the listing, so the server finds the row itself.
      const pendingPost: PostLogEntry = post ?? {
        date: assignment.date,
        time: '',
        type: '',
        title: assignment.propertyName,
        status: 'Pending',
        fbAccount: '',
        postLink: '',
        postedBy: user.name,
        propertyId: assignment.propertyId,
      };
      await app.tracker.addLink(pendingPost, live);
      notify(`Link added. ${assignment.propertyName} is marked posted.`);
      onDone();
    } catch (err) {
      setError(sentenceOf(err));
      setBusy(false);
    }
  };

  return (
    <li className="queue-item queue-item--pending">
      <span className="queue-item__mark queue-item__mark--pending" aria-hidden="true">
        <Icon name="warn" size={18} />
      </span>
      <div className="queue-item__main">
        <div className="queue-item__title-row">
          <Name item={item} />
          <Pill tone="warn" dot>
            Pending
          </Pill>
        </div>
        <p className="meta">
          {post ? `Logged ${post.time ? `at ${post.time} ` : ''}from ${post.fbAccount || 'an FB account'}. ` : ''}
          Waiting for the group to approve it. Add the live link once it's up.
        </p>
        <form className="queue-item__form" onSubmit={(e) => void submit(e)} noValidate>
          <TextInput
            label="Live post link"
            type="url"
            inputMode="url"
            placeholder="https://www.facebook.com/groups/…/posts/…"
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
          <Button type="submit" busy={busy}>
            {busy ? 'Adding…' : 'Add link'}
          </Button>
        </form>
      </div>
    </li>
  );
}

/** Still to post: the whole row opens the listing. The next one is the screen's one gold button. */
function ToPostRow({
  item,
  number,
  next,
  listLoaded,
}: {
  readonly item: Item;
  readonly number: number;
  readonly next: boolean;
  readonly listLoaded: boolean;
}) {
  const { assignment, property } = item;
  // Opened by its folder id; until the list arrives, the queue's own name stands in.
  const id = property?.id ?? assignment.propertyId;
  if (!id || (listLoaded && !property)) {
    return (
      <li className="queue-item queue-item--missing">
        <span className="queue-item__mark tabular" aria-hidden="true">
          {number}
        </span>
        <div className="queue-item__main">
          <span className="queue-item__name">{assignment.propertyName}</span>
          <p className="meta">This listing isn't in the property list any more. Tell your admin.</p>
        </div>
      </li>
    );
  }
  return (
    <li className="queue-item queue-item--to-post">
      <Link className="queue-item__open" to={paths.property(id)} state={FROM_QUEUE}>
        <span className="queue-item__mark tabular" aria-hidden="true">
          {number}
        </span>
        <span className="queue-item__main">
          <span className="queue-item__name">{property?.name ?? assignment.propertyName}</span>
          {property ? (
            <span className="queue-item__folder">
              <CategoryDot kind={categoryKind(property.category)} />
              {folderLine(property)}
            </span>
          ) : null}
        </span>
        <span className={`button ${next ? 'button--primary' : 'button--ghost'} button--small queue-item__go`} aria-hidden="true">
          <span className="button__label">{next ? 'Open next' : 'Open'}</span>
        </span>
        <span className="visually-hidden">{next ? ', next to post' : ', to post'}</span>
      </Link>
    </li>
  );
}

/** Done today: when, from which account, and the live post. */
function PostedRow({ item }: { readonly item: Item }) {
  const app = useApp();
  const notify = useNotify();
  const { assignment, property, post } = item;
  const view = async () => {
    if (!post?.postLink) return;
    try {
      await app.platform.open(post.postLink);
    } catch (err) {
      notify(sentenceOf(err), 'danger');
    }
  };
  return (
    <li className="queue-item queue-item--posted">
      <span className="queue-item__mark queue-item__mark--posted" aria-hidden="true">
        <Icon name="check" size={18} />
      </span>
      <div className="queue-item__main">
        <div className="queue-item__title-row">
          {property ? (
            <Link className="queue-item__name queue-item__name--link" to={paths.property(property.id)} state={FROM_QUEUE}>
              {property.name}
            </Link>
          ) : (
            <span className="queue-item__name">{assignment.propertyName}</span>
          )}
          <Pill tone="ok" dot>
            Posted
          </Pill>
        </div>
        <p className="meta">{post ? `Posted ${post.time ? `at ${post.time} ` : ''}from ${post.fbAccount || 'an FB account'}.` : 'Posted today.'}</p>
      </div>
      {post?.postLink ? (
        <Button size="small" variant="quiet" className="queue-item__view" onClick={() => void view()}>
          View post
        </Button>
      ) : null}
    </li>
  );
}

function Name({ item }: { readonly item: Item }) {
  const { property, assignment } = item;
  return property ? (
    <Link className="queue-item__name queue-item__name--link" to={paths.property(property.id)} state={FROM_QUEUE}>
      {property.name}
    </Link>
  ) : (
    <span className="queue-item__name">{assignment.propertyName}</span>
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
