import { describe, expect, it } from 'vitest';
import { cooldown, daysLeft, isDueForRepost, lastPostedOn } from './cooldown';
import type { PostLogEntry, PostStatus } from './types';

// TestApp.Today in the C# tests: Thu 29 Oct 2026.
const TODAY = '2026-10-29';
const RULES = { cooldownDays: 7, repostDueDays: 14 };

describe('cooldown — ported from CooldownPolicyTests', () => {
  it('lets a property never posted through, and calls it due for a repost', () => {
    const state = cooldown(undefined, TODAY, RULES);

    expect(state).toStrictEqual({ blocked: false, message: '' });
    expect(state.lastPosted).toBeUndefined();
    expect(isDueForRepost(undefined, TODAY, RULES)).toBe(true);
    expect(daysLeft(state, TODAY)).toBe(0);
  });

  it('blocks on day 6 but not on day 7', () => {
    const day6 = cooldown('2026-10-23', TODAY, RULES);
    expect(day6.blocked).toBe(true);
    expect(daysLeft(day6, TODAY)).toBe(1);
    expect(day6.daysAgo).toBe(6);
    expect(day6.nextAllowed).toBe('2026-10-30');

    const day7 = cooldown('2026-10-22', TODAY, RULES);
    expect(day7.blocked).toBe(false);
    expect(daysLeft(day7, TODAY)).toBe(0);
    expect(day7.nextAllowed).toBe(TODAY);
    expect(day7.lastPosted).toBe('2026-10-22');
  });

  it('is due for a repost from day 14', () => {
    expect(isDueForRepost('2026-10-16', TODAY, RULES)).toBe(false);
    expect(isDueForRepost('2026-10-15', TODAY, RULES)).toBe(true);
  });

  it('counts a post from today, or dated in the future, as 0 days ago', () => {
    const today = cooldown(TODAY, TODAY, RULES);
    expect(today.daysAgo).toBe(0);
    expect(daysLeft(today, TODAY)).toBe(7);

    const future = cooldown('2026-10-31', TODAY, RULES);
    expect(future.daysAgo).toBe(0);
    expect(future.blocked).toBe(true);
    expect(daysLeft(future, TODAY)).toBe(9);
  });

  it('follows the settings', () => {
    const strict = { cooldownDays: 10, repostDueDays: 30 };

    expect(cooldown('2026-10-21', TODAY, strict).blocked).toBe(true);
    expect(isDueForRepost('2026-10-09', TODAY, strict)).toBe(false);
  });
});

describe('cooldown — beyond the C# tests', () => {
  it('says how long ago, and when it can be posted again, in English', () => {
    expect(cooldown('2026-10-27', TODAY, RULES).message).toBe(
      'Posted 2 days ago (27 Oct). The cooldown is 7 days — it can be posted again on Tue 3 Nov 2026.',
    );
    expect(cooldown(TODAY, TODAY, { cooldownDays: 1 }).message).toBe(
      'Posted today (29 Oct). The cooldown is 1 day — it can be posted again on Fri 30 Oct 2026.',
    );
    expect(cooldown('2026-10-28', TODAY, { cooldownDays: 2 }).message).toBe(
      'Posted 1 day ago (28 Oct). The cooldown is 2 days — it can be posted again on Fri 30 Oct 2026.',
    );
  });

  it('has no message once the cooldown is over, but still says when it was last posted', () => {
    expect(cooldown('2026-10-01', TODAY, RULES)).toStrictEqual({
      blocked: false,
      lastPosted: '2026-10-01',
      nextAllowed: '2026-10-08',
      daysAgo: 28,
      message: '',
    });
  });

  it('counts calendar days across a month end, a year end and a leap day', () => {
    expect(cooldown('2026-12-28', '2027-01-03', RULES)).toMatchObject({ blocked: true, daysAgo: 6, nextAllowed: '2027-01-04' });
    expect(cooldown('2028-02-26', '2028-03-04', RULES)).toMatchObject({ blocked: false, daysAgo: 7, nextAllowed: '2028-03-04' });
    expect(cooldown('2027-02-26', '2027-03-04', RULES)).toMatchObject({ blocked: true, daysAgo: 6, nextAllowed: '2027-03-05' });
  });

  it('counts whole days across a daylight-saving change', () => {
    // Europe's clocks went back on 25 Oct 2026, America's go forward on 8 Mar 2026.
    expect(cooldown('2026-10-22', TODAY, RULES)).toMatchObject({ blocked: false, daysAgo: 7 });
    expect(cooldown('2026-03-05', '2026-03-11', RULES)).toMatchObject({ blocked: true, daysAgo: 6 });
  });

  it('never blocks with a cooldown of 0 days', () => {
    expect(cooldown(TODAY, TODAY, { cooldownDays: 0 }).blocked).toBe(false);
  });

  it('refuses a date that is not yyyy-MM-dd, rather than guessing', () => {
    expect(() => cooldown('29/10/2026', TODAY, RULES)).toThrow('yyyy-MM-dd');
    expect(() => cooldown('2026-02-30', TODAY, RULES)).toThrow('yyyy-MM-dd');
    expect(() => cooldown('2026-10-22', '2026-10-29T09:41', RULES)).toThrow('yyyy-MM-dd');
    expect(() => isDueForRepost('0026-10-22', TODAY, RULES)).toThrow('yyyy-MM-dd');
  });

  it('refuses a malformed today even for a property never posted', () => {
    expect(() => cooldown(undefined, '29 Oct 2026', RULES)).toThrow('yyyy-MM-dd');
    expect(() => isDueForRepost(undefined, '', RULES)).toThrow('yyyy-MM-dd');
    expect(() => daysLeft({ blocked: false, message: '' }, '2026-10-32')).toThrow('yyyy-MM-dd');
  });
});

