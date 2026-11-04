/**
 * The way to the shared Firebase server (POST-IT-PLAN.md): email and password
 * sign-in, and the server's callable functions. Nothing else: the app never
 * reads Firestore itself, since the functions decide who may do what.
 *
 * The same project and region as Alpha Listing Hub, whose
 * app/src/platform/firebase-account.ts this follows, so one account signs in
 * to both apps. The installed app uses the live project; `tauri dev` and the
 * browser in development use the emulator on this PC (`npm run emulators` in
 * the hub's firebase/ folder), so development never reaches live.
 *
 * Not used by the screens yet: sign-in still goes by key, through Apps Script.
 */

import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  EmailAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type Persistence,
} from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

/** Which Firebase project to sign in to, and whether it is the emulator on this PC. */
export interface FirebaseTarget {
  readonly name: 'live' | 'emulator';
  readonly config: FirebaseOptions;
  readonly emulator: { readonly auth: string; readonly host: string; readonly port: number } | null;
}

/** The live project's web app. The API key only names the project; it is not a secret. */
export const LIVE: FirebaseTarget = {
  name: 'live',
  config: {
    apiKey: 'AIzaSyCO7e6rg1geJWrjN1K_0-wX2ZiJek3kENQ',
    authDomain: 'apr-listing-live.firebaseapp.com',
    projectId: 'apr-listing-live',
    appId: '1:277080072295:web:28a0ccf6d5835f458ab4c2',
  },
  emulator: null,
};

/** The emulator: a `demo-` project, which never reaches a real one, with the hub's test accounts. */
export const EMULATOR: FirebaseTarget = {
  name: 'emulator',
  config: { apiKey: 'demo-key', authDomain: 'demo-apr-listing.firebaseapp.com', projectId: 'demo-apr-listing' },
  emulator: { auth: 'http://127.0.0.1:9099', host: '127.0.0.1', port: 5001 },
};

/** The functions' one region (the hub's firebase/functions/src/setup.ts). */
export const REGION = 'asia-southeast1';

/** The account signed in. */
export interface FirebaseAccount {
  readonly uid: string;
  readonly email: string;
  /** The name the People screen gave them. */
  readonly name: string;
}

/** The roles on the server. Post-It treats an agent as an intern, and an admin or owner as an admin. */
export type FirebaseRole = 'owner' | 'admin' | 'agent' | 'scanner';

export interface FirebaseAccess {
  /** Which project this talks to. */
  readonly target: FirebaseTarget['name'];
  /** Called with the account, or null, once the kept sign-in has been read, then on each change. Returns a stop. */
  watch(changed: (account: FirebaseAccount | null) => void): () => void;
  /** The role in the sign-in, or null for none. `fresh` asks the server now, for a role changed since. */
  role(fresh: boolean): Promise<FirebaseRole | null>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Firebase asks for the current password again before it changes. */
  changePassword(current: string, next: string): Promise<void>;
  /**
   * The account signed in and its sign-in token, renewed by Firebase when it
   * has run out (every hour); null when nobody is signed in. The web app asks
   * Google whose the token is.
   */
  token(): Promise<{ readonly uid: string; readonly token: string } | null>;
  /** One of the server's functions. Rejects with Firebase's error: `code` like "functions/permission-denied", `details`. */
  call<T = unknown>(name: string, data?: object): Promise<T>;
}

const ROLES: readonly string[] = ['owner', 'admin', 'agent', 'scanner'];

let made = 0;

/**
 * Firebase's SDK for `target`. The sign-in is kept in the WebView's IndexedDB
 * (localStorage as a fallback), so it survives a restart, as the hub's does.
 */
export function createFirebase(
  target: FirebaseTarget,
  persistence: Persistence[] = [indexedDBLocalPersistence, browserLocalPersistence],
): FirebaseAccess {
  const app = initializeApp(target.config, `post-it-${++made}`);
  const auth = initializeAuth(app, { persistence });
  const functions = getFunctions(app, REGION);
  if (target.emulator) {
    connectAuthEmulator(auth, target.emulator.auth, { disableWarnings: true });
    connectFunctionsEmulator(functions, target.emulator.host, target.emulator.port);
  }

  return {
    target: target.name,
    watch(changed) {
      return onAuthStateChanged(auth, (u) => changed(u ? { uid: u.uid, email: u.email ?? '', name: u.displayName ?? '' } : null));
    },
    async role(fresh) {
      if (!auth.currentUser) return null;
      const role: unknown = (await auth.currentUser.getIdTokenResult(fresh)).claims['role'];
      return typeof role === 'string' && ROLES.includes(role) ? (role as FirebaseRole) : null;
    },
    async signIn(email, password) {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    },
    signOut: () => signOut(auth),
    async changePassword(current, next) {
      const u = auth.currentUser;
      if (!u) throw new Error('Not signed in.');
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email ?? '', current));
      await updatePassword(u, next);
    },
    async token() {
      const u = auth.currentUser;
      return u ? { uid: u.uid, token: await u.getIdToken() } : null;
    },
    async call<T>(name: string, data: object = {}) {
      return (await httpsCallable<object, T>(functions, name)(data)).data;
    },
  };
}

/**
 * Live in an installed app, the emulator in development. `VITE_FIREBASE=live`
 * points a development run at live, to sign in with a real account.
 */
export function firebaseTarget(dev: boolean = import.meta.env.DEV, wanted: unknown = import.meta.env.VITE_FIREBASE): FirebaseTarget {
  return dev && wanted !== 'live' ? EMULATOR : LIVE;
}
