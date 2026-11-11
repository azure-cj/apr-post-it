/**
 * The Tauri platform against a mocked IPC: which command each call makes, with
 * which arguments, and how what comes back is put into words. The argument
 * names are the contract with src-tauri/src (save_photos, copy_photo, read_key, write_key)
 * and with the plugins' versions pinned in package.json.
 */

import { emit } from '@tauri-apps/api/event';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserFacingError } from '../core/types';
import { createTauriPlatform, HttpStatusError, LOCAL_STORE_FILE, PHOTOS_PROGRESS } from './tauri';

type Args = Record<string, unknown>;
type Handler = (cmd: string, args: Args) => unknown;

let calls: { cmd: string; args: Args }[] = [];

function ipc(handler: Handler): void {
  calls = [];
  mockIPC((cmd, args) => {
    const a = (args ?? {}) as Args;
    calls.push({ cmd, args: a });
    return handler(cmd, a);
  });
}

const commands = (): string[] => calls.map((c) => c.cmd);
const argsOf = (cmd: string): Args | undefined => calls.find((c) => c.cmd === cmd)?.args;

beforeEach(() => {
  // The mocks hang off `window`; in Node, the global object stands in for it.
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------- the HTTP plugin's side

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

type Answer = { readonly status: number; readonly body: string } | { readonly fails: string };

/** Speaks the HTTP plugin's IPC: fetch, then fetch_send, then fetch_read_body until done. */
function web(answer: (sent: Sent) => Answer): Handler {
  let pending: { status: number; body: Uint8Array; url: string } | null = null;
  let read = false;
  return (cmd, args) => {
    switch (cmd) {
      case 'plugin:http|fetch': {
        const config = args['clientConfig'] as {
          url: string;
          method: string;
          headers: [string, string][];
          data: number[] | null;
        };
        const sent: Sent = {
          url: config.url,
          method: config.method,
          headers: config.headers,
          body: new TextDecoder().decode(new Uint8Array(config.data ?? [])),
        };
        const reply = answer(sent);
        if ('fails' in reply) throw reply.fails; // plugins reject with a string
        pending = { status: reply.status, body: new TextEncoder().encode(reply.body), url: config.url };
        read = false;
        return 1;
      }
      case 'plugin:http|fetch_send':
        return { status: pending!.status, statusText: '', url: pending!.url, headers: [], rid: 2 };
      case 'plugin:http|fetch_read_body':
        if (read) return [1]; // the last byte 1 means "no more"
        read = true;
        return [...pending!.body, 0];
      case 'plugin:http|fetch_cancel_body':
        return null;
      default:
        throw `unexpected command ${cmd}`;
    }
  };
}

const EXEC = 'https://script.google.com/macros/s/AKfy/exec';

describe('post', () => {
  it('POSTs the body as JSON, and answers with the parsed reply', async () => {
    let sent: Sent | undefined;
    ipc(
      web((s) => {
        sent = s;
        return { status: 200, body: '{"ok":true,"name":"Mia"}' };
      }),
    );

    await expect(createTauriPlatform().post(EXEC, { action: 'ping', key: 'k1' })).resolves.toEqual({
      ok: true,
      name: 'Mia',
    });
    expect(sent?.url).toBe(EXEC);
    expect(sent?.method).toBe('POST');
    expect(JSON.parse(sent?.body ?? '')).toEqual({ action: 'ping', key: 'k1' });
    expect(sent?.headers).toContainEqual(['content-type', 'application/json']);
  });

  it('answers with the text when it is not JSON, so a sign-in page can be recognised', async () => {
    const page = '<!DOCTYPE html><html><title>Sign in - Google Accounts</title></html>';
    ipc(web(() => ({ status: 200, body: page })));
    await expect(createTauriPlatform().post(EXEC, { action: 'ping' })).resolves.toBe(page);
  });

  it('fails with the status when the server answers with an error', async () => {
    ipc(web(() => ({ status: 403, body: 'Forbidden' })));
    const error = await createTauriPlatform()
      .post(EXEC, { action: 'ping' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error).toMatchObject({ status: 403 });
  });

  it('says plainly when Google wanted a sign-in instead of answering', async () => {
    ipc(
      web(() => ({
        fails: 'url not allowed on the configured scope: https://accounts.google.com/ServiceLogin?continue=x',
      })),
    );
    const error = await createTauriPlatform()
      .post(EXEC, { action: 'ping' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toMatch(/^Google asked for a sign-in/);
    expect((error as Error).message).toContain('"Anyone"');
  });

  it('says the Settings link is wrong when it is not Google', async () => {
    const link = 'https://example.com/exec';
    ipc(web(() => ({ fails: `url not allowed on the configured scope: ${link}` })));
    await expect(createTauriPlatform().post(link, {})).rejects.toThrow(
      /talks only to Google, and the web app link in Settings points to example\.com/,
    );
  });

  it('says the Settings link must be https', async () => {
    const link = 'http://script.google.com/macros/s/AKfy/exec';
    ipc(web(() => ({ fails: `url not allowed on the configured scope: ${link}` })));
    await expect(createTauriPlatform().post(link, {})).rejects.toThrow(
      'The web app link in Settings must start with https://script.google.com/.',
    );
  });

  it('says where Google tried to send it when that is somewhere else', async () => {
    ipc(web(() => ({ fails: 'url not allowed on the configured scope: https://example.org/landing' })));
    await expect(createTauriPlatform().post(EXEC, {})).rejects.toThrow(
      /^Google sent Post-It on to example\.org/,
    );
  });

  it('passes any other failure on as an Error for core/backend.ts to word', async () => {
    ipc(web(() => ({ fails: `error sending request for url (${EXEC})` })));
    const error = await createTauriPlatform()
      .post(EXEC, {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(`error sending request for url (${EXEC})`);
  });
});

describe('copyText', () => {
  it('writes the text to the clipboard', async () => {
    ipc(() => null);
    await createTauriPlatform().copyText('FOR SALE — Casa Amara');
    expect(commands()).toEqual(['plugin:clipboard-manager|write_text']);
    expect(argsOf('plugin:clipboard-manager|write_text')).toMatchObject({ text: 'FOR SALE — Casa Amara' });
  });

  it('says so when the clipboard is busy', async () => {
    ipc(() => {
      throw 'clipboard error: Unknown error while interacting with the clipboard';
    });
    await expect(createTauriPlatform().copyText('x')).rejects.toThrow(/^Could not copy to the clipboard\./);
  });
});

describe('copyPhoto', () => {
  it('calls copy_photo with the name the person sees and the address', async () => {
    ipc(() => null);
    await createTauriPlatform().copyPhoto('https://drive.google.com/uc?export=download&id=a', 'Photo 3');
    expect(calls).toEqual([{ cmd: 'copy_photo', args: { name: 'Photo 3', url: 'https://drive.google.com/uc?export=download&id=a' } }]);
  });

  it("passes Rust's sentence on as it is, and says what it was doing otherwise", async () => {
    const sentence = "Could not copy \"Photo 3\": Post-It can't copy a .heic photo. Use Download instead.";
    ipc(() => {
      throw sentence;
    });
    await expect(createTauriPlatform().copyPhoto('https://drive.google.com/x', 'Photo 3')).rejects.toThrow(sentence);
    ipc(() => {
      throw new Error('copy_photo not allowed');
    });
    await expect(createTauriPlatform().copyPhoto('https://drive.google.com/x', 'Photo 3')).rejects.toThrow(
      'Could not copy Photo 3: copy_photo not allowed',
    );
  });
});

describe('savePhotos', () => {
  it('calls save_photos with the listing and each photo name and address only', async () => {
    const saved = [{ name: 'photo 1', path: 'C:\\Users\\Mia\\Downloads\\APG Post-It\\Lot 7\\photo 1.jpg' }];
    ipc(() => saved);
    const photo = { name: 'photo 1', url: 'https://drive.google.com/uc?export=download&id=a', thumb: 't' };

    await expect(createTauriPlatform().savePhotos('Lot 7', [photo])).resolves.toEqual(saved);
    expect(calls).toEqual([
      {
        cmd: 'save_photos',
        args: { property: 'Lot 7', photos: [{ name: 'photo 1', url: 'https://drive.google.com/uc?export=download&id=a' }] },
      },
    ]);
  });

  it('hears its own photos-progress events while saving, with a job id, and stops listening after', async () => {
    const saved = [{ name: 'photo 1', path: 'C:\\x\\photo 1.jpg', converted: true }];
    mockIPC(
      async (cmd, args) => {
        const a = (args ?? {}) as Args;
        calls.push({ cmd, args: a });
        const job = a['job'] as string;
        await emit(PHOTOS_PROGRESS, { job: 'someone-else', name: 'photo 9', step: 'saved', done: 0, total: 1 });
        await emit(PHOTOS_PROGRESS, { job, name: 'photo 1', step: 'converting', done: 0, total: 1 });
        await emit(PHOTOS_PROGRESS, { job, name: 'photo 1', step: 'saved', done: 0, total: 1 });
        return saved;
      },
      { shouldMockEvents: true },
    );
    calls = [];
    const heard: unknown[] = [];
    const photo = { name: 'photo 1', url: 'https://drive.google.com/uc?export=download&id=a' };

    await expect(createTauriPlatform().savePhotos('Lot 7', [photo], (p) => heard.push(p))).resolves.toEqual(saved);

    expect(calls.map((c) => c.cmd)).toEqual(['save_photos']);
    expect(calls[0]?.args).toMatchObject({ property: 'Lot 7', photos: [photo], job: expect.stringMatching(/^photos-/) });
    expect(heard).toEqual([
      { name: 'photo 1', step: 'converting', done: 0, total: 1 },
      { name: 'photo 1', step: 'saved', done: 0, total: 1 },
    ]);
    // Unlistened: an event after the save reaches no one.
    await emit(PHOTOS_PROGRESS, { job: calls[0]?.args['job'], name: 'photo 1', step: 'saved', done: 0, total: 1 });
    expect(heard).toHaveLength(2);
  });

  it("passes Rust's sentence on as it is", async () => {
    const sentence = 'Refused to download "photo 2": its address points to example.com. Nothing was saved.';
    ipc(() => {
      throw sentence;
    });
    const error = await createTauriPlatform()
      .savePhotos('Lot 7', [{ name: 'photo 2', url: 'https://example.com/x.jpg' }])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(sentence);
  });

  it('says what it was doing when the failure is not a sentence', async () => {
    ipc(() => {
      throw new Error('save_photos not allowed');
    });
    await expect(createTauriPlatform().savePhotos('Lot 7', [])).rejects.toThrow(
      'Could not save the photos: save_photos not allowed',
    );
  });
});

describe('open', () => {
  it('opens a link in the browser', async () => {
    ipc(() => null);
    await createTauriPlatform().open('https://www.facebook.com/groups/123');
    expect(calls).toEqual([{ cmd: 'plugin:opener|open_url', args: { url: 'https://www.facebook.com/groups/123' } }]);
  });

  it('opens a folder in Explorer', async () => {
    ipc(() => null);
    const folder = 'C:\\Users\\Mia\\Downloads\\APG Post-It\\Lot 7';
    await createTauriPlatform().open(folder);
    expect(calls).toEqual([{ cmd: 'plugin:opener|open_path', args: { path: folder } }]);
  });

  it('says why when the capability file refuses a link', async () => {
    ipc(() => {
      throw 'Not allowed to open url http://example.com';
    });
    await expect(createTauriPlatform().open('http://example.com')).rejects.toThrow(
      'Post-It opens only https:// links, so it did not open http://example.com.',
    );
  });

  it('says why when the capability file refuses a folder', async () => {
    ipc(() => {
      throw 'Not allowed to open path C:\\Windows';
    });
    await expect(createTauriPlatform().open('C:\\Windows')).rejects.toThrow(
      /^Post-It opens only its own photo folders/,
    );
  });
});

describe('readLocal and writeLocal', () => {
  /** A store plugin with one file, and the path plugin that finds it. */
  function storeIpc(values: Map<string, unknown>, failLoads = 0): void {
    let failures = failLoads;
    ipc((cmd, args) => {
      switch (cmd) {
        case 'plugin:path|resolve_directory':
          return 'C:\\Users\\Mia\\AppData\\Local\\com.alphapremier.apgpostit';
        case 'plugin:path|join':
          return (args['paths'] as string[]).join('\\');
        case 'plugin:store|load':
          if (failures-- > 0) throw 'failed to load store';
          return 7;
        case 'plugin:store|get': {
          const key = args['key'] as string;
          return [values.get(key) ?? null, values.has(key)];
        }
        case 'plugin:store|set':
          values.set(args['key'] as string, args['value']);
          return null;
        default:
          throw `unexpected command ${cmd}`;
      }
    });
  }

  it('keeps values in local.json in the local (not roaming) app data folder, loaded once', async () => {
    const values = new Map<string, unknown>();
    storeIpc(values);
    const p = createTauriPlatform();

    await p.writeLocal('filter', 'Condo');
    await expect(p.readLocal('filter')).resolves.toBe('Condo');
    await expect(p.readLocal('missing')).resolves.toBeNull();

    expect(commands().filter((c) => c === 'plugin:store|load')).toHaveLength(1);
    expect(argsOf('plugin:path|join')).toEqual({
      paths: ['C:\\Users\\Mia\\AppData\\Local\\com.alphapremier.apgpostit', LOCAL_STORE_FILE],
    });
    expect(argsOf('plugin:store|load')).toEqual({
      path: `C:\\Users\\Mia\\AppData\\Local\\com.alphapremier.apgpostit\\${LOCAL_STORE_FILE}`,
      options: { defaults: {}, autoSave: 200 },
    });
  });

  it('reads anything that is not text as nothing', async () => {
    storeIpc(new Map<string, unknown>([['n', 42]]));
    await expect(createTauriPlatform().readLocal('n')).resolves.toBeNull();
  });

  it('tries loading the store again after a failure', async () => {
    storeIpc(new Map(), 1);
    const p = createTauriPlatform();
    await expect(p.readLocal('k')).rejects.toBe('failed to load store');
    await expect(p.readLocal('k')).resolves.toBeNull();
  });
});

describe('readKey and writeKey', () => {
  it('read the key through read_key', async () => {
    ipc(() => 'k1');
    await expect(createTauriPlatform().readKey()).resolves.toBe('k1');
    expect(calls).toEqual([{ cmd: 'read_key', args: {} }]);
  });

  it('read no key as null', async () => {
    ipc(() => null);
    await expect(createTauriPlatform().readKey()).resolves.toBeNull();
  });

  it('write the key through write_key', async () => {
    ipc(() => null);
    await createTauriPlatform().writeKey('k2');
    expect(calls).toEqual([{ cmd: 'write_key', args: { key: 'k2' } }]);
  });

  it("pass the credential store's sentence on", async () => {
    const sentence = 'Could not save your key in Windows Credential Manager: access denied.';
    ipc(() => {
      throw sentence;
    });
    const error = await createTauriPlatform()
      .writeKey('k2')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(sentence);
  });
});

it('has a file system', () => {
  expect(createTauriPlatform().hasFileSystem).toBe(true);
});

// ------------------------------------------------------------------ the window

describe("the window's controls", () => {
  /** Answers the window plugin, and keeps each event listener's callback id. */
  function windowIpc(maximized: () => boolean = () => false) {
    const listeners = new Map<string, number>();
    ipc((cmd, args) => {
      if (cmd === 'plugin:event|listen') {
        listeners.set(args['event'] as string, args['handler'] as number);
        return args['handler'];
      }
      if (cmd === 'plugin:window|is_maximized') return maximized();
      return null;
    });
    mockWindows('main');
    const fire = (event: string) => {
      const id = listeners.get(event);
      if (id === undefined) throw new Error(`Nothing listens for ${event}.`);
      (window as unknown as { __TAURI_INTERNALS__: { runCallback(id: number, data: unknown): void } }).__TAURI_INTERNALS__.runCallback(id, {
        event,
        id: 1,
        payload: event === 'tauri://resize' ? { width: 800, height: 600 } : null,
      });
    };
    return { listeners, fire };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('are drawn by the app', () => {
    expect(createTauriPlatform().hasWindowControls).toBe(true);
  });

  it.each([
    ['minimize', 'plugin:window|minimize'],
    ['toggleMaximize', 'plugin:window|toggle_maximize'],
    ['requestClose', 'plugin:window|close'],
    ['destroy', 'plugin:window|destroy'],
  ] as const)('%s calls %s on the main window', async (method, cmd) => {
    windowIpc();
    await createTauriPlatform()[method]();
    expect(commands()).toEqual([cmd]);
    expect(argsOf(cmd)).toMatchObject({ label: 'main' });
  });

  it('read whether the window is maximized', async () => {
    windowIpc(() => true);
    await expect(createTauriPlatform().isMaximized()).resolves.toBe(true);
  });

  it('hold every request to close, and hand it to the app instead of closing', async () => {
    const { fire } = windowIpc();
    const asked = vi.fn();
    createTauriPlatform().onCloseRequested(asked);
    await settle();

    fire('tauri://close-requested'); // the close button, Alt+F4 or the taskbar
    await settle();

    expect(asked).toHaveBeenCalledTimes(1);
    // Held: Tauri would have destroyed the window after the listener otherwise.
    expect(commands()).not.toContain('plugin:window|destroy');
  });

  it('stop listening when asked, even before listening has begun', async () => {
    windowIpc();
    const stop = createTauriPlatform().onCloseRequested(() => {});
    stop();
    await settle();
    expect(commands()).toContain('plugin:event|unlisten');
  });

  it('say when the window is maximized or restored, once per change', async () => {
    let maximized = false;
    const { fire } = windowIpc(() => maximized);
    const seen: boolean[] = [];
    createTauriPlatform().onMaximizedChange((now) => seen.push(now));
    await settle();

    maximized = true;
    fire('tauri://resize');
    await settle();
    fire('tauri://resize');
    await settle();
    maximized = false;
    fire('tauri://resize');
    await settle();

    expect(seen).toEqual([true, false]);
  });
});

