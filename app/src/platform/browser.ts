/**
 * The platform in a plain browser, for development only (`npm run dev`):
 * the screens talk to the real Apps Script web app, with a real key, and the
 * real Google Sheets behind it. main.tsx uses it only when
 * `import.meta.env.DEV` is true, so a production build never contains it; a
 * production build opened in a browser says to open the desktop app instead.
 *
 * What a browser cannot do, it says so: photos cannot be saved to disk or a
 * folder opened in Explorer, and there is no window frame to draw.
 *
 * The request is sent as text/plain, which makes it a "simple" request: the
 * browser sends no CORS preflight, which Apps Script cannot answer. Code.gs
 * parses the body as JSON whatever its type. The POST to /exec answers with a
 * redirect to script.googleusercontent.com, which is followed.
 */

import { UserFacingError } from '../core/types';
import type { Platform } from './index';

/**
 * Where the key is kept in this browser tab. DEVELOPMENT ONLY: sessionStorage
 * is readable by any script on the page, which is why the desktop app keeps
 * the key in the OS's credential store instead (src-tauri/src/key.rs). It
 * goes when the tab is closed.
 */
export const BROWSER_KEY_ITEM = 'apg-post-it.key';
/** Prefix for readLocal / writeLocal values in localStorage. */
export const BROWSER_LOCAL_PREFIX = 'apg-post-it.local.';

/** A failed POST that reached the server: core/backend.ts reads `status`. */
export class BrowserHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The web app answered with HTTP ${status}.`);
    this.name = 'BrowserHttpError';
    this.status = status;
  }
}

export interface BrowserPlatformOptions {
  /** Default: the global fetch. */
  readonly fetch?: typeof fetch;
  /** Default: window.sessionStorage. Holds the key. */
  readonly session?: Storage | null;
  /** Default: window.localStorage. Holds readLocal / writeLocal values. */
  readonly local?: Storage | null;
  /** Default: navigator.clipboard. */
  readonly clipboard?: Pick<Clipboard, 'writeText'> | null;
  /** Default: window.open. */
  readonly openWindow?: (url: string, target: string, features: string) => unknown;
}

export function createBrowserPlatform(options: BrowserPlatformOptions = {}): Platform {
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const session = (): Storage | null => ('session' in options ? options.session ?? null : storage('sessionStorage'));
  const local = (): Storage | null => ('local' in options ? options.local ?? null : storage('localStorage'));
  const clipboard = (): Pick<Clipboard, 'writeText'> | null =>
    'clipboard' in options ? options.clipboard ?? null : globalThis.navigator?.clipboard ?? null;
  const openWindow =
    options.openWindow ?? ((url: string, target: string, features: string) => globalThis.window?.open(url, target, features));

  // When storage is blocked (a private window, blocked site data), values live for this page only.
  const memory = new Map<string, string>();
  const read = (store: Storage | null, name: string): string | null => {
    try {
      const stored = store?.getItem(name);
      if (stored !== null && stored !== undefined) return stored;
    } catch {
      /* fall back to memory */
    }
    return memory.get(name) ?? null;
  };
  const write = (store: Storage | null, name: string, value: string | null): void => {
    if (value === null) memory.delete(name);
    else memory.set(name, value);
    try {
      if (!store) return;
      if (value === null) store.removeItem(name);
      else store.setItem(name, value);
    } catch {
      /* kept in memory */
    }
  };

  return {
    hasFileSystem: false,

    async copyText(text) {
      const board = clipboard();
      try {
        if (!board) throw new Error('no clipboard');
        await board.writeText(text);
      } catch (err) {
        throw new UserFacingError(
          'Could not copy to the clipboard. Click the page first, then try again.',
          err,
        );
      }
    },

    async post(url, body) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body),
          redirect: 'follow',
        });
      } catch (err) {
        // A CORS failure looks like any other network failure; backend.ts puts it into words.
        throw err instanceof Error ? err : new Error(String(err));
      }
      if (isSignInPage(response.url)) {
        throw new UserFacingError(
          'Google asked for a sign-in instead of answering, so the web app is not open to Post-It. ' +
            'Ask your admin to redeploy it with access set to "Anyone".',
        );
      }
      const text = await response.text();
      if (!response.ok) throw new BrowserHttpError(response.status);
      return parseJson(text);
    },

    async savePhotos() {
      throw new UserFacingError('Saving photos works in the desktop app.');
    },

    async open(target) {
      const what = target.trim();
      if (!/^https:\/\//i.test(what)) {
        throw new UserFacingError(`In a browser Post-It opens only https:// links, so it did not open ${what}.`);
      }
      openWindow(what, '_blank', 'noopener,noreferrer');
    },

    async readLocal(name) {
      return read(local(), BROWSER_LOCAL_PREFIX + name);
    },

    async writeLocal(name, value) {
      write(local(), BROWSER_LOCAL_PREFIX + name, value);
    },

    async readKey() {
      return read(session(), BROWSER_KEY_ITEM)?.trim() || null;
    },

    async writeKey(value) {
      // As src-tauri/src/key.rs.
      const trimmed = value.trim();
      if ([...trimmed].length > 512) {
        throw new UserFacingError('That is too long to be a key (the most is 512 characters). Check what was pasted.');
      }
      if (/\p{Cc}/u.test(trimmed)) throw new UserFacingError('A key is one line of text. Check what was pasted.');
      write(session(), BROWSER_KEY_ITEM, trimmed || null);
    },

    // A browser tab has no window for the app to control.
    hasWindowControls: false,
    minimize: async () => {},
    toggleMaximize: async () => {},
    isMaximized: async () => false,
    onMaximizedChange: () => () => {},
    requestClose: async () => {},
    onCloseRequested: () => () => {},
    destroy: async () => {},
  };
}

function storage(name: 'sessionStorage' | 'localStorage'): Storage | null {
  try {
    return (globalThis as unknown as Record<string, Storage | undefined>)[name] ?? null;
  } catch {
    return null;
  }
}

function isSignInPage(address: string): boolean {
  try {
    return new URL(address).hostname === 'accounts.google.com';
  } catch {
    return false;
  }
}

/** JSON when it is JSON; the text otherwise, so backend.ts can recognise a sign-in page. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
