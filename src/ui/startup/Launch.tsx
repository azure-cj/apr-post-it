/**
 * The startup screen, over the app while it really starts: the kept key
 * checked with the server (which also says the server's version), the saved
 * listings drawn at once and a fresh list fetched, and the posts and queue for
 * the numbers, all at the same time.
 *
 * It stays at least MIN_MS, then leaves as soon as sign-in is settled and the
 * list is ready, or at MAX_MS whatever is still going: nothing here blocks.
 * A click or any key leaves at once. It crossfades into whatever the app is
 * showing underneath (sign-in, or the home screen), which has been mounted,
 * inert, all along. Once per window: signing out and in again never shows it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { canManage, isAdmin } from '@/core/types';
import { version as APP_VERSION } from '../../../package.json';
import { useApp, useDirectoryList, useStore } from '../state';
import { plotPoints } from './geo';
import { StartupScreen, type StartupLine } from './StartupScreen';
import { count, greetingFor, longDay, startupStats } from './words';

/** The shortest time on screen, so it reads as a moment rather than a flash. */
export const MIN_MS = 1200;
/** The longest: whatever is still loading carries on behind the app. */
export const MAX_MS = 8000;
/** The crossfade into the app. */
export const FADE_MS = 300;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

type Phase = 'showing' | 'leaving' | 'gone';

export interface LaunchProps {
  readonly children?: ReactNode;
  readonly minMs?: number;
  readonly maxMs?: number;
}

