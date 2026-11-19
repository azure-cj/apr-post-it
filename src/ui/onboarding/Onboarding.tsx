import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from '@/core/types';
import type { Platform } from '@/platform';
import { notesFor, SEEN_VERSION_KEY } from '../releaseNotes';
import { HelpPanel } from './HelpPanel';
import { EMPTY_RECORD, readRecord, withTask, withTour, writeRecord, type OnboardingRecord } from './record';
import { TourOverlay } from './TourOverlay';
import { hintTour, tasksFor, tourFor, welcomeTourFor, type TaskId, type Tour, type TourId } from './tours';

/**
 * Onboarding (1.1.7): the welcome tour once after a person's first sign-in on
 * this PC, the listing tour the first time they open a listing, and Help in
 * the sidebar, with the getting-started list and every tour again. The
 * screens tick the list off with `useOnboarding().complete(...)`.
 */
export interface OnboardingApi {
  /** Starts a tour now, whatever was seen before. 'welcome': the one for this person's role. */
  readonly start: (id: TourId | 'welcome') => void;
  /** The person did this: ticked off the getting-started list. */
  readonly complete: (task: TaskId) => void;
  readonly openHelp: () => void;
  readonly helpOpen: boolean;
  /** "2/4" for the Help button, or null once the list is done or put away. */
  readonly badge: string | null;
}

const NOOP: OnboardingApi = { start: () => {}, complete: () => {}, openHelp: () => {}, helpOpen: false, badge: null };

export const OnboardingContext = createContext<OnboardingApi>(NOOP);

/** The onboarding of the app around this screen. Outside the app (a screen's own test), it does nothing. */
export function useOnboarding(): OnboardingApi {
  return useContext(OnboardingContext);
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
  // No record yet: this person's first sign-in here since tours came.
  const [fresh, setFresh] = useState(false);
  const [active, setActive] = useState<Tour | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const recordRef = useRef<OnboardingRecord | null>(null);
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
    setHelpOpen(false);
    if (!name) return undefined;
    let live = true;
    void readRecord(platform, name).then((found) => {
      if (!live) return;
      let next = found ?? { ...EMPTY_RECORD };
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
      setHelpOpen(false);
      setFresh(false);
      const route = tour.steps[0]?.route;
      if (route && route !== pathname) go(route);
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
      if (!tour || tour.id === 'hint' || !current) return;
      save(withTour(current, tour.id, how));
    },
    [active, save],
  );

  // A tour about a page ends when the person leaves it.
  useEffect(() => {
    if (active?.scope && !active.scope(pathname)) end('skipped');
  }, [active, pathname, end]);

  // Tours that start by themselves: the welcome tour on the home screen after
  // a first sign-in, then the listing tour on the first listing opened. Each
  // waits until nothing else is on top.
  const want: TourId | null = useMemo(() => {
    if (!user || !record || active || updateLaunch === null) return null;
    // An admin's waits for their own queue to be read: it decides whether My queue is a step.
    if (fresh && !updateLaunch && pathname === home) return myQueue === null ? null : welcomeTourFor(user);
    if (!fresh && !record.autoOff && !record.tours.listing && pathname.startsWith('/property/')) return 'listing';
    return null;
  }, [user, record, active, updateLaunch, fresh, pathname, home, myQueue]);

  useEffect(() => {
    if (!want) return undefined;
    let timer = window.setTimeout(function wait() {
      if (quiet()) start(want);
      else timer = window.setTimeout(wait, RETRY_MS);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [want, start]);

  // An update's first launch: the person is no longer new, so the welcome tour won't start by itself later.
  useEffect(() => {
    if (fresh && updateLaunch) setFresh(false);
  }, [fresh, updateLaunch]);

  const tasks = useMemo(() => (user ? tasksFor(user) : []), [user]);
  const doneCount = record ? tasks.filter((t) => record.tasks[t.id]).length : 0;
  const badge = record && !record.listHidden && tasks.length > 0 && doneCount < tasks.length ? `${doneCount}/${tasks.length}` : null;

  const openHelp = useCallback(() => {
    setActive(null);
    setHelpOpen((open) => !open);
  }, []);

  const api = useMemo<OnboardingApi>(
    () => ({
      start: (id) => {
        if (user) start(id === 'welcome' ? welcomeTourFor(user) : id);
      },
      complete,
      openHelp,
      helpOpen,
      badge,
    }),
    [user, start, complete, openHelp, helpOpen, badge],
  );

  const ui = (
    <>
      {active ? <TourOverlay key={`${active.id}-${active.steps[0]?.title ?? ''}`} tour={active} onEnd={end} /> : null}
      {helpOpen && user && record ? (
        <HelpPanel
          tasks={tasks}
          done={(task) => record.tasks[task.id] === true}
          listHidden={record.listHidden}
          onListPage={pathname.startsWith('/property/')}
          onShow={(task) => (task.hint ? start(hintTour(task.hint)) : start(welcomeTourFor(user)))}
          onTour={() => start(welcomeTourFor(user))}
          onListingTour={() => start('listing')}
          onWhatsNew={
            openWhatsNew
              ? () => {
                  setHelpOpen(false);
                  openWhatsNew();
                }
              : undefined
          }
          onHideList={() => save({ ...record, listHidden: true })}
          onShowList={() => save({ ...record, listHidden: false })}
          onClose={() => setHelpOpen(false)}
        />
      ) : null}
    </>
  );

  return { api, ui };
}
