/**
 * The property list: fetched once, kept, searched as you type. Against a
 * scripted `post` and an in-memory store — no network, no disk.
 *
 * The property tests of ScriptBackendTests.cs are ported here. The C# client
 * rejoined the server's two halves for its parser; this one keeps them apart,
 * so "a manager gets the internal half" is checked on the detail directly.
 */

import type { Platform } from '../platform';
import { createBackend, type BackendDeps } from './backend';
import {
  CACHE_KEY,
  createDirectory,
  folderLine,
  normalizeForSearch,
  type DirectoryDeps,
  type LocalStore,
} from './directory';
import { UserFacingError, type Property } from './types';

const EXEC = 'https://script.google.com/macros/s/AKfy/exec';

type Wire = Record<string, unknown>;
type Scripted = unknown | ((body: Wire) => unknown);

/** A post that answers from a script — the last reply repeats — and keeps what was sent. */
function scripted(...replies: Scripted[]) {
  const sent: Wire[] = [];
  const queue = [...replies];
  const post = async (_url: string, body: unknown): Promise<unknown> => {
    const wire = JSON.parse(JSON.stringify(body)) as Wire;
    sent.push(wire);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const reply = typeof next === 'function' ? (next as (b: Wire) => unknown)(wire) : next;
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { post, sent };
}

function memoryStore(saved: Record<string, string> = {}) {
  const data = new Map(Object.entries(saved));
  const store: LocalStore & { data: Map<string, string>; writes: number } = {
    data,
    writes: 0,
    readLocal: async (key) => data.get(key) ?? null,
    writeLocal: async (key, value) => {
      store.writes++;
      data.set(key, value);
    },
  };
  return store;
}

function directoryOver(
  post: BackendDeps['post'],
  extra: Partial<Pick<DirectoryDeps, 'store' | 'now'>> & { key?: () => string } = {},
) {
  const key = extra.key ?? (() => 'testkey');
  const backend = createBackend({ post, getConfig: () => ({ url: EXEC, key: key() }) });
  return createDirectory({
    backend,
    ...(extra.store ? { store: extra.store } : {}),
    ...(extra.now ? { now: extra.now } : {}),
  });
}

async function refusal(p: Promise<unknown>): Promise<UserFacingError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(UserFacingError);
    return err as UserFacingError;
  }
  throw new Error('expected a refusal');
}

const names = (list: readonly Property[]): string[] => list.map((p) => p.name);

// Compile-time: the platform's local storage is the store the directory takes.
const _platformFits: LocalStore = {} as Platform;
void _platformFits;

const TWO = {
  ok: true,
  properties: [
    { id: '2', name: 'Verdant Hills Lot 7', category: 'Lot', photoCount: 4 },
    { id: '1', name: 'Casa Amara', category: 'Condo', photoCount: 12 },
  ],
};

const MANAGER_DETAIL = {
  ok: true,
  property: {
    id: '1AbC',
    name: 'Casa Amara',
    category: 'Condo',
    location: 'Antipolo',
    publicText: 'FOR SALE\nPHP 8,500,000',
    internalText: 'Commission: 3%',
    hasInternal: true,
    photos: [{ id: 'p1', name: 'front.jpg', url: 'https://drive.google.com/uc?id=p1', thumb: 't' }],
  },
};

const INTERN_DETAIL = {
  ok: true,
  property: {
    id: '1AbC',
    name: 'Casa Amara',
    category: 'Condo',
    publicText: 'FOR SALE\nPHP 8,500,000',
    hasInternal: true,
    photos: [],
  },
};

// ------------------------------------------------------------------ the folder line

describe('the folder line', () => {
  it('is the folder path as one line', async () => {
    // The library nests Category > Sub-category > Listing type, and all three
    // matter when telling two "Lot 7"s apart.
    const { post } = scripted({
      ok: true,
      properties: [
        { id: '1', name: 'Lot 7', category: 'CONDO / HOUSE AND LOT', listingType: 'FOR SALE', subCategory: 'Lot', photoCount: 3 },
        { id: '2', name: 'Silang 40', category: 'COMMERCIAL SPACE', listingType: 'For lease', photoCount: 7 },
      ],
    });
    const all = await directoryOver(post).list();

    expect(folderLine(all[0]!)).toBe('CONDO / HOUSE AND LOT · Lot · FOR SALE');
    expect(folderLine(all[1]!)).toBe('COMMERCIAL SPACE · For lease'); // no sub-category, no empty gap
  });

  it('leaves no gap for a blank or whitespace level, wherever it is', () => {
    expect(folderLine({ category: 'LOT', subCategory: '  ', listingType: '' })).toBe('LOT');
    expect(folderLine({ category: '', subCategory: 'Lot', listingType: 'FOR SALE' })).toBe('Lot · FOR SALE');
    expect(folderLine({ category: ' WAREHOUSE ', subCategory: '', listingType: ' For rent' })).toBe('WAREHOUSE · For rent');
    expect(folderLine({ category: '', subCategory: '', listingType: '' })).toBe('');
  });
});

