import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserFacingError } from '../core/types';
import { createFakePlatform, FAKE_PHOTOS_FOLDER, fakeHttpError, safeFolderName } from './fake';
import { platform, setPlatform, type Platform } from './index';

const URL_ = 'https://script.google.com/macros/s/AKfy/exec';
const drive = (id: string): string => `https://drive.google.com/uc?export=download&id=${id}`;

describe('the fake platform', () => {
  it('is a Platform, and is what platform() hands out once set', () => {
    const fake = createFakePlatform();
    const asPlatform: Platform = fake;
    setPlatform(asPlatform);
    expect(platform()).toBe(fake);
  });

  it('has no file system unless a test says it has', () => {
    expect(createFakePlatform().hasFileSystem).toBe(false);
    expect(createFakePlatform({ hasFileSystem: true }).hasFileSystem).toBe(true);
  });
});

describe('post', () => {
  it('answers with the reply scripted for the action', async () => {
    const fake = createFakePlatform({
      replies: { ping: { ok: true, name: 'Jan Dela Cruz', role: 'Intern' } },
    });
    await expect(fake.post(URL_, { action: 'ping', key: 'k1' })).resolves.toEqual({
      ok: true,
      name: 'Jan Dela Cruz',
      role: 'Intern',
    });
  });

  it('records each request with its address, body and action', async () => {
    const fake = createFakePlatform({ replies: { ping: { ok: true }, posts: { ok: true, rows: [] } } });
    await fake.post(URL_, { action: 'ping', key: 'k1' });
    await fake.post(URL_, { action: 'posts', key: 'k1', since: '2026-10-01' });

    expect(fake.posts.map((p) => p.action)).toEqual(['ping', 'posts']);
    expect(fake.posts[1]).toEqual({
      url: URL_,
      action: 'posts',
      body: { action: 'posts', key: 'k1', since: '2026-10-01' },
    });
  });

  it('records the body as the server would read it: through JSON', async () => {
    const fake = createFakePlatform({ replies: { logPost: { ok: true } } });
    const body: Record<string, unknown> = { action: 'logPost', link: undefined, at: new Date('2026-10-31T01:02:03Z') };
    await fake.post(URL_, body);
    body['action'] = 'changed afterwards';

    expect(fake.posts[0]?.body).toEqual({ action: 'logPost', at: '2026-10-31T01:02:03.000Z' });
  });

  it('calls a function reply with the body and address', async () => {
    const reply = vi.fn((body: Readonly<Record<string, unknown>>) => ({ ok: true, id: body['id'] }));
    const fake = createFakePlatform({ replies: { property: reply } });

    await expect(fake.post(URL_, { action: 'property', id: 'abc' })).resolves.toEqual({ ok: true, id: 'abc' });
    expect(reply).toHaveBeenCalledWith({ action: 'property', id: 'abc' }, URL_);
  });

  it('lets a function reply be async, or throw', async () => {
    const fake = createFakePlatform({
      replies: {
        slow: async () => ({ ok: true }),
        broken: () => {
          throw new Error('boom');
        },
      },
    });
    await expect(fake.post(URL_, { action: 'slow' })).resolves.toEqual({ ok: true });
    await expect(fake.post(URL_, { action: 'broken' })).rejects.toThrow('boom');
  });

  it('fails the trip when the reply is an Error', async () => {
    const offline = new Error('offline');
    const fake = createFakePlatform({ replies: { properties: offline } });
    await expect(fake.post(URL_, { action: 'properties' })).rejects.toBe(offline);
  });

  it('fails with a status that core/backend.ts can read', async () => {
    const fake = createFakePlatform({ replies: { assignments: fakeHttpError(503) } });
    await expect(fake.post(URL_, { action: 'assignments' })).rejects.toMatchObject({ status: 503 });
  });

  it('returns a text reply as text, the way a sign-in page arrives', async () => {
    const page = '<!DOCTYPE html><html><title>Sign in</title></html>';
    const fake = createFakePlatform({ replies: { ping: page } });
    await expect(fake.post(URL_, { action: 'ping' })).resolves.toBe(page);
  });

  it('says which action has no reply, rather than inventing one', async () => {
    const fake = createFakePlatform({ replies: { ping: { ok: true } } });
    await expect(fake.post(URL_, { action: 'saveQueue' })).rejects.toThrow(/no reply for "saveQueue"/);
    await expect(fake.post(URL_, 'not an object')).rejects.toThrow(/no reply for "\(no action\)"/);
  });

  it('uses the fallback reply for actions with none of their own', async () => {
    const fake = createFakePlatform({ otherwise: { ok: false, error: 'unknown action' } });
    await expect(fake.post(URL_, { action: 'anything' })).resolves.toEqual({ ok: false, error: 'unknown action' });
  });

  it('can be re-scripted mid-test', async () => {
    const fake = createFakePlatform({ replies: { ping: { ok: false, error: 'unauthorized' } } });
    await expect(fake.post(URL_, { action: 'ping' })).resolves.toEqual({ ok: false, error: 'unauthorized' });

    fake.reply('ping', { ok: true, name: 'Mia' });
    await expect(fake.post(URL_, { action: 'ping' })).resolves.toEqual({ ok: true, name: 'Mia' });
  });

  it('hands out a fresh copy each time, so a caller cannot change the script', async () => {
    const fake = createFakePlatform({ replies: { posts: { ok: true, rows: [{ title: 'Lot 7' }] } } });
    const first = (await fake.post(URL_, { action: 'posts' })) as { rows: { title: string }[] };
    first.rows[0]!.title = 'changed';

    await expect(fake.post(URL_, { action: 'posts' })).resolves.toEqual({ ok: true, rows: [{ title: 'Lot 7' }] });
  });
});

