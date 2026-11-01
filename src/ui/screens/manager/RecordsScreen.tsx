import { useId, useMemo, useState } from 'react';
import { Button, Notice, Spinner } from '../../components';
import {
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
  queueWeeks,
  searchPosts,
  sortPosts,
  spanLabel,
  type Change,
  type ChartBucket,
  type Period,
  type Span,
} from '@/core/records';
import { addDays, plural, shortDate } from '@/core/summary';
import type { Assignment, PostLogEntry } from '@/core/types';
import { RecordsBreakdown, type BreakdownTab } from './RecordsBreakdown';
import { ChartLegend, RecordsChart } from './RecordsChart';
import { RecordsPeriod } from './RecordsPeriod';
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
  /** The rows haven't arrived yet. */
  readonly loading?: boolean | undefined;
  readonly error?: string | null | undefined;
  /** The Interns screen on a week (its Monday): an intern's row links there. Without it, names are plain. */
  readonly internsHref?: ((week: string) => string) | undefined;
  /** Follows that link through the app's router. */
  readonly onOpenIntern?: ((name: string, week: string) => void) | undefined;
  /** Hands over the period's posts as CSV, with a file name for it. */
  readonly onExport?: ((csv: string, fileName: string) => void) | undefined;
}

const NO_ASSIGNMENTS: readonly Assignment[] = [];
const NO_NAMES: readonly string[] = [];

/**
 * The record book: a period's numbers against the one before, posts per day,
 * and the same by intern and by category. An intern opens their week on
 * Interns. Export hands the period's posts over as the sheet's CSV.
 */
export function RecordsScreen({
  posts,
  assignments = NO_ASSIGNMENTS,
  today,
  period,
  onPeriodChange,
  interns = NO_NAMES,
  loading = false,
  error,
  internsHref,
  onOpenIntern,
  onExport,
}: RecordsScreenProps) {
  const [tab, setTab] = useState<BreakdownTab>('intern');
  const chartTitle = useId();

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
    };
    // `before` is derived from period and today.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, assignments, period, span, today, interns]);

  // Every post of the period, newest first: what Export hands over.
  const periodPosts = useMemo(() => sortPosts(searchPosts(posts, { from: span.from, to: span.to, query: '' }), 'date', 'desc'), [posts, span]);

  // An intern's row opens Interns on the period's latest week that has begun.
  const internWeek = mondayOf(period.to < today ? period.to : today < period.from ? period.from : today);

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
    <div className="page records">
      <header className="page-header records__header">
        <h1 className="page-header__title" tabIndex={-1}>
          Records
        </h1>
        <RecordsPeriod period={period} today={today} onChange={onPeriodChange} />
        {onExport ? (
          <Button
            size="small"
            className="records__export"
            disabled={periodPosts.length === 0}
            title={`The period's ${plural(periodPosts.length, 'post', 'posts')}, in the posting tracker's columns`}
            onClick={() => onExport(postsCsv(periodPosts), `posts ${period.from} to ${period.to}.csv`)}
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
              <RecordsChart buckets={report.buckets} summary={summary} />
            </section>

            <RecordsBreakdown
              tab={tab}
              onTabChange={setTab}
              interns={report.interns}
              categories={report.categories}
              internHref={internsHref ? () => internsHref(internWeek) : undefined}
              onIntern={onOpenIntern ? (name) => onOpenIntern(name, internWeek) : undefined}
            />
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
