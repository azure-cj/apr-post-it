/**
 * Everything a screen needs from outside itself, in one provider: the
 * platform, the settings, the backend, the property list, the tracker, who is
 * signed in, and toasts. Screens read it with the hooks in ./hooks.
 *
 * The rules it keeps:
 * - The key is never held here. The OS keeps it; the backend reads it before
 *   every call. Signing in writes it, signing out removes it.
 * - Who you are is the server's answer to `ping`, asked again on every launch.
 *   The app never decides a role for itself.
 * - The property list is read on sign-in (yesterday's from disk at once, then
 *   a fresh one) and refreshed every 15 minutes while you are signed in.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createBackend } from '@/core/backend';
import { signIn as askWhoThisIs } from '@/core/session';
import { UserFacingError, type PropertyDetail, type Role, type User } from '@/core/types';
import type { Platform } from '@/platform';
import { ToastRegion, useToasts, type ToastTone } from '../components';
import { manilaDate } from './clock';
import { sentenceOf } from './remote';
import { createServices, type Services } from './services';
import { useStore } from './store';
import { BUILT_IN_SCRIPT_URL } from '@/config';
import {
  defaultAppSettings,
  parseSettings,
  serializeSettings,
  SETTINGS_KEY,
  withBuiltInLink,
  withServerRules,
  type AppSettings,
} from './settings';

/** Where the window is in signing you in. */
export type Session =
  /** Reading the link and key this PC kept from last time. */
  | { readonly status: 'starting' }
  /** Asking the server who the kept key belongs to. */
  | { readonly status: 'resuming' }
  /** That failed: why, as a sentence. The key is kept, so Try again needs nothing typed. */
  | { readonly status: 'resume-failed'; readonly error: string }
  | { readonly status: 'signed-out' }
  | { readonly status: 'signed-in'; readonly user: User };

export interface AppState extends Omit<Services, 'openProperty' | 'forget'> {
  readonly platform: Platform;
  readonly settings: AppSettings;
  /** Changes and keeps settings. Rejects with a sentence when they could not be kept. */
  saveSettings(changes: Partial<AppSettings>): Promise<void>;
  readonly session: Session;
  /** Who is signed in, or null. */
  readonly user: User | null;
  /**
   * Asks the server who `key` belongs to; then keeps the key (in the OS) and
   * the link, and signs that person in. Rejects with the server's sentence.
   * When a link is built into this version, that link is used whatever `url` says.
   *
   * Aborting `signal` stops it: a reply that arrives afterwards signs nobody in
   * and keeps no key, and the promise rejects with the signal's reason.
   *
   * With `role`, a key the server says is for the other role signs nobody in
   * and keeps nothing: it rejects with "This key is for an Intern." (or Admin).
   */
  signIn(url: string, key: string, signal?: AbortSignal, role?: Role): Promise<User>;
  /** After a failed resume: ask again with the kept key. */
  retrySignIn(): void;
  /** After a failed resume: go to the sign-in form instead. */
  showSignIn(): void;
  /** Removes the key from this PC and forgets the property list and everything read. Confirm first. */
  signOut(): Promise<void>;
  /** A listing as the signed-in person may see it: an intern never gets internal text (see forViewer). */
  openProperty(id: string): Promise<PropertyDetail>;
  /** Today on the tracker's calendar (Manila), yyyy-MM-dd. */
  today(): string;
  now(): number;
}

export type Notify = (message: ReactNode, tone?: ToastTone) => void;

const AppStateContext = createContext<AppState | null>(null);
const NotifyContext = createContext<Notify | null>(null);

/** How often the property list is fetched again while signed in (docs/DATA-FLOW.md). */
export const DIRECTORY_REFRESH_MS = 15 * 60 * 1000;

export interface AppStateProviderProps {
  readonly platform: Platform;
  /** Start signed in as this person without asking the server. For tests. */
  readonly initialUser?: User | undefined;
  /** Start from these settings instead of what the platform kept. For tests. */
  readonly initialSettings?: Partial<AppSettings> | undefined;
  /** The clock (ms since 1970). Default Date.now. */
  readonly now?: (() => number) | undefined;
  readonly children?: ReactNode;
}

