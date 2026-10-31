/**
 * The manager's arithmetic: the day at a glance, building a queue, matching a
 * pasted list, and doc health. Ported from the C# prototype's TrackerService,
 * AssignmentService and Manager view-models, whose tests say what right means.
 *
 * Pure, like the rest of core/: nothing here reads the clock, the network or
 * the DOM. The caller says what day it is and passes the rows it read; the
 * same answer comes out in a test, in the app and on a server.
 *
 * Dates are "yyyy-MM-dd" on the tracker's calendar, as on the Posts tab.
 */

import { cooldown, daysLeft, isDueForRepost } from './cooldown';
import { folderLine, normalizeForSearch } from './directory';
import { matchName, normalize } from './matcher';
import type { QueueItemInput } from './tracker';
import type { Assignment, AssignmentStatus, PostLogEntry, Property, Role, Settings } from './types';

/**
 * A listing as the directory list gives it, with its Issues text when the
 * list carries it. Code.gs sends only `hasIssues` today; doc health and the
 * "can't be posted" warnings read `issues` when it is there.
 */
export type DirectoryRow = Property & { readonly issues?: string | undefined };

/** The two numbers the rules need. AppSettings and Settings both fit. */
export type Rules = Pick<Settings, 'cooldownDays' | 'repostDueDays'>;

// ------------------------------------------------------------------ dates

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Whole days since 1970 in UTC, or undefined when `date` is not a real yyyy-MM-dd day. */
function dayOf(date: string): number | undefined {
  const m = ISO_DATE.exec(date);
  if (!m) return undefined;
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
  // Date.UTC rolls 2026-02-30 into March and reads years below 100 as 19xx.
  return isoOf(day) === date ? day : undefined;
}

function mustDay(date: string): number {
  const day = dayOf(date);
  if (day === undefined) throw new Error(`Expected a yyyy-MM-dd date, got "${date}".`);
  return day;
}

function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function parts(date: string): { readonly weekday: string; readonly day: number; readonly month: string; readonly year: number } {
  const d = new Date(mustDay(date) * DAY_MS);
  return {
    weekday: WEEKDAYS[d.getUTCDay()] ?? '',
    day: d.getUTCDate(),
    month: MONTHS[d.getUTCMonth()] ?? '',
    year: d.getUTCFullYear(),
  };
}

/** A real yyyy-MM-dd day: not "2026-02-30", not "30/10/2026". */
export function isDate(value: string): boolean {
  return dayOf(value) !== undefined;
}

/** "2026-10-29" plus 1 → "2026-10-30". Whole calendar days, across months and years. */
export function addDays(date: string, days: number): string {
  return isoOf(mustDay(date) + days);
}

/** Days from `from` to `to`: positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return mustDay(to) - mustDay(from);
}

/** "Thu 29 Oct 2026". English whatever the PC's regional settings. */
export function longDate(date: string): string {
  const p = parts(date);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** "Thu 29 Oct". */
export function shortDate(date: string): string {
  const p = parts(date);
  return `${p.weekday} ${p.day} ${p.month}`;
}

// ------------------------------------------------------------------ words

/** Same person: trimmed, any case. (The server compares names exactly; this is for counting.) */
export function samePerson(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** "Jan Dela Cruz" → "Jan". */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first ?? '';
}

/** "1 listing", "1,474 listings". */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-PH')} ${n === 1 ? one : many}`;
}

/** "today", "1 day ago", "32 days ago". A day in the future (a skewed clock) is today. */
export function ago(days: number): string {
  if (days <= 0) return 'today';
  return days === 1 ? '1 day ago' : `${days.toLocaleString('en-PH')} days ago`;
}

const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

// ------------------------------------------------------------------ the post history

interface Latest {
  readonly post: PostLogEntry;
  /** Row number in the sheet: a later row wins a tie. */
  readonly order: number;
}

