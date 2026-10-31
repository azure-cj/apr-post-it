/**
 * The development browser platform against a mocked fetch: how the request is
 * sent (text/plain, so Apps Script needs no CORS preflight; redirects
 * followed), what comes back, and what a browser cannot do.
 */

import { describe, expect, it, vi } from 'vitest';

import { createBackend } from '../core/backend';
import { UserFacingError } from '../core/types';
import { BROWSER_KEY_ITEM, BrowserHttpError, createBrowserPlatform } from './browser';
import type { Platform } from './index';

const EXEC = 'https://script.google.com/macros/s/AKfy/exec';
const ECHO = 'https://script.googleusercontent.com/macros/echo?user_content_key=abc';

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }
}

/** A Response as fetch resolves it, after following redirects to `url`. */
function answer(body: string, init: { status?: number; url?: string } = {}): Response {
  const response = new Response(body, { status: init.status ?? 200 });
  Object.defineProperty(response, 'url', { value: init.url ?? ECHO });
  return response;
}

function setup(reply: () => Response | Promise<Response> = () => answer('{"ok":true}')) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => reply());
  const session = new MemoryStorage();
  const local = new MemoryStorage();
  const writeText = vi.fn(async (_text: string) => {});
  const openWindow = vi.fn();
  const platform = createBrowserPlatform({
    fetch: fetch as unknown as typeof globalThis.fetch,
    session,
    local,
    clipboard: { writeText },
    openWindow,
  });
  return { platform, fetch, session, local, writeText, openWindow };
}

describe('post', () => {
  it('sends the body as JSON in a text/plain POST, following redirects, and answers with the parsed reply', async () => {
    const { platform, fetch } = setup(() => answer('{"ok":true,"name":"Mia"}'));

    await expect(platform.post(EXEC, { action: 'ping', key: 'k1' })).resolves.toEqual({ ok: true, name: 'Mia' });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(EXEC);
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
    });
    expect(JSON.parse(init!.body as string)).toEqual({ action: 'ping', key: 'k1' });
  });

  it('answers with the text when it is not JSON', async () => {
    const { platform } = setup(() => answer('<html>not json</html>'));
    await expect(platform.post(EXEC, {})).resolves.toBe('<html>not json</html>');
  });

  it('fails with the status when the server answers with an error', async () => {
    const { platform } = setup(() => answer('Forbidden', { status: 403 }));
    const error = await platform.post(EXEC, {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BrowserHttpError);
    expect(error).toMatchObject({ status: 403 });
  });

  it('says plainly when Google wanted a sign-in instead of answering', async () => {
    const { platform } = setup(() => answer('<html>Sign in</html>', { url: 'https://accounts.google.com/ServiceLogin' }));

    await expect(platform.post(EXEC, {})).rejects.toThrow(/^Google asked for a sign-in[\s\S]*"Anyone"/);
  });

  it('passes a network failure on as an Error, for backend.ts to put into words', async () => {
    const { platform } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await platform.post(EXEC, {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(UserFacingError);
  });

  it('is what the app\'s backend talks through', async () => {
    const { platform, fetch } = setup(() => answer('{"ok":true,"name":"Jan Dela Cruz","role":"Intern"}'));
    const backend = createBackend({ post: platform.post, getConfig: () => ({ url: EXEC, key: 'key-jan' }) });

    await expect(backend.call('ping')).resolves.toMatchObject({ name: 'Jan Dela Cruz' });
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ action: 'ping', key: 'key-jan' });
  });
});

describe('the key', () => {
  it('is kept in sessionStorage, trimmed, and an empty one removes it', async () => {
    const { platform, session } = setup();

    await expect(platform.readKey()).resolves.toBeNull();
    await platform.writeKey('  key-jan  ');
    expect(session.getItem(BROWSER_KEY_ITEM)).toBe('key-jan');
    await expect(platform.readKey()).resolves.toBe('key-jan');

    await platform.writeKey('   ');
    expect(session.getItem(BROWSER_KEY_ITEM)).toBeNull();
    await expect(platform.readKey()).resolves.toBeNull();
  });

  it('refuses what cannot be a key, as the desktop app does', async () => {
    const { platform } = setup();

    await expect(platform.writeKey('a'.repeat(513))).rejects.toThrow(/too long/);
    await expect(platform.writeKey('one\ntwo')).rejects.toThrow(/one line/);
  });

  it('still works for this page when storage is blocked', async () => {
    const blocked = new MemoryStorage();
    blocked.setItem = () => {
      throw new Error('SecurityError');
    };
    const platform = createBrowserPlatform({ session: blocked, local: null });

    await platform.writeKey('key-jan');
    await expect(platform.readKey()).resolves.toBe('key-jan');
    await platform.writeLocal('last', 'Jan');
    await expect(platform.readLocal('last')).resolves.toBe('Jan');
  });
});

describe('local values', () => {
  it('are kept in localStorage, apart from the key', async () => {
    const { platform, local, session } = setup();

    await expect(platform.readLocal('filter')).resolves.toBeNull();
    await platform.writeLocal('filter', 'LOT');
    await expect(platform.readLocal('filter')).resolves.toBe('LOT');
    expect(local.length).toBe(1);
    expect(session.length).toBe(0);
  });
});

describe('what a browser can and cannot do', () => {
  it('copies through navigator.clipboard', async () => {
    const { platform, writeText } = setup();

    await platform.copyText('FOR SALE');
    expect(writeText).toHaveBeenCalledWith('FOR SALE');
  });

  it('says so when the clipboard refuses', async () => {
    const platform = createBrowserPlatform({ clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    await expect(platform.copyText('x')).rejects.toBeInstanceOf(UserFacingError);
  });

  it('opens https:// links in a new tab, and nothing else', async () => {
    const { platform, openWindow } = setup();

    await platform.open(' https://www.facebook.com/groups/apg/ ');
    expect(openWindow).toHaveBeenCalledWith('https://www.facebook.com/groups/apg/', '_blank', 'noopener,noreferrer');

    await expect(platform.open('C:\\Users\\Jan\\Downloads\\APG Post-It')).rejects.toBeInstanceOf(UserFacingError);
    await expect(platform.open('http://example.com')).rejects.toBeInstanceOf(UserFacingError);
    expect(openWindow).toHaveBeenCalledTimes(1);
  });

  it('cannot save photos, and says where it can', async () => {
    const { platform } = setup();
    const error = await platform
      .savePhotos('Lot 9', [{ name: 'a.jpg', url: 'https://drive.google.com/uc?id=1' }])
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe('Saving photos works in the desktop app.');
  });

  it('has no file system and draws no window controls, which do nothing', async () => {
    const { platform } = setup();
    const asPlatform: Platform = platform;

    expect(asPlatform.hasFileSystem).toBe(false);
    expect(asPlatform.hasWindowControls).toBe(false);
    await expect(asPlatform.isMaximized()).resolves.toBe(false);
    await expect(asPlatform.minimize()).resolves.toBeUndefined();
    await expect(asPlatform.requestClose()).resolves.toBeUndefined();
    asPlatform.onCloseRequested(() => {})();
    asPlatform.onMaximizedChange(() => {})();
  });
});
