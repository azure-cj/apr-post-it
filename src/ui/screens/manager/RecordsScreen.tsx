import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, Notice, Spinner } from '../../components';
import {
  byAccount,
  byCategory,
  byIntern,
  chartBuckets,
  compareToPrevious,
  comparisonLabel,
  comparisonSpan,
  elapsedSpan,
  missedInPeriod,
  mondayOf,
  periodLabel,
  periodTotals,
  postsCsv,
  postsForProperty,
  queueWeeks,
  searchPosts,
  sortPosts,
  spanLabel,
  type Change,
  type ChartBucket,
  type CountRow,
  type Period,
  type Span,
} from '@/core/records';
import { addDays, heldBy, heldListings, plural, shortDate } from '@/core/summary';
import type { Assignment, PostLogEntry, PostStatus } from '@/core/types';
import { RecordsBreakdown, type BreakdownTab } from './RecordsBreakdown';
import { bucketName, ChartLegend, RecordsChart } from './RecordsChart';
import { RecordsHistory } from './RecordsHistory';
import { RecordsPeriod } from './RecordsPeriod';
import { RecordsPosts, type ActiveFilter, type PostSort } from './RecordsPosts';
import './InternsParts.css';
import './InternsScreen.css';
import './RecordsScreen.css';

export interface RecordsScreenProps {
  /** Every Posts row. */
  readonly posts: readonly PostLogEntry[];
  /** Every Assignments row: what was queued, so what was missed. */
  readonly assignments?: readonly Assignment[] | undefined;
  /** Today, yyyy-MM-dd. */
  readonly today: string;
  /** The period shown (from the link). */
  readonly period: Period;
  readonly onPeriodChange: (period: Period) => void;
  /** The active interns, so one who posted nothing still has a row. */
  readonly interns?: readonly string[] | undefined;
  /** The cooldown rule, for a listing's history. */
  readonly cooldownDays?: number | undefined;
  /** The rows haven't arrived yet. */
  readonly loading?: boolean | undefined;
  readonly error?: string | null | undefined;
  /** Opens a post's link in the browser. */
  readonly onOpenLink?: ((url: string) => void) | undefined;
  /** Hands over the list as CSV, with a file name for it. */
  readonly onExport?: ((csv: string, fileName: string) => void) | undefined;
}

/** The day (or week) the list is cut to, from a bar. */
interface DayFilter extends Span {
  readonly label: string;
}

/** The listing whose history is open. */
interface OpenListing {
  readonly id: string;
  readonly name: string;
}

const NO_ASSIGNMENTS: readonly Assignment[] = [];
const NO_NAMES: readonly string[] = [];

/**
 * The record book: a period's numbers against the one before, posts per day,
 * the same by intern, category and FB account, then every post, filterable
 * and sortable, in the interns' sheet's columns. A bar, an intern, a
 * category or an account filters the list; a title opens the listing's
 * whole history beside it. Export hands the list over as the sheet's CSV.
 */
