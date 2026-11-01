/**
 * What Find says about each listing, and how it narrows and orders them: the
 * one status pill (Ready, In cooldown until …, Sold, No separator, No
 * document), who has it (In your queue, With Jan), the deal (sale, lease),
 * and the orders Best match, Name, Newest and Last posted. Pure: the screen
 * passes the list, the posts and queues it may see, and the day.
 */

import { cooldown } from '@/core/cooldown';
import { normalizeForSearch } from '@/core/directory';
import { normalize } from '@/core/matcher';
import { ago, daysBetween, firstName, heldBy, heldListings, lastPostOf, postingProblem, samePerson } from '@/core/summary';
import type { Assignment, PostLogEntry, Property, Settings } from '@/core/types';
import { assignmentWeek, weekOf } from '@/core/week';
import { categoryKind, type CategoryKind, type Tone } from '../../components';
import type { FindFilters, FindSort } from '../../state';
import { dayMonth, shortDate } from './format';

export type FindStatusKind = 'ready' | 'cooldown' | 'sold' | 'noSeparator' | 'noDocument';

export interface FindStatus {
  readonly kind: FindStatusKind;
  /** The pill's words. */
  readonly text: string;
  readonly tone: Tone;
}

export interface Deal {
  readonly sale: boolean;
  readonly lease: boolean;
}

export interface ListingFacts {
  readonly property: Property;
  readonly kind: CategoryKind;
  readonly deal: Deal;
  readonly status: FindStatus;
  /** False while the posts aren't read yet: a "Ready" then would be a guess, so it isn't shown. */
  readonly known: boolean;
  /** The newest Posted or Pending post's day, as far as this person can see. */
  readonly lastPosted?: string | undefined;
  /** "In your queue", "With Jan", "With you". */
  readonly holder?: string | undefined;
  /** The name as search compares it, for Best match. */
  readonly searchName: string;
}

export interface FactsInput {
  readonly posts: readonly PostLogEntry[] | null;
  readonly assignments: readonly Assignment[] | null;
  readonly rules: Pick<Settings, 'cooldownDays'>;
  readonly today: string;
  /** Who is looking, and whether they see everyone's queues (an admin) or only their own. */
  readonly viewer: { readonly name: string; readonly manager: boolean };
}

/** "For sale", "For lease", from the checker's Deal type, else the folder's listing type. */
export function dealOf(property: Pick<Property, 'dealType' | 'listingType'>): Deal {
  const read = (text: string): Deal => ({ sale: /\bsale\b/i.test(text), lease: /\b(lease|rent)/i.test(text) });
  const fromChecker = read(property.dealType ?? '');
  if (fromChecker.sale || fromChecker.lease) return fromChecker;
  return read(property.listingType);
}

export function dealWords(deal: Deal): string {
  if (deal.sale && deal.lease) return 'For sale or lease';
  if (deal.sale) return 'For sale';
  if (deal.lease) return 'For lease';
  return '';
}

const keyOfRow = (row: Pick<Assignment, 'propertyId' | 'propertyName'>): string =>
  row.propertyId.trim() ? `id:${row.propertyId.trim()}` : `name:${normalize(row.propertyName)}`;

/** Every listing's facts, by id: worked out once per list, posts and queues, not per keystroke. */
export function listingFacts(list: readonly Property[], input: FactsInput): Map<string, ListingFacts> {
  const { posts, assignments, rules, today, viewer } = input;
  const known = posts !== null;
  const history = posts ?? [];

  // An intern: what's in their queue this week (from Saturday, the coming one). An admin: who holds what.
  const week = weekOf(today);
  const mine = new Set<string>();
  if (!viewer.manager) {
    for (const row of assignments ?? []) {
      if (samePerson(row.assignedTo, viewer.name) && assignmentWeek(row) === week) mine.add(keyOfRow(row));
    }
  }
  const held = viewer.manager && assignments ? heldListings(assignments, today) : null;

  const out = new Map<string, ListingFacts>();
  for (const property of list) {
    const last = known ? lastPostOf(history, property)?.date : undefined;
    let holder: string | undefined;
    if (held) {
      const hold = heldBy(held, property);
      if (hold) holder = samePerson(hold.heldBy, viewer.name) ? 'With you' : `With ${firstName(hold.heldBy)}`;
    } else if (mine.has(`id:${property.id}`) || mine.has(`name:${normalize(property.name)}`)) {
      holder = 'In your queue';
    }
    out.set(property.id, {
      property,
      kind: categoryKind(property.category),
      deal: dealOf(property),
      status: statusOf(property, last, rules, today),
      known,
      lastPosted: last,
      holder,
      searchName: normalizeForSearch(property.name),
    });
  }
  return out;
}

