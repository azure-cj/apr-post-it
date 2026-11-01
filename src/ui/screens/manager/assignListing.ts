/**
 * What the Assign screen says about one listing for one intern's queue for one
 * week: free to add, or why not, in a few words. Built from core/summary's
 * rules (cooldown, someone else's queue that week) and its held rule (a Not
 * Shared row holds the listing for its assignee until its week is over).
 */

import { categoryKind, type CategoryKind } from '../../components';
import {
  ago,
  daysBetween,
  heldBy,
  holderName,
  postingProblem,
  type AssignCheck,
  type AssignRules,
  type DirectoryRow,
  type HeldListing,
} from '@/core/summary';
import { normalize } from '@/core/matcher';
import { weekLabel, weekOf } from '@/core/week';
import type { PostLogEntry } from '@/core/types';

export type UnavailableKind = 'sold' | 'noSeparator' | 'noDocument' | 'held' | 'mine' | 'cooldown' | 'otherQueue';

export interface ListingState {
  readonly property: DirectoryRow;
  readonly kind: CategoryKind;
  /** Why it can't go in this queue, in a few words. Missing: it can. */
  readonly unavailable?: { readonly kind: UnavailableKind; readonly reason: string } | undefined;
  readonly lastPost?: PostLogEntry | undefined;
  /** Never posted. */
  readonly fresh: boolean;
  /** Posted before, and not for repostDueDays by the week's reference day. */
  readonly due: boolean;
}

/** "28 Oct": a day in this year's terms, without the weekday. */
export function dayMonth(date: string): string {
  const [, m, d] = /^\d{4}-(\d{2})-(\d{2})$/.exec(date) ?? [];
  if (!m || !d) return date;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d)} ${months[Number(m) - 1] ?? ''}`;
}

/** The week a held listing (or a refusal) names, as its Monday. */
function weekOfHold(hold: Pick<HeldListing, 'date'> & { readonly week?: string | undefined }): string {
  if (hold.week) return hold.week;
  return /^\d{4}-\d{2}-\d{2}$/.test(hold.date) ? weekOf(hold.date) : '';
}

/** Why a held listing can't be added, for whoever is looking: "With Mika, 2–6 Nov". */
export function heldWords(
  hold: Pick<HeldListing, 'heldBy' | 'date'> & { readonly week?: string | undefined },
  intern: string,
): string {
  const week = weekOfHold(hold);
  const when = week ? `, ${weekLabel(week)}` : '';
  if (hold.heldBy.trim().toLowerCase() !== intern.trim().toLowerCase()) {
    return `With ${holderName(hold.heldBy, intern)}${when}`;
  }
  return `Queued${when}`;
}

export interface StateInput {
  readonly rules: AssignRules;
  readonly held: ReadonlyMap<string, HeldListing>;
  readonly intern: string;
  /** The queue's week, as its Monday. */
  readonly week: string;
  readonly today: string;
}

/** One listing's state, by the rules in the order they're checked. */
export function listingState(property: DirectoryRow, { rules, held, intern, week, today }: StateInput): ListingState {
  const check: AssignCheck = rules.check(property);
  const lastPost = check.lastPost;
  const base = {
    property,
    kind: categoryKind(property.category),
    ...(lastPost ? { lastPost } : {}),
    fresh: !lastPost,
    due: Boolean(lastPost) && check.due,
  };
  const no = (kind: UnavailableKind, reason: string): ListingState => ({ ...base, unavailable: { kind, reason } });

  if (property.availability === 'Sold') return no('sold', 'Sold');
  const problem = postingProblem(property);
  if (problem === 'noSeparator') return no('noSeparator', 'No separator');
  if (problem === 'noDocument') return no('noDocument', 'No document');
  const hold = heldBy(held, property);
  const mine = hold ? hold.heldBy.trim().toLowerCase() === intern.trim().toLowerCase() : false;
  if (hold && !(mine && weekOfHold(hold) === week)) {
    return no(mine ? 'mine' : 'held', heldWords(hold, intern));
  }
  if (check.block === 'cooldown' && lastPost) {
    return no('cooldown', `Posted ${ago(Math.max(0, daysBetween(lastPost.date, today)))}`);
  }
  if (check.block === 'otherQueue' && check.holder) {
    return no('otherQueue', `In ${holderName(check.holder, intern)}'s queue`);
  }
  return base;
}

/** Never posted first, then the longest since posted, then by name: the planner's order. */
export function byPriority(a: ListingState, b: ListingState): number {
  const la = a.lastPost?.date;
  const lb = b.lastPost?.date;
  if (la !== lb) {
    if (la === undefined) return -1;
    if (lb === undefined) return 1;
    return la < lb ? -1 : 1;
  }
  // As the planner breaks ties: by the normalised name, then as written, so the top of the list is what quick fill takes.
  const na = normalize(a.property.name);
  const nb = normalize(b.property.name);
  if (na !== nb) return na < nb ? -1 : 1;
  return a.property.name < b.property.name ? -1 : a.property.name > b.property.name ? 1 : 0;
}

/** "Never posted", "Posted today", "Posted 12 days ago". */
export function lastPostedWords(state: ListingState, today: string): string {
  if (!state.lastPost) return 'Never posted';
  return `Posted ${ago(Math.max(0, daysBetween(state.lastPost.date, today)))}`;
}

/** "Makati · 240 sqm", when the checker's index says. */
export function placeWords(property: DirectoryRow): string {
  const parts: string[] = [];
  if (property.city?.trim()) parts.push(property.city.trim());
  const size = property.size;
  if (size !== undefined && String(size).trim() !== '') {
    const text = String(size).trim();
    parts.push(/sqm|m²/i.test(text) ? text : `${text} sqm`);
  }
  return parts.join(' · ');
}
