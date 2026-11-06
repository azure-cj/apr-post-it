import { describe, expect, it } from 'vitest';
import {
  addWorkdays,
  assignmentPeriod,
  chooseQueue,
  currentQueue,
  firstWorkday,
  freeStart,
  isRowOver,
  periodFrom,
  periodLabel,
  queueDue,
  queueInWeek,
  queuesOf,
  queueWeeksOf,
  rowsInWeek,
  workdaysBetween,
} from './queues';
import { fridayWarning, fridayWarningWords, heldListings, queueProgress, weekProgress } from './summary';
import type { Assignment, PostLogEntry } from './types';

// Fri 6 Nov 2026. The week of 2 Nov is this week; 9 Nov the next.
const FRI = '2026-11-06';

const row = (assignedTo: string, date: string, propertyName: string, due = '', status: Assignment['status'] = 'Not Shared'): Assignment => ({
  date,
  assignedTo,
  propertyName,
  propertyId: propertyName.replace(/\W+/g, '-'),
  status,
  ...(due ? { due } : {}),
});

const post = (postedBy: string, date: string, title: string): PostLogEntry => ({
  date,
  time: '10:00',
  type: '',
  title,
  status: 'Posted',
  fbAccount: '',
  postLink: 'https://www.facebook.com/groups/1/posts/2',
  postedBy,
  propertyId: title.replace(/\W+/g, '-'),
});

describe('working days', () => {
  it('skips the weekend', () => {
    expect(firstWorkday('2026-11-07')).toBe('2026-11-09'); // Saturday → Monday
    expect(firstWorkday('2026-11-08')).toBe('2026-11-09'); // Sunday → Monday
    expect(firstWorkday(FRI)).toBe(FRI);
    expect(addWorkdays(FRI, 1)).toBe('2026-11-09');
    expect(addWorkdays(FRI, 5)).toBe('2026-11-13');
    expect(addWorkdays('2026-11-07', 0)).toBe('2026-11-09');
    expect(workdaysBetween(FRI, '2026-11-09')).toBe(2);
    expect(workdaysBetween('2026-11-02', '2026-11-13')).toBe(10);
    expect(workdaysBetween('2026-11-09', FRI)).toBe(0);
  });

  it('gives a queue saved on Friday for 2 weeks its deadline the Thursday after next: 10 working days', () => {
    expect(queueDue(FRI, 2)).toBe('2026-11-19');
    expect(workdaysBetween(FRI, queueDue(FRI, 2))).toBe(10);
    expect(queueDue(FRI, 1)).toBe('2026-11-12');
    expect(queueDue(FRI, 3)).toBe('2026-11-26');
    // From Monday, a week is Monday to Friday.
    expect(queueDue('2026-11-09', 1)).toBe('2026-11-13');
    // Saved at the weekend: it starts on Monday.
    expect(periodFrom('2026-11-07', 2)).toEqual({ key: '2026-11-09', start: '2026-11-09', due: '2026-11-20', weeks: 2 });
    expect(periodFrom(FRI, 2)).toEqual({ key: '2026-11-02', start: FRI, due: '2026-11-19', weeks: 2 });
  });

  it('keeps a length to 1, 2 or 3 weeks', () => {
    expect([0, 1, 2, 3, 4, 2.4, Number.NaN, '2'].map(queueWeeksOf)).toEqual([1, 1, 2, 3, 3, 2, 2, 2]);
  });

  it('labels a period by its days', () => {
    expect(periodLabel({ start: FRI, due: '2026-11-19' })).toBe('6–19 Nov');
    expect(periodLabel({ start: '2026-10-30', due: '2026-11-12' })).toBe('30 Oct – 12 Nov');
  });
});

describe('a row\'s queue', () => {
  it('reads Date and Due as start and deadline, and a row without Due as its week', () => {
    expect(assignmentPeriod(row('Jan', FRI, 'A', '2026-11-19'))).toEqual({ key: '2026-11-02', start: FRI, due: '2026-11-19', weeks: 2 });
    expect(assignmentPeriod(row('Jan', '2026-11-02', 'A'))).toEqual({ key: '2026-11-02', start: '2026-11-02', due: FRI, weeks: 1 });
    // A Due before the Date can't be: its week.
    expect(assignmentPeriod(row('Jan', FRI, 'A', '2026-11-02'))).toMatchObject({ start: '2026-11-02', due: FRI });
    expect(assignmentPeriod(row('Jan', 'soon', 'A'))).toBeUndefined();
  });

  it('is over the day after its deadline, not on Friday', () => {
    const r = row('Jan', FRI, 'A', '2026-11-19');
    expect(isRowOver(r, '2026-11-13')).toBe(false);
    expect(isRowOver(r, '2026-11-19')).toBe(false);
    expect(isRowOver(r, '2026-11-20')).toBe(true);
    // A one-week row is over on Saturday.
    expect(isRowOver(row('Jan', '2026-11-02', 'B'), '2026-11-07')).toBe(true);
  });

  it('holds a listing until the deadline', () => {
    const rows = [row('Jan', FRI, 'Casa', '2026-11-19')];
    expect(heldListings(rows, '2026-11-16').size).toBe(1);
    expect(heldListings(rows, '2026-11-20').size).toBe(0);
  });
});

