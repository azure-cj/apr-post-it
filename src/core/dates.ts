/**
 * Calendar days as "yyyy-MM-dd" on the tracker's calendar (Manila's, CONFIG.TZ).
 * Whole days counted with Date.UTC, so no clock and no time zone but the one
 * the text was written in is involved. Pure.
 *
 * summary.ts re-exports isDate, addDays and daysBetween; week.ts builds the
 * work week on these.
 */

export const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Whole days since 1970 in UTC, or undefined when `date` is not a real yyyy-MM-dd day. */
export function dayOf(date: string): number | undefined {
  const m = ISO_DATE.exec(date);
  if (!m) return undefined;
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
  // Date.UTC rolls 2026-02-30 into March and reads years below 100 as 19xx.
  return isoOf(day) === date ? day : undefined;
}

/** dayOf, or an Error naming the bad value. */
export function mustDay(date: string): number {
  const day = dayOf(date);
  if (day === undefined) throw new Error(`Expected a yyyy-MM-dd date, got "${date}".`);
  return day;
}

/** The yyyy-MM-dd of a day number. */
export function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
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

/** 0 Sunday … 6 Saturday, for a day number. */
export function weekdayOfDay(day: number): number {
  return new Date(day * DAY_MS).getUTCDay();
}