/** The Posts tab, indexed once per array, so 1,474 listings cost one pass over it. */
interface History {
  /** Rows that carry a folder id, by that id. */
  readonly byId: ReadonlyMap<string, Latest>;
  /** Rows without a folder id, by normalised title. */
  readonly byNameWithoutId: ReadonlyMap<string, Latest>;
  /** Every row, by normalised title: for a listing that has no id itself. */
  readonly byName: ReadonlyMap<string, Latest>;
}

const histories = new WeakMap<readonly PostLogEntry[], History>();

function isNewer(a: Latest, b: Latest): boolean {
  if (a.post.date !== b.post.date) return a.post.date > b.post.date;
  if (a.post.time !== b.post.time) return a.post.time > b.post.time;
  return a.order > b.order;
}

function keepNewest(map: Map<string, Latest>, key: string, entry: Latest): void {
  const held = map.get(key);
  if (!held || isNewer(entry, held)) map.set(key, entry);
}

function historyOf(posts: readonly PostLogEntry[]): History {
  const held = histories.get(posts);
  if (held) return held;
  const byId = new Map<string, Latest>();
  const byNameWithoutId = new Map<string, Latest>();
  const all = new Map<string, Latest>();
  posts.forEach((post, order) => {
    // Both a live post and one waiting for its link start the cooldown.
    if (post.status !== 'Posted' && post.status !== 'Pending') return;
    if (dayOf(post.date) === undefined) return;
    const entry: Latest = { post, order };
    const name = normalize(post.title);
    if (post.propertyId !== '') keepNewest(byId, post.propertyId, entry);
    else keepNewest(byNameWithoutId, name, entry);
    keepNewest(all, name, entry);
  });
  const history: History = { byId, byNameWithoutId, byName: all };
  histories.set(posts, history);
  return history;
}

/**
 * The listing's latest Posted or Pending row, by date, then time, then sheet
 * order. The same rule as cooldown.ts's lastPostedOn, indexed: a row is the
 * listing's when the folder ids agree, if both have one, else when the names
 * agree. A row whose date is not yyyy-MM-dd is skipped.
 */
export function lastPostOf(
  posts: readonly PostLogEntry[],
  property: Pick<Property, 'id' | 'name'>,
): PostLogEntry | undefined {
  const history = historyOf(posts);
  const name = normalize(property.name);
  if (property.id === '') return history.byName.get(name)?.post;
  const byId = history.byId.get(property.id);
  const byTitle = history.byNameWithoutId.get(name);
  if (!byId) return byTitle?.post;
  if (!byTitle) return byId.post;
  return isNewer(byTitle, byId) ? byTitle.post : byId.post;
}

/** Newest first by date and time; a row logged later in the sheet wins a tie. */
export function newestFirst(posts: readonly PostLogEntry[]): PostLogEntry[] {
  return posts
    .map((post, order): Latest => ({ post, order }))
    .sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0))
    .map((entry) => entry.post);
}

// ------------------------------------------------------------------ queues, read

/** Who holds a listing in their queue: assignments indexed like the post history. */
interface Holders {
  readonly byId: ReadonlyMap<string, Assignment>;
  readonly byNameWithoutId: ReadonlyMap<string, Assignment>;
  readonly byName: ReadonlyMap<string, Assignment>;
}

function holdersOf(rows: readonly Assignment[]): Holders {
  const byId = new Map<string, Assignment>();
  const byNameWithoutId = new Map<string, Assignment>();
  const all = new Map<string, Assignment>();
  for (const row of rows) {
    const name = normalize(row.propertyName);
    // The first row wins: sheet order.
    if (row.propertyId !== '') {
      if (!byId.has(row.propertyId)) byId.set(row.propertyId, row);
    } else if (!byNameWithoutId.has(name)) {
      byNameWithoutId.set(name, row);
    }
    if (!all.has(name)) all.set(name, row);
  }
  return { byId, byNameWithoutId, byName: all };
}

