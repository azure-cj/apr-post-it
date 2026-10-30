/**
 * The domain. Ported from PostIt.Core/Domain/Models.cs, which the C# prototype's
 * 204 tests were written against.
 *
 * Nothing here imports React, Tauri or the DOM, so it runs in the app, in tests,
 * and later in a Cloud Function.
 */

export type Role = 'Intern' | 'Manager' | 'Admin';

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
export const canManage = (u: User): boolean => u.role === 'Manager' || u.role === 'Admin';
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
}

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

/** A row of the Posts tab. */
export interface PostLogEntry {
  readonly date: string;      // yyyy-MM-dd
  readonly time: string;      // HH:mm
  readonly type: string;
  readonly title: string;
  readonly status: PostStatus;
  readonly fbAccount: string;
  readonly postLink: string;
  readonly postedBy: string;
  readonly propertyId: string;
}

export type AssignmentStatus = 'To post' | 'Pending' | 'Posted';

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
