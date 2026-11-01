import { useId, useMemo, useState } from 'react';
import { Button, Card, Icon, Notice, PAGE_SIZE, Pagination, Pill, Spinner, usePaged } from '../../components';
import { clockTime } from '@/core/records';
import {
  activeInterns,
  DOC_ISSUES,
  docHealth,
  docLink,
  docsToFix,
  newestFirst,
  peopleIn,
  shortDate,
  teamWeek,
  type DirectoryRow,
  type DocIssue,
  type DocProblem,
  type TeamMember,
} from '@/core/summary';
import { initials, type Assignment, type PostLogEntry } from '@/core/types';
import { assignmentWeek, weekLabel } from '@/core/week';
import { DayPicker } from './DayPicker';
import { isBehind, monitorWeek, PacePill, WeekBar } from './InternsParts';
import { Stat } from './Stat';
import { RouteLink } from './TrackerLink';
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
  /** Every listing in the directory, with its Issues text (and DocId) when the list carries them. */
  readonly properties: readonly DirectoryRow[];
  /** The team, so an intern with no queue still shows. Without it, only people with a queue do. */
  readonly team?: readonly TeamMember[] | undefined;
  /** Show another day. */
  readonly onDateChange: (date: string) => void;
  /** Read the rows again. Without it, there is no Refresh button. */
  readonly onRefresh?: (() => void) | undefined;
  readonly refreshing?: boolean | undefined;
  /** The rows are being read and haven't arrived yet. */
  readonly loading?: boolean | undefined;
  /** Why the rows couldn't be read, as a sentence. */
  readonly error?: string | null | undefined;
  /** When the rows were read, on the tracker's clock: "10:42". Said on Refresh's tooltip. */
  readonly updatedAt?: string | null | undefined;
  /** Opens a link in the browser: a post, a doc, a folder. Without it, no Open buttons. */
  readonly onOpenLink?: ((url: string) => void) | undefined;
  /** The Interns screen on the week shown: "See all" in This week. Without it, no link. */
  readonly internsHref?: string | undefined;
  readonly onOpenInterns?: (() => void) | undefined;
  /** Records on the day shown: "See all in Records" under a long day. Without it, no link. */
  readonly recordsHref?: string | undefined;
  readonly onOpenRecords?: (() => void) | undefined;
  /** Settings, where Rebuild is: the word "Settings" in Documents links there. */
  readonly settingsHref?: string | undefined;
  readonly onOpenSettings?: (() => void) | undefined;
}

/** How many of the day's posts show before "See all in Records". */
export const POSTS_LIMIT = 8;
/** How many listings a document group shows a page. */
export const LIST_LIMIT = PAGE_SIZE;

/**
 * The day at a glance: four numbers, the day's posts, the week's pace and the
 * documents to fix. An overview: the detail is on Records and Interns.
 */
