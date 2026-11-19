import type { User } from '@/core/types';
import { canManage } from '@/core/types';

/**
 * The tours and the getting-started list: what they say, and what they point
 * at. A step points at a live element by its `data-tour` name, so the person
 * sees the real button, not a picture of it. Each step says why before what:
 * the reason a thing is worth doing comes first.
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

const WELCOME_AGENT: Tour = {
  id: 'welcome-agent',
  steps: [
    {
      title: 'Welcome to Post-It',
      body: 'Post your listings on Facebook in a few clicks, and the tracker fills itself in. A quick look around: {steps} steps.',
    },
    {
      target: 'nav-queue',
      title: 'My queue: what to post',
      body: 'Your admin picks these listings for you. Post them before the due date, so none go to someone else.',
    },
    {
      target: 'queue-next',
      title: 'Start here',
      body: 'Next up is the one to post now. Open it to copy its text and photos.',
      optional: true,
    },
    {
      target: 'nav-find',
      title: 'Find any listing',
      body: 'Search the whole library by name, city or type, for a post outside your queue.',
    },
    {
      target: 'help',
      title: 'Help is here',
      body: 'Your getting-started list, and this tour again, any time.',
    },
  ],
};

const WELCOME_ADMIN: Tour = {
  id: 'welcome-admin',
  steps: [
    {
      title: 'Welcome to Post-It',
      body: 'Keep the team posting the right listings, and see what was posted without chasing anyone. A quick look around: {steps} steps.',
    },
    {
      target: 'nav-tracker',
      title: 'Tracker: the week at a glance',
      body: 'Who has posted, who is behind for Friday, and which posts wait for a link.',
    },
    {
      target: 'nav-assign',
      title: 'Assign: give out the listings',
      body: "Fill queues gives every agent a week of listings in one go, so nobody posts the same one. Highlighted listings go first.",
    },
    {
      target: 'nav-interns',
      title: 'Agents: check the work',
      body: "Each agent's progress, a few of their posts to spot check, and anything that needs you.",
    },
    {
      target: 'nav-records',
      title: 'Records: report on it',
      body: 'Posts by week or month, by agent and by type.',
    },
    {
      target: 'nav-queue',
      title: 'My queue: what to post',
      body: 'Here while you have listings to post, or a post waiting for approval. Post before the due date, so none go to someone else.',
      optional: true,
    },
    {
      target: 'nav-settings',
      title: 'Settings: the rules',
      body: "The cooldown, listings a week, the team's FB accounts and the listing library.",
    },
    {
      target: 'help',
      title: 'Help is here',
      body: 'Your getting-started list, and this tour again, any time.',
    },
  ],
};

const LISTING: Tour = {
  id: 'listing',
  scope: (pathname) => pathname.startsWith('/property/'),
  steps: [
    {
      target: 'listing-text',
      title: 'The text to post',
      body: "Only the part that's safe to share: the owner's details and the commission stay out.",
    },
    {
      target: 'listing-copy',
      title: 'Copy it',
      body: 'Checks run first, so a wrong price or phone number never goes out. Then paste it into Facebook.',
      optional: true,
    },
    {
      target: 'listing-reword',
      title: 'Posting it again?',
      body: "Reword gives a fresh caption, so Facebook doesn't see the same post twice.",
      optional: true,
    },
    {
      target: 'listing-photos',
      title: 'The photos',
      body: 'Download them in one go, or copy one straight into your post.',
      optional: true,
    },
    {
      target: 'listing-highlight',
      title: 'Highlight it',
      body: "Want it advertised now? Highlighted listings top every agent's queue.",
      optional: true,
      adminOnly: true,
    },
    {
      target: 'listing-log',
      title: 'Log the post',
      body: "Paste the post's link here once it's up. It counts toward your week, and the listing isn't given to anyone else.",
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

export type TaskId = 'tour' | 'open-listing' | 'copy-text' | 'log-post' | 'highlight' | 'save-queue' | 'spot-check';

export interface Task {
  readonly id: TaskId;
  readonly label: string;
  /** Why it is worth doing, in a few words. */
  readonly why: string;
  /** Show me: where it starts. None for the tour itself, which Show me starts. */
  readonly hint?: TourStep;
}

const AGENT_TASKS: readonly Task[] = [
  { id: 'tour', label: 'Take the tour', why: 'A minute to know your way around.' },
  {
    id: 'open-listing',
    label: 'Open a listing',
    why: 'Its text and photos are ready to post.',
    hint: { route: '/queue', target: 'queue-next', title: 'Open a listing', body: 'Open Next up, or any listing in your queue.' },
  },
  {
    id: 'copy-text',
    label: 'Copy its text',
    why: 'Checked first, then ready to paste into Facebook.',
    hint: { route: '/queue', target: 'queue-next', title: 'Copy its text', body: 'Open a listing, then press Copy beside its text.' },
  },
  {
    id: 'log-post',
    label: 'Log a post with its link',
    why: 'It counts toward your week, and the tracker is right.',
    hint: { route: '/queue', target: 'queue-next', title: 'Log a post', body: "After posting, open the listing and paste the post's link under Log the post." },
  },
];

const ADMIN_TASKS: readonly Task[] = [
  { id: 'tour', label: 'Take the tour', why: 'A minute to know your way around.' },
  {
    id: 'save-queue',
    label: "Give out a week's listings",
    why: 'Every agent knows what to post.',
    hint: { route: '/assign', target: 'assign-fill', title: 'Fill queues', body: 'A week of listings for every agent in one go. Check the preview, then save.' },
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
