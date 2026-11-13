/**
 * Highlighted listings (v19): ones an admin or owner wants advertised now.
 * Every agent sees them at the top of My queue, with the admin's note, and
 * Fill queues gives them out first. A highlight stays until an admin takes
 * it off. Kept on the admin sheet's Highlights tab.
 */

export interface Highlight {
  readonly propertyId: string;
  readonly property: string;
  /** Why, in the admin's words: "Owner drops the price on Friday". May be blank. */
  readonly note: string;
  /** Who highlighted it. */
  readonly by: string;
  /** When, as the server wrote it (ISO with its zone). */
  readonly at: string;
}

export interface HighlightInput {
  readonly propertyId: string;
  readonly property: string;
  /** true highlights it, or changes its note; false takes it off. */
  readonly on: boolean;
  readonly note?: string | undefined;
}

/** The longest note the server keeps. */
export const HIGHLIGHT_NOTE_MAX = 280;

/** A Highlights row, or null without a property id. */
export function readHighlight(value: unknown): Highlight | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Readonly<Record<string, unknown>>;
  const text = (key: string) => (typeof row[key] === 'string' ? (row[key] as string).trim() : '');
  const propertyId = text('propertyId');
  if (!propertyId) return null;
  return { propertyId, property: text('property') || propertyId, note: text('note'), by: text('by'), at: text('at') };
}

/** The highlighted property ids, for a quick "is this one highlighted?". */
export function highlightedIds(highlights: readonly Highlight[] | null | undefined): ReadonlySet<string> {
  return new Set((highlights ?? []).map((h) => h.propertyId));
}
