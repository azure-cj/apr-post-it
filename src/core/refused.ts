/**
 * Refused posts (v18, AID-189). A post kept on an agent's PC (the outbox) is
 * already on Facebook when it is sent again. If that later save falls inside
 * the cooldown, the server still refuses it, so nothing goes on the tracker,
 * but writes it on the admin sheet's Refused posts tab. An admin sees it on
 * the Interns screen, deals with it on Facebook, and marks it handled.
 */

import { asRecord, asText } from './backend';

/** One row of the Refused posts tab. */
export interface ReportedPost {
  /** The post's key (links.ts postKeyOf): one row per post. */
  readonly postKey: string;
  readonly link: string;
  /** Who logged it. */
  readonly agent: string;
  /** When it was logged on their PC, ISO. */
  readonly loggedAt: string;
  readonly property: string;
  readonly propertyId: string;
  readonly fbAccount: string;
  /** The listing's last post on the tracker, yyyy-MM-dd, and by whom. */
  readonly lastPosted: string;
  readonly lastPostedBy: string;
  /** When the listing could be posted again, yyyy-MM-dd. */
  readonly nextAllowed: string;
  /** Who marked it handled, and when (ISO). Blank while it is open. */
  readonly handledBy: string;
  readonly handledAt: string;
}

/** A Refused posts row, or null when it has no post or no link. */
export function readReportedPost(value: unknown): ReportedPost | null {
  const row = asRecord(value);
  if (!row) return null;
  const text = (name: string): string => asText(row[name]).trim();
  const postKey = text('postKey').toLowerCase();
  const link = text('link');
  if (!postKey || !link) return null;
  return {
    postKey,
    link,
    agent: text('agent'),
    loggedAt: text('loggedAt'),
    property: text('property'),
    propertyId: text('propertyId'),
    fbAccount: text('fbAccount'),
    lastPosted: text('lastPosted'),
    lastPostedBy: text('lastPostedBy'),
    nextAllowed: text('nextAllowed'),
    handledBy: text('handledBy'),
    handledAt: text('handledAt'),
  };
}

/** The ones still waiting for an admin, newest first. */
export function openRefused(posts: readonly ReportedPost[]): readonly ReportedPost[] {
  return posts.filter((p) => !p.handledBy).sort((a, b) => (a.loggedAt < b.loggedAt ? 1 : a.loggedAt > b.loggedAt ? -1 : 0));
}
