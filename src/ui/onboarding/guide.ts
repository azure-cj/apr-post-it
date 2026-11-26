import type { TourId } from './tours';

/**
 * Help's guide (1.1.8): how to do each thing, step by step, and what to do
 * when something goes wrong. Searchable from Help. Each step names the
 * buttons as they read on screen; a topic with `show` has a Show me that
 * starts the tour where it happens.
 */

export const GUIDE_GROUPS = ['Posting', 'Photos, flyers and posters', 'Your queue and Find', 'For admins', 'When something goes wrong'] as const;
export type GuideGroup = (typeof GUIDE_GROUPS)[number];

export interface GuideTopic {
  readonly id: string;
  readonly group: GuideGroup;
  readonly title: string;
  readonly steps: readonly string[];
  /** Admins only. Everything else is for everyone: admins post too. */
  readonly adminOnly?: boolean;
  /** Show me: the tour that shows it. */
  readonly show?: TourId;
  /** The tour is about a listing's page: Show me is offered only there. */
  readonly onListing?: boolean;
  /** More words to find it by. */
  readonly keywords?: string;
}

export const GUIDE: readonly GuideTopic[] = [
  // ---------------------------------------------------------------- Posting
  {
    id: 'post-listing',
    group: 'Posting',
    title: 'Post a listing, start to finish',
    show: 'listing',
    onListing: true,
    keywords: 'caption copy facebook share log',
    steps: [
      'Open the listing: press Open on Next up in My queue, or click it in Find.',
      'Press Copy above the posting text. The owner details and the commission are already left out.',
      'On Facebook, make a new post from the FB account shown under Log the post, and paste the text.',
      'Press Download photos, tick the ones you want, and press Download. Add them to the post.',
      "Post it. Then copy the post's link from its date, paste it in Post link, and press Posted.",
    ],
  },
  {
    id: 'reword',
    group: 'Posting',
    title: 'Get a fresh caption (Reword)',
    keywords: 'rewrite paraphrase claude same post again',
    steps: [
      'Posted this listing before? Press Reword above the posting text, so Facebook does not see the same post twice.',
      'Compare Original and Reword by Claude, and pick one.',
      'Press Copy: it copies the one you picked. Reword again gives another.',
    ],
  },
  {
    id: 'cta',
    group: 'Posting',
    title: 'End the post with a call to action',
    keywords: 'viewing schedule cta last line',
    steps: [
      'Tick End with a call to action, under Copy.',
      'Copy then adds one line at the end, asking people to schedule a viewing.',
      'It is words only: no new number or name goes into the post.',
    ],
  },
  {
    id: 'pending',
    group: 'Posting',
    title: 'The group has to approve my post',
    keywords: 'pending approval waiting admin group approve mark posted',
    steps: [
      'After posting, press Pending approval instead of Posted. Paste the link if you have it.',
      'The post waits in My queue, under posts waiting for approval.',
      'Once the group accepts it, press Approved, or Mark posted on the listing, and paste its link.',
    ],
  },
  {
    id: 'cooldown',
    group: 'Posting',
    title: "Why can't I post this one yet? (cooldown)",
    keywords: 'cooldown days recently posted refused not saved',
    steps: [
      'A listing waits some days between posts, so the same one is not posted too often.',
      'The Cooldown box on its page shows when it was last posted, and by which account.',
      'Logged too soon, it says Not saved: still in its cooldown, with the next allowed date. Post another listing instead.',
    ],
  },
  {
    id: 'virtual-office',
    group: 'Posting',
    title: 'Post a virtual office',
    keywords: 'virtual office vo optional highlight',
    steps: [
      'In Find, press the Virtual office chip.',
      'Post one only when an admin highlights it. A highlighted one is at the top of My queue.',
      'Its text is all for posting, so Copy takes all of it. Post and log it like any listing.',
    ],
  },
  {
    id: 'paste',
    group: 'Posting',
    title: 'No text to copy: paste the document',
    show: 'paste',
    onListing: true,
    keywords: 'paste withheld word file no document drive empty',
    steps: [
      'On the listing, press Show me how, or follow these steps.',
      'Press Open in Drive, open the document, then press Ctrl+A and Ctrl+C.',
      'Click the paste box, press Ctrl+V, then press Use this text.',
      'Look over the marked lines, tick I checked it, then press Copy. Owner lines stay out.',
    ],
  },

  // ---------------------------------------------------------------- Photos
  {
    id: 'download',
    group: 'Photos, flyers and posters',
    title: 'Download the photos',
    keywords: 'photos pictures images save folder',
    steps: [
      'On the listing, press Download photos (Alt+P).',
      'Tick the ones you want, then press Download.',
      'They go to Downloads\\APG Post-It, in a folder named after the listing. Open folder shows them.',
      'Copy on a photo copies just that one, to paste straight into Facebook.',
    ],
  },
  {
    id: 'flyer',
    group: 'Photos, flyers and posters',
    title: 'Make a flyer',
    keywords: 'flyer picture image design map satellite',
    steps: [
      'On the listing, press Make a flyer under the photos (Alt+F).',
      'Pick a look: Framed, Big photo or Light.',
      'Click photos to add them or take them out. The numbers are the order they are posted in.',
      'Tick the facts and highlights to show. Add a satellite map page rings the area, never the exact spot.',
      'Copy image pastes a page into Facebook. Save puts every page in the photos folder.',
    ],
  },
  {
    id: 'poster',
    group: 'Photos, flyers and posters',
    title: 'Make a poster',
    keywords: 'poster marketing ad headline story square feed price badge',
    steps: [
      'Press Make a flyer, then pick the Poster look.',
      'Choose Feed, Square or Story. Tick Price badge to show the price on it.',
      'Click a photo to use it. The contacts come from the document.',
      'Press Save the poster: it is saved first in the photos folder. Post it first, then the photos.',
    ],
  },

  // ---------------------------------------------------------------- Queue and Find
  {
    id: 'queue',
    group: 'Your queue and Find',
    title: 'How my queue works',
    show: 'queue',
    keywords: 'queue due deadline next up order behind',
    steps: [
      'Your admin gives you a queue of listings with a due date.',
      'Post them in order. Next up is the one to post now; highlighted ones go first.',
      'What is not posted by the deadline goes to someone else.',
    ],
  },
  {
    id: 'find',
    group: 'Your queue and Find',
    title: 'Find any listing',
    show: 'find',
    keywords: 'search filter category sort',
    steps: [
      'Open Find and type a name, a city or a building. Press / to jump to the search box.',
      'Press a category, or use Show only: For sale, For lease, Ready to post, Never posted, Has photos.',
      'Click a listing to open it.',
    ],
  },
  {
    id: 'reminders',
    group: 'Your queue and Find',
    title: 'Get a reminder to post',
    keywords: 'reminder notification settings hour',
    steps: [
      'Open Settings. Admins: the App tab.',
      'Under Reminders, pick an hour in Remind me to post from.',
      'Remind me after reminds you when you have not posted for some days.',
    ],
  },

  // ---------------------------------------------------------------- Admins
  {
    id: 'fill',
    group: 'For admins',
    title: "Give out a week's listings",
    adminOnly: true,
    show: 'assign',
    keywords: 'assign fill queues week deadline',
    steps: [
      'Open Assign and press Fill queues.',
      'Choose the week, the deadline and how many a week. Untick anyone to leave out.',
      'Press Preview, check it, then press Save all.',
    ],
  },
  {
    id: 'edit-queue',
    group: 'For admins',
    title: "Change one person's queue",
    adminOnly: true,
    keywords: 'assign add remove order drag paste list',
    steps: [
      'Open Assign and click the person.',
      'Search Listings and press Add. To add many names, press ⋯ then Paste a list.',
      'Drag listings into posting order, then press Save queue. Nothing changes until you save.',
    ],
  },
  {
    id: 'highlight',
    group: 'For admins',
    title: 'Highlight a listing',
    adminOnly: true,
    keywords: 'highlight first priority note virtual office',
    steps: [
      'Open the listing and press Highlight. Add a note for the agents if you like.',
      "It tops every agent's queue until you press Remove.",
      'A virtual office post is given out only while it is highlighted.',
    ],
  },
  {
    id: 'check',
    group: 'For admins',
    title: 'Check who posted, and spot check',
    adminOnly: true,
    show: 'interns',
    keywords: 'agents spot check verify who posted facebook link',
    steps: [
      'Tracker shows the day; Agents shows the week, and who is behind.',
      'In Agents, Who posted? finds a listing name or a Facebook link.',
      'Click an agent, then under Spot check open each post and press Verified, Not found or Wrong listing.',
    ],
  },
  {
    id: 'refused',
    group: 'For admins',
    title: 'Posts refused for the cooldown',
    adminOnly: true,
    keywords: 'refused cooldown handled',
    steps: [
      'Agents lists posts the server refused because the listing was still in its cooldown.',
      'Press Open to see one, then Handled once it is sorted out.',
    ],
  },
  {
    id: 'docs',
    group: 'For admins',
    title: "Fix a listing's document",
    adminOnly: true,
    keywords: 'separator document drive rebuild directory no separator',
    steps: [
      'Tracker lists documents to fix under Documents. Press Open doc.',
      "Put the separator line between the posting text and the owner's details. Copy separator on the listing copies it.",
      'Then open Settings, Listings, and press Rebuild directory.',
    ],
  },
  {
    id: 'people',
    group: 'For admins',
    title: 'Add a person, or give a new key',
    adminOnly: true,
    keywords: 'team key access turn off fb accounts',
    steps: [
      'Open Settings, Team, and press Add person. Fill in the name, role and FB accounts.',
      'Lost key? Open the person, and under Access press New key.',
      'Someone leaving? Press Turn off. Turn on brings them back.',
    ],
  },
  {
    id: 'rules',
    group: 'For admins',
    title: 'Change the cooldown or listings a week',
    adminOnly: true,
    keywords: 'rules cooldown queue length per week',
    steps: ['Open Settings, Rules.', 'Change Cooldown, Due for repost, Listings per week or Queue length, then press Save.'],
  },
  {
    id: 'records',
    group: 'For admins',
    title: 'See the totals for a month',
    adminOnly: true,
    show: 'records',
    keywords: 'records report totals summary chart',
    steps: [
      'Open Records and pick a period, like This month.',
      'Read the totals, the chart, and By agent or By category.',
      'Copy summary copies the totals to paste in a chat or a report.',
    ],
  },

  // ---------------------------------------------------------------- Problems
  {
    id: 'copy-off',
    group: 'When something goes wrong',
    title: 'Copy is greyed out',
    keywords: 'copy blocked disabled greyed separator check failed',
    steps: [
      'Read the line under Copy: it says why.',
      'No separator: look over the marked lines, then tick I checked it.',
      "A failed check, like an owner's number or the commission in the text, blocks Copy. Tell your admin.",
      'A sold listing cannot be copied.',
    ],
  },
  {
    id: 'link',
    group: 'When something goes wrong',
    title: "Posted won't take my link",
    keywords: 'link post link not saved url',
    steps: [
      "Copy the link from the post's date, under your name, not from the group's address.",
      'Not saved: still in its cooldown means it was posted recently. Post another listing.',
      'Other errors: check your internet, then press Posted again.',
    ],
  },
  {
    id: 'photos-fail',
    group: 'When something goes wrong',
    title: "Photos won't download",
    keywords: 'photos fail error download drive missing',
    steps: [
      'Check your internet, then press Download again.',
      'Still failing? The photo may have been moved in Drive. Tell your admin.',
      'Photos already downloaded stay in Downloads\\APG Post-It.',
    ],
  },
  {
    id: 'out-of-date',
    group: 'When something goes wrong',
    title: "The list didn't load, or looks out of date",
    keywords: 'refresh offline server error load',
    steps: [
      'Press Refresh, or Try again.',
      'Check your internet. Post-It shows what it last read until it can read again.',
      'Says the server is behind? An admin has to update it. Tell your admin.',
    ],
  },
  {
    id: 'sign-in',
    group: 'When something goes wrong',
    title: "I can't sign in",
    keywords: 'sign in key login access turned off',
    steps: [
      'Use the key your admin gave you, exactly as given.',
      'A turned-off key cannot sign in. Ask your admin for a new key.',
    ],
  },
];

/** The topics this person sees. */
export function guideFor(admin: boolean): readonly GuideTopic[] {
  return GUIDE.filter((t) => admin || !t.adminOnly);
}

/** Every word of the query is somewhere in the topic: its title, its steps or its keywords. */
export function matchesTopic(topic: GuideTopic, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = `${topic.title} ${topic.steps.join(' ')} ${topic.keywords ?? ''}`.toLowerCase();
  return words.every((w) => text.includes(w));
}