export function AppStateProvider({ platform, initialUser, initialSettings, now = Date.now, children }: AppStateProviderProps) {
  const settingsRef = useRef<AppSettings>(withBuiltInLink({ ...defaultAppSettings, ...initialSettings }));
  const [settings, setSettings] = useState<AppSettings>(settingsRef.current);
  const [session, setSession] = useState<Session>(
    initialUser ? { status: 'signed-in', user: initialUser } : { status: 'starting' },
  );

  const nowRef = useRef(now);
  nowRef.current = now;
  const clock = useCallback(() => nowRef.current(), []);

  // One set of services per platform: the directory and the tracker's shared
  // reads live as long as the window does.
  const services = useMemo(() => createServices(platform, () => settingsRef.current, clock), [platform, clock]);

  const applySettings = useCallback((wanted: AppSettings) => {
    const next = withBuiltInLink(wanted);
    settingsRef.current = next;
    setSettings(next);
  }, []);

  const saveSettings = useCallback(
    async (changes: Partial<AppSettings>) => {
      const next = withBuiltInLink({ ...settingsRef.current, ...changes });
      applySettings(next);
      await platform.writeLocal(SETTINGS_KEY, serializeSettings(next));
    },
    [platform, applySettings],
  );

  /** Asks the server who the kept key belongs to. */
  const resume = useCallback(async () => {
    let key: string | null;
    try {
      key = await platform.readKey();
    } catch (err) {
      setSession({ status: 'resume-failed', error: sentenceOf(err) });
      return;
    }
    if (!settingsRef.current.scriptUrl.trim() || !key?.trim()) {
      setSession({ status: 'signed-out' });
      return;
    }
    setSession({ status: 'resuming' });
    try {
      const user = await askWhoThisIs(services.backend);
      setSession({ status: 'signed-in', user });
    } catch (err) {
      setSession({ status: 'resume-failed', error: sentenceOf(err) });
    }
  }, [platform, services]);

  // On launch: the kept settings, then who the kept key belongs to. Once per
  // window, StrictMode's second run included.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      if (!initialSettings) {
        let kept: string | null = null;
        try {
          kept = await platform.readLocal(SETTINGS_KEY);
        } catch {
          // Unreadable settings are no settings: sign in again.
        }
        applySettings(parseSettings(kept));
      }
      if (!initialUser) await resume();
    })();
    // Launch only: the props are read once, as the window opens.
  }, []);

  const user = session.status === 'signed-in' ? session.user : null;

  // While signed in: the property list now, and again every 15 minutes. Checked
  // every minute rather than set for 15, so a laptop waking from sleep catches up.
  useEffect(() => {
    if (!user) return undefined;
    void services.startDirectory();
    const timer = setInterval(() => {
      const { refreshing, lastAttempt } = services.directoryStatus.get();
      if (!refreshing && (lastAttempt === null || clock() - lastAttempt >= DIRECTORY_REFRESH_MS)) {
        void services.refreshDirectory();
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [user, services, clock]);

  const signIn = useCallback(
    async (typed: string, key: string, signal?: AbortSignal, role?: Role): Promise<User> => {
      signal?.throwIfAborted();
      const url = BUILT_IN_SCRIPT_URL || typed;
      // Asked with exactly what was typed, before anything is kept: a key the
      // server does not know is never saved.
      const probe = createBackend({ post: platform.post, getConfig: () => ({ url, key }) });
      const signedIn = await askWhoThisIs(probe);
      // Cancelled while the server was answering: the answer is dropped.
      signal?.throwIfAborted();
      // The role picked only states intent; the server's answer decides, and
      // a key for the other role is not kept.
      if (role && signedIn.role !== role) throw new UserFacingError(`This key is for an ${signedIn.role}.`);
      await platform.writeKey(key);
      if (signal?.aborted) {
        // Cancelled while the key was being kept: take it back off this PC.
        await platform.writeKey('').catch(() => {});
        signal.throwIfAborted();
      }
      try {
        await saveSettings({ scriptUrl: url });
      } catch {
        // Kept in memory for this session; the link is asked for again next launch.
      }
      services.forget();
      setSession({ status: 'signed-in', user: signedIn });
      return signedIn;
    },
    [platform, saveSettings, services],
  );

  const signOut = useCallback(async () => {
    // First, so that a failure leaves you signed in and able to try again,
    // rather than signed out with your key still on the PC.
    await platform.writeKey('');
    services.forget();
    setSession({ status: 'signed-out' });
  }, [platform, services]);

  const retrySignIn = useCallback(() => void resume(), [resume]);
  const showSignIn = useCallback(() => setSession({ status: 'signed-out' }), []);

  const openProperty = useCallback(
    (id: string): Promise<PropertyDetail> => {
      if (!user) return Promise.reject(new Error('Nobody is signed in.'));
      return services.openProperty(id, user);
    },
    [services, user],
  );

  // The server's rules win once a ping has brought them; until then the kept ones.
  const serverRules = useStore(services.server).rules;
  const effectiveSettings = useMemo(() => withServerRules(settings, serverRules), [settings, serverRules]);

  const value = useMemo<AppState>(() => {
    const { openProperty: _forAnyViewer, forget: _forget, ...shared } = services;
    return {
      ...shared,
      platform,
      settings: effectiveSettings,
      saveSettings,
      session,
      user,
      signIn,
      retrySignIn,
      showSignIn,
      signOut,
      openProperty,
      today: () => manilaDate(clock()),
      now: clock,
    };
  }, [services, platform, effectiveSettings, saveSettings, session, user, signIn, retrySignIn, showSignIn, signOut, openProperty, clock]);

  return (
    <AppStateContext.Provider value={value}>
      <Toasts>{children}</Toasts>
    </AppStateContext.Provider>
  );
}

/**
 * The window's toasts. Kept in a context of their own so that a toast coming
 * and going re-renders the toast region, not every screen.
 */
function Toasts({ children }: { readonly children?: ReactNode }) {
  const { toasts, show, dismiss } = useToasts();
  const notify = useCallback<Notify>((message, tone) => void show(message, tone), [show]);
  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </NotifyContext.Provider>
  );
}

export function useApp(): AppState {
  const app = useContext(AppStateContext);
  if (!app) throw new Error('useApp() needs an <AppStateProvider> above it.');
  return app;
}

/** Shows a toast: a short confirmation. A problem that needs action is a Notice on the screen instead. */
export function useNotify(): Notify {
  const notify = useContext(NotifyContext);
  if (!notify) throw new Error('useNotify() needs an <AppStateProvider> above it.');
  return notify;
}
