/**
 * The reminder to post: what a Windows notification says to someone with
 * listings left in a queue that is running, at most once a day. Pure: the
 * caller says what day and hour it is, and whether they posted today.
 */

import { addWorkdays, isWorkday, type QueuePeriod } from './queues';

/** The hours of the day (Manila) the reminder may be set to start from. 0: never. */
export const POST_REMINDER_HOURS: readonly number[] = Object.freeze([0, 10, 13, 15]);
/** From 10 in the morning, unless this PC says otherwise. */
export const DEFAULT_POST_REMINDER_HOUR = 10;

/** 0 (off) or one of POST_REMINDER_HOURS; anything else is the default. */
export function postReminderHourOf(value: unknown): number {
  return typeof value === 'number' && POST_REMINDER_HOURS.includes(value) ? value : DEFAULT_POST_REMINDER_HOUR;
}

export interface PostReminderInput {
  /** Their queue now (queues.currentQueue); undefined: none. */
  readonly period: Pick<QueuePeriod, 'start' | 'due'> | undefined;
  /** Listings of it not shared yet. */
  readonly left: number;
  /** Their posts dated today, Posted or Pending. */
  readonly postedToday: number;
  /** yyyy-MM-dd */
  readonly today: string;
  /** The hour now, 0 to 23, on the tracker's clock. */
  readonly hour: number;
  /** The hour the reminder starts from; 0: never. */
  readonly fromHour: number;
  /** The deadline in words: "Fri 27 Nov". */
  readonly dueWords: string;
}

export interface PostReminder {
  readonly title: string;
  readonly body: string;
}

/**
 * What to say now, or null for nothing. On a working day of a running queue
 * with listings left, from the hour set: the deadline when it is today or the
 * next working day (whether or not they posted today), else that nothing has
 * been posted today.
 */
export function postReminder({ period, left, postedToday, today, hour, fromHour, dueWords }: PostReminderInput): PostReminder | null {
  if (fromHour <= 0 || hour < fromHour || !period || left <= 0) return null;
  if (today < period.start || today > period.due || !isWorkday(today)) return null;
  const listings = left === 1 ? '1 listing' : `${left} listings`;
  if (period.due === today) {
    return { title: 'Your queue is due today', body: `${listings} left to post. Open My queue for the next one.` };
  }
  if (period.due === addWorkdays(today, 1)) {
    return { title: `Your queue is due ${dueWords}`, body: `${listings} left, and one working day after today. Open My queue for the next one.` };
  }
  if (postedToday > 0) return null;
  return { title: "You haven't posted today", body: `${listings} left in your queue, due ${dueWords}. Open My queue for the next one.` };
}
