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
import { facebookProfileProblem, normalizeProfileLink, postLinkProblem } from './links';
import { parseRole, readAccounts, readRules } from './session';
import {
  RULE_LIMITS,
  type DirectoryBuildStatus,
  type FbProfile,
  type ServerRules,
  type IndexCheck,
  type Role,
  type TeamMember,
  UserFacingError,
  type Assignment,
  type AssignmentStatus,
  type PostLogEntry,
  type PostStatus,
  NOT_SHARED,
  queueStatus,
} from './types';
import { propertyType } from './records';
import { isSpotResult, type SpotCheck, type SpotResult } from './spotchecks';
import { assignmentWeek, isWeekKey, weekOf } from './week';

/** What adding a person gives back. `warning` says something was not saved. */
export interface AddPersonResult {
  readonly person: TeamMember;
  readonly key: string;
  readonly warning?: string;
}

export const PROFILE_LINK_DROPPED =
  "The profile link wasn't saved: the web app is an older version. Deploy a New version in Apps Script, then open their row to add it.";

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
  /**
   * The listing's category, as a fallback: the server writes the Property type
   * from the Directory's category, and uses this only when it has none.
   */
  readonly type?: string | undefined;
  /** A manager logging for an intern, by their name exactly as the tracker has it. The server ignores it from an intern. */
  readonly postedBy?: string | undefined;
  /** v12: when it was logged (ISO), for a post kept on this PC and sent later. The server dates the row by it. */
  readonly loggedAt?: string | undefined;
}

/** One line of a queue, in posting order. An Assignment fits. */
export interface QueueItemInput {
  readonly propertyName: string;
  /** Sent when known, so the row is matched by id rather than by name. */
  readonly propertyId?: string | undefined;
  /** Default "Not Shared". */
  readonly status?: AssignmentStatus | undefined;
}

/** One intern's queue for `saveQueues`. */
export interface QueueInput {
  readonly assignedTo: string;
  readonly items: readonly QueueItemInput[];
  /** v14: when this queue runs. Missing: the call's `when`, else a one-week queue of its week. */
  readonly when?: QueueWhen | undefined;
}

/**
 * v14: when a queue runs: its first working day and its deadline, both
 * yyyy-MM-dd (queues.periodFrom makes one). The queue is saved under the
 * week its start is in.
 */
export interface QueueWhen {
  readonly start: string;
  readonly due: string;
}

/** A new Team row. */
export interface AddPersonInput {
  readonly name: string;
  readonly role: Role;
  /** FB broker name(s): the Facebook account name they post as. Empty or missing means any. */
  readonly fbAccounts?: readonly string[] | undefined;
  /** The link to that Facebook profile: https on facebook.com or fb.com (links.ts). Blank means none. */
  readonly fbProfileLink?: string | undefined;
  /** Each FB account with its own profile link. When sent, replaces fbAccounts and fbProfileLink. */
  readonly fbProfiles?: readonly FbProfile[] | undefined;
  readonly email?: string | undefined;
}

/** What `updatePerson` may change. A field left out stays as it is; blank clears it. */
export interface UpdatePersonInput {
  readonly fbAccounts?: readonly string[] | undefined;
  readonly fbProfileLink?: string | undefined;
  /** Each FB account with its own profile link. When sent, replaces the two above. */
  readonly fbProfiles?: readonly FbProfile[] | undefined;
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

  /**
   * Replaces one person's queue for one week with `items`, in that order (v6).
   * `week` is its Monday; any other day is read as the week it is in
   * (weekOf), so a call written for daily queues still works. Their rows of
   * that week, older daily rows included, are replaced. Resolves with how
   * many were saved.
   */
  saveQueue(week: string, assignedTo: string, items: readonly QueueItemInput[], when?: QueueWhen): Promise<number>;

  /**
   * Moves one queue item to `status`. With Posted, the server also marks the
   * assignee's newest Pending post of that listing Posted, so read the posts
   * again afterwards.
   */
  setStatus(item: Assignment, status: AssignmentStatus): Promise<Assignment>;

  /**
   * Replaces several interns' queues for one week at once, under one lock. A
   * planner's Map fits as it is. An intern given no items has their queue for
   * that week emptied. `week` is read as saveQueue reads it. Resolves with how
   * many rows were saved. v14: each queue's `when` (else `when`) says when
   * it runs; its start's week is the one it is saved under.
   */
  saveQueues(
    week: string,
    queues: ReadonlyMap<string, readonly QueueItemInput[]> | readonly QueueInput[],
    when?: QueueWhen,
  ): Promise<number>;

