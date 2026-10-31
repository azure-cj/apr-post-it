/**
 * The tracker: the Posts and Assignments tabs of the company's sheet, through
 * the web app. Ported from ScriptTrackerRepository.cs.
 *
 * Nothing here is cached (docs/DATA-FLOW.md). These rows change because of
 * other people, and a stale queue is worse than a slow one. Read them when a
 * screen opens, and poll while it is up.
 *
 * Two things are the server's to decide: the cooldown, and who a post is
 * credited to. So a logged post's date, time and Posted By are taken from the
 * reply and never filled in from this machine's clock or this machine's idea
 * of who is signed in.
 *
 * Values from the sheet are passed back exactly as they came. Code.gs matches
 * names with === (an intern's own rows, a queue item's assignee), so a tidied
 * name would quietly stop matching.
 */

import { asList, asRecord, asText, unreadableReply, type Backend } from './backend';
import { postLinkProblem } from './links';
import { parseRole, readAccounts } from './session';
import {
  type IndexCheck,
  type Role,
  type TeamMember,
  UserFacingError,
  type Assignment,
  type AssignmentStatus,
  type PostLogEntry,
  type PostStatus,
} from './types';

export interface TrackerDeps {
  readonly backend: Pick<Backend, 'call'>;
}

/** What the person says about a post. The rest of the row is the server's. */
export interface LogPostInput {
  /** The listing's Drive folder id. The server judges the cooldown by it. */
  readonly propertyId: string;
  /** The listing's name: the row's Title. */
  readonly propertyName: string;
  /** The Facebook account it went out on. The server refuses one that is not yours. */
  readonly fbAccount: string;
  /** The post's link: required, an https link on Facebook (links.ts). */
  readonly postLink: string;
  /** Posted: live. Pending: posted in a group, waiting for the group admin's approval. */
  readonly status: PostStatus;
  /** The Type column — the C# app wrote the property's category. Blank: the server writes "Group post". */
  readonly type?: string | undefined;
  /** A manager logging for an intern, by their name exactly as the tracker has it. The server ignores it from an intern. */
  readonly postedBy?: string | undefined;
}

/** One line of a queue, in posting order. An Assignment fits. */
export interface QueueItemInput {
  readonly propertyName: string;
  /** Sent when known, so the row is matched by id rather than by name. */
  readonly propertyId?: string | undefined;
  /** Default "To post". */
  readonly status?: AssignmentStatus | undefined;
}

/** One intern's queue for `saveQueues`. */
export interface QueueInput {
  readonly assignedTo: string;
  readonly items: readonly QueueItemInput[];
}

/** A new Team row. */
export interface AddPersonInput {
  readonly name: string;
  readonly role: Role;
  /** Facebook accounts they may post from. Empty or missing means any. */
  readonly fbAccounts?: readonly string[] | undefined;
  readonly email?: string | undefined;
}

export interface Tracker {
  /** Every Posts row you may see, in sheet order (oldest first). An intern gets only their own. */
  posts(): Promise<readonly PostLogEntry[]>;

  /**
   * The Team tab, without keys: Admin only (server action `team`). Revoked
   * people included, with `active: false`. Rows with no name are left out.
   */
  team(): Promise<readonly TeamMember[]>;

  /** Every Assignments row you may see, in sheet order: within a queue, that is posting order. */
  assignments(): Promise<readonly Assignment[]>;

  /**
   * Appends a Posts row. The server refuses it inside the cooldown, under a
   * lock. The row that comes back carries the server's date, time and Posted By.
   */
  logPost(input: LogPostInput): Promise<PostLogEntry>;

  /** Completes a Pending post with its live link: the one edit allowed from here. */
  addLink(post: PostLogEntry, link: string): Promise<PostLogEntry>;

  /**
   * Saves an edited row. Only one edit is allowed — a Pending post becoming
   * Posted with its link — and anything else is refused here, without a
   * request: corrections are made in the sheet.
   */
  updatePost(original: PostLogEntry, edited: PostLogEntry): Promise<PostLogEntry>;

  /** Replaces one person's queue for one date with `items`, in that order. Resolves with how many were saved. */
  saveQueue(date: string, assignedTo: string, items: readonly QueueItemInput[]): Promise<number>;