function holderOf(holders: Holders, property: Pick<Property, 'id' | 'name'>): Assignment | undefined {
  const name = normalize(property.name);
  if (property.id === '') return holders.byName.get(name);
  return holders.byId.get(property.id) ?? holders.byNameWithoutId.get(name);
}

// ------------------------------------------------------------------ the day

/** A person on the Team tab, as an admin may see them. Never the key. */
import type { TeamMember } from './types';
export type { TeamMember };

/** One person's queue on the day. */
export interface InternProgress {
  /** As the team (or, for someone not on it, the sheet) spells it. */
  readonly name: string;
  readonly total: number;
  readonly posted: number;
  readonly pending: number;
  readonly toPost: number;
  /** Had a queue, and nothing in it is left to post or waiting for a link. */
  readonly done: boolean;
}

/** A listing on the "due for repost" or "never posted" list. */
export interface RepostItem {
  readonly property: Property;
  /** Its latest Posted or Pending row's date; missing when never posted. */
  readonly lastPosted?: string | undefined;
  readonly lastPostedBy?: string | undefined;
  /** Days from that post to the day shown. */
  readonly daysSince?: number | undefined;
  /** Whose queue has it on the day shown, if anyone's. */
  readonly queuedFor?: string | undefined;
}

export interface DaySummary {
  readonly date: string;
  /** Posts dated that day that are live. */
  readonly postedToday: number;
  /** Every post waiting for its link, whatever its date: they wait for the group admin. */
  readonly pending: number;
  /** People with a queue that day who have finished it. */
  readonly internsDone: number;
  /** People with a queue that day. */
  readonly internsAssigned: number;
  /** That day's Posts rows, newest first. */
  readonly posts: readonly PostLogEntry[];
  /** Every intern on the team, and anyone else with a queue that day: assigned first, then by name. */
  readonly interns: readonly InternProgress[];
  /** Not posted for repostDueDays or more: longest since first, then by name. */
  readonly dueForRepost: readonly RepostItem[];
  /** Never posted, by name. */
  readonly neverPosted: readonly RepostItem[];
  readonly repostDueDays: number;
}

export interface DayInput {
  /** The day shown. */
  readonly date: string;
  readonly posts: readonly PostLogEntry[];
  readonly assignments: readonly Assignment[];
  /** The directory: every listing. */
  readonly properties: readonly Property[];
  /** Whose progress to show besides whoever has a queue: the team's interns. Optional. */
  readonly team?: readonly Pick<TeamMember, 'name' | 'role' | 'active'>[] | undefined;
  readonly settings: Rules;
}

function progressOf(name: string, day: readonly Assignment[]): InternProgress {
  let total = 0;
  let posted = 0;
  let pending = 0;
  let toPost = 0;
  for (const row of day) {
    if (!samePerson(row.assignedTo, name)) continue;
    total++;
    if (row.status === 'Posted') posted++;
    else if (row.status === 'Pending') pending++;
    else toPost++;
  }
  return { name, total, posted, pending, toPost, done: total > 0 && toPost === 0 && pending === 0 };
}

