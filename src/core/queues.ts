/**
 * Queue periods (CONTRACT-v3, v14): working days, and a deadline per queue.
 *
 * A queue runs on working days, Monday to Friday, from its start day for 1, 2
 * or 3 weeks of them: 5, 10 or 15 working days, the start day counted. Saved
 * on a Friday for 2 weeks, it runs that Friday, the whole next week, and
 * Monday to Thursday of the one after: due that Thursday. Saved at the
 * weekend, it starts on Monday.
 *
 * Its Assignments rows hold the start day in Date and the deadline in Due.
 * A queue is still named by the week its start is in (its "key": weekOf the
 * start), so a person has at most one queue per week key, and one queue at a
 * time: a new one starts after the last one's deadline. A row with no Due
 * (written before v14) is a one-week queue: its week, due that Friday.
 * Code.gs's queue rules are the same. Pure: the caller says what day it is.
 */

import { addDays, isDate, isoOf, mustDay, MONTHS, weekdayOfDay } from './dates';
import type { Assignment } from './types';
import { assignmentWeek, weekFriday, weekOf } from './week';

/** The lengths a queue may have, in weeks of working days. */
export const QUEUE_WEEK_CHOICES: readonly number[] = Object.freeze([1, 2, 3]);
/** A queue's length when the rules don't say: the server's default too. */
export const DEFAULT_QUEUE_WEEKS = 2;

const MIN_WEEKS = 1;
const MAX_WEEKS = 3;

/** An Assignments row as far as its queue goes. */
export type QueueRow = Pick<Assignment, 'date'> & { readonly week?: string | undefined; readonly due?: string | undefined };

// ------------------------------------------------------------------ working days

/** Monday to Friday. Throws on anything but a real yyyy-MM-dd day. */
export function isWorkday(date: string): boolean {
  const weekday = weekdayOfDay(mustDay(date));
  return weekday !== 0 && weekday !== 6;
}

/** `date` when it is a working day, else the Monday after. */
export function firstWorkday(date: string): string {
  const day = mustDay(date);
  const weekday = weekdayOfDay(day);
  if (weekday === 6) return isoOf(day + 2);
  if (weekday === 0) return isoOf(day + 1);
  return date;
}

