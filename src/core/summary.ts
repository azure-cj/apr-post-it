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
import { addDays, DAY_MS, dayOf, daysBetween, isDate, MONTHS, mustDay, WEEKDAYS } from './dates';
import { folderLine, normalizeForSearch } from './directory';
import { matchName, normalize } from './matcher';
import type { QueueItemInput } from './tracker';
import { queueStatus, type Assignment, type AssignmentStatus, type PostLogEntry, type Property, type Role, type Settings } from './types';
import {
  assignmentPeriod,
  isQueueOver,
  periodLabel,
  periodReferenceDay,
  queueDaysElapsed,
  queueInWeek,
  rowsInWeek,
  rowsOf,
  workdaysBetween,
  type QueuePeriod,
} from './queues';
import { weekDays, weekFriday, weekOf } from './week';

/**
 * A listing as the directory list gives it, with its Issues text when the
 * list carries it (Code.gs sends it with every row). Doc health, the planner
 * and the "can't be posted" warnings read `issues` when it is there.
 */
export type DirectoryRow = Property & { readonly issues?: string | undefined };

/**
 * The rules: the server's (ServerRules, from ping), or AppSettings and
 * Settings, which all fit. `perWeek` is the planner's and the quick fill's
 * default; `perIntern` is its old name, read when `perWeek` is missing;
 * without either the planner uses DEFAULT_PER_WEEK.
 */
export type Rules = Pick<Settings, 'cooldownDays' | 'repostDueDays'> & {
  readonly perWeek?: number | undefined;
  /** @deprecated The old name of perWeek. */
  readonly perIntern?: number | undefined;
  /** v14: how many weeks a new queue runs by default, 1 to 3. Missing: queues.DEFAULT_QUEUE_WEEKS. */
  readonly queueWeeks?: number | undefined;
};

// ------------------------------------------------------------------ dates

function parts(date: string): { readonly weekday: string; readonly day: number; readonly month: string; readonly year: number } {
  const d = new Date(mustDay(date) * DAY_MS);
  return {
    weekday: WEEKDAYS[d.getUTCDay()] ?? '',
    day: d.getUTCDate(),
    month: MONTHS[d.getUTCMonth()] ?? '',
    year: d.getUTCFullYear(),
  };
}

export { isDate, addDays, daysBetween };

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
    // Both a live post and one waiting for approval start the cooldown.
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

// ------------------------------------------------------------------ held listings

/** Who holds a listing, by the owner's rule: an open queue row in a week that is not over. */
export interface HeldListing {
  /** The assignee, as the sheet has the name. */
  readonly heldBy: string;
  /** The row's Date, as it has it: a week key, or the day of a row written before v6. */
  readonly date: string;
  /** The queue's week, as its Monday (week.assignmentWeek): the week its start is in. */
  readonly week: string;
  /** v14: the queue's deadline: it holds the listing until then. */
  readonly due: string;
  /** The row's own spelling of the listing, and its folder id ('' when none). */
  readonly propertyName: string;
  readonly propertyId: string;
}

/**
 * Every listing held by an intern on `today` (v6, v14): a Not Shared (or
 * older "To post") row holds its listing for its assignee until its queue's
 * deadline (queues.assignmentPeriod; Manila's today). Once that has passed the
 * row is Missed and holds nothing. Pending and Posted release it at once. A
 * row whose date can't be read holds nothing. Keyed as keyOf keys a listing:
 * "id:" and the folder id, else "name:" and the normalised name for a row
 * with no id. When rows disagree, the earliest week wins, then sheet order.
 * Look a listing up with heldBy(), which also finds a row with no id for a
 * listing that has one.
 */
export function heldListings(assignments: readonly Assignment[], today: string): Map<string, HeldListing> {
  mustDay(today);
  const held = new Map<string, HeldListing>();
  for (const row of assignments) {
    if (queueStatus(row.status) !== 'Not Shared') continue;
    const period = assignmentPeriod(row);
    if (!period || isQueueOver(period, today)) continue;
    const week = period.key;
    const id = row.propertyId.trim();
    const name = normalize(row.propertyName);
    if (!id && !name) continue;
    const key = id ? `id:${id}` : `name:${name}`;
    const had = held.get(key);
    if (had && had.week <= week) continue;
    held.set(key, { heldBy: row.assignedTo, date: row.date, week, due: period.due, propertyName: row.propertyName, propertyId: id });
  }
  return held;
}

