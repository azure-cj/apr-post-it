/**
 * The property list: fetched, kept, and searched on every keystroke.
 *
 * Ported from ScriptPropertyRepository.cs and Rules/PropertySearch.cs, with the
 * caching policy of docs/DATA-FLOW.md:
 *
 * - The list (1,474 rows, ~200 KB) is kept on disk through `store`, so the app
 *   opens on the last list at once and refreshes behind it. Call `refresh()` on
 *   launch and every 15 minutes; `list()` alone never goes back to the server
 *   once it has a list.
 * - A refresh replaces the list only when the new one was read in full. A reply
 *   that does not parse — or an empty list where there was a full one, which is
 *   what the directory sheet looks like mid-rebuild — leaves the old list in
 *   memory and on disk.
 * - A property's detail is fetched once and kept in memory until the next
 *   successful refresh, or until the key changes. It never goes to disk: for a
 *   manager it carries the internal text (DECISIONS D1).
 * - Search runs over a haystack built once per list, so a keystroke costs a few
 *   `includes` per row and allocates little more than the result.
 */

import { asList, asRecord, asText, unreadableReply, type Backend } from './backend';
import { UserFacingError, type Photo, type Property, type PropertyDetail } from './types';

/** Somewhere to keep the list between launches. Platform's readLocal / writeLocal fit. */
export interface LocalStore {
  readLocal(key: string): Promise<string | null>;
  writeLocal(key: string, value: string): Promise<void>;
}

export interface DirectoryDeps {
  readonly backend: Pick<Backend, 'call' | 'identity'>;
  /** Without one, the list lives in memory only. */
  readonly store?: LocalStore;
  /** For "when was this fetched". Default Date.now. */
  readonly now?: () => number;
}

/** Narrow a search. A value as `facets()` gives it — label or key — and blank means any. */
export interface DirectoryFilter {
  readonly category?: string | undefined;
  readonly listingType?: string | undefined;
}

/** One filter choice. "For sale" and "FOR SALE" are one facet. */
export interface Facet {
  /** Spelling-insensitive form. Filtering by it or by the label is the same. */
  readonly key: string;
  /** The commonest spelling in the directory: the one to show. */
  readonly label: string;
  readonly count: number;
}

export interface Facets {
  readonly categories: readonly Facet[];
  readonly listingTypes: readonly Facet[];
}

export interface Directory {
  /** Every property, sorted by name: from memory, else the disk, else the server. */
  list(): Promise<readonly Property[]>;

  /**
   * Fetches the list from the server now. Replaces what is kept only when the
   * new list was read in full; otherwise rejects and the old list stays.
   * A successful refresh also forgets every fetched detail.
   */
  refresh(): Promise<readonly Property[]>;

  /** The list in memory, or null before the first load. Never makes a request. */
  peek(): readonly Property[] | null;

  /** When the list in memory came from the server (ms since 1970), or null. */
  fetchedAt(): number | null;

  /** One property of the list in memory, by id. */
  get(id: string): Property | undefined;

  /**
   * Properties whose name and folder line contain every word of `query` —
   * in any order, ignoring case, accents and punctuation, with Blk/Lt/Ph/Bldg
   * read as Block/Lot/Phase/Building. Sorted by name. Synchronous, over the
   * list in memory: empty before the first load. Asking the same thing twice
   * returns the same array.
   */
  search(query: string, filter?: DirectoryFilter): readonly Property[];

  /** The categories and listing types in the list, for the filter chips. */
  facets(): Facets;

  /** A property's text, photos and checks. Fetched once, then kept until a refresh. */
  detail(id: string): Promise<PropertyDetail>;

  /** Called whenever the list in memory changes. Returns the way to stop. */
  subscribe(listener: () => void): () => void;

  /** Forgets everything in memory — on sign-out. The disk copy holds nothing private and stays. */
  clear(): void;
}

/** Where the list is kept, and the shape it is kept in. Bump the version to drop old copies. */
export const CACHE_KEY = 'postit.directory';
const CACHE_VERSION = 1;

const SEPARATOR = ' · ';
const NO_PROPERTIES: readonly Property[] = Object.freeze([]);
const NO_FACETS: Facets = Object.freeze({ categories: [], listingTypes: [] });

