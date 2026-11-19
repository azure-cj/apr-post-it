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
 * caption, photos, Facebook, and the logged link.
 */

export type TourId = 'welcome-agent' | 'welcome-admin' | 'listing';

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
  body: 'Press Help any time to take this tour again, or to see a short list of first things to do.',
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
      target: 'listing-text',
      title: 'Copy the caption',
      body: "This is the text to post. The owner's details and the commission are already left out. Press Copy, then paste it into a new Facebook post.",
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
      target: 'listing-highlight',
      title: 'Highlight it',
      body: "Want this listing posted first? Press Highlight. It tops every agent's queue until you take it off.",
      optional: true,
      adminOnly: true,
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

export function welcomeTourFor(user: User): TourId {
  return canManage(user) ? 'welcome-admin' : 'welcome-agent';
}

/**
 * The tour, with the steps this person gets: My queue's only while it is in
 * their sidebar (`myQueue`), which an admin's is only while they have a queue
 * or a post waiting for approval (D31). The welcome counts these.
 */
export function tourFor(id: TourId, user: User, myQueue = true): Tour {
  const tour = id === 'listing' ? LISTING : id === 'welcome-admin' ? WELCOME_ADMIN : WELCOME_AGENT;
  const admin = canManage(user);
  const steps = tour.steps.filter((s) => (admin || !s.adminOnly) && (myQueue || s.target !== 'nav-queue'));
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
