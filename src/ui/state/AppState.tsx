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
import { NO_ROLE, postItRole, signInSentence } from '@/core/account';
import { BackendError, createBackend } from '@/core/backend';
import { signIn as askWhoThisIs } from '@/core/session';
import { UserFacingError, type PropertyDetail, type Role, type User } from '@/core/types';
import type { Platform } from '@/platform';
import type { FirebaseAccess, FirebaseAccount } from '@/platform/firebase';
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
  /** Firebase: no account signed in. `error` says why the last try didn't work. */
  | { readonly status: 'account'; readonly error?: string | undefined }
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
  /**
   * Firebase: signs the account in, then asks the web app who it is: the Team
   * tab row with the account's email. Resolves with null when the web app
   * didn't answer (session `resume-failed`). Rejects with a sentence.
   */
  signInAccount(email: string, password: string, signal?: AbortSignal): Promise<User | null>;
  /** True when sign-in goes by Firebase account; false where there is no Firebase (tests, the browser). */
  readonly usesAccounts: boolean;
  /**
   * Signs out and forgets the property list and everything read. Confirm
   * first. With Firebase, the account signs out; without, the key is removed
   * from this PC.
   */
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

  // Firebase, once the platform has said whether there is one (null: sign in by key alone).
  const firebaseRef = useRef<FirebaseAccess | null>(null);
  const [usesAccounts, setUsesAccounts] = useState(false);

  // One set of services per platform: the directory and the tracker's shared
  // reads live as long as the window does. Signed in by account, each call
  // carries the account's sign-in token instead of a key.
  const services = useMemo(
    () => createServices(platform, () => settingsRef.current, clock, () => firebaseRef.current),
    [platform, clock],
  );

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

  /**
   * The account signed in: its role, then who it is on the Team tab, which
   * the web app finds by the account's email. A Team role that isn't the
   * account's signs it out: the two must agree. `fresh` asks Firebase for the
   * role now, as after typing a password; on launch the kept one does.
   */
  const continueWith = useCallback(
    async (fb: FirebaseAccess, fresh: boolean): Promise<User | null> => {
      const role = postItRole(await fb.role(fresh));
      if (!role) {
        await fb.signOut().catch(() => {});
        throw new UserFacingError(NO_ROLE);
      }
      setSession({ status: 'resuming' });
      let user: User;
      try {
        user = await askWhoThisIs(services.backend);
      } catch (err) {
        if (err instanceof BackendError && err.code === 'unauthorized') {
          // Not on the Team tab, or the sign-in ended: nothing to try again with.
          await fb.signOut().catch(() => {});
          throw err;
        }
        // The web app didn't answer: Try again asks with the same account.
        setSession({ status: 'resume-failed', error: sentenceOf(err) });
        return null;
      }
      if (user.role !== role) {
        await fb.signOut().catch(() => {});
        throw new UserFacingError(`The Team tab says ${user.role}, but this account is ${role === 'Admin' ? 'an admin' : 'an agent'}. Ask your admin.`);
      }
      setSession({ status: 'signed-in', user });
      return user;
    },
    [platform, services],
  );

  /** Asks the server who the kept key belongs to. */
  const resume = useCallback(async () => {
    const fb = firebaseRef.current;
    if (fb) {
      setSession({ status: 'resuming' });
      const account = await firstAccount(fb);
      if (!account) {
        setSession({ status: 'account' });
        return;
      }
      try {
        await continueWith(fb, false);
      } catch (err) {
        // Turned away (no role, not on the Team tab, roles that don't agree): signed out, with why.
        if (err instanceof UserFacingError) setSession({ status: 'account', error: err.message });
        else setSession({ status: 'resume-failed', error: sentenceOf(err) });
      }
      return;
    }
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
  }, [platform, services, continueWith]);

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
      // No Firebase where the platform has none, or can't load it: sign in by key, as before.
      firebaseRef.current = await platform.firebase().catch(() => null);
      setUsesAccounts(firebaseRef.current !== null);
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

  const signInAccount = useCallback(
    async (email: string, password: string, signal?: AbortSignal): Promise<User | null> => {
      const fb = firebaseRef.current;
      if (!fb) throw new UserFacingError("Couldn't sign you in. Try again.");
      signal?.throwIfAborted();
      try {
        await fb.signIn(email, password);
      } catch (err) {
        throw new UserFacingError(signInSentence(err), err);
      }
      const account = await firstAccount(fb);
      if (signal?.aborted || !account) {
        await fb.signOut().catch(() => {});
        signal?.throwIfAborted();
        throw new UserFacingError("Couldn't sign you in. Try again.");
      }
      services.forget();
      try {
        return await continueWith(fb, true);
      } catch (err) {
        // Turned away: back to email and password, where the screen says why.
        setSession({ status: 'account' });
        throw err;
      }
    },
    [services, continueWith],
  );

  const signOut = useCallback(async () => {
    const fb = firebaseRef.current;
    if (fb) {
      await fb.signOut();
      services.forget();
      setSession({ status: 'account' });
      return;
    }
    // First, so that a failure leaves you signed in and able to try again,
    // rather than signed out with your key still on the PC.
    await platform.writeKey('');
    services.forget();
    setSession({ status: 'signed-out' });
  }, [platform, services]);

  // Signed out elsewhere (the account turned off, its sign-ins ended): the same here.
  useEffect(() => {
    const fb = firebaseRef.current;
    if (!fb || !usesAccounts) return undefined;
    return fb.watch((account) => {
      if (account) return;
      setSession((s) => {
        if (s.status !== 'signed-in') return s;
        services.forget();
        return { status: 'account' };
      });
    });
  }, [usesAccounts, services]);

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
      signInAccount,
      usesAccounts,
      retrySignIn,
      showSignIn,
      signOut,
      openProperty,
      today: () => manilaDate(clock()),
      now: clock,
    };
  }, [
    services,
    platform,
    effectiveSettings,
    saveSettings,
    session,
    user,
    signIn,
    signInAccount,
    usesAccounts,
    retrySignIn,
    showSignIn,
    signOut,
    openProperty,
    clock,
  ]);

  return (
    <AppStateContext.Provider value={value}>
      <Toasts>{children}</Toasts>
    </AppStateContext.Provider>
  );
}

/** The account Firebase has once it has read the sign-in it keeps: null when none. */
function firstAccount(fb: FirebaseAccess): Promise<FirebaseAccount | null> {
  return new Promise((resolve) => {
    let stop: (() => void) | null = null;
    let done = false;
    stop = fb.watch((account) => {
      if (done) return;
      done = true;
      resolve(account);
      // Called back at once by some versions, before watch returned its stop.
      queueMicrotask(() => stop?.());
    });
  });
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
