/**
 * The domain. Ported from PostIt.Core/Domain/Models.cs, which the C# prototype's
 * 204 tests were written against.
 *
 * Nothing here imports React, Tauri or the DOM, so it runs in the app, in tests,
 * and later in a Cloud Function.
 */

/** Admin assigns the postings and sees everything; an Intern posts. */
export type Role = 'Intern' | 'Admin';

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
  // From the listing checker's Index CSV, joined on the folder id (CONTRACT-v3).
  // All absent when the server has the join turned off.
  /** "Makati", as the checker has it. */
  readonly city?: string;
  /** Size in sqm, as the checker's text: "120", "45.5". */
  readonly size?: string;
  /** The checker's Deal type: "Sale", "Lease". */
  readonly dealType?: string;
  /** The checker's Status. Blank when the checker has no row for this folder. */
  readonly availability?: Availability;
  /** True when the checker's index has this folder at all. */
  readonly inChecker?: boolean;
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
  /** Set by the server when the text was kept from this person (an intern, no separator found). */
  readonly withheld?: boolean;
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

/** A row of the Assignments tab. Row order is posting order. */
export interface Assignment {
  readonly date: string;      // yyyy-MM-dd
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
}

export const defaultSettings: Settings = {
  scriptUrl: '',
  scriptKey: '',
  cooldownDays: 7,
  repostDueDays: 14,
};

/** Thrown for anything the user should read. Everything else is a bug. */
export class UserFacingError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'UserFacingError';
    this.cause = cause;
  }
}

/** A row of the Team tab, as the app may see it: never the key. */
export interface TeamMember {
  readonly name: string;
  readonly role: Role;
  /** Facebook accounts they may post from. Empty or missing means any. */
  readonly fbAccounts?: readonly string[] | undefined;
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