  /**
   * Moves one queue item to `status`. With Posted, the server also marks the
   * assignee's newest Pending post of that listing Posted, so read the posts
   * again afterwards.
   */
  setStatus(item: Assignment, status: AssignmentStatus): Promise<Assignment>;

  /**
   * Replaces several interns' queues for one date at once, under one lock. A
   * planner's Map fits as it is. An intern given no items has their queue for
   * that date emptied. Resolves with how many rows were saved.
   */
  saveQueues(
    date: string,
    queues: ReadonlyMap<string, readonly QueueItemInput[]> | readonly QueueInput[],
  ): Promise<number>;

  /** Adds a person to the Team tab (Admin). The key comes back once: show it, then forget it. */
  addPerson(input: AddPersonInput): Promise<{ readonly person: TeamMember; readonly key: string }>;

  /** Revokes or restores someone (Admin). You cannot deactivate yourself. */
  setActive(name: string, active: boolean): Promise<TeamMember>;

  /** A new key for someone (Admin). Their old key stops working at once. */
  newKey(name: string): Promise<string>;

  /** How the Directory sheet and the listing checker's index disagree (Admin). */
  indexCheck(): Promise<IndexCheck>;
}

const ONLY_THE_LINK =
  'Only adding the live link to a pending post can be saved from here. Edit the sheet for anything else.';

