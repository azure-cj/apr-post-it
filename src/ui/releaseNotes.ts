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
    version: '1.1.5',
    items: [
      'Copy one photo in Download photos and paste it straight into a Facebook post.',
      "WebP photos download as JPG, ready for Facebook. The photos on Drive aren't changed.",
      "Only a Facebook post's link is accepted, and a post someone else already logged is refused.",
      "Admins: spot check 3 of each agent's posts a week on the Agents screen.",
      'Admins: a post saved late and refused for the cooldown now comes to you on the Agents screen.',
      'Admins: Copy separator, for a document that has none.',
    ],
  },
  {
    version: '1.1.4',
    items: [
      "Queues run 1, 2 or 3 working weeks; weekends don't count.",
      'A queue saved on Friday carries on Monday.',
      'Set the default length in Settings → Rules, or pick it per queue in Assign.',
    ],
  },
  {
    version: '1.1.3',
    items: [
      "The team comes from Alpha Listing Hub's People screen: add people, give roles and turn them off there.",
      "Interns are now called Agents, as on Alpha Listing Hub.",
      'Settings → Team sets each person’s FB accounts and profile links.',
    ],
  },
  {
    version: '1.1.2',
    items: [
      'Warnings from Wednesday when your week is behind: what is left, and how many a day.',
      'Admins see who is behind for Friday on Agents.',
      "This What's new, after each update. Click the version in the sidebar to see it again.",
    ],
  },
  {
    version: '1.1.1',
    items: [
      'Sign in with your Alpha Listing Hub account. No more keys.',
      "A post that can't be saved is kept on this PC and sent again, never twice.",
      'Posts waiting for approval are listed in My queue, with a daily reminder.',
      'Pick which photos to download.',
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
