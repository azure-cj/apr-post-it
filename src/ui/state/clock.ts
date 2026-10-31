/**
 * The tracker's calendar is Manila's (Code.gs, CONFIG.TZ): UTC+8 all year, no
 * daylight saving. "Today's queue" and "posted 2 days ago" are counted on it,
 * whatever zone this PC is set to, so the app and the sheet agree on the date.
 */

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The Manila date at `ms` (ms since 1970), as yyyy-MM-dd. */
export function manilaDate(ms: number): string {
  return new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The Manila clock at `ms`, as HH:mm. */
export function manilaTime(ms: number): string {
  return new Date(ms + MANILA_OFFSET_MS).toISOString().slice(11, 16);
}