/** The tracker's numbers for one day. */
export function summarizeDay(input: DayInput): DaySummary {
  const { date, posts, assignments, properties, settings } = input;
  const today = mustDay(date);
  const day = assignments.filter((a) => a.date === date);

  const names: string[] = [];
  const add = (name: string): void => {
    if (name.trim() && !names.some((n) => samePerson(n, name))) names.push(name);
  };
  for (const member of input.team ?? []) if (member.role === 'Intern' && member.active !== false) add(member.name);
  for (const row of day) add(row.assignedTo);

  const interns = names
    .map((name) => progressOf(name, day))
    .sort((a, b) => Number(b.total > 0) - Number(a.total > 0) || byName.compare(a.name, b.name));

  const holders = holdersOf(day);
  const due: RepostItem[] = [];
  const never: RepostItem[] = [];
  for (const property of properties) {
    const holder = holderOf(holders, property);
    const queuedFor = holder ? { queuedFor: holder.assignedTo } : {};
    const last = lastPostOf(posts, property);
    if (!last) {
      never.push({ property, ...queuedFor });
    } else if (isDueForRepost(last.date, date, settings)) {
      due.push({
        property,
        lastPosted: last.date,
        lastPostedBy: last.postedBy,
        daysSince: Math.max(0, today - mustDay(last.date)),
        ...queuedFor,
      });
    }
  }
  never.sort((a, b) => byName.compare(a.property.name, b.property.name));
  due.sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0) || byName.compare(a.property.name, b.property.name));

  return {
    date,
    postedToday: posts.filter((p) => p.date === date && p.status === 'Posted').length,
    pending: posts.filter((p) => p.status === 'Pending').length,
    internsDone: interns.filter((i) => i.done).length,
    internsAssigned: interns.filter((i) => i.total > 0).length,
    posts: newestFirst(posts.filter((p) => p.date === date)),
    interns,
    dueForRepost: due,
    neverPosted: never,
    repostDueDays: settings.repostDueDays,
  };
}

/**
 * Everyone the tracker mentions: whoever has had a queue or logged a post, by
 * name. A stand-in for the team list when the web app doesn't send one.
 */
export function peopleIn(assignments: readonly Assignment[], posts: readonly PostLogEntry[]): string[] {
  const names: string[] = [];
  for (const name of [...assignments.map((a) => a.assignedTo), ...posts.map((p) => p.postedBy)]) {
    if (name.trim() && !names.some((n) => samePerson(n, name))) names.push(name);
  }
  return names.sort((a, b) => byName.compare(a, b));
}

// ------------------------------------------------------------------ building a queue

/** One line of a queue being built. Its saved status, if any, is the rules' to say. */
export interface QueueEntry {
  /** One listing, one key: "id:" and the folder id, or "name:" and the normalised name when the folder is unknown. */
  readonly key: string;
  /** As the sheet or the directory spells it. */
  readonly propertyName: string;
  /** The folder id; blank when unknown. */
  readonly propertyId: string;
  /** The listing, when the directory has it. Missing: its folder has gone. */
  readonly property?: Property | undefined;
}

export type AssignBlock = 'cooldown' | 'otherQueue';

/** May this listing go into this queue, and if not, why not. */
export interface AssignCheck {
  readonly canAdd: boolean;
  /** Why not: in its cooldown on the queue's day, or in someone else's queue that day. */
  readonly block?: AssignBlock | undefined;
  /** Its latest Posted or Pending row. Missing: never posted. */
  readonly lastPost?: PostLogEntry | undefined;
  /** Not posted for repostDueDays or more by the queue's day. Never posted counts. */
  readonly due: boolean;
  /** In its cooldown: the first day it may be queued. */
  readonly nextAllowed?: string | undefined;
  /** In its cooldown: days from the queue's day to nextAllowed. 0 otherwise. */
  readonly daysLeft: number;
  /** In someone else's queue that day: their name, as the sheet has it. */
  readonly holder?: string | undefined;
  /** Why it can't be added, as a sentence that says what to do next. Blank when it can. */
  readonly reason: string;
}

/** A pasted line, matched against the directory's names. */
export interface PasteMatch {
  /** The line as typed, without its number or bullet. */
  readonly typed: string;
  /** exact: the name, give or take case and punctuation; suggestion: "did you mean"; notFound: nothing close. */
  readonly kind: 'exact' | 'suggestion' | 'notFound';
  /** The listing matched, or the one suggested. */
  readonly property?: Property | undefined;
}

export interface QueueValidation {
  readonly ok: boolean;
  /** What to save, in this order: a saved item keeps its status, a new one is To post. */
  readonly items: readonly QueueItemInput[];
  /** Why the queue can't be saved as it is, one sentence each. */
  readonly problems: readonly string[];
}

