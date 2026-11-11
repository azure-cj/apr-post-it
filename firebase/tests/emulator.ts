import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// The emulator as the tests use it: Firestore and accounts through the Admin SDK (`firebase emulators:exec` sets
// FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST), and the functions called the way the app's SDK calls them.

export const PROJECT = "demo-apr-listing";
const REGION = "asia-southeast1";
const AUTH = "http://127.0.0.1:9099";
const FIRESTORE = "http://127.0.0.1:8080";
const FUNCTIONS = `http://127.0.0.1:5001/${PROJECT}/${REGION}`;
const PASSWORD = "a-test-password";

export function admin(): App {
  return getApps()[0] ?? initializeApp({ projectId: PROJECT });
}

export const db = () => getFirestore(admin());

/** Empties Firestore and the accounts. */
export async function resetEmulator(): Promise<void> {
  await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
}

/** An account with `role` (none for null) and, with `name`, a users document as the People screen makes it. Its uid. */
export async function makeAccount(who: string, role: string | null, name: string | null = who): Promise<string> {
  const user = await getAuth(admin()).createUser({ email: `${who}@post-it.test`, password: PASSWORD });
  if (role) await getAuth(admin()).setCustomUserClaims(user.uid, { role });
  if (name !== null) await db().doc(`users/${user.uid}`).set({ name, role, active: true });
  return user.uid;
}

/** A sign-in token for the account `who`, its role included. */
export async function signIn(who: string): Promise<string> {
  const reply = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${who}@post-it.test`, password: PASSWORD, returnSecureToken: true }),
  });
  const body = (await reply.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`Couldn't sign in as ${who}: ${JSON.stringify(body)}`);
  return body.idToken;
}

/** A function's refusal, as the app's SDK reports it. */
export interface Refusal {
  readonly code: string;
  readonly message: string;
}

/** Calls the function `name` as the account with `token` (none: signed out). Rejects with a Refusal when refused. */
export async function call<T = unknown>(name: string, data: unknown, token: string | null): Promise<T> {
  const reply = await fetch(`${FUNCTIONS}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const body = (await reply.json()) as { result?: T; error?: { status: string; message: string } };
  if (body.error) {
    const refusal: Refusal = { code: `functions/${body.error.status.toLowerCase().replace(/_/g, "-")}`, message: body.error.message };
    throw refusal;
  }
  return body.result as T;
}

/** The refusal of a call that should have been refused. */
export async function refusal(promise: Promise<unknown>): Promise<Refusal> {
  return promise.then(
    () => {
      throw new Error("The call wasn't refused.");
    },
    (e: unknown) => e as Refusal,
  );
}
