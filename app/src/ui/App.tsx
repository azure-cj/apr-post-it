import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { canManage, isAdmin, UserFacingError, type User } from '@/core/types';
import { Button, Card, Notice, Spinner, TopBar, type TopBarNavItem } from './components';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { SignInScreen } from './screens/SignInScreen';
import { FindScreen, LogPostScreen, PropertyScreen, QueueScreen } from './screens/intern';
import { paths, sectionOf, useApp, useStore, type NavKey } from './state';
import './App.css';

export { paths } from './state';

/** Where a person lands after signing in: an intern's queue, a manager's tracker. */
export function homeFor(user: User): string {
  return canManage(user) ? paths.tracker : paths.queue;
}

interface NavDef {
  readonly key: NavKey;
  readonly label: string;
  readonly path: string;
}

/**
 * The destinations a role gets, in order (docs/ROLES.md). Hiding a screen is
 * convenience only: the server enforces what each key may do.
 */
export function navFor(user: User): readonly NavDef[] {
  if (canManage(user)) {
    const items: NavDef[] = [
      { key: 'tracker', label: 'Tracker', path: paths.tracker },
      { key: 'assign', label: 'Assign', path: paths.assign },
      { key: 'find', label: 'Find', path: paths.find },
    ];
    if (isAdmin(user)) items.push({ key: 'settings', label: 'Settings', path: paths.settings });
    return items;
  }
  return [
    { key: 'queue', label: 'My queue', path: paths.queue },
    { key: 'find', label: 'Find', path: paths.find },
  ];
}

const navKeys: readonly NavKey[] = ['queue', 'find', 'tracker', 'assign', 'settings'];

/**
 * Which nav item a path belongs to. A property and its log page belong to
 * whichever list opened them (`state.section`), and to Find otherwise.
 */
function navKeyFor(pathname: string, state: unknown): NavKey | null {
  const first = pathname.split('/')[1] ?? '';
  if (first === 'property') return sectionOf(state);
  return navKeys.includes(first as NavKey) ? (first as NavKey) : null;
}

/** The window's name for a screen. A property and its log page name themselves after the listing. */
function titleFor(pathname: string): string | null {
  if (pathname.startsWith('/property/')) return null;
  const titles: Record<string, string> = {
    '/sign-in': 'Sign in',
    '/find': 'Find a property',
    '/queue': 'My queue',
    '/assign': 'Assign',
    '/tracker': 'Tracker',
    '/settings': 'Settings',
    '/kit': 'UI kit',
  };
  return titles[pathname] ?? 'APG Post-It';
}

/** The development-only reference of every component. Not in the production build. */
const KitScreen = import.meta.env.DEV ? lazy(() => import('./screens/KitScreen')) : null;

export interface AppProps {
  /** On the demo platform in a browser: the sign-in screen says which keys it answers to. */
  readonly demo?: boolean | undefined;
}

/** React Router v7's behaviour, adopted now. Tests pass the same to their routers. */
export const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

/**
 * The window: the top bar, the screen, and toasts. A hash router, because a
 * desktop app has no server to answer a deep link: `#/queue` survives a reload.
 * Needs an <AppStateProvider> above it.
 */
export function App(props: AppProps) {
  return (
    <HashRouter future={routerFuture}>
      <AppShell {...props} />
    </HashRouter>
  );
}

