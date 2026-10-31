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