describe('copyText', () => {
  it('records what was copied, in order', async () => {
    const fake = createFakePlatform();
    await fake.copyText('FOR SALE — Casa Amara');
    await fake.copyText('PHP 8,500,000');
    expect(fake.copied).toEqual(['FOR SALE — Casa Amara', 'PHP 8,500,000']);
  });

  it('fails with the sentence a test gives it, and copies nothing', async () => {
    const fake = createFakePlatform({ failures: { copyText: 'Could not copy to the clipboard.' } });
    const error = await fake.copyText('x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe('Could not copy to the clipboard.');
    expect(fake.copied).toEqual([]);
  });
});

describe('savePhotos', () => {
  it('saves into Downloads\\APG Post-It\\<listing>, named as the real platform names them', async () => {
    const fake = createFakePlatform();
    const saved = await fake.savePhotos('Taguig, 135 East Tower', [
      { name: 'photo 1', url: drive('a') },
      { name: 'IMG_0002.PNG', url: drive('b') },
      { name: 'front.jpeg', url: drive('c') },
    ]);

    const folder = `${FAKE_PHOTOS_FOLDER}\\Taguig, 135 East Tower`;
    expect(saved).toEqual([
      { name: 'photo 1', path: `${folder}\\photo 1.jpg` },
      { name: 'IMG_0002.PNG', path: `${folder}\\IMG_0002.png` },
      { name: 'front.jpeg', path: `${folder}\\front.jpg` },
    ]);
  });

  it('numbers a name that is already taken instead of replacing it', async () => {
    const fake = createFakePlatform();
    const twice = await fake.savePhotos('Lot 7', [
      { name: 'photo 1', url: drive('a') },
      { name: 'Photo 1', url: drive('b') },
    ]);
    const again = await fake.savePhotos('Lot 7', [{ name: 'photo 1', url: drive('a') }]);

    expect(twice.map((p) => p.path.split('\\').pop())).toEqual(['photo 1.jpg', 'Photo 1 (2).jpg']);
    expect(again[0]?.path.split('\\').pop()).toBe('photo 1 (3).jpg');
  });

  it('records each call: what was asked and what was saved', async () => {
    const fake = createFakePlatform();
    await fake.savePhotos('Lot 7', [{ name: 'photo 1', url: drive('a') }]);
    expect(fake.saves).toEqual([
      {
        property: 'Lot 7',
        photos: [{ name: 'photo 1', url: drive('a') }],
        saved: [{ name: 'photo 1', path: `${FAKE_PHOTOS_FOLDER}\\Lot 7\\photo 1.jpg` }],
      },
    ]);
  });

  it('accepts every address Drive serves photos from', async () => {
    const fake = createFakePlatform();
    const saved = await fake.savePhotos('Lot 7', [
      { name: 'a', url: drive('a') },
      { name: 'b', url: 'https://drive.usercontent.google.com/download?id=b&export=download' },
      { name: 'c', url: 'https://lh3.googleusercontent.com/d/c=w640' },
    ]);
    expect(saved).toHaveLength(3);
  });

  it.each([
    ['https://example.com/photo.jpg', 'points to example.com'],
    ['http://drive.google.com/uc?id=1', 'is not an https:// address'],
    ['https://drive.google.com.evil.com/uc?id=1', 'points to drive.google.com.evil.com'],
    ['https://googleusercontent.com/x', 'points to googleusercontent.com'],
    ['https://user:pw@drive.google.com/uc?id=1', 'carries a user name or password'],
    ['https://drive.google.com:8443/uc?id=1', 'names a port'],
    ['photo 1', 'is not a web address'],
  ])('refuses %s and saves nothing at all', async (url, why) => {
    const fake = createFakePlatform();
    const error = await fake
      .savePhotos('Lot 7', [
        { name: 'photo 1', url: drive('a') },
        { name: 'photo 2', url },
      ])
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toContain(`"photo 2": its address ${why}`);
    expect((error as Error).message).toMatch(/Nothing was saved\.$/);
    expect(fake.saves[0]?.saved).toEqual([]);
  });

  it('returns the photos that worked when some fail', async () => {
    const fake = createFakePlatform({ failingPhotos: ['photo 2', drive('c')] });
    const saved = await fake.savePhotos('Lot 7', [
      { name: 'photo 1', url: drive('a') },
      { name: 'photo 2', url: drive('b') },
      { name: 'photo 3', url: drive('c') },
    ]);
    expect(saved.map((p) => p.name)).toEqual(['photo 1']);
  });

  it('saves a WebP as a JPG, and reports each step as it happens', async () => {
    const fake = createFakePlatform({ failingPhotos: ['photo 3'] });
    const steps: string[] = [];
    const saved = await fake.savePhotos(
      'Lot 7',
      [
        { name: 'photo 1', url: drive('a') },
        { name: 'cover.webp', url: drive('b') },
        { name: 'photo 3', url: drive('c') },
      ],
      (p) => steps.push(`${p.name}: ${p.step} ${p.done}/${p.total}`),
    );

    expect(saved).toEqual([
      { name: 'photo 1', path: `${FAKE_PHOTOS_FOLDER}\\Lot 7\\photo 1.jpg` },
      { name: 'cover.webp', path: `${FAKE_PHOTOS_FOLDER}\\Lot 7\\cover.jpg`, converted: true },
    ]);
    expect(steps).toEqual([
      'photo 1: saved 0/3',
      'cover.webp: converting 1/3',
      'cover.webp: saved 1/3',
      'photo 3: failed 2/3',
    ]);
  });

  it('fails when none could be saved, as the real platform does', async () => {
    const fake = createFakePlatform({ failingPhotos: ['photo 1', 'photo 2'] });
    await expect(
      fake.savePhotos('Lot 7', [
        { name: 'photo 1', url: drive('a') },
        { name: 'photo 2', url: drive('b') },
      ]),
    ).rejects.toThrow(/^None of the 2 photos were saved\./);
  });

  it('saves nothing, and does not fail, when asked for no photos', async () => {
    const fake = createFakePlatform();
    await expect(fake.savePhotos('Lot 7', [])).resolves.toEqual([]);
  });

  it('can be made to fail outright', async () => {
    const fake = createFakePlatform({ failures: { savePhotos: 'Could not find your Downloads folder.' } });
    await expect(fake.savePhotos('Lot 7', [{ name: 'a', url: drive('a') }])).rejects.toThrow(
      'Could not find your Downloads folder.',
    );
    expect(fake.saves).toHaveLength(1);
  });
});

describe('folder names, the same as src-tauri/src/names.rs', () => {
  it.each([
    ['Casa Amara House & Lot', 'Casa Amara House & Lot'],
    ['Taguig, 135 East Tower', 'Taguig, 135 East Tower'],
    ['FOR LEASE/ FOR RENT', 'FOR LEASE_ FOR RENT'],
    ['*NEW* Casa Amara', '_NEW_ Casa Amara'],
    ['Unit 4B\\5B', 'Unit 4B_5B'],
    ['a<b>c:d"e/f\\g|h?i*j', 'a_b_c_d_e_f_g_h_i_j'],
    ['..', 'Property'],
    ['../../Windows', '_.._Windows'],
    ['  Verdant Hills Lot 7.  ', 'Verdant Hills Lot 7'],
    ['...Sta. Rosa Lot 22...', 'Sta. Rosa Lot 22'],
    ['Lot\t12\r\n  Phase\u00002', 'Lot 12 Phase2'],
    ['Lot\u200B7', 'Lot7'],
    ['', 'Property'],
    ['CON', '_CON'],
    ['nul.txt', '_nul.txt'],
    ['COM²', '_COM²'],
    ['COM10', 'COM10'],
  ])('%j becomes %j', (name, folder) => {
    expect(safeFolderName(name)).toBe(folder);
  });

  it('keeps at most 64 characters, with no trailing space or dot', () => {
    const folder = safeFolderName('Antipolo Ridge '.repeat(10));
    expect([...folder].length).toBeLessThanOrEqual(64);
    expect(folder).not.toMatch(/[ .]$/);
  });
});

describe('open', () => {
  it('records https links and the photo folders', async () => {
    const fake = createFakePlatform();
    await fake.open('https://www.facebook.com/groups/123');
    await fake.open(`${FAKE_PHOTOS_FOLDER}\\Lot 7`);
    await fake.open(`${FAKE_PHOTOS_FOLDER}\\Lot 7\\photo 1.jpg`);
    expect(fake.opened).toEqual([
      'https://www.facebook.com/groups/123',
      `${FAKE_PHOTOS_FOLDER}\\Lot 7`,
      `${FAKE_PHOTOS_FOLDER}\\Lot 7\\photo 1.jpg`,
    ]);
  });

  it.each([
    'http://example.com',
    'file:///C:/Windows/System32/calc.exe',
    'C:\\Windows\\System32\\calc.exe',
    `${FAKE_PHOTOS_FOLDER}\\..\\..\\Desktop`,
    'C:\\Users\\Intern\\Downloads\\APG Post-It Evil\\x',
  ])('refuses %s, as the capability file does', async (target) => {
    const fake = createFakePlatform();
    await expect(fake.open(target)).rejects.toBeInstanceOf(UserFacingError);
    expect(fake.opened).toEqual([]);
  });
});

describe('readLocal and writeLocal', () => {
  it('start with what the test gives, and keep what is written', async () => {
    const fake = createFakePlatform({ local: { filter: 'Condo' } });
    await expect(fake.readLocal('filter')).resolves.toBe('Condo');
    await expect(fake.readLocal('missing')).resolves.toBeNull();

    await fake.writeLocal('filter', 'Lot');
    await expect(fake.readLocal('filter')).resolves.toBe('Lot');
  });

  it('keep each fake to itself', async () => {
    const a = createFakePlatform();
    const b = createFakePlatform();
    await a.writeLocal('k', 'v');
    await expect(b.readLocal('k')).resolves.toBeNull();
  });
});

describe('readKey and writeKey', () => {
  it('start with no key, or the one the test gives', async () => {
    await expect(createFakePlatform().readKey()).resolves.toBeNull();
    await expect(createFakePlatform({ key: 'k1' }).readKey()).resolves.toBe('k1');
  });

  it('keep the key without what a paste brings along', async () => {
    const fake = createFakePlatform();
    await fake.writeKey('  0f3a9c\r\n');
    await expect(fake.readKey()).resolves.toBe('0f3a9c');
  });

  it('remove the key when it is written empty: signing out', async () => {
    const fake = createFakePlatform({ key: 'k1' });
    await fake.writeKey('');
    await expect(fake.readKey()).resolves.toBeNull();
  });

  it('refuse what cannot be a key, and keep the old one', async () => {
    const fake = createFakePlatform({ key: 'k1' });
    await expect(fake.writeKey('abc\ndef')).rejects.toThrow('A key is one line of text.');
    await expect(fake.writeKey('k'.repeat(513))).rejects.toThrow(/too long to be a key/);
    await expect(fake.readKey()).resolves.toBe('k1');
  });
});

describe('delays', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('make every call wait, so loading states can be seen', async () => {
    vi.useFakeTimers();
    const fake = createFakePlatform({ delayMs: 500, replies: { ping: { ok: true } } });
    let answered = false;
    const pending = fake.post(URL_, { action: 'ping' }).then(() => {
      answered = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(answered).toBe(true);
  });
});

describe("the fake's window", () => {
  it('has no controls unless asked, as in a browser', () => {
    expect(createFakePlatform().hasWindowControls).toBe(false);
    expect(createFakePlatform({ hasWindowControls: true }).hasWindowControls).toBe(true);
  });

  it('minimizes, and maximizes and restores, telling whoever listens', async () => {
    const fake = createFakePlatform();
    const seen: boolean[] = [];
    const stop = fake.onMaximizedChange((now) => seen.push(now));
    await fake.minimize();
    await fake.toggleMaximize();
    await expect(fake.isMaximized()).resolves.toBe(true);
    fake.setMaximizedFromOutside(false);
    stop();
    await fake.toggleMaximize();
    expect(fake.window).toMatchObject({ minimized: true, maximized: true });
    expect(seen).toEqual([true, false]);
  });

  it('holds a request to close while someone listens, and closes only on destroy', async () => {
    const fake = createFakePlatform();
    const asked = vi.fn();
    const stop = fake.onCloseRequested(asked);
    await fake.requestClose();
    fake.closeFromOutside();
    expect(asked).toHaveBeenCalledTimes(2);
    expect(fake.window).toMatchObject({ destroyed: false, closeRequests: 2 });
    await fake.destroy();
    expect(fake.window.destroyed).toBe(true);
    stop();
  });

  it('closes on a request when nobody listens, as Tauri does', async () => {
    const fake = createFakePlatform();
    await fake.requestClose();
    expect(fake.window.destroyed).toBe(true);
  });
});