export interface AssignInput {
  /** Whose queue: exactly as the sheet has the name. */
  readonly intern: string;
  /** The queue's day. The cooldown is judged against it, not against today. */
  readonly date: string;
  /** Today, for "posted 2 days ago". */
  readonly today: string;
  readonly posts: readonly PostLogEntry[];
  readonly assignments: readonly Assignment[];
  readonly properties: readonly Property[];
  readonly settings: Rules;
}

export interface AssignRules {
  readonly intern: string;
  readonly date: string;
  /** The saved queue as a draft starts: Pending first, then To post in sheet order, then Posted. */
  readonly saved: readonly QueueEntry[];
  /** The saved status of the listing with this key; undefined when it is not in the saved queue. */
  statusOf(key: string): AssignmentStatus | undefined;
  /** Started (Pending or Posted) items stay in the queue: they can't be removed. */
  isStarted(key: string): boolean;
  /** May the listing go into this queue? */
  check(property: Pick<Property, 'id' | 'name'>): AssignCheck;
  /** A new entry for a listing from the directory. */
  entryFor(property: Property): QueueEntry;
  /** An entry for a name as typed or as the sheet has it, resolved through the directory when it can be. */
  entryNamed(name: string): QueueEntry;
  /** The queue as it would be saved: refuses what can't go in it, keeps what was saved. */
  validate(draft: readonly QueueEntry[]): QueueValidation;
}

interface DirectoryIndex {
  readonly byId: ReadonlyMap<string, Property>;
  readonly byName: ReadonlyMap<string, Property>;
}

const directories = new WeakMap<readonly Property[], DirectoryIndex>();

function directoryOf(properties: readonly Property[]): DirectoryIndex {
  const held = directories.get(properties);
  if (held) return held;
  const byId = new Map<string, Property>();
  const names = new Map<string, Property>();
  for (const p of properties) {
    if (p.id !== '' && !byId.has(p.id)) byId.set(p.id, p);
    const key = normalize(p.name);
    if (!names.has(key)) names.set(key, p);
  }
  const index: DirectoryIndex = { byId, byName: names };
  directories.set(properties, index);
  return index;
}

function resolve(index: DirectoryIndex, id: string, name: string): Property | undefined {
  return (id !== '' ? index.byId.get(id) : undefined) ?? index.byName.get(normalize(name));
}

/**
 * How to name whoever else holds a listing: "Mika", or "Jan Reyes" in full
 * when they share a first name with the person whose queue this is.
 */
export function holderName(holder: string, intern: string): string {
  return firstName(holder).toLowerCase() === firstName(intern).toLowerCase() ? holder.trim() : firstName(holder);
}

/** The key of a listing from the directory. */
export function keyOf(property: Pick<Property, 'id' | 'name'>): string {
  return property.id !== '' ? `id:${property.id}` : `name:${normalize(property.name)}`;
}

const STATUS_ORDER: readonly AssignmentStatus[] = ['Pending', 'To post', 'Posted'];