function row(title: string, date: string, status: PostStatus = 'Posted', propertyId = ''): PostLogEntry {
  return { date, time: '09:00', type: 'Lot', title, status, fbAccount: 'APG', postLink: '', postedBy: 'Jan', propertyId };
}

describe('lastPostedOn — ported from CooldownPolicyTests', () => {
  it('is the latest Posted or Pending row for the property, its name matched loosely', () => {
    const posts = [
      row('Verdant Hills Lot 7', '2026-10-09', 'Posted'),
      row('verdant hills  lot 7', '2026-10-27', 'Pending'),
      row('Verdant Hills Lot 7', '2026-10-20', 'Posted'),
      row('Verdant Hills Lot 12', '2026-10-28', 'Posted'),
    ];

    expect(lastPostedOn(posts, { id: '', name: 'Verdant Hills Lot 7' })).toBe('2026-10-27');
    expect(lastPostedOn(posts, { id: '', name: 'VERDANT HILLS LOT 12' })).toBe('2026-10-28');
    expect(lastPostedOn(posts, { id: '', name: 'Verdant Hills Lot 3' })).toBeUndefined();
  });
});

describe('lastPostedOn — beyond the C# tests', () => {
  it('follows the folder id when both sides have one, so a renamed folder keeps its history', () => {
    const posts = [row('Verdant Hills Lot 7', '2026-10-27', 'Posted', 'folder-7')];

    expect(lastPostedOn(posts, { id: 'folder-7', name: 'Verdant Heights Lot 7' })).toBe('2026-10-27');
  });

  it('does not take another folder that shares the name', () => {
    const posts = [row('Verdant Hills Lot 7', '2026-10-27', 'Posted', 'folder-other')];

    expect(lastPostedOn(posts, { id: 'folder-7', name: 'Verdant Hills Lot 7' })).toBeUndefined();
  });

  it('falls back to the name for a row from before the id column', () => {
    const posts = [row('Verdant Hills Lot 7', '2026-10-27', 'Posted', '')];

    expect(lastPostedOn(posts, { id: 'folder-7', name: 'Verdant Hills Lot 7' })).toBe('2026-10-27');
  });

  it('skips a row whose status or date the sheet should not hold', () => {
    const posts = [
      row('Verdant Hills Lot 7', '2026-10-28', 'Removed' as PostStatus),
      row('Verdant Hills Lot 7', '10/28/2026'),
      row('Verdant Hills Lot 7', '2026-10-20'),
    ];

    expect(lastPostedOn(posts, { id: '', name: 'Verdant Hills Lot 7' })).toBe('2026-10-20');
  });

  it('feeds the cooldown', () => {
    const posts = [row('Verdant Hills Lot 7', '2026-10-27', 'Pending')];
    const state = cooldown(lastPostedOn(posts, { id: '', name: 'Verdant Hills Lot 7' }), TODAY, RULES);

    expect(state.blocked).toBe(true);
    expect(daysLeft(state, TODAY)).toBe(5);
  });
});