  /** Adds a person to the Team tab (Admin). The key comes back once: show it, then forget it. */
  addPerson(input: AddPersonInput): Promise<AddPersonResult>;

  /** Revokes or restores someone (Admin). You cannot deactivate yourself. */
  setActive(name: string, active: boolean): Promise<TeamMember>;

  /**
   * Changes someone's FB broker name(s) and profile link (Admin). Only the
   * fields given are sent; name, role and key never change here.
   */
  updatePerson(name: string, changes: UpdatePersonInput): Promise<TeamMember>;

  /** A new key for someone (Admin). Their old key stops working at once. */
  newKey(name: string): Promise<string>;

  /** How the Directory sheet and the listing checker's index disagree (Admin). */
  indexCheck(): Promise<IndexCheck>;

  /**
   * Changes the rules (Admin): only the fields given, each a whole number in
   * its range (RULE_LIMITS), checked here before any request. Resolves with
   * every rule as the server now has it.
   */
  setRules(changes: Partial<ServerRules>): Promise<ServerRules>;

  /**
   * Starts rebuilding the directory sheet from Drive (Admin). The server
   * schedules it and answers at once; follow it with `directoryStatus`.
   * Rejects with code 'busy' when a rebuild is already running.
   */
  rebuildDirectory(): Promise<{ readonly started: true }>;

  /** How a rebuild of the directory is going, and when the last one finished (Admin). */
  directoryStatus(): Promise<DirectoryBuildStatus>;

  /** Every spot check on the Spot checks tab (Admin, v16). */
  spotChecks(): Promise<readonly SpotCheck[]>;