/** What can go in one person's queue for one day, judged from the rows as read. */
export function assignRules(input: AssignInput): AssignRules {
  const { intern, date, today, posts, assignments, properties, settings } = input;
  mustDay(date);
  mustDay(today);
  const directory = directoryOf(properties);
  const day = assignments.filter((a) => a.date === date);
  const others = holdersOf(day.filter((a) => !samePerson(a.assignedTo, intern)));
  const mine = day.filter((a) => samePerson(a.assignedTo, intern));

  const saved: QueueEntry[] = [];
  const savedRows = new Map<string, Assignment>();
  for (const status of STATUS_ORDER) {
    for (const row of mine) {
      if (row.status !== status) continue;
      const property = resolve(directory, row.propertyId, row.propertyName);
      const key = property
        ? keyOf(property)
        : row.propertyId !== ''
          ? `id:${row.propertyId}`
          : `name:${normalize(row.propertyName)}`;
      if (savedRows.has(key)) continue; // the same listing twice: the first stays
      savedRows.set(key, row);
      saved.push({ key, propertyName: row.propertyName, propertyId: property?.id ?? row.propertyId, property });
    }
  }

  function check(property: Pick<Property, 'id' | 'name'>): AssignCheck {
    const lastPost = lastPostOf(posts, property);
    const state = cooldown(lastPost?.date, date, settings);
    const due = isDueForRepost(lastPost?.date, date, settings);
    if (state.blocked && lastPost) {
      const nextAllowed = state.nextAllowed ?? date;
      const by = lastPost.postedBy.trim() ? ` by ${firstName(lastPost.postedBy)}` : '';
      const since = Math.max(0, mustDay(today) - mustDay(lastPost.date));
      return {
        canAdd: false,
        block: 'cooldown',
        lastPost,
        due,
        nextAllowed,
        daysLeft: daysLeft(state, date),
        reason: `Posted ${ago(since)}${by}. It can go in a queue from ${shortDate(nextAllowed)}.`,
      };
    }
    const holder = holderOf(others, property);
    if (holder) {
      return {
        canAdd: false,
        block: 'otherQueue',
        ...(lastPost ? { lastPost } : {}),
        due,
        daysLeft: 0,
        holder: holder.assignedTo,
        reason: `Already in ${holderName(holder.assignedTo, intern)}'s queue for ${shortDate(date)}.`,
      };
    }
    return { canAdd: true, ...(lastPost ? { lastPost } : {}), due, daysLeft: 0, reason: '' };
  }

  function entryFor(property: Property): QueueEntry {
    return { key: keyOf(property), propertyName: property.name, propertyId: property.id, property };
  }

  function entryNamed(name: string): QueueEntry {
    const property = directory.byName.get(normalize(name));
    return property ? entryFor(property) : { key: `name:${normalize(name)}`, propertyName: name, propertyId: '' };
  }

  function validate(draft: readonly QueueEntry[]): QueueValidation {
    const items: QueueItemInput[] = [];
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const entry of draft) {
      if (!entry.propertyName.trim() || seen.has(entry.key)) continue;
      seen.add(entry.key);

      // Already in the saved queue: it stays, with the status it has now, even
      // if its folder has gone or its own post has started a cooldown.
      const kept = savedRows.get(entry.key);
      if (kept) {
        const id = entry.propertyId || kept.propertyId;
        items.push({ propertyName: kept.propertyName, ...(id ? { propertyId: id } : {}), status: kept.status });
        continue;
      }

      const property = entry.property ?? resolve(directory, entry.propertyId, entry.propertyName);
      if (!property) {
        problems.push(`No listing is called “${entry.propertyName.trim()}”. Check the spelling, or find it by searching.`);
        continue;
      }
      const verdict = check(property);
      if (!verdict.canAdd) {
        problems.push(`${property.name} can't go in this queue. ${verdict.reason}`);
        continue;
      }
      items.push({ propertyName: property.name, propertyId: property.id, status: 'To post' });
    }
    return { ok: problems.length === 0, items, problems };
  }

  return {
    intern,
    date,
    saved,
    statusOf: (key) => savedRows.get(key)?.status,
    isStarted: (key) => {
      const status = savedRows.get(key)?.status;
      return status === 'Pending' || status === 'Posted';
    },
    check,
    entryFor,
    entryNamed,
    validate,
  };
}

/** Same listings in the same order. */
export function sameQueue(a: readonly QueueEntry[], b: readonly QueueEntry[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry.key === b[i]?.key);
}

/** The list with the item at `from` moved to `to`. Out of range: an unchanged copy. */
export function moveEntry<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [item] = out.splice(from, 1);
  if (item !== undefined) out.splice(to, 0, item);
  return out;
}

// ------------------------------------------------------------------ a pasted list

// "1.", "2)", "-", "*", "•", "–", "—" before a name. Not "1.5 hectares": a
// number followed by another digit is part of the name.
const LIST_MARKER = /^\s*(?:\d+\s*[.)](?!\d)|[-*•–—])\s*/u;

