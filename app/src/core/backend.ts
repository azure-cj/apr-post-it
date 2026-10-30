/**
 * The transport. Every byte between Post-It and Google goes through `call`:
 * one POST to the Apps Script web app (server/apps-script/Code.gs), whose reply
 * is always `{ ok: true, ... }` or `{ ok: false, error, message? }`.
 *
 * Ported from PostIt.Core/Infrastructure/Google/ScriptClient.cs. Three rules
 * come with it:
 *
 * - The key travels in the BODY. Never a header — Apps Script answers with a
 *   302 to script.googleusercontent.com and headers are dropped across that
 *   hop — and never the address, which ends up in logs.
 * - Nothing leaves this file as an HTTP code or a stack trace. Every refusal,
 *   and every way a call can fail, becomes a BackendError (a UserFacingError)
 *   whose message is a sentence a person can act on.
 * - Missing settings are reported before any request is made.
 *
 * I/O comes in as parameters, so this runs in the app, in tests, and later in
 * a Cloud Function.
 */

import { UserFacingError } from './types';

/** What Code.gs answers to. Anything else it refuses as an "unknown action". */
export type Action =
  | 'ping'
  | 'properties'
  | 'property'
  | 'posts'
  | 'assignments'
  | 'logPost'
  | 'addLink'
  | 'saveQueue'
  | 'setStatus';

/** Where the web app is, and who is asking. Blank, null or missing means "not set". */
export interface BackendConfig {
  /** The deployment's /exec link. */
  readonly url?: string | null | undefined;
  /** This person's key from the Team tab. It is their identity (DECISIONS D2). */
  readonly key?: string | null | undefined;
}

export interface BackendDeps {
  /**
   * One POST of `body`, as JSON, to `url`. Resolves with the reply — parsed
   * JSON, the raw text, or the fetch Response itself, any is fine — and
   * rejects when nothing came back. An error carrying a numeric `status` is
   * read as an HTTP failure. Platform.post fits.
   */
  readonly post: (url: string, body: unknown) => Promise<unknown>;
  /** Read before every call, so a link or key changed in Settings applies at once. */
  readonly getConfig: () => BackendConfig | Promise<BackendConfig>;
  /** Stop waiting after this long. Default 60 s: a cold start plus Code.gs's 20 s lock wait. */
  readonly timeoutMs?: number;
}

/** Fields sent alongside `action` and `key`. Undefined values are left out. */
export type Payload = Readonly<Record<string, unknown>>;

/** A reply as it came off the wire: `ok` is true, everything else unchecked. */
export type Reply = Readonly<Record<string, unknown>>;

export interface Backend {
  /**
   * Sends one request and resolves with the reply when the server said ok.
   * Rejects with a BackendError — always a UserFacingError — otherwise. The
   * reply is unchecked JSON: read its fields with asText / asList / asRecord.
   */
  call<T extends object = Reply>(action: Action, payload?: Payload): Promise<T>;

  /** True once a link and a key are both set. Makes no request. */
  isConfigured(): Promise<boolean>;

  /**
   * Who is asking, as an opaque value — never the key itself. It changes
   * whenever this backend has seen the link or key change since, even if it
   * has changed back: two equal values mean every call in between was made as
   * the same person. So a cache of what one person may see can be kept for
   * them alone. Blank when not configured.
   */
  identity(): Promise<string>;
}

/** Which way a call failed, for a screen that wants more than the sentence. */
export type BackendErrorCode =
  // Before any request.
  | 'not-configured'
  | 'bad-url'
  // On the way.
  | 'unreachable'
  | 'timeout'
  | 'http'
  // What came back.
  | 'sign-in-page'
  | 'empty'
  | 'unexpected'
  // What the server refused.
  | 'unauthorized'
  | 'forbidden'
  | 'cooldown'
  | 'busy'
  | 'notfound'
  | 'outdated'
  | 'incomplete'
  | 'server';

/** A failed call. The message is the sentence to show; `code` says which way it failed. */
export class BackendError extends UserFacingError {
  readonly code: BackendErrorCode;
  readonly action: Action;
  /** For a cooldown refusal, the server's own dates (yyyy-MM-dd). Blank otherwise. */
  readonly lastPosted: string;
  readonly nextAllowed: string;

