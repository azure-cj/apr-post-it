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
  /** Go here first (a path, or ANY_LISTING), then point. */
  readonly route?: string;
}

/** A step's route meaning "a listing's page": the one already open, else Next up in My queue, else the first in Find. */
export const ANY_LISTING = 'listing';

export interface Tour {
  /** 'hint': a Show me pointer; 'guide': a walkthrough from Help's guide. Neither is kept in the record. */
  readonly id: TourId | 'hint' | 'guide';
  readonly steps: readonly TourStep[];
  /** The tour ends by itself when the person leaves where it is about. */
  readonly scope?: (pathname: string) => boolean;
}

const HELP_STEP: TourStep = {
  target: 'help',
  title: 'Help',
  body: 'Each screen shows you around the first time. Press Help any time for the tours again, and how to do anything.',
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
      body: 'The one to post now. Press Open: the first listing you open shows you how to post it.',
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
      body: 'Give out listings. Fill queues gives every agent a week at once. Highlighted listings go out first.',
    },
    {
      target: 'nav-interns',
      title: 'Agents',
      body: "Each agent's week, anything that needs you, and spot checks of their posts.",
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
      body: 'The team and their keys, the listing library, and the rules: cooldown and listings a week.',
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
      body: 'This says if you can post it now. Posted recently means it is in its cooldown: pick another listing.',
      optional: true,
    },
    {
      target: 'listing-text',
      title: 'Copy the caption',
      body: 'Owner details and commission are already left out. Press Copy, then paste into Facebook. Tick End with a call to action to add a viewing line.',
    },
    {
      target: 'listing-reword',
      title: 'Posted it before? Reword it',
      body: 'Press Reword for a fresh caption, then Copy the one you pick.',
      optional: true,
    },
    {
      target: 'listing-photos',
      title: 'Photos, flyer and poster',
      body: 'Press Download photos and add them to your post. Make a flyer turns them into a flyer or a poster, posted first.',
      optional: true,
    },
    {
      target: 'listing-highlight',
      title: 'Highlight it',
      body: "Press Highlight to put it at the top of every agent's queue, until you take it off.",
      optional: true,
      adminOnly: true,
    },
    {
      target: 'listing-log',
      title: 'Post it, then log the link',
      body: "Post from the FB account shown. Paste the post's link, copied from its date, and press Posted. Group must approve it? Press Pending approval.",
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
      body: "Your listings, in your admin's order, with their due date. Highlighted ones and posts waiting for approval show at the top.",
    },
    {
      target: 'queue-next',
      title: 'Next up',
      body: 'The one to post now. Press Open.',
      optional: true,
    },
    {
      target: 'queue-list',
      title: 'The rest',
      body: 'Each shows Not shared, Pending or Posted. Once the group approves a pending post, press Mark posted.',
      optional: true,
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
      body: 'Type a name, a city or a building. Press / to jump here. Sort changes the order.',
    },
    {
      target: 'find-chips',
      title: 'Narrow it down',
      body: 'Pick a category, or use Show only below it. Virtual office posts come first: post one only when an admin highlights it.',
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
      body: "Pick a day, or press Today. The numbers show posts, pending, agents behind, and documents to fix.",
    },
    {
      target: 'tracker-posts',
      title: "The day's posts",
      body: "Every post that day, and who posted it. Press Open to see it on Facebook. This week shows each agent's pace.",
      optional: true,
    },
    {
      target: 'tracker-docs',
      title: 'Documents to fix',
      body: 'Listings with no separator, no document or no photos. Fix it in Drive, then run Rebuild in Settings.',
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
      body: 'Give everyone a week of listings at once: pick the week and deadline, press Preview, then Save all. Highlighted listings go first.',
    },
    {
      target: 'assign-people',
      title: "One person's queue",
      body: 'Click a person to change their queue: Add from Listings, drag to reorder, then press Save queue.',
      optional: true,
    },
    {
      target: 'assign-save',
      title: 'Save queue',
      body: 'Nothing changes for the agent until you press Save queue.',
      optional: true,
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
      body: 'Pick a week. The numbers show who is active, how many posts, and who is behind.',
    },
    {
      target: 'interns-who',
      title: 'Who posted?',
      body: 'Paste a listing name or a Facebook link to see who posted it.',
      optional: true,
    },
    {
      target: 'interns-list',
      title: 'Each agent',
      body: 'Click an agent for their queue and waiting posts. Spot check there: open each post, then press Verified, Not found or Wrong listing.',
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
      body: 'This week, This month, Custom dates and more. Copy summary copies the totals to paste anywhere.',
    },
    {
      target: 'records-tiles',
      title: 'Totals, chart and breakdown',
      body: 'Each total is compared with the period before. Below: posts over time, then By agent or By category.',
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
      body: 'Team: people and keys. Listings: rebuild the directory. Rules: cooldown and listings a week. App: theme and reminders.',
      adminOnly: true,
    },
    {
      route: '/settings',
      target: 'settings-panel',
      title: 'Your settings',
      body: 'Pick a theme, and when Post-It reminds you to post.',
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