/** The lines of a pasted list without their numbers or bullets. Blank lines are dropped. */
export function pastedLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(LIST_MARKER, '').trim())
    .filter((line) => line !== '');
}

/**
 * Each pasted line matched against the directory's names with matcher.ts:
 * exact (case, punctuation and the usual abbreviations aside), a suggestion
 * for a small typo — never one with a different lot number — or not found.
 * A line that says the same as an earlier one is left out.
 */
export function matchPasted(text: string, properties: readonly Property[]): PasteMatch[] {
  const directory = directoryOf(properties);
  const names = properties.map((p) => p.name);
  const seen = new Set<string>();
  const out: PasteMatch[] = [];
  for (const typed of pastedLines(text)) {
    const key = normalize(typed);
    if (seen.has(key)) continue;
    seen.add(key);
    const found = matchName(typed, names);
    const property = found.kind === 'notFound' ? undefined : directory.byName.get(normalize(found.name));
    out.push(property && found.kind !== 'notFound' ? { typed, kind: found.kind, property } : { typed, kind: 'notFound' });
  }
  return out;
}

// ------------------------------------------------------------------ search

const haystacks = new WeakMap<readonly Property[], readonly string[]>();

/**
 * Listings whose name and folder line hold every word of `query`, in the
 * order given: Directory.search's rule, over a list passed in. Empty: all.
 */
export function searchProperties(properties: readonly Property[], query: string): readonly Property[] {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return properties;
  let hay = haystacks.get(properties);
  if (!hay) {
    hay = properties.map((p) => normalizeForSearch(`${p.name} ${folderLine(p)}`));
    haystacks.set(properties, hay);
  }
  const rows = hay;
  return properties.filter((_, i) => words.every((word) => rows[i]?.includes(word)));
}

// ------------------------------------------------------------------ doc health

/**
 * What the directory's Issues column can say about a listing, worst first.
 * The first three mean it can't be posted until someone fixes the document.
 */
export type IssueKind = 'noSeparator' | 'noDocument' | 'wordFile' | 'other' | 'noPhotos';

export const ISSUE_ORDER: readonly IssueKind[] = ['noSeparator', 'noDocument', 'wordFile', 'other', 'noPhotos'];

const BLOCKING: ReadonlySet<IssueKind> = new Set<IssueKind>(['noSeparator', 'noDocument', 'wordFile']);

/** Stops the listing being posted at all: Copy is blocked or there is no text. */
export function isBlocking(kind: IssueKind): boolean {
  return BLOCKING.has(kind);
}

/**
 * The worst problem in a listing's Issues that stops it being posted at all:
 * Copy is blocked, or there is no text. Undefined when there is none, or when
 * the list doesn't carry the Issues text.
 */
export function postingProblem(row: Pick<HealthSource, 'issues' | 'hasIssues'>): IssueKind | undefined {
  return readIssues(row.issues ?? '').find((issue) => isBlocking(issue.kind))?.kind;
}

export interface Issue {
  readonly kind: IssueKind;
  /** As the directory wrote it. */
  readonly text: string;
}

function classify(text: string): IssueKind {
  const t = text.toLowerCase();
  if (/\bno separator\b/.test(t)) return 'noSeparator';
  if (/\bword file\b|\.docx?\b|microsoft word/.test(t)) return 'wordFile';
  if (/^no (?:posting )?doc(?:ument)?\b/.test(t)) return 'noDocument';
  if (/^no photos?\b/.test(t)) return 'noPhotos';
  return 'other';
}

/**
 * The Issues column read as problems, worst first: BuildDirectory.gs joins
 * them with " · ". Anything it doesn't recognise is kept, as 'other', in the
 * directory's own words.
 */
export function readIssues(text: string): Issue[] {
  const found = new Map<IssueKind, string[]>();
  for (const part of text.split(/\s*(?:·|\r?\n)\s*/)) {
    const said = part.trim();
    if (!said) continue;
    const kind = classify(said);
    const list = found.get(kind);
    if (list) list.push(said);
    else found.set(kind, [said]);
  }
  return ISSUE_ORDER.filter((kind) => found.has(kind)).map((kind) => ({
    kind,
    text: (found.get(kind) ?? []).join(' · '),
  }));
}