  /** Saves what an admin found on opening `post` (Admin, v16). Checking it again replaces the result. */
  saveSpotCheck(post: PostLogEntry, result: SpotResult): Promise<SpotCheck>;
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
        loggedAt: input.loggedAt || undefined,
      });

      const said = asText(reply['status']).trim();
      const status: PostStatus = said === 'Pending' || said === 'Posted' ? said : input.status;
      return {
        date: readSheetDate(reply['date']),
        time: readSheetTime(reply['time']),
        // The Property type the server wrote; an older server sends none.
        type: asText(reply['type']).trim() || propertyType(type),
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

    async saveQueue(day: string, assignedTo: string, items: readonly QueueItemInput[], when?: QueueWhen): Promise<number> {
      const period = when ? checkedWhen(when) : undefined;
      const week = period ? queueWeek(period.start) : queueWeek(day);
      if (!week) throw new UserFacingError('Pick a week for the queue.');
      if (!assignedTo.trim()) throw new UserFacingError('Choose who the queue is for.');
      if (items.some((item) => !item.propertyName.trim())) {
        throw new UserFacingError('Every queue item needs a property. Remove the empty one and save again.');
      }
      const reply = await backend.call('saveQueue', {
        week,
        ...(period ? { start: period.start, due: period.due } : {}),
        assignedTo,
        items: items.map((item) => ({
          property: item.propertyName,
          status: item.status ?? NOT_SHARED,
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

    async saveQueues(day, queues, when): Promise<number> {
      const shared = when ? checkedWhen(when) : undefined;
      const week = shared ? queueWeek(shared.start) : queueWeek(day);
      if (!week) throw new UserFacingError('Pick a week for the queues.');
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
        week,
        ...(shared ? { start: shared.start, due: shared.due } : {}),
        queues: list.map((queue) => ({
          assignedTo: queue.assignedTo,
          ...(queue.when ? (({ start, due }) => ({ start, due }))(checkedWhen(queue.when)) : {}),
          items: queue.items.map((item) => ({
            propertyName: item.propertyName,
            status: item.status ?? NOT_SHARED,
            ...(item.propertyId?.trim() ? { propertyId: item.propertyId } : {}),
          })),
        })),
      });
      const saved = reply['saved'];
      return typeof saved === 'number' && Number.isFinite(saved)
        ? saved
        : list.reduce((sum, queue) => sum + queue.items.length, 0);
    },

    async addPerson(input: AddPersonInput): Promise<AddPersonResult> {
      const name = input.name.trim();
      if (!name) throw new UserFacingError("Type the person's name.");
      if (input.role !== 'Intern' && input.role !== 'Admin') throw new UserFacingError('Choose Intern or Admin.');
      const profiles = input.fbProfiles !== undefined ? checkedProfiles(input.fbProfiles) : undefined;
      const fbAccounts = profiles ? profiles.map((p) => p.account) : readAccounts(input.fbAccounts ?? []);
      const email = (input.email ?? '').trim();
      const fbProfileLink = profiles ? firstLink(profiles) : checkedProfileLink(input.fbProfileLink ?? '');
      const reply = await backend.call('addPerson', {
        name,
        role: input.role,
        fbAccounts: fbAccounts.length > 0 ? fbAccounts : undefined,
        fbProfileLink: fbProfileLink || undefined,
        fbProfiles: profiles,
        email: email || undefined,
      });
      const row = asRecord(reply['person']);
      const person = row ? readTeamMember(row) : null;
      const key = asText(reply['key']).trim();
      if (!person || !key) throw unreadableReply('addPerson');
      // A web app older than the profile-link column saves the person but
      // drops the link, and its reply has no fbProfileLink field at all.
      if (fbProfileLink && row && !('fbProfileLink' in row)) {
        return { person, key, warning: PROFILE_LINK_DROPPED };
      }
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

    async updatePerson(name: string, changes: UpdatePersonInput): Promise<TeamMember> {
      if (!name.trim()) throw new UserFacingError('Choose who to change.');
      const payload: Record<string, unknown> = { name };
      if (changes.fbAccounts !== undefined) payload['fbAccounts'] = readAccounts(changes.fbAccounts);
      if (changes.fbProfileLink !== undefined) payload['fbProfileLink'] = checkedProfileLink(changes.fbProfileLink);
      if (changes.fbProfiles !== undefined) {
        const profiles = checkedProfiles(changes.fbProfiles);
        payload['fbProfiles'] = profiles;
        payload['fbAccounts'] = profiles.map((p) => p.account);
        payload['fbProfileLink'] = firstLink(profiles);
      }
      const reply = await backend.call('updatePerson', payload);
      const row = asRecord(reply['person']);
      const person = row ? readTeamMember(row) : null;
      if (!person) throw unreadableReply('updatePerson');
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

    async setRules(changes: Partial<ServerRules>): Promise<ServerRules> {
      const payload: Record<string, number> = {};
      // perIntern is perWeek's old name: sent as perWeek, unless perWeek is given too.
      const asked: Partial<Record<keyof ServerRules, number>> = { ...changes };
      if (asked.perWeek === undefined && asked.perIntern !== undefined) asked.perWeek = asked.perIntern;
      delete asked.perIntern;
      for (const name of Object.keys(RULE_LIMITS) as (keyof ServerRules)[]) {
        const value = asked[name];
        if (value === undefined) continue;
        const { min, max, label } = RULE_LIMITS[name];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
          throw new UserFacingError(`${label} must be a whole number from ${min} to ${max}.`);
        }
        payload[name] = value;
      }
      const reply = await backend.call('setRules', payload);
      const rules = readRules(reply['rules']);
      if (!rules) throw unreadableReply('setRules');
      return rules;
    },

    async rebuildDirectory(): Promise<{ readonly started: true }> {
      const reply = await backend.call('rebuildDirectory');
      if (reply['started'] !== true) throw unreadableReply('rebuildDirectory');
      return { started: true };
    },

    async directoryStatus(): Promise<DirectoryBuildStatus> {
      const reply = await backend.call('directoryStatus');
      const running = reply['running'];
      if (typeof running !== 'boolean') throw unreadableReply('directoryStatus');
      const done = count(reply['done']);
      const total = count(reply['total']);
      return { running, done: Math.min(done, total || done), total, builtAt: asText(reply['builtAt']).trim() };
    },

    async spotChecks(): Promise<readonly SpotCheck[]> {
      const reply = await backend.call('spotChecks');
      const rows = asList(reply['checks']);
      if (!rows) throw unreadableReply('spotChecks');
      return rows.flatMap((raw) => {
        const check = readSpotCheck(raw);
        return check ? [check] : [];
      });
    },

    async saveSpotCheck(post: PostLogEntry, result: SpotResult): Promise<SpotCheck> {
      const postLink = post.postLink.trim();
      const problem = postLinkProblem(postLink);
      if (problem) throw new UserFacingError(problem);
      const reply = await backend.call('saveSpotCheck', { postLink, result });
      const check = readSpotCheck(reply['check']);
      if (!check) throw unreadableReply('saveSpotCheck');
      return check;
    },
  };
}

/** A Spot checks row, or null when it has no post or no result the app knows. */
function readSpotCheck(value: unknown): SpotCheck | null {
  const row = asRecord(value);
  if (!row) return null;
  const postKey = asText(row['postKey']).trim().toLowerCase();
  const result = asText(row['result']).trim();
  if (!postKey || !isSpotResult(result)) return null;
  return {
    postKey,
    link: asText(row['link']).trim(),
    agent: asText(row['agent']).trim(),
    posted: asText(row['posted']).trim(),
    property: asText(row['property']).trim(),
    propertyId: asText(row['propertyId']).trim(),
    result,
    checkedBy: asText(row['checkedBy']).trim(),
    checkedAt: asText(row['checkedAt']).trim(),
  };
}

/** The profile link to send, normalized, or a refusal before any request when it is not Facebook's. */
/**
 * A reply's fbProfiles, or, from a web app older than v9, each account with
 * the one profile link on the first.
 */
function readProfiles(value: unknown, accounts: readonly string[], link: string): readonly FbProfile[] {
  if (Array.isArray(value)) {
    return value.flatMap((v) => {
      const row = asRecord(v);
      const account = row ? asText(row['account']).trim() : '';
      return account ? [{ account, link: asText(row?.['link']).trim() }] : [];
    });
  }
  return accounts.map((account, i) => ({ account, link: i === 0 ? link : '' }));
}

/** Each FB account and its link as the server checks them: names given, no commas, none twice, links on Facebook. */
function checkedProfiles(profiles: readonly FbProfile[]): FbProfile[] {
  const out: FbProfile[] = [];
  for (const p of profiles) {
    const account = p.account.trim();
    const link = checkedProfileLink(p.link);
    if (!account && !link) continue;
    if (!account) throw new UserFacingError(`Type the name of the account for ${link}.`);
    if (account.includes(',')) throw new UserFacingError('A Facebook account name cannot contain a comma.');
    if (out.some((o) => o.account.toLowerCase() === account.toLowerCase())) throw new UserFacingError(`${account} is listed twice.`);
    out.push({ account, link });
  }
  return out;
}

const firstLink = (profiles: readonly FbProfile[]) => profiles.find((p) => p.link)?.link ?? '';

function checkedProfileLink(url: string): string {
  const problem = facebookProfileProblem(url);
  if (problem) throw new UserFacingError(problem);
  return normalizeProfileLink(url);
}

/** The week a queue is saved under, as its Monday: weekOf any real day. '' when it is not one. */
function queueWeek(day: string): string {
  const text = typeof day === 'string' ? day.trim() : '';
  return text && readSheetDate(text) === text ? weekOf(text) : '';
}

/** A queue's start and deadline, checked: real days, the deadline not before the start. */
function checkedWhen(when: QueueWhen): QueueWhen {
  const start = typeof when.start === 'string' ? when.start.trim() : '';
  const due = typeof when.due === 'string' ? when.due.trim() : '';
  if (readSheetDate(start) !== start || readSheetDate(due) !== due || !start || !due) {
    throw new UserFacingError('Pick when the queue starts and when it is due.');
  }
  if (due < start) throw new UserFacingError('The deadline must be on or after the start.');
  return { start, due };
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
  const fbAccounts = readAccounts(row['fbAccounts']);
  const fbProfileLink = asText(row['fbProfileLink']).trim();
  return {
    name,
    role: parseRole(row['role']),
    email: asText(row['email']).trim(),
    fbAccounts,
    ...(fbProfileLink ? { fbProfileLink } : {}),
    fbProfiles: readProfiles(row['fbProfiles'], fbAccounts, fbProfileLink),
    // Only an explicit "no" revokes, as the server's identify() reads the Active cell.
    active: !(active === false || (typeof active === 'string' && active.trim().toUpperCase() === 'FALSE')),
  };
}

function readAssignment(row: Readonly<Record<string, unknown>>): Assignment {
  const date = readSheetDate(row['date']);
  const sent = asText(row['week']).trim();
  return {
    date,
    // The server's week; a server before v6 sends none, and the date's week is read.
    week: isWeekKey(sent) ? sent : assignmentWeek({ date }),
    // v14: the deadline; blank from a server before it, or a row written before it.
    due: readSheetDate(row['due']),
    assignedTo: asText(row['assignedTo']),
    propertyName: asText(row['property']),
    propertyId: asText(row['propertyId']),
    // "Not Shared", or "To post" in rows written before it: the same.
    status: queueStatus(asText(row['status'])),
  };
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