const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** "CONDO / HOUSE AND LOT · Lot · FOR SALE" — the folder path as one line, no empty gaps. */
export function folderLine(p: Pick<Property, 'category' | 'subCategory' | 'listingType'>): string {
  return joinPart(joinPart(joinPart('', p.category), p.subCategory), p.listingType);
}

function joinPart(line: string, part: string): string {
  const text = part.trim();
  if (!text) return line;
  return line ? line + SEPARATOR + text : text;
}

const ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ['blk', 'block'],
  ['lt', 'lot'],
  ['ph', 'phase'],
  ['bldg', 'building'],
]);

/**
 * "Sunrise Homes Blk. 3, Lt 9" → "sunrise homes block 3 lot 9". The rule of
 * PropertyNameMatcher.Normalize: case, accents, punctuation and "&" do not
 * matter, and the usual abbreviations are spelled out.
 */
export function normalizeForSearch(text: string): string {
  if (!text) return '';
  const plain = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{Nd}]+/gu, ' ');
  let out = '';
  for (const token of plain.split(' ')) {
    if (!token) continue;
    const word = ABBREVIATIONS.get(token) ?? token;
    out = out ? `${out} ${word}` : word;
  }
  return out;
}

// ------------------------------------------------------------------ the index

interface Entry {
  readonly property: Property;
  /** Normalised "name category · sub-category · listing type". */
  readonly haystack: string;
  readonly categoryKey: string;
  readonly listingTypeKey: string;
}

interface Index {
  readonly list: readonly Property[];
  readonly entries: readonly Entry[];
  readonly byId: ReadonlyMap<string, Property>;
  readonly fetchedAt: number;
  facets: Facets | null; // built the first time someone asks
}

/** Sorted by name, one row per id, every row's haystack built once. */
function buildIndex(properties: readonly Property[], fetchedAt: number): Index {
  const byId = new Map<string, Property>();
  for (const p of properties) if (!byId.has(p.id)) byId.set(p.id, p); // the first row wins a shared id
  const list = [...byId.values()].sort((a, b) => byName.compare(a.name, b.name));
  const entries = list.map((property): Entry => ({
    property,
    haystack: normalizeForSearch(`${property.name} ${folderLine(property)}`),
    categoryKey: normalizeForSearch(property.category),
    listingTypeKey: normalizeForSearch(property.listingType),
  }));
  return { list: Object.freeze(list), entries, byId, fetchedAt, facets: null };
}

function buildFacets(list: readonly Property[]): Facets {
  return {
    categories: facetsOf(list, (p) => p.category),
    listingTypes: facetsOf(list, (p) => p.listingType),
  };
}

function facetsOf(list: readonly Property[], pick: (p: Property) => string): readonly Facet[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const p of list) {
    const spelling = pick(p).trim();
    const key = normalizeForSearch(spelling);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { count: 0, spellings: new Map() }));
    group.count++;
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1);
  }
  const out: Facet[] = [];
  for (const [key, group] of groups) {
    let label = '';
    let best = 0;
    for (const [spelling, n] of group.spellings) if (n > best) [label, best] = [spelling, n];
    out.push({ key, label, count: group.count });
  }
  return out.sort((a, b) => byName.compare(a.label, b.label));
}

/** Every word in every haystack, rows already in name order. Longest word first: it rules out most. */
function runSearch(index: Index, query: string, category: string, listingType: string): readonly Property[] {
  const normalized = normalizeForSearch(query);
  const words = normalized ? normalized.split(' ').sort((a, b) => b.length - a.length) : [];
  const categoryKey = category ? normalizeForSearch(category) : '';
  const listingTypeKey = listingType ? normalizeForSearch(listingType) : '';
  if (words.length === 0 && !categoryKey && !listingTypeKey) return index.list;

  const out: Property[] = [];
  const { entries } = index;
  next: for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (categoryKey && entry.categoryKey !== categoryKey) continue;
    if (listingTypeKey && entry.listingTypeKey !== listingTypeKey) continue;
    for (let w = 0; w < words.length; w++) if (!entry.haystack.includes(words[w]!)) continue next;
    out.push(entry.property);
  }
  return out;
}

// ------------------------------------------------------------------ reading rows