export function Launch({ children, minMs = MIN_MS, maxMs = MAX_MS }: LaunchProps) {
  const app = useApp();
  const { session, user, directory, posts, assignments } = app;
  const [phase, setPhase] = useState<Phase>('showing');
  const [minPassed, setMinPassed] = useState(false);
  const [restored, setRestored] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const screenRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);

  const list = useDirectoryList();
  const listStatus = useStore(app.directoryStatus);
  const server = useStore(app.server);
  const postsState = useStore(posts.store);
  const queueState = useStore(assignments.store);

  const leave = useCallback(() => setPhase((p) => (p === 'showing' ? 'leaving' : p)), []);

  // The saved list, at once: the map draws from it before anyone is signed in.
  useEffect(() => {
    let live = true;
    directory
      .restore()
      .catch(() => null)
      .then(() => live && setRestored(true));
    return () => {
      live = false;
    };
  }, [directory]);

  // The numbers on the cards, once we know whose.
  const intern = user !== null && !canManage(user);
  useEffect(() => {
    if (!user) return;
    void posts.refresh(30_000);
    if (intern) void assignments.refresh(60_000);
  }, [user, intern, posts, assignments]);

  // At least MIN_MS; at most MAX_MS.
  useEffect(() => {
    const atLeast = setTimeout(() => setMinPassed(true), minMs);
    const atMost = setTimeout(leave, maxMs);
    return () => {
      clearTimeout(atLeast);
      clearTimeout(atMost);
    };
  }, [minMs, maxMs, leave]);

  const signInSettled = session.status === 'signed-in' || session.status === 'signed-out' || session.status === 'resume-failed';
  const listSettled = user ? listStatus.lastAttempt !== null && !listStatus.refreshing : restored;
  useEffect(() => {
    if (minPassed && signInSettled && listSettled) leave();
  }, [minPassed, signInSettled, listSettled, leave]);

  // A click (on the screen itself) or any key skips it. The key goes no further.
  useEffect(() => {
    if (phase !== 'showing') return undefined;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      leave();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [phase, leave]);

  // Screen readers start on the screen, not on the app beneath it.
  useEffect(() => {
    screenRef.current?.focus({ preventScroll: true });
  }, []);

  // The crossfade, then gone: focus goes where the app's screen would have put it.
  useEffect(() => {
    if (phase !== 'leaving') return undefined;
    const timer = setTimeout(() => setPhase('gone'), reducedMotion ? 0 : FADE_MS);
    return () => clearTimeout(timer);
  }, [phase, reducedMotion]);

  const signedOut = user === null;
  useEffect(() => {
    if (phase !== 'gone') return;
    const main = appRef.current?.querySelector<HTMLElement>('main');
    if (!main) return;
    // Where the screen would have put focus itself: sign-in starts in its first
    // field to type in; every other screen at its heading.
    const field = signedOut
      ? main.querySelector<HTMLElement>('input:not([disabled]):not([type="radio"]):not([type="checkbox"]):not([type="hidden"])')
      : null;
    const target = field ?? main.querySelector<HTMLElement>('h1[tabindex="-1"]') ?? main;
    target.focus({ preventScroll: true });
    // Once, as it goes: later sign-ins move focus themselves.
  }, [phase]);

  // ---- what it says -------------------------------------------------------

  const points = useMemo(() => plotPoints(list ?? []), [list]);
  const listings = list && list.length > 0 ? list.length : null;

  const lines: StartupLine[] = [];
  const steps: boolean[] = [signInSettled];
  if (session.status === 'signed-in') {
    lines.push({ key: 'who', tone: 'ok', text: `Signed in as ${session.user.name}` });
  } else if (session.status === 'signed-out') {
    lines.push({ key: 'who', tone: 'neutral', text: 'Not signed in' });
  } else if (session.status === 'resume-failed') {
    lines.push({ key: 'who', tone: 'fail', text: "Couldn't sign you in" });
  } else {
    lines.push({ key: 'who', tone: 'busy', text: 'Signing in…' });
  }

  if (user) {
    steps.push(server.known);
    if (!server.known) {
      lines.push({ key: 'server', tone: 'busy', text: 'Checking the web app…' });
    } else if (server.versionStatus === 'current') {
      lines.push({ key: 'server', tone: 'ok', text: 'Web app up to date' });
    } else {
      lines.push({
        key: 'server',
        tone: 'fail',
        text: isAdmin(user) ? 'Web app is behind: update it in Settings → App' : 'Web app is behind: tell your admin',
      });
    }
  }

  steps.push(listSettled);
  if (user) {
    if (!listSettled) {
      lines.push({ key: 'list', tone: 'busy', text: listings ? `Loading ${count(listings)} listings…` : 'Loading listings…' });
    } else if (listStatus.error) {
      lines.push({
        key: 'list',
        tone: 'fail',
        text: listings ? "Couldn't reach Google, using saved listings" : "Couldn't reach Google to load the listings",
      });
    } else {
      lines.push({ key: 'list', tone: 'ok', text: `${count(listings ?? 0)} listings ready` });
    }
    steps.push(postsState.data !== null || postsState.error !== null);
    if (intern) steps.push(queueState.data !== null || queueState.error !== null);
  } else if (listings) {
    lines.push({ key: 'list', tone: 'ok', text: `${count(listings)} listings ready` });
  }

  const progress = phase === 'showing' ? steps.filter(Boolean).length / steps.length : 1;
  const greeting = user ? { text: greetingFor(app.now(), user.name), date: longDay(app.now()) } : null;
  const stats = startupStats({ user, listings, posts: postsState.data, assignments: queueState.data, now: app.now() });

  // While the screen is up, the app beneath it can't be reached: not by Tab,
  // not by a screen reader. React 18 passes `inert` through as an attribute.
  const inert = (phase === 'gone' ? {} : { inert: '' }) as HTMLAttributes<HTMLDivElement>;

  return (
    <>
      <div ref={appRef} className="startup-host" {...inert}>
        {children}
      </div>
      {phase === 'gone' ? null : (
        <StartupScreen
          ref={screenRef}
          lines={lines}
          progress={progress}
          greeting={greeting}
          stats={stats}
          points={points}
          appVersion={APP_VERSION}
          reducedMotion={reducedMotion}
          leaving={phase === 'leaving'}
          onSkip={leave}
        />
      )}
    </>
  );
}

/** True while Windows' "Animation effects" is off, followed live. */
export function usePrefersReducedMotion(): boolean {
  const query = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : null;
  const [reduced, setReduced] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const media = query();
    if (!media) return undefined;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return reduced;
}