/** A listing in a doc-health group. */
export interface HealthItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  /** This group's problem in the directory's words. Blank when the list only said "has issues". */
  readonly detail: string;
  /** Its other problems, worst first. */
  readonly also: readonly IssueKind[];
}

export interface HealthGroup {
  readonly kind: IssueKind;
  /** By name. */
  readonly items: readonly HealthItem[];
}

export interface DocHealth {
  /** Worst first; a kind nobody has is left out. */
  readonly groups: readonly HealthGroup[];
  /** Listings with at least one problem. */
  readonly listings: number;
  /** Listings that can't be posted until their document is fixed. */
  readonly blocked: number;
}

/** A directory row: its Issues text when the list carries it, else only the flag. */
export type HealthSource = Pick<Property, 'id' | 'name' | 'category'> & {
  readonly hasIssues?: boolean | undefined;
  readonly issues?: string | undefined;
};

/** The directory's problems grouped by kind, worst first: a queue of documents to fix. */
export function docHealth(properties: readonly HealthSource[]): DocHealth {
  const groups = new Map<IssueKind, HealthItem[]>();
  let listings = 0;
  let blocked = 0;
  for (const p of properties) {
    let issues = readIssues(p.issues ?? '');
    // Flagged, but the list didn't say why: kept, so nothing is silently dropped.
    if (issues.length === 0 && p.hasIssues === true) issues = [{ kind: 'other', text: '' }];
    if (issues.length === 0) continue;
    listings++;
    if (issues.some((issue) => isBlocking(issue.kind))) blocked++;
    for (const issue of issues) {
      const item: HealthItem = {
        id: p.id,
        name: p.name,
        category: p.category,
        detail: issue.text,
        also: issues.filter((other) => other !== issue).map((other) => other.kind),
      };
      const list = groups.get(issue.kind);
      if (list) list.push(item);
      else groups.set(issue.kind, [item]);
    }
  }
  return {
    groups: ISSUE_ORDER.flatMap((kind) => {
      const items = groups.get(kind);
      return items ? [{ kind, items: items.sort((a, b) => byName.compare(a.name, b.name)) }] : [];
    }),
    listings,
    blocked,
  };
}

// ------------------------------------------------------------------ the team, for the sidebar

/** The team's active interns, by name: whose queues can be built. */
export function activeInterns(team: readonly Pick<TeamMember, 'name' | 'role' | 'active'>[]): string[] {
  const names: string[] = [];
  for (const member of team) {
    if (member.role !== 'Intern' || member.active === false || !member.name.trim()) continue;
    if (!names.some((n) => samePerson(n, member.name))) names.push(member.name);
  }
  return names.sort((a, b) => byName.compare(a, b));
}

/** One intern's day at a glance: their queue's progress and posts still waiting for a link. */
export interface InternDay {
  readonly name: string;
  /** Items in their queue on the day. */
  readonly total: number;
  /** Of those, posted. */
  readonly posted: number;
  /** Their posts waiting for a link, whatever the date: as the tracker counts pending. */
  readonly pendingPosts: number;
}

/** Every active intern on the team, by name, with their queue's progress on `date`. */
export function internDays(
  team: readonly Pick<TeamMember, 'name' | 'role' | 'active'>[],
  assignments: readonly Assignment[],
  posts: readonly PostLogEntry[],
  date: string,
): InternDay[] {
  const day = assignments.filter((a) => a.date === date);
  return activeInterns(team).map((name) => {
    const progress = progressOf(name, day);
    return {
      name,
      total: progress.total,
      posted: progress.posted,
      pendingPosts: posts.filter((p) => p.status === 'Pending' && samePerson(p.postedBy, name)).length,
    };
  });
}
