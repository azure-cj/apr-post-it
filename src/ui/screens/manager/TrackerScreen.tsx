import { useId, useMemo, useState, type ReactNode } from 'react';
import { Badge, Button, Card, CategoryTag, Icon, Notice, Pill, Spinner } from '../../components';
import {
  addDays,
  docHealth,
  firstName,
  isBlocking,
  plural,
  shortDate,
  summarizeDay,
  type HealthGroup,
  type InternProgress,
  type IssueKind,
  type DirectoryRow,
  type RepostItem,
  type Rules,
  type TeamMember,
} from '@/core/summary';
import { initials, type Assignment, type PostLogEntry } from '@/core/types';
import { DayPicker } from './DayPicker';
import { Stat } from './Stat';
import './TrackerScreen.css';

export interface TrackerScreenProps {
  /** The day shown, yyyy-MM-dd. */
  readonly date: string;
  /** Today on the tracker's calendar, yyyy-MM-dd. */
  readonly today: string;
  /** Every Posts row. */
  readonly posts: readonly PostLogEntry[];
  /** Every Assignments row. */
  readonly assignments: readonly Assignment[];
  /** Every listing in the directory, with its Issues text when the list carries it. */
  readonly properties: readonly DirectoryRow[];
  /** The team, so an intern with no queue that day still shows. Without it, only people with a queue do. */
  readonly team?: readonly TeamMember[] | undefined;
  /** The cooldown and repost-due days. */
  readonly settings: Rules;
  /** Show another day. */
  readonly onDateChange: (date: string) => void;
  /** Read the rows again. Without it, there is no Refresh button. */
  readonly onRefresh?: (() => void) | undefined;
  readonly refreshing?: boolean | undefined;
  /** The rows are being read and haven't arrived yet. */
  readonly loading?: boolean | undefined;
  /** Why the rows couldn't be read, as a sentence. */
  readonly error?: string | null | undefined;
  /** When the rows were read, on the tracker's clock: "10:42". */
  readonly updatedAt?: string | null | undefined;
  /** Open a post's link in the browser. Without it, links are not offered. */
  readonly onOpenLink?: ((url: string) => void) | undefined;
  /** Open a listing in the app. Without it, names are plain text. */
  readonly onOpenProperty?: ((id: string) => void) | undefined;
  /** Go to Assign for this intern (null: whoever comes first) and day. */
  readonly onAssign?: ((intern: string | null, date: string) => void) | undefined;
  /** Where the Interns screen is: "See all interns" links there. Without it, no link. */
  readonly internsHref?: string | undefined;
  /** Follows that link through the app's router. Without it, the link is followed as it is. */
  readonly onOpenInterns?: (() => void) | undefined;
}

/** How many of a list show before "Show all". */
export const LIST_LIMIT = 6;

/**
 * The day at a glance, for a manager: what went out, what's waiting for the
 * group admin's approval, who's done, what's due for a repost or has never
 * been posted, and which documents need fixing. Every number is shown, zero included.
 */
