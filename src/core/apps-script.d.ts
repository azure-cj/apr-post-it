/**
 * Types for the Apps Script files linked into the app at build time
 * (vite.config.ts, linkAppsScript). The .gs files are the implementation;
 * these only describe them.
 */

declare module '@server/Separators.gs' {
  export interface Cut {
    /** Everything above the first marker: what may be posted. */
    readonly posting: string;
    /** Everything after it. Never shown to an intern. */
    readonly internal: string;
    /** False when no marker was found: nothing is confirmed safe to post (D6). */
    readonly found: boolean;
    /** Which marker the cut was made at, for auditing. '' when none. */
    readonly cutAt: string;
  }

  export function splitAtSeparator_(text: string | null | undefined): Cut;
  export function markerKind_(line: string | null | undefined): string;
  /** 0-based lines of an unseparated document that may hold the owner's or the broker's details (D15). */
  export function flaggedLines_(text: string | null | undefined): number[];
}
