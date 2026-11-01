/**
 * The Records and Find screens' arithmetic over the Posts tab (CONTRACT-v3).
 * Pure: the caller passes the rows it read. Dates are yyyy-MM-dd, as on the
 * Posts tab; a row whose date is not one is left out of anything bounded by date.
 */

import { normalizeForSearch } from './directory';
import { normalize } from './matcher';
import type { PostLogEntry, PostStatus } from './types';

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
}

/** The posts that match every part of `search`, newest first. */
export function searchPosts(posts: readonly PostLogEntry[], search: PostSearch): PostLogEntry[] {
  const words = normalizeForSearch(search.query ?? '').split(' ').filter(Boolean);
  const from = (search.from ?? '').trim();
  const to = (search.to ?? '').trim();
  const intern = (search.intern ?? '').trim().toLowerCase();
  const status = search.status;

  const found = posts.filter((post) => {
    if (status && post.status !== status) return false;
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
