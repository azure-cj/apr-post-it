import type { User } from '@/core/types';
import { canManage } from '@/core/types';

/**
 * The tours and the getting-started list: what they say, and what they point
 * at. A step points at a live element by its `data-tour` name, so the person
 * sees the real button, not a picture of it. Each step says what the thing is,
 * then exactly what to do with it, naming the buttons as they read on screen.
 *
 * The welcome tour, right after a first sign-in, shows where things are. The
 * listing tour, the first time a listing is opened, walks through one post:
 * caption, photos, Facebook, and the logged link. Every other screen has its
 * own tour too (1.1.8), the first time it is opened, and from Help.
 */

/** A screen with a tour of its own: it starts the first time the screen is opened. */
export type ScreenTourId = 'queue' | 'find' | 'tracker' | 'assign' | 'interns' | 'records' | 'settings';
export type TourId = 'welcome-agent' | 'welcome-admin' | 'listing' | 'paste' | ScreenTourId;

export interface TourStep {
  /** The `data-tour` name of the element to point at. None: the step sits in the middle. */
  readonly target?: string;
  readonly title: string;
  /** `{steps}`: how many steps this person's tour has. */
  readonly body: string;
  /** Left out when its element isn't on screen (an empty queue has no Next up). */
  readonly optional?: boolean;
  /** Admins only. */
  readonly adminOnly?: boolean;
  /** Agents only. */
  readonly agentOnly?: boolean;
  /** Go here first (a path), then point. */
  readonly route?: string;
}

export interface Tour {
  readonly id: TourId | 'hint';
  readonly steps: readonly TourStep[];
  /** The tour ends by itself when the person leaves where it is about. */
  readonly scope?: (pathname: string) => boolean;
}

const HELP_STEP: TourStep = {
  target: 'help',
  title: 'Help',
  body: 'Press Help any time for the tours, the first things to do, and how to do everything. Each screen also shows you around the first time.',
};

const DUE = 'Post each one by its due date, or it goes to someone else.';

const WELCOME_AGENT: Tour = {
  id: 'welcome-agent',
  steps: [
    {
      title: 'Welcome to Post-It',
      body: 'You post listings on Facebook from here, and Post-It keeps count for you. Here is where to start, in {steps} steps.',
    },
    {
      target: 'nav-queue',
      title: 'My queue',
      body: `The listings your admin gave you to post. ${DUE}`,
    },
    {
      target: 'queue-next',
      title: 'Open Next up',
      body: 'This is the one to post now. Press Open to see its caption and photos. The first listing you open shows you how to post it.',
      optional: true,
    },
    HELP_STEP,
  ],
};

const WELCOME_ADMIN: Tour = {
  id: 'welcome-admin',
  steps: [
    {
      title: 'Welcome to Post-It',
      body: 'You give agents the listings to post, and check what they posted. Here is where everything is, in {steps} steps.',
    },
    {
      target: 'nav-tracker',
      title: 'Tracker',
      body: 'Where you land. See who has posted this week, who is behind for Friday, and which posts still need a link.',
    },
    {
      target: 'nav-assign',
      title: 'Assign',
      body: 'Give out listings here. Press Fill queues to give every agent a week of listings at once, check the preview, then save. Highlighted listings go out first.',
    },
    {
      target: 'nav-interns',
      title: 'Agents',
      body: "Each agent's week: how far along they are, and anything that needs you. Spot check a few of their posts here by opening them on Facebook.",
    },
    {
      target: 'nav-queue',
      title: 'My queue',
      body: `Here while you have listings to post yourself, or a post waiting for approval. ${DUE}`,
      optional: true,
    },
    {
      target: 'nav-settings',
      title: 'Settings',
      body: "The rules: the cooldown and how many listings a week. Also the team's FB accounts and the listing library.",
    },
    HELP_STEP,
  ],
};