/** The one pill: what stops it first, else Ready. A missing document outranks a cooldown: there is nothing to post either way. */
export function statusOf(
  property: Pick<Property, 'availability' | 'issues' | 'hasIssues'>,
  lastPosted: string | undefined,
  rules: Pick<Settings, 'cooldownDays'>,
  today: string,
): FindStatus {
  if (property.availability === 'Sold') return { kind: 'sold', text: 'Sold', tone: 'neutral' };
  const problem = postingProblem(property);
  if (problem === 'noDocument') return { kind: 'noDocument', text: 'No document', tone: 'danger' };
  if (problem === 'wordFile') return { kind: 'noDocument', text: 'Word file', tone: 'danger' };
  const cool = cooldown(lastPosted, today, rules);
  if (cool.blocked && cool.nextAllowed) {
    return { kind: 'cooldown', text: `In cooldown until ${shortDate(cool.nextAllowed)}`, tone: 'danger' };
  }
  if (problem === 'noSeparator') return { kind: 'noSeparator', text: 'No separator', tone: 'warn' };
  return { kind: 'ready', text: 'Ready', tone: 'ok' };
}

/** Ready to post: not sold, not in its cooldown, and has a document (one with no separator counts: it is posted after a check). */
export function isReady(facts: Pick<ListingFacts, 'status'>): boolean {
  return facts.status.kind === 'ready' || facts.status.kind === 'noSeparator';
}

export function filterCount(filters: FindFilters): number {
  return Object.values(filters).filter(Boolean).length;
}

/** Whether the listing passes the Filter menu. For sale and For lease together mean either. */
export function passes(facts: ListingFacts, filters: FindFilters): boolean {
  if ((filters.sale || filters.lease) && !((filters.sale && facts.deal.sale) || (filters.lease && facts.deal.lease))) return false;
  if (filters.ready && !isReady(facts)) return false;
  if (filters.fresh && facts.lastPosted !== undefined) return false;
  if (filters.photos && facts.property.photoCount <= 0) return false;
  return true;
}

/** The order actually used: Best match only while searching, Newest only when the list has the dates. */
export function effectiveSort(sort: FindSort, query: string, hasCreated: boolean): Exclude<FindSort, 'best'> | 'best' {
  if (sort === 'best') return query.trim() ? 'best' : 'name';
  if (sort === 'newest' && !hasCreated) return 'name';
  return sort;
}

export const SORT_LABEL: Record<FindSort, string> = {
  best: 'Best match',
  name: 'Name',
  newest: 'Newest',
  posted: 'Last posted',
};

/**
 * How well a name matches the words: 0 the name starts with them, 1 a word of
 * the name does, 2 they are in the name somewhere, 3 every word is in the name
 * in some order, 4 a word matched only the category, city or building.
 */
export function matchRank(searchName: string, query: string): number {
  const q = normalizeForSearch(query);
  if (!q) return 0;
  if (searchName.startsWith(q)) return 0;
  if (` ${searchName}`.includes(` ${q}`)) return 1;
  if (searchName.includes(q)) return 2;
  return q.split(' ').every((word) => searchName.includes(word)) ? 3 : 4;
}

/**
 * The rows in `sort` order. They arrive in name order (the directory's), and
 * every sort keeps it among equals, so the same search always lists the same way.
 * Last posted: never posted first, then the longest since posted, as a queue is filled.
 * Newest: the checker's newest folders first; those it has no date for, last.
 */
export function sortFacts(rows: readonly ListingFacts[], sort: FindSort, query: string): readonly ListingFacts[] {
  const indexed = rows.map((facts, index) => ({ facts, index }));
  const by = (key: (f: ListingFacts) => number | string) =>
    indexed
      .map((r) => ({ ...r, key: key(r.facts) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
      .map((r) => r.facts);
  switch (sort) {
    case 'best':
      return by((f) => matchRank(f.searchName, query));
    case 'newest':
      // Descending by date: '~' sorts after any digit, so an undated row goes last.
      return by((f) => (f.property.created ? invertDate(f.property.created) : '~'));
    case 'posted':
      return by((f) => f.lastPosted ?? '');
    default:
      return rows;
  }
}

/** A yyyy-MM-dd that sorts newest first. */
function invertDate(date: string): string {
  return date.replace(/\d/g, (d) => String(9 - Number(d)));
}

/** What the order is by, said on each row so it can be checked: "Posted 12 days ago", "Added 3 Nov". */
export function sortNote(facts: ListingFacts, sort: FindSort, today: string): string {
  if (sort === 'posted') {
    if (!facts.known) return '';
    return facts.lastPosted ? `Posted ${ago(Math.max(0, daysBetween(facts.lastPosted, today)))}` : 'Never posted';
  }
  if (sort === 'newest' && facts.property.created) return `Added ${dayMonth(facts.property.created)}`;
  return '';
}
