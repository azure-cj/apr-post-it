import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { canManage, type User } from '@/core/types';
import type { Platform } from '@/platform';
import { notesFor, SEEN_VERSION_KEY } from '../releaseNotes';
import { guideFor, walkthroughOf, type GuideTopic } from './guide';
import { NEW_RECORD, readRecord, withTask, withTour, writeRecord, type OnboardingRecord } from './record';
import { TourOverlay } from './TourOverlay';
import { ANY_LISTING, hintTour, pageTourOf, tasksFor, tourFor, welcomeTourFor, type Task, type TaskId, type Tour, type TourId, type TourStep } from './tours';

/**
 * Onboarding (1.1.7): the welcome tour once, opening by itself right after a
 * person's first sign-in on this PC (and on the next sign-in if it never got
 * to show), the listing tour the first time they open a listing, each
 * screen's own tour the first time they open it (1.1.8), and the Help page,
 * with the getting-started list, every tour again, and the guide (1.1.8).
 * The screens tick the list off with `useOnboarding().complete(...)`.
 */

/** A tour the Help page offers. */
export interface HelpTour {
  readonly id: TourId;
  readonly label: string;
  readonly about: string;
}

/** What the Help page shows and does, for the person signed in. */
export interface HelpApi {
  readonly tasks: readonly Task[];
  readonly done: (task: Task) => boolean;
  readonly listHidden: boolean;
  readonly setListHidden: (hidden: boolean) => void;
  /** Show me for a getting-started item. */
  readonly showTask: (task: Task) => void;
  readonly tours: readonly HelpTour[];
  readonly takeTour: (id: TourId) => void;
  /** The guide's topics for this person's role. */
  readonly topics: readonly GuideTopic[];
  /** A topic's walkthrough, on the screens it is about. */
  readonly showTopic: (topic: GuideTopic) => void;
  readonly whatsNew: (() => void) | undefined;
}

/** The tours, in the order the Help page lists them. */
const HELP_TOURS: readonly (HelpTour & { readonly admin?: boolean; readonly agent?: boolean; readonly queue?: boolean })[] = [
  { id: 'queue', label: 'My queue', about: 'Your listings, Next up, and what is due.', queue: true },
  { id: 'listing', label: "A listing's page", about: 'Copy, Reword, photos, then log the post.' },
  { id: 'find', label: 'Find', about: 'Search and narrow down every listing.' },
  { id: 'tracker', label: 'Tracker', about: "The day's posts, and documents to fix.", admin: true },
  { id: 'assign', label: 'Assign', about: "Fill queues, or change one person's queue.", admin: true },
  { id: 'interns', label: 'Agents', about: 'The week, Who posted?, and spot checks.', admin: true },
  { id: 'records', label: 'Records', about: 'Totals for any period.', admin: true },
  { id: 'settings', label: 'Settings', about: 'The team, the rules, reminders and the theme.', admin: true },
  { id: 'settings', label: 'Settings', about: 'Reminders and the theme.', agent: true },
];

/** The tours for this person: admin screens for admins, My queue for an admin only when they have one. */
function toursFor(admin: boolean, myQueue: boolean): readonly HelpTour[] {
  return HELP_TOURS.filter((t) => (admin || !t.admin) && (!admin || !t.agent) && (!t.queue || !admin || myQueue)).map(({ id, label, about }) => ({ id, label, about }));
}
export interface OnboardingApi {
  /** Starts a tour now, whatever was seen before. 'welcome': the one for this person's role. */
  readonly start: (id: TourId | 'welcome') => void;
  /** The person did this: ticked off the getting-started list. */
  readonly complete: (task: TaskId) => void;
  /** Goes to the Help page. */
  readonly openHelp: () => void;
  /** On the Help page. */
  readonly helpOpen: boolean;
  /** The Help page's content; null until the person's record is read. */
  readonly help: HelpApi | null;
  /** "2/4" for the Help button, or null once the list is done or put away. */
  readonly badge: string | null;
  /** The person has taken this tour, or closed it. True until their record is read, so nothing glows and then stops. */
  readonly seen: (id: TourId) => boolean;
}

const NOOP: OnboardingApi = { start: () => {}, complete: () => {}, openHelp: () => {}, helpOpen: false, help: null, badge: null, seen: () => true };

export const OnboardingContext = createContext<OnboardingApi>(NOOP);

/** The onboarding of the app around this screen. Outside the app (a screen's own test), it does nothing. */
export function useOnboarding(): OnboardingApi {
  return useContext(OnboardingContext);
}

const LISTING_PAGE = /^\/property\/[^/]+$/;
/** The Help page. */
export const HELP_PATH = '/help';

/** True once `ok` holds, checking every 100 ms; false after `ms`. */
function until(ok: () => boolean, ms = 5000): Promise<boolean> {
  return new Promise((done) => {
    const began = Date.now();
    const check = () => {
      if (ok()) return done(true);
      if (Date.now() - began >= ms) return done(false);
      window.setTimeout(check, 100);
    };
    check();
  });
}

