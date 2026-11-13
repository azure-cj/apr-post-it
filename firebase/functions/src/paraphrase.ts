import "./setup.js";
import Anthropic from "@anthropic-ai/sdk";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { costOf, limitsOf, manilaDates, refusalOf, spentIn } from "./limits.js";
import { MAX_TEXT, MODEL, postMessage, rewordOf, SYSTEM } from "./prompt.js";

// Rewording a post (AID-129): Post-It's first use of Claude. It uses the Listing Hub's key and counts against the hub's
// limits: config/claude says whether Claude is on and how much a person and the month may spend, and each call is
// added to claudeUsage under the job "paraphrase", next to the hub's own jobs.

/** The hub's key, already set on live. Never created, set or printed here. */
const CLAUDE_API_KEY = defineSecret("CLAUDE_API_KEY");

/** Anthropic's API on live (functions/.env); the stand-in on port 8799 in the emulator (functions/.env.local). */
const CLAUDE_URL = defineString("CLAUDE_URL", { default: "https://api.anthropic.com" });

/** The roles that use Post-It: an agent is an intern there, an admin or owner an admin (D18). */
const POST_IT_ROLES: readonly string[] = ["owner", "admin", "agent"];

const JOB = "paraphrase";

const db = () => getFirestore();

// invoker "public": Cloud Run lets the call in, and caller() then holds it to a signed-in agent or admin. Without
// it, Cloud Run turns the app away before this code runs, with no CORS headers, and the app sees "internal [0]".
export const paraphrase = onCall({ secrets: [CLAUDE_API_KEY], timeoutSeconds: 120, invoker: "public" }, async (request) => {
  const { uid, email } = await caller(request);
  const text = textOf(request);

  // The limits first: nothing is asked of Claude, or spent, past them.
  const { day, month } = manilaDates();
  const monthRef = db().doc(`claudeUsage/${month}`);
  const dayRef = monthRef.collection("days").doc(`${day}_${uid}`);
  const [config, today, thisMonth] = await db().getAll(db().doc("config/claude"), dayRef, monthRef);
  const refused = refusalOf(limitsOf(config?.data()), spentIn(today?.data()), spentIn(thisMonth?.data()));
  if (refused) throw refused;

  const message = await askClaude(text);

  // Refused by Claude: not recorded, and the person posts the original.
  if (message.stop_reason === "refusal") {
    logger.warn("Claude refused a reword", { uid, category: message.stop_details?.category ?? null });
    throw new HttpsError("failed-precondition", "Claude wouldn't reword this post. Post the original.");
  }

  const tokensIn = message.usage.input_tokens;
  const tokensOut = message.usage.output_tokens;
  const cost = costOf(message.model || MODEL, tokensIn, tokensOut);
  await record({ uid, email, day, month, dayRef, monthRef, cost, tokensIn, tokensOut });

  // Answered and paid for, so recorded above, but not usable.
  if (message.stop_reason === "max_tokens") {
    throw new HttpsError("failed-precondition", "The reword came out too long. Post the original.");
  }
  const reword = rewordOf(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""));
  if (!reword) throw new HttpsError("internal", "Claude's reword came back empty. Try again, or post the original.");
  return { text: reword };
});

/**
 * The signed-in agent or admin making the call. Firebase is asked about the account now, not only the sign-in's copy
 * of it: a sign-in lasts an hour, so an account turned off, signed out everywhere or stripped of its role on the hub's
 * People screen is stopped at once, as the hub's requireCurrentRole does (D30).
 */
async function caller(request: CallableRequest): Promise<{ uid: string; email: string }> {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Sign in to reword a post.");
  if (!isPostItRole(auth.token["role"])) {
    throw new HttpsError("permission-denied", "Rewording is for agents and admins.");
  }
  const user = await getAuth().getUser(auth.uid).catch(() => null);
  const validSince = user?.tokensValidAfterTime ? Date.parse(user.tokensValidAfterTime) : 0;
  if (!user || user.disabled || auth.token.auth_time * 1000 < validSince) {
    throw new HttpsError("unauthenticated", "This sign-in has ended. Sign in again.");
  }
  if (!isPostItRole(user.customClaims?.["role"])) {
    throw new HttpsError("permission-denied", "Rewording is for agents and admins.");
  }
  return { uid: auth.uid, email: typeof auth.token.email === "string" ? auth.token.email : "" };
}

function isPostItRole(role: unknown): boolean {
  return typeof role === "string" && POST_IT_ROLES.includes(role);
}

function textOf(request: CallableRequest): string {
  const data: unknown = request.data;
  const text = typeof data === "object" && data !== null ? (data as Record<string, unknown>)["text"] : undefined;
  if (typeof text !== "string" || !text.trim()) throw new HttpsError("invalid-argument", "There's no text to reword.");
  if (text.length > MAX_TEXT) throw new HttpsError("invalid-argument", "This post is too long to reword.");
  return text.trim();
}

async function askClaude(text: string): Promise<Anthropic.Message> {
  const baseURL = CLAUDE_URL.value();
  // The emulator and its tests use the stand-in, never Anthropic's API.
  if (process.env["FUNCTIONS_EMULATOR"] === "true" && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(baseURL)) {
    throw new HttpsError("failed-precondition", "The emulator only talks to the Claude stand-in. Set CLAUDE_URL in functions/.env.local.");
  }
  const client = new Anthropic({ apiKey: CLAUDE_API_KEY.value(), baseURL, maxRetries: 1, timeout: 90_000 });
  try {
    return await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // A reword needs little thought, and thinking is billed as output. The app checks any per-sqm rate it works out.
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: postMessage(text) }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      logger.warn("Claude rate-limited a reword", { status: err.status });
      throw new HttpsError("unavailable", "Claude is busy. Try again in a minute, or post the original.");
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      logger.error("Claude refused the hub's key", { status: err.status });
      throw new HttpsError("internal", "Claude isn't set up right. Tell the owner, and post the original for now.");
    }
    if (err instanceof Anthropic.APIError) {
      logger.error("Claude failed a reword", { status: err.status, message: err.message });
      throw new HttpsError("unavailable", "Claude didn't answer. Try again, or post the original.");
    }
    throw err;
  }
}

/** Adds one call to the month and to the caller's day, next to the hub's jobs. */
async function record(call: {
  uid: string;
  email: string;
  day: string;
  month: string;
  dayRef: FirebaseFirestore.DocumentReference;
  monthRef: FirebaseFirestore.DocumentReference;
  cost: number;
  tokensIn: number;
  tokensOut: number;
}): Promise<void> {
  const { uid, cost } = call;
  const person = await db().doc(`users/${uid}`).get();
  const kept = person.get("name");
  const name = typeof kept === "string" && kept.trim() ? kept : call.email;
  const add = FieldValue.increment;
  const batch = db().batch();
  batch.set(
    call.monthRef,
    {
      month: call.month,
      calls: add(1),
      costUsd: add(cost),
      inputTokens: add(call.tokensIn),
      outputTokens: add(call.tokensOut),
      jobs: { [JOB]: { calls: add(1), costUsd: add(cost) } },
      people: { [uid]: { name, calls: add(1), costUsd: add(cost) } },
    },
    { merge: true },
  );
  batch.set(call.dayRef, { uid, day: call.day, calls: add(1), costUsd: add(cost) }, { merge: true });
  await batch.commit();
}
