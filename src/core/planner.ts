/**
 * Plans a day's queues for many interns at once (CONTRACT-v3). Pure: the
 * caller passes the rows it read and the date; the same plan comes out every
 * time, in a test, in the app and on a server.
 *
 * What is left out, each with its reason counted:
 * - sold: the checker's index says Sold;
 * - noSeparator: the directory's Issues text says the document has no
 *   separator, so Copy is blocked (D6);
 * - noDocument: the Issues text says the folder has no document, so there is
 *   nothing to post. Both are read from the Issues text in any case, as
 *   BuildDirectory.gs writes it ("No separator line — …", "No document"). A
 *   row with only `hasIssues` cannot say which issue it has, and is not
 *   skipped for it;
 * - queued: already in someone's queue for that date;
 * - cooldown: posted (or pending) within the cooldown, by cooldown.ts.
 *
 * What comes first: listings never posted, then the longest since last
 * posted, ties by name. Each intern draws from the categories in turn,
 * starting at a different one, so every queue gets a mix.
 */

import { cooldown } from './cooldown';
import { normalize } from './matcher';
import { readIssues, type DirectoryRow, type Rules } from './summary';
import type { QueueItemInput } from './tracker';
import { DEFAULT_RULES, queueStatus, type Assignment, type PostLogEntry } from './types';

export type SkipReason = 'sold' | 'noSeparator' | 'noDocument' | 'queued' | 'cooldown';

/** The order reasons are checked and reported in. A listing is counted under its first. */
export const SKIP_REASONS: readonly SkipReason[] = ['sold', 'noSeparator', 'noDocument', 'queued', 'cooldown'];

export interface PlanInput {
  /** The Directory rows. A row's `issues`, when present, is read for "no separator". */
  readonly properties: readonly DirectoryRow[];
  readonly posts: readonly PostLogEntry[];
  readonly assignments: readonly Assignment[];
  /** Exactly as the Team tab has them: queues are matched with ===. */
  readonly interns: readonly string[];
  /** Default: the rules' `perIntern` (the server's, from ping), else DEFAULT_PER_INTERN. */
  readonly perIntern?: number | undefined;
  /** yyyy-MM-dd */
  readonly date: string;
  readonly rules: Rules;
  /**
   * True: an intern's queue for that date is kept, first and as it is, and
   * counts toward `perIntern`. False: it is replaced, and its listings are
   * free to plan again.
   */
  readonly keepExisting: boolean;
}

export interface Plan {
  /**
   * Every intern's whole queue for the date, in posting order: with
   * `keepExisting`, their existing items first. Ready for Tracker.saveQueues.
   */
  readonly queues: Map<string, QueueItemInput[]>;
  /** How many items short of `perIntern` per intern the plan fell, in total. */
  readonly shortBy: number;
  /** Only reasons that left something out, in SKIP_REASONS order. */
  readonly skipped: { readonly reason: SkipReason; readonly count: number }[];
}

/** Used only when neither the input nor the rules say: the rules' own default. */
export const DEFAULT_PER_INTERN = DEFAULT_RULES.perIntern;

/** How many items per intern a plan aims for: the input's, else the rules', else the default. */
export function perInternOf(input: Pick<PlanInput, 'perIntern' | 'rules'>): number {
  for (const value of [input.perIntern, input.rules.perIntern]) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  }
  return DEFAULT_PER_INTERN;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real yyyy-MM-dd day, as cooldown.ts requires. */
function isDay(date: string): boolean {
  const m = ISO_DATE.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === date;
}

/**
 * Who has a thing, by the rule of cooldown.lastPostedOn: by folder id when
 * both sides have one, else by normalised name.
 */
class Lookup<T> {
  private readonly byId = new Map<string, T>();
  /** Rows that carried no id: matched by name. */
  private readonly byNameNoId = new Map<string, T>();
  /** Every row: for a property with no id of its own. */
  private readonly byNameAll = new Map<string, T>();
  private readonly names = new Map<string, string>();

  constructor(private readonly merge: (a: T, b: T) => T) {}

  key(name: string): string {
    let key = this.names.get(name);
    if (key === undefined) this.names.set(name, (key = normalize(name)));
    return key;
  }

  add(id: string, name: string, value: T): void {
    const put = (map: Map<string, T>, k: string): void => {
      const had = map.get(k);
      map.set(k, had === undefined ? value : this.merge(had, value));
    };
    if (id !== '') put(this.byId, id);
    const k = this.key(name);
    if (k !== '') {
      if (id === '') put(this.byNameNoId, k);
      put(this.byNameAll, k);
    }
  }

  get(id: string, name: string): T | undefined {
    const k = this.key(name);
    if (id === '') return k === '' ? undefined : this.byNameAll.get(k);
    const a = this.byId.get(id);
    const b = k === '' ? undefined : this.byNameNoId.get(k);
    if (a === undefined) return b;
    return b === undefined ? a : this.merge(a, b);
  }
}

interface Candidate {
  readonly row: DirectoryRow;
  /** Undefined: never posted. */
  readonly last: string | undefined;
  readonly nameKey: string;
}