/** The app inside whatever router the caller provides: tests use a MemoryRouter. */
export function AppShell({ demo = false }: AppProps) {
  const app = useApp();
  const { session, user } = app;
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const lastPath = useRef(location.pathname);
  const queueCount = useQueueCount(user);

  // Name the window after the screen.
  useEffect(() => {
    const title = titleFor(location.pathname);
    if (title) document.title = `${title} · APG Post-It`;
  }, [location.pathname]);

  // After moving to another screen: back to the top, and a screen reader
  // starts at the new heading, unless the screen already put focus inside
  // itself. Compared with the last path rather than "skip the first run", so
  // StrictMode's second run of effects doesn't move focus on arrival.
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    (document.scrollingElement ?? document.documentElement).scrollTop = 0;
    const main = mainRef.current;
    if (!main || main.contains(document.activeElement)) return;
    (main.querySelector<HTMLElement>('h1[tabindex="-1"]') ?? main).focus({ preventScroll: true });
  }, [location.pathname]);

  const { signIn } = app;
  const handleSignIn = useCallback(
    async (url: string, key: string) => {
      setSignInError(null);
      setSignInBusy(true);
      try {
        const signedIn = await signIn(url, key);
        navigate(homeFor(signedIn), { replace: true });
      } catch (e) {
        setSignInError(
          e instanceof UserFacingError
            ? e.message
            : "Couldn't reach the web app. Check the link and your connection, then try again.",
        );
      } finally {
        setSignInBusy(false);
      }
    },
    [signIn, navigate],
  );

  const { signOut } = app;
  const confirmSignOut = useCallback(async () => {
    await signOut();
    setConfirmingSignOut(false);
    setSignInError(null);
    navigate(paths.signIn, { replace: true });
  }, [signOut, navigate]);

  const nav = user ? navFor(user) : [];
  const topBarNav: TopBarNavItem[] = nav.map((item) => ({
    key: item.key,
    label: item.label,
    href: `#${item.path}`,
    ...(item.key === 'queue' && queueCount > 0
      ? { count: queueCount, countLabel: `${queueCount} left in your queue today` }
      : {}),
  }));

  const skipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const main = mainRef.current;
    (main?.querySelector<HTMLElement>('h1[tabindex="-1"]') ?? main)?.focus();
  };

  const guard = (screen: ReactElement, allow?: (u: User) => boolean): ReactElement => {
    if (!user) return <Navigate to={paths.signIn} replace />;
    if (allow && !allow(user)) return <Navigate to={homeFor(user)} replace />;
    return screen;
  };

  const home = user ? <Navigate to={homeFor(user)} replace /> : <Navigate to={paths.signIn} replace />;

  const settled = session.status === 'signed-in' || session.status === 'signed-out';

  return (
    <>
      <a className="skip-link" href="#main" onClick={skipToContent}>
        Skip to content
      </a>

      <div className="shell">
        <TopBar
          nav={topBarNav}
          currentKey={navKeyFor(location.pathname, location.state)}
          user={user ? { name: user.name, role: user.role } : null}
          onNavigate={(key) => {
            const target = nav.find((n) => n.key === key);
            if (target) navigate(target.path);
          }}
          onSignOut={user ? () => setConfirmingSignOut(true) : undefined}
        />

        <main id="main" ref={mainRef} className="shell__main" tabIndex={-1} aria-busy={!settled || undefined}>
          {session.status === 'starting' ? (
            <Opening>Opening Post-It…</Opening>
          ) : session.status === 'resuming' ? (
            <Opening>Checking your key with the web app…</Opening>
          ) : session.status === 'resume-failed' ? (
            <ResumeFailed error={session.error} onRetry={app.retrySignIn} onSignIn={app.showSignIn} />
          ) : (
            <Routes>
              <Route
                path={paths.signIn}
                element={
                  user ? (
                    <Navigate to={homeFor(user)} replace />
                  ) : (
                    <>
                      <SignInScreen
                        onSubmit={(url, key) => void handleSignIn(url, key)}
                        busy={signInBusy}
                        error={signInError}
                        initialUrl={app.settings.scriptUrl}
                      />
                      {demo ? <DemoNote /> : null}
                    </>
                  )
                }
              />
              <Route path={paths.find} element={guard(<FindScreen />)} />
              <Route path="/property/:id" element={guard(<PropertyScreen />)} />
              <Route path="/property/:id/log" element={guard(<LogPostScreen />)} />
              <Route path={paths.queue} element={guard(<QueueScreen />)} />
              <Route
                path={paths.assign}
                element={guard(
                  <PlaceholderScreen
                    title="Assign"
                    description="Build each intern's queue for the day: search and add, or paste a typed list. A listing in its cooldown, or already in someone's queue, can't be added."
                    step={7}
                    arrives="Building, reordering and saving a queue, with typo suggestions for pasted lists."
                  />,
                  canManage,
                )}
              />
              <Route
                path={paths.tracker}
                element={guard(
                  <PlaceholderScreen
                    title="Tracker"
                    description="The day at a glance: posted today, pending, who's done, what's due for a repost and what has never been posted."
                    step={7}
                    arrives="The day's numbers for the whole team, and doc health from the directory."
                  />,
                  canManage,
                )}
              />
              <Route
                path={paths.settings}
                element={guard(
                  <PlaceholderScreen
                    title="Settings"
                    description="The web app link, the cooldown, and the team with their keys."
                    step={8}
                    arrives="Settings, the team and their keys, and updates."
                  />,
                  isAdmin,
                )}
              />
              {KitScreen ? (
                <Route
                  path="/kit"
                  element={
                    <Suspense fallback={<Spinner label="Loading the UI kit" className="shell__loading" />}>
                      <KitScreen />
                    </Suspense>
                  }
                />
              ) : null}
              <Route path="/" element={home} />
              <Route path="*" element={home} />
            </Routes>
          )}
        </main>
      </div>

      {confirmingSignOut ? (
        <SignOutDialog onCancel={() => setConfirmingSignOut(false)} onConfirm={confirmSignOut} />
      ) : null}
    </>
  );
}

