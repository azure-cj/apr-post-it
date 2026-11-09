import { describe, expect, it } from 'vitest';
import { spotSample, spotTally, spotWords, type SpotCheck } from './spotchecks';
import type { PostLogEntry } from './types';

const WEEK = '2026-11-02'; // Mon 2 – Fri 6 Nov

function post(n: number, changes: Partial<PostLogEntry> = {}): PostLogEntry {
  return {
    date: `2026-11-0${2 + (n % 5)}`,
    time: `1${n % 10}:00`,
    type: 'Lot',
    title: `Listing ${n}`,
    status: 'Posted',
    fbAccount: 'APG Main',
    postLink: `https://www.facebook.com/groups/apg/posts/${n}/`,
    postedBy: 'Jan Dela Cruz',
    propertyId: `id-${n}`,
    ...changes,
  };
}

function check(n: number, result: SpotCheck['result'] = 'Verified', changes: Partial<SpotCheck> = {}): SpotCheck {
  return {
    postKey: `groups/apg/posts/${n}`,
    link: `https://www.facebook.com/groups/apg/posts/${n}/`,
    agent: 'Jan Dela Cruz',
    posted: '2026-11-03',
    property: `Listing ${n}`,
    propertyId: `id-${n}`,
    result,
    checkedBy: 'Maria Santos',
    checkedAt: '2026-11-09T09:00:00+08:00',
    ...changes,
  };
}

const TEN = Array.from({ length: 10 }, (_, i) => post(i + 1));

describe('spotSample', () => {
  it('picks 3 of the week, the same every time, oldest first', () => {
    const first = spotSample(TEN, 'Jan Dela Cruz', WEEK, []);
    expect(first).toHaveLength(3);
    expect(spotSample([...TEN].reverse(), 'jan dela cruz ', WEEK, [])).toEqual(first);
    const dates = first.map((i) => `${i.post.date} ${i.post.time}`);
    expect(dates).toEqual([...dates].sort());
  });

  it('picks differently in another week and for another agent', () => {
    const later = TEN.map((p, i) => ({ ...p, date: `2026-11-1${i % 5}` }));
    const ana = TEN.map((p) => ({ ...p, postedBy: 'Ana Reyes' }));
    const keys = (items: { key: string }[]) => items.map((i) => i.key.split('/').pop()).sort().join(',');
    const jan = keys(spotSample(TEN, 'Jan Dela Cruz', WEEK, []));
    // Not certain for any one pair, so over a few weeks: the pick moves.
    const others = [keys(spotSample(ana, 'Ana Reyes', WEEK, [])), keys(spotSample(later, 'Jan Dela Cruz', '2026-11-09', []))];
    expect(others.some((k) => k !== jan)).toBe(true);
  });

  it('takes only Posted posts with a post link, of that agent, in that week, each post once', () => {
    const posts = [
      post(1),
      post(2, { status: 'Pending' }),
      post(3, { postLink: 'https://www.facebook.com/groups/apg' }),
      post(4, { postedBy: 'Ana Reyes' }),
      post(5, { date: '2026-11-09' }),
      post(6, { postLink: 'https://m.facebook.com/groups/apg/permalink/1' }),
    ];
    expect(spotSample(posts, 'Jan Dela Cruz', WEEK, []).map((i) => i.key)).toEqual(['groups/apg/posts/1']);
  });

  it('keeps the posts already checked, with their checks, and fills up the rest', () => {
    const notPicked = TEN.find((p) => !spotSample(TEN, 'Jan Dela Cruz', WEEK, []).some((i) => i.post === p))!;
    const n = Number(notPicked.propertyId.slice(3));
    const sample = spotSample(TEN, 'Jan Dela Cruz', WEEK, [check(n, 'Not found')]);
    expect(sample).toHaveLength(3);
    expect(sample.find((i) => i.post === notPicked)?.check?.result).toBe('Not found');
  });

  it('uses the newest check of a post', () => {
    const sample = spotSample([post(1)], 'Jan Dela Cruz', WEEK, [
      check(1, 'Not found', { checkedAt: '2026-11-09T10:00:00+08:00' }),
      check(1, 'Verified', { checkedAt: '2026-11-09T09:00:00+08:00' }),
    ]);
    expect(sample[0]?.check?.result).toBe('Not found');
  });

  it('is fewer when the agent posted fewer, and empty when none', () => {
    expect(spotSample(TEN.slice(0, 2), 'Jan Dela Cruz', WEEK, [])).toHaveLength(2);
    expect(spotSample(TEN, 'Ana Reyes', WEEK, [])).toEqual([]);
  });
});

describe('spotTally and spotWords', () => {
  it('count checked, verified and failed, a failure first in the words', () => {
    const items = spotSample(TEN.slice(0, 3), 'Jan Dela Cruz', WEEK, [check(1), check(2, 'Wrong listing')]);
    expect(spotTally(items)).toEqual({ total: 3, checked: 2, verified: 1, failed: 1 });
    expect(spotWords(spotTally(items))).toBe('1 failed');
  });

  it.each([
    [{ total: 0, checked: 0, verified: 0, failed: 0 }, 'Nothing to check'],
    [{ total: 3, checked: 0, verified: 0, failed: 0 }, '0 of 3 checked'],
    [{ total: 3, checked: 2, verified: 2, failed: 0 }, '2 of 3 checked'],
    [{ total: 3, checked: 3, verified: 3, failed: 0 }, '3 verified'],
  ])('%j reads %j', (tally, words) => {
    expect(spotWords(tally)).toBe(words);
  });
});
