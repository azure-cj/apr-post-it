/**
 * What the startup screen says, worked out from the data. Pure: no React.
 */

import { addDays, firstName, samePerson } from '@/core/summary';
import { canManage, queueStatus, type Assignment, type PostLogEntry, type User } from '@/core/types';
import { manilaDate } from '../state/clock';

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Good morning, Maria", by the clock in Manila: morning to noon, afternoon to six, evening after. */
export function greetingFor(ms: number, name: string): string {
  const hour = new Date(ms + MANILA_OFFSET_MS).getUTCHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const first = firstName(name);
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}

/** "Sunday, 1 November": the day in Manila. */
export function longDay(ms: number): string {
  const d = new Date(ms + MANILA_OFFSET_MS);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const NUMBER = new Intl.NumberFormat('en-US');

/** "1,474". */
export function count(n: number): string {
  return NUMBER.format(n);
}

/** One small card: a number (null while it is not known) and what it counts. */
export interface StartupStat {
  readonly label: string;
  readonly value: number | null;
}

export interface StatsInput {
  readonly user: User | null;
  /** The listings, or null before any list. */
  readonly listings: number | null;
  readonly posts: readonly PostLogEntry[] | null;
  readonly assignments: readonly Assignment[] | null;
  /** Epoch ms: "today" and "yesterday" are Manila's. */
  readonly now: number;
}

/**
 * The cards: for an admin, the listings, everyone's posts yesterday, and
 * everyone's pending; for an intern, what is left in their queue today, and
 * their own posts yesterday and pending; with nobody signed in, only the
 * listings, and nothing at all when there is no list to count.
 */
export function startupStats({ user, listings, posts, assignments, now }: StatsInput): StartupStat[] {
  if (!user) return listings === null ? [] : [{ label: 'listings', value: listings }];
  const today = manilaDate(now);
  const yesterday = addDays(today, -1);
  const mine = (who: string) => canManage(user) || samePerson(who, user.name);
  const ownPosts = posts?.filter((p) => mine(p.postedBy)) ?? null;
  const postedYesterday = ownPosts ? ownPosts.filter((p) => p.date === yesterday && p.status === 'Posted').length : null;
  const pending = ownPosts ? ownPosts.filter((p) => p.status === 'Pending').length : null;
  if (canManage(user)) {
    return [
      { label: 'listings', value: listings },
      { label: 'posted yesterday', value: postedYesterday },
      { label: 'pending', value: pending },
    ];
  }
  const queue = assignments
    ? assignments.filter((a) => a.date === today && samePerson(a.assignedTo, user.name) && queueStatus(a.status) !== 'Posted').length
    : null;
  return [
    { label: 'in your queue today', value: queue },
    { label: 'posted yesterday', value: postedYesterday },
    { label: 'pending', value: pending },
  ];
}
