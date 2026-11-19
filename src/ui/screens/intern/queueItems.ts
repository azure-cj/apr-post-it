import { normalize } from '@/core/matcher';
import { rowsOf, type QueuePeriod } from '@/core/queues';
import { isDate, samePerson } from '@/core/summary';
import { queueStatus, type Assignment, type AssignmentStatus, type PostLogEntry, type Property } from '@/core/types';

/**
 * A queue as My queue shows it, and the next listing to post: one rule for My
 * queue's Next up and for the listing a saved post moves on to (LogStep), so
 * the two always pick the same one.
 */

export interface QueueItem {
  readonly assignment: Assignment;
  /** The listing in the directory, when it is still there. */
  readonly property: Property | undefined;
  /** Your post of it while the queue runs: the pending one, or the live one. */
  readonly post: PostLogEntry | undefined;
  /** Where it is: its own status, or your post's when the queue's row lags. */
  readonly status: AssignmentStatus;
}

/** The listing a queue row names: by its folder id, else by its name as the list spells it. */
export function propertyFinder(
  directory: { get(id: string): Property | undefined },
  list: readonly Property[] | null,
): (assignment: Assignment) => Property | undefined {
  const byName = new Map((list ?? []).map((p) => [normalize(p.name), p]));
  return (a) => {
    // A cell typed by hand may carry a space.
    const id = a.propertyId.trim();
    return (id ? directory.get(id) : undefined) ?? byName.get(normalize(a.propertyName));
  };
}

/**
 * The person's rows of `period`, each with their post of it made while the
 * queue runs: Pending first (one click once approved), then what is left, then
 * what is done, each in the admin's order.
 */
export function queueItems(
  person: string,
  period: QueuePeriod,
  assignments: readonly Assignment[],
  posts: readonly PostLogEntry[],
  find: (assignment: Assignment) => Property | undefined,
): QueueItem[] {
  const during = posts.filter(
    (p) => isDate(p.date) && p.date >= period.start && p.date <= period.due && samePerson(p.postedBy, person),
  );
  const rows = rowsOf(person, period.key, assignments).map((assignment): QueueItem => {
    const own = queueStatus(assignment.status);
    const post = latestPostOf(during, assignment, own);
    // Posted on Facebook, and the queue's row not yet told: count it as the tracker does.
    const status = own === 'Not Shared' && post ? post.status : own;
    return { assignment, property: find(assignment), post, status };
  });
  const rank = { Pending: 0, 'Not Shared': 1, Posted: 2 } as const;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank[a.row.status] - rank[b.row.status] || a.index - b.index)
    .map(({ row }) => row);
}

/** The listing's folder id, when it can be opened. */
export function idOf(item: QueueItem): string {
  return item.property?.id ?? item.assignment.propertyId.trim();
}

/** Opened by its folder id; until the list arrives, the queue's own id stands in. */
export function openable(item: QueueItem, listLoaded: boolean): boolean {
  return idOf(item) !== '' && !(listLoaded && !item.property);
}

/** The next one to post: the first not posted yet, in the admin's order, that can be opened. */
export function nextToPost(items: readonly QueueItem[], listLoaded: boolean): QueueItem | undefined {
  return items.find((i) => i.status === 'Not Shared' && openable(i, listLoaded));
}

/**
 * A post of this listing is this row's, as the server matches them
 * (sameProperty_): by folder id where both have one, else by name, never a
 * blank one.
 */
export function isRowFor(assignment: Assignment, propertyId: string, name: string): boolean {
  const rowId = assignment.propertyId.trim();
  const id = propertyId.trim();
  if (rowId !== '' && id !== '') return rowId === id;
  const key = normalize(name);
  return key !== '' && key === normalize(assignment.propertyName);
}

/** Your post of this queue item while it runs (isRowFor). The latest wins. */
function latestPostOf(posts: readonly PostLogEntry[], assignment: Assignment, status: AssignmentStatus): PostLogEntry | undefined {
  const wanted = status === 'Pending' ? ['Pending'] : status === 'Posted' ? ['Posted'] : ['Posted', 'Pending'];
  let found: PostLogEntry | undefined;
  for (const post of posts) {
    if (wanted.includes(post.status) && isRowFor(assignment, post.propertyId, post.title)) found = post;
  }
  return found;
}
