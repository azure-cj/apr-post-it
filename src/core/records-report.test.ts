import {
  byAccount,
  byCategory,
  byIntern,
  canStepForward,
  chartBuckets,
  compareToPrevious,
  comparisonLabel,
  comparisonSpan,
  customPeriod,
  elapsedSpan,
  missedInPeriod,
  mondayOf,
  periodFromQuery,
  periodLabel,
  periodQuery,
  periodTotals,
  presetOf,
  presetPeriod,
  queueWeeks,
  searchPosts,
  sortPosts,
  spanLabel,
  stepPeriod,
  type Period,
} from './records';
import type { Assignment, PostLogEntry } from './types';

/** Wed 4 Nov 2026: the week of 2–6 Nov, three weekdays in. */
const WED = '2026-11-04';
/** Sat 31 Oct 2026. */
const SAT = '2026-10-31';

function post(over: Partial<PostLogEntry> = {}): PostLogEntry {
  return {
    date: '2026-11-02',
    time: '09:00',
    type: 'Warehouse',
    title: 'Listing A',
    status: 'Posted',
    fbAccount: 'APG Main',
    postLink: 'https://fb.com/1',
    postedBy: 'Jan',
    propertyId: 'A',
    ...over,
  };
}

function queued(who: string, week: string, name: string, status: Assignment['status'] = 'Not Shared'): Assignment {
  return { date: week, week, assignedTo: who, propertyName: name, propertyId: name, status };
}