describe('a person\'s queues', () => {
  const rows = [
    row('Jan', '2026-10-26', 'Old'),
    row('Jan', FRI, 'A', '2026-11-19'),
    row('Jan', FRI, 'B', '2026-11-19'),
    row('Ana', '2026-11-02', 'C'),
  ];

  it('lists them earliest first, one per week key', () => {
    expect(queuesOf('jan', rows).map((q) => [q.start, q.due])).toEqual([
      ['2026-10-26', '2026-10-30'],
      [FRI, '2026-11-19'],
    ]);
  });

  it('finds the one running in a week, which may have started in the one before', () => {
    expect(queueInWeek('Jan', '2026-11-09', rows, FRI)?.start).toBe(FRI);
    expect(queueInWeek('Jan', '2026-11-16', rows, FRI)?.start).toBe(FRI);
    expect(queueInWeek('Jan', '2026-11-23', rows, FRI)).toBeUndefined();
    expect(rowsInWeek(rows, '2026-11-09', FRI).map((r) => r.propertyName)).toEqual(['A', 'B']);
  });

  it('knows which is current, and where the next may start', () => {
    expect(currentQueue('Jan', rows, '2026-11-12')?.start).toBe(FRI);
    expect(currentQueue('Ana', rows, '2026-11-12')).toBeUndefined();
    expect(freeStart(queuesOf('Jan', rows), FRI)).toBe('2026-11-20');
    expect(freeStart(queuesOf('Ana', rows), '2026-11-07')).toBe('2026-11-09');
  });
});

describe('chooseQueue: what Assign shows', () => {
  it('starts a new queue today, Friday, for 2 weeks: due the Thursday after next', () => {
    const c = chooseQueue('Bea', '2026-11-02', [], FRI, 2);
    expect(c).toMatchObject({ saved: false, past: false, period: { start: FRI, due: '2026-11-19', weeks: 2 } });
  });

  it('starts next week\'s on its Monday', () => {
    expect(chooseQueue('Bea', '2026-11-09', [], FRI, 2).period).toMatchObject({ start: '2026-11-09', due: '2026-11-20' });
  });

  it('shows the saved queue running in the week, and offers the next one after its deadline', () => {
    const rows = [row('Jan', FRI, 'A', '2026-11-19')];
    const thisWeek = chooseQueue('Jan', '2026-11-02', rows, FRI, 2);
    expect(thisWeek).toMatchObject({ saved: true, period: { start: FRI, due: '2026-11-19' }, next: '2026-11-16', prev: undefined });
    // The week after: still the same queue.
    expect(chooseQueue('Jan', '2026-11-09', rows, FRI, 2)).toMatchObject({ saved: true, period: { start: FRI } });
    // Its "next": a new queue from the day after its deadline.
    const next = chooseQueue('Jan', '2026-11-16', rows, FRI, 2);
    expect(next).toMatchObject({ saved: false, period: { start: '2026-11-20', due: '2026-12-03' }, prev: '2026-11-02' });
  });

  it('keeps a new queue before the next saved one', () => {
    const rows = [row('Jan', '2026-11-16', 'A', '2026-11-20')];
    const c = chooseQueue('Jan', '2026-11-02', rows, FRI, 2);
    expect(c).toMatchObject({ saved: false, latestDue: '2026-11-15', next: '2026-11-16' });
  });

  it('has nothing for a week gone by with no queue', () => {
    expect(chooseQueue('Bea', '2026-10-19', [], FRI, 2)).toMatchObject({ past: true, saved: false });
  });
});

describe('progress over a queue', () => {
  const rows = Array.from({ length: 20 }, (_, i) => row('Jan', FRI, `L${i}`, '2026-11-19'));

  it('targets the whole queue, paced on its working days, and counts posts while it runs', () => {
    const period = assignmentPeriod(rows[0]!)!;
    const posts = [post('Jan', FRI, 'L0'), post('Jan', '2026-11-09', 'L1'), post('Jan', '2026-11-05', 'L2')];
    const p = queueProgress('Jan', period, rows, posts, '2026-11-10');
    // Fri, Mon, Tue: 3 of 10 days gone, so 6 of 20 expected; the post before it started doesn't count.
    expect(p).toMatchObject({ target: 20, posted: 2, expectedByToday: 6, pace: 'behind', daysLeft: 7, missed: 0 });
    // weekProgress finds the same queue from the week after.
    expect(weekProgress('Jan', '2026-11-09', rows, posts, '2026-11-10')).toMatchObject({ target: 20, posted: 2 });
    // The day after its deadline: missed.
    expect(queueProgress('Jan', period, rows, posts, '2026-11-20')).toMatchObject({ pace: 'missed', missed: 18 });
  });

  it('warns from the queue\'s third working day to its deadline, today counted', () => {
    const period = assignmentPeriod(rows[0]!)!;
    const p = (today: string) => queueProgress('Jan', period, rows, [], today);
    expect(fridayWarning(p('2026-11-09'), '2026-11-09', '2026-11-09')).toBeNull();
    const tue = fridayWarning(p('2026-11-10'), '2026-11-09', '2026-11-10')!;
    expect(tue).toEqual({ left: 20, daysLeft: 8, perDay: 3 });
    expect(fridayWarningWords(fridayWarning(p('2026-11-19'), '2026-11-16', '2026-11-19')!)).toBe('20 left: due today.');
    expect(fridayWarning(p('2026-11-20'), '2026-11-16', '2026-11-20')).toBeNull();
  });
});
