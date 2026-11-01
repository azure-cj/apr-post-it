/**
 * v6: weekly queues. The work week (week.ts), an intern's pace through it and
 * the weekly monitor (summary.ts), and "who posted it?" (records.ts).
 */

import { describe, expect, it } from 'vitest';
import { whoPosted } from './records';
import { teamWeek, weekPostsByDay, weekProgress } from './summary';
import type { Assignment, AssignmentStatus, PostLogEntry, PostStatus } from './types';
import {
  addWeeks,
  assignmentWeek,
  isWeekKey,
  isWeekOver,
  weekDays,
  weekdaysElapsed,
  weekdaysLeft,
  weekFriday,
  weekLabel,
  weekOf,
} from './week';

// ------------------------------------------------------------------ the week

describe('weekOf', () => {
  it.each([
    ['Monday', '2026-11-02', '2026-11-02'],
    ['Tuesday', '2026-11-03', '2026-11-02'],
    ['Friday', '2026-11-06', '2026-11-02'],
    ['Saturday: the next week', '2026-11-07', '2026-11-09'],
    ['Sunday: the next week', '2026-11-08', '2026-11-09'],
    ['Sunday 1 Nov, across the month: Monday 2 Nov', '2026-11-01', '2026-11-02'],
    ['Friday 30 Oct, across the month', '2026-10-30', '2026-10-26'],
    ['Saturday 31 Oct, across the month', '2026-10-31', '2026-11-02'],
    ['Thursday 31 Dec, across the year', '2026-12-31', '2026-12-28'],
    ['Saturday 2 Jan, across the year', '2027-01-02', '2027-01-04'],
    ['Saturday 28 Feb', '2026-02-28', '2026-03-02'],
    ['a leap day, Thursday', '2028-02-29', '2028-02-28'],
  ])('%s', (_, date, week) => {
    expect(weekOf(date)).toBe(week);
  });

  it('throws on anything but a real yyyy-MM-dd day', () => {
    for (const bad of ['', '2026-02-30', '11/2/2026', '2026-11-2', 'Monday']) expect(() => weekOf(bad), bad).toThrow();
  });
});

