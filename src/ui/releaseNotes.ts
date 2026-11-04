/**
 * What's new, shown once after an update (and from the version at the
 * sidebar's foot). Newest first. Add an entry with each release, in the same
 * plain words as the release notes: what a person can now do, not how.
 */
export interface ReleaseNotes {
  readonly version: string;
  readonly items: readonly string[];
}

export const RELEASE_NOTES: readonly ReleaseNotes[] = [
  {
    version: '1.1.1',
    items: [
      'Sign in with your Alpha Listing Hub account. No more keys.',
      "A post that can't be saved is kept on this PC and sent again, never twice.",
      'Posts waiting for approval are listed in My queue, with a daily reminder.',
      'Pick which photos to download.',
      'Warnings from Wednesday when the week is behind.',
      'Check for updates, and the version, at the foot of the sidebar.',
    ],
  },
];

/** Where this PC keeps the last version whose notes were shown. */
export const SEEN_VERSION_KEY = 'whatsNewSeen';

/** The notes for `version`, or null when there are none. */
export function notesFor(version: string): ReleaseNotes | null {
  return RELEASE_NOTES.find((r) => r.version === version) ?? null;
}