const LISTING: Tour = {
  id: 'listing',
  scope: (pathname) => pathname.startsWith('/property/'),
  steps: [
    {
      target: 'listing-verdict',
      title: 'Ready to post?',
      body: 'This says if the listing can be posted now: Ready to post, Posted recently, Check before posting, or why not.',
      optional: true,
    },
    {
      target: 'listing-text',
      title: 'Copy the caption',
      body: "This is the text to post. The owner's details and the commission are already left out. Press Copy, then paste it into a new Facebook post.",
    },
    {
      target: 'listing-cta',
      title: 'Add a call to action',
      body: 'Tick this and Copy adds one line asking for a viewing. It is words only: no new number or name goes into the post.',
      optional: true,
    },
    {
      target: 'listing-reword',
      title: 'Posted it before? Reword it',
      body: "Press Reword for a fresh caption, so Facebook doesn't see the same post twice. Then press Copy on the new one.",
      optional: true,
    },
    {
      target: 'listing-photos',
      title: 'Download the photos',
      body: 'Press Download photos, tick the ones you want, and press Download. They go to Downloads\\APG Post-It, ready to add to your post. Copy on a photo pastes just that one.',
      optional: true,
    },
    {
      target: 'listing-flyer',
      title: 'Make a flyer or a poster',
      body: 'Press Make a flyer for a picture of the listing: Framed, Big photo, Light, or Poster. Post it first, then the photos.',
      optional: true,
    },
    {
      target: 'listing-highlight',
      title: 'Highlight it',
      body: "Want this listing posted first? Press Highlight. It tops every agent's queue until you take it off.",
      optional: true,
      adminOnly: true,
    },
    {
      target: 'listing-cooldown',
      title: 'The cooldown',
      body: 'A listing waits some days between posts. This shows when it was last posted, and by which account.',
      optional: true,
    },
    {
      target: 'listing-log',
      title: 'Post it, then log the link',
      body: "Post it on Facebook from the FB account shown here. Then copy the post's link from its date, paste it in Post link, and press Posted.",
      optional: true,
    },
    {
      target: 'listing-log',
      title: 'Waiting for approval?',
      body: 'If the group has to approve your post, press Pending approval instead. Once it is approved, find it in My queue and press Mark posted.',
      optional: true,
    },
  ],
};

/**
 * A listing with no text to copy (1.1.8): how to paste the document's text in.
 * Never starts by itself: its Show me how button glows until it is taken once.
 */
const PASTE: Tour = {
  id: 'paste',
  scope: (pathname) => pathname.startsWith('/property/'),
  steps: [
    {
      target: 'listing-text',
      title: 'No text to copy yet',
      body: "Post-It couldn't get this listing's text. You can paste it in yourself. Here is how, in {steps} steps.",
    },
    {
      target: 'paste-drive',
      title: 'Open the document',
      body: "Press Open in Drive to see the listing's folder, and open its document. Press Ctrl+A, then Ctrl+C to copy all of it.",
      optional: true,
    },
    {
      target: 'paste-box',
      title: 'Paste it here',
      body: "Click this box and press Ctrl+V. Paste everything: lines with the owner's details or the commission are marked and left out.",
    },
    {
      target: 'paste-use',
      title: 'Use this text',
      body: 'Press Use this text. Look over the marked lines, tick I checked it, then press Copy. Reword gives a fresh caption.',
    },
  ],
};

const QUEUE: Tour = {
  id: 'queue',
  scope: (pathname) => pathname === '/queue',
  steps: [
    {
      route: '/queue',
      target: 'queue-head',
      title: 'My queue',
      body: "Your listings to post, in your admin's order. Press Refresh if your admin just changed it.",
    },
    {
      target: 'queue-week',
      title: 'This queue',
      body: 'How far along you are, and when it is due. Posted, Pending and Not shared add up to your queue.',
      optional: true,
    },
    {
      target: 'queue-next',
      title: 'Next up',
      body: 'The listing to post now. Press Open to see its caption and photos.',
      optional: true,
    },
    {
      target: 'queue-list',
      title: 'The rest of the queue',
      body: 'Each listing shows Not shared, Pending or Posted. Once the group approves a pending post, press Mark posted, or paste its Post link.',
      optional: true,
    },
    {
      title: 'Highlighted and waiting posts',
      body: 'Highlighted listings show at the top: post those first. Posts waiting for approval show here too. Press Approved once the group accepts one.',
    },
  ],
};

const FIND: Tour = {
  id: 'find',
  scope: (pathname) => pathname === '/find',
  steps: [
    {
      route: '/find',
      target: 'find-search',
      title: 'Search every listing',
      body: 'Type a name, a city or a building. Press / to jump here.',
    },
    {
      target: 'find-chips',
      title: 'Categories',
      body: 'Press a category to see only those. Virtual office posts come first: post one only when an admin highlights it.',
    },
    {
      target: 'find-filters',
      title: 'Show only',
      body: 'Narrow the list: For sale, For lease, Ready to post, Never posted or Has photos. Clear turns them all off.',
    },
    {
      target: 'find-sort',
      title: 'Sort',
      body: 'Best match, Name, Newest, or Last posted.',
    },
    {
      target: 'find-results',
      title: 'Open a listing',
      body: "Click a row to open it. Its pill says if it's Ready, in its cooldown, Sold, or missing its document.",
    },
  ],
};

