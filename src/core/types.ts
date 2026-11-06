/**
 * The domain. Ported from PostIt.Core/Domain/Models.cs, which the C# prototype's
 * 204 tests were written against.
 *
 * Nothing here imports React, Tauri or the DOM, so it runs in the app, in tests,
 * and later in a Cloud Function.
 */

/** Admin assigns the postings and sees everything; an Intern posts. */
export type Role = 'Intern' | 'Admin';

/** A role as the app says it: the Intern role is called Agent on screen, as Alpha Listing Hub does. */
export function roleWord(role: Role | string): string {
  return role === 'Intern' ? 'Agent' : role;
}

export interface User {
  readonly name: string;
  readonly role: Role;
  /** Facebook accounts this person may post from. Empty means any. */
  readonly fbAccounts: readonly string[];
}

/**
 * Manager powers. Ask this rather than testing for 'Manager', or an admin
 * silently loses the screens they are meant to have.
 */
export const canManage = (u: User): boolean => u.role === 'Admin';
export const isAdmin = (u: User): boolean => u.role === 'Admin';

/** First letters of the first two words: "Jan Dela Cruz" → "JD". */
export function initials(name: string): string {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/** One listing. `id` is the Drive folder id: folders get renamed, ids do not. */
export interface Property {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  /** "For sale", "FOR LEASE/ FOR RENT" — blank where the category has no such level. */
  readonly listingType: string;
  /** The extra level some categories have: "Lot", "House & Lot". Usually blank. */
  readonly subCategory: string;
  readonly photoCount: number;
  /** The directory flagged something: no document, no photos, no separator. */
  readonly hasIssues: boolean;
  /**
   * The directory's Issues text, as BuildDirectory.gs wrote it ("No document ·
   * No photos"). Absent from a server that does not send it yet.
   */
  readonly issues?: string;
  /**
   * The posting document's Drive id (the directory's DocId column), for an
   * admin's "Open doc". Absent for an intern, for a folder with no document,
   * and from a server before v7.
   */
  readonly docId?: string;
  // From the listing checker's Index CSV, joined on the folder id (CONTRACT-v3).
  // All absent when the server has the join turned off.
  /** "Makati", as the checker has it. */
  readonly city?: string;
  /** Size in sqm, as the checker's text: "120", "45.5". */
  readonly size?: string;
  /** The checker's Deal type: "Sale", "Lease". */
  readonly dealType?: string;
  /** The checker's "Building / street", for search. */
  readonly building?: string;
  /** When the checker first indexed the folder (its Created), as yyyy-MM-dd: for Find's "Newest". */
  readonly created?: string;
  /** The checker's Status. Blank when the checker has no row for this folder. */
  readonly availability?: Availability;
  /** True when the checker's index has this folder at all. */
  readonly inChecker?: boolean;
  // From the owner's geocoding sheet, joined on the folder id (server/README.md).
  // Both or neither: absent when the listing has no good position.
  /** Latitude, degrees north. */
  readonly lat?: number;
  /** Longitude, degrees east. */
  readonly lng?: number;
}

/** A listing's Status in the checker's index. Blank: unknown. */
export type Availability = 'Available' | 'Sold' | '';

export interface Photo {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly thumb: string;
}

/** A listing opened: the text, the photos, and what the directory thought of it. */
export interface PropertyDetail extends Property {
  readonly publicText: string;
  /** Present only for a manager or admin. Absent means "not yours to see". */
  readonly internalText?: string;
  readonly hasInternal: boolean;
  /** Set by the server when the text was kept from this person (an intern, and no document or no text). */
  readonly withheld?: boolean;
  /**
   * True when nobody has separated the document and the server sent it whole
   * anyway, to be checked before posting (D15). Only a v7 server sends it, and
   * only to an intern. Without it, an intern's unseparated document stays withheld.
   */
  readonly unseparated?: boolean;
  /**
   * With `unseparated`: 0-based lines of publicText that may hold the owner's
   * or the broker's details. Marked on screen and never copied (copyTextFor).
   */
  readonly flaggedLines?: readonly number[];
  /** Which marker the text was cut at, for auditing. Blank when none was found. */
  readonly cutAt: string;
  readonly issues: string;
  /** True when the text was re-read from the document rather than taken from the sheet. */
  readonly live: boolean;
  readonly photos: readonly Photo[];
  readonly folder: string;
}

export type CheckStatus = 'pass' | 'warn' | 'fail';

/** One line of the pre-post checks. A 'fail' blocks Copy; a 'warn' asks for a second look. */
export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export type PostStatus = 'Posted' | 'Pending';

/**
 * A row of the Posts tab. Its columns are the interns' own sheet's ("POSTING
 * TRACKER - INTERNS"): Date, Property type, Property title, FB account name,
 * Link, Time posted, Share posting; then Posted by and Property ID.
 */
export interface PostLogEntry {
  readonly date: string;      // yyyy-MM-dd
  readonly time: string;      // HH:mm (the sheet writes "10:23 AM"; the server gives it back as HH:mm)
  /** Property type: the listing's category, title cased ("Commercial Space"). */
  readonly type: string;
  readonly title: string;
  readonly status: PostStatus;
  readonly fbAccount: string;
  readonly postLink: string;
  readonly postedBy: string;
  readonly propertyId: string;
}

/**
 * A queue item's status. "Not Shared" is the interns' own word for a slot
 * assigned but not posted yet; rows written before it say "To post", and
 * are read as Not Shared (queueStatus).
 */
export type AssignmentStatus = 'Not Shared' | 'Pending' | 'Posted';

export const NOT_SHARED = 'Not Shared' as const;

/** A queue status as the sheet has it: Posted, Pending, or else Not Shared ("To post" included). */
export function queueStatus(value: unknown): AssignmentStatus {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (s === 'posted') return 'Posted';
  if (s === 'pending') return 'Pending';
  return NOT_SHARED;
}

/**
 * A row of the Assignments tab. Row order is posting order. Queues are weekly
 * (v6): the Date column holds the week key (its Monday); rows written before
 * v6 hold a day, and are read as the week that day is in.
 */
export interface Assignment {
  /** The Date cell as written, yyyy-MM-dd: a week key, or an older row's day. */
  readonly date: string;
  /**
   * The queue's week, as its Monday: tracker.assignments() always sets it
   * ('' when the date can't be read). For rows built elsewhere, read the week
   * with week.assignmentWeek(row), which falls back to weekOf(date).
   */
  readonly week?: string | undefined;
  /**
   * v14: the queue's deadline, yyyy-MM-dd, from the Due column; the Date is
   * then the queue's start. Missing or blank: a one-week queue, due the
   * Friday of its week (queues.assignmentPeriod reads both).
   */
  readonly due?: string | undefined;
  readonly assignedTo: string;
  readonly propertyName: string;
  readonly propertyId: string;
  readonly status: AssignmentStatus;
}

/** What the cooldown decided. */
export interface CooldownState {
  readonly blocked: boolean;
  readonly lastPosted?: string;
  readonly nextAllowed?: string;
  readonly daysAgo?: number;
  /** The sentence to show. Empty when not blocked. */
  readonly message: string;
}

export interface Settings {
  readonly scriptUrl: string;
  readonly scriptKey: string;
  readonly cooldownDays: number;
  readonly repostDueDays: number;
  /** How many listings the planner and the quick fill give each intern for a week by default. */
  readonly perWeek: number;
  /** @deprecated The old name of perWeek, kept equal to it while the screens switch. */
  readonly perIntern: number;
  /** v14: how many weeks of working days a new queue runs by default, 1 to 3. */
  readonly queueWeeks: number;
}

export const defaultSettings: Settings = {
  scriptUrl: '',
  scriptKey: '',
  cooldownDays: 7,
  repostDueDays: 14,
  perWeek: 40,
  perIntern: 40,
  queueWeeks: 2,
};

/**
 * The rules the admin sets from the app (server action `setRules`), kept on
 * the Settings tab of the admin sheet and sent with every `ping`. The server's
 * cooldown check uses the same values.
 */
export interface ServerRules {
  /** Days before a listing may be posted again. */
  readonly cooldownDays: number;
  /** Days without a post after which a listing is due for a repost. */
  readonly repostDueDays: number;
  /** v6: the planner's and the quick fill's default number of listings per intern per week. */
  readonly perWeek: number;
  /** @deprecated The old name of perWeek: the same value, kept while the screens switch. */
  readonly perIntern: number;
  /** v14: how many weeks of working days a new queue runs by default, 1 to 3. A server before v14 sends none: 2. */
  readonly queueWeeks: number;
}

/** The defaults, which are also Code.gs's CONFIG defaults. */
export const DEFAULT_RULES: ServerRules = Object.freeze({
  cooldownDays: defaultSettings.cooldownDays,
  repostDueDays: defaultSettings.repostDueDays,
  perWeek: defaultSettings.perWeek,
  perIntern: defaultSettings.perWeek,
  queueWeeks: defaultSettings.queueWeeks,
});

/** The whole numbers each rule may be, inclusive. Code.gs's ruleSpecs_ holds the same. */
export const RULE_LIMITS: Readonly<Record<keyof ServerRules, { readonly min: number; readonly max: number; readonly label: string }>> =
  Object.freeze({
    cooldownDays: { min: 1, max: 60, label: 'The cooldown' },
    repostDueDays: { min: 1, max: 120, label: 'The repost age' },
    perWeek: { min: 1, max: 200, label: 'Listings per week' },
    /** @deprecated perWeek's old name: the same limits. */
    perIntern: { min: 1, max: 200, label: 'Listings per week' },
    queueWeeks: { min: 1, max: 3, label: 'The queue length' },
  });

/** How the server's version compares with the one this app was built for. */
export type ServerVersionStatus = 'current' | 'behind' | 'unknown';

/** The `directoryStatus` reply: how a rebuild of the directory sheet is going. */
export interface DirectoryBuildStatus {
  /** A build is scheduled or under way. */
  readonly running: boolean;
  /** Listings written so far. */
  readonly done: number;
  /** Listings queued in this build. */
  readonly total: number;
  /** When the last build finished, as the server sent it (ISO, Manila). Blank when none has. */
  readonly builtAt: string;
}

/** Thrown for anything the user should read. Everything else is a bug. */
export class UserFacingError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'UserFacingError';
    this.cause = cause;
  }
}

