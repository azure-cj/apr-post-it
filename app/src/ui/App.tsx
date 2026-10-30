import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { canManage, isAdmin, UserFacingError, type User } from '@/core/types';
import { Spinner, ToastRegion, TopBar, useToasts, type TopBarNavItem } from './components';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { SignInScreen } from './screens/SignInScreen';
import './App.css';

/** Every screen's path. Screens link with these, never with string literals. */
export const paths = {
  signIn: '/sign-in',
  find: '/find',
  property: (id: string) => `/property/${encodeURIComponent(id)}`,
  logPost: (id: string) => `/property/${encodeURIComponent(id)}/log`,
  queue: '/queue',
  assign: '/assign',
  tracker: '/tracker',
  settings: '/settings',
} as const;

/** Where a person lands after signing in: an intern's queue, a manager's tracker. */
export function homeFor(user: User): string {
  return canManage(user) ? paths.tracker : paths.queue;
}

type NavKey = 'queue' | 'find' | 'tracker' | 'assign' | 'settings';

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
  if (first === 'property') {
    const from = (state as { section?: unknown } | null)?.section;
    return navKeys.includes(from as NavKey) ? (from as NavKey) : 'find';
  }
  return navKeys.includes(first as NavKey) ? (first as NavKey) : null;
}

function titleFor(pathname: string): string {
  if (/^\/property\/[^/]+\/log/.test(pathname)) return 'Log a post';
  if (pathname.startsWith('/property/')) return 'Property';
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
  /**
   * Asks the web app who a key belongs to. Wired to core/backend in step 2;
   * until then, signing in says it isn't connected. A UserFacingError's
   * message is shown as it is; anything else is a connection problem.
   */
  readonly signIn?: ((url: string, key: string) => Promise<User>) | undefined;
  /** Signed in from the start, when the OS already holds a key. */
  readonly initialUser?: User | null | undefined;
  /** The web app link from last time. */
  readonly initialUrl?: string | undefined;
  /** After signing out: forget the key. */
  readonly onSignOut?: (() => void) | undefined;
}

/** React Router v7's behaviour, adopted now. Tests pass the same to their routers. */
export const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

/**
 * The window: the top bar, the screen, and toasts. A hash router, because a
 * desktop app has no server to answer a deep link: `#/queue` survives a reload.
 */
export function App(props: AppProps) {
  return (
    <HashRouter future={routerFuture}>
      <AppShell {...props} />
    </HashRouter>
  );
}

/** The app inside whatever router the caller provides: tests use a MemoryRouter. */
export function AppShell({ signIn, initialUser = null, initialUrl, onSignOut }: AppProps) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toasts = useToasts();
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const lastPath = useRef(location.pathname);

  // Name the window after the screen.
  useEffect(() => {
    document.title = `${titleFor(location.pathname)} · APG Post-It`;
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

  const handleSignIn = useCallback(
    async (url: string, key: string) => {
      setError(null);
      if (!signIn) {
        setError("Sign-in isn't connected to the web app yet. It arrives in step 2.");
        return;
      }
      setBusy(true);
      try {
        const signedIn = await signIn(url, key);
        setUser(signedIn);
        navigate(homeFor(signedIn), { replace: true });
      } catch (e) {
        setError(
          e instanceof UserFacingError
            ? e.message
            : "Couldn't reach the web app. Check the link and your connection, then try again.",
        );
      } finally {
        setBusy(false);
      }
    },
    [signIn, navigate],
  );

  const handleSignOut = useCallback(() => {
    setUser(null);
    setError(null);
    onSignOut?.();
    navigate(paths.signIn, { replace: true });
  }, [navigate, onSignOut]);

  const nav = user ? navFor(user) : [];
  const topBarNav: TopBarNavItem[] = nav.map((item) => ({
    key: item.key,
    label: item.label,
    href: `#${item.path}`,
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
          onSignOut={user ? handleSignOut : undefined}
        />

        <main id="main" ref={mainRef} className="shell__main" tabIndex={-1}>
          <Routes>
            <Route
              path={paths.signIn}
              element={
                user ? (
                  <Navigate to={homeFor(user)} replace />
                ) : (
                  <SignInScreen onSubmit={handleSignIn} busy={busy} error={error} initialUrl={initialUrl} />
                )
              }
            />
            <Route
              path={paths.find}
              element={guard(
                <PlaceholderScreen
                  title="Find a property"
                  description="Search every listing in the library by name, and narrow it by category. Open one to copy its public text and download its photos."
                  step={3}
                  arrives="Instant search over the cached directory, category filters, and the property page."
                />,
              )}
            />
            <Route path="/property/:id" element={guard(<PropertyPlaceholder />)} />
            <Route path="/property/:id/log" element={guard(<LogPostPlaceholder />)} />
            <Route
              path={paths.queue}
              element={guard(
                <PlaceholderScreen
                  title="My queue"
                  description="Today's listings in the order your manager set. A pending post stays at the top until it has its live link."
                  step={6}
                  arrives="The day's queue, its counts, and adding the live link to a pending post."
                />,
              )}
            />
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
        </main>
      </div>

      <ToastRegion toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </>
  );
}

function PropertyPlaceholder() {
  const { id = '' } = useParams();
  return (
    <PlaceholderScreen
      title="Property"
      description={`Listing ${id}: the public text with its one Copy button, the pre-post checks, and the photos.`}
      step={3}
      arrives="The public text, the checks that can block Copy, and the photo grid. Downloads follow in step 4."
    />
  );
}

function LogPostPlaceholder() {
  const { id = '' } = useParams();
  return (
    <PlaceholderScreen
      title="Log a post"
      description={`Listing ${id}: choose the FB account and paste the post link. The date, time, type and title are filled in for you.`}
      step={5}
      arrives="The two fields, the link check, and the cooldown's refusal with the next allowed date."
    />
  );
}
