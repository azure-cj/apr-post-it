/**
 * The platform with no OS behind it: everything in memory. It is what runs
 * the app in a plain browser (`npm run dev`) and what the tests use.
 *
 * A test scripts what the web app answers, per action, and afterwards reads
 * what was copied, opened, posted and saved:
 *
 *   const fake = createFakePlatform({
 *     replies: {
 *       ping: { ok: true, name: 'Jan Dela Cruz', role: 'Intern' },
 *       logPost: { ok: false, error: 'cooldown', nextAllowed: '2026-11-07' },
 *       property: (body) => ({ ok: true, id: body['id'], publicText: '…' }),
 *       posts: new Error('offline'),            // the trip itself fails
 *       assignments: fakeHttpError(503),        // an HTTP failure
 *     },
 *   });
 *   setPlatform(fake);
 *   …
 *   expect(fake.copied).toEqual(['FOR SALE — Casa Amara…']);
 *   expect(fake.posts.map((p) => p.action)).toEqual(['ping', 'property']);
 *
 * Where the real platform has rules a caller can see, the fake keeps them:
 * the body goes through JSON, photos are named and numbered the way
 * src-tauri/src/names.rs names them, only Google Drive addresses are
 * downloaded, only https:// links and the photo folders are opened, and an
 * empty key removes the key.
 */

import { UserFacingError } from '../core/types';
import type { Platform, SavedPhoto } from './index';

/**
 * What `post` answers for one action:
 * - a function: called with the request body (as the server would read it)
 *   and the address; what it returns, resolves with or throws is the answer;
 * - an Error: the trip fails with it, as when Google cannot be reached;
 * - anything else: the reply, copied fresh for each call. A string is
 *   returned as text, which is how a sign-in page arrives.
 */
export type FakeReply =
  | ((body: Readonly<Record<string, unknown>>, url: string) => unknown)
  | Error
  | string
  | number
  | boolean
  | null
  | Readonly<Record<string, unknown>>
  | readonly unknown[];

/** Every method of the platform, by name. */
export type FakeMethod = Exclude<keyof Platform, 'hasFileSystem' | 'hasWindowControls'>;

export interface FakePlatformOptions {
  /** What `post` answers, by the `action` in the request body. */
  readonly replies?: Readonly<Record<string, FakeReply>>;
  /** What `post` answers for an action with no reply of its own. Default: the call fails, naming the action. */
  readonly otherwise?: FakeReply;
  /** A key already saved, as if entered on an earlier run. */
  readonly key?: string | null;
  /** Values already kept by readLocal / writeLocal. */
  readonly local?: Readonly<Record<string, string>>;
  /** Photos whose download fails, by name or address: a partial save, or none. */
  readonly failingPhotos?: readonly string[];
  /** Methods that fail, with the sentence each fails with. */
  readonly failures?: Readonly<Partial<Record<FakeMethod, string>>>;
  /** Milliseconds every call takes, to see loading states in the browser. Default 0. */
  readonly delayMs?: number;
  /** Default false: in a browser, nothing can be saved to disk or opened in Explorer. */
  readonly hasFileSystem?: boolean;
  /** Default false: in a browser there is no window to minimize or close. True draws the controls anyway. */
  readonly hasWindowControls?: boolean;
}

/** What has happened to the fake's window. */
export interface FakeWindow {
  readonly minimized: boolean;
  readonly maximized: boolean;
  /** Closed for good, by destroy(). */
  readonly destroyed: boolean;
  /** How many times something asked to close it. */
  readonly closeRequests: number;
}

export interface FakePost {
  readonly url: string;
  /** The body as the server would read it: through JSON. */
  readonly body: unknown;
  /** The body's `action`, or '' when it has none. */
  readonly action: string;
}

export interface FakeSave {
  readonly property: string;
  readonly photos: readonly { readonly name: string; readonly url: string }[];
  /** What the call resolved with. Empty when it failed. */
  readonly saved: readonly SavedPhoto[];
}

export interface FakePlatform extends Platform {
  /** Everything copied, oldest first. */
  readonly copied: readonly string[];
  /** Every link and folder opened, oldest first. */
  readonly opened: readonly string[];
  /** Every request to the web app, oldest first. */
  readonly posts: readonly FakePost[];
  /** Every savePhotos call, oldest first, including those that failed. */
  readonly saves: readonly FakeSave[];
  /** Changes what `post` answers for an action, from the next call on. */
  reply(action: string, reply: FakeReply): void;
  /** The window, as the calls left it. */
  readonly window: FakeWindow;
  /**
   * Closing from outside the app, as Alt+F4 or the taskbar do: held and handed
   * to onCloseRequested, or the window closes when nobody is listening.
   */
  closeFromOutside(): void;
  /** Maximizing or restoring from outside the app: Win+Up, a snap, a double-click. */
  setMaximizedFromOutside(maximized: boolean): void;
}

