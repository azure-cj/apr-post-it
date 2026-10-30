/**
 * The platform inside the Tauri app: each call goes to a plugin or to one of
 * the three Rust commands in src-tauri/src (save_photos, read_key, write_key).
 * Everything the WebView may reach is granted in
 * src-tauri/capabilities/default.json, and nothing else.
 *
 * Anything a person should read comes back as a UserFacingError. What
 * core/backend.ts reads for itself, an HTTP status or a network failure, is
 * passed on as a plain Error for it to put into words.
 */

import { invoke } from '@tauri-apps/api/core';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { fetch } from '@tauri-apps/plugin-http';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { load, type Store } from '@tauri-apps/plugin-store';

import { UserFacingError } from '../core/types';
import type { Platform, SavedPhoto } from './index';

/**
 * Where readLocal and writeLocal keep their values: one JSON file in
 * %LOCALAPPDATA%\com.alphapremier.apgpostit. Local, not roaming, because
 * what goes in it (the directory cache) can always be fetched again
 * (docs/DATA-FLOW.md).
 */
export const LOCAL_STORE_FILE = 'local.json';

/** A failed POST that reached the server: core/backend.ts reads `status`. */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The web app answered with HTTP ${status}.`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

export function createTauriPlatform(): Platform {
  let local: Promise<Store> | null = null;

  const localStore = (): Promise<Store> => {
    local ??= (async () => {
      const path = await join(await appLocalDataDir(), LOCAL_STORE_FILE);
      return load(path, { defaults: {}, autoSave: 200 });
    })().catch((err: unknown) => {
      local = null; // try again next time rather than failing for the whole run
      throw err;
    });
    return local;
  };

  return {
    hasFileSystem: true,

    async copyText(text) {
      try {
        await writeText(text);
      } catch (err) {
        throw new UserFacingError(
          'Could not copy to the clipboard. Another program may be holding it: try again in a moment.',
          err,
        );
      }
    },

    async post(url, body) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          connectTimeout: 20_000,
        });
      } catch (err) {
        throw fetchFailure(err, url);
      }
      const text = await response.text();
      if (!response.ok) throw new HttpStatusError(response.status);
      return parseJson(text);
    },

    async savePhotos(property, photos) {
      try {
        return await invoke<SavedPhoto[]>('save_photos', {
          property,
          photos: photos.map(({ name, url }) => ({ name, url })),
        });
      } catch (err) {
        throw fromRust(err, 'Could not save the photos');
      }
    },

    async open(target) {
      const what = target.trim();
      const isLink = /^[a-z][a-z0-9+.-]*:\/\//i.test(what) && !/^file:/i.test(what);
      try {
        if (isLink) await openUrl(what);
        else await openPath(what);
      } catch (err) {
        // The capability file allows https:// links and the photo folders only.
        const refused = /not allowed/i.test(errorText(err));
        let message = `Could not open ${what}.`;
        if (refused && isLink) message = `Post-It opens only https:// links, so it did not open ${what}.`;
        if (refused && !isLink) {
          message = `Post-It opens only its own photo folders, in Downloads\\APG Post-It, so it did not open ${what}.`;
        }
        throw new UserFacingError(message, err);
      }
    },

    async readLocal(key) {
      const value = await (await localStore()).get<unknown>(key);
      return typeof value === 'string' ? value : null;
    },

    async writeLocal(key, value) {
      await (await localStore()).set(key, value);
    },

    async readKey() {
      try {
        return await invoke<string | null>('read_key');
      } catch (err) {
        throw fromRust(err, 'Could not read your key');
      }
    },

    async writeKey(key) {
      try {
        await invoke<null>('write_key', { key });
      } catch (err) {
        throw fromRust(err, 'Could not save your key');
      }
    },
  };
}

/** JSON when it is JSON; the text otherwise, so backend.ts can recognise a sign-in page. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * The Rust commands answer with a sentence; pass it on. Anything else (the
 * command missing, or refused by the capability file) is a bug, said plainly.
 */
function fromRust(err: unknown, doing: string): UserFacingError {
  if (typeof err === 'string' && err.trim()) return new UserFacingError(err, err);
  return new UserFacingError(`${doing}: ${errorText(err)}`, err);
}

/** Plugins reject with a string; JavaScript with an Error. */
function errorText(err: unknown): string {
  return typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
}

const SCOPE_REFUSAL = /url not allowed on the configured scope:\s*(\S+)/i;

/**
 * Why the request never got an answer. The HTTP plugin follows a redirect only
 * to an address in the capability's scope, so a refusal there is turned into
 * what it means. Everything else goes on as an Error for backend.ts.
 */
function fetchFailure(err: unknown, requested: string): Error {
  const message = errorText(err);
  const refused = SCOPE_REFUSAL.exec(message)?.[1];
  if (refused) return new UserFacingError(scopeRefusal(refused, requested), err);
  return err instanceof Error ? err : new Error(message);
}

function scopeRefusal(refused: string, requested: string): string {
  const to = parseUrl(refused);
  const from = parseUrl(requested);

  if (to?.hostname === 'accounts.google.com') {
    return (
      'Google asked for a sign-in instead of answering, so the web app is not open to Post-It. ' +
      'Ask your manager to redeploy it with access set to "Anyone".'
    );
  }
  const isTheLinkItself = !from || !to || (to.origin === from.origin && to.pathname === from.pathname);
  if (isTheLinkItself) {
    if (to && to.protocol !== 'https:') {
      return 'The web app link in Settings must start with https://script.google.com/.';
    }
    return (
      `Post-It talks only to Google, and the web app link in Settings points to ${to?.hostname || refused}. ` +
      'Use the link Apps Script gives when the web app is deployed (https://script.google.com/…/exec).'
    );
  }
  return (
    `Google sent Post-It on to ${to.hostname}, which Post-It does not talk to. ` +
    'Check the web app link in Settings.'
  );
}

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}