export function RecordsScreen({
  posts,
  assignments = NO_ASSIGNMENTS,
  today,
  period,
  onPeriodChange,
  interns = NO_NAMES,
  cooldownDays = 7,
  loading = false,
  error,
  onOpenLink,
  onExport,
}: RecordsScreenProps) {
  const [tab, setTab] = useState<BreakdownTab>('intern');
  const [day, setDay] = useState<DayFilter | null>(null);
  const [intern, setIntern] = useState<string | null>(null);
  const [category, setCategory] = useState<CountRow | null>(null);
  const [account, setAccount] = useState<CountRow | null>(null);
  const [status, setStatus] = useState<PostStatus | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PostSort>({ key: 'date', direction: 'desc' });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<OpenListing | null>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const deferredQuery = useDeferredValue(query);
  const chartTitle = useId();

  // A bar belongs to its period: another period drops it.
  useEffect(() => setDay(null), [period.from, period.to]);
  // Any change to what the list holds starts it at its first page.
  useEffect(() => setPage(0), [period.from, period.to, day, intern, category, account, status, deferredQuery, sort]);

  const span: Span = useMemo(() => ({ from: period.from, to: period.to }), [period.from, period.to]);
  const elapsed = elapsedSpan(period, today);
  const before = comparisonSpan(period, today);

  const report = useMemo(() => {
    const buckets = chartBuckets(posts, period, today);
    const now = periodTotals(posts, span);
    const prev = before ? periodTotals(posts, before) : null;
    const weeks = queueWeeks(assignments, posts, span, today);
    const missed = missedInPeriod(weeks);
    const prevMissed = before ? missedInPeriod(queueWeeks(assignments, posts, before, today)) : null;
    const trendBuckets = trendSpans(buckets);
    return {
      buckets,
      now,
      prev,
      missed,
      prevMissed,
      interns: byIntern(posts, weeks, span, trendBuckets, interns),
      categories: byCategory(posts, span),
      accounts: byAccount(posts, span),
    };
    // `before` is derived from period and today.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, assignments, period, span, today, interns]);

  // The list: the period, then every filter but status (for the chips' counts), then status.
  const unsorted = useMemo(
    () =>
      searchPosts(posts, {
        from: day?.from ?? span.from,
        to: day?.to ?? span.to,
        query: deferredQuery,
        intern: intern ?? undefined,
        type: category?.key,
        fbAccount: account?.key,
      }),
    [posts, span, day, deferredQuery, intern, category, account],
  );
  const statusCounts = useMemo(() => {
    let posted = 0;
    for (const p of unsorted) if (p.status === 'Posted') posted++;
    return { Posted: posted, Pending: unsorted.length - posted };
  }, [unsorted]);
  const list = useMemo(
    () => sortPosts(status ? unsorted.filter((p) => p.status === status) : unsorted, sort.key, sort.direction),
    [unsorted, status, sort],
  );

  const history = useMemo(() => (open ? postsForProperty(posts, open) : []), [posts, open]);
  const held = useMemo(() => (open ? heldBy(heldListings(assignments, today), open) : undefined), [assignments, open, today]);

  useEffect(() => {
    if (open) panelHeading.current?.focus({ preventScroll: true });
  }, [open]);

  const closePanel = () => {
    setOpen(null);
    opener.current?.focus();
  };

  const clearFilters = () => {
    setDay(null);
    setIntern(null);
    setCategory(null);
    setAccount(null);
    setStatus(null);
    setQuery('');
  };

  const filters: ActiveFilter[] = [];
  if (day) filters.push({ key: 'day', kind: 'Day', label: day.label, onRemove: () => setDay(null) });
  if (intern) filters.push({ key: 'intern', kind: 'Intern', label: intern, onRemove: () => setIntern(null) });
  if (category) filters.push({ key: 'category', kind: 'Category', label: category.label, onRemove: () => setCategory(null) });
  if (account) filters.push({ key: 'account', kind: 'FB account', label: account.label, onRemove: () => setAccount(null) });

  const waiting = loading && posts.length === 0;
  const versus = comparisonLabel(period, today);
  const { now, prev, missed, prevMissed } = report;
  const nextFriday = firstFridayFrom(elapsed ? (today > period.from ? today : period.from) : period.from);
  const summary =
    elapsed === null
      ? `${periodLabel(period)} hasn't started.`
      : `${spanLabel(elapsed.from, elapsed.to)}: ${now.posts} posts, ${now.posted} posted, ${now.pending} pending.` +
        (now.busiest ? ` Busiest ${shortDate(now.busiest.date)}, ${now.busiest.count}.` : '');

  return (
    <div className={`page records${open ? ' records--panel' : ''}`}>
      <header className="page-header records__header">
        <h1 className="page-header__title" tabIndex={-1}>
          Records
        </h1>
        <RecordsPeriod period={period} today={today} onChange={onPeriodChange} />
        {onExport ? (
          <Button
            size="small"
            className="records__export"
            disabled={list.length === 0}
            title={`The ${plural(list.length, 'post', 'posts')} in the list, as the posting tracker's columns`}
            onClick={() => onExport(postsCsv(list), `posts ${period.from} to ${period.to}.csv`)}
          >
            Export CSV
          </Button>
        ) : null}
      </header>

      {error ? (
        <Notice tone="danger" live className="records__notice">
          {error}
        </Notice>
      ) : null}

      {waiting ? (
        <div className="records__waiting">
          <Spinner label="Reading the posts" />
          <span>Reading the posts…</span>
        </div>
      ) : (
        <>
          <dl className="records-tiles">
            <Tile label="Posts" value={now.posts} change={prev ? compareToPrevious(now.posts, prev.posts) : null} versus={versus} />
            <Tile label="Pending" value={now.pending} change={prev ? compareToPrevious(now.pending, prev.pending) : null} versus={versus} goodWhen="neither" />
            {missed.weeksOver > 0 ? (
              <Tile
                label="Missed"
                value={missed.total}
                change={prevMissed && prevMissed.weeksOver > 0 ? compareToPrevious(missed.total, prevMissed.total) : null}
                versus={versus}
                goodWhen="down"
                note={versus ? `No week ended in ${versus}` : undefined}
              />
            ) : (
              <Tile label="Missed" value={null} note={nextFriday && nextFriday <= period.to ? `After ${shortDate(nextFriday)}` : 'No week ended'} />
            )}
            <Tile label="Active interns" value={now.interns} change={prev ? compareToPrevious(now.interns, prev.interns) : null} versus={versus} />
            <Tile
              label="Busiest day"
              value={now.busiest?.count ?? null}
              detail={now.busiest ? shortDate(now.busiest.date) : undefined}
              change={prev && now.busiest ? compareToPrevious(now.busiest.count, prev.busiest?.count ?? 0) : null}
              versus={versus}
            />
          </dl>

          <div className="records__overview">
            <section className="card card--tight records-chart" aria-labelledby={chartTitle}>
              <div className="records-chart__head">
                <h2 id={chartTitle} className="records-chart__title">
                  {report.buckets[0]?.unit === 'week' ? 'Posts per week' : 'Posts per day'}
                </h2>
                <ChartLegend />
              </div>
              <RecordsChart
                buckets={report.buckets}
                selected={day?.from ?? null}
                summary={summary}
                onSelect={(bucket) => {
                  const picked = bucket ? report.buckets.find((b) => b.from === bucket.from) : undefined;
                  setDay(bucket && picked ? { ...bucket, label: bucketName(picked) } : null);
                }}
              />
            </section>

            <RecordsBreakdown
              tab={tab}
              onTabChange={setTab}
              interns={report.interns}
              categories={report.categories}
              accounts={report.accounts}
              intern={intern}
              category={category?.key ?? null}
              account={account?.key ?? null}
              onIntern={setIntern}
              onCategory={setCategory}
              onAccount={setAccount}
            />
          </div>

          <div className={`records__body${open ? ' records__body--panel' : ''}`}>
            <RecordsPosts
              posts={list}
              query={query}
              onQueryChange={setQuery}
              status={status}
              onStatusChange={setStatus}
              statusCounts={statusCounts}
              filters={filters}
              onClearFilters={clearFilters}
              sort={sort}
              onSortChange={setSort}
              page={page}
              onPageChange={setPage}
              isOpen={(post) => open !== null && sameListing(post, open)}
              onOpenProperty={(post, button) => {
                opener.current = button;
                const next = { id: post.propertyId, name: post.title };
                setOpen((was) => (was && sameListing(post, was) ? null : next));
              }}
              onOpenLink={onOpenLink}
              emptyPeriod={elapsed ? `No posts in ${periodLabel(period)}.` : `${periodLabel(period)} hasn't started.`}
            />

            {open ? (
              <RecordsHistory
                ref={panelHeading}
                key={`${open.id}|${open.name}`}
                title={history[0]?.title ?? open.name}
                type={history[0]?.type ?? ''}
                posts={history}
                held={held}
                today={today}
                cooldownDays={cooldownDays}
                onClose={closePanel}
                onOpenLink={onOpenLink}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/** The sparkline's points: a bar each, or a week each when there are more than two weeks of days. */
function trendSpans(buckets: readonly ChartBucket[]): Span[] {
  const past = buckets.filter((b) => !b.later);
  if (past.length <= 14 || past[0]?.unit === 'week') return past;
  const weeks = new Map<string, { from: string; to: string }>();
  for (const b of past) {
    const monday = mondayOf(b.from);
    const week = weeks.get(monday);
    if (week) week.to = b.to;
    else weeks.set(monday, { from: b.from, to: b.to });
  }
  return [...weeks.values()];
}

function sameListing(post: PostLogEntry, listing: OpenListing): boolean {
  const id = post.propertyId.trim();
  if (id && listing.id.trim()) return id === listing.id.trim();
  return postsForProperty([post], listing).length === 1;
}

/** The first Friday on or after `date`. */
function firstFridayFrom(date: string): string {
  let d = date;
  for (let i = 0; i < 7; i++) {
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 5) return d;
    d = addDays(d, 1);
  }
  return d;
}

// ------------------------------------------------------------------ a tile

interface TileProps {
  readonly label: string;
  /** null: nothing to count yet, shown as a dash. */
  readonly value: number | null;
  /** Beside the number: the busiest day's date. */
  readonly detail?: string | undefined;
  readonly change?: Change | null | undefined;
  /** What it is compared with: "26–28 Oct". */
  readonly versus?: string | undefined;
  /** Missed is better lower; pending is neither (it is waiting, not failing). */
  readonly goodWhen?: 'up' | 'down' | 'neither' | undefined;
  /** In place of the change, when there is none. */
  readonly note?: string | undefined;
}

/**
 * A number, what it counts, and how it moved: an arrow, the amount and what
 * it is compared with, in words as well as colour.
 */
function Tile({ label, value, detail, change, versus, goodWhen = 'up', note }: TileProps) {
  const tone =
    !change || change.direction === 'same' || goodWhen === 'neither' ? 'same' : change.direction === goodWhen ? 'good' : 'bad';
  const amount = change ? Math.abs(change.change).toLocaleString('en-PH') : '';
  return (
    <div className="records-tile">
      <dt className="records-tile__label">{label}</dt>
      <dd className={`records-tile__value${value === 0 || value === null ? ' records-tile__value--zero' : ''}`}>
        {value === null ? '–' : value.toLocaleString('en-PH')}
        {detail ? <span className="records-tile__detail"> {detail}</span> : null}
      </dd>
      <dd className={`records-tile__change records-tile__change--${tone}`}>
        {change && change.direction === 'same' ? (
          <span className="records-tile__versus">Same as {versus}</span>
        ) : change ? (
          <>
            <span aria-hidden="true">{change.direction === 'up' ? '↑' : '↓'}</span>
            <span className="visually-hidden">{change.direction === 'up' ? 'Up' : 'Down'}</span>
            <span className="tabular"> {amount}</span>
            <span className="records-tile__versus"> vs {versus}</span>
          </>
        ) : (
          <span className="records-tile__versus">{note ?? ' '}</span>
        )}
      </dd>
    </div>
  );
}

/** The CSV is the interns' own sheet's columns and formats (core/records.ts). */
export { postsCsv };
