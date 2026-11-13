import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { postLinkProblem } from '@/core/links';
import { normalize } from '@/core/matcher';
import { currentQueue, rowsOf, type QueuePeriod } from '@/core/queues';
import { fridayWarning, fridayWarningWords, isDate, queueProgress, samePerson, waitingPosts } from '@/core/summary';
import { queueStatus, type Assignment, type AssignmentStatus, type PostLogEntry, type Property } from '@/core/types';
import { Button, CategoryDot, EmptyState, Notice, PAGE_SIZE, Pagination, Pill, TextInput, categoryKind, categoryLabel, usePaged } from '../../components';
import {
  manilaTime,
  paths,
  sentenceOf,
  useApp,
  useAssignments,
  useDirectoryList,
  useHighlights,
  useNotify,
  usePosts,
  useUser,
  type FromList,
} from '../../state';
import { shortDate } from './format';
import { Waiting } from './shared';
import { Highlighted } from './Highlighted';
import { WaitingPosts } from './WaitingPosts';
import './QueueScreen.css';

const FROM_QUEUE: FromList = { section: 'queue' };

interface Item {
  readonly assignment: Assignment;
  /** The listing in the directory, when it is still there. */
  readonly property: Property | undefined;
  /** Your post of it this week: the pending one, or the live one. */
  readonly post: PostLogEntry | undefined;
  /** Where it is: its own status, or your post's when the queue's row lags. */
  readonly status: AssignmentStatus;
}

// The interns' own word for a slot not posted yet, in sentence case.
const STATUS_WORD: Record<AssignmentStatus, string> = { 'Not Shared': 'Not shared', Pending: 'Pending', Posted: 'Posted' };
const STATUS_TONE = { 'Not Shared': 'neutral', Pending: 'warn', Posted: 'ok' } as const;

/**
 * Your queue now, in the order the admin set, due on its own deadline (v14:
 * a queue runs 1 to 3 weeks of working days). Once it is over, the next one
 * the admin has set, if any. The next one to post sits on top with the
 * screen's one gold button; every row opens its listing in one click.
 */
