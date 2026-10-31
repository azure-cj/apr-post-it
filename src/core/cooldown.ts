/**
 * The repost rules: a property posted less than `cooldownDays` ago may not be
 * posted again, and one not posted for `repostDueDays` or more is due for a repost.
 *
 * Dates are "yyyy-MM-dd", as on the Posts tab. Nothing here reads the clock: the
 * caller says what day it is, so the same answer comes out in a test, in the app
 * and on a server.
 *
 * Ported from PostIt.Core/Rules/CooldownPolicy.cs.
 */

import { normalize } from './matcher';
import type { CooldownState, PostLogEntry, Property, Settings } from './types';

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The cooldown for a property last posted on `lastPosted` (undefined: never), as of `today`. */
export function cooldown(
  lastPosted: string | undefined,
  today: string,
  settings: Pick<Settings, 'cooldownDays'>,
): CooldownState {
  const asOf = dayNumber(today);
  if (lastPosted === undefined) return { blocked: false, message: '' };

  const last = dayNumber(lastPosted);
  // A post dated after today, from a skewed clock or time zone, counts as posted today.
  const daysAgo = Math.max(0, asOf - last);
  const nextAllowed = last + settings.cooldownDays;
  const blocked = daysAgo < settings.cooldownDays;
  return {
    blocked,
    lastPosted,
    nextAllowed: isoDate(nextAllowed),
    daysAgo,
    message: blocked
      ? `Posted ${ago(daysAgo)} (${dayMonth(last)}). The cooldown is ${days(settings.cooldownDays)}` +
        ` — it can be posted again on ${fullDate(nextAllowed)}.`
      : '',
  };
}

/** Days until the property may be posted again: 0 once allowed, or when never posted. */
export function daysLeft(state: CooldownState, today: string): number {
  const asOf = dayNumber(today);
  return state.nextAllowed === undefined ? 0 : Math.max(0, dayNumber(state.nextAllowed) - asOf);
}

/** Not posted for `repostDueDays` or more. A property never posted is due. */
export function isDueForRepost(
  lastPosted: string | undefined,
  today: string,
  settings: Pick<Settings, 'repostDueDays'>,
): boolean {
  const asOf = dayNumber(today);
  return lastPosted === undefined || Math.max(0, asOf - dayNumber(lastPosted)) >= settings.repostDueDays;
}

/**
 * The latest date among the property's Posted and Pending rows: a post still
 * waiting for the group admin's approval starts the cooldown too, or a second intern could post the
 * same listing in the meantime.
 *
 * A row is the property's when the folder ids agree, if both have one, so a renamed
 * folder keeps its history. Otherwise the names must agree, ignoring case, spacing
 * and punctuation. A row whose date is not yyyy-MM-dd is skipped.
 */
export function lastPostedOn(
  posts: readonly PostLogEntry[],
  property: Pick<Property, 'id' | 'name'>,
): string | undefined {
  const key = normalize(property.name);
  let latest: string | undefined;
  for (const post of posts) {
    if (post.status !== 'Posted' && post.status !== 'Pending') continue;
    if (parseDay(post.date) === undefined) continue;

    const same =
      property.id !== '' && post.propertyId !== ''
        ? post.propertyId === property.id
        : normalize(post.title) === key;
    if (same && (latest === undefined || post.date > latest)) latest = post.date;
  }
  return latest;
}

function parseDay(date: string): number | undefined {
  const parts = ISO_DATE.exec(date);
  if (!parts) return undefined;
  const day = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) / DAY_MS;
  // Date.UTC rolls 2026-02-30 over into March, and reads years below 100 as 19xx.
  return isoDate(day) === date ? day : undefined;
}

function dayNumber(date: string): number {
  const day = parseDay(date);
  if (day === undefined) throw new Error(`Expected a yyyy-MM-dd date, got "${date}".`);
  return day;
}

// Whole days in UTC: local midnights are 23 or 25 hours apart across a DST change.
function isoDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

// English whatever the PC's regional settings, as the C# did with InvariantCulture.
function dayMonth(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function fullDate(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

function ago(n: number): string {
  return n === 0 ? 'today' : `${days(n)} ago`;
}