/** Where the fake pretends the Downloads folder is. */
export const FAKE_DOWNLOADS = 'C:\\Users\\Intern\\Downloads';
/** Where the fake pretends photos go: one folder per listing inside it. */
export const FAKE_PHOTOS_FOLDER = `${FAKE_DOWNLOADS}\\APG Post-It`;

/** An HTTP failure, for a reply: core/backend.ts reads its `status`. */
export function fakeHttpError(status: number): Error & { readonly status: number } {
  return Object.assign(new Error(`The web app answered with HTTP ${status}.`), { status });
}

export function createFakePlatform(options: FakePlatformOptions = {}): FakePlatform {
  const replies = new Map<string, FakeReply>(Object.entries(options.replies ?? {}));
  const local = new Map<string, string>(Object.entries(options.local ?? {}));
  const failing = new Set(options.failingPhotos ?? []);
  const failures = options.failures ?? {};
  const delayMs = options.delayMs ?? 0;

  let key: string | null = options.key?.trim() || null;
  const files = new Set<string>(); // lower-cased: Windows compares names that way

  const win = { minimized: false, maximized: false, destroyed: false, closeRequests: 0 };
  const closeHandlers = new Set<() => void>();
  const maximizedHandlers = new Set<(maximized: boolean) => void>();
  const setMaximized = (maximized: boolean): void => {
    if (win.maximized === maximized) return;
    win.maximized = maximized;
    for (const handler of [...maximizedHandlers]) handler(maximized);
  };
  const askToClose = (): void => {
    if (win.destroyed) return;
    win.closeRequests++;
    // As Tauri does: with nobody listening, a request to close closes.
    if (closeHandlers.size === 0) win.destroyed = true;
    for (const handler of [...closeHandlers]) handler();
  };

  const copied: string[] = [];
  const opened: string[] = [];
  const posts: FakePost[] = [];
  const saves: FakeSave[] = [];

  /** Waits as a real call would, then fails if the test asked for that. */
  const begin = async (method: FakeMethod): Promise<void> => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const failure = failures[method];
    if (failure !== undefined) throw new UserFacingError(failure);
  };

  /** The path a photo would be saved to, numbered as Explorer does when the name is taken. */
  const claim = (folder: string, name: string): string => {
    const { stem, ext } = safeFileName(name);
    for (let n = 1; ; n++) {
      const path = `${folder}\\${n === 1 ? stem : `${stem} (${n})`}.${ext}`;
      if (!files.has(path.toLowerCase())) {
        files.add(path.toLowerCase());
        return path;
      }
    }
  };

  return {
    hasFileSystem: options.hasFileSystem ?? false,
    copied,
    opened,
    posts,
    saves,

    reply(action, reply) {
      replies.set(action, reply);
    },

    hasWindowControls: options.hasWindowControls ?? false,
    window: win,
    closeFromOutside: askToClose,
    setMaximizedFromOutside: setMaximized,

    async minimize() {
      await begin('minimize');
      win.minimized = true;
    },

    async toggleMaximize() {
      await begin('toggleMaximize');
      setMaximized(!win.maximized);
    },

    async isMaximized() {
      await begin('isMaximized');
      return win.maximized;
    },

    onMaximizedChange(handler) {
      maximizedHandlers.add(handler);
      return () => maximizedHandlers.delete(handler);
    },

    async requestClose() {
      await begin('requestClose');
      askToClose();
    },

    onCloseRequested(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },

    async destroy() {
      await begin('destroy');
      win.destroyed = true;
    },

    async copyText(text) {
      await begin('copyText');
      copied.push(text);
    },

    async post(url, body) {
      await begin('post');
      const sent = throughJson(body); // what Rust sends is JSON.stringify(body)
      const action = actionOf(sent);
      posts.push({ url, body: sent, action });

      const reply = replies.has(action) ? replies.get(action) : options.otherwise;
      if (reply === undefined) {
        throw new Error(`The fake platform has no reply for "${action || '(no action)'}". Add one to replies.`);
      }
      if (typeof reply === 'function') return throughJson(await reply(recordOf(sent), url));
      if (reply instanceof Error) throw reply;
      return throughJson(reply);
    },

    async savePhotos(property, photos) {
      const asked = photos.map(({ name, url }) => ({ name, url }));
      const record = (saved: readonly SavedPhoto[]): void => {
        saves.push({ property, photos: asked, saved });
      };
      try {
        await begin('savePhotos');
        // As in Rust: every address is checked first, and one bad one saves nothing.
        for (const photo of asked) {
          const refusal = refuse(photo.url);
          if (refusal) {
            throw new UserFacingError(
              `Refused to download "${photo.name}": its address ${refusal}. Nothing was saved.`,
            );
          }
        }
      } catch (err) {
        record([]);
        throw err;
      }

      const folder = `${FAKE_PHOTOS_FOLDER}\\${safeFolderName(property)}`;
      const saved = asked
        .filter((photo) => !failing.has(photo.name) && !failing.has(photo.url))
        .map((photo) => ({ name: photo.name, path: claim(folder, photo.name) }));
      record(saved);

      // As in Rust: the ones that worked are returned; none at all is an error.
      const first = asked[0];
      if (first && saved.length === 0) {
        const why = `Could not download "${first.name}".`;
        throw new UserFacingError(asked.length === 1 ? why : `None of the ${asked.length} photos were saved. ${why}`);
      }
      return saved;
    },

    async open(target) {
      await begin('open');
      const what = target.trim();
      // As the capability file allows: https:// links, and the photo folders.
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(what) && !/^file:/i.test(what)) {
        if (!/^https:\/\//i.test(what)) {
          throw new UserFacingError(`Post-It opens only https:// links, so it did not open ${what}.`);
        }
      } else if (!isInside(what, FAKE_PHOTOS_FOLDER)) {
        throw new UserFacingError(
          `Post-It opens only its own photo folders, in Downloads\\APG Post-It, so it did not open ${what}.`,
        );
      }
      opened.push(what);
    },

    async readLocal(name) {
      await begin('readLocal');
      return local.get(name) ?? null;
    },

    async writeLocal(name, value) {
      await begin('writeLocal');
      local.set(name, value);
    },

    async readKey() {
      await begin('readKey');
      return key;
    },

    async writeKey(value) {
      await begin('writeKey');
      // As in src-tauri/src/key.rs.
      const trimmed = value.trim();
      if ([...trimmed].length > 512) {
        throw new UserFacingError('That is too long to be a key (the most is 512 characters). Check what was pasted.');
      }
      if (/\p{Cc}/u.test(trimmed)) throw new UserFacingError('A key is one line of text. Check what was pasted.');
      key = trimmed || null;
    },
  };
}