function byPriority(a: Candidate, b: Candidate): number {
  if (a.last !== b.last) {
    if (a.last === undefined) return -1;
    if (b.last === undefined) return 1;
    return a.last < b.last ? -1 : 1;
  }
  if (a.nameKey !== b.nameKey) return a.nameKey < b.nameKey ? -1 : 1;
  if (a.row.name !== b.row.name) return a.row.name < b.row.name ? -1 : 1;
  return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
}

export function planQueues(input: PlanInput): Plan {
  const { date, rules } = input;
  if (!isDay(date)) throw new Error(`Expected a yyyy-MM-dd date, got "${date}".`);
  const perIntern = perInternOf(input);

  const interns: string[] = [];
  for (const name of input.interns) if (name.trim() && !interns.includes(name)) interns.push(name);
  const planned = new Set(interns);

  // That date's queues: the planned interns' own (kept, or about to be
  // replaced) and everyone else's (always taken).
  const existing = new Map<string, QueueItemInput[]>();
  const queued = new Lookup<true>(() => true);
  for (const a of input.assignments) {
    if (a.date !== date) continue;
    if (planned.has(a.assignedTo)) {
      if (!input.keepExisting) continue;
      let list = existing.get(a.assignedTo);
      if (!list) existing.set(a.assignedTo, (list = []));
      list.push({
        propertyName: a.propertyName,
        ...(a.propertyId.trim() ? { propertyId: a.propertyId } : {}),
        // "To post", in older rows, is Not Shared.
        status: queueStatus(a.status),
      });
    }
    queued.add(a.propertyId.trim(), a.propertyName, true);
  }

  // Each listing's last post, one pass over the posts.
  const lastPosted = new Lookup<string>((a, b) => (a > b ? a : b));
  for (const post of input.posts) {
    if (post.status !== 'Posted' && post.status !== 'Pending') continue;
    if (!isDay(post.date)) continue;
    lastPosted.add(post.propertyId.trim(), post.title, post.date);
  }

  const counts = new Map<SkipReason, number>();
  const skip = (reason: SkipReason): void => {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  };

  const seenIds = new Set<string>();
  const candidates: Candidate[] = [];
  for (const row of input.properties) {
    if (!row.name.trim()) continue;
    if (row.id !== '') {
      if (seenIds.has(row.id)) continue; // the first row wins a shared id, as in the directory
      seenIds.add(row.id);
    }
    const id = row.id.trim();
    if (row.availability === 'Sold') {
      skip('sold');
      continue;
    }
    const issues = row.issues ? readIssues(row.issues) : [];
    if (issues.some((issue) => issue.kind === 'noSeparator')) {
      skip('noSeparator');
      continue;
    }
    if (issues.some((issue) => issue.kind === 'noDocument')) {
      skip('noDocument');
      continue;
    }
    if (queued.get(id, row.name)) {
      skip('queued');
      continue;
    }
    const last = lastPosted.get(id, row.name);
    if (last !== undefined && cooldown(last, date, rules).blocked) {
      skip('cooldown');
      continue;
    }
    candidates.push({ row, last, nameKey: lastPosted.key(row.name) });
  }
  candidates.sort(byPriority);

  // One bucket per category, in priority order; categories ordered by their best listing.
  const bucketOf = new Map<string, Candidate[]>();
  const buckets: Candidate[][] = [];
  for (const c of candidates) {
    const key = normalize(c.row.category);
    let bucket = bucketOf.get(key);
    if (!bucket) {
      bucketOf.set(key, (bucket = []));
      buckets.push(bucket);
    }
    bucket.push(c);
  }
  const heads = buckets.map(() => 0);
  let left = candidates.length;

  const queues = new Map<string, QueueItemInput[]>();
  const need: number[] = [];
  const cursor: number[] = [];
  interns.forEach((name, i) => {
    const kept = existing.get(name) ?? [];
    queues.set(name, [...kept]);
    need.push(Math.max(0, perIntern - kept.length));
    cursor.push(buckets.length === 0 ? 0 : i % buckets.length);
  });

  // Round by round, each intern who still needs one takes the head of the
  // next category that has anything left.
  let wanting = need.some((n) => n > 0);
  while (left > 0 && wanting) {
    wanting = false;
    for (let i = 0; i < interns.length && left > 0; i++) {
      if (need[i]! <= 0) continue;
      let b = cursor[i]!;
      for (let tries = 0; tries < buckets.length && heads[b]! >= buckets[b]!.length; tries++) {
        b = (b + 1) % buckets.length;
      }
      const pick = buckets[b]![heads[b]!]!;
      heads[b] = heads[b]! + 1;
      left--;
      cursor[i] = (b + 1) % buckets.length;
      need[i]!--;
      queues.get(interns[i]!)!.push({ propertyName: pick.row.name, ...(pick.row.id.trim() ? { propertyId: pick.row.id } : {}) });
      if (need[i]! > 0) wanting = true;
    }
  }

  return {
    queues,
    shortBy: need.reduce((sum, n) => sum + n, 0),
    skipped: SKIP_REASONS.filter((reason) => counts.has(reason)).map((reason) => ({
      reason,
      count: counts.get(reason)!,
    })),
  };
}
