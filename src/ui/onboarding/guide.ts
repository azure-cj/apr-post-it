import { ANY_LISTING, type Tour, type TourStep } from './tours';

/**
 * Help's guide (1.1.8): how to do each thing, step by step, and what to do
 * when something goes wrong. Searchable from Help. Each step names the
 * buttons as they read on screen. Clicking a topic starts its walkthrough
 * (WALKS): it goes to the screen and lights up each button in turn.
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
  /** More words to find it by. */
  readonly keywords?: string;
}

export const GUIDE: readonly GuideTopic[] = [
  // ---------------------------------------------------------------- Posting
  {
    id: 'post-listing',
    group: 'Posting',
    title: 'Post a listing, start to finish',
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
    keywords: 'paste withheld word file no document drive empty',
    steps: [
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
      "Remind me after reminds you of a post still waiting for a group's approval.",
    ],
  },

  // ---------------------------------------------------------------- Admins
  {
    id: 'fill',
    group: 'For admins',
    title: "Give out a week's listings",
    adminOnly: true,
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

// ---------------------------------------------------------------- walkthroughs

const L = ANY_LISTING;

/**
 * Each topic as a guided walkthrough (1.1.8): clicking a topic in Help goes to
 * the screen it happens on and lights up each button in turn. A step with
 * `route: ANY_LISTING` opens the listing already open, or Next up, or the
 * first in Find. It only points: nothing is copied, posted or saved.
 */
export const WALKS: Readonly<Record<string, readonly TourStep[]>> = {
  'post-listing': [
    { route: '/queue', target: 'queue-next', title: '1. Open the listing', body: 'Next up is the one to post now. Press Open, or pick any listing in Find.', optional: true },
    { route: L, target: 'listing-text', title: '2. Copy the caption', body: 'Press Copy. The owner details and the commission are already left out.' },
    { target: 'listing-log', title: '3. Post from this account', body: 'On Facebook, make a new post from the FB account shown here, and paste the caption.' },
    { target: 'listing-photos', title: '4. Add the photos', body: 'Press Download photos, tick the ones you want, and press Download. Add them to the post.', optional: true },
    { target: 'listing-log', title: '5. Log the link', body: "Post it. Copy the post's link from its date, paste it in Post link, and press Posted." },
  ],
  reword: [
    { route: L, target: 'listing-reword', title: 'Press Reword', body: 'Posted this listing before? Reword writes a fresh caption, so Facebook does not see the same post twice.', optional: true },
    { target: 'listing-text', title: 'Pick one, then Copy', body: 'Choose Original or Reword by Claude. Copy copies the one you picked. Reword again gives another.' },
  ],
  cta: [
    { route: L, target: 'listing-cta', title: 'Tick End with a call to action', body: 'Copy then adds one line asking people to schedule a viewing.' },
    { target: 'listing-copy', title: 'Then press Copy', body: 'It is words only: no new number or name goes into the post.' },
  ],
  pending: [
    { route: L, target: 'listing-log', title: 'Press Pending approval', body: 'Group has to approve your post? Press Pending approval instead of Posted. Paste the link if you have it.' },
    { route: '/queue', target: 'queue-waiting', title: 'It waits here', body: 'Once the group accepts it, press Approved and paste its link.', optional: true },
    { target: 'queue-list', title: 'Or mark it posted', body: 'In the list, a pending listing has Mark posted.', optional: true },
  ],
  cooldown: [
    { route: L, target: 'listing-verdict', title: 'Can I post it now?', body: 'Posted recently means it is still in its cooldown. Pick another listing.' },
    { target: 'listing-cooldown', title: 'When it was last posted', body: 'Its last posts, the date and the account. A listing waits some days between posts.' },
    { target: 'listing-log', title: 'Logged too soon?', body: 'It says Not saved: still in its cooldown, with the next allowed date.' },
  ],
  'virtual-office': [
    { route: '/find', target: 'find-chips', title: 'The Virtual office chip', body: 'Press Virtual office to see the ready-made posts. Post one only when an admin highlights it.' },
    { route: '/queue', target: 'queue-head', title: 'Highlighted ones are on top', body: 'A highlighted virtual office post shows at the top of My queue. Its text is all for posting.', optional: true },
  ],
  paste: [
    { route: L, target: 'paste-drive', title: '1. Open the document', body: 'No text on this listing? Press Open in Drive, open the document, then press Ctrl+A and Ctrl+C.', optional: true },
    { target: 'paste-box', title: '2. Paste it here', body: 'Click the box and press Ctrl+V. Owner lines are marked and left out.', optional: true },
    { target: 'paste-use', title: '3. Use this text', body: 'Press Use this text, look over the marked lines, tick I checked it, then press Copy.', optional: true },
    { title: 'Then Copy as usual', body: 'A listing that already has its text skips these steps: just press Copy.' },
  ],
  download: [
    { route: L, target: 'listing-photos', title: 'Press Download photos', body: 'Or press Alt+P. Tick the ones you want, then press Download.' },
    { target: 'listing-photos', title: 'Where they go', body: 'Downloads\\APG Post-It, in a folder named after the listing. Open folder shows them. Copy on a photo copies just that one.' },
  ],
  flyer: [
    { route: L, target: 'listing-flyer', title: 'Press Make a flyer', body: 'Or press Alt+F. Pick a look: Framed, Big photo or Light.', optional: true },
    { target: 'listing-flyer', title: 'Choose and make it', body: 'Click photos to add them. Tick the facts to show. Copy image pastes a page; Save keeps every page.', optional: true },
    { title: 'Where to find it', body: 'Make a flyer shows on a listing with photos, once Copy is ready, in the desktop app.' },
  ],
  poster: [
    { route: L, target: 'listing-flyer', title: 'Press Make a flyer', body: 'Then pick the Poster look: a big headline over one photo, with your contacts.', optional: true },
    { target: 'listing-flyer', title: 'Size, price, photo', body: 'Choose Feed, Square or Story. Tick Price badge if you like. Click a photo to use it.', optional: true },
    { target: 'listing-flyer', title: 'Post it first', body: 'Press Save the poster: it goes first in the photos folder. Post it first, then the photos.', optional: true },
    { title: 'Where to find it', body: 'Make a flyer shows on a listing with photos, once Copy is ready, in the desktop app.' },
  ],
  queue: [
    { route: '/queue', target: 'queue-head', title: 'Your queue', body: "Your listings, in your admin's order, with their due date. What isn't posted by then goes to someone else." },
    { target: 'queue-next', title: 'Next up', body: 'The one to post now. Highlighted ones go first.', optional: true },
    { target: 'queue-list', title: 'The rest', body: 'Each shows Not shared, Pending or Posted.', optional: true },
  ],
  find: [
    { route: '/find', target: 'find-search', title: 'Search', body: 'Type a name, a city or a building. Press / to jump here.' },
    { target: 'find-chips', title: 'Narrow it down', body: 'Pick a category, or use Show only: For sale, For lease, Ready to post, Never posted, Has photos.' },
    { target: 'find-results', title: 'Open one', body: 'Click a listing to open it.' },
  ],
  reminders: [
    { route: '/settings?tab=app', target: 'settings-reminders', title: 'Reminders', body: "Pick an hour in Remind me to post from. Remind me after: when a post has waited that long for a group's approval.", optional: true },
    { title: 'Reminders need the desktop app', body: 'Reminders show in the Post-It app on your PC, while it is open.' },
  ],
  fill: [
    { route: '/assign', target: 'assign-fill', title: 'Press Fill queues', body: 'It gives every agent a week of listings at once.' },
    { target: 'assign-fill', title: 'Preview, then Save all', body: 'Choose the week, the deadline and how many a week. Untick anyone to leave out. Preview, then Save all.' },
  ],
  'edit-queue': [
    { route: '/assign', target: 'assign-people', title: 'Click the person', body: 'Their queue opens beside the listing library.' },
    { title: 'Add, order, save', body: 'Search Listings and press Add, or ⋯ then Paste a list. Drag to reorder. Press Save queue: nothing changes until then.' },
  ],
  highlight: [
    { route: L, target: 'listing-highlight', title: 'Press Highlight', body: "Add a note for the agents if you like. It tops every agent's queue until you press Remove." },
    { route: '/find', target: 'find-chips', title: 'Virtual office posts', body: 'A virtual office post is given out only while it is highlighted.' },
  ],
  check: [
    { route: '/tracker', target: 'tracker-posts', title: 'Today on Tracker', body: 'Every post logged today, and who posted it.', optional: true },
    { route: '/interns', target: 'interns-who', title: 'Who posted?', body: 'Paste a listing name or a Facebook link to see who posted it.', optional: true },
    { target: 'interns-list', title: 'Spot check', body: 'Click an agent. Under Spot check, open each post and press Verified, Not found or Wrong listing.', optional: true },
  ],
  refused: [
    { route: '/interns', target: 'interns-controls', title: 'Refused posts', body: 'Posts the server refused for the cooldown are listed at the top of Agents, when there are any.' },
    { title: 'Handle each one', body: 'Press Open to see one, then Handled once it is sorted out.' },
  ],
  docs: [
    { route: '/tracker', target: 'tracker-docs', title: 'Documents to fix', body: 'Press Open doc. Put the separator line between the posting text and the owner details.', optional: true },
    { route: '/settings?tab=listings', target: 'settings-tabs', title: 'Then rebuild', body: 'In Listings, press Rebuild directory, so the app reads the fixed document.' },
  ],
  people: [
    { route: '/settings?tab=team', target: 'settings-add', title: 'Add person', body: 'Fill in the name, the role and their FB accounts.', optional: true },
    { target: 'settings-panel', title: 'Keys and access', body: 'Open a person. Under Access, New key replaces a lost key; Turn off stops their access.' },
  ],
  rules: [
    { route: '/settings?tab=rules', target: 'settings-panel', title: 'The rules', body: 'Change Cooldown, Due for repost, Listings per week or Queue length, then press Save.' },
  ],
  records: [
    { route: '/records', target: 'records-period', title: 'Pick a period', body: 'This month, Last 30 days, or Custom dates. Copy summary copies the totals.' },
    { target: 'records-tiles', title: 'Read the totals', body: 'Then the chart and By agent or By category below.', optional: true },
  ],
  'copy-off': [
    { route: L, target: 'listing-text', title: 'Read the line under Copy', body: 'It says why Copy is off. No separator: look over the marked lines, then tick I checked it.' },
    { target: 'listing-verdict', title: 'Blocked?', body: "A failed check, like an owner's number in the text, blocks Copy. A sold listing can't be copied. Tell your admin." },
  ],
  link: [
    { route: L, target: 'listing-log', title: 'The right link', body: "Copy it from the post's date, under your name, not from the group's address." },
    { target: 'listing-cooldown', title: 'Still in its cooldown?', body: 'Not saved: still in its cooldown means it was posted recently. Post another listing.', optional: true },
  ],
  'photos-fail': [
    { route: L, target: 'listing-photos', title: 'Try again', body: 'Check your internet, then press Download again. Still failing? The photo may have moved in Drive: tell your admin.' },
  ],
  'out-of-date': [
    { route: '/find', target: 'find-search', title: 'Refresh', body: 'Press Refresh at the top, or Try again. Post-It shows what it last read until it can read again.' },
    { title: 'Server behind?', body: 'If it says the server is behind, an admin has to update it. Tell your admin.' },
  ],
  'sign-in': [
    { title: 'Signing in', body: 'Use the key your admin gave you, exactly as given. A turned-off key cannot sign in: ask your admin for a new one.' },
  ],
};

/** A topic's walkthrough, with the steps this person gets. */
export function walkthroughOf(topic: GuideTopic, admin: boolean): Tour {
  const steps = (WALKS[topic.id] ?? [{ title: topic.title, body: topic.steps.join(' ') }]).filter(
    (s) => (admin || !s.adminOnly) && (!admin || !s.agentOnly),
  );
  return { id: 'guide', steps };
}
