/**
 * The Records and Find screens' arithmetic over the Posts tab (CONTRACT-v3).
 * Pure: the caller passes the rows it read. Dates are yyyy-MM-dd, as on the
 * Posts tab; a row whose date is not one is left out of anything bounded by date.
 */

import { addDays as plusDays, dayOf as dayNumber, MONTHS, weekdayOfDay, WEEKDAYS } from './dates';
import { normalizeForSearch } from './directory';
import { normalize } from './matcher';
import { samePerson, weekProgress } from './summary';
import type { Assignment, PostLogEntry, PostStatus } from './types';
import { assignmentWeek, isWeekOver, weekFriday, weekLabel } from './week';

export interface DailyTotal {
  readonly date: string;
  readonly posted: number;
  readonly pending: number;
  /** Posts of either status, by Posted By, trimmed. A row with no name counts under "". */
  readonly byIntern: Readonly<Record<string, number>>;
}

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayOf(date: string): number | undefined {
  const m = ISO_DATE.exec(date);
  if (!m) return undefined;
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
  return new Date(day * DAY_MS).toISOString().slice(0, 10) === date ? day : undefined;
}

function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * One line per day from `from` to `to`, both included, oldest first: days
 * with no posts included, at zero. Empty when either date is not yyyy-MM-dd
 * or `from` is after `to`.
 */
export function dailyTotals(posts: readonly PostLogEntry[], from: string, to: string): DailyTotal[] {
  const first = dayOf(from);
  const last = dayOf(to);
  if (first === undefined || last === undefined || first > last) return [];

  const days: { date: string; posted: number; pending: number; byIntern: Record<string, number> }[] = [];
  const index = new Map<string, number>();
  for (let day = first; day <= last; day++) {
    const date = isoOf(day);
    index.set(date, days.length);
    // No prototype: a name such as "constructor" or "__proto__" is just a name.
    days.push({ date, posted: 0, pending: 0, byIntern: Object.create(null) as Record<string, number> });
  }
  for (const post of posts) {
    const i = index.get(post.date);
    if (i === undefined) continue;
    const total = days[i]!;
    if (post.status === 'Pending') total.pending++;
    else total.posted++;
    const name = post.postedBy.trim();
    total.byIntern[name] = (total.byIntern[name] ?? 0) + 1;
  }
  return days;
}

/** Newest first: by date, then time; on a tie, the later row in the sheet first. */
function newestFirst(posts: readonly PostLogEntry[]): PostLogEntry[] {
  return posts
    .map((post, i) => ({ post, i }))
    .sort((a, b) => {
      if (a.post.date !== b.post.date) return a.post.date < b.post.date ? 1 : -1;
      if (a.post.time !== b.post.time) return a.post.time < b.post.time ? 1 : -1;
      return b.i - a.i;
    })
    .map(({ post }) => post);
}

/**
 * Every post of one listing, newest first. A post is the listing's when the
 * folder ids agree, if both have one, so a renamed folder keeps its history;
 * otherwise the names must agree, ignoring case, spacing, punctuation and the
 * usual abbreviations (matcher.ts). The rule of cooldown.lastPostedOn.
 */
export function postsForProperty(
  posts: readonly PostLogEntry[],
  property: { readonly id?: string | undefined; readonly name?: string | undefined },
): PostLogEntry[] {
  const id = (property.id ?? '').trim();
  const key = normalize(property.name ?? '');
  if (!id && !key) return [];
  const mine = posts.filter((post) => {
    const postId = post.propertyId.trim();
    if (id && postId) return postId === id;
    return key !== '' && normalize(post.title) === key;
  });
  return newestFirst(mine);
}