export function createTracker(deps: TrackerDeps): Tracker {
  const { backend } = deps;

  async function addLink(post: PostLogEntry, link: string): Promise<PostLogEntry> {
    if (post.status !== 'Pending') {
      throw new UserFacingError('This post is already live. Corrections are made in the tracker sheet.');
    }
    const postLink = link.trim();
    if (!postLink) throw new UserFacingError('Paste the post link.');
    if (!post.title.trim() && !post.propertyId.trim()) {
      throw new UserFacingError(
        'That post has no property on it, so Post-It cannot find its row. Add the link in the tracker sheet.',
      );
    }
    await backend.call('addLink', {
      property: post.title,
      propertyId: post.propertyId.trim() ? post.propertyId : undefined,
      postLink,
    });
    return { ...post, status: 'Posted', postLink };
  }

  return {
    async team(): Promise<readonly TeamMember[]> {
      const reply = await backend.call('team');
      const rows = asList(reply['team']);
      if (!rows) throw unreadableReply('team');
      const out: TeamMember[] = [];
      for (const raw of rows) {
        const row = asRecord(raw);
        const member = row ? readTeamMember(row) : null;
        if (member) out.push(member);
      }
      return out;
    },

    async posts(): Promise<readonly PostLogEntry[]> {
      const reply = await backend.call('posts');
      const rows = asList(reply['posts']);
      if (!rows) throw unreadableReply('posts');
      const out: PostLogEntry[] = [];
      for (const raw of rows) {
        const row = asRecord(raw);
        if (row) out.push(readPost(row));
      }
      return out;
    },

    async assignments(): Promise<readonly Assignment[]> {
      const reply = await backend.call('assignments');
      const rows = asList(reply['assignments']);
      if (!rows) throw unreadableReply('assignments');
      const out: Assignment[] = [];
      for (const raw of rows) {
        const row = asRecord(raw);
        if (row) out.push(readAssignment(row));
      }
      return out;
    },

    async logPost(input: LogPostInput): Promise<PostLogEntry> {
      if (!input.propertyId.trim() || !input.propertyName.trim()) {
        throw new UserFacingError('Choose the property you posted before logging it.');
      }
      // The server checks the account against your list as typed in the Team tab, trimmed.
      const fbAccount = input.fbAccount.trim();
      if (!fbAccount) throw new UserFacingError('Type the FB account name.');
      const linkProblem = postLinkProblem(input.postLink);
      if (linkProblem) throw new UserFacingError(linkProblem);
      const postLink = input.postLink.trim();
      if (input.status !== 'Posted' && input.status !== 'Pending') {
        throw new UserFacingError('Choose Posted or Pending.');
      }
      const type = (input.type ?? '').trim();
      const postedBy = input.postedBy ?? '';

      // No date, no time: the server stamps the row with its own clock.
      const reply = await backend.call('logPost', {
        property: input.propertyName,
        propertyId: input.propertyId,
        fbAccount,
        postLink,
        status: input.status,
        type: type || undefined,
        postedBy: postedBy.trim() ? postedBy : undefined,
      });

      const said = asText(reply['status']).trim();
      const status: PostStatus = said === 'Pending' || said === 'Posted' ? said : input.status;
      return {
        date: readSheetDate(reply['date']),
        time: readSheetTime(reply['time']),
        // What Code.gs writes when no type is sent.
        type: type || 'Group post',
        title: input.propertyName,
        status,
        fbAccount,
        postLink,
        // From the key, never from this machine: a post cannot be logged under another name.
        postedBy: asText(reply['postedBy']),
        propertyId: input.propertyId,
      };
    },

    addLink,

    async updatePost(original: PostLogEntry, edited: PostLogEntry): Promise<PostLogEntry> {
      if (original.status !== 'Pending') {
        throw new UserFacingError('This post is already live. Corrections are made in the tracker sheet.');
      }
      const onlyTheLink =
        edited.status === 'Posted' &&
        edited.date === original.date &&
        edited.time === original.time &&
        edited.type === original.type &&
        edited.title === original.title &&
        edited.fbAccount === original.fbAccount &&
        edited.postedBy === original.postedBy &&
        edited.propertyId === original.propertyId &&
        edited.postLink.trim() !== '';
      if (!onlyTheLink) throw new UserFacingError(ONLY_THE_LINK);
      return addLink(original, edited.postLink);
    },

    async saveQueue(date: string, assignedTo: string, items: readonly QueueItemInput[]): Promise<number> {
      // The server deletes this person's rows whose date reads exactly so; any
      // other spelling would leave the old queue in place beside the new one.
      if (!date || readSheetDate(date) !== date) throw new UserFacingError('Pick a date for the queue.');
      if (!assignedTo.trim()) throw new UserFacingError('Choose who the queue is for.');
      if (items.some((item) => !item.propertyName.trim())) {
        throw new UserFacingError('Every queue item needs a property. Remove the empty one and save again.');
      }
      const reply = await backend.call('saveQueue', {
        date,
        assignedTo,
        items: items.map((item) => ({
          property: item.propertyName,
          status: item.status ?? 'To post',
          ...(item.propertyId?.trim() ? { propertyId: item.propertyId } : {}),
        })),
      });
      const saved = reply['saved'];
      return typeof saved === 'number' && Number.isFinite(saved) ? saved : items.length;
    },

    async setStatus(item: Assignment, status: AssignmentStatus): Promise<Assignment> {
      if (!item.propertyName.trim()) {
        throw new UserFacingError(
          'That queue item has no property, so Post-It cannot find its row. Fix it in the tracker sheet.',
        );
      }
      if (!item.assignedTo.trim()) {
        throw new UserFacingError('That queue item is not assigned to anyone. Fix it in the tracker sheet.');
      }
      await backend.call('setStatus', {
        property: item.propertyName,
        propertyId: item.propertyId.trim() ? item.propertyId : undefined,
        assignedTo: item.assignedTo,
        status,
      });
      return { ...item, status };
    },

    async saveQueues(date, queues): Promise<number> {
      if (!date || readSheetDate(date) !== date) throw new UserFacingError('Pick a date for the queues.');
      const list: readonly QueueInput[] = isQueueMap(queues)
        ? [...queues].map(([assignedTo, items]) => ({ assignedTo, items }))
        : queues;
      if (list.length === 0) return 0;
      const seen = new Set<string>();
      for (const queue of list) {
        if (!queue.assignedTo.trim()) throw new UserFacingError('Every queue needs someone to post it.');
        if (seen.has(queue.assignedTo)) {
          throw new UserFacingError(`${queue.assignedTo} has two queues. Merge them and save again.`);
        }
        seen.add(queue.assignedTo);
        if (queue.items.some((item) => !item.propertyName.trim())) {
          throw new UserFacingError('Every queue item needs a property. Remove the empty one and save again.');
        }
      }
      const reply = await backend.call('saveQueues', {
        date,
        queues: list.map((queue) => ({
          assignedTo: queue.assignedTo,
          items: queue.items.map((item) => ({
            propertyName: item.propertyName,
            status: item.status ?? 'To post',
            ...(item.propertyId?.trim() ? { propertyId: item.propertyId } : {}),
          })),
        })),
      });
      const saved = reply['saved'];
      return typeof saved === 'number' && Number.isFinite(saved)
        ? saved
        : list.reduce((sum, queue) => sum + queue.items.length, 0);
    },

    async addPerson(input: AddPersonInput): Promise<{ readonly person: TeamMember; readonly key: string }> {
      const name = input.name.trim();
      if (!name) throw new UserFacingError("Type the person's name.");
      if (input.role !== 'Intern' && input.role !== 'Admin') throw new UserFacingError('Choose Intern or Admin.');
      const fbAccounts = readAccounts(input.fbAccounts ?? []);
      const email = (input.email ?? '').trim();
      const reply = await backend.call('addPerson', {
        name,
        role: input.role,
        fbAccounts: fbAccounts.length > 0 ? fbAccounts : undefined,
        email: email || undefined,
      });
      const row = asRecord(reply['person']);
      const person = row ? readTeamMember(row) : null;
      const key = asText(reply['key']).trim();
      if (!person || !key) throw unreadableReply('addPerson');
      return { person, key };
    },

    async setActive(name: string, active: boolean): Promise<TeamMember> {
      // Sent exactly as the Team tab has it: the server matches the name.
      if (!name.trim()) throw new UserFacingError('Choose who to change.');
      const reply = await backend.call('setActive', { name, active });
      const row = asRecord(reply['person']);
      const person = row ? readTeamMember(row) : null;
      if (!person) throw unreadableReply('setActive');
      return person;
    },

    async newKey(name: string): Promise<string> {
      if (!name.trim()) throw new UserFacingError('Choose who needs a new key.');
      const reply = await backend.call('newKey', { name });
      const key = asText(reply['key']).trim();
      if (!key) throw unreadableReply('newKey');
      return key;
    },

    async indexCheck(): Promise<IndexCheck> {
      const reply = await backend.call('indexCheck');
      const directoryOnly = asList(reply['directoryOnly']);
      const checkerOnly = asList(reply['checkerOnly']);
      const sold = asList(reply['sold']);
      if (!directoryOnly || !checkerOnly || !sold) throw unreadableReply('indexCheck');
      return {
        checkedAt: asText(reply['checkedAt']),
        directoryCount: count(reply['directoryCount']),
        checkerCount: count(reply['checkerCount']),
        directoryOnly: readNamed(directoryOnly).map(({ id, name }) => ({ id, name })),
        checkerOnly: readNamed(checkerOnly),
        sold: readNamed(sold).map(({ id, name }) => ({ id, name })),
      };
    },
  };
}