describe('the week\'s days', () => {
  it('runs Monday to Friday, across a month boundary too', () => {
    expect(weekDays('2026-11-02')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(weekDays('2026-10-26')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(weekDays('2026-11-30')).toEqual(['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']);
    // Any day of the week names it.
    expect(weekDays('2026-11-04')[0]).toBe('2026-11-02');
  });

  it('ends on Friday, the deadline', () => {
    expect(weekFriday('2026-11-02')).toBe('2026-11-06');
    expect(weekFriday('2026-09-28')).toBe('2026-10-02');
  });

  it('is over once today is past Friday', () => {
    expect(isWeekOver('2026-11-02', '2026-11-01')).toBe(false);
    expect(isWeekOver('2026-11-02', '2026-11-06')).toBe(false);
    expect(isWeekOver('2026-11-02', '2026-11-07')).toBe(true);
    expect(isWeekOver('2026-11-02', '2027-01-01')).toBe(true);
  });

  it('steps by weeks, forward and back, across months and years', () => {
    expect(addWeeks('2026-11-02', 1)).toBe('2026-11-09');
    expect(addWeeks('2026-11-02', -1)).toBe('2026-10-26');
    expect(addWeeks('2026-12-28', 1)).toBe('2027-01-04');
    expect(addWeeks('2026-11-02', 0)).toBe('2026-11-02');
    expect(addWeeks('2026-11-05', 1)).toBe('2026-11-09');
  });

  it('knows a week key: a real Monday', () => {
    expect(isWeekKey('2026-11-02')).toBe(true);
    expect(isWeekKey('2026-11-03')).toBe(false);
    expect(isWeekKey('2026-11-08')).toBe(false);
    expect(isWeekKey('2026-02-30')).toBe(false);
    expect(isWeekKey('')).toBe(false);
  });

  it('counts the weekdays gone and left, today included', () => {
    const at = (today: string) => [weekdaysElapsed('2026-11-02', today), weekdaysLeft('2026-11-02', today)];
    expect(at('2026-10-31')).toEqual([0, 5]); // the Saturday before: the week has not started
    expect(at('2026-11-02')).toEqual([1, 4]);
    expect(at('2026-11-04')).toEqual([3, 2]);
    expect(at('2026-11-06')).toEqual([5, 0]);
    expect(at('2026-11-07')).toEqual([5, 0]);
  });
});

describe('weekLabel', () => {
  it.each([
    ['2026-11-02', '2–6 Nov'],
    ['2026-10-26', '26–30 Oct'],
    ['2026-11-30', '30 Nov – 4 Dec'],
    ['2026-09-28', '28 Sep – 2 Oct'],
    ['2026-12-28', '28 Dec – 1 Jan'],
    // Any day of the week, a weekend naming the next.
    ['2026-11-04', '2–6 Nov'],
    ['2026-10-31', '2–6 Nov'],
  ])('%s → %s', (week, label) => {
    expect(weekLabel(week)).toBe(label);
  });
});

describe('assignmentWeek', () => {
  it('takes the row\'s week when it is a Monday, else its date\'s, so old daily rows read as their week', () => {
    expect(assignmentWeek({ date: '2026-11-02', week: '2026-11-02' })).toBe('2026-11-02');
    expect(assignmentWeek({ date: '2026-11-04' })).toBe('2026-11-02');
    expect(assignmentWeek({ date: '2026-11-07' })).toBe('2026-11-09');
    expect(assignmentWeek({ date: '2026-11-04', week: '2026-11-04' })).toBe('2026-11-02');
    expect(assignmentWeek({ date: '2026-11-04', week: '' })).toBe('2026-11-02');
    expect(assignmentWeek({ date: '' })).toBe('');
    expect(assignmentWeek({ date: 'soon', week: 'later' })).toBe('');
  });
});

// ------------------------------------------------------------------ pace

const WEEK = '2026-11-02';
const JAN = 'Jan Dela Cruz';
const ANA = 'Ana Reyes';
const MIA = 'Mia Cruz';

function row(assignedTo: string, n: number, status: AssignmentStatus = 'Not Shared', date = WEEK): Assignment {
  return { date, assignedTo, propertyName: `Listing ${n}`, propertyId: `F${n}`, status };
}

/** `posted` Posted, `pending` Pending, the rest Not Shared, out of `target`. */
function queueOf(assignedTo: string, target: number, posted = 0, pending = 0, date = WEEK): Assignment[] {
  return Array.from({ length: target }, (_, i) =>
    row(assignedTo, i, i < posted ? 'Posted' : i < posted + pending ? 'Pending' : 'Not Shared', date),
  );
}

function post(postedBy: string, date: string, n = 0, status: PostStatus = 'Posted', over: Partial<PostLogEntry> = {}): PostLogEntry {
  return {
    date,
    time: '09:00',
    type: 'Lot',
    title: `Listing ${n}`,
    status,
    fbAccount: 'APG Main',
    postLink: `https://www.facebook.com/groups/apg/posts/${n}${date.replace(/-/g, '')}/`,
    postedBy,
    propertyId: `F${n}`,
    ...over,
  };
}

describe('weekProgress', () => {
  const progress = (rows: readonly Assignment[], today: string, posts: readonly PostLogEntry[] = []) =>
    weekProgress(JAN, WEEK, rows, posts, today);

  it('counts the queue by status', () => {
    expect(progress(queueOf(JAN, 10, 3, 2), '2026-11-04')).toMatchObject({ target: 10, posted: 3, pending: 2, notShared: 5, missed: 0 });
  });

  describe('pace through the week (target 10: 2 a day)', () => {
    it.each([
      // today, posted, pending, expectedByToday, daysLeft, pace
      ['the Saturday before, nothing yet', '2026-10-31', 0, 0, 0, 5, 'on-track'],
      ['Sunday before, nothing yet', '2026-11-01', 0, 0, 0, 5, 'on-track'],
      ['Monday, nothing yet', '2026-11-02', 0, 0, 2, 4, 'behind'],
      ['Monday, 2 posted', '2026-11-02', 2, 0, 2, 4, 'on-track'],
      ['Tuesday, nothing yet: past Monday', '2026-11-03', 0, 0, 4, 3, 'not-started'],
      ['Tuesday, a pending one counts as started', '2026-11-03', 0, 1, 4, 3, 'behind'],
      ['Wednesday, 5 of 6 expected', '2026-11-04', 5, 0, 6, 2, 'behind'],
      ['Wednesday, 4 posted and 2 pending', '2026-11-04', 4, 2, 6, 2, 'on-track'],
      ['Thursday, ahead', '2026-11-05', 9, 0, 8, 1, 'on-track'],
      ['Friday, 9 of 10', '2026-11-06', 9, 0, 10, 0, 'behind'],
      ['Friday, all of them, pending included', '2026-11-06', 8, 2, 10, 0, 'done'],
      ['Wednesday, all of them already', '2026-11-04', 10, 0, 6, 2, 'done'],
      ['Saturday after, 9 of 10: missed', '2026-11-07', 9, 0, 10, 0, 'missed'],
      ['a month later, nothing: missed', '2026-12-02', 0, 0, 10, 0, 'missed'],
      ['Saturday after, all of them', '2026-11-07', 10, 0, 10, 0, 'done'],
    ] as const)('%s', (_, today, posted, pending, expectedByToday, daysLeft, pace) => {
      expect(progress(queueOf(JAN, 10, posted, pending), today)).toMatchObject({ expectedByToday, daysLeft, pace });
    });
  });

  it('rounds expectedByToday up', () => {
    // 7 over 5 days: Monday 1.4 → 2, Tuesday 2.8 → 3.
    expect(progress(queueOf(JAN, 7), '2026-11-02').expectedByToday).toBe(2);
    expect(progress(queueOf(JAN, 7), '2026-11-03').expectedByToday).toBe(3);
  });

  it('counts the unposted rows of an over week as Missed, and none before', () => {
    expect(progress(queueOf(JAN, 10, 6, 1), '2026-11-06')).toMatchObject({ missed: 0, notShared: 3 });
    expect(progress(queueOf(JAN, 10, 6, 1), '2026-11-07')).toMatchObject({ missed: 3, notShared: 3, pace: 'missed' });
  });

  it('is on track with nothing to do: no queue that week', () => {
    expect(progress([], '2026-11-04')).toMatchObject({ target: 0, expectedByToday: 0, pace: 'on-track' });
    expect(progress([], '2026-11-09')).toMatchObject({ target: 0, missed: 0, pace: 'on-track' });
  });

  it('reads old daily rows as their week, and leaves out other weeks and other people', () => {
    const rows = [
      row(JAN, 1, 'Posted', '2026-11-03'),
      row(JAN, 2, 'Not Shared', '2026-11-05'),
      row(JAN, 3, 'Not Shared', '2026-11-07'), // Saturday: next week's
      row(JAN, 4, 'Not Shared', '2026-10-30'), // last week's
      row(ANA, 5, 'Not Shared'),
      { ...row(' jan dela cruz ', 6, 'Pending'), week: WEEK },
    ];
    expect(progress(rows, '2026-11-04')).toMatchObject({ target: 3, posted: 1, pending: 1, notShared: 1 });
  });

  it("counts a Not Shared row as posted when the intern's own post of it is dated that week", () => {
    const rows = queueOf(JAN, 3);
    const posts = [
      post(JAN, '2026-11-03', 0),
      post(JAN, '2026-11-04', 1, 'Pending'),
      post(ANA, '2026-11-04', 2), // someone else's post: not Jan's
      post(JAN, '2026-10-30', 2), // last week: not this week's
    ];
    expect(progress(rows, '2026-11-04', posts)).toMatchObject({ posted: 1, pending: 1, notShared: 1 });
  });

  it('needs a real week and today', () => {
    expect(() => progress([], 'today')).toThrow();
    expect(() => weekProgress(JAN, 'week', [], [], '2026-11-02')).toThrow();
  });
});

describe('weekPostsByDay', () => {
  it("counts the intern's posts, Posted and Pending, Monday to Friday", () => {
    const posts = [
      post(JAN, '2026-11-02', 1),
      post(JAN, '2026-11-02', 2, 'Pending'),
      post(JAN, '2026-11-04', 3),
      post(' jan dela cruz ', '2026-11-06', 4),
      post(JAN, '2026-11-01', 5), // Sunday before
      post(JAN, '2026-11-07', 6), // Saturday after
      post(ANA, '2026-11-03', 7),
      post(JAN, '2026-10-30', 8), // last week
    ];
    expect(weekPostsByDay(JAN, WEEK, posts)).toEqual([2, 0, 1, 0, 1]);
    expect(weekPostsByDay(JAN, '2026-11-04', posts)).toEqual([2, 0, 1, 0, 1]);
    expect(weekPostsByDay(MIA, WEEK, posts)).toEqual([0, 0, 0, 0, 0]);
  });

  it('works across a month boundary', () => {
    expect(weekPostsByDay(JAN, '2026-10-26', [post(JAN, '2026-10-30'), post(JAN, '2026-10-26')])).toEqual([1, 0, 0, 0, 1]);
  });
});

describe('teamWeek', () => {
  it('gives every intern a row, worst first: missed, not started, behind, on track, done', () => {
    const assignments = [...queueOf(JAN, 10, 10), ...queueOf(ANA, 10, 0), ...queueOf(MIA, 10, 5), ...queueOf('Lea Go', 10, 3)];
    const rows = teamWeek([JAN, ANA, MIA, 'Lea Go', 'Kim Sy'], WEEK, assignments, [post(MIA, '2026-11-03', 0)], '2026-11-04');

    // Wednesday: 6 of 10 expected. Lea is 3 short, Mia 1; Kim has no queue (target 0).
    expect(rows.map((r) => `${r.name}:${r.pace}`)).toEqual([
      `${ANA}:not-started`,
      'Lea Go:behind',
      `${MIA}:behind`,
      'Kim Sy:on-track',
      `${JAN}:done`,
    ]);
    expect(rows.find((r) => r.name === MIA)?.byDay).toEqual([0, 1, 0, 0, 0]);
  });

  it('puts the furthest behind first among the behind, and lists missed weeks first', () => {
    const assignments = [...queueOf(JAN, 10, 1), ...queueOf(ANA, 10, 4), ...queueOf(MIA, 10, 9)];
    const thursday = teamWeek([MIA, ANA, JAN], WEEK, assignments, [], '2026-11-05');
    expect(thursday.map((r) => r.name)).toEqual([JAN, ANA, MIA]);

    const saturday = teamWeek([MIA, ANA, JAN, 'Lea Go'], WEEK, [...assignments, ...queueOf('Lea Go', 2, 2)], [], '2026-11-07');
    expect(saturday.map((r) => `${r.name}:${r.pace}:${r.missed}`)).toEqual([
      `${JAN}:missed:9`,
      `${ANA}:missed:6`,
      `${MIA}:missed:1`,
      'Lea Go:done:0',
    ]);
  });

  it('lists each name once, any case, and skips a blank one', () => {
    expect(teamWeek([JAN, ' jan dela cruz ', '  '], WEEK, [], [], '2026-11-04').map((r) => r.name)).toEqual([JAN]);
  });
});

// ------------------------------------------------------------------ who posted it

describe('whoPosted', () => {
  const posts = [
    post(JAN, '2026-10-20', 1, 'Posted', { title: 'Casa Amara', propertyId: 'F-casa', postLink: 'https://www.facebook.com/groups/apg/posts/111/', time: '10:00' }),
    post(ANA, '2026-11-02', 1, 'Pending', { title: 'Casa Amara', propertyId: 'F-casa', postLink: 'https://m.facebook.com/groups/apg/posts/222', time: '09:15', fbAccount: 'APG Rentals' }),
    post(MIA, '2026-11-02', 2, 'Posted', { title: 'Verdant Hills Blk. 3, Lt 9', propertyId: '', postLink: 'https://fb.me/abc', time: '14:30' }),
    post(JAN, '2026-11-03', 3, 'Posted', { title: '1201', propertyId: 'F-1201', postLink: 'https://www.facebook.com/groups/apg/posts/333/?ref=share' }),
  ];

  it('finds a listing by name, newest first, with who, when, which account and the link', () => {
    expect(whoPosted(posts, 'casa amara')).toEqual([
      expect.objectContaining({ intern: ANA, date: '2026-11-02', time: '09:15', fbAccount: 'APG Rentals', link: 'https://m.facebook.com/groups/apg/posts/222', status: 'Pending', title: 'Casa Amara' }),
      expect.objectContaining({ intern: JAN, date: '2026-10-20', time: '10:00', fbAccount: 'APG Main', status: 'Posted' }),
    ]);
  });

  it('matches every word of a name, give or take case, punctuation and the usual abbreviations', () => {
    expect(whoPosted(posts, 'verdant lot 9').map((m) => m.intern)).toEqual([MIA]);
    expect(whoPosted(posts, 'Verdant Hills Block 3 Lot 9').map((m) => m.intern)).toEqual([MIA]);
    expect(whoPosted(posts, 'casa tower')).toEqual([]);
  });

  it('finds a listing by its folder id', () => {
    expect(whoPosted(posts, 'F-casa').map((m) => m.intern)).toEqual([ANA, JAN]);
    expect(whoPosted(posts, ' F-1201 ').map((m) => m.title)).toEqual(['1201']);
  });

  it('finds a post by its link, whatever the scheme, www. or m., and the trailing slash', () => {
    expect(whoPosted(posts, 'https://www.facebook.com/groups/apg/posts/222/').map((m) => m.intern)).toEqual([ANA]);
    expect(whoPosted(posts, 'facebook.com/groups/apg/posts/111').map((m) => m.intern)).toEqual([JAN]);
    expect(whoPosted(posts, 'http://fb.me/abc').map((m) => m.intern)).toEqual([MIA]);
    expect(whoPosted(posts, 'https://facebook.com/groups/apg/posts/333').map((m) => m.title)).toEqual(['1201']);
    // A link's start finds every post under it.
    expect(whoPosted(posts, 'https://www.facebook.com/groups/apg/').map((m) => m.intern)).toEqual([JAN, ANA, JAN]);
    expect(whoPosted(posts, 'https://www.facebook.com/groups/other/posts/111/')).toEqual([]);
  });

  it('gives nothing for a blank query', () => {
    expect(whoPosted(posts, '   ')).toEqual([]);
    expect(whoPosted([], 'casa')).toEqual([]);
  });
});