export interface PostSearch {
  /** Every word must appear in the title, FB account, Posted By, type or link. Blank: any. */
  readonly query?: string | undefined;
  /** yyyy-MM-dd, included. Blank: no bound. */
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  /** Posted By, ignoring case and spacing at the ends. Blank: anyone. */
  readonly intern?: string | undefined;
  readonly status?: PostStatus | undefined;
  /** Property type, ignoring case and spacing at the ends; "Unsorted" also finds a blank one. Blank: any. */
  readonly type?: string | undefined;
  /** FB account name, ignoring case and spacing at the ends. Blank: any. */
  readonly fbAccount?: string | undefined;
}

/** The posts that match every part of `search`, newest first. */
export function searchPosts(posts: readonly PostLogEntry[], search: PostSearch): PostLogEntry[] {
  const words = normalizeForSearch(search.query ?? '').split(' ').filter(Boolean);
  const from = (search.from ?? '').trim();
  const to = (search.to ?? '').trim();
  const intern = (search.intern ?? '').trim().toLowerCase();
  const status = search.status;
  const type = (search.type ?? '').trim().toLowerCase();
  const account = (search.fbAccount ?? '').trim().toLowerCase();

  const found = posts.filter((post) => {
    if (status && post.status !== status) return false;
    if (type && typeKey(post.type) !== type) return false;
    if (account && post.fbAccount.trim().toLowerCase() !== account) return false;
    if (intern && post.postedBy.trim().toLowerCase() !== intern) return false;
    if (from || to) {
      if (dayOf(post.date) === undefined) return false;
      if (from && post.date < from) return false;
      if (to && post.date > to) return false;
    }
    if (words.length > 0) {
      const hay = normalizeForSearch(
        `${post.title} ${post.fbAccount} ${post.postedBy} ${post.type} ${post.postLink}`,
      );
      if (!words.every((word) => hay.includes(word))) return false;
    }
    return true;
  });
  return newestFirst(found);
}

// ------------------------------------------------------------------ the interns' own sheet
//
// The Posts tab records what the interns' "POSTING TRACKER - INTERNS" sheet
// does, with its column names, words and formats, so it feels familiar.

/** The Records columns and the CSV's, in the interns' sheet's order, then Posted by. */
export const POST_COLUMNS = [
  'Date',
  'Property type',
  'Property title',
  'FB account name',
  'Link',
  'Time posted',
  'Share posting',
  'Posted by',
] as const;

// Lower case inside a title, as the owner writes "Condo / House and Lot".
const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/**
 * A listing's category as the Posts tab's Property type: "COMMERCIAL SPACE"
 * → "Commercial Space", "CONDO / HOUSE AND LOT" → "Condo / House and Lot".
 * Only text written all in one case is recased; mixed case was written with
 * care and stays. Code.gs's propertyType_, character for character.
 */
