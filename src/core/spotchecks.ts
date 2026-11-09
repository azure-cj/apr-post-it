/**
 * Spot checks (DECISIONS D23): nothing confirms a logged post is on Facebook,
 * about the right listing, or still up, and Facebook can't be read by a
 * script. So each week an admin opens a few of each agent's posts and says
 * what they found. Which posts is decided here, the same on every admin's PC:
 * a fixed shuffle of the agent's posts that week, so nobody can tell in advance
 * which will be checked, and the sample doesn't change between admins.
 */

import { isDate } from './dates';
import { postKeyOf } from './links';
import type { PostLogEntry } from './types';
import { weekOf } from './week';

export type SpotResult = 'Verified' | 'Not found' | 'Wrong listing';
export const SPOT_RESULTS: readonly SpotResult[] = ['Verified', 'Not found', 'Wrong listing'];

/** How many of each agent's posts are checked a week. */
export const SPOT_SAMPLE = 3;

/** One post an admin checked: a row of the Spot checks tab. */
export interface SpotCheck {
  /** The post, as postKeyOf gives it: "groups/apg/posts/123". */
  readonly postKey: string;
  readonly link: string;
  readonly agent: string;
  /** The day it was posted, yyyy-MM-dd. */
  readonly posted: string;
  readonly property: string;
  readonly propertyId: string;
  readonly result: SpotResult;
  readonly checkedBy: string;
  /** When, ISO with the offset. */
  readonly checkedAt: string;
}

export function isSpotResult(value: unknown): value is SpotResult {
  return typeof value === 'string' && (SPOT_RESULTS as readonly string[]).includes(value);
}

/** A failed check: the post wasn't there, or wasn't the listing logged. */
export function isFailed(result: SpotResult): boolean {
  return result !== 'Verified';
}

/** A post picked for checking, with its check when it has one. */
export interface SpotItem {
  readonly post: PostLogEntry;
  readonly key: string;
  readonly check: SpotCheck | undefined;
}

/**
 * The agent's posts to check in `week` (its Monday): their Posted posts with a
 * post's link, dated in that week, one per post. Posts already checked stay
 * in it; the rest are filled from a shuffle fixed by the week, the agent and
 * the post, so every admin sees the same sample. Oldest first.
 */
export function spotSample(
  posts: readonly PostLogEntry[],
  agent: string,
  week: string,
  checks: readonly SpotCheck[],
  size: number = SPOT_SAMPLE,
): SpotItem[] {
  const who = personKey(agent);
  const byKey = checksByKey(checks);
  const seen = new Set<string>();
  const candidates: { post: PostLogEntry; key: string; check: SpotCheck | undefined; rank: number }[] = [];
  for (const post of posts) {
    if (post.status !== 'Posted' || personKey(post.postedBy) !== who || !isDate(post.date)) continue;
    if (weekOf(post.date) !== week) continue;
    const key = postKeyOf(post.postLink);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ post, key, check: byKey.get(key), rank: hash(`${week}|${who}|${key}`) });
  }
  const picked = [
    ...candidates.filter((c) => c.check),
    ...candidates.filter((c) => !c.check).sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key)),
  ].slice(0, Math.max(size, candidates.filter((c) => c.check).length));
  return picked
    .sort((a, b) => a.post.date.localeCompare(b.post.date) || a.post.time.localeCompare(b.post.time))
    .map(({ post, key, check }) => ({ post, key, check }));
}

export interface SpotTally {
  /** Posts in the sample. */
  readonly total: number;
  readonly checked: number;
  readonly verified: number;
  readonly failed: number;
}

export function spotTally(items: readonly SpotItem[]): SpotTally {
  let checked = 0;
  let failed = 0;
  for (const item of items) {
    if (!item.check) continue;
    checked += 1;
    if (isFailed(item.check.result)) failed += 1;
  }
  return { total: items.length, checked, verified: checked - failed, failed };
}

/** "2 of 3 checked", "1 failed", "Nothing to check". */
export function spotWords(tally: SpotTally): string {
  if (tally.total === 0) return 'Nothing to check';
  if (tally.failed > 0) return `${tally.failed} failed`;
  if (tally.checked === tally.total) return `${tally.verified} verified`;
  return `${tally.checked} of ${tally.total} checked`;
}

/** The newest check of each post. */
function checksByKey(checks: readonly SpotCheck[]): Map<string, SpotCheck> {
  const out = new Map<string, SpotCheck>();
  for (const check of checks) {
    const key = check.postKey.trim().toLowerCase() || postKeyOf(check.link);
    if (!key) continue;
    const had = out.get(key);
    if (!had || had.checkedAt <= check.checkedAt) out.set(key, check);
  }
  return out;
}

function personKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** FNV-1a, 32 bits: a fixed, well-spread order. Not a secret, just not guessable at a glance. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