/** The working day `n` working days after `date` (n ≥ 0); from a weekend, counted from the Monday after. */
export function addWorkdays(date: string, n: number): string {
  let day = mustDay(firstWorkday(date));
  let left = Math.max(0, Math.trunc(n));
  day += 7 * Math.floor(left / 5);
  left %= 5;
  while (left > 0) {
    day++;
    const weekday = weekdayOfDay(day);
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return isoOf(day);
}

/** Working days from `from` to `to`, both counted: 0 when `to` is before `from`. */
export function workdaysBetween(from: string, to: string): number {
  const a = mustDay(from);
  const b = mustDay(to);
  if (b < a) return 0;
  const weeks = Math.floor((b - a + 1) / 7);
  let count = 5 * weeks;
  for (let d = a + 7 * weeks; d <= b; d++) {
    const weekday = weekdayOfDay(d);
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

// ------------------------------------------------------------------ a queue's period

/** A queue length, 1 to 3 weeks: anything else is DEFAULT_QUEUE_WEEKS, or rounded into range. */
export function queueWeeksOf(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_QUEUE_WEEKS;
  return Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, n));
}

/** The deadline of a queue starting on `start` (a weekend counts from Monday) that runs `weeks` weeks of working days. */
export function queueDue(start: string, weeks: number): string {
  return addWorkdays(firstWorkday(start), 5 * queueWeeksOf(weeks) - 1);
}

/** One person's queue: when it starts, when it is due, and the week it is named by. */
export interface QueuePeriod {
  /** The week of its start, as its Monday: what saveQueue and the rows' `week` name it by. */
  readonly key: string;
  /** Its first working day. */
  readonly start: string;
  /** Its deadline: the last working day it runs. */
  readonly due: string;
  /** Its length in weeks of working days, 1 to 3. */
  readonly weeks: number;
}

/** A queue starting on `start` (a weekend: the Monday after) that runs `weeks` weeks. */
export function periodFrom(start: string, weeks: number): QueuePeriod {
  const first = firstWorkday(start);
  const w = queueWeeksOf(weeks);
  return { key: weekOf(first), start: first, due: queueDue(first, w), weeks: w };
}

/** The same queue with another length: its start kept, its deadline moved. */
export function withWeeks(period: QueuePeriod, weeks: number): QueuePeriod {
  return periodFrom(period.start, weeks);
}

/** "6–19 Nov"; across months "30 Oct – 12 Nov"; a single day "6 Nov". */
export function periodLabel(period: Pick<QueuePeriod, 'start' | 'due'>): string {
  const a = new Date(mustDay(period.start) * 86_400_000);
  const b = new Date(mustDay(period.due) * 86_400_000);
  const m1 = MONTHS[a.getUTCMonth()] ?? '';
  const m2 = MONTHS[b.getUTCMonth()] ?? '';
  if (period.start === period.due) return `${a.getUTCDate()} ${m1}`;
  if (m1 === m2 && a.getUTCFullYear() === b.getUTCFullYear()) return `${a.getUTCDate()}–${b.getUTCDate()} ${m2}`;
  return `${a.getUTCDate()} ${m1} – ${b.getUTCDate()} ${m2}`;
}

/** "1 week", "2 weeks". */
export function weeksLabel(weeks: number): string {
  return weeks === 1 ? '1 week' : `${weeks} weeks`;
}

/** A length in weeks from a start to a deadline: whole weeks of working days, 1 to 3. */
function weeksBetween(start: string, due: string): number {
  return queueWeeksOf(workdaysBetween(start, due) / 5);
}

/**
 * The queue an Assignments row belongs to. With a Due (v14) after its Date,
 * the Date is the start and Due the deadline; without one, its week, Monday
 * to Friday. Undefined when the date can't be read.
 */
export function assignmentPeriod(row: QueueRow): QueuePeriod | undefined {
  const key = assignmentWeek(row);
  if (!key) return undefined;
  const due = (row.due ?? '').trim();
  const date = row.date.trim();
  if (isDate(due) && isDate(date)) {
    const start = firstWorkday(date);
    if (due >= start) return { key: weekOf(start), start, due, weeks: weeksBetween(start, due) };
  }
  return { key, start: key, due: weekFriday(key), weeks: 1 };
}

/** True once `today` is past the queue's deadline: its open rows are Missed and hold nothing. */
export function isQueueOver(period: Pick<QueuePeriod, 'due'>, today: string): boolean {
  return mustDay(today) > mustDay(period.due);
}

/** True once an Assignments row's queue is over on `today`. A row in no queue counts as over. */
export function isRowOver(row: QueueRow, today: string): boolean {
  const period = assignmentPeriod(row);
  return !period || isQueueOver(period, today);
}

/** Working days of the queue gone by `today`, today counted: 0 before it starts, all of them once it is over. */
export function queueDaysElapsed(period: Pick<QueuePeriod, 'start' | 'due'>, today: string): number {
  return Math.min(workdaysBetween(period.start, period.due), workdaysBetween(period.start, today));
}

/** Working days of the queue left to post in, today included: all of them before it starts, 0 once it is over. */
export function queueDaysLeft(period: Pick<QueuePeriod, 'start' | 'due'>, today: string): number {
  return workdaysBetween(period.start, period.due) - queueDaysElapsed(period, today);
}

/** The day a queue is judged on (the cooldown, "due for repost"): today while it runs, its start before, its deadline after. */
export function periodReferenceDay(period: Pick<QueuePeriod, 'start' | 'due'>, today: string): string {
  return today < period.start ? period.start : today > period.due ? period.due : today;
}

// ------------------------------------------------------------------ a person's queues

const samePersonAs = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Someone's saved queues, earliest first: one per week key. Its rows are
 * written together and agree; if they don't, the latest deadline stands.
 * Names are compared as summary.samePerson compares them.
 */
export function queuesOf(person: string, assignments: readonly Assignment[]): QueuePeriod[] {
  const byKey = new Map<string, QueuePeriod>();
  for (const row of assignments) {
    if (!samePersonAs(row.assignedTo, person)) continue;
    const period = assignmentPeriod(row);
    if (!period) continue;
    const had = byKey.get(period.key);
    if (!had) byKey.set(period.key, period);
    else if (period.due > had.due) byKey.set(period.key, { ...had, due: period.due, weeks: weeksBetween(had.start, period.due) });
  }
  return [...byKey.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** The rows of one saved queue: the person's rows named by its key. */
export function rowsOf<T extends Assignment>(person: string, key: string, assignments: readonly T[]): T[] {
  return assignments.filter((a) => samePersonAs(a.assignedTo, person) && assignmentPeriod(a)?.key === key);
}

/**
 * Someone's saved queue for `week` (any day of it), on `today`: of their
 * queues that run in that week, the one running on its reference day (today
 * inside the week, its Monday before, its Friday after), else the latest to
 * start. Undefined when none runs in that week.
 */
export function queueInWeek(
  person: string,
  week: string,
  assignments: readonly Assignment[],
  today: string,
): QueuePeriod | undefined {
  const monday = weekOf(week);
  const friday = weekFriday(monday);
  const ref = today < monday ? monday : today > friday ? friday : today;
  const running = queuesOf(person, assignments).filter((q) => q.start <= friday && q.due >= monday);
  return running.find((q) => q.start <= ref && ref <= q.due) ?? running[running.length - 1];
}

/**
 * Everyone's rows of the queue they have running in `week` (queueInWeek's
 * choice, on `today`), in sheet order: what a week's numbers count.
 */
export function rowsInWeek<T extends Assignment>(assignments: readonly T[], week: string, today: string): T[] {
  const monday = weekOf(week);
  const friday = weekFriday(monday);
  const ref = today < monday ? monday : today > friday ? friday : today;
  // Each person's queues, by key, in one pass.
  const people = new Map<string, Map<string, QueuePeriod>>();
  const periodOf = new Map<T, QueuePeriod>();
  for (const row of assignments) {
    const period = assignmentPeriod(row);
    if (!period) continue;
    periodOf.set(row, period);
    const who = row.assignedTo.trim().toLowerCase();
    let mine = people.get(who);
    if (!mine) people.set(who, (mine = new Map()));
    const had = mine.get(period.key);
    if (!had || period.due > had.due) mine.set(period.key, had ? { ...had, due: period.due } : period);
  }
  const chosen = new Map<string, string>();
  for (const [who, byKey] of people) {
    const running = [...byKey.values()]
      .filter((q) => q.start <= friday && q.due >= monday)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const pick = running.find((q) => q.start <= ref && ref <= q.due) ?? running[running.length - 1];
    if (pick) chosen.set(who, pick.key);
  }
  return assignments.filter((row) => {
    const key = chosen.get(row.assignedTo.trim().toLowerCase());
    return key !== undefined && periodOf.get(row)?.key === key;
  });
}

/**
 * Someone's queue now: the one running today (between its start and its
 * deadline, a weekend inside it included), else the next to start. Undefined
 * when there is neither.
 */
export function currentQueue(person: string, assignments: readonly Assignment[], today: string): QueuePeriod | undefined {
  const queues = queuesOf(person, assignments);
  return queues.find((q) => q.start <= today && today <= q.due) ?? queues.find((q) => q.start > today);
}

/** The first working day on or after `from` that none of `queues` covers: where a new queue may start. */
export function freeStart(queues: readonly QueuePeriod[], from: string): string {
  let start = firstWorkday(from);
  for (const q of queues) {
    if (q.start <= start && start <= q.due) start = addWorkdays(q.due, 1);
  }
  return start;
}

/** True when `period` shares a working day with one of `queues` other than the one with its key. */
export function overlapsAnother(period: QueuePeriod, queues: readonly QueuePeriod[]): boolean {
  return queues.some((q) => q.key !== period.key && q.start <= period.due && period.start <= q.due);
}

/** What Assign shows for a person and a week: a saved queue, a new one, or none (a week gone by). */
export interface QueueChoice {
  readonly period: QueuePeriod;
  /** Rows are saved for it. False: a new queue, or (with `past`) none. */
  readonly saved: boolean;
  /** A week gone by with no queue in it: nothing to show or save. */
  readonly past: boolean;
  /** The saved queue before it, by key. Undefined when there is none. */
  readonly prev: string | undefined;
  /** The queue after it, by key: a saved one, or where a new one would start. Undefined after a new one. */
  readonly next: string | undefined;
  /** The day before the next saved queue starts: the latest this one's deadline may be. Undefined: no limit. */
  readonly latestDue: string | undefined;
}

/**
 * Which queue Assign shows for `person` and `week` (a week key, from the
 * link), one queue at a time:
 * 1. their saved queue named by that week;
 * 2. a new queue, when the first free working day from today (or from that
 *    week's Monday, when it is ahead) is in that week;
 * 3. their saved queue running in that week (queueInWeek);
 * 4. a new queue from that first free day, for this week or one ahead;
 * 5. a week gone by with none: nothing.
 * A new queue runs `weeks` weeks (the default length).
 */
export function chooseQueue(
  person: string,
  week: string,
  assignments: readonly Assignment[],
  today: string,
  weeks: number,
): QueueChoice {
  const key = weekOf(week);
  const current = weekOf(today);
  const queues = queuesOf(person, assignments);
  const before = (day: string) => [...queues].reverse().find((q) => q.start < day);
  const after = (day: string) => queues.find((q) => q.start > day);
  const newStart = (from: string) => freeStart(queues, from > today ? from : today);

  const fresh = (start: string): QueueChoice => {
    const next = after(start);
    return {
      period: periodFrom(start, weeks),
      saved: false,
      past: false,
      prev: before(start)?.key,
      next: next?.key,
      latestDue: next ? addDays(next.start, -1) : undefined,
    };
  };
  const savedChoice = (q: QueuePeriod): QueueChoice => {
    const next = after(q.start);
    return {
      period: q,
      saved: true,
      past: false,
      prev: before(q.start)?.key,
      next: next ? next.key : weekOf(newStart(addWorkdays(q.due, 1))),
      latestDue: next ? addDays(next.start, -1) : undefined,
    };
  };

  const exact = queues.find((q) => q.key === key);
  if (exact) return savedChoice(exact);
  const start = newStart(key > current ? key : today);
  if (weekOf(start) === key) return fresh(start);
  const running = queueInWeek(person, key, assignments, today);
  if (running) return savedChoice(running);
  if (key >= current) return fresh(start);
  const next = after(key);
  return {
    period: { key, start: key, due: weekFriday(key), weeks: 1 },
    saved: false,
    past: true,
    prev: before(key)?.key,
    next: next ? next.key : weekOf(newStart(today)),
    latestDue: undefined,
  };
}