// ------------------------------------------------------------------ the list and its cache

describe('the list', () => {
  it('is fetched once and then kept until refreshed', async () => {
    const { post, sent } = scripted(TWO);
    const directory = directoryOver(post);

    const first = await directory.list();
    await directory.list();
    expect(sent).toHaveLength(1);
    expect(first[0]!.name).toBe('Casa Amara'); // sorted by name

    await directory.refresh();
    expect(sent).toHaveLength(2);
  });

  it('is fetched once when many screens ask at the same moment', async () => {
    const { post, sent } = scripted(TWO);
    const directory = directoryOver(post);

    const [a, b, c] = await Promise.all([directory.list(), directory.list(), directory.refresh()]);

    expect(sent).toHaveLength(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
  });

  it('sorts by name the way people read numbers', async () => {
    const { post } = scripted({
      ok: true,
      properties: ['Lot 12', 'lot 3', 'Lot 7', 'Bea Homes'].map((name, i) => ({ id: String(i), name })),
    });
    expect(names(await directoryOver(post).list())).toEqual(['Bea Homes', 'lot 3', 'Lot 7', 'Lot 12']);
  });

  it('reads loose rows: numbers as text, counts from text, and skips rows without an id or a name', async () => {
    const { post } = scripted({
      ok: true,
      properties: [
        { id: 1001, name: 'Casa Amara', category: 'Condo', photoCount: '3', hasIssues: false },
        { id: '', name: 'No id' },
        { id: 'x', name: '   ' },
        'not a row',
        null,
        { id: 'y', name: 'Silang 40', photoCount: 'many', hasIssues: true },
      ],
    });
    const all = await directoryOver(post).list();

    expect(all).toEqual([
      { id: '1001', name: 'Casa Amara', category: 'Condo', listingType: '', subCategory: '', photoCount: 3, hasIssues: false },
      { id: 'y', name: 'Silang 40', category: '', listingType: '', subCategory: '', photoCount: 0, hasIssues: true },
    ]);
  });

  it('keeps one row per folder id, the first', async () => {
    const { post } = scripted({
      ok: true,
      properties: [
        { id: 'A', name: 'Casa Amara' },
        { id: 'A', name: 'Casa Amara (copy)' },
      ],
    });
    const directory = directoryOver(post);

    expect(names(await directory.list())).toEqual(['Casa Amara']);
    expect(directory.get('A')?.name).toBe('Casa Amara');
  });

  it('is in memory for synchronous readers once loaded, and says when it was fetched', async () => {
    const { post } = scripted(TWO);
    const directory = directoryOver(post, { now: () => 1_700_000_000_000 });

    expect(directory.peek()).toBeNull();
    expect(directory.fetchedAt()).toBeNull();
    const list = await directory.list();

    expect(directory.peek()).toBe(list);
    expect(directory.fetchedAt()).toBe(1_700_000_000_000);
    expect(directory.get('1')?.name).toBe('Casa Amara');
    expect(directory.get('nope')).toBeUndefined();
  });

  it('tells subscribers when it changes, until they stop listening', async () => {
    const { post } = scripted(TWO);
    const directory = directoryOver(post);
    let calls = 0;
    const stop = directory.subscribe(() => calls++);

    await directory.list();
    await directory.refresh();
    expect(calls).toBe(2);

    stop();
    directory.clear();
    expect(calls).toBe(2);
  });
});

describe('a refresh that goes wrong', () => {
  it('keeps the good list when the reply is not a list', async () => {
    const { post } = scripted(TWO, { ok: true, properties: 'oops' });
    const store = memoryStore();
    const directory = directoryOver(post, { store });
    const good = await directory.list();
    const saved = store.data.get(CACHE_KEY);

    const error = await refusal(directory.refresh());

    expect(error.message).toContain('could not read');
    expect(directory.peek()).toBe(good);
    expect(store.data.get(CACHE_KEY)).toBe(saved);
  });

  it('keeps the good list when not one row of the new one can be read', async () => {
    const { post } = scripted(TWO, { ok: true, properties: [{ folder: 'x' }, { title: 'y' }] });
    const directory = directoryOver(post);
    const good = await directory.list();

    await refusal(directory.refresh());
    expect(directory.peek()).toBe(good);
  });

  it('keeps the good list when the server sends an empty one, as it does mid-rebuild', async () => {
    const { post } = scripted(TWO, { ok: true, properties: [] });
    const store = memoryStore();
    const directory = directoryOver(post, { store });
    const good = await directory.list();

    const error = await refusal(directory.refresh());

    expect(error.message).toContain('keeping the one it had');
    expect(directory.peek()).toBe(good);
    expect(JSON.parse(store.data.get(CACHE_KEY)!).properties).toHaveLength(2);
  });

  it('keeps the copy on disk when an empty list comes back before that copy was read', async () => {
    // refresh() first thing at launch, mid-rebuild: yesterday's list is only on disk.
    const yesterday = memoryStore();
    await directoryOver(scripted(TWO).post, { store: yesterday }).list();
    const saved = yesterday.data.get(CACHE_KEY);

    const { post } = scripted({ ok: true, properties: [] });
    const directory = directoryOver(post, { store: yesterday });
    const error = await refusal(directory.refresh());

    expect(error.message).toContain('keeping the one it had');
    expect(names(directory.peek()!)).toEqual(['Casa Amara', 'Verdant Hills Lot 7']);
    expect(yesterday.data.get(CACHE_KEY)).toBe(saved);
  });

  it('accepts an empty list when it has nothing better, and does not keep it on disk', async () => {
    const store = memoryStore();
    const { post } = scripted({ ok: true, properties: [] });

    expect(await directoryOver(post, { store }).list()).toEqual([]);
    expect(store.writes).toBe(0);
  });

  it('keeps the list, and every fetched detail, when the connection drops', async () => {
    const { post, sent } = scripted((body: Wire) => {
      if (sent.length > 2) return new TypeError('fetch failed');
      return body['action'] === 'properties' ? TWO : MANAGER_DETAIL;
    });
    const directory = directoryOver(post);
    const good = await directory.list();
    const detail = await directory.detail('1AbC');

    const error = await refusal(directory.refresh());

    expect(error.message).toContain('connection');
    expect(directory.peek()).toBe(good);
    expect(await directory.detail('1AbC')).toBe(detail); // still there for the rest of the shift
  });
});

describe('the copy on disk', () => {
  it('is written after a fetch, whole, and read back on the next launch without a request', async () => {
    const store = memoryStore();
    const first = scripted(TWO);
    await directoryOver(first.post, { store, now: () => 1234 }).list();

    const saved = JSON.parse(store.data.get(CACHE_KEY)!);
    expect(saved).toMatchObject({ v: 1, fetchedAt: 1234 });
    expect(saved.properties).toHaveLength(2);

    const second = scripted(TWO);
    const relaunched = directoryOver(second.post, { store, now: () => 9999 });
    const list = await relaunched.list();

    expect(names(list)).toEqual(['Casa Amara', 'Verdant Hills Lot 7']);
    expect(relaunched.fetchedAt()).toBe(1234); // when it came from the server, not when it was read
    expect(second.sent).toHaveLength(0);
  });

  it('is ignored when it cannot be read, and the server is asked instead', async () => {
    for (const bad of ['{not json', JSON.stringify({ v: 99, fetchedAt: 1, properties: [] }), JSON.stringify({ v: 1, properties: [] })]) {
      const store = memoryStore({ [CACHE_KEY]: bad });
      const { post, sent } = scripted(TWO);

      expect(await directoryOver(post, { store }).list()).toHaveLength(2);
      expect(sent).toHaveLength(1);
    }
  });

  it('is ignored when the store itself fails to read', async () => {
    const store: LocalStore = {
      readLocal: () => Promise.reject(new Error('disk gone')),
      writeLocal: () => Promise.reject(new Error('disk gone')),
    };
    const { post } = scripted(TWO);

    // Neither failure reaches the person: the list from the server is good.
    expect(await directoryOver(post, { store }).list()).toHaveLength(2);
  });

  it('is replaced on a refresh, and never by a reply that failed', async () => {
    const store = memoryStore();
    const { post } = scripted(TWO, { ok: true, properties: [{ id: '3', name: 'Mabini Commercial Space' }] }, { ok: true, properties: 7 });
    const directory = directoryOver(post, { store });

    await directory.list();
    await directory.refresh();
    expect(JSON.parse(store.data.get(CACHE_KEY)!).properties[0].name).toBe('Mabini Commercial Space');

    await refusal(directory.refresh());
    expect(JSON.parse(store.data.get(CACHE_KEY)!).properties[0].name).toBe('Mabini Commercial Space');
    expect(store.writes).toBe(2);
  });

  it('holds no posting text, internal or otherwise', async () => {
    const store = memoryStore();
    const { post } = scripted((body: Wire) => (body['action'] === 'properties' ? TWO : MANAGER_DETAIL));
    const directory = directoryOver(post, { store });

    await directory.list();
    await directory.detail('1AbC');
    await directory.refresh();

    expect(store.data.get(CACHE_KEY)).not.toContain('Commission');
    expect(store.data.get(CACHE_KEY)).not.toContain('PHP 8,500,000');
  });
});

// ------------------------------------------------------------------ one property

describe('a property\'s detail', () => {
  it('gives a manager the internal half, kept apart from the public text', async () => {
    const { post, sent } = scripted(MANAGER_DETAIL);
    const directory = directoryOver(post);

    const detail = await directory.detail('1AbC');
    await directory.detail('1AbC');

    expect(detail.internalText).toBe('Commission: 3%');
    expect(detail.publicText).not.toContain('Commission');
    expect(detail.hasInternal).toBe(true);
    expect(detail.photos).toHaveLength(1);
    expect(detail.photoCount).toBe(1);
    expect(sent).toHaveLength(1); // detail fetched once, then kept
    expect(sent[0]).toMatchObject({ action: 'property', id: '1AbC' });
  });

  it('gives an intern no internal text at all', async () => {
    // The server simply omits the field. Nothing to hide here, because nothing arrived.
    const { post } = scripted(INTERN_DETAIL);
    const detail = await directoryOver(post).detail('1AbC');

    expect('internalText' in detail).toBe(false);
    expect(detail.publicText).toContain('PHP 8,500,000');
    expect(detail.hasInternal).toBe(true); // there is an internal half; it is just not theirs
  });

  it('turns the directory sheet\'s photo links into photos', async () => {
    const { post } = scripted({
      ok: true,
      property: {
        id: '1',
        name: 'Silang 40',
        category: 'COMMERCIAL SPACE',
        publicText: 'FOR RENT',
        cutAt: '--- line',
        live: true,
        photos: [
          { id: 'p1', url: 'https://drive.google.com/uc?export=download&id=p1', thumb: 't1' },
          { id: 'p2', url: 'https://drive.google.com/uc?export=download&id=p2', thumb: 't2' },
          { id: 'p3', url: '   ' },
        ],
      },
    });
    const detail = await directoryOver(post).detail('1');

    expect(detail.photos).toHaveLength(2); // one without a link is no photo
    expect(detail.photos[1]!.url).toContain('id=p2');
    expect(detail.photos.map((p) => p.name)).toEqual(['photo 1', 'photo 2']);
    expect(detail.photos[1]!.thumb).toBe('t2');
    expect(detail.cutAt).toBe('--- line');
    expect(detail.live).toBe(true);
  });

  it('reads the issues column as a flag, and blank fields as blank', async () => {
    const { post } = scripted({
      ok: true,
      property: { id: '1', name: 'Silang 40', issues: 'No photos · No separator line', photos: 'none' },
    });
    const detail = await directoryOver(post).detail('1');

    expect(detail).toMatchObject({
      hasIssues: true,
      issues: 'No photos · No separator line',
      photos: [],
      photoCount: 0,
      publicText: '',
      cutAt: '',
      folder: '',
      live: false,
      hasInternal: false,
    });
  });

  it('is asked for once when two screens open it at the same moment', async () => {
    const { post, sent } = scripted(MANAGER_DETAIL);
    const directory = directoryOver(post);

    const [a, b] = await Promise.all([directory.detail('1AbC'), directory.detail('1AbC')]);

    expect(a).toBe(b);
    expect(sent).toHaveLength(1);
  });

  it('is fetched again after a refresh', async () => {
    const { post, sent } = scripted((body: Wire) => (body['action'] === 'properties' ? TWO : MANAGER_DETAIL));
    const directory = directoryOver(post);

    await directory.detail('1AbC');
    await directory.refresh();
    await directory.detail('1AbC');

    expect(sent.map((s) => s['action'])).toEqual(['property', 'properties', 'property']);
  });

  it('is never handed to the next person on this PC', async () => {
    let key = 'manager-key';
    const { post, sent } = scripted((body: Wire) => (body['key'] === 'manager-key' ? MANAGER_DETAIL : INTERN_DETAIL));
    const directory = directoryOver(post, { key: () => key });

    expect((await directory.detail('1AbC')).internalText).toBe('Commission: 3%');
    key = 'intern-key';
    const asIntern = await directory.detail('1AbC');

    expect('internalText' in asIntern).toBe(false);
    expect(sent).toHaveLength(2);
  });

  it('fetched while the key changed hands is not kept for anyone', async () => {
    // The intern asks; the manager's key is in Settings for the one moment the
    // request goes out; the intern's is back by the time the answer lands.
    const keys = ['intern-key', 'manager-key'];
    const { post, sent } = scripted((body: Wire) => (body['key'] === 'manager-key' ? MANAGER_DETAIL : INTERN_DETAIL));
    const directory = directoryOver(post, { key: () => keys.shift() ?? 'intern-key' });

    await directory.detail('1AbC'); // went out with the manager's key
    const again = await directory.detail('1AbC');

    expect('internalText' in again).toBe(false);
    expect(sent.map((s) => s['key'])).toEqual(['manager-key', 'intern-key']);
  });

  it('for a property gone from the directory says so, and is asked for again next time', async () => {
    const { post, sent } = scripted({ ok: false, error: 'property not found: gone' }, MANAGER_DETAIL);
    const directory = directoryOver(post);

    const error = await refusal(directory.detail('gone'));
    expect(error.message).toContain('no longer in the directory');

    await directory.detail('gone');
    expect(sent).toHaveLength(2);
  });

  it('without an id is refused before asking', async () => {
    const { post, sent } = scripted(MANAGER_DETAIL);
    const error = await refusal(directoryOver(post).detail('  '));

    expect(error.message).toBe('Choose a property first.');
    expect(sent).toHaveLength(0);
  });

  it('that is not a property says so', async () => {
    const { post } = scripted({ ok: true, property: null }, { ok: true, property: { id: 'x' } });
    const directory = directoryOver(post);

    expect((await refusal(directory.detail('x'))).message).toContain('could not read');
    expect((await refusal(directory.detail('x'))).message).toContain('could not read');
  });
});

describe('clearing on sign-out', () => {
  it('forgets the list and the details, and a request already out changes nothing', async () => {
    let answer: ((reply: unknown) => void) | undefined;
    const { post } = scripted(() => new Promise((resolve) => (answer = resolve)));
    const store = memoryStore();
    const directory = directoryOver(post, { store });

    const pending = directory.refresh();
    await vi.waitFor(() => expect(answer).toBeDefined()); // the request is out
    directory.clear();
    answer!(TWO);
    await pending;

    expect(directory.peek()).toBeNull();
    expect(directory.search('')).toEqual([]);
    expect(store.writes).toBe(0);
  });

  it('forgets the details too', async () => {
    const { post, sent } = scripted(MANAGER_DETAIL);
    const directory = directoryOver(post);

    await directory.detail('1AbC');
    directory.clear();
    await directory.detail('1AbC');

    expect(sent).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ search

describe('search', () => {
  const LIBRARY = {
    ok: true,
    properties: [
      { id: '1', name: 'Verdant Hills Lot 12', category: 'CONDO / HOUSE AND LOT', subCategory: 'Lot', listingType: 'FOR SALE' },
      { id: '2', name: 'Verdant Hills Lot 7', category: 'CONDO / HOUSE AND LOT', subCategory: 'Lot', listingType: 'For sale' },
      { id: '3', name: 'Sunrise Homes Block 3 Lot 9', category: 'CONDO / HOUSE AND LOT', subCategory: 'House & Lot', listingType: 'FOR SALE' },
      { id: '4', name: 'Mabini Commercial Space', category: 'COMMERCIAL SPACE', listingType: 'FOR LEASE/ FOR RENT' },
      { id: '5', name: 'Prime Tower Office 1201', category: 'COMMERCIAL SPACE', listingType: 'For lease' },
      { id: '6', name: 'Señorita Farm Lot', category: 'LOT', listingType: '' },
      { id: '7', name: "Rosa's Bldg. Unit 4B", category: 'Commercial Space', listingType: 'FOR LEASE / FOR RENT' },
    ],
  };

  async function library() {
    const { post } = scripted(LIBRARY);
    const directory = directoryOver(post);
    await directory.list();
    return directory;
  }

  it('finds every word, in any order, in the name or the folder line', async () => {
    const directory = await library();

    expect(names(directory.search('verdant'))).toEqual(['Verdant Hills Lot 7', 'Verdant Hills Lot 12']);
    expect(names(directory.search('lot verdant 12'))).toEqual(['Verdant Hills Lot 12']);
    expect(names(directory.search('commercial lease'))).toEqual([
      'Mabini Commercial Space',
      'Prime Tower Office 1201',
      "Rosa's Bldg. Unit 4B",
    ]);
    expect(names(directory.search('house and lot sunrise'))).toEqual(['Sunrise Homes Block 3 Lot 9']);
  });

  it('matches part of a word, as you type it', async () => {
    const directory = await library();
    expect(names(directory.search('Verd'))).toEqual(['Verdant Hills Lot 7', 'Verdant Hills Lot 12']);
  });

  it('ignores case, accents, punctuation and "&", and reads the usual abbreviations', async () => {
    const directory = await library();

    expect(names(directory.search('SENORITA'))).toEqual(['Señorita Farm Lot']);
    expect(names(directory.search('sunrise blk 3 lt 9'))).toEqual(['Sunrise Homes Block 3 Lot 9']);
    expect(names(directory.search('rosas building'))).toEqual(["Rosa's Bldg. Unit 4B"]);
    expect(names(directory.search('sunrise house & lot'))).toEqual(['Sunrise Homes Block 3 Lot 9']);
    expect(directory.search('house & lot')).toEqual(directory.search('house and lot'));
  });

  it('with nothing typed gives the whole list, sorted by name, as the same array', async () => {
    const directory = await library();

    expect(directory.search('   ')).toBe(directory.peek());
    expect(names(directory.search(''))[0]).toBe('Mabini Commercial Space');
  });

  it('finds nothing for a word nobody has', async () => {
    const directory = await library();
    expect(directory.search('verdant warehouse')).toEqual([]);
  });

  it('filters by category and by listing type, however they are spelled', async () => {
    const directory = await library();

    expect(names(directory.search('', { category: 'commercial space' }))).toEqual([
      'Mabini Commercial Space',
      'Prime Tower Office 1201',
      "Rosa's Bldg. Unit 4B",
    ]);
    expect(names(directory.search('', { listingType: 'For Sale' }))).toEqual([
      'Sunrise Homes Block 3 Lot 9',
      'Verdant Hills Lot 7',
      'Verdant Hills Lot 12',
    ]);
    expect(names(directory.search('', { listingType: 'for lease for rent' }))).toEqual([
      'Mabini Commercial Space',
      "Rosa's Bldg. Unit 4B",
    ]);
    expect(names(directory.search('lot', { category: 'CONDO / HOUSE AND LOT', listingType: 'FOR SALE' }))).toHaveLength(3);
    expect(names(directory.search('verdant', { category: 'LOT' }))).toEqual([]);
    expect(directory.search('', { category: '', listingType: undefined })).toBe(directory.peek());
  });

  it('lists the categories and listing types for the filter chips, one per spelling-free name', async () => {
    const directory = await library();
    const { categories, listingTypes } = directory.facets();

    expect(categories).toEqual([
      { key: 'commercial space', label: 'COMMERCIAL SPACE', count: 3 },
      { key: 'condo house and lot', label: 'CONDO / HOUSE AND LOT', count: 3 },
      { key: 'lot', label: 'LOT', count: 1 },
    ]);
    expect(listingTypes).toEqual([
      { key: 'for lease', label: 'For lease', count: 1 },
      { key: 'for lease for rent', label: 'FOR LEASE/ FOR RENT', count: 2 },
      { key: 'for sale', label: 'FOR SALE', count: 3 },
    ]);
    expect(directory.facets()).toBe(directory.facets());
  });

  it('a facet\'s label filters the same as its key', async () => {
    const directory = await library();
    for (const facet of directory.facets().listingTypes) {
      expect(directory.search('', { listingType: facet.label })).toEqual(directory.search('', { listingType: facet.key }));
    }
  });

  it('before the list has loaded finds nothing, and does not throw', () => {
    const { post } = scripted(LIBRARY);
    const directory = directoryOver(post);

    expect(directory.search('verdant')).toEqual([]);
    expect(directory.facets()).toEqual({ categories: [], listingTypes: [] });
  });

  it('answers the same question with the same array, and a new list with a new answer', async () => {
    const { post } = scripted(LIBRARY, { ok: true, properties: [{ id: '9', name: 'Verdant Ridge' }] });
    const directory = directoryOver(post);
    await directory.list();

    const first = directory.search('verdant');
    expect(directory.search('verdant')).toBe(first);

    await directory.refresh();
    expect(names(directory.search('verdant'))).toEqual(['Verdant Ridge']);
  });

  it('normalises the way PropertyNameMatcher does', () => {
    expect(normalizeForSearch('Sunrise Homes Blk. 3, Lt 9')).toBe('sunrise homes block 3 lot 9');
    expect(normalizeForSearch('Casa Amara House & Lot')).toBe('casa amara house and lot');
    expect(normalizeForSearch("D'Señorita’s Ph 2 Bldg")).toBe('dsenoritas phase 2 building');
    expect(normalizeForSearch('  --  ')).toBe('');
    expect(normalizeForSearch('constructor toString')).toBe('constructor tostring');
  });
});

// ------------------------------------------------------------------ speed

describe('search speed', () => {
  /** A library shaped like the real one: 1,474 listings across the real categories. */
  function syntheticLibrary(count: number) {
    const places = [
      'Verdant Hills', 'Sta. Rosa', 'Antipolo Ridge', 'Casa Amara', 'Imus Townhomes', 'Lakeshore Villas',
      'Silang', 'Tagaytay Highlands', 'Mabini', 'Prime Tower', 'Seaside Residences', 'Sunrise Homes',
      'Señorita Gardens', 'Taguig East Tower', 'Alabang Hills', 'Batangas Coast',
    ];
    const kinds = ['Lot', 'Unit', 'Blk 3 Lot', 'Phase 2', 'House & Lot', 'Office', 'Warehouse', 'Bldg'];
    const levels = [
      ['CONDO / HOUSE AND LOT', 'FOR SALE', 'Lot'],
      ['CONDO / HOUSE AND LOT', 'FOR SALE', 'House & Lot'],
      ['CONDO / HOUSE AND LOT', 'FOR LEASE/ FOR RENT', 'Condo'],
      ['COMMERCIAL SPACE', 'For lease', ''],
      ['COMMERCIAL SPACE', 'FOR SALE', ''],
      ['LOT', 'For sale', ''],
      ['WAREHOUSE', '', ''],
      ['FARM LOT', 'FOR SALE', ''],
    ] as const;
    return {
      ok: true,
      properties: Array.from({ length: count }, (_, i) => {
        const [category, listingType, subCategory] = levels[i % levels.length]!;
        return {
          id: `folder-${i}`,
          name: `${places[i % places.length]} ${kinds[(i >> 4) % kinds.length]} ${(i % 97) + 1}`,
          category,
          listingType,
          subCategory,
          photoCount: i % 13,
          hasIssues: i % 19 === 0,
        };
      }),
    };
  }

  it('searches 1,474 listings well inside 5 ms a keystroke', async () => {
    const { post } = scripted(syntheticLibrary(1474));
    const directory = directoryOver(post);
    expect(await directory.list()).toHaveLength(1474);

    // Someone typing, one key at a time, then the same with filters on.
    const typed = 'verdant hills blk 3 lot 7';
    const keystrokes = Array.from({ length: typed.length }, (_, i) => typed.slice(0, i + 1));
    const filters = [{}, { category: 'CONDO / HOUSE AND LOT' }, { listingType: 'for sale' }];

    for (const q of keystrokes) directory.search(q, filters[1]); // warm up

    const times: number[] = [];
    for (let round = 0; round < 6; round++) {
      for (const q of keystrokes) {
        const t0 = performance.now();
        directory.search(q, filters[round % filters.length]);
        times.push(performance.now() - t0);
      }
    }
    // Measured at about 0.03 ms typical and 0.1 ms at the 95th percentile. The
    // bounds are loose so a garbage-collection pause on a busy machine cannot
    // fail the build; the single slowest search is not asserted for that reason.
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length * 0.5)]!;
    const p95 = times[Math.floor(times.length * 0.95)]!;

    expect(median).toBeLessThan(1);
    expect(p95).toBeLessThan(5);
    // And the answer is right, not just fast.
    expect(directory.search('verdant hills blk 3 lot 7').every((p) => /verdant hills/i.test(p.name))).toBe(true);
  });
});

describe("the checker's fields (contract v3)", () => {
  it('are read when sent, and absent when not', async () => {
    const { post } = scripted({
      ok: true,
      properties: [
        { id: 'A', name: 'Alpha', city: ' Makati ', size: 120, dealType: 'Sale', availability: 'SOLD', inChecker: true },
        { id: 'B', name: 'Bravo', availability: 'Available', inChecker: false },
        { id: 'C', name: 'Charlie', availability: '', city: null, size: {}, inChecker: 'yes' },
        { id: 'D', name: 'Delta', availability: 'gone' },
        { id: 'E', name: 'Echo' },
      ],
    });
    const list = await directoryOver(post).list();
    const [a, b, c, d, e] = list;

    expect(a).toMatchObject({ city: 'Makati', size: '120', dealType: 'Sale', availability: 'Sold', inChecker: true });
    expect(b).toMatchObject({ availability: 'Available', inChecker: false });
    expect(c!.availability).toBe('');
    expect(c).not.toHaveProperty('city');
    expect(c).not.toHaveProperty('size');
    expect(c).not.toHaveProperty('inChecker');
    expect(d!.availability).toBe('');
    for (const field of ['city', 'size', 'dealType', 'availability', 'inChecker']) expect(e).not.toHaveProperty(field);
  });
});

describe('where each listing is (the geocoding sheet)', () => {
  it('keeps lat and lng when both are numbers in the Philippines, and drops them otherwise', async () => {
    const { post } = scripted({
      ok: true,
      properties: [
        { id: 'A', name: 'Alpha', lat: 14.5547, lng: 121.0244 },
        { id: 'B', name: 'Bravo', lat: '14.5', lng: 121 },
        { id: 'C', name: 'Charlie', lat: 35.68, lng: 139.69 },
        { id: 'D', name: 'Delta', lat: 14.5 },
        { id: 'E', name: 'Echo' },
      ],
    });
    const [a, b, c, d, e] = await directoryOver(post).list();

    expect(a).toMatchObject({ lat: 14.5547, lng: 121.0244 });
    for (const p of [b, c, d, e]) {
      expect(p).not.toHaveProperty('lat');
      expect(p).not.toHaveProperty('lng');
    }
  });

  it('survives the copy on disk, so the next launch draws the map at once', async () => {
    const store = memoryStore();
    const reply = { ok: true, properties: [{ id: 'A', name: 'Alpha', lat: 10.3157, lng: 123.8854 }] };
    await directoryOver(scripted(reply).post, { store }).list();

    const second = scripted(reply);
    const relaunched = directoryOver(second.post, { store });
    expect(await relaunched.restore()).toEqual([expect.objectContaining({ id: 'A', lat: 10.3157, lng: 123.8854 })]);
    expect(second.sent).toHaveLength(0);
  });
});

describe('restore()', () => {
  it('is null with no copy on disk, and never asks the server', async () => {
    const { post, sent } = scripted({ ok: true, properties: [{ id: 'A', name: 'Alpha' }] });
    const directory = directoryOver(post, { store: memoryStore() });

    expect(await directory.restore()).toBeNull();
    expect(directory.peek()).toBeNull();
    expect(sent).toHaveLength(0);
  });
});

describe('the Issues text on the list', () => {
  it('is kept when sent, absent when not, and survives the copy on disk', async () => {
    const store = memoryStore();
    const reply = {
      ok: true,
      properties: [
        { id: 'A', name: 'Alpha', hasIssues: true, issues: 'No separator line — the whole document is treated as postable. Check it.' },
        { id: 'B', name: 'Bravo', hasIssues: false, issues: '' },
        { id: 'C', name: 'Charlie', hasIssues: true },
      ],
    };
    const first = await directoryOver(scripted(reply).post, { store }).list();
    expect(first.map((p) => p.issues)).toEqual([
      'No separator line — the whole document is treated as postable. Check it.',
      '',
      undefined,
    ]);
    expect(first[2]).not.toHaveProperty('issues');

    const second = scripted(reply);
    const relaunched = await directoryOver(second.post, { store }).list();
    expect(second.sent).toHaveLength(0);
    expect(relaunched.map((p) => p.issues)).toEqual(first.map((p) => p.issues));
  });
});

describe("the checker's fields on one property", () => {
  it('are read when sent, as on the list, and absent when not', async () => {
    const { post } = scripted((body: Wire) =>
      body['id'] === 'A'
        ? { ok: true, property: { id: 'A', name: 'Alpha', city: ' Makati ', size: 120, dealType: 'Lease', availability: 'sold', inChecker: true } }
        : { ok: true, property: { id: 'B', name: 'Bravo' } },
    );
    const directory = directoryOver(post);

    expect(await directory.detail('A')).toMatchObject({
      city: 'Makati',
      size: '120',
      dealType: 'Lease',
      availability: 'Sold',
      inChecker: true,
    });
    const b = await directory.detail('B');
    for (const field of ['city', 'size', 'dealType', 'availability', 'inChecker']) expect(b).not.toHaveProperty(field);
  });
});

describe('the document id on the list (v7)', () => {
  it('is kept when sent, absent when blank or not sent, and survives the copy on disk', async () => {
    const store = memoryStore();
    const reply = {
      ok: true,
      properties: [
        { id: 'A', name: 'Alpha', docId: ' D-alpha ' },
        { id: 'B', name: 'Bravo', docId: '' },
        { id: 'C', name: 'Charlie' },
      ],
    };
    const first = await directoryOver(scripted(reply).post, { store }).list();
    expect(first[0]).toMatchObject({ docId: 'D-alpha' });
    expect(first[1]).not.toHaveProperty('docId');
    expect(first[2]).not.toHaveProperty('docId');

    const relaunched = await directoryOver(scripted(reply).post, { store }).list();
    expect(relaunched[0]).toMatchObject({ docId: 'D-alpha' });
  });
});

describe('a document nobody has separated, on one property (v7, D15)', () => {
  it('keeps `unseparated` and `flaggedLines` when sent, cleaned, and leaves them out when not', async () => {
    const { post } = scripted((body: Wire) =>
      body['id'] === 'A'
        ? {
            ok: true,
            property: {
              id: 'A',
              name: 'Alpha',
              publicText: 'FOR SALE\nOwner 0917 123 4567',
              hasInternal: false,
              withheld: false,
              unseparated: true,
              flaggedLines: [3, 1, 1, -1, 2.5, '4', null],
            },
          }
        : { ok: true, property: { id: 'B', name: 'Bravo', unseparated: 'yes', flaggedLines: 'all' } },
    );
    const directory = directoryOver(post);

    expect(await directory.detail('A')).toMatchObject({ unseparated: true, withheld: false, flaggedLines: [1, 3] });
    const b = await directory.detail('B');
    expect(b).not.toHaveProperty('unseparated');
    expect(b).not.toHaveProperty('flaggedLines');
  });
});