/**
 * Who holds the listing in `held` (from heldListings), if anyone: by its folder
 * id, else by name among rows with no id. A listing with no id of its own is
 * matched by name against every row, as cooldown.lastPostedOn matches posts.
 */
export function heldBy(
  held: ReadonlyMap<string, HeldListing>,
  property: Pick<Property, 'id' | 'name'>,
): HeldListing | undefined {
  const id = property.id.trim();
  const name = normalize(property.name);
  if (id) return held.get(`id:${id}`) ?? (name ? held.get(`name:${name}`) : undefined);
  if (!name) return undefined;
  const direct = held.get(`name:${name}`);
  if (direct) return direct;
  for (const entry of held.values()) if (normalize(entry.propertyName) === name) return entry;
  return undefined;
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
  /** Had a queue, and nothing in it is left to post or waiting for approval. */
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
  /** Whose queue has it in the week of the day shown, if anyone's. */
  readonly queuedFor?: string | undefined;
}

export interface DaySummary {
  readonly date: string;
  /** The week the day belongs to (weekOf): whose queues `interns` counts. */
  readonly week: string;
  /** Posts dated that day that are live. */
  readonly postedToday: number;
  /** Every post waiting for the group admin's approval, whatever its date. */
  readonly pending: number;
  /** People with a queue that week who have finished it. */
  readonly internsDone: number;
  /** People with a queue that week. */
  readonly internsAssigned: number;
  /** That day's Posts rows, newest first. */
  readonly posts: readonly PostLogEntry[];
  /** Every intern on the team, and anyone else with a queue that week: assigned first, then by name. */
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
    // Anything else is Not Shared: "To post", in older rows, included.
    const status = queueStatus(row.status);
    if (status === 'Posted') posted++;
    else if (status === 'Pending') pending++;
    else toPost++;
  }
  return { name, total, posted, pending, toPost, done: total > 0 && toPost === 0 && pending === 0 };
}

/**
 * The tracker's numbers for one day. Queues are weekly (v6): the interns'
 * progress and "queued for" are their queues for the week the day is in.
 */
export function summarizeDay(input: DayInput): DaySummary {
  const { date, posts, assignments, properties, settings } = input;
  const today = mustDay(date);
  const week = weekOf(date);
  // Each person's queue running that week (v14: a queue may run 1 to 3 weeks).
  const day = rowsInWeek(assignments, week, date);

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
    week,
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
  /** Why not: in its cooldown on the week's reference day (weekReferenceDay), or in someone else's queue that week. */
  readonly block?: AssignBlock | undefined;
  /** Its latest Posted or Pending row. Missing: never posted. */
  readonly lastPost?: PostLogEntry | undefined;
  /** Not posted for repostDueDays or more by the week's reference day. Never posted counts. */
  readonly due: boolean;
  /** In its cooldown: the first day it may be queued. */
  readonly nextAllowed?: string | undefined;
  /** In its cooldown: days from the week's reference day to nextAllowed. 0 otherwise. */
  readonly daysLeft: number;
  /** In someone else's queue that week: their name, as the sheet has it. */
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
  /** What to save, in this order: a saved item keeps its status, a new one is Not Shared. */
  readonly items: readonly QueueItemInput[];
  /** Why the queue can't be saved as it is, one sentence each. */
  readonly problems: readonly string[];
}

export interface AssignInput {
  /** Whose queue: exactly as the sheet has the name. */
  readonly intern: string;
  /**
   * The queue's week (v6), as its Monday; any day of it is read with weekOf.
   * The cooldown is judged on the week's first day still to come: `today`
   * inside the week, its Monday before it, its Friday after it.
   */
  readonly week?: string | undefined;
  /** @deprecated A day, read as weekOf(date): the week it is in. Give `week`. */
  readonly date?: string | undefined;
  /**
   * v14: when the queue runs. With it, the cooldown is judged on its own
   * reference day (today while it runs, its start before, its deadline
   * after), and the queue's rows are those named by its key.
   */
  readonly period?: QueuePeriod | undefined;
  /** Today, for "posted 2 days ago". */
  readonly today: string;
  readonly posts: readonly PostLogEntry[];
  readonly assignments: readonly Assignment[];
  readonly properties: readonly Property[];
  readonly settings: Rules;
}

