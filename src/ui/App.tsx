import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BUILT_IN_SCRIPT_URL } from '@/config';
import { activeInterns, addDays, isDate, peopleIn, samePerson } from '@/core/summary';
import { periodFromQuery, periodQuery } from '@/core/records';
import { currentQueue, rowsOf } from '@/core/queues';
import { weekOf } from '@/core/week';
import { canManage, DEFAULT_RULES, isAdmin, UserFacingError, type Role, type User } from '@/core/types';
import {
  Button,
  Card,
  Notice,
  Sidebar,
  Spinner,
  TitleBar,
  type IconName,
  type SidebarProps,
  type WindowControlsProps,
} from './components';
import { AccountSignInScreen } from './screens/AccountSignIn';
import { SignInScreen } from './screens/SignInScreen';
import { OutboxBanner } from './OutboxBanner';
import { PendingNotifier } from './PendingNotifier';
import { WhatsNew } from './WhatsNew';
import { UpdateBanner, type CheckResult } from './UpdateBanner';
import { version as APP_VERSION } from '../../package.json';
import { useSignInRole } from './screens/SignInScreen.role';
import { FindScreen, LogPostScreen, PropertyScreen, QueueScreen } from './screens/intern';
import { AssignScreen, InternsScreen, monitorWeek, RecordsScreen, SettingsScreen, settingsTab, TrackerScreen, type QueueSave } from './screens/manager';
import { useTheme } from './state/theme';
import { Launch } from './startup/Launch';
import type { Platform } from '@/platform';
import type { AddPersonInput } from '@/core/tracker';
import {
  manilaTime,
  paths,
  sectionOf,
  useApp,
  useAssignments,
  useDirectoryList,
  useNotify,
  usePosts,
  useStore,
  useTeam,
  useUser,
  navKeys,
  type FromList,
  type NavKey,
} from './state';
import './App.css';

export { paths } from './state';

/** Where a person lands after signing in: an intern's queue, an admin's tracker. */
export function homeFor(user: User): string {
  return canManage(user) ? paths.tracker : paths.queue;
}

interface NavDef {
  readonly key: NavKey;
  readonly label: string;
  readonly path: string;
  readonly icon: IconName;
}

/**
 * The destinations a role gets, in order (docs/ROLES.md). Hiding a screen is
 * convenience only: the server enforces what each key may do.
 */
export function navFor(user: User): readonly NavDef[] {
  if (canManage(user)) {
    return [
      { key: 'tracker', label: 'Tracker', path: paths.tracker, icon: 'tracker' },
      { key: 'assign', label: 'Assign', path: paths.assign, icon: 'assign' },
      { key: 'interns', label: 'Agents', path: paths.interns, icon: 'interns' },
      { key: 'records', label: 'Records', path: paths.records, icon: 'records' },
      { key: 'find', label: 'Find', path: paths.find, icon: 'search' },
      { key: 'settings', label: 'Settings', path: paths.settings, icon: 'settings' },
    ];
  }
  return [
    { key: 'queue', label: 'My queue', path: paths.queue, icon: 'inbox' },
    { key: 'find', label: 'Find', path: paths.find, icon: 'search' },
  ];
}


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
    '/find': 'Find',
    '/queue': 'My queue',
    '/assign': 'Assign',
    '/tracker': 'Tracker',
    '/interns': 'Agents',
    '/records': 'Records',
    '/settings': 'Settings',
    '/kit': 'UI kit',
  };
  return titles[pathname] ?? 'APG Post-It';
}

/** The development-only reference of every component. Not in the production build. */
const KitScreen = import.meta.env.DEV ? lazy(() => import('./screens/KitScreen')) : null;

export interface AppProps {
  /** Shown under the sign-in card. Optional; nothing passes one today. */
  readonly signInNote?: ReactNode;
}

/** React Router v7's behaviour, adopted now. Tests pass the same to their routers. */
export const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