describe('periods', () => {
  it('makes each preset on a weekday and on a weekend', () => {
    expect(presetPeriod('this-week', WED)).toEqual({ kind: 'week', from: '2026-11-02', to: '2026-11-08' });
    expect(presetPeriod('last-week', WED)).toEqual({ kind: 'week', from: '2026-10-26', to: '2026-11-01' });
    // On Saturday, this week is the work week that just ended.
    expect(presetPeriod('this-week', SAT)).toEqual({ kind: 'week', from: '2026-10-26', to: '2026-11-01' });
    expect(presetPeriod('this-month', WED)).toEqual({ kind: 'month', from: '2026-11-01', to: '2026-11-30' });
    expect(presetPeriod('last-30', WED)).toEqual({ kind: 'days', from: '2026-10-06', to: WED });
    expect(presetPeriod('custom', WED).kind).toBe('custom');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
  });

  it('steps a week, a month, 30 days or its own length, and knows the preset it lands on', () => {
    const week = presetPeriod('this-week', WED);
    expect(stepPeriod(week, -1)).toEqual(presetPeriod('last-week', WED));
    expect(presetOf(stepPeriod(week, -1), WED)).toBe('last-week');
    expect(presetOf(stepPeriod(week, -2), WED)).toBeNull();
    expect(stepPeriod(presetPeriod('this-month', '2026-03-15'), -1)).toEqual({ kind: 'month', from: '2026-02-01', to: '2026-02-28' });
    expect(stepPeriod({ kind: 'month', from: '2026-12-01', to: '2026-12-31' }, 1)).toEqual({ kind: 'month', from: '2027-01-01', to: '2027-01-31' });
    expect(stepPeriod(presetPeriod('last-30', WED), -1)).toEqual({ kind: 'days', from: '2026-09-06', to: '2026-10-05' });
    expect(stepPeriod(customPeriod('2026-10-10', '2026-10-01'), 1)).toEqual({ kind: 'custom', from: '2026-10-11', to: '2026-10-20' });
    expect(canStepForward(week, WED)).toBe(false);
    expect(canStepForward(stepPeriod(week, -1), WED)).toBe(true);
  });

  it('reads and writes the link, this week being the default', () => {
    for (const p of ['this-week', 'last-week', 'this-month', 'last-30'] as const) {
      const period = presetPeriod(p, WED);
      expect(periodFromQuery(periodQuery(period, WED), WED)).toEqual(period);
    }
    expect(periodQuery(presetPeriod('this-week', WED), WED)).toEqual({});
    expect(periodQuery(presetPeriod('last-week', WED), WED)).toEqual({ period: 'week', from: '2026-10-26' });
    expect(periodQuery(presetPeriod('this-month', WED), WED)).toEqual({ period: 'month', from: '2026-11-01' });
    expect(periodQuery(presetPeriod('last-30', WED), WED)).toEqual({ period: '30d', to: WED });
    expect(periodFromQuery({ period: 'custom', from: '2026-10-20', to: '2026-10-01' }, WED)).toEqual({
      kind: 'custom',
      from: '2026-10-01',
      to: '2026-10-20',
    });
    // Any day of a week or month names it; nonsense is this week.
    expect(periodFromQuery({ period: 'week', from: '2026-10-29' }, WED).from).toBe('2026-10-26');
    expect(periodFromQuery({ period: 'month', from: '2026-10-29' }, WED).from).toBe('2026-10-01');
    expect(periodFromQuery({ period: 'week', from: '29/10/2026' }, WED)).toEqual(presetPeriod('this-week', WED));
    expect(periodFromQuery({}, WED)).toEqual(presetPeriod('this-week', WED));
    // Custom is at most two years.
    expect(customPeriod('2020-01-01', '2026-01-01').from).toBe('2024-01-02');
  });

  it('says a period in words', () => {
    expect(periodLabel(presetPeriod('this-week', WED))).toBe('2–6 Nov');
    expect(periodLabel(presetPeriod('this-month', WED))).toBe('Nov 2026');
    expect(periodLabel(presetPeriod('last-30', WED))).toBe('6 Oct – 4 Nov');
    expect(spanLabel('2026-11-03', '2026-11-03')).toBe('Tue 3 Nov');
    expect(spanLabel('2026-12-29', '2027-01-04')).toBe('29 Dec 2026 – 4 Jan 2027');
  });

  it('compares a period under way with the same days of the one before', () => {
    const week = presetPeriod('this-week', WED);
    expect(elapsedSpan(week, WED)).toEqual({ from: '2026-11-02', to: WED });
    expect(comparisonSpan(week, WED)).toEqual({ from: '2026-10-26', to: '2026-10-28' });
    expect(comparisonLabel(week, WED)).toBe('26–28 Oct');
    // A period that is over is set against the whole one before.
    const last = presetPeriod('last-week', WED);
    expect(comparisonSpan(last, WED)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(comparisonLabel(last, WED)).toBe('19–23 Oct');
    expect(comparisonLabel({ kind: 'month', from: '2026-10-01', to: '2026-10-31' }, WED)).toBe('Sep');
    // March 31 days in, February has only 28.
    expect(comparisonSpan(presetPeriod('this-month', '2026-03-31'), '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(elapsedSpan(stepPeriod(week, 1), WED)).toBeNull();
    expect(compareToPrevious(12, 9)).toEqual({ change: 3, direction: 'up' });
    expect(compareToPrevious(2, 9)).toEqual({ change: -7, direction: 'down' });
    expect(compareToPrevious(4, 4)).toEqual({ change: 0, direction: 'same' });
  });
});

describe('the period’s numbers', () => {
  const posts = [
    post({ date: '2026-11-02', postedBy: 'Jan' }),
    post({ date: '2026-11-03', postedBy: 'Jan', status: 'Pending', type: 'Office Space', fbAccount: 'APG Rentals' }),
    post({ date: '2026-11-03', postedBy: ' mika ', type: 'office space' }),
    post({ date: '2026-11-03', postedBy: 'Bea', type: '' }),
    post({ date: '2026-11-04', postedBy: 'Mika' }),
    post({ date: '2026-10-30', postedBy: 'Jan' }), // the week before
    post({ date: 'soon', postedBy: 'Jan' }),
  ];
  const span = { from: '2026-11-02', to: '2026-11-08' };

  it('counts posts, pending, people and the busiest day', () => {
    expect(periodTotals(posts, span)).toEqual({
      posts: 5,
      posted: 4,
      pending: 1,
      interns: 3,
      busiest: { date: '2026-11-03', count: 3 },
    });
    expect(periodTotals([], span)).toEqual({ posts: 0, posted: 0, pending: 0, interns: 0, busiest: null });
  });

  it('breaks the posts down by category and by FB account, most first', () => {
    expect(byCategory(posts, span).map((r) => [r.label, r.key, r.count, r.pending])).toEqual([
      ['Office Space', 'office space', 2, 1],
      ['Warehouse', 'warehouse', 2, 0],
      ['Unsorted', 'unsorted', 1, 0],
    ]);
    expect(byAccount(posts, span).map((r) => [r.label, r.count])).toEqual([
      ['APG Main', 4],
      ['APG Rentals', 1],
    ]);
    // Each row's key finds its posts again.
    expect(searchPosts(posts, { ...span, type: 'unsorted' })).toHaveLength(1);
    expect(searchPosts(posts, { ...span, type: 'OFFICE SPACE' })).toHaveLength(2);
    expect(searchPosts(posts, { ...span, fbAccount: 'apg rentals' })).toHaveLength(1);
  });

  it('finds what was missed in weeks that are over, by intern, with completion', () => {
    const LAST = '2026-10-26';
    const THIS = '2026-11-02';
    const assignments = [
      queued('Jan', LAST, 'A', 'Posted'),
      queued('Jan', LAST, 'B'),
      queued('Jan', LAST, 'C'),
      queued('Mika', LAST, 'D', 'Pending'),
      queued('Jan', THIS, 'E'),
      queued('Jan', THIS, 'F'),
    ];
    // Jan posted C on Friday: the queue's row lags, the post counts.
    const theirPosts = [post({ date: '2026-10-30', postedBy: 'Jan', title: 'C', propertyId: 'C' })];
    const month = { from: '2026-10-01', to: '2026-11-30' };
    const weeks = queueWeeks(assignments, theirPosts, month, WED);
    expect(weeks.map((w) => [w.intern, w.week, w.target, w.posted, w.pending, w.missed, w.over])).toEqual([
      ['Jan', LAST, 3, 2, 0, 1, true],
      ['Mika', LAST, 1, 0, 1, 0, true],
      ['Jan', THIS, 2, 0, 0, 0, false],
    ]);
    const missed = missedInPeriod(weeks);
    expect(missed.total).toBe(1);
    expect(missed.weeksOver).toBe(1);
    expect([...missed.byIntern]).toEqual([
      ['Jan', 1],
      ['Mika', 0],
    ]);
    // Only queues whose Friday falls in the span count.
    expect(queueWeeks(assignments, theirPosts, { from: '2026-11-01', to: '2026-11-08' }, WED)).toHaveLength(1);
    expect(missedInPeriod(queueWeeks(assignments, theirPosts, { from: '2026-11-01', to: '2026-11-08' }, WED)).weeksOver).toBe(0);

    const rows = byIntern(theirPosts, weeks, month, [], ['Bea']);
    expect(rows.map((r) => [r.name, r.posts, r.missed, r.target, r.done, r.completion])).toEqual([
      ['Jan', 1, 1, 5, 2, 0.4],
      ['Bea', 0, 0, 0, 0, null],
      ['Mika', 0, 0, 1, 1, 1],
    ]);
  });

  it('ranks interns by posts, with a trend per bar', () => {
    const buckets = [
      { from: '2026-11-02', to: '2026-11-02' },
      { from: '2026-11-03', to: '2026-11-03' },
      { from: '2026-11-04', to: '2026-11-04' },
    ];
    const rows = byIntern(posts, [], span, buckets);
    expect(rows.map((r) => [r.name, r.posts, r.pending, r.trend])).toEqual([
      ['Jan', 2, 1, [1, 1, 0]],
      ['mika', 2, 0, [0, 1, 1]],
      ['Bea', 1, 0, [0, 1, 0]],
    ]);
  });
});

describe('chart buckets', () => {
  it('shows a week as Monday to Friday, and a weekend day only when posted on', () => {
    const week: Period = presetPeriod('this-week', WED);
    const quiet = chartBuckets([post({ date: '2026-11-03' }), post({ date: '2026-11-03', status: 'Pending' })], week, WED);
    expect(quiet.map((b) => [b.from, b.posted, b.pending, b.later])).toEqual([
      ['2026-11-02', 0, 0, false],
      ['2026-11-03', 1, 1, false],
      ['2026-11-04', 0, 0, false],
      ['2026-11-05', 0, 0, true],
      ['2026-11-06', 0, 0, true],
    ]);
    const weekend = chartBuckets([post({ date: '2026-11-07' })], week, '2026-11-08');
    expect(weekend.map((b) => b.from)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  });

  it('has a bar a day for a month, and a bar a week for a long period', () => {
    expect(chartBuckets([], presetPeriod('this-month', WED), WED)).toHaveLength(30);
    const long = chartBuckets([post({ date: '2026-09-30' })], customPeriod('2026-09-01', '2026-11-04'), WED);
    expect(long[0]).toMatchObject({ from: '2026-09-01', to: '2026-09-06', unit: 'week' });
    expect(long.at(-1)).toMatchObject({ from: '2026-11-02', to: '2026-11-04' });
    expect(long.find((b) => b.from === '2026-09-28')?.posted).toBe(1);
  });
});

describe('sorting the list', () => {
  const a = post({ date: '2026-11-02', time: '10:00', title: 'b listing', postedBy: 'Mika', fbAccount: '' });
  const b = post({ date: '2026-11-03', time: '08:00', title: 'A listing', postedBy: 'Jan', status: 'Pending' });
  const c = post({ date: '2026-11-03', time: '09:30', title: 'c listing', postedBy: 'Bea', fbAccount: 'Zed' });

  it('sorts by any column, newest first on a tie, blanks last', () => {
    expect(sortPosts([a, b, c], 'date', 'desc')).toEqual([c, b, a]);
    expect(sortPosts([a, b, c], 'date', 'asc')).toEqual([a, b, c]);
    expect(sortPosts([a, b, c], 'title', 'asc')).toEqual([b, a, c]);
    expect(sortPosts([a, b, c], 'postedBy', 'desc')).toEqual([a, b, c]);
    expect(sortPosts([a, b, c], 'time', 'asc')).toEqual([b, c, a]);
    expect(sortPosts([a, b, c], 'status', 'asc')).toEqual([b, c, a]);
    expect(sortPosts([a, b, c], 'fbAccount', 'asc')).toEqual([b, c, a]);
    expect(sortPosts([a, b, c], 'fbAccount', 'desc')).toEqual([c, b, a]);
  });
});