const TRACKER: Tour = {
  id: 'tracker',
  scope: (pathname) => pathname === '/tracker',
  steps: [
    {
      route: '/tracker',
      target: 'tracker-day',
      title: 'One day at a time',
      body: 'Tracker shows one day. Pick another day, or press Today to come back. Refresh reads it again.',
    },
    {
      target: 'tracker-stats',
      title: 'The day at a glance',
      body: 'Posted, Pending, Agents behind, and Docs to fix. Press Docs to fix to jump to the documents.',
      optional: true,
    },
    {
      target: 'tracker-posts',
      title: "The day's posts",
      body: 'Every post logged that day, and who posted it. Press Open to see it on Facebook. See all in Records shows more.',
      optional: true,
    },
    {
      target: 'tracker-week',
      title: 'This week',
      body: "Each agent's progress and pace. See all opens Agents.",
      optional: true,
    },
    {
      target: 'tracker-docs',
      title: 'Documents to fix',
      body: 'Listings whose document needs work: no separator, no document, no photos. Fix it in Drive, then run Rebuild in Settings.',
      optional: true,
    },
  ],
};

const ASSIGN: Tour = {
  id: 'assign',
  scope: (pathname) => pathname === '/assign',
  steps: [
    {
      route: '/assign',
      target: 'assign-fill',
      title: 'Fill queues',
      body: 'Give every agent a week of listings at once. Choose the week and the deadline, press Preview, check it, then press Save all.',
    },
    {
      target: 'assign-people',
      title: 'Everyone',
      body: "Each person's queue for the week: On track, Behind, Missed or No queue. Click a person to change their queue.",
      optional: true,
    },
    {
      target: 'assign-add',
      title: 'Add listings',
      body: 'Search the library and press Add. To add many at once, press ⋯ then Paste a list.',
      optional: true,
    },
    {
      target: 'assign-queue',
      title: 'The posting order',
      body: 'The queue is posted top to bottom. Drag a listing to move it.',
      optional: true,
    },
    {
      target: 'assign-save',
      title: 'Save queue',
      body: 'Nothing changes for the agent until you press Save queue.',
      optional: true,
    },
    {
      title: 'Highlights and the virtual office',
      body: 'Highlighted listings go out first in every queue. A virtual office post is given out only while it is highlighted.',
    },
  ],
};

const INTERNS: Tour = {
  id: 'interns',
  scope: (pathname) => pathname === '/interns',
  steps: [
    {
      route: '/interns',
      target: 'interns-controls',
      title: "The agents' week",
      body: 'Pick a week. Refresh reads it again.',
    },
    {
      target: 'interns-stats',
      title: 'At a glance',
      body: 'Who was active today, how many posts, and how many agents are behind.',
      optional: true,
    },
    {
      target: 'interns-who',
      title: 'Who posted?',
      body: 'Paste a listing name or a Facebook link to see who posted it, and when.',
      optional: true,
    },
    {
      target: 'interns-list',
      title: 'Each agent',
      body: 'Click an agent to see their queue, their waiting posts and their last weeks. Spot check their posts there.',
      optional: true,
    },
    {
      target: 'interns-spot',
      title: 'Spot check',
      body: 'Open each post on Facebook, then press Verified, Not found or Wrong listing.',
      optional: true,
    },
  ],
};

const RECORDS: Tour = {
  id: 'records',
  scope: (pathname) => pathname === '/records',
  steps: [
    {
      route: '/records',
      target: 'records-period',
      title: 'Pick a period',
      body: 'This week, Last week, This month, Last 30 days, or Custom dates. Copy summary copies the totals to paste anywhere.',
    },
    {
      target: 'records-tiles',
      title: 'The totals',
      body: 'Posts, Pending, Missed, Active agents and the busiest day, each compared with the period before.',
      optional: true,
    },
    {
      target: 'records-chart',
      title: 'Posts over time',
      body: 'Posts per day, or per week for a long period. Point at a bar for its numbers.',
      optional: true,
    },
    {
      target: 'records-breakdown',
      title: 'By agent, by category',
      body: "Each agent's posts, pending and missed, or the posts in each category.",
      optional: true,
    },
  ],
};

const SETTINGS: Tour = {
  id: 'settings',
  scope: (pathname) => pathname === '/settings',
  steps: [
    {
      route: '/settings',
      target: 'settings-tabs',
      title: 'Four tabs',
      body: 'Team: people and their keys. Listings: rebuild the directory. Rules: the cooldown and listings a week. App: theme and reminders.',
      adminOnly: true,
    },
    {
      route: '/settings',
      target: 'settings-panel',
      title: 'Your settings',
      body: 'Pick a theme, and when Post-It reminds you to post. About shows the version you have.',
      agentOnly: true,
    },
  ],
};