/**
 * The window: the startup screen once at launch (startup/Launch.tsx), then the sidebar, the
 * title strip, the screen, and toasts. A hash router, because a
 * desktop app has no server to answer a deep link: `#/queue` survives a reload.
 * Needs an <AppStateProvider> above it.
 */
export function App(props: AppProps) {
  return (
    <HashRouter future={routerFuture}>
      <Launch>
        <AppShell {...props} />
      </Launch>
    </HashRouter>
  );
}

/** The app inside whatever router the caller provides: tests use a MemoryRouter. */
export function AppShell({ signInNote }: AppProps) {
  const app = useApp();
  const { session, user } = app;
  const [signInBusy, setSignInBusy] = useState(false);

  // Check for updates, at the sidebar's foot: the update banner's own check, run now.
  const notifyShell = useNotify();
  const checkNow = useRef<(() => Promise<CheckResult>) | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  // What's new: once after an update, and from the version at the sidebar's foot.
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const onCheckReady = useCallback((check: () => Promise<CheckResult>) => {
    checkNow.current = check;
  }, []);
  const checkUpdates = useCallback(async () => {
    if (!checkNow.current) return;
    setCheckingUpdates(true);
    const found = await checkNow.current();
    setCheckingUpdates(false);
    if (found === 'none') notifyShell(`You're on the latest version (${APP_VERSION}).`);
    else if (found === 'failed') notifyShell("Couldn't check for updates. Check your connection, then try again.", 'warn');
  }, [notifyShell]);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const lastPath = useRef(location.pathname);
  const queueCount = useQueueCount(user);

  // ---- leaving Assign with unsaved changes asks first -------------------------
  const [assignDirty, setAssignDirty] = useState(false);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const requestLeave = useCallback(
    (go: () => void) => {
      if (assignDirty) setLeaving(() => go);
      else go();
    },
    [assignDirty],
  );

  // ---- closing the window asks first ------------------------------------------
  // The close button, Alt+F4 and the taskbar all arrive here, held by the
  // platform. One question, which also says when Assign has unsaved changes.
  const { platform } = app;
  const [confirmingClose, setConfirmingClose] = useState(false);
  const closing = useRef(false);
  useEffect(
    () =>
      platform.onCloseRequested(() => {
        if (closing.current) return;
        // This question replaces any other that is open.
        setLeaving(null);
        setConfirmingSignOut(false);
        setConfirmingClose(true);
      }),
    [platform],
  );
  const windowControls = useWindowControls(platform);
  const [signInRole, setSignInRole] = useSignInRole(platform);
  const sidebar = useSidebarState(platform);
  const toggleSidebar = sidebar.toggle;

  // Ctrl+B shows and hides the sidebar's words, wherever focus is, unless a
  // question is open.
  const signedIn = user !== null;
  useEffect(() => {
    if (!signedIn) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key.toLowerCase() !== 'b') return;
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [signedIn, toggleSidebar]);

  // Every in-app link (the brand, the nav, a link on the screen) goes through
  // the question while there are unsaved changes; so does reloading the page.
  useEffect(() => {
    if (!assignDirty) return undefined;
    const onClick = (event: globalThis.MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href^="#/"]') : null;
      if (!link) return;
      const to = (link.getAttribute('href') ?? '').slice(1);
      if (to === location.pathname + location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving(() => () => navigate(to));
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (closing.current) return; // already asked, by the close question
      event.preventDefault();
      event.returnValue = '';
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [assignDirty, location.pathname, location.search, navigate]);

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

  // One sign-in at a time. Cancel aborts it, so a reply that arrives later
  // signs nobody in and says nothing.
  const { signIn } = app;
  const signingIn = useRef<AbortController | null>(null);
  const handleSignIn = useCallback(
    async (url: string, key: string, role?: Role) => {
      signingIn.current?.abort();
      const attempt = new AbortController();
      signingIn.current = attempt;
      setSignInError(null);
      setSignInBusy(true);
      try {
        const signedIn = await signIn(url, key, attempt.signal, role);
        if (attempt.signal.aborted) return;
        navigate(homeFor(signedIn), { replace: true });
      } catch (e) {
        if (attempt.signal.aborted) return;
        setSignInError(
          e instanceof UserFacingError
            ? e.message
            : BUILT_IN_SCRIPT_URL
              ? "Couldn't reach the web app. Check your connection, then try again."
              : "Couldn't reach the web app. Check the link and your connection, then try again.",
        );
      } finally {
        if (signingIn.current === attempt) {
          signingIn.current = null;
          setSignInBusy(false);
        }
      }
    },
    [signIn, navigate],
  );
  // Firebase: the account, then who the web app says it is. One at a time, as above.
  const { signInAccount } = app;
  const accountStep = useCallback(
    async (step: (signal: AbortSignal) => Promise<User | null>) => {
      signingIn.current?.abort();
      const attempt = new AbortController();
      signingIn.current = attempt;
      setSignInError(null);
      setSignInBusy(true);
      try {
        const signedIn = await step(attempt.signal);
        if (!attempt.signal.aborted && signedIn) navigate(homeFor(signedIn), { replace: true });
      } catch (e) {
        if (!attempt.signal.aborted) setSignInError(e instanceof UserFacingError ? e.message : "Couldn't sign you in. Try again.");
      } finally {
        if (signingIn.current === attempt) {
          signingIn.current = null;
          setSignInBusy(false);
        }
      }
    },
    [navigate],
  );
  const switchAccount = useCallback(async () => {
    signingIn.current?.abort();
    setSignInError(null);
    await app.signOut().catch(() => {});
  }, [app]);

  const cancelSignIn = useCallback(() => {
    signingIn.current?.abort();
    signingIn.current = null;
    setSignInBusy(false);
    setSignInError(null);
  }, []);
  // A sign-in still running when the window goes stops with it.
  useEffect(() => () => signingIn.current?.abort(), []);

  const { signOut } = app;
  const confirmSignOut = useCallback(async () => {
    await signOut();
    setConfirmingSignOut(false);
    setSignInError(null);
    navigate(paths.signIn, { replace: true });
  }, [signOut, navigate]);

  const nav = user ? navFor(user) : [];
  const sidebarNav: SidebarProps['nav'] = nav.map((item) => ({
    key: item.key,
    label: item.label,
    href: `#${item.path}`,
    icon: item.icon,
    ...(item.key === 'queue' && queueCount > 0
      ? { count: queueCount, countLabel: `${queueCount} left in your queue this week` }
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

  const settled = session.status === 'signed-in' || session.status === 'signed-out' || session.status === 'account';

  return (
    <>
      <a className="skip-link" href="#main" onClick={skipToContent}>
        Skip to content
      </a>

      <div className="shell">
        {user ? (
          <Sidebar
            nav={sidebarNav}
            currentKey={navKeyFor(location.pathname, location.state)}
            user={{ name: user.name, role: user.role }}
            onNavigate={(key) => {
              const target = nav.find((n) => n.key === key);
              if (target) requestLeave(() => navigate(target.path));
            }}
            onSignOut={() => requestLeave(() => setConfirmingSignOut(true))}
            collapsed={sidebar.collapsed}
            animate={sidebar.animate}
            onToggleCollapsed={toggleSidebar}
            dragRegion={windowControls !== null}
            appVersion={APP_VERSION}
            onCheckUpdates={() => void checkUpdates()}
            checkingUpdates={checkingUpdates}
            onWhatsNew={() => setWhatsNewOpen(true)}
          />
        ) : null}

        <div className="shell__content">
          <TitleBar brandHref={user ? undefined : '#/'} windowControls={windowControls} />
          <UpdateBanner platform={platform} requestLeave={requestLeave} onCheckReady={onCheckReady} />
          {user ? <OutboxBanner who={user.name} /> : null}
          {user ? <PendingNotifier who={user.name} /> : null}
          {user ? (
            <WhatsNew platform={platform} version={APP_VERSION} openNow={whatsNewOpen} onClosed={() => setWhatsNewOpen(false)} />
          ) : null}

          <main id="main" ref={mainRef} className="shell__main" tabIndex={-1} aria-busy={!settled || undefined}>
            {session.status === 'starting' ? (
              <Opening>Opening Post-It…</Opening>
            ) : session.status === 'resuming' ? (
              <Opening>{app.usesAccounts ? 'Signing you in…' : 'Checking your key with the web app…'}</Opening>
            ) : session.status === 'resume-failed' ? (
              <ResumeFailed error={session.error} onRetry={app.retrySignIn} onSignIn={app.usesAccounts ? switchAccount : app.showSignIn} />
            ) : session.status === 'account' ? (
              <AccountSignInScreen
                onSubmit={(email, password) => void accountStep((signal) => signInAccount(email, password, signal))}
                busy={signInBusy}
                error={signInError ?? session.error}
              />
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
                          onSubmit={(url, key, role) => void handleSignIn(url, key, role)}
                          role={signInRole}
                          onRoleChange={setSignInRole}
                          onCancel={cancelSignIn}
                          busy={signInBusy}
                          error={signInError}
                          initialUrl={app.settings.scriptUrl}
                          builtInUrl={BUILT_IN_SCRIPT_URL}
                        />
                        {signInNote ?? null}
                      </>
                    )
                  }
                />
                <Route path={paths.find} element={guard(<FindScreen />)} />
                <Route path="/property/:id" element={guard(<PropertyScreen />)} />
                <Route path="/property/:id/log" element={guard(<LogPostScreen />)} />
                <Route path={paths.queue} element={guard(<QueueScreen />)} />
                <Route path={paths.assign} element={guard(<AssignRoute onDirtyChange={setAssignDirty} />, canManage)} />
                <Route path={paths.tracker} element={guard(<TrackerRoute />, canManage)} />
                <Route path={paths.interns} element={guard(<InternsRoute />, canManage)} />
                <Route path={paths.records} element={guard(<RecordsRoute />, canManage)} />
                <Route path={paths.settings} element={guard(<SettingsRoute />, isAdmin)} />
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
      </div>

      {confirmingSignOut ? (
        <SignOutDialog onCancel={() => setConfirmingSignOut(false)} onConfirm={confirmSignOut} withAccount={app.usesAccounts} />
      ) : null}

      {confirmingClose ? (
        <ConfirmDialog
          title="Close APG Post-It?"
          body={
            assignDirty
              ? "This queue has changes that aren't saved. Closing now loses them."
              : "You'll stay signed in on this computer."
          }
          cancelLabel="Cancel"
          confirmLabel="Close"
          busyLabel="Closing…"
          failure="Post-It couldn't close. Try again."
          onCancel={() => setConfirmingClose(false)}
          onConfirm={async () => {
            closing.current = true;
            try {
              await platform.destroy();
            } catch (err) {
              closing.current = false;
              throw err;
            }
          }}
        />
      ) : null}

      {leaving ? (
        <ConfirmDialog
          title="Leave without saving?"
          body="This queue has changes that aren't saved. Leaving now drops them."
          cancelLabel="Keep editing"
          confirmLabel="Leave without saving"
          onCancel={() => setLeaving(null)}
          onConfirm={async () => {
            const go = leaving;
            setLeaving(null);
            setAssignDirty(false);
            go();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The window's minimize, maximize and close, where the platform has a window
 * to control: null in a browser. Follows the window being maximized however
 * that happened (a double-click on the bar, Win+Up, a snap).
 */
function useWindowControls(platform: Platform): WindowControlsProps | null {
  const [maximized, setMaximized] = useState(false);
  const shown = platform.hasWindowControls;

  useEffect(() => {
    if (!shown) return undefined;
    let live = true;
    platform.isMaximized().then(
      (now) => live && setMaximized(now),
      () => {},
    );
    const stop = platform.onMaximizedChange((now) => setMaximized(now));
    return () => {
      live = false;
      stop();
    };
  }, [platform, shown]);

  return useMemo(
    () =>
      shown
        ? {
            maximized,
            onMinimize: () => void platform.minimize().catch(() => {}),
            onToggleMaximize: () => void platform.toggleMaximize().catch(() => {}),
            onClose: () => void platform.requestClose().catch(() => {}),
          }
        : null,
    [platform, shown, maximized],
  );
}

/** Where the sidebar's state is kept between launches. */
export const SIDEBAR_KEY = 'sidebar';

/** Below this window width the sidebar starts as a rail, whatever was kept. */
export const SIDEBAR_NARROW = 1000;

/**
 * Whether the sidebar is a rail: what was kept from last time, except that a
 * narrow window starts collapsed. Animates only once someone toggles it.
 */
function useSidebarState(platform: Platform) {
  const narrow = () => typeof window !== 'undefined' && window.innerWidth < SIDEBAR_NARROW;
  const [collapsed, setCollapsed] = useState(narrow);
  const [animate, setAnimate] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    platform.readLocal(SIDEBAR_KEY).then(
      (kept) => {
        if (!live || touched.current || narrow()) return;
        if (kept === 'collapsed' || kept === 'expanded') setCollapsed(kept === 'collapsed');
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [platform]);

  const toggle = useCallback(() => {
    touched.current = true;
    setAnimate(true);
    setCollapsed((now) => {
      const next = !now;
      void platform.writeLocal(SIDEBAR_KEY, next ? 'collapsed' : 'expanded').catch(() => {});
      return next;
    });
  }, [platform]);

  return { collapsed, animate, toggle };
}

/**
 * How much of an intern's queue is left this week, for the count beside My queue.
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
  // Their queue now: the one running, else the next to start.
  const queue = currentQueue(user.name, snapshot.data, app.today());
  return queue ? rowsOf(user.name, queue.key, snapshot.data).filter((a) => a.status !== 'Posted').length : 0;
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
          admin gave you a new key.
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

/**
 * Sign out, asked first: it takes the key off this computer, and signing in
 * again needs it pasted. Focus starts on staying, so Enter or Escape keeps you
 * signed in.
 */
function SignOutDialog({
  onCancel,
  onConfirm,
  withAccount,
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => Promise<void>;
  /** Signing in is by account: the key stays on this computer. */
  readonly withAccount: boolean;
}) {
  return (
    <ConfirmDialog
      title="Sign out of Post-It?"
      body={
        withAccount
          ? "You'll need your email and password to sign in again."
          : "Post-It will forget your key on this computer. To sign in again you'll need the key your admin gave you."
      }
      cancelLabel="Stay signed in"
      confirmLabel="Sign out"
      busyLabel="Signing out…"
      failure={withAccount ? "Post-It couldn't sign you out. Try again." : "Post-It couldn't remove your key. Try again."}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

interface ConfirmDialogProps {
  readonly title: string;
  readonly body: string;
  /** The safe choice. Focus starts on it, and Escape takes it. */
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly busyLabel?: string | undefined;
  /** Said when `onConfirm` fails with something other than a UserFacingError. */
  readonly failure?: string | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: () => Promise<void>;
}

/** A question asked before something that can't be taken back. Focus starts on the safe answer. */
function ConfirmDialog({ title, body, cancelLabel, confirmLabel, busyLabel, failure, onCancel, onConfirm }: ConfirmDialogProps) {
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
      setError(err instanceof UserFacingError ? err.message : (failure ?? 'That didn’t work. Try again.'));
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
        {title}
      </h2>
      <p id={bodyId} className="confirm__body">
        {body}
      </p>
      {error ? (
        <Notice tone="danger" live>
          {error}
        </Notice>
      ) : null}
      <div className="confirm__actions">
        <Button ref={stayRef} onClick={cancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant="primary" busy={busy} onClick={() => void confirm()}>
          {busy && busyLabel ? busyLabel : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

// ------------------------------------------------------------------ the manager's screens

/**
 * Where Assign opens: whose queue, which week. `day` is any day of the week
 * (its Monday, or a day the Tracker shows); the link names the week's Monday.
 */
export function assignPath(intern: string | null, day: string): string {
  const params = new URLSearchParams();
  if (intern) params.set('intern', intern);
  params.set('week', isDate(day) ? weekOf(day) : day);
  return `${paths.assign}?${params.toString()}`;
}

/** The posts and assignments a manager screen needs, as one loading state and one sentence. */
function useManagerRows() {
  const posts = usePosts({ pollMs: 120_000 });
  const assignments = useAssignments({ pollMs: 120_000 });
  const properties = useDirectoryList();
  return {
    posts,
    assignments,
    properties: properties ?? [],
    loading: posts.data === null || assignments.data === null || properties === null,
    refreshing: posts.loading || assignments.loading,
    error: posts.error ?? assignments.error,
  };
}

/**
 * Whose queues can be built: the team's active interns. Until the team has
 * been read (or when it can't be), everyone the tracker mentions, less the
 * person signed in.
 */
function useInterns(rows: ReturnType<typeof useManagerRows>, me: User): readonly string[] {
  const { posts, assignments } = rows;
  const team = useTeam({ maxAgeMs: 300_000 });
  return useMemo(
    () =>
      team.data
        ? activeInterns(team.data)
        : peopleIn(assignments.data ?? [], posts.data ?? []).filter((name) => !samePerson(name, me.name)),
    [team.data, assignments.data, posts.data, me.name],
  );
}

function AssignRoute({ onDirtyChange }: { readonly onDirtyChange: (dirty: boolean) => void }) {
  const app = useApp();
  const me = useUser();
  const [params, setParams] = useSearchParams();
  const rows = useManagerRows();
  const interns = useInterns(rows, me);
  const today = app.today();

  // ?week= (any day of it reads as its Monday); an older link's ?date= too. Missing: this
  // week, which from Saturday is the coming one (weekOf).
  const asked = params.get('week') ?? params.get('date') ?? '';
  const week = weekOf(isDate(asked) ? asked : today);
  // No intern in the link: the screen asks whose queue first.
  const intern = params.get('intern') || null;
  // ?page=: the library's page, so Back and a reload keep it.
  const libraryPage = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);

  // Gone from the screen: nothing left unsaved to guard.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const set = (changes: { intern?: string | null; week?: string }) => {
    const next = new URLSearchParams(params);
    const who = changes.intern !== undefined ? changes.intern : intern;
    if (who) next.set('intern', who);
    else next.delete('intern');
    next.delete('date');
    // The library's page belongs to one intern's week: another starts at the first.
    next.delete('page');
    next.set('week', changes.week ?? week);
    // Choosing an intern is a step forward, so Back returns to the list; a week is not.
    setParams(next, { replace: changes.intern === undefined });
  };

  const { tracker, directory, platform } = app;
  const onSave = useCallback(
    (save: QueueSave) => tracker.saveQueue(save.week, save.assignedTo, save.items, save.when),
    [tracker],
  );
  const notify = useNotify();

  return (
    <AssignScreen
      interns={interns}
      intern={intern}
      week={week}
      today={today}
      properties={rows.properties}
      posts={rows.posts.data ?? []}
      assignments={rows.assignments.data ?? []}
      settings={app.settings}
      onInternChange={(name) => set({ intern: name })}
      onWeekChange={(monday) => set({ week: monday })}
      onSave={onSave}
      onDirtyChange={onDirtyChange}
      loading={rows.loading}
      error={rows.error}
      search={directory.search}
      onSaveQueues={(monday, queues) => tracker.saveQueues(monday, queues)}
      onQueuesSaved={(note) => {
        rows.assignments.reload();
        notify(note, 'ok');
      }}
      onOpenLink={(url) => void platform.open(url)}
      libraryPage={libraryPage}
      onLibraryPageChange={(page) => {
        const next = new URLSearchParams(params);
        if (page > 1) next.set('page', String(page));
        else next.delete('page');
        setParams(next, { replace: true });
      }}
    />
  );
}

function TrackerRoute() {
  const app = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rows = useManagerRows();
  const today = app.today();
  const asked = params.get('date') ?? '';
  const date = isDate(asked) ? asked : today;
  const loadedAt = rows.posts.loadedAt;
  const team = useTeam({ maxAgeMs: 300_000 });
  const { platform } = app;
  const interns = internsPath(monitorWeek(date), today);
  const records = `${paths.records}?period=custom&from=${date}&to=${date}`;
  const settings = `${paths.settings}?tab=listings`;

  return (
    <TrackerScreen
      date={date}
      today={today}
      posts={rows.posts.data ?? []}
      assignments={rows.assignments.data ?? []}
      properties={rows.properties}
      team={team.data ?? undefined}
      onDateChange={(day) => setParams(day === today ? {} : { date: day }, { replace: true })}
      onRefresh={() => {
        rows.posts.reload();
        rows.assignments.reload();
      }}
      refreshing={rows.refreshing}
      loading={rows.loading}
      error={rows.error}
      updatedAt={loadedAt === null ? null : manilaTime(loadedAt)}
      onOpenLink={(url) => void platform.open(url)}
      internsHref={`#${interns}`}
      onOpenInterns={() => navigate(interns)}
      recordsHref={`#${records}`}
      onOpenRecords={() => navigate(records)}
      settingsHref={`#${settings}`}
      onOpenSettings={() => navigate(settings)}
    />
  );
}

/** The Interns screen on a week: no `?week=` for the week it opens on anyway. */
export function internsPath(week: string, today: string): string {
  return week === monitorWeek(today) ? paths.interns : `${paths.interns}?week=${week}`;
}

function InternsRoute() {
  const app = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = app.today();
  // The week shown: ?week= (any day of it), else the work week now under way.
  const opening = monitorWeek(today);
  const asked = params.get('week') ?? '';
  const week = isDate(asked) ? weekOf(asked) : opening;
  const team = useTeam({ maxAgeMs: 300_000, pollMs: 600_000 });
  const posts = usePosts({ pollMs: 120_000 });
  const assignments = useAssignments({ pollMs: 120_000 });
  const loadedAt = posts.loadedAt;

  return (
    <InternsScreen
      week={week}
      today={today}
      team={team.data}
      posts={posts.data ?? []}
      assignments={assignments.data ?? []}
      onWeekChange={(next) => setParams(next === opening ? {} : { week: next }, { replace: true })}
      onRefresh={() => {
        team.reload();
        posts.reload();
        assignments.reload();
      }}
      refreshing={team.loading || posts.loading || assignments.loading}
      error={team.error ?? posts.error ?? assignments.error}
      updatedAt={loadedAt === null ? null : manilaTime(loadedAt)}
      onOpenQueue={(intern, monday) => navigate(assignPath(intern, monday))}
      onOpenLink={(url) => void app.platform.open(url)}
    />
  );
}

function RecordsRoute() {
  const app = useApp();
  const notify = useNotify();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const posts = usePosts({ pollMs: 120_000 });
  const assignments = useAssignments({ pollMs: 120_000 });
  const team = useTeam({ maxAgeMs: 300_000 });
  const { platform } = app;
  const today = app.today();
  // ?period=week&from=… and the like (core/records periodFromQuery); none: this week.
  const period = periodFromQuery({ period: params.get('period'), from: params.get('from'), to: params.get('to') }, today);
  const interns = useMemo(() => (team.data ? activeInterns(team.data) : []), [team.data]);
  return (
    <RecordsScreen
      posts={posts.data ?? []}
      assignments={assignments.data ?? []}
      today={today}
      period={period}
      onPeriodChange={(next) => setParams(periodQuery(next, today), { replace: true })}
      interns={interns}
      internsHref={(week) => `#${internsPath(week, today)}`}
      onOpenIntern={(_name, week) => navigate(internsPath(week, today))}
      loading={posts.data === null}
      error={posts.error ?? assignments.error}
      onExport={(csv, fileName) => {
        // A browser downloads it; the desktop app has no save dialog, so it goes to the clipboard.
        if (!platform.hasFileSystem) {
          const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          return;
        }
        platform.copyText(csv).then(
          () => notify('CSV copied. Paste it into a spreadsheet.', 'ok'),
          () => notify("Couldn't copy the CSV. Try again.", 'warn'),
        );
      }}
    />
  );
}

function SettingsRoute() {
  const app = useApp();
  const notify = useNotify();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { platform, tracker } = app;
  const team = useTeam({ maxAgeMs: 60_000 });
  const posts = usePosts({ maxAgeMs: 120_000 });
  const server = useStore(app.server);
  const theme = useTheme();
  const me = useUser();
  // The version and rules as the server says them now, not as at sign-in.
  // Once on arrival: keyed on refreshServer (stable for the window), never on
  // `app`, which is a new object whenever the ping's answer changes the
  // settings, and would ask again forever.
  const { refreshServer } = app;
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    void refreshServer().finally(() => setAsked(true));
  }, [refreshServer]);
  const copy = (text: string) =>
    platform.copyText(text).then(
      () => notify('Copied.', 'ok'),
      () => notify("Couldn't copy. Select the text and copy it instead.", 'warn'),
    );
  const open = (url: string) => void platform.open(url);
  // A server that sends no rules can't save them: its defaults show, read-only.
  const rules =
    server.rules ??
    (server.known || asked
      ? {
          cooldownDays: app.settings.cooldownDays,
          repostDueDays: app.settings.repostDueDays,
          perWeek: DEFAULT_RULES.perWeek,
          queueWeeks: DEFAULT_RULES.queueWeeks,
        }
      : null);
  return (
    <SettingsScreen
      tab={settingsTab(params.get('tab'))}
      onTabChange={(tab) => setParams({ tab }, { replace: true })}
      team={{
        team: team.data,
        me: me.name,
        posts: posts.data,
        today: app.today(),
        loading: team.loading,
        error: team.data ? null : team.error,
        // Signed in by account, people are added, given roles and turned off on Alpha Listing Hub (v13).
        ...(app.usesAccounts
          ? { managedInHub: true }
          : {
              onAddPerson: (input: AddPersonInput) => tracker.addPerson(input),
              onSetActive: (name: string, active: boolean) => tracker.setActive(name, active),
              onNewKey: (name: string) => tracker.newKey(name),
            }),
        onUpdatePerson: (name, changes) => tracker.updatePerson(name, changes),
        onOpenLink: open,
        onCopy: copy,
        onOpenInterns: () => navigate(paths.interns),
      }}
      listings={{
        onDirectoryStatus: () => tracker.directoryStatus(),
        onRebuildDirectory: () => tracker.rebuildDirectory(),
        onIndexCheck: () => tracker.indexCheck(),
        onOpenLink: open,
      }}
      rules={{ rules, onSave: server.rules ? (next) => tracker.setRules(next) : undefined }}
      app={{
        scriptUrl: app.settings.scriptUrl,
        builtInLink: BUILT_IN_SCRIPT_URL !== '',
        onCopy: copy,
        versionStatus: server.known ? server.versionStatus : undefined,
        serverVersion: server.version || undefined,
        theme: theme.choice,
        onThemeChange: theme.setChoice,
        reminderDays: app.settings.pendingReminderDays,
        onReminderDaysChange: (days) => void app.saveSettings({ pendingReminderDays: days }).catch(() => {}),
      }}
    />
  );
}