  constructor(
    code: BackendErrorCode,
    action: Action,
    message: string,
    extra: { readonly cause?: unknown; readonly lastPosted?: string; readonly nextAllowed?: string } = {},
  ) {
    super(message, extra.cause);
    this.code = code;
    this.action = action;
    this.lastPosted = extra.lastPosted ?? '';
    this.nextAllowed = extra.nextAllowed ?? '';
  }
}

// ------------------------------------------------------------------ reading replies

/** A reply field as text: strings as they are, numbers and booleans spelled out, anything else blank. */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

/** A reply field that should be a list, or null when it is not one. */
export function asList(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** A reply field that should be an object, or null when it is not one. */
export function asRecord(value: unknown): Reply | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Reply) : null;
}

/** For an ok reply missing what it should carry: the web app and the app disagree. */
export function unreadableReply(action: Action, cause?: unknown): BackendError {
  return new BackendError(
    'unexpected',
    action,
    `Google sent ${WHAT[action]} in a form Post-It could not read. ` +
      'The web app may be out of date: ask your manager to check it.',
    { cause },
  );
}

// ------------------------------------------------------------------ the client

const DEFAULT_TIMEOUT_MS = 60_000;

/** Completes "Google could not …" and "… and could not …". */
const DOING: Readonly<Record<Action, string>> = {
  ping: 'sign you in',
  properties: 'load the property list',
  property: 'open that property',
  posts: 'load the posts',
  assignments: 'load the queues',
  logPost: 'log the post',
  addLink: 'add the link',
  saveQueue: 'save the queue',
  setStatus: 'update the queue',
};

/** Completes "Google sent … in a form Post-It could not read". */
const WHAT: Readonly<Record<Action, string>> = {
  ping: 'your sign-in details',
  properties: 'the property list',
  property: 'that property',
  posts: 'the posts',
  assignments: 'the queues',
  logPost: 'its answer',
  addLink: 'its answer',
  saveQueue: 'its answer',
  setStatus: 'its answer',
};

/** Calls that change the sheet. When one times out it may still have gone through. */
const WRITES: ReadonlySet<Action> = new Set<Action>(['logPost', 'addLink', 'saveQueue', 'setStatus']);

const TIMED_OUT = Symbol('timed out');

export function createBackend(deps: BackendDeps): Backend {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Every read of the settings is noted, so identity() can tell "the same
  // person throughout" from "someone else, then back again".
  let lastSeen: string | null = null;
  let changes = 0;

  /** The link and key, trimmed — blank when not set — and their fingerprint. */
  async function readConfig(action: Action): Promise<{ url: string; key: string; seen: string }> {
    let config: BackendConfig;
    try {
      config = await deps.getConfig();
    } catch (err) {
      if (err instanceof UserFacingError) throw err;
      throw new BackendError(
        'not-configured',
        action,
        'Post-It could not read its web app link and key on this computer. ' +
          'Restart Post-It, and enter them again in Settings if that does not help.',
        { cause: err },
      );
    }
    const url = (config.url ?? '').trim();
    const key = (config.key ?? '').trim();
    const seen = url && key ? fingerprint(`${url}\n${key}`) : '';
    if (seen !== lastSeen) {
      lastSeen = seen;
      changes++;
    }
    return { url, key, seen };
  }

  /** The link and key, or a sentence saying which is missing — before anything is sent. */
  async function settings(action: Action): Promise<{ url: string; key: string }> {
    const { url, key } = await readConfig(action);
    if (!url && !key) {
      throw new BackendError('not-configured', action,
        'Post-It is not connected yet. Add the web app link and your key in Settings.');
    }
    if (!url) {
      throw new BackendError('not-configured', action,
        'Post-It does not have the web app link yet. Add it in Settings.');
    }
    if (!key) {
      throw new BackendError('not-configured', action,
        'Post-It does not have your key yet. Add the key your manager gave you in Settings.');
    }
    if (!isAddress(url)) {
      throw new BackendError('bad-url', action,
        'The web app link in Settings is not a complete web address. ' +
          'Copy the whole /exec link again, starting with https://.');
    }
    return { url, key };
  }

  /** One trip, bounded by the timeout. Anything that goes wrong comes back as a sentence. */
  async function send(url: string, body: Record<string, unknown>, action: Action): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(TIMED_OUT), timeoutMs);
    });
    try {
      // Through then(), so a post that throws synchronously is handled the same
      // way. A Response's body is read inside the timeout too.
      const trip = Promise.resolve()
        .then(() => deps.post(url, body))
        .then((reply) => (isResponse(reply) ? readResponse(reply) : reply));
      return await Promise.race([trip, expired]);
    } catch (err) {
      throw failedTrip(err, action);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async call<T extends object = Reply>(action: Action, payload?: Payload): Promise<T> {
      const { url, key } = await settings(action);

      // action and key go last, so nothing in the payload can stand in for them.
      const body: Record<string, unknown> = {};
      if (payload) {
        for (const name of Object.keys(payload)) {
          const value = payload[name];
          if (value !== undefined) body[name] = value;
        }
      }
      body['action'] = action;
      body['key'] = key;

      const reply = readBody(await send(url, body, action), action);
      if (reply['ok'] === true) return reply as T;
      if (reply['ok'] === false) throw refusal(reply, action);
      throw unexpected(action);
    },

    async isConfigured(): Promise<boolean> {
      const { url, key } = await readConfig('ping');
      return url !== '' && key !== '';
    },

    async identity(): Promise<string> {
      const { seen } = await readConfig('ping');
      return seen ? `${seen}-${changes}` : '';
    },
  };
}