function isQueueMap(
  queues: ReadonlyMap<string, readonly QueueItemInput[]> | readonly QueueInput[],
): queues is ReadonlyMap<string, readonly QueueItemInput[]> {
  return !Array.isArray(queues);
}

/** A count from the reply: a whole number of zero or more, else 0. */
function count(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** `{id, name, path}` rows; a row with neither an id nor a name is left out. */
function readNamed(rows: readonly unknown[]): { id: string; name: string; path: string }[] {
  const out: { id: string; name: string; path: string }[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row) continue;
    const id = asText(row['id']);
    const name = asText(row['name']);
    if (!id.trim() && !name.trim()) continue;
    out.push({ id, name, path: asText(row['path']) });
  }
  return out;
}

// ------------------------------------------------------------------ mapping

function readPost(row: Readonly<Record<string, unknown>>): PostLogEntry {
  return {
    date: readSheetDate(row['date']),
    time: readSheetTime(row['time']),
    type: asText(row['type']),
    title: asText(row['title']),
    status: asText(row['status']).trim().toLowerCase() === 'pending' ? 'Pending' : 'Posted',
    fbAccount: asText(row['fbAccount']),
    postLink: asText(row['postLink']),
    postedBy: asText(row['postedBy']),
    propertyId: asText(row['propertyId']),
  };
}

/** One Team row, or null when it has no name. Names are kept exactly as sent: they are matched with ===. */
function readTeamMember(row: Readonly<Record<string, unknown>>): TeamMember | null {
  const name = asText(row['name']);
  if (!name.trim()) return null;
  const active = row['active'];
  return {
    name,
    role: parseRole(row['role']),
    email: asText(row['email']).trim(),
    fbAccounts: readAccounts(row['fbAccounts']),
    // Only an explicit "no" revokes, as the server's identify() reads the Active cell.
    active: !(active === false || (typeof active === 'string' && active.trim().toUpperCase() === 'FALSE')),
  };
}