export interface AssignRules {
  readonly intern: string;
  /** The queue's week, as its Monday. */
  readonly week: string;
  /** @deprecated The same as `week`. */
  readonly date: string;
  /** The saved queue as a draft starts: Pending first, then Not Shared in sheet order, then Posted. */
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

const STATUS_ORDER: readonly AssignmentStatus[] = ['Pending', 'Not Shared', 'Posted'];

/**
 * The day a week's queue is judged on (the cooldown, "due for repost"): today
 * while the week is under way, its Monday before it starts, its Friday once it
 * is over.
 */
export function weekReferenceDay(week: string, today: string): string {
  const [monday, , , , friday] = weekDays(week) as [string, string, string, string, string];
  return today < monday ? monday : today > friday ? friday : today;
}

/** The week a planner or assign input names: `week`, else the week of `date`. Throws when neither is a day. */
export function inputWeek(input: { readonly week?: string | undefined; readonly date?: string | undefined }): string {
  const given = input.week ?? input.date;
  if (given === undefined || !isDate(given)) throw new Error(`Expected a week (its Monday, yyyy-MM-dd), got "${String(given)}".`);
  return weekOf(given);
}

/** What can go in one person's queue for one week, judged from the rows as read. */
export function assignRules(input: AssignInput): AssignRules {
  const { intern, today, posts, assignments, properties, settings, period } = input;
  const week = period ? period.key : inputWeek(input);
  mustDay(today);
  const date = period ? periodReferenceDay(period, today) : weekReferenceDay(week, today);
  const directory = directoryOf(properties);
  // Everyone else's queue running then, and this person's own queue, by its key.
  const others = holdersOf(rowsInWeek(assignments, week, date).filter((a) => !samePerson(a.assignedTo, intern)));
  const mine = rowsOf(intern, week, assignments);

  const saved: QueueEntry[] = [];
  const savedRows = new Map<string, Assignment>();
  for (const status of STATUS_ORDER) {
    for (const row of mine) {
      if (queueStatus(row.status) !== status) continue;
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
        reason: `Already in ${holderName(holder.assignedTo, intern)}'s queue${queueWords(holder)}.`,
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
        items.push({ propertyName: kept.propertyName, ...(id ? { propertyId: id } : {}), status: queueStatus(kept.status) });
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
      items.push({ propertyName: property.name, propertyId: property.id, status: 'Not Shared' });
    }
    return { ok: problems.length === 0, items, problems };
  }

  return {
    intern,
    week,
    date: week,
    saved,
    statusOf: (key) => {
      const row = savedRows.get(key);
      return row ? queueStatus(row.status) : undefined;
    },
    isStarted: (key) => {
      const row = savedRows.get(key);
      const status = row ? queueStatus(row.status) : undefined;
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

/**
 * A directory row: its Issues text when the list carries it, else only the
 * flag, and its posting document's id (the Directory's DocId column, CONTRACT
 * v7) when the server sends it.
 */
export type HealthSource = Pick<Property, 'id' | 'name' | 'docId'> & {
  readonly hasIssues?: boolean | undefined;
  readonly issues?: string | undefined;
};

/** A listing whose document or folder needs fixing (CONTRACT v7). */
export interface DocProblem {
  readonly id: string;
  readonly name: string;
  /** The posting document's id, when the directory has one. */
  readonly docId?: string;
  /** The listing's Drive folder, as a link. */
  readonly folder: string;
}

/** The kinds of doc health, in the order the Tracker lists them. */
export type DocIssue = 'noSeparator' | 'noDocument' | 'noPhotos' | 'emptyAbove' | 'unreadable';

export const DOC_ISSUES: readonly DocIssue[] = ['noSeparator', 'noDocument', 'noPhotos', 'emptyAbove', 'unreadable'];

/** Each kind's listings, by name. A listing with two problems is in both lists. */
export type DocHealth = Readonly<Record<DocIssue, readonly DocProblem[]>>;

/** A Drive folder's link. */
export function folderLink(id: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
}

/** A Google Doc's edit link. */
export function docLink(docId: string): string {
  return `https://docs.google.com/document/d/${encodeURIComponent(docId)}/edit`;
}

/**
 * One phrase of the Issues column, as BuildDirectory.gs writes it: "No
 * separator line — …", "No document", "No photos", "Document is empty above
 * the separator", "Could not read document: …", "Could not open folder: …".
 */
function docIssueOf(text: string): DocIssue | undefined {
  const t = text.toLowerCase();
  if (/\bno separator\b/.test(t)) return 'noSeparator';
  if (/^no (?:posting )?doc(?:ument)?\b/.test(t)) return 'noDocument';
  if (/^no photos?\b/.test(t)) return 'noPhotos';
  if (/\bempty above\b/.test(t)) return 'emptyAbove';
  if (/^could ?n[o']t (?:read|open)\b/.test(t)) return 'unreadable';
  return undefined;
}

/**
 * The directory's documents that need fixing, by kind (CONTRACT v7): pure,
 * from each row's Issues text. A row with no Issues text has nothing to fix.
 */
export function docHealth(properties: readonly HealthSource[]): DocHealth {
  const lists: Record<DocIssue, DocProblem[]> = { noSeparator: [], noDocument: [], noPhotos: [], emptyAbove: [], unreadable: [] };
  for (const p of properties) {
    const kinds = new Set<DocIssue>();
    for (const part of (p.issues ?? '').split(/\s*(?:·|\r?\n)\s*/)) {
      const kind = part.trim() ? docIssueOf(part.trim()) : undefined;
      if (kind) kinds.add(kind);
    }
    if (kinds.size === 0) continue;
    const docId = p.docId?.trim();
    const item: DocProblem = { id: p.id, name: p.name, ...(docId ? { docId } : {}), folder: folderLink(p.id) };
    for (const kind of kinds) lists[kind].push(item);
  }
  for (const kind of DOC_ISSUES) lists[kind].sort((a, b) => byName.compare(a.name, b.name));
  return lists;
}

/** How many listings have at least one problem: each counted once. */
export function docsToFix(health: DocHealth): number {
  const ids = new Set<string>();
  for (const kind of DOC_ISSUES) for (const item of health[kind]) ids.add(item.id);
  return ids.size;
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

/** One intern's day at a glance: their week's queue progress and posts still waiting for approval. */
export interface InternDay {
  readonly name: string;
  /** Items in their queue for the week the day is in. */
  readonly total: number;
  /** Of those, posted. */
  readonly posted: number;
  /** Their posts waiting for approval, whatever the date: as the tracker counts pending. */
  readonly pendingPosts: number;
}

/** Every active intern on the team, by name, with their queue's progress for the week `date` is in. */
export function internDays(
  team: readonly Pick<TeamMember, 'name' | 'role' | 'active'>[],
  assignments: readonly Assignment[],
  posts: readonly PostLogEntry[],
  date: string,
): InternDay[] {
  const day = rowsInWeek(assignments, weekOf(date), date);
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

/** A post still waiting for the group admin's approval, and for how long. */
export interface WaitingPost {
  readonly post: PostLogEntry;
  /** Whole days since it was logged, on Manila's calendar: 0 the same day. */
  readonly days: number;
}

/**
 * A person's posts still Pending, whatever their date, oldest first: the ones
 * to check on Facebook. A row whose date can't be read comes last, as 0 days.
 */
export function waitingPosts(posts: readonly PostLogEntry[], name: string, today: string): WaitingPost[] {
  const theirs = posts.filter((p) => p.status === 'Pending' && samePerson(p.postedBy, name));
  return newestFirst(theirs)
    .reverse()
    .map((post) => ({ post, days: isDate(post.date) ? Math.max(0, daysBetween(post.date, today)) : 0 }))
    .sort((a, b) => b.days - a.days);
}

/** Words for how long a post has waited: "today", "1 day", "3 days". */
export function waitedFor(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
}

/**
 * A person's latest Posted or Pending row, whatever its date: by date, then
 * time, then sheet order, as `newestFirst` orders them. Undefined when they
 * have logged nothing.
 */
export function lastPostBy(posts: readonly PostLogEntry[], name: string): PostLogEntry | undefined {
  const theirs = posts.filter(
    (p) => (p.status === 'Posted' || p.status === 'Pending') && dayOf(p.date) !== undefined && samePerson(p.postedBy, name),
  );
  return newestFirst(theirs)[0];
}

// ------------------------------------------------------------------ the week (v6)

/** How an intern's week is going (CONTRACT-v3, v6: Pace). */
export type Pace = 'done' | 'on-track' | 'behind' | 'not-started' | 'missed';

export interface WeekProgress {
  /** Items in their queue: what they are to post by its deadline. 0: no queue. */
  readonly target: number;
  /** Of those, live. */
  readonly posted: number;
  /** Posted in a group, waiting for its admin's approval. Counts toward the target. */
  readonly pending: number;
  /** Not posted yet. */
  readonly notShared: number;
  /** Not posted by the deadline: notShared once the queue is over, else 0. Never written as a status. */
  readonly missed: number;
  /** Working days of the queue after today: all of them before it starts, 0 once it is over (queues.queueDaysLeft). */
  readonly daysLeft: number;
  /** ceil(target × working days elapsed ÷ working days in the queue), today counted when it is a working day. */
  readonly expectedByToday: number;
  readonly pace: Pace;
  /** v14: the queue counted, when there is one: its start, deadline and length. */
  readonly period?: QueuePeriod | undefined;
}

/**
 * One intern's week (v6). The queue is their Assignments rows of `week`
 * (daily rows written before v6 included, by weekOf their date), counted by
 * status. A Not Shared row also counts as posted (or pending) when their own
 * post of that listing is dated in that week: the tracker's own row may lag.
 *
 * pace, the first that fits:
 * - done: posted + pending ≥ target (a queue of at least one);
 * - missed: the week is over with items left;
 * - not-started: nothing posted and it is past Monday;
 * - behind: posted + pending < expectedByToday;
 * - on-track: everything else, a week with no queue included (target 0).
 */
/** Behind for the deadline: what is left, the working days left (today included), and about how many a day that is. */
export interface FridayWarning {
  readonly left: number;
  readonly daysLeft: number;
  readonly perDay: number;
}

/** The working day of a queue a warning starts on: its third, so there is still time to catch up. */
export const WARN_FROM_WEEKDAY = 3;

/**
 * Warnings before the deadline: from the third working day of the queue
 * `progress` counts to its deadline, when someone is behind (or hasn't
 * started), what is left to post and how many a day that takes. Null on its
 * first two days, once it is over, with no queue, or when on track or done.
 * `week` is the week shown; the queue's own period is what counts.
 */
export function fridayWarning(progress: WeekProgress, week: string, today: string): FridayWarning | null {
  // A progress counted before v14 carries no period: the week's, Monday to Friday.
  const period = progress.period ?? { start: weekOf(week), due: weekFriday(weekOf(week)) };
  if (progress.target === 0 || isQueueOver(period, today)) return null;
  if (progress.pace !== 'behind' && progress.pace !== 'not-started') return null;
  const elapsed = queueDaysElapsed(period, today);
  if (elapsed < WARN_FROM_WEEKDAY) return null;
  const left = progress.target - progress.posted - progress.pending;
  if (left <= 0) return null;
  // Today counts: on the deadline itself there is 1 day to post in.
  const daysLeft = Math.max(1, workdaysBetween(today > period.start ? today : period.start, period.due));
  return { left, daysLeft, perDay: Math.ceil(left / daysLeft) };
}

/** The warning in words: "8 left, 2 days to go: about 4 a day." or, on Friday, "3 left: due today." */
export function fridayWarningWords(w: FridayWarning): string {
  if (w.daysLeft === 1) return `${w.left} left: due today.`;
  return `${w.left} left, ${w.daysLeft} days to go: about ${w.perDay} a day.`;
}

export function weekProgress(
  intern: string,
  week: string,
  assignments: readonly Assignment[],
  posts: readonly PostLogEntry[],
  today: string,
): WeekProgress {
  mustDay(today);
  // v14: the queue running that week, which may have started in an earlier one.
  return queueProgress(intern, queueInWeek(intern, weekOf(week), assignments, today), assignments, posts, today);
}

/**
 * One intern's queue (v14), as weekProgress counts a week's: its rows (those
 * named by its key), each Not Shared row also counting as posted (or pending)
 * when their own post of that listing is dated between its start and its
 * deadline. Paced on its working days. No period: no queue, on track.
 */
export function queueProgress(
  intern: string,
  period: QueuePeriod | undefined,
  assignments: readonly Assignment[],
  posts: readonly PostLogEntry[],
  today: string,
): WeekProgress {
  mustDay(today);
  if (!period) {
    return { target: 0, posted: 0, pending: 0, notShared: 0, missed: 0, daysLeft: 0, expectedByToday: 0, pace: 'on-track' };
  }
  const rows = rowsOf(intern, period.key, assignments);
  const theirs = posts.filter(
    (p) =>
      (p.status === 'Posted' || p.status === 'Pending') &&
      samePerson(p.postedBy, intern) &&
      isDate(p.date) &&
      p.date >= period.start &&
      p.date <= period.due,
  );

  let posted = 0;
  let pending = 0;
  let notShared = 0;
  for (const row of rows) {
    let status = queueStatus(row.status);
    if (status === 'Not Shared') {
      const post = lastPostOf(theirs, { id: row.propertyId.trim(), name: row.propertyName });
      if (post) status = post.status;
    }
    if (status === 'Posted') posted++;
    else if (status === 'Pending') pending++;
    else notShared++;
  }

  const target = rows.length;
  const over = isQueueOver(period, today);
  const total = workdaysBetween(period.start, period.due);
  const elapsed = queueDaysElapsed(period, today);
  const expectedByToday = total === 0 ? target : Math.ceil((target * elapsed) / total);
  const started = posted + pending;
  let pace: Pace;
  if (target > 0 && started >= target) pace = 'done';
  else if (over && notShared > 0) pace = 'missed';
  else if (target > 0 && started === 0 && today > period.start) pace = 'not-started';
  else if (started < expectedByToday) pace = 'behind';
  else pace = 'on-track';

  return {
    target,
    posted,
    pending,
    notShared,
    missed: over ? notShared : 0,
    daysLeft: total - elapsed,
    expectedByToday,
    pace,
    period,
  };
}

/** " (due Thu 19 Nov)" for a held listing, when its deadline is known; else "". */
function queueWords(holder: Pick<Assignment, 'date' | 'week' | 'due'>): string {
  const period = assignmentPeriod(holder);
  return period ? ` (due ${shortDate(period.due)})` : '';
}

/** "6–19 Nov · due Thu 19 Nov": a queue's period, in words. */
export function periodWords(period: QueuePeriod): string {
  return `${periodLabel(period)} · due ${shortDate(period.due)}`;
}

/**
 * The intern's posts (Posted and Pending) on each weekday of `week`, Monday
 * to Friday: five counts. A weekend post belongs to no weekday and is left out.
 */
export function weekPostsByDay(intern: string, week: string, posts: readonly PostLogEntry[]): number[] {
  const days = weekDays(week);
  const counts = days.map(() => 0);
  for (const p of posts) {
    if (p.status !== 'Posted' && p.status !== 'Pending') continue;
    if (!samePerson(p.postedBy, intern)) continue;
    const i = days.indexOf(p.date);
    if (i !== -1) counts[i]!++;
  }
  return counts;
}

/** One row of the weekly monitor. */
export interface TeamWeekRow extends WeekProgress {
  readonly name: string;
  /** Their posts on Monday … Friday (weekPostsByDay). */
  readonly byDay: readonly number[];
}

const PACE_ORDER: readonly Pace[] = ['missed', 'not-started', 'behind', 'on-track', 'done'];

/**
 * The weekly monitor: weekProgress for every intern named, worst first —
 * missed, not started, behind, on track, done — then the furthest behind
 * (expectedByToday less posted and pending), then by name. A blank name, or
 * one already listed (any case), is left out.
 */
export function teamWeek(
  interns: readonly string[],
  week: string,
  assignments: readonly Assignment[],
  posts: readonly PostLogEntry[],
  today: string,
): TeamWeekRow[] {
  const names: string[] = [];
  for (const name of interns) if (name.trim() && !names.some((n) => samePerson(n, name))) names.push(name);
  const short = (r: WeekProgress): number => r.expectedByToday - r.posted - r.pending;
  return names
    .map((name): TeamWeekRow => ({
      name,
      ...weekProgress(name, week, assignments, posts, today),
      byDay: weekPostsByDay(name, week, posts),
    }))
    .sort(
      (a, b) =>
        PACE_ORDER.indexOf(a.pace) - PACE_ORDER.indexOf(b.pace) || short(b) - short(a) || byName.compare(a.name, b.name),
    );
}
