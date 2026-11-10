/**
 * Never lose a log (PI-E14). By the time an intern logs a post it is already on
 * Facebook, so a save that fails on the way (no connection, a timeout, Apps
 * Script busy) must not lose it. It is kept on this PC and sent again later,
 * dated when it was logged, and the server takes a second save of the same
 * link as the first (v12), so a retry never logs it twice.
 *
 * Only a failure on the way is kept. A refusal (the cooldown, an FB account
 * that isn't yours, a bad link) is the server's answer: shown at once, as
 * before. A kept post is sent only while the same person is signed in.
 */

import { BackendError, type BackendErrorCode } from './backend';
import type { LogPostInput } from './tracker';

/** A post logged on this PC that the web app hasn't saved yet. */
export interface KeptPost {
  readonly id: string;
  /** Who logged it, as the app knew them: only they send it. */
  readonly who: string;
  readonly input: LogPostInput;
  /** When it was logged, ISO. The server dates the row by it. */
  readonly loggedAt: string;
  readonly tries: number;
  /** Why the last try didn't get through, as a sentence. */
  readonly lastError: string;
}

/** A kept post the web app then refused: shown to its person until dismissed. */
export interface RefusedPost {
  readonly id: string;
  readonly who: string;
  readonly title: string;
  readonly message: string;
}

export interface Outbox {
  readonly kept: readonly KeptPost[];
  readonly refused: readonly RefusedPost[];
}

export const EMPTY_OUTBOX: Outbox = Object.freeze({ kept: [], refused: [] });

/** Where the outbox is kept on this PC (the platform's local store, on disk in the app). */
export const OUTBOX_KEY = 'outbox';

/** The ways a save fails before the server could answer it: worth sending again. */
const ON_THE_WAY: ReadonlySet<BackendErrorCode> = new Set<BackendErrorCode>([
  'unreachable',
  'timeout',
  'http',
  'busy',
  'empty',
  'unexpected',
  'google-page',
  'sign-in-page',
  'needs-authorization',
  'old-deployment',
  'not-configured',
  'unauthorized',
  'server',
]);

/** True when the post may not have reached the web app, so it should be kept and sent again. */
export function keepsForRetry(err: unknown): boolean {
  return err instanceof BackendError && ON_THE_WAY.has(err.code);
}

/**
 * What to tell the agent about a kept post the web app refused. A server from
 * v18 words a cooldown refusal for a post already made, and has told the
 * admin; an older one sends the usual sentence, so the agent is asked to.
 */
export function refusedWords(err: unknown, sentence: string): string {
  if (err instanceof BackendError && err.code === 'cooldown' && !err.reported) {
    return `${sentence} This post is on Facebook but not on the tracker: tell your admin.`;
  }
  return sentence;
}

/** The outbox as kept, read leniently: anything damaged is dropped, never thrown. */
export function readOutbox(text: string | null): Outbox {
  if (!text) return EMPTY_OUTBOX;
  try {
    const raw = JSON.parse(text) as { kept?: unknown; refused?: unknown };
    const kept = Array.isArray(raw.kept) ? raw.kept.filter(isKept) : [];
    const refused = Array.isArray(raw.refused) ? raw.refused.filter(isRefused) : [];
    return { kept, refused };
  } catch {
    return EMPTY_OUTBOX;
  }
}

function isKept(v: unknown): v is KeptPost {
  const p = v as Partial<KeptPost> | null;
  return (
    typeof p?.id === 'string' &&
    typeof p.who === 'string' &&
    typeof p.loggedAt === 'string' &&
    typeof p.input?.propertyId === 'string' &&
    typeof p.input.propertyName === 'string' &&
    typeof p.input.postLink === 'string'
  );
}

function isRefused(v: unknown): v is RefusedPost {
  const p = v as Partial<RefusedPost> | null;
  return typeof p?.id === 'string' && typeof p.who === 'string' && typeof p.title === 'string' && typeof p.message === 'string';
}