/**
 * How much of an intern's queue is left today, for the count beside My queue.
 * Read on sign-in and every two minutes; the queue screen reads it more often
 * while it is up, and every save reads it again.
 */
function useQueueCount(user: User | null): number {
  const app = useApp();
  const { assignments } = app;
  const snapshot = useStore(assignments.store);
  const intern = user !== null && !canManage(user);

  useEffect(() => {
    if (!intern) return undefined;
    void assignments.refresh(60_000);
    const timer = setInterval(() => void assignments.refresh(), 120_000);
    return () => clearInterval(timer);
  }, [intern, assignments]);

  if (!intern || !snapshot.data) return 0;
  const today = app.today();
  return snapshot.data.filter((a) => a.date === today && a.assignedTo === user.name && a.status !== 'Posted').length;
}

/** A wait before anything can be shown, said in words. */
function Opening({ children }: { readonly children: string }) {
  return (
    <div className="opening">
      <Spinner label={children} />
      <p className="opening__text" aria-hidden="true">
        {children}
      </p>
    </div>
  );
}

/** The kept key could not be checked: say why, and offer the two ways on. */
function ResumeFailed({
  error,
  onRetry,
  onSignIn,
}: {
  readonly error: string;
  readonly onRetry: () => void;
  readonly onSignIn: () => void;
}) {
  return (
    <div className="resume">
      <Card className="resume__card">
        <h1 className="resume__title" tabIndex={-1}>
          Couldn't sign you in
        </h1>
        <Notice tone="danger" live className="resume__error">
          {error}
        </Notice>
        <p className="resume__help">
          Your key is still saved on this computer, so trying again needs nothing typed. Sign in again only if your
          manager gave you a new key.
        </p>
        <div className="resume__actions">
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
          <Button onClick={onSignIn}>Sign in with a key</Button>
        </div>
      </Card>
    </div>
  );
}

function DemoNote() {
  return (
    <div className="demo-note">
      <Notice tone="info" title="Demo data, in the browser">
        Sign in with the key <code>intern</code>, <code>paolo</code> (an intern with no FB accounts listed),{' '}
        <code>manager</code> or <code>admin</code>.
      </Notice>
    </div>
  );
}

/**
 * Sign out, asked first: it takes the key off this computer, and signing in
 * again needs it pasted. Focus starts on staying, so Enter or Escape keeps you
 * signed in.
 */
function SignOutDialog({ onCancel, onConfirm }: { readonly onCancel: () => void; readonly onConfirm: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const bodyId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Modal where the WebView supports it (the rest of the window goes inert);
    // simply open where it doesn't, as in tests.
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    stayRef.current?.focus();
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      // Back where you were, if it is still there.
      if (before?.isConnected) before.focus();
    };
  }, []);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof UserFacingError ? err.message : "Post-It couldn't remove your key. Try again.");
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!busy) onCancel();
  };

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <h2 id={titleId} className="confirm__title">
        Sign out of Post-It?
      </h2>
      <p id={bodyId} className="confirm__body">
        Post-It will forget your key on this computer. To sign in again you'll need the key your manager gave you.
      </p>
      {error ? (
        <Notice tone="danger" live>
          {error}
        </Notice>
      ) : null}
      <div className="confirm__actions">
        <Button ref={stayRef} onClick={cancel} disabled={busy}>
          Stay signed in
        </Button>
        <Button variant="primary" busy={busy} onClick={() => void confirm()}>
          {busy ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </dialog>
  );
}