function actionOf(body: unknown): string {
  const action = recordOf(body)['action'];
  return typeof action === 'string' ? action : '';
}

function recordOf(body: unknown): Readonly<Record<string, unknown>> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Readonly<Record<string, unknown>>)
    : {};
}

/** A fresh copy as JSON carries it, so neither side holds the other's objects. */
function throughJson(value: unknown): unknown {
  const text = JSON.stringify(value);
  return text === undefined ? undefined : (JSON.parse(text) as unknown);
}

function isInside(path: string, folder: string): boolean {
  const norm = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const p = norm(path);
  const f = norm(folder);
  return (p === f || p.startsWith(`${f}\\`)) && !p.split('\\').includes('..');
}

// ------------------------------------------------- the real platform's rules, in miniature

/** As src-tauri/src/hosts.rs: Google Drive's addresses, over https, and nothing else. */
function refuse(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return 'is not a web address';
  }
  if (url.protocol !== 'https:') return 'is not an https:// address';
  const host = url.hostname;
  const isDrive =
    host === 'drive.google.com' ||
    host === 'drive.usercontent.google.com' ||
    /^([a-z0-9-]+\.)+googleusercontent\.com$/.test(host);
  if (!isDrive) {
    return `points to ${host}, and photos may only come from drive.google.com, drive.usercontent.google.com, *.googleusercontent.com`;
  }
  if (url.username || url.password) return 'carries a user name or password';
  if (url.port) return 'names a port';
  return null;
}

const FORBIDDEN = /[<>:"/\\|?*]/g;
/** Rust's char::is_whitespace: Unicode White_Space. */
const WHITESPACE = /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;
const INVISIBLE = /[\p{Cc}\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB]/gu;
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const IMAGE_EXTENSION = /\.(jpe?g|jpe|jfif|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i;

/** As names.rs: what Windows refuses becomes _, and nothing is left that Windows would trim. */
function clean(raw: string, max: number): string | null {
  const mapped = raw
    .replace(FORBIDDEN, '_')
    .replace(WHITESPACE, ' ')
    .replace(INVISIBLE, '')
    .replace(/ {2,}/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '');
  const cut = [...mapped].slice(0, max).join('').replace(/[ .]+$/, '');
  if (!cut) return null;
  return RESERVED.test(cut.split('.')[0]!.trimEnd()) ? `_${cut}` : cut;
}

/** The folder a listing's photos go in, as Rust names it. */
export function safeFolderName(property: string): string {
  return clean(property, 64) ?? 'Property';
}

function safeFileName(name: string): { stem: string; ext: string } {
  const trimmed = name.trim();
  const ext = IMAGE_EXTENSION.exec(trimmed)?.[1]?.toLowerCase();
  const stem = clean(ext ? trimmed.slice(0, -(ext.length + 1)) : trimmed, 64) ?? 'photo';
  // Rust takes the extension from the downloaded bytes; the fake has none, so it trusts the name.
  if (ext === undefined || ext === 'jpeg' || ext === 'jpe' || ext === 'jfif') return { stem, ext: 'jpg' };
  return { stem, ext: ext === 'tiff' ? 'tif' : ext };
}