/** One Facebook account a person posts as, and its profile link ('' when none). */
export interface FbProfile {
  readonly account: string;
  readonly link: string;
}

/** A row of the Team tab, as the app may see it: never the key. */
export interface TeamMember {
  readonly name: string;
  readonly role: Role;
  /**
   * Their FB broker name(s): the Facebook account name they post as, which is
   * what they pick as "FB account name" when logging. Empty or missing means any.
   */
  readonly fbAccounts?: readonly string[] | undefined;
  /** The first account's profile link. Missing when the Team tab has none. */
  readonly fbProfileLink?: string | undefined;
  /** Each FB account with its own profile link, in fbAccounts' order. */
  readonly fbProfiles?: readonly FbProfile[] | undefined;
  readonly email?: string | undefined;
  /** False once revoked on the Team tab. Missing means active. */
  readonly active?: boolean | undefined;
}

/** The `indexCheck` reply: how the Directory sheet and the checker's index disagree. */
export interface IndexCheck {
  /** When the server compared them, as it sent it. */
  readonly checkedAt: string;
  readonly directoryCount: number;
  readonly checkerCount: number;
  /** In the Directory, missing from the checker's index. */
  readonly directoryOnly: readonly { readonly id: string; readonly name: string }[];
  /** In the checker's index, missing from the Directory. */
  readonly checkerOnly: readonly { readonly id: string; readonly name: string; readonly path: string }[];
  /** In the Directory, and Sold in the checker. */
  readonly sold: readonly { readonly id: string; readonly name: string }[];
}