function readAssignment(row: Readonly<Record<string, unknown>>): Assignment {
  return {
    date: readSheetDate(row['date']),
    assignedTo: asText(row['assignedTo']),
    propertyName: asText(row['property']),
    propertyId: asText(row['propertyId']),
    status: readAssignmentStatus(row['status']),
  };
}

function readAssignmentStatus(value: unknown): AssignmentStatus {
  switch (asText(value).trim().toLowerCase()) {
    case 'posted':
      return 'Posted';
    case 'pending':
      return 'Pending';
    default:
      return 'To post';
  }
}

// ------------------------------------------------------------------ the sheet's dates and times
//
// Code.gs formats a date cell as yyyy-MM-dd, but a cell typed as text comes
// through as typed, and a Date that escapes formatting arrives as JSON's UTC
// timestamp. The sheet's clock is Manila's (CONFIG.TZ), which is UTC+8 all
// year round, so a timestamp is read on Manila's calendar: Manila's midnight
// is 16:00 the day before in UTC.

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_STAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\sT,].*)?$/;
const CLOCK = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:\s*([ap])\.?\s*m\.?)?$/i;

/** A sheet date as yyyy-MM-dd: "2026-01-05", "2026-01-06T00:00:00.000Z", "1/6/2026". Blank when it is none of those. */
export function readSheetDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();

  let m = ISO_DATE.exec(text);
  if (m) return calendarDate(+m[1]!, +m[2]!, +m[3]!);

  m = ISO_STAMP.exec(text);
  if (m) {
    const instant = stampToManila(m);
    if (instant === null) return '';
    if (instant === 'wall') return calendarDate(+m[1]!, +m[2]!, +m[3]!);
    return calendarDate(instant.getUTCFullYear(), instant.getUTCMonth() + 1, instant.getUTCDate());
  }

  m = US_DATE.exec(text);
  if (m) return calendarDate(+m[3]!, +m[1]!, +m[2]!);
  return '';
}

/** A sheet time as HH:mm: "14:30", "9:05", "2:30 PM", "14:30:00", or a timestamp read in Manila. Blank otherwise. */
export function readSheetTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();

  const clock = CLOCK.exec(text);
  if (clock) {
    let hours = +clock[1]!;
    const minutes = +clock[2]!;
    const half = clock[3]?.toLowerCase();
    if (minutes > 59) return '';
    if (half) {
      if (hours < 1 || hours > 12) return '';
      hours = (hours % 12) + (half === 'p' ? 12 : 0);
    } else if (hours > 23) {
      return '';
    }
    return `${pad(hours)}:${pad(minutes)}`;
  }

  const stamp = ISO_STAMP.exec(text);
  if (stamp) {
    const instant = stampToManila(stamp);
    if (instant === null) return '';
    if (instant === 'wall') return `${stamp[4]}:${stamp[5]}`;
    return `${pad(instant.getUTCHours())}:${pad(instant.getUTCMinutes())}`;
  }
  // A bare date ("1899-12-30" is what a time-formatted cell becomes in Code.gs) has no time in it.
  return '';
}

/**
 * The moment a timestamp names, shifted so its UTC fields read as Manila's
 * clock. 'wall' when it has no zone (its fields are the clock already), null
 * when it is not a real moment.
 */
function stampToManila(m: RegExpExecArray): Date | 'wall' | null {
  const [year, month, day, hours, minutes, seconds] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [
    number, number, number, number, number, number,
  ];
  if (calendarDate(year, month, day) === '' || hours > 23 || minutes > 59 || seconds > 59) return null;
  const zone = m[7];
  if (!zone) return 'wall';
  let offsetMinutes = 0;
  if (zone.toUpperCase() !== 'Z') {
    const digits = zone.replace(':', '');
    const sign = digits.startsWith('-') ? -1 : 1;
    offsetMinutes = sign * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)));
  }
  const utc = Date.UTC(year, month - 1, day, hours, minutes, seconds) - offsetMinutes * 60_000;
  return new Date(utc + MANILA_OFFSET_MS);
}

/** yyyy-MM-dd for a real calendar day, blank for 2026-02-30 and friends. */
function calendarDate(year: number, month: number, day: number): string {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