// ------------------------------------------------------------------ translation

/** Reads what `post` resolved with: an object, or text that should be JSON. */
function readBody(raw: unknown, action: Action): Reply {
  let value: unknown = raw;
  if (typeof value === 'string') {
    const text = value.trim(); // also drops a byte-order mark
    if (text === '') throw empty(action);
    // A web page instead of JSON is Google's sign-in page: the deployment is
    // not open to "Anyone". The commonest setup mistake there is.
    if (text.startsWith('<')) throw signInPage(action);
    try {
      value = JSON.parse(text);
    } catch (err) {
      throw unexpected(action, err);
    }
  }
  if (value === null || value === undefined) throw empty(action);
  const reply = asRecord(value);
  if (!reply) throw unexpected(action);
  return reply;
}

/** A server refusal, as the sentence the person should read. */
function refusal(reply: Reply, action: Action): BackendError {
  const error = asText(reply['error']).trim();
  const message = asText(reply['message']).trim();
  const theirs = (fallback: string): string => sentence(message || fallback);

  switch (error) {
    case 'unauthorized':
      return new BackendError('unauthorized', action,
        theirs('Your key was not recognised. Ask your manager for a new one.'));
    case 'forbidden':
      return new BackendError('forbidden', action, theirs('Your account is not allowed to do that.'));
    case 'cooldown': {
      // The server's own sentence: it holds the lock and the dates, so it knows best.
      const lastPosted = asText(reply['lastPosted']).trim();
      const nextAllowed = asText(reply['nextAllowed']).trim();
      const fallback = nextAllowed
        ? `This property was posted too recently. It can be posted again on ${nextAllowed}.`
        : 'This property is still inside its cooldown.';
      return new BackendError('cooldown', action, theirs(fallback), { lastPosted, nextAllowed });
    }
    case 'busy':
      return new BackendError('busy', action, 'Someone else is saving right now. Try again in a moment.');
    case 'notfound':
      return new BackendError('notfound', action,
        theirs(`Google could not find what it needed to ${DOING[action]}. Reload and try again.`));
  }

  // Code.gs throws these as plain text, with no message of their own.
  if (/^property not found\b/i.test(error)) {
    return new BackendError('notfound', action,
      'That property is no longer in the directory. Refresh the list and look for it again.');
  }
  if (/^unknown action\b/i.test(error)) {
    return new BackendError('outdated', action,
      `The web app is out of date and cannot ${DOING[action]}. Ask your manager to deploy the latest version.`);
  }
  const missing = /^missing:\s*(.+)$/i.exec(error);
  if (missing) {
    return new BackendError('incomplete', action,
      `Post-It sent an incomplete request (${missing[1]} missing) and could not ${DOING[action]}. ` +
        'This is a bug in Post-It: tell your manager.');
  }
  if (message) return new BackendError('server', action, sentence(message));
  if (error) {
    // A setup problem ('No "Directory" tab…', 'Tab "Posts" has no column for…')
    // or an Apps Script failure. Its own words are the useful part.
    return new BackendError('server', action,
      `Google could not ${DOING[action]}: ${sentence(error.replace(/^exception:\s*/i, ''))} ` +
        'If it keeps happening, show this to your manager.');
  }
  return new BackendError('server', action,
    `Google refused to ${DOING[action]}. Try again, and tell your manager if it keeps happening.`);
}