const SCREEN_TOURS: Readonly<Record<ScreenTourId, Tour>> = {
  queue: QUEUE,
  find: FIND,
  tracker: TRACKER,
  assign: ASSIGN,
  interns: INTERNS,
  records: RECORDS,
  settings: SETTINGS,
};

/** The tour of the screen at this path: a listing's page, or a screen of its own. None for anywhere else. */
export function pageTourOf(pathname: string): TourId | null {
  if (/^\/property\/[^/]+$/.test(pathname)) return 'listing';
  const key = pathname.replace(/^\//, '');
  return Object.prototype.hasOwnProperty.call(SCREEN_TOURS, key) ? (key as ScreenTourId) : null;
}

export function welcomeTourFor(user: User): TourId {
  return canManage(user) ? 'welcome-admin' : 'welcome-agent';
}

/**
 * The tour, with the steps this person gets: My queue's only while it is in
 * their sidebar (`myQueue`), which an admin's is only while they have a queue
 * or a post waiting for approval (D31). The welcome counts these.
 */
export function tourFor(id: TourId, user: User, myQueue = true): Tour {
  const tour =
    id === 'listing'
      ? LISTING
      : id === 'paste'
        ? PASTE
        : id === 'welcome-admin'
          ? WELCOME_ADMIN
          : id === 'welcome-agent'
            ? WELCOME_AGENT
            : SCREEN_TOURS[id];
  const admin = canManage(user);
  const steps = tour.steps.filter((s) => (admin || !s.adminOnly) && (!admin || !s.agentOnly) && (myQueue || s.target !== 'nav-queue'));
  return { ...tour, steps: steps.map((s) => ({ ...s, body: s.body.replace('{steps}', String(steps.length)) })) };
}

// ---------------------------------------------------------------- getting started

/**
 * 'tour' is no longer on the list: the tour opens by itself, and Help's Take
 * the tour starts it again. Kept, since records written before still have it.
 */
export type TaskId = 'tour' | 'open-listing' | 'copy-text' | 'log-post' | 'highlight' | 'save-queue' | 'spot-check';

export interface Task {
  readonly id: Exclude<TaskId, 'tour'>;
  readonly label: string;
  /** Why it is worth doing, in a few words. */
  readonly why: string;
  /** Show me: where it starts. */
  readonly hint: TourStep;
}

const AGENT_TASKS: readonly Task[] = [
  {
    id: 'open-listing',
    label: 'Open a listing',
    why: 'Its caption and photos are ready to post.',
    hint: { route: '/queue', target: 'queue-next', title: 'Open a listing', body: 'Press Open on Next up, or click any listing in your queue.' },
  },
  {
    id: 'copy-text',
    label: 'Copy its caption',
    why: 'Checked first, then ready to paste into Facebook.',
    hint: { route: '/queue', target: 'queue-next', title: 'Copy its caption', body: 'Open a listing, then press Copy above its caption.' },
  },
  {
    id: 'log-post',
    label: "Log the post's link",
    why: 'It counts toward your week.',
    hint: {
      route: '/queue',
      target: 'queue-next',
      title: "Log the post's link",
      body: "After posting on Facebook, open the listing, paste the post's link under Log the post, and press Posted.",
    },
  },
];

const ADMIN_TASKS: readonly Task[] = [
  {
    id: 'save-queue',
    label: "Give out a week's listings",
    why: 'Every agent knows what to post.',
    hint: {
      route: '/assign',
      target: 'assign-fill',
      title: 'Fill queues',
      body: 'Press Fill queues to give every agent a week of listings at once. Check the preview, then save.',
    },
  },
  {
    id: 'highlight',
    label: 'Highlight a listing',
    why: 'It tops every queue until you take it off.',
    hint: { route: '/find', target: 'nav-find', title: 'Highlight a listing', body: 'Find the listing, open it, and press Highlight on its page.' },
  },
  {
    id: 'spot-check',
    label: 'Spot check a post',
    why: "Make sure what's logged is really on Facebook.",
    hint: { route: '/interns', target: 'interns-spot', title: 'Spot check', body: 'Open a post on Facebook, then say what you found.' },
  },
];

export function tasksFor(user: User): readonly Task[] {
  return canManage(user) ? ADMIN_TASKS : AGENT_TASKS;
}

/** A Show me pointer as a one-step tour. */
export function hintTour(step: TourStep): Tour {
  return { id: 'hint', steps: [step] };
}
