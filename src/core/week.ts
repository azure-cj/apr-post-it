/**
 * The work week (CONTRACT-v3, v6): Monday to Friday, and Friday is the
 * deadline. A week is named by its Monday, yyyy-MM-dd on Manila's calendar:
 * the "week key" an Assignments row's Date holds.
 *
 * Saturday and Sunday belong to the NEXT week: the reset happens after
 * Friday, so weekend time counts toward the coming week. Code.gs's weekOf_
 * follows the same rule. Pure: the caller says what day it is.
 */

import { addDays, dayOf, isDate, mustDay, MONTHS, weekdayOfDay, isoOf } from './dates';
import type { Assignment } from './types';

/**
 * The week a day belongs to, as its Monday: Monday–Friday give that week's
 * Monday, Saturday and Sunday the next Monday. Throws on anything but a real
 * yyyy-MM-dd day.
 */
export function weekOf(date: string): string {
  const day = mustDay(date);
  const weekday = weekdayOfDay(day); // 0 Sun … 6 Sat
  if (weekday === 0) return isoOf(day + 1);
  if (weekday === 6) return isoOf(day + 2);
  return isoOf(day - (weekday - 1));
}

/** A real yyyy-MM-dd day that is a Monday: a week key as written. */
export function isWeekKey(value: string): boolean {
  const day = dayOf(value);
  return day !== undefined && weekdayOfDay(day) === 1;
}

/** Monday to Friday of `week` (any day of it is read through weekOf). */
export function weekDays(week: string): string[] {
  const monday = weekOf(week);
  return [0, 1, 2, 3, 4].map((n) => addDays(monday, n));
}

/** The week's Friday: its deadline. */
export function weekFriday(week: string): string {
  return addDays(weekOf(week), 4);
}

/** True once `today` is after the week's Friday: the reset has happened. */
export function isWeekOver(week: string, today: string): boolean {
  return mustDay(today) > mustDay(weekFriday(week));
}

/** The week `n` weeks after `week` (before, when negative), as its Monday. */
export function addWeeks(week: string, n: number): string {
  return addDays(weekOf(week), 7 * Math.trunc(n));
}

/**
 * "2–6 Nov"; across months "30 Oct – 3 Nov" (and across years, "29 Dec – 2 Jan").
 * English whatever the PC's regional settings.
 */
export function weekLabel(week: string): string {
  const mon = new Date(mustDay(weekOf(week)) * 86_400_000);
  const fri = new Date(mustDay(weekFriday(week)) * 86_400_000);
  const m1 = MONTHS[mon.getUTCMonth()] ?? '';
  const m2 = MONTHS[fri.getUTCMonth()] ?? '';
  if (m1 === m2) return `${mon.getUTCDate()}–${fri.getUTCDate()} ${m2}`;
  return `${mon.getUTCDate()} ${m1} – ${fri.getUTCDate()} ${m2}`;
}

/**
 * Weekdays of the week up to `today`, today included when it is one of them:
 * 0 before the week starts (its weekend included), 5 once Friday has come.
 */
export function weekdaysElapsed(week: string, today: string): number {
  const monday = mustDay(weekOf(week));
  const t = mustDay(today);
  return Math.max(0, Math.min(5, t - monday + 1));
}

/** Weekdays of the week left to post in, today included: 5 before it starts, 0 once it is over. */
export function weekdaysLeft(week: string, today: string): number {
  return 5 - weekdaysElapsed(week, today);
}

/**
 * The week an Assignments row belongs to: its `week` when it carries a real
 * Monday (tracker.assignments() always sets it), else weekOf its date, so a
 * daily row written before v6 still reads as its week. '' when neither can
 * be read.
 */
export function assignmentWeek(row: Pick<Assignment, 'date'> & { readonly week?: string | undefined }): string {
  const week = (row.week ?? '').trim();
  if (isWeekKey(week)) return week;
  const date = row.date.trim();
  return isDate(date) ? weekOf(date) : '';
}