/** Once on the screen (`there`), clicks the first element matching `selector` when it appears. False when it never does. */
async function clickWhenThere(selector: string, there: () => boolean): Promise<boolean> {
  if (!(await until(there, 3000))) return false;
  let el: HTMLElement | null = null;
  if (!(await until(() => (el = document.querySelector<HTMLElement>(selector)) !== null, 4000)) || !el) return false;
  (el as HTMLElement).click();
  return true;
}

/** How soon after a screen appears a tour may start by itself, and how often it looks again while something is in the way. */
const SETTLE_MS = 700;
const RETRY_MS = 500;

/** Nothing else on top: no question open, and the startup screen gone. */
function quiet(): boolean {
  if (document.querySelector('dialog[open]')) return false;
  const main = document.getElementById('main');
  return !main?.closest('[inert]');
}

export function useOnboardingController({
  user,
  platform,
  pathname,
  home,
  myQueue,
  version,
  go,
  openWhatsNew,
}: {
  readonly user: User | null;
  readonly platform: Pick<Platform, 'readLocal' | 'writeLocal'>;
  readonly pathname: string;
  /** Where this person lands after signing in: the welcome tour starts there. */
  readonly home: string | null;
  /**
   * My queue is in their sidebar: an admin's tour points at it only then (D31).
   * Null until an admin's own queue is read: their welcome tour waits for it.
   */
  readonly myQueue: boolean | null;
  readonly version: string;
  /** Moves to another screen, asking first when Assign has unsaved changes. */
  readonly go: (path: string) => void;
  readonly openWhatsNew?: (() => void) | undefined;
}): { readonly api: OnboardingApi; readonly ui: ReactNode } {
  const [record, setRecord] = useState<OnboardingRecord | null>(null);
  // No record until now: this person's first sign-in here since tours came.
  const [fresh, setFresh] = useState(false);
  const [active, setActive] = useState<Tour | null>(null);
  const helpOpen = pathname === HELP_PATH;
  const recordRef = useRef<OnboardingRecord | null>(null);
  // Where the welcome tour just ended: that screen's own tour waits for the next visit, so two tours don't run back to back.
  const welcomedAt = useRef<string | null>(null);
  // The screen a tour was started for, while the app goes there.
  const arriving = useRef<string | null>(null);
  const pending = useRef<TaskId[]>([]);
  const name = user?.name ?? null;

  // An update's first launch shows What's new, which offers the tour itself:
  // the welcome tour doesn't start on top of it.
  const [updateLaunch, setUpdateLaunch] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void platform
      .readLocal(SEEN_VERSION_KEY)
      .catch(() => null)
      .then((seen) => live && setUpdateLaunch(seen !== null && seen !== version && notesFor(version) !== null));
    return () => {
      live = false;
    };
  }, [platform, version]);

  const save = useCallback(
    (next: OnboardingRecord) => {
      recordRef.current = next;
      setRecord(next);
      if (name) void writeRecord(platform, name, next);
    },
    [platform, name],
  );

  // The person's record, when they sign in.
  useEffect(() => {
    recordRef.current = null;
    setRecord(null);
    setFresh(false);
    setActive(null);
    if (!name) return undefined;
    let live = true;
    void readRecord(platform, name).then((found) => {
      if (!live) return;
      let next = found ?? NEW_RECORD;
      for (const task of pending.current.splice(0)) next = withTask(next, task);
      recordRef.current = next;
      setRecord(next);
      setFresh(found === null);
      if (found === null || next !== found) void writeRecord(platform, name, next);
    });
    return () => {
      live = false;
    };
  }, [platform, name]);

  const start = useCallback(
    (id: TourId | Tour) => {
      if (!user) return;
      // Not known yet (Help, before the read lands): kept, and passed over if My queue isn't there when it comes.
      const tour = typeof id === 'string' ? tourFor(id, user, myQueue !== false) : id;
      // A walkthrough from the guide goes to each step's screen itself (arrive).
      const route = tour.id === 'guide' ? undefined : tour.steps[0]?.route;
      // Going there first: the tour isn't left behind while the screen changes.
      arriving.current = route && route !== pathname ? route : null;
      if (arriving.current) go(route!);
      setActive(tour);
    },
    [user, myQueue, pathname, go],
  );

  const complete = useCallback(
    (task: TaskId) => {
      const current = recordRef.current;
      if (!current) {
        pending.current.push(task);
        return;
      }
      const next = withTask(current, task);
      if (next !== current) save(next);
    },
    [save],
  );

  const end = useCallback(
    (how: 'done' | 'skipped') => {
      const tour = active;
      setActive(null);
      const current = recordRef.current;
      if (!tour || tour.id === 'hint' || tour.id === 'guide' || !current) return;
      if (tour.id.startsWith('welcome')) welcomedAt.current = pathname;
      save(withTour(current, tour.id, how));
    },
    [active, save, pathname],
  );

  // A tour about a page ends when the person leaves it.
  useEffect(() => {
    if (!active?.scope) return;
    if (arriving.current !== null) {
      if (pathname === arriving.current) arriving.current = null;
      return;
    }
    if (!active.scope(pathname)) end('skipped');
  }, [active, pathname, end]);

  // Leaving the screen where the welcome tour ended: its own tour may start next time.
  useEffect(() => {
    if (welcomedAt.current !== null && welcomedAt.current !== pathname) welcomedAt.current = null;
  }, [pathname]);

  // Tours that start by themselves: the welcome tour on the home screen while
  // it is due, then each screen's own tour the first time it is opened (the
  // listing tour on the first listing). Each waits until nothing else is on
  // top: the startup screen, What's new, a question.
  const want: TourId | null = useMemo(() => {
    if (!user || !record || active || updateLaunch === null) return null;
    if (record.welcomeDue) {
      // Someone who used the app before tours came: What's new offers the tour instead.
      if (fresh && updateLaunch) return null;
      // An admin's waits for their own queue to be read: it decides whether My queue is a step.
      return pathname === home && myQueue !== null ? welcomeTourFor(user) : null;
    }
    const page = pageTourOf(pathname);
    if (record.autoOff || page === null || record.tours[page] !== undefined || welcomedAt.current === pathname) return null;
    return page;
  }, [user, record, active, updateLaunch, fresh, pathname, home, myQueue]);

  useEffect(() => {
    if (!want) return undefined;
    let timer = window.setTimeout(function wait() {
      if (quiet()) start(want);
      else timer = window.setTimeout(wait, RETRY_MS);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [want, start]);

  // No record on an update's first launch: they used the app before tours came,
  // so they aren't new, and the welcome tour won't start by itself later.
  useEffect(() => {
    if (!fresh || !updateLaunch) return;
    setFresh(false);
    const current = recordRef.current;
    if (current?.welcomeDue) save({ ...current, welcomeDue: false });
  }, [fresh, updateLaunch, save]);

  const tasks = useMemo(() => (user ? tasksFor(user) : []), [user]);
  const doneCount = record ? tasks.filter((t) => record.tasks[t.id]).length : 0;
  const badge = record && !record.listHidden && tasks.length > 0 && doneCount < tasks.length ? `${doneCount}/${tasks.length}` : null;

  const openHelp = useCallback(() => {
    setActive(null);
    go(HELP_PATH);
  }, [go]);

  const help = useMemo<HelpApi | null>(() => {
    if (!user || !record) return null;
    const admin = canManage(user);
    return {
      tasks,
      done: (task) => record.tasks[task.id] === true,
      listHidden: record.listHidden,
      setListHidden: (hidden) => save({ ...record, listHidden: hidden }),
      showTask: (task) => start(hintTour(task.hint)),
      tours: [{ id: welcomeTourFor(user), label: 'The welcome tour', about: 'Where to start, in a few steps.' }, ...toursFor(admin, myQueue !== false)],
      takeTour: (id) => {
        if (id !== 'listing') return start(id);
        // A listing's tour from Help opens a listing first, as a walkthrough does.
        const steps = tourFor('listing', user, myQueue !== false).steps;
        start({ id: 'guide', steps: steps.map((s, i) => (i === 0 ? { ...s, route: ANY_LISTING } : s)) });
      },
      topics: guideFor(admin),
      showTopic: (topic) => start(walkthroughOf(topic, admin)),
      whatsNew: openWhatsNew,
    };
  }, [user, record, tasks, save, start, myQueue, openWhatsNew]);

  const api = useMemo<OnboardingApi>(
    () => ({
      start: (id) => {
        if (user) start(id === 'welcome' ? welcomeTourFor(user) : id);
      },
      complete,
      openHelp,
      helpOpen,
      help,
      badge,
      seen: (id) => (record ? record.tours[id] !== undefined : true),
    }),
    [user, start, complete, openHelp, helpOpen, help, badge, record],
  );

  // Where the app is now, for a walkthrough that waits for a screen to open.
  const where = useRef(pathname);
  where.current = pathname;
  // Kept in refs: going to a screen changes `go`, and the walkthrough must not start over when it does.
  const goRef = useRef(go);
  goRef.current = go;
  const queueRef = useRef(myQueue);
  queueRef.current = myQueue;
  const arrive = useCallback(
    async (step: TourStep) => {
      const route = step.route;
      if (!route) return;
      if (route !== ANY_LISTING) {
        if (where.current !== route) goRef.current(route);
        return;
      }
      if (LISTING_PAGE.test(where.current)) return;
      // Next up in My queue, else the first listing in Find: opened the way the person would, by its link.
      if (queueRef.current !== false) {
        goRef.current('/queue');
        if (await clickWhenThere('[data-tour="queue-next"] a', () => where.current === '/queue')) return void (await until(() => LISTING_PAGE.test(where.current)));
      }
      goRef.current('/find');
      if (await clickWhenThere('a.find-row__link', () => where.current === '/find')) await until(() => LISTING_PAGE.test(where.current));
    },
    [],
  );

  const ui = active ? <TourOverlay key={`${active.id}-${active.steps[0]?.title ?? ''}`} tour={active} onEnd={end} arrive={arrive} /> : null;

  return { api, ui };
}