export function propertyType(category: string): string {
  const text = category.trim().replace(/\s+/g, ' ');
  if (text !== text.toUpperCase() && text !== text.toLowerCase()) return text;
  let index = 0;
  return text.toLowerCase().replace(/[\p{L}\p{N}']+/gu, (word) => {
    const first = index++ === 0;
    if (!first && SMALL_WORDS.has(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}

/** "14:30" → "2:30 PM", "00:15" → "12:15 AM", as the interns' sheet writes a time. Anything else as it was. */
export function clockTime(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = +m[1]!;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2026-10-26" → "10/26/26", as the interns' sheet writes a date. Anything else as it was. */
export function sheetDate(iso: string): string {
  const m = ISO_DATE.exec(iso);
  return m ? `${+m[2]!}/${+m[3]!}/${m[1]!.slice(2)}` : iso;
}

/**
 * The posts as CSV, one row each, in the order given: the interns' sheet's
 * columns (POST_COLUMNS), its date (M/D/YY) and time (h:mm AM/PM). Quoted
 * where needed (RFC 4180), CRLF line ends.
 */
export function postsCsv(posts: readonly PostLogEntry[]): string {
  const cell = (value: string) => {
    // A leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = posts.map((p) =>
    [sheetDate(p.date), p.type, p.title, p.fbAccount, p.postLink, clockTime(p.time), p.status, p.postedBy]
      .map(cell)
      .join(','),
  );
  return [POST_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ who posted it (v6)

/** One answer to "who posted this?": a post of the listing, and who made it. */
export interface WhoPostedMatch {
  /** Posted by, as the sheet has it. */
  readonly intern: string;
  /** yyyy-MM-dd. */
  readonly date: string;
  /** HH:mm. */
  readonly time: string;
  readonly fbAccount: string;
  readonly link: string;
  readonly status: PostStatus;
  /** The listing, as the post names it, and its folder id ('' when none). */
  readonly title: string;
  readonly propertyId: string;
  /** The row itself. */
  readonly post: PostLogEntry;
}

// "https://www.facebook.com/groups/apg/posts/1/" and "facebook.com/groups/apg/posts/1" are one link.
function linkKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^(?:www|m|web|mbasic)\./, '')
    .replace(/#.*$/, '')
    .replace(/\/+(?=\?|$)/, '');
}

function looksLikeLink(text: string): boolean {
  return /^[a-z]+:\/\//i.test(text) || /^(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.com|fb\.me)\b/i.test(text);
}

/**
 * The quick lookup for an inquiry: every Posted or Pending post that matches
 * `query`, newest first.
 * - A link (http… or facebook.com/…) matches the post with that link, give or
 *   take the scheme, www./m./web., a #fragment and a trailing slash; a link's
 *   start matches every post under it.
 * - Otherwise the query matches a post whose folder id is exactly it, or whose
 *   listing name holds every word of it (case, punctuation and the usual
 *   abbreviations aside, as Find searches).
 * Blank: nothing.
 */
export function whoPosted(posts: readonly PostLogEntry[], query: string): WhoPostedMatch[] {
  const text = query.trim();
  if (!text) return [];
  let matches: (post: PostLogEntry) => boolean;
  if (looksLikeLink(text)) {
    const key = linkKey(text);
    matches = (post) => {
      const link = linkKey(post.postLink);
      return link !== '' && (link === key || link.startsWith(key));
    };
  } else {
    const words = normalizeForSearch(text).split(' ').filter(Boolean);
    const exact = normalize(text);
    matches = (post) => {
      if (post.propertyId.trim() === text) return true;
      if (exact !== '' && normalize(post.title) === exact) return true;
      if (words.length === 0) return false;
      const hay = normalizeForSearch(post.title);
      return words.every((word) => hay.includes(word));
    };
  }
  return newestFirst(posts.filter((p) => (p.status === 'Posted' || p.status === 'Pending') && matches(p))).map((post) => ({
    intern: post.postedBy,
    date: post.date,
    time: post.time,
    fbAccount: post.fbAccount,
    link: post.postLink,
    status: post.status,
    title: post.title,
    propertyId: post.propertyId,
    post,
  }));
}

// ------------------------------------------------------------------ periods (Records, v10)
//
// The Records screen reports on a period: a work week (Monday to Sunday, so
// a weekend post is never lost; the chart shows Monday to Friday and a
// weekend day only when something was posted on it), a calendar month, the
// last 30 days, or two dates. Pure: the caller says what day it is.

/** How a period was chosen, so ‹ › step it the same way. */
export type PeriodKind = 'week' | 'month' | 'days' | 'custom';

/** The header's quick choices. */
export type PeriodPreset = 'this-week' | 'last-week' | 'this-month' | 'last-30' | 'custom';

export const PERIOD_PRESETS: readonly { readonly key: PeriodPreset; readonly label: string }[] = [
  { key: 'this-week', label: 'This week' },
  { key: 'last-week', label: 'Last week' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-30', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom' },
];

/** A period: yyyy-MM-dd, both days included. */
export interface Period {
  readonly kind: PeriodKind;
  readonly from: string;
  readonly to: string;
}

/** A span of days, both included. */
export interface Span {
  readonly from: string;
  readonly to: string;
}

/** "Last 30 days" is this many. */
export const LAST_DAYS = 30;
/** The longest custom period: two years. */
export const MAX_PERIOD_DAYS = 731;

function mustDate(date: string): number {
  const day = dayNumber(date);
  if (day === undefined) throw new Error(`Expected a yyyy-MM-dd date, got "${date}".`);
  return day;
}

function spanDays(from: string, to: string): number {
  return mustDate(to) - mustDate(from) + 1;
}

/** The Monday on or before `date`: its calendar week, Monday to Sunday. */
export function mondayOf(date: string): string {
  const day = mustDate(date);
  return isoOf(day - ((weekdayOfDay(day) + 6) % 7));
}

function monthStart(date: string): string {
  mustDate(date);
  return `${date.slice(0, 7)}-01`;
}

function addMonths(first: string, n: number): string {
  const y = Number(first.slice(0, 4));
  const m = Number(first.slice(5, 7)) - 1 + n;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`;
}

function monthEnd(first: string): string {
  return plusDays(addMonths(first, 1), -1);
}

function weekPeriod(monday: string): Period {
  return { kind: 'week', from: monday, to: plusDays(monday, 6) };
}

function monthPeriod(first: string): Period {
  return { kind: 'month', from: first, to: monthEnd(first) };
}

function daysPeriod(to: string): Period {
  return { kind: 'days', from: plusDays(to, -(LAST_DAYS - 1)), to };
}

/**
 * A preset as a period on `today`. This week is the calendar week under way
 * (on a weekend, the work week that just ended, as the Interns monitor opens
 * on). Custom starts as the last 30 days, for the caller to change.
 */
export function presetPeriod(preset: PeriodPreset, today: string): Period {
  switch (preset) {
    case 'this-week':
      return weekPeriod(mondayOf(today));
    case 'last-week':
      return weekPeriod(plusDays(mondayOf(today), -7));
    case 'this-month':
      return monthPeriod(monthStart(today));
    case 'last-30':
      return daysPeriod(today);
    case 'custom':
      return { ...daysPeriod(today), kind: 'custom' };
  }
}

/** Which preset `period` is on `today`, or null when it was stepped off one. */
export function presetOf(period: Period, today: string): PeriodPreset | null {
  for (const preset of ['this-week', 'last-week', 'this-month', 'last-30'] as const) {
    const p = presetPeriod(preset, today);
    if (p.kind === period.kind && p.from === period.from && p.to === period.to) return preset;
  }
  return period.kind === 'custom' ? 'custom' : null;
}

/** `period` moved `n` of itself later (earlier when negative): a week, a month, 30 days, or its own length. */
export function stepPeriod(period: Period, n: number): Period {
  const k = Math.trunc(n);
  switch (period.kind) {
    case 'week':
      return weekPeriod(plusDays(period.from, 7 * k));
    case 'month':
      return monthPeriod(addMonths(period.from, k));
    case 'days':
      return daysPeriod(plusDays(period.to, LAST_DAYS * k));
    case 'custom': {
      const length = spanDays(period.from, period.to);
      return { kind: 'custom', from: plusDays(period.from, length * k), to: plusDays(period.to, length * k) };
    }
  }
}

/** Whether ‹ › may go to the next period: not when it starts after today. */
export function canStepForward(period: Period, today: string): boolean {
  return stepPeriod(period, 1).from <= today;
}

/** A custom period from two dates, in either order, at most MAX_PERIOD_DAYS long (cut from the start). */
export function customPeriod(a: string, b: string): Period {
  let from = a <= b ? a : b;
  const to = a <= b ? b : a;
  if (spanDays(from, to) > MAX_PERIOD_DAYS) from = plusDays(to, -(MAX_PERIOD_DAYS - 1));
  return { kind: 'custom', from, to };
}

/**
 * The period a link names: `?period=week&from=` (any day of the week),
 * `?period=month&from=` (any day of the month), `?period=30d&to=`,
 * `?period=custom&from=&to=`. Anything else, or nothing, is this week.
 */
export function periodFromQuery(
  query: { readonly period?: string | null | undefined; readonly from?: string | null | undefined; readonly to?: string | null | undefined },
  today: string,
): Period {
  const from = (query.from ?? '').trim();
  const to = (query.to ?? '').trim();
  const ok = (d: string) => dayNumber(d) !== undefined;
  switch ((query.period ?? '').trim()) {
    case 'week':
      if (ok(from)) return weekPeriod(mondayOf(from));
      break;
    case 'month':
      if (ok(from)) return monthPeriod(monthStart(from));
      break;
    case '30d':
      if (ok(to)) return daysPeriod(to);
      break;
    case 'custom':
      if (ok(from) && ok(to)) return customPeriod(from, to);
      break;
  }
  return presetPeriod('this-week', today);
}

/** The link's query for `period`: nothing for this week, the default. */
export function periodQuery(period: Period, today: string): Record<string, string> {
  if (presetOf(period, today) === 'this-week') return {};
  switch (period.kind) {
    case 'week':
    case 'month':
      return { period: period.kind, from: period.from };
    case 'days':
      return { period: '30d', to: period.to };
    case 'custom':
      return { period: 'custom', from: period.from, to: period.to };
  }
}

function dm(date: string): { readonly d: number; readonly m: string; readonly y: number } {
  const day = new Date(mustDate(date) * DAY_MS);
  return { d: day.getUTCDate(), m: MONTHS[day.getUTCMonth()] ?? '', y: day.getUTCFullYear() };
}

/** "3–9 Oct", "28 Sep – 27 Oct", "29 Dec 2025 – 4 Jan 2026", "Tue 3 Nov" for one day. */
export function spanLabel(from: string, to: string): string {
  if (from === to) {
    const a = dm(from);
    return `${WEEKDAYS[weekdayOfDay(mustDate(from))]} ${a.d} ${a.m}`;
  }
  const a = dm(from);
  const b = dm(to);
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
  if (a.m === b.m) return `${a.d}–${b.d} ${b.m}`;
  return `${a.d} ${a.m} – ${b.d} ${b.m}`;
}

/** The period in words: "2–6 Nov" (a work week, as everywhere else), "Nov 2026", or its dates. */
export function periodLabel(period: Period): string {
  if (period.kind === 'week') return weekLabel(period.from);
  if (period.kind === 'month') {
    const a = dm(period.from);
    return `${a.m} ${a.y}`;
  }
  return spanLabel(period.from, period.to);
}

/** The part of `period` that has happened by `today`; null when it is all still to come. */
export function elapsedSpan(period: Period, today: string): Span | null {
  if (period.from > today) return null;
  return { from: period.from, to: period.to < today ? period.to : today };
}

/**
 * What `period` is compared with: the period before it, cut to as many days
 * as have passed of this one, so a week half done is set against the same
 * days of last week. Null when nothing of `period` has happened yet.
 */
export function comparisonSpan(period: Period, today: string): Span | null {
  const now = elapsedSpan(period, today);
  if (!now) return null;
  const before = stepPeriod(period, -1);
  if (now.to === period.to) return { from: before.from, to: before.to };
  const end = plusDays(before.from, spanDays(now.from, now.to) - 1);
  return { from: before.from, to: end < before.to ? end : before.to };
}

/** "26–30 Oct" for a whole week, "Oct" for a whole month, else the dates compared. */
export function comparisonLabel(period: Period, today: string): string {
  const span = comparisonSpan(period, today);
  if (!span) return '';
  const before = stepPeriod(period, -1);
  if (span.from === before.from && span.to === before.to) {
    if (before.kind === 'week') return weekLabel(before.from);
    if (before.kind === 'month') return dm(before.from).m;
  }
  return spanLabel(span.from, span.to);
}

/** A change between two counts, as an arrow and a number say it. */
export interface Change {
  /** now − before. */
  readonly change: number;
  readonly direction: 'up' | 'down' | 'same';
}

/** How `now` compares with `before`. */
export function compareToPrevious(now: number, before: number): Change {
  const change = now - before;
  return { change, direction: change > 0 ? 'up' : change < 0 ? 'down' : 'same' };
}

/** Whether a post's date falls in the span (a date that isn't yyyy-MM-dd never does). */
export function inSpan(post: Pick<PostLogEntry, 'date'>, span: Span): boolean {
  return dayNumber(post.date) !== undefined && post.date >= span.from && post.date <= span.to;
}

// ------------------------------------------------------------------ the period's numbers

export interface PeriodTotals {
  /** Posts of either status. */
  readonly posts: number;
  readonly posted: number;
  readonly pending: number;
  /** People with at least one post in the span. */
  readonly interns: number;
  /** The day with the most posts (the earliest on a tie); null with none. */
  readonly busiest: { readonly date: string; readonly count: number } | null;
}

/** The headline numbers for a span of days. */
export function periodTotals(posts: readonly PostLogEntry[], span: Span): PeriodTotals {
  let posted = 0;
  let pending = 0;
  const people = new Set<string>();
  const perDay = new Map<string, number>();
  for (const post of posts) {
    if (!inSpan(post, span)) continue;
    if (post.status === 'Pending') pending++;
    else posted++;
    const name = post.postedBy.trim().toLowerCase();
    if (name) people.add(name);
    perDay.set(post.date, (perDay.get(post.date) ?? 0) + 1);
  }
  let busiest: PeriodTotals['busiest'] = null;
  for (const [date, count] of perDay) {
    if (!busiest || count > busiest.count || (count === busiest.count && date < busiest.date)) busiest = { date, count };
  }
  return { posts: posted + pending, posted, pending, interns: people.size, busiest };
}

/** One intern's queue for one week, as it ended (or stands). */
export interface QueueWeek {
  readonly intern: string;
  /** Its Monday. */
  readonly week: string;
  readonly target: number;
  readonly posted: number;
  readonly pending: number;
  /** Not posted when the week ended; 0 while it is under way. */
  readonly missed: number;
  readonly over: boolean;
}

/**
 * Every weekly queue whose Friday (its deadline) falls in the span, one line
 * per intern and week, counted as the Interns monitor counts it (weekProgress).
 */
export function queueWeeks(
  assignments: readonly Assignment[],
  posts: readonly PostLogEntry[],
  span: Span,
  today: string,
): QueueWeek[] {
  const queues = new Map<string, { intern: string; week: string }>();
  for (const row of assignments) {
    const week = assignmentWeek(row);
    const intern = row.assignedTo.trim();
    if (!week || !intern) continue;
    const friday = weekFriday(week);
    if (friday < span.from || friday > span.to) continue;
    const key = `${week}|${intern.toLowerCase()}`;
    if (!queues.has(key)) queues.set(key, { intern, week });
  }
  return [...queues.values()]
    .sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : a.intern.localeCompare(b.intern)))
    .map(({ intern, week }) => {
      const p = weekProgress(intern, week, assignments, posts, today);
      return { intern, week, target: p.target, posted: p.posted, pending: p.pending, missed: p.missed, over: isWeekOver(week, today) };
    });
}

export interface MissedInPeriod {
  /** Queue items not posted by their Friday, in weeks that are over. */
  readonly total: number;
  /** Weeks over whose Friday falls in the span. 0: nothing can be missed yet. */
  readonly weeksOver: number;
  /** By intern, as the Assignments tab spells them (first spelling met). */
  readonly byIntern: ReadonlyMap<string, number>;
}

/** What was missed in the span: from the weekly queues whose Friday falls in it and is past. */
export function missedInPeriod(weeks: readonly QueueWeek[]): MissedInPeriod {
  let total = 0;
  const overWeeks = new Set<string>();
  const byIntern = new Map<string, number>();
  for (const w of weeks) {
    if (!w.over) continue;
    overWeeks.add(w.week);
    total += w.missed;
    const name = [...byIntern.keys()].find((n) => samePerson(n, w.intern)) ?? w.intern;
    byIntern.set(name, (byIntern.get(name) ?? 0) + w.missed);
  }
  return { total, weeksOver: overWeeks.size, byIntern };
}

/** One row of "By agent". */
export interface InternRow {
  readonly name: string;
  /** Their posts dated in the span, either status. */
  readonly posts: number;
  readonly posted: number;
  readonly pending: number;
  /** From their weekly queues whose Friday is in the span and past. */
  readonly missed: number;
  /** Their queues' items whose Friday is in the span, and how many of those are posted or pending. */
  readonly target: number;
  readonly done: number;
  /** done ÷ target, 0–1; null with no queue in the span. */
  readonly completion: number | null;
  /** Posts in each of `buckets`, for the sparkline. */
  readonly trend: readonly number[];
}

/**
 * The span by intern, most posts first (then by name). Everyone who posted,
 * had a queue, or is named in `names` (the active interns, so a quiet one
 * shows at 0) gets a row. A post with no name is left out.
 */
export function byIntern(
  posts: readonly PostLogEntry[],
  weeks: readonly QueueWeek[],
  span: Span,
  buckets: readonly Span[] = [],
  names: readonly string[] = [],
): InternRow[] {
  type Acc = { name: string; posted: number; pending: number; missed: number; target: number; done: number; trend: number[] };
  const rows = new Map<string, Acc>();
  const row = (name: string): Acc => {
    const key = name.trim().toLowerCase();
    let acc = rows.get(key);
    if (!acc) {
      acc = { name: name.trim(), posted: 0, pending: 0, missed: 0, target: 0, done: 0, trend: buckets.map(() => 0) };
      rows.set(key, acc);
    }
    return acc;
  };
  for (const name of names) if (name.trim()) row(name);
  for (const post of posts) {
    if (!inSpan(post, span) || !post.postedBy.trim()) continue;
    const acc = row(post.postedBy);
    if (post.status === 'Pending') acc.pending++;
    else acc.posted++;
    const i = buckets.findIndex((b) => post.date >= b.from && post.date <= b.to);
    if (i !== -1) acc.trend[i]!++;
  }
  for (const w of weeks) {
    const acc = row(w.intern);
    acc.target += w.target;
    acc.done += Math.min(w.target, w.posted + w.pending);
    acc.missed += w.missed;
  }
  return [...rows.values()]
    .map((a) => ({
      name: a.name,
      posts: a.posted + a.pending,
      posted: a.posted,
      pending: a.pending,
      missed: a.missed,
      target: a.target,
      done: a.done,
      completion: a.target === 0 ? null : a.done / a.target,
      trend: a.trend,
    }))
    .sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** One row of "By category" or "By FB account". */
export interface CountRow {
  /** As the rows spell it (the first spelling met); "Unsorted" or "No account" for a blank. */
  readonly label: string;
  /** What searchPosts' type or fbAccount takes to find these rows. */
  readonly key: string;
  readonly count: number;
  readonly posted: number;
  readonly pending: number;
}

function typeKey(type: string): string {
  return type.trim().toLowerCase() || 'unsorted';
}

function countBy(posts: readonly PostLogEntry[], span: Span, pick: (p: PostLogEntry) => string, blank: string): CountRow[] {
  const rows = new Map<string, { label: string; key: string; posted: number; pending: number }>();
  for (const post of posts) {
    if (!inSpan(post, span)) continue;
    const raw = pick(post).trim().replace(/\s+/g, ' ');
    const key = raw.toLowerCase() || blank.toLowerCase();
    let acc = rows.get(key);
    if (!acc) {
      acc = { label: raw || blank, key, posted: 0, pending: 0 };
      rows.set(key, acc);
    }
    if (post.status === 'Pending') acc.pending++;
    else acc.posted++;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, count: r.posted + r.pending }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

/** Posts in the span per Property type, most first. */
export function byCategory(posts: readonly PostLogEntry[], span: Span): CountRow[] {
  return countBy(posts, span, (p) => p.type, 'Unsorted');
}

/** Posts in the span per FB account name, most first. */
export function byAccount(posts: readonly PostLogEntry[], span: Span): CountRow[] {
  return countBy(posts, span, (p) => p.fbAccount, 'No account');
}

// ------------------------------------------------------------------ the chart's bars

/** One bar: a day, or a week when the period is long. */
export interface ChartBucket extends Span {
  readonly unit: 'day' | 'week';
  readonly posted: number;
  readonly pending: number;
  /** Still to come: drawn empty, not clickable. */
  readonly later: boolean;
}

/** Up to this many days the chart has a bar a day; past it, a bar a week. */
export const DAILY_BARS_MAX = 62;

/**
 * The bars for `period`. A week: Monday to Friday, and Saturday or Sunday
 * only when something was posted on it. Up to DAILY_BARS_MAX days: a bar a
 * day. Longer: a bar per calendar week (Monday to Sunday), cut to the period.
 */
export function chartBuckets(posts: readonly PostLogEntry[], period: Period, today: string): ChartBucket[] {
  const length = spanDays(period.from, period.to);
  const spans: { from: string; to: string; unit: 'day' | 'week' }[] = [];
  if (length <= DAILY_BARS_MAX) {
    for (let i = 0; i < length; i++) {
      const d = plusDays(period.from, i);
      spans.push({ from: d, to: d, unit: 'day' });
    }
  } else {
    for (let monday = mondayOf(period.from); monday <= period.to; monday = plusDays(monday, 7)) {
      const sunday = plusDays(monday, 6);
      spans.push({ from: monday < period.from ? period.from : monday, to: sunday > period.to ? period.to : sunday, unit: 'week' });
    }
  }
  const index = new Map<string, number>();
  spans.forEach((s, i) => {
    for (let d = s.from; d <= s.to; d = plusDays(d, 1)) index.set(d, i);
  });
  const counts = spans.map(() => ({ posted: 0, pending: 0 }));
  for (const post of posts) {
    const i = index.get(post.date);
    if (i === undefined) continue;
    if (post.status === 'Pending') counts[i]!.pending++;
    else counts[i]!.posted++;
  }
  return spans
    .map((s, i) => ({ ...s, ...counts[i]!, later: s.from > today }))
    .filter((b) => {
      if (period.kind !== 'week' || b.unit !== 'day') return true;
      const weekday = weekdayOfDay(mustDate(b.from));
      return (weekday !== 0 && weekday !== 6) || b.posted + b.pending > 0;
    });
}

// ------------------------------------------------------------------ sorting the list

/** The list's sortable columns. */
export type PostSortKey = 'date' | 'type' | 'title' | 'fbAccount' | 'time' | 'status' | 'postedBy';

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * The posts sorted by one column; ties keep newest first. "date" is the date
 * and time together; "time" is the time of day alone.
 */
export function sortPosts(posts: readonly PostLogEntry[], key: PostSortKey, direction: 'asc' | 'desc'): PostLogEntry[] {
  const base = newestFirst(posts);
  if (key === 'date') return direction === 'desc' ? base : [...base].reverse();
  const sign = direction === 'asc' ? 1 : -1;
  const value = (p: PostLogEntry): string => (key === 'fbAccount' ? p.fbAccount : key === 'postedBy' ? p.postedBy : p[key]).trim();
  return base
    .map((post, i) => ({ post, i }))
    .sort((a, b) => {
      const x = value(a.post);
      const y = value(b.post);
      // Blanks last, whichever way.
      if (!x !== !y) return x ? -1 : 1;
      return sign * collator.compare(x, y) || a.i - b.i;
    })
    .map(({ post }) => post);
}