/** One row of the list, or null when it has no id or no name. */
function readProperty(raw: unknown): Property | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asText(row['id']);
  const name = asText(row['name']);
  if (!id.trim() || !name.trim()) return null;
  return {
    id,
    name,
    category: asText(row['category']),
    listingType: asText(row['listingType']),
    subCategory: asText(row['subCategory']),
    photoCount: wholeNumber(row['photoCount']),
    hasIssues: row['hasIssues'] === true,
  };
}

function readProperties(rows: readonly unknown[]): Property[] {
  const out: Property[] = [];
  for (const row of rows) {
    const p = readProperty(row);
    if (p) out.push(p);
  }
  return out;
}

/** The `property` reply, or null when it is not a property at all. */
function readDetail(raw: unknown): PropertyDetail | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asText(row['id']);
  const name = asText(row['name']);
  if (!id.trim() || !name.trim()) return null;

  const photos = readPhotos(row['photos']);
  const issues = asText(row['issues']);
  const detail: PropertyDetail = {
    id,
    name,
    category: asText(row['category']),
    listingType: asText(row['listingType']),
    subCategory: asText(row['subCategory']),
    // The reply carries no count of its own: the photos are what can be downloaded.
    photoCount: photos.length,
    hasIssues: issues.trim() !== '',
    publicText: asText(row['publicText']),
    hasInternal: row['hasInternal'] === true,
    cutAt: asText(row['cutAt']),
    issues,
    live: row['live'] === true,
    photos,
    folder: asText(row['folder']),
    ...(typeof row['withheld'] === 'boolean' ? { withheld: row['withheld'] } : {}),
  };
  // Absent for an intern: the server never sent it (D1). Not hidden here — not here at all.
  const internal = row['internalText'];
  return typeof internal === 'string' ? { ...detail, internalText: internal } : detail;
}

function readPhotos(raw: unknown): readonly Photo[] {
  const rows = asList(raw);
  if (!rows) return [];
  const out: Photo[] = [];
  for (const item of rows) {
    const photo = asRecord(item);
    const url = photo ? asText(photo['url']).trim() : '';
    if (!photo || !url) continue;
    const n = out.length + 1;
    out.push({
      id: asText(photo['id']).trim() || String(n),
      name: asText(photo['name']).trim() || `photo ${n}`,
      url,
      thumb: asText(photo['thumb']).trim(),
    });
  }
  return out;
}

function wholeNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Calls `done` however `p` settles, without leaving a rejection unhandled. */
function whenSettled(p: Promise<unknown>, done: () => void): void {
  p.then(done, done);
}

// ------------------------------------------------------------------ the directory