/** Why the trip itself failed: no connection, too slow, an HTTP error, or not JSON. */
function failedTrip(err: unknown, action: Action): UserFacingError {
  if (err instanceof UserFacingError) return err;

  if (err === TIMED_OUT || isTimeout(err)) {
    const cause = err === TIMED_OUT ? undefined : err;
    return new BackendError('timeout', action, WRITES.has(action)
      ? 'Google did not answer in time, so Post-It cannot tell whether that was saved. ' +
        'Reload and check before trying again.'
      : 'Google did not answer in time. Check your connection and try again.', { cause });
  }

  const status = httpStatus(err);
  if (status !== null) {
    let message: string;
    if (status < 400) {
      // Apps Script always answers with a 302; whatever sent this did not follow it.
      message = `Google redirected Post-It and it did not follow (error ${status}). ` +
        'This is a bug in Post-It: tell your manager.';
    } else if (status === 404) {
      message = 'Google could not find the web app (error 404). Check the web app link in Settings.';
    } else if (status === 401 || status === 403) {
      message = `Google would not let Post-It in (error ${status}). ` +
        'Ask your manager to check the web app is deployed with access set to "Anyone".';
    } else if (status === 429 || status >= 500) {
      message = `Google is having trouble right now (error ${status}). Try again in a minute.`;
    } else {
      message = `Google answered with error ${status}. Check the web app link in Settings.`;
    }
    return new BackendError('http', action, message, { cause: err });
  }

  // The platform tried to parse the body as JSON and could not.
  if (err instanceof SyntaxError) return unexpected(action, err);

  return new BackendError('unreachable', action,
    'Could not reach Google. Check your connection and try again.', { cause: err });
}

function signInPage(action: Action): BackendError {
  return new BackendError('sign-in-page', action,
    'Google sent a sign-in page instead of Post-It\'s data, so the web app is not open to Post-It. ' +
      'Ask your manager to redeploy it with access set to "Anyone".');
}

function empty(action: Action): BackendError {
  return new BackendError('empty', action, 'Google sent an empty reply. Try again in a moment.');
}

function unexpected(action: Action, cause?: unknown): BackendError {
  return new BackendError('unexpected', action,
    'Google sent something Post-It does not understand. Check the web app link in Settings.', { cause });
}

/** A fetch Response, by shape: a JSON reply can never carry a function. */
interface ResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

function isResponse(value: unknown): value is ResponseLike {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<Record<keyof ResponseLike, unknown>>;
  return typeof r.text === 'function' && typeof r.status === 'number' && typeof r.ok === 'boolean';
}

/** The body as text, or an HTTP failure when the status says so. */
async function readResponse(response: ResponseLike): Promise<string> {
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  return response.text();
}

function isTimeout(err: unknown): boolean {
  // Tauri's invoke rejects with a plain string, so read that too.
  if (typeof err === 'string') return /\btimed?[\s-]?out\b/i.test(err);
  if (!(err instanceof Error)) return false;
  return err.name === 'TimeoutError' || err.name === 'AbortError' || /\btimed?[\s-]?out\b/i.test(err.message);
}

/** The HTTP status a failed `post` carries, when it carries one. */
function httpStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 300 && status <= 599
    ? status
    : null;
}

function isAddress(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Ends a server's wording with a full stop when it has none. */
function sentence(text: string): string {
  return /[.!?…"”')\]]$/.test(text) ? text : `${text}.`;
}

/** Two FNV-1a passes: 64 bits that say "same link and key" without holding either. */
function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
