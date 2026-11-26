/**
 * What's new, shown once after an update (and from the version at the
 * sidebar's foot). Newest first. Add an entry with each release, in the same
 * plain words as the release notes: what a person can now do, not how.
 */
export interface ReleaseNotes {
  readonly version: string;
  readonly items: readonly NoteItem[];
}

/** Where an item's Show me goes: a tour, or Help with the getting-started list. */
export type ShowMe = 'welcome-agent' | 'welcome-admin' | 'listing' | 'welcome' | 'help';

/** An item, with a Show me button when it can point at the thing in the app (1.1.7). */
export type NoteItem = string | { readonly text: string; readonly show: ShowMe };

export const noteText = (item: NoteItem): string => (typeof item === 'string' ? item : item.text);

export const RELEASE_NOTES: readonly ReleaseNotes[] = [
  {
    version: '1.1.8',
    items: [
      'A new app icon.',
      'Make a flyer from a listing: three looks, your choice of photos on more pages, and an optional satellite map that rings the area, never the exact spot. Copy a page or save them all.',
      'Or make a poster: a big headline over one photo, with your contacts, for the feed, a square or a story. Post it first, then the photos.',
      'Copy can end the post with a line asking for a viewing.',
      'No text on a listing? Open it in Drive, paste the text, then Copy or Reword it. Owner lines stay out.',
      'The virtual office posts are in Find. Post one when an admin highlights it: no need to open Drive.',
      'The next step glows: Copy, then Download photos, then Posted, so you always know what to press.',
      'A reminder to post, once a day, while your queue has listings left.',
      'Find shows its filters as chips you can clear one at a time.',
      'Admins: Assign shows its filters, keeps Save on top, and says who has a queue.',
      'Admins: Agents shows who is posting, and Records shows posts by agent as bars and copies a summary.',
    ],
  },
  {
    version: '1.1.7',
    items: [
      { text: 'New here? A short tour opens right after your first sign-in and shows you where to start. Skip it any time.', show: 'welcome' },
      { text: 'Help in the sidebar: a getting-started list that ticks itself off as you go, and the tours again.', show: 'help' },
      {
        text: 'The first time you open a listing, a tour walks you through one post: copy the caption, download the photos, post it, and log its link.',
        show: 'listing',
      },
      'Sign in remembers your email, and Forgot password sends you a reset link.',
      'Agents: Settings in your sidebar, for the theme and your reminders.',
      'Admins: give a queue to another admin, or to yourself. It shows as My queue in your sidebar.',
    ],
  },
  {
    version: '1.1.6',
    items: [
      'A listing posted recently can be posted again. It says when it was last posted, and by whom.',
      "Highlighted listings top My queue, with the admin's note: advertise them first.",
      'Admins: highlight a listing on its page. Fill queues and Add give it out first, even in its cooldown.',
    ],
  },
  {
    version: '1.1.5',
    items: [
      "Reword a post with Claude, beside Copy: a fresh Facebook caption with the agency's details. It runs the same checks, and you choose which one to copy.",
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