export function TrackerScreen({
  date,
  today,
  posts,
  assignments,
  properties,
  team,
  onDateChange,
  onRefresh,
  refreshing = false,
  loading = false,
  error,
  updatedAt,
  onOpenLink,
  internsHref,
  onOpenInterns,
  recordsHref,
  onOpenRecords,
  settingsHref,
  onOpenSettings,
}: TrackerScreenProps) {
  const docsId = useId();

  const day = useMemo(() => {
    const onDay = newestFirst(posts.filter((p) => p.date === date));
    return {
      posts: onDay,
      posted: onDay.filter((p) => p.status === 'Posted').length,
      // Waiting for the group admin's approval, whatever day they were posted.
      pending: posts.filter((p) => p.status === 'Pending').length,
    };
  }, [posts, date]);

  const health = useMemo(() => docHealth(properties), [properties]);
  const toFix = docsToFix(health);

  // The week of the day shown; on a weekend, the one that just ended.
  const week = monitorWeek(date);
  const pace = useMemo(() => {
    const names = team
      ? activeInterns(team)
      : peopleIn(
          assignments.filter((a) => assignmentWeek(a) === week),
          [],
        );
    return teamWeek(names, week, assignments, posts, today);
  }, [team, week, assignments, posts, today]);
  const behind = pace.filter(isBehind).length;

  const isToday = date === today;
  const waiting = loading && posts.length === 0 && assignments.length === 0 && properties.length === 0;

  const showDocs = () => {
    const card = document.getElementById(docsId);
    if (!card) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
    card.scrollIntoView?.({
      block: 'start',
      behavior: still ? 'auto' : 'smooth',
    });
    card.focus({ preventScroll: true });
  };

  return (
    <div className="page tracker">
      <header className="page-header tracker__header">
        <h1 className="page-header__title" tabIndex={-1}>
          Tracker
        </h1>
        <div className="tracker__day">
          <DayPicker date={date} today={today} onChange={onDateChange} label="Day shown" quick={['today']} />
          {onRefresh ? (
            <Button size="small" busy={refreshing} onClick={onRefresh} title={updatedAt ? `Updated ${updatedAt}` : undefined}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          ) : null}
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
          <dl className="tracker-stats tracker__stats">
            <Stat label={isToday ? 'Posted today' : 'Posted'} value={day.posted} />
            <Stat label="Pending" value={day.pending} />
            <Stat label="Interns behind" value={behind} of={pace.length} />
            <Card padding="tight" className="tracker-stat tracker-stat--link">
              <dt className="tracker-stat__label">
                <button type="button" className="tracker-stat__jump" onClick={showDocs}>
                  Docs to fix
                </button>
              </dt>
              <dd className={`tracker-stat__value tabular${toFix === 0 ? ' tracker-stat__value--zero' : ''}`}>
                {toFix.toLocaleString('en-PH')}
              </dd>
            </Card>
          </dl>

          <div className="tracker__grid">
            <Card className="tracker__posts" title={isToday ? "Today's posts" : `Posts on ${shortDate(date)}`} padding="tight">
              <DayPosts posts={day.posts} isToday={isToday} onOpenLink={onOpenLink} />
              {day.posts.length > POSTS_LIMIT && recordsHref ? (
                <div className="tracker__more">
                  <RouteLink href={recordsHref} onNavigate={onOpenRecords}>
                    See all in Records
                  </RouteLink>
                </div>
              ) : null}
            </Card>

            <Card
              className="tracker__week"
              title={week === monitorWeek(today) ? 'This week' : weekLabel(week)}
              padding="tight"
              actions={
                internsHref ? (
                  <RouteLink href={internsHref} onNavigate={onOpenInterns} aria-label="See all interns">
                    See all
                  </RouteLink>
                ) : undefined
              }
            >
              {pace.length === 0 ? (
                <p className="tracker__quiet">No active interns.</p>
              ) : (
                <ul className="intern-list">
                  {pace.map((row) => (
                    <li key={row.name} className="intern-row">
                      <span className="avatar" aria-hidden="true">
                        {initials(row.name)}
                      </span>
                      <WeekBar
                        progress={row}
                        label={
                          <span className="intern-row__name" title={row.name}>
                            {row.name}
                          </span>
                        }
                      />
                      <PacePill progress={row} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card id={docsId} className="tracker__docs" title="Documents" padding="tight" tabIndex={-1}>
              {toFix === 0 ? (
                <p className="docs__clean">
                  <Icon name="pass" size={18} className="docs__clean-icon" />
                  All documents OK
                </p>
              ) : (
                <>
                  <p className="docs__note">
                    Fixed documents apply at once. Run Rebuild in{' '}
                    {settingsHref ? (
                      <RouteLink href={settingsHref} onNavigate={onOpenSettings} className="button button--link docs__settings">
                        Settings
                      </RouteLink>
                    ) : (
                      'Settings'
                    )}{' '}
                    to refresh these counts.
                  </p>
                  <ul className="docs">
                    {DOC_ISSUES.filter((kind) => health[kind].length > 0).map((kind) => (
                      <DocGroup key={kind} kind={kind} items={health[kind]} onOpenLink={onOpenLink} />
                    ))}
                  </ul>
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

function DayPosts({
  posts,
  isToday,
  onOpenLink,
}: {
  readonly posts: readonly PostLogEntry[];
  readonly isToday: boolean;
  readonly onOpenLink?: ((url: string) => void) | undefined;
}) {
  if (posts.length === 0) return <p className="tracker__quiet">{isToday ? 'No posts yet.' : 'No posts.'}</p>;
  return (
    <table className="day-posts">
      <colgroup>
        <col className="day-posts__col-time" />
        <col />
        <col className="day-posts__col-who" />
        <col className="day-posts__col-status" />
        <col className="day-posts__col-open" />
      </colgroup>
      <thead className="visually-hidden">
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Listing</th>
          <th scope="col">Intern</th>
          <th scope="col">Status</th>
          <th scope="col">Post</th>
        </tr>
      </thead>
      <tbody>
        {posts.slice(0, POSTS_LIMIT).map((post, index) => (
          <tr key={`${index}-${post.time}-${post.title}`}>
            <td className="day-posts__time tabular">{post.time ? clockTime(post.time) : '–'}</td>
            <td className="day-posts__listing" title={post.title}>
              {post.title}
            </td>
            <td className="day-posts__who" title={post.postedBy}>
              {post.postedBy}
            </td>
            <td className="day-posts__status">
              <Pill tone={post.status === 'Posted' ? 'ok' : 'warn'} dot>
                {post.status}
              </Pill>
            </td>
            <td className="day-posts__open">
              {onOpenLink && post.postLink.trim() !== '' ? (
                <Button variant="link" onClick={() => onOpenLink(post.postLink)} aria-label={`Open the post of ${post.title}`}>
                  Open
                </Button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ documents

const DOC_LABEL: Record<DocIssue, string> = {
  noSeparator: 'No separator',
  noDocument: 'No document',
  noPhotos: 'No photos',
  emptyAbove: 'Empty above separator',
  unreadable: "Couldn't read",
};

/** Only these are posted anyway; the rest stop a listing being posted, or are a folder to fill. */
const DOC_HINT: Partial<Record<DocIssue, string>> = {
  noSeparator: 'Shown to interns with a warning',
};

/** Can't be posted until fixed: nothing to copy. */
const BLOCKS: ReadonlySet<DocIssue> = new Set<DocIssue>(['noDocument', 'emptyAbove', 'unreadable']);

/** Where the fix is: the folder for a missing doc or photos, else the doc when the directory knows it. */
function fixLink(kind: DocIssue, item: DocProblem): { readonly label: string; readonly url: string } {
  if (kind !== 'noDocument' && kind !== 'noPhotos' && item.docId) return { label: 'Open doc', url: docLink(item.docId) };
  return { label: 'Open folder', url: item.folder };
}

function DocGroup({
  kind,
  items,
  onOpenLink,
}: {
  readonly kind: DocIssue;
  readonly items: readonly DocProblem[];
  readonly onOpenLink?: ((url: string) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const count = items.length;
  const paged = usePaged(items, LIST_LIMIT);
  const hint = DOC_HINT[kind];
  return (
    <li className={`docs-group${open ? ' docs-group--open' : ''}`}>
      <button
        type="button"
        className="docs-group__toggle"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <svg className="docs-group__chevron" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <Icon
          name={BLOCKS.has(kind) ? 'fail' : 'warn'}
          size={18}
          className={`docs-group__icon docs-group__icon--${BLOCKS.has(kind) ? 'danger' : 'warn'}`}
        />
        <span className="docs-group__label">{DOC_LABEL[kind]}</span>
        <span className="docs-group__count tabular">
          <span aria-hidden="true">· </span>
          {count.toLocaleString('en-PH')}
        </span>
        {hint ? <span className="docs-group__hint">{hint}</span> : null}
      </button>
      {open ? (
        <div id={listId} className="docs-group__body">
          <ul className="docs-group__list" aria-label={DOC_LABEL[kind]} ref={paged.topRef}>
            {paged.items.map((item) => {
              const fix = fixLink(kind, item);
              return (
                <li key={item.id} className="docs-item">
                  <span className="docs-item__name" title={item.name}>
                    {item.name}
                  </span>
                  {onOpenLink ? (
                    <Button
                      variant="link"
                      className="docs-item__open"
                      onClick={() => onOpenLink(fix.url)}
                      aria-label={`${fix.label}, ${item.name}`}
                    >
                      {fix.label}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <Pagination {...paged.pagination} label={`${DOC_LABEL[kind]}, pages`} className="docs-group__pages" />
        </div>
      ) : null}
    </li>
  );
}