export function QueueScreen() {
  const app = useApp();
  const user = useUser();
  const navigate = useNavigate();
  const queue = useAssignments({ maxAgeMs: 15_000, pollMs: 60_000 });
  const posts = usePosts({ maxAgeMs: 15_000 });
  const list = useDirectoryList();
  // 1.1.6: what the admins want advertised first. Not loaded, or failed: nothing shown.
  const highlights = useHighlights({ maxAgeMs: 60_000 });
  const today = app.today();

  // The queue running today, else the next to start.
  const period = useMemo(() => currentQueue(user.name, queue.data ?? [], today), [user.name, queue.data, today]);
  const upcoming = period !== undefined && today < period.start;

  const items = useMemo((): readonly Item[] => {
    if (!period) return [];
    const mine = rowsOf(user.name, period.key, queue.data ?? []);
    // Your posts while it runs.
    const thisWeek = (posts.data ?? []).filter(
      (p) => isDate(p.date) && p.date >= period.start && p.date <= period.due && samePerson(p.postedBy, user.name),
    );
    // A queue item names its listing by folder id, and by name when an older row has no id.
    const byName = new Map((list ?? []).map((p) => [normalize(p.name), p]));
    const rows = mine.map((assignment): Item => {
      const property =
        (assignment.propertyId ? app.directory.get(assignment.propertyId) : undefined) ??
        byName.get(normalize(assignment.propertyName));
      const own = queueStatus(assignment.status);
      const post = latestPostOf(thisWeek, assignment, own);
      // Posted on Facebook, and the queue's row not yet told: count it as the tracker does.
      const status = own === 'Not Shared' && post ? post.status : own;
      return { assignment, property, post, status };
    });
    // Pending first (one click once approved), then what is left, then what is done: each in the admin's order.
    const rank = { Pending: 0, 'Not Shared': 1, Posted: 2 } as const;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => rank[a.row.status] - rank[b.row.status] || a.index - b.index)
      .map(({ row }) => row);
  }, [queue.data, posts.data, list, period, user.name, app.directory]);

  const progress = useMemo(
    () => queueProgress(user.name, period, queue.data ?? [], posts.data ?? [], today),
    [user.name, period, queue.data, posts.data, today],
  );
  // Warnings before the deadline: from the queue's third working day, when behind, what is left and how many a day.
  const behind = queue.data !== null && period ? fridayWarning(progress, period.key, today) : null;

  // Pending posts this week's queue doesn't already show: earlier weeks', and ones logged from Find.
  const waiting = useMemo(() => {
    const shown = new Set(items.map((i) => i.post).filter(Boolean));
    return waitingPosts(posts.data ?? [], user.name, today).filter((w) => !shown.has(w.post));
  }, [items, posts.data, user.name, today]);

  const toPost = items.filter((i) => i.status === 'Not Shared');
  const pending = items.filter((i) => i.status === 'Pending');
  const posted = items.filter((i) => i.status === 'Posted');
  const next = toPost.find((i) => openable(i, list !== null));
  const rest = items.filter((i) => i !== next);
  // A week can hold forty: ten a page. The page stays put as items move between groups.
  const paged = usePaged(rest);

  const reload = () => {
    queue.reload();
    posts.reload();
    highlights.reload();
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
        {queue.data !== null && items.length > 0 && period ? (
          <WeekHeader
            upcoming={upcoming}
            period={period}
            today={today}
            done={progress.posted + progress.pending}
            posted={progress.posted}
            pending={progress.pending}
            target={progress.target}
          />
        ) : null}
      </header>

      {behind ? (
        <Notice tone="warn" title="Behind schedule" className="queue__behind">
          {fridayWarningWords(behind)}
        </Notice>
      ) : null}

      <Highlighted highlights={highlights.data ?? []} from={FROM_QUEUE} />

      <WaitingPosts waiting={waiting} onChanged={reload} />

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
          <Waiting className="queue__loading">Loading your queue…</Waiting>
        )
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing in your queue"
          action={<Button onClick={() => navigate(paths.find)}>Find a property</Button>}
        >
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
            <ol
              className="queue__list"
              aria-label={next ? 'The rest of the queue' : 'This queue'}
              ref={paged.topRef}
              start={(paged.page - 1) * PAGE_SIZE + 1}
            >
              {paged.items.map((item) => (
                <Row
                  key={`${item.assignment.propertyId || item.assignment.propertyName}-${item.status}`}
                  item={item}
                  listLoaded={list !== null}
                  onChanged={reload}
                />
              ))}
            </ol>
          ) : null}
          <Pagination {...paged.pagination} className="queue__pages" />
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
  const { assignment, property, post, status } = item;
  const canOpen = openable(item, listLoaded);
  const name = property?.name ?? assignment.propertyName;

  return (
    <li className={`queue-item queue-item--${status === 'Not Shared' ? 'to-post' : status.toLowerCase()}${canOpen ? ' queue-item--link' : ''}`}>
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

/** Your post of this queue item this week: by folder id where both have one, else by name. The latest wins. */
function latestPostOf(posts: readonly PostLogEntry[], assignment: Assignment, status: AssignmentStatus): PostLogEntry | undefined {
  const key = normalize(assignment.propertyName);
  const wanted = status === 'Pending' ? ['Pending'] : status === 'Posted' ? ['Posted'] : ['Posted', 'Pending'];
  let found: PostLogEntry | undefined;
  for (const post of posts) {
    const same =
      assignment.propertyId !== '' && post.propertyId !== ''
        ? post.propertyId === assignment.propertyId
        : normalize(post.title) === key;
    if (same && wanted.includes(post.status)) found = post;
  }
  return found;
}

interface WeekHeaderProps {
  /** The queue shown hasn't started yet. */
  readonly upcoming: boolean;
  /** When it runs. */
  readonly period: QueuePeriod;
  readonly today: string;
  /** Posted and pending: what counts toward the week. */
  readonly done: number;
  readonly posted: number;
  readonly pending: number;
  readonly target: number;
}

/** "This queue · 12 of 80", a bar, and when it is due: its deadline, today, or (before it starts) when it starts. */
function WeekHeader({ upcoming, period, today, done, posted, pending, target }: WeekHeaderProps) {
  const due = period.due;
  const share = (n: number) => `${target === 0 ? 0 : Math.min(100, (n / target) * 100)}%`;
  return (
    <div className="queue__week">
      <div className="queue__week-row">
        <p className="queue__week-title">
          {upcoming ? 'Next queue' : 'This queue'}
          <span className="queue__week-count tabular">
            {' · '}
            {done} of {target}
          </span>
        </p>
        {upcoming ? (
          <span className="queue__due">
            Starts {shortDate(period.start)} · due {shortDate(due)}
          </span>
        ) : today === due ? (
          <span className="queue__due queue__due--today">Due today</span>
        ) : (
          <span className="queue__due">Due {shortDate(due)}</span>
        )}
      </div>
      <div className="queue__bar" aria-hidden="true">
        <span className="queue__bar-posted" style={{ width: share(posted) }} />
        <span className="queue__bar-pending" style={{ width: share(pending) }} />
      </div>
      <ul className="queue__counts" aria-label="This queue's counts">
        <li className="queue__count--posted">
          <span className="tabular">{posted}</span> posted
        </li>
        <li className="queue__count--pending">
          <span className="tabular">{pending}</span> pending
        </li>
        <li>
          <span className="tabular">{Math.max(0, target - done)}</span> not shared
        </li>
      </ul>
    </div>
  );
}