export function createDirectory(deps: DirectoryDeps): Directory {
  const { backend, store } = deps;
  const now = deps.now ?? Date.now;

  let index: Index | null = null;
  /** Bumped by clear(): anything started before it may finish, but changes nothing. */
  let generation = 0;
  let loading: Promise<readonly Property[]> | null = null;
  let fetching: Promise<readonly Property[]> | null = null;
  let memo: {
    readonly index: Index;
    readonly query: string;
    readonly category: string;
    readonly listingType: string;
    readonly result: readonly Property[];
  } | null = null;

  const details = new Map<string, PropertyDetail>();
  const detailsInFlight = new Map<string, Promise<PropertyDetail>>();
  /** Whose details those are: backend.identity() when they were fetched. */
  let detailsOwner: string | null = null;

  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (err) {
        // A broken screen must not stop the list being kept. Report it, out of band.
        queueMicrotask(() => {
          throw err;
        });
      }
    }
  }

  function forgetDetails(): void {
    details.clear();
    detailsInFlight.clear();
    detailsOwner = null;
  }

  function apply(next: Index): void {
    index = next;
    memo = null;
    notify();
  }

  async function readDisk(): Promise<Index | null> {
    if (!store) return null;
    try {
      const text = await store.readLocal(CACHE_KEY);
      if (!text) return null;
      const saved = asRecord(JSON.parse(text));
      if (!saved || saved['v'] !== CACHE_VERSION) return null;
      const fetchedAt = saved['fetchedAt'];
      if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) return null;
      const rows = asList(saved['properties']);
      const properties = rows ? readProperties(rows) : [];
      // A copy that reads as nothing is no copy: go to the server instead.
      return properties.length > 0 ? buildIndex(properties, fetchedAt) : null;
    } catch {
      return null; // unreadable or unparseable: the server has the real one
    }
  }

  async function writeDisk(saved: Index): Promise<void> {
    if (!store) return;
    // One write of the whole, already-validated list. Nothing partial, nothing unchecked.
    const text = JSON.stringify({ v: CACHE_VERSION, fetchedAt: saved.fetchedAt, properties: saved.list });
    try {
      await store.writeLocal(CACHE_KEY, text);
    } catch {
      // Best effort: the list in memory is good, and the next refresh tries again.
    }
  }

  /** The one request for the list. Concurrent callers share it. */
  function fetchList(): Promise<readonly Property[]> {
    if (fetching) return fetching;
    const started = generation;
    const p = (async (): Promise<readonly Property[]> => {
      const reply = await backend.call('properties');
      const rows = asList(reply['properties']);
      if (!rows) throw unreadableReply('properties');
      const properties = readProperties(rows);
      if (rows.length > 0 && properties.length === 0) throw unreadableReply('properties');
      const next = buildIndex(properties, now());

      if (started !== generation) return next.list; // cleared meanwhile: answer, but keep nothing
      if (next.list.length === 0) {
        // What the directory sheet looks like mid-rebuild. A good list — in
        // memory, or still only on disk — is worth more than an empty one.
        const kept = index ?? (await readDisk());
        if (started !== generation) return next.list;
        if (kept && kept.list.length > 0) {
          if (!index) apply(kept);
          throw new UserFacingError(
            'The server sent an empty property list, so Post-It is keeping the one it had. ' +
              'The directory may be rebuilding: try again in a few minutes.',
          );
        }
      }
      // A new list: details are fetched again when next opened.
      details.clear();
      detailsInFlight.clear();
      apply(next);
      if (next.list.length > 0) await writeDisk(next);
      return next.list;
    })();
    fetching = p;
    whenSettled(p, () => {
      if (fetching === p) fetching = null;
    });
    return p;
  }

  async function fetchDetail(id: string, who: string): Promise<PropertyDetail> {
    const reply = await backend.call('property', { id });
    const detail = readDetail(reply['property']);
    if (!detail) throw unreadableReply('property');
    // Kept only if the same person is still asking — a manager's copy holds the
    // internal text and must never be handed to the next person on this PC.
    const stillAsking = await backend.identity();
    if (stillAsking === who && detailsOwner === who) details.set(id, detail);
    return detail;
  }

  /** The disk copy when there is one, else the server. */
  async function load(started: number): Promise<readonly Property[]> {
    const saved = await readDisk();
    if (saved && started === generation && !index) apply(saved);
    if (index && started === generation) return index.list;
    return fetchList();
  }

  return {
    list(): Promise<readonly Property[]> {
      if (index) return Promise.resolve(index.list);
      if (loading) return loading;
      const p = load(generation);
      loading = p;
      whenSettled(p, () => {
        if (loading === p) loading = null;
      });
      return p;
    },

    refresh: fetchList,

    peek: () => index?.list ?? null,

    fetchedAt: () => index?.fetchedAt ?? null,

    get: (id) => index?.byId.get(id),

    search(query, filter): readonly Property[] {
      const current = index;
      if (!current) return NO_PROPERTIES;
      const category = filter?.category ?? '';
      const listingType = filter?.listingType ?? '';
      if (
        memo &&
        memo.index === current &&
        memo.query === query &&
        memo.category === category &&
        memo.listingType === listingType
      ) {
        return memo.result;
      }
      const result = runSearch(current, query, category, listingType);
      memo = { index: current, query, category, listingType, result };
      return result;
    },

    facets(): Facets {
      if (!index) return NO_FACETS;
      return (index.facets ??= buildFacets(index.list));
    },

    async detail(id): Promise<PropertyDetail> {
      if (!id.trim()) throw new UserFacingError('Choose a property first.');
      const who = await backend.identity();
      if (who !== detailsOwner) {
        forgetDetails();
        detailsOwner = who;
      }
      const kept = details.get(id);
      if (kept) return kept;
      const pending = detailsInFlight.get(id);
      if (pending) return pending;

      const p = fetchDetail(id, who);
      detailsInFlight.set(id, p);
      whenSettled(p, () => {
        if (detailsInFlight.get(id) === p) detailsInFlight.delete(id);
      });
      return p;
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    clear(): void {
      generation++;
      index = null;
      memo = null;
      loading = null;
      fetching = null;
      forgetDetails();
      notify();
    },
  };
}