export function TrackerScreen({
  date,
  today,
  posts,
  assignments,
  properties,
  team,
  settings,
  onDateChange,
  onRefresh,
  refreshing = false,
  loading = false,
  error,
  updatedAt,
  onOpenLink,
  onOpenProperty,
  onAssign,
  internsHref,
  onOpenInterns,
}: TrackerScreenProps) {
  const { cooldownDays, repostDueDays } = settings;
  const summary = useMemo(
    () => summarizeDay({ date, posts, assignments, properties, team, settings: { cooldownDays, repostDueDays } }),
    [date, posts, assignments, properties, team, cooldownDays, repostDueDays],
  );
  const health = useMemo(() => docHealth(properties), [properties]);

  const isToday = date === today;
  const day = shortDate(date);
  const nextDay = addDays(date, 1);
  const waiting = loading && posts.length === 0 && assignments.length === 0 && properties.length === 0;

  const openName = (id: string, name: string): ReactNode =>
    onOpenProperty ? (
      <Button variant="link" className="tracker__open" onClick={() => onOpenProperty(id)}>
        {name}
      </Button>
    ) : (
      name
    );

  return (
    <div className="page tracker">
      <header className="page-header tracker__header">
        <div className="tracker__heading">
          <h1 className="page-header__title" tabIndex={-1}>
            Tracker
          </h1>
        </div>
        <div className="tracker__day">
          <DayPicker date={date} today={today} onChange={onDateChange} label="Day shown" quick={['today']} />
          {onRefresh ? (
            <Button size="small" busy={refreshing} onClick={onRefresh}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          ) : null}
          {updatedAt ? <span className="tracker__updated">Updated {updatedAt}</span> : null}
        </div>
      </header>

      {error ? (
        <Notice
          tone="danger"
          live
          className="tracker__notice"
          action={
            onRefresh ? (
              <Button size="small" onClick={onRefresh}>
                Try again
              </Button>
            ) : undefined
          }
        >
          {error}
        </Notice>
      ) : null}

      {waiting ? (
        <div className="tracker__waiting">
          <Spinner label="Reading the tracker" />
          <span>Reading the tracker…</span>
        </div>
      ) : (
        <>
          <dl className="tracker-stats">
            <Stat label={isToday ? 'Posted today' : `Posted ${day}`} value={summary.postedToday} />
            <Stat label="Pending" value={summary.pending} note="Waiting for group approval" />
            <Stat
              label="Interns done"
              value={summary.internsDone}
              of={summary.internsAssigned}
              note={summary.internsAssigned === 0 ? `No queues for ${day}` : undefined}
            />
            <Stat label="Due for repost" value={summary.dueForRepost.length} note={`Not posted for ${repostDueDays}+ days`} />
            <Stat label="Never posted" value={summary.neverPosted.length} />
          </dl>

          <div className="tracker__row tracker__row--day">
            <Card
              className="tracker__posts"
              title={isToday ? 'Posts today' : `Posts on ${day}`}
              description="Newest first."
            >
              <PostsTable posts={summary.posts} day={isToday ? 'today' : `on ${day}`} onOpenLink={onOpenLink} />
            </Card>

            <Card
              className="tracker__interns"
              title="Interns"
              description={`Queues for ${day}`}
              actions={
                internsHref ? (
                  <a
                    className="button button--link"
                    href={internsHref}
                    onClick={(event) => {
                      if (!onOpenInterns || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      onOpenInterns();
                    }}
                  >
                    See all interns
                  </a>
                ) : undefined
              }
            >
              {summary.interns.length === 0 ? (
                <p className="tracker__quiet">Nobody has a queue for {day}.</p>
              ) : (
                <ul className="intern-list">
                  {summary.interns.map((progress) => (
                    <InternRow
                      key={progress.name}
                      progress={progress}
                      day={day}
                      onAssign={onAssign ? () => onAssign(progress.name, date) : undefined}
                    />
                  ))}
                </ul>
              )}
              {onAssign ? (
                <div className="tracker__plan">
                  <Button size="small" onClick={() => onAssign(null, nextDay)}>
                    Plan queues for {shortDate(nextDay)}
                  </Button>
                </div>
              ) : null}
            </Card>
          </div>

          <div className="tracker__row">
            <div className="tracker__lists">
              <Card
                title="Due for repost"
                description={`${repostDueDays}+ days since last post`}
              >
                <ShowSome
                  items={summary.dueForRepost}
                  limit={LIST_LIMIT}
                  what="listings"
                  empty="Nothing is due for a repost."
                  render={(item) => (
                    <AttentionItem
                      key={item.property.id}
                      item={item}
                      name={openName(item.property.id, item.property.name)}
                      days={item.daysSince ?? 0}
                    />
                  )}
                />
              </Card>
              <Card title="Never posted">
                <ShowSome
                  items={summary.neverPosted}
                  limit={LIST_LIMIT}
                  what="listings"
                  empty="Every listing has been posted at least once."
                  render={(item) => (
                    <AttentionItem
                      key={item.property.id}
                      item={item}
                      name={openName(item.property.id, item.property.name)}
                    />
                  )}
                />
              </Card>
            </div>

            <Card
              className="tracker__health"
              title="Doc health"
              description="Worst first."
            >
              {health.listings === 0 ? (
                <p className="tracker__quiet">No problems.</p>
              ) : (
                <>
                  <p className="health__summary">
                    {plural(health.listings, 'listing needs', 'listings need')} fixing.
                    {health.blocked > 0
                      ? ` ${health.blocked.toLocaleString('en-PH')} of them can't be posted until ${health.blocked === 1 ? 'it is' : 'they are'}.`
                      : ''}
                  </p>
                  {health.groups.map((group) => (
                    <HealthGroupView key={group.kind} group={group} openName={openName} />
                  ))}
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the day's posts

interface PostsTableProps {
  readonly posts: readonly PostLogEntry[];
  /** "today", "on Wed 28 Oct". */
  readonly day: string;
  readonly onOpenLink?: ((url: string) => void) | undefined;
}

function PostsTable({ posts, day, onOpenLink }: PostsTableProps) {
  if (posts.length === 0) return <p className="tracker__quiet">No posts {day} yet.</p>;
  return (
    <div className="tracker-table__wrap">
      <table className="tracker-table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Listing</th>
            <th scope="col">Posted by</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post, index) => (
            <tr key={`${index}-${post.time}-${post.title}`}>
              <td className="tracker-table__time tabular">{post.time || '–'}</td>
              <td className="tracker-table__listing">{post.title}</td>
              <td>
                <span className="tracker-table__who">{post.postedBy}</span>
                <span className="tracker-table__account">{post.fbAccount}</span>
              </td>
              <td>
                <div className="tracker-table__status">
                  <Pill tone={post.status === 'Posted' ? 'ok' : 'warn'} dot>
                    {post.status}
                  </Pill>
                  {post.postLink.trim() === '' ? (
                    <span className="tracker__muted">No link</span>
                  ) : onOpenLink ? (
                    <Button
                      variant="link"
                      onClick={() => onOpenLink(post.postLink)}
                      aria-label={`Open the post of ${post.title}`}
                    >
                      Open
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ interns

interface InternRowProps {
  readonly progress: InternProgress;
  readonly day: string;
  readonly onAssign?: (() => void) | undefined;
}

function InternRow({ progress, day, onAssign }: InternRowProps) {
  const { name, total, posted, pending, toPost, done } = progress;
  const left = [pending > 0 ? `${pending} pending` : null, toPost > 0 ? `${toPost} not shared` : null].filter(Boolean);
  return (
    <li className="intern-row">
      <span className="intern-row__avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <div className="intern-row__body">
        <div className="intern-row__top">
          <span className="intern-row__name">{name}</span>
          {total > 0 ? (
            <span className="intern-row__count tabular">
              {posted} of {total} posted
            </span>
          ) : null}
        </div>
        {total > 0 ? (
          <div className="intern-row__bar" aria-hidden="true">
            <span className="intern-row__posted" style={{ width: `${(posted / total) * 100}%` }} />
            <span className="intern-row__pending" style={{ width: `${(pending / total) * 100}%` }} />
          </div>
        ) : null}
        <div className="intern-row__detail">
          {total === 0 ? (
            <span>No queue for {day}</span>
          ) : done ? (
            <Pill tone="ok" dot>
              Done
            </Pill>
          ) : (
            <span>{left.join(' · ')}</span>
          )}
          {onAssign ? (
            <Button variant="link" onClick={onAssign} aria-label={total === 0 ? `Build ${firstName(name)}'s queue` : `Open ${firstName(name)}'s queue`}>
              {total === 0 ? 'Build a queue' : 'Open queue'}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ lists

interface ShowSomeProps<T> {
  readonly items: readonly T[];
  readonly limit: number;
  /** What the items are, for "Show all 23 listings". */
  readonly what: string;
  readonly empty: string;
  readonly render: (item: T) => ReactNode;
}

/** The first few, and the rest on request. */
function ShowSome<T>({ items, limit, what, empty, render }: ShowSomeProps<T>) {
  const [all, setAll] = useState(false);
  const listId = useId();
  if (items.length === 0) return <p className="tracker__quiet">{empty}</p>;
  const shown = all ? items : items.slice(0, limit);
  return (
    <>
      <ul className="attention-list" id={listId}>
        {shown.map(render)}
      </ul>
      {items.length > limit ? (
        <Button variant="link" className="tracker__more" aria-controls={listId} aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${items.length.toLocaleString('en-PH')} ${what}`}
        </Button>
      ) : null}
    </>
  );
}

function AttentionItem({ item, name, days }: { item: RepostItem; name: ReactNode; days?: number | undefined }) {
  return (
    <li className="attention-item">
      <div className="attention-item__top">
        <span className="attention-item__name">{name}</span>
        {days !== undefined ? (
          <span className="attention-item__days tabular">
            {plural(days, 'day', 'days')}
            <span className="visually-hidden"> since it was last posted</span>
          </span>
        ) : null}
      </div>
      <span className="attention-item__meta">
        <CategoryTag category={item.property.category} />
        {item.queuedFor ? <span>In {firstName(item.queuedFor)}&rsquo;s queue</span> : null}
      </span>
    </li>
  );
}

// ------------------------------------------------------------------ doc health

const issueLabel: Record<IssueKind, string> = {
  noSeparator: 'No separator',
  noDocument: 'No document',
  wordFile: 'Word file',
  other: 'Something else',
  noPhotos: 'No photos',
};

const issueAdvice: Record<IssueKind, string> = {
  noSeparator:
    "Copy is blocked. Add a separator line above the owner's details.",
  noDocument: 'No posting document in the folder. Add one.',
  wordFile: 'Word file. Save it as a Google Doc.',
  other: 'Open each one to see what the directory found.',
  noPhotos: 'Add photos to the folder.',
};

const issueAlso: Record<IssueKind, string> = {
  noSeparator: 'no separator',
  noDocument: 'no document',
  wordFile: 'a Word file',
  other: 'something else',
  noPhotos: 'no photos',
};

const UNEXPLAINED =
  'Open one to see what the directory found.';

function HealthGroupView({
  group,
  openName,
}: {
  group: HealthGroup;
  openName: (id: string, name: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const listId = useId();
  const blocking = isBlocking(group.kind);
  const unexplained = group.kind === 'other' && group.items.every((item) => item.detail === '');
  const count = group.items.length;
  return (
    <section className="health-group" aria-labelledby={titleId}>
      <div className="health-group__head">
        <h3 id={titleId} className="health-group__title">
          <Icon
            name={blocking ? 'fail' : 'warn'}
            size={18}
            className={blocking ? 'health-group__icon health-group__icon--danger' : 'health-group__icon health-group__icon--warn'}
          />
          <span>{issueLabel[group.kind]}</span>
        </h3>
        <Badge count={count} label={plural(count, 'listing', 'listings')} tone={blocking ? 'danger' : 'neutral'} />
      </div>
      <p className="health-group__advice">{unexplained ? UNEXPLAINED : issueAdvice[group.kind]}</p>
      <Button
        variant="link"
        className="health-group__toggle"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide the list' : `Show ${count === 1 ? 'the listing' : `the ${count.toLocaleString('en-PH')} listings`}`}
      </Button>
      {open ? (
        <ul className="attention-list health-group__list" id={listId}>
          {group.items.map((item) => (
            <li key={item.id} className="attention-item">
              <span className="attention-item__name">{openName(item.id, item.name)}</span>
              {(group.kind === 'other' && item.detail) || item.also.length > 0 ? (
                <span className="attention-item__meta">
                  {group.kind === 'other' && item.detail ? <span>{item.detail}</span> : null}
                  {item.also.length > 0 ? <span>Also {item.also.map((kind) => issueAlso[kind]).join(', ')}.</span> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
