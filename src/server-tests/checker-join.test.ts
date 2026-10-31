/**
 * The listing checker's published Index CSV, joined onto `properties` by Folder
 * ID. The checker is another team's script: Post-It only fetches its CSV. When
 * that fails or is switched off, `properties` answers exactly as before.
 */

import { describe, expect, it } from 'vitest';
import { parseCsv } from './harness';
import { CASA, checkerCsv, CHECKER_HEADERS, createWorld, LOT_9, TOWER } from './world';

type Row = Record<string, unknown>;

const PUBLISHED =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vT_xOq-DEX-QXpSMfkkH8eEiwVkd1ylTKh6jhOxY4TfjrvnpLg-OqemlwcL6GLWlNXvjiWyTlZEymJU/pub?gid=90841346&single=true&output=csv';

const BASE = ['id', 'name', 'category', 'listingType', 'subCategory', 'photoCount', 'hasIssues', 'issues'];
const JOINED = ['city', 'size', 'dealType', 'availability', 'inChecker'];

function properties(w: ReturnType<typeof createWorld>): Row[] {
  const reply = w.call('jan', 'properties');
  expect(reply['ok']).toBe(true);
  return reply['properties'] as Row[];
}

describe('the checker join', () => {
  it('reads the checker\'s published Index by default', () => {
    const w = createWorld();

    expect(w.checkerUrl).toBe(PUBLISHED);
  });

  it('adds city, size, deal type and availability by Folder ID, and inChecker', () => {
    const w = createWorld();
    w.publishChecker([
      { id: CASA.id, name: 'Casa Amara (checker\'s name)', city: 'Antipolo', size: '120', dealType: 'Sale', status: 'Available' },
      { id: ` ${TOWER.id} `, name: '1201', city: 'Pasig, Ortigas', size: '85.5 sqm', dealType: 'Lease', status: 'Sold' },
      { id: 'F-only-in-checker', name: 'Elsewhere', city: 'Cebu' },
    ]);

    const rows = properties(w);

    expect(rows.find((r) => r['id'] === CASA.id)).toMatchObject({
      name: 'Casa Amara', city: 'Antipolo', size: '120', dealType: 'Sale', availability: 'Available', inChecker: true,
    });
    // Quoted fields with commas survive; the size is the text as published.
    expect(rows.find((r) => r['id'] === TOWER.id)).toMatchObject({
      city: 'Pasig, Ortigas', size: '85.5 sqm', dealType: 'Lease', availability: 'Sold', inChecker: true,
    });
    expect(rows.find((r) => r['id'] === LOT_9.id)).toMatchObject({
      city: '', size: '', dealType: '', availability: '', inChecker: false,
    });
    expect(rows).toHaveLength(3);
  });

  it('flags Sold however the checker cases it, and reads any other status as unknown', () => {
    const w = createWorld();
    w.publishChecker([
      { id: CASA.id, name: 'a', status: 'SOLD ' },
      { id: TOWER.id, name: 'b', status: 'Reserved' },
      { id: LOT_9.id, name: 'c', status: 'available' },
    ]);
    const by = new Map(properties(w).map((r) => [r['id'], r['availability']]));

    expect(by.get(CASA.id)).toBe('Sold');
    expect(by.get(TOWER.id)).toBe('');
    expect(by.get(LOT_9.id)).toBe('Available');
  });

  it('finds the columns by header, wherever the checker puts them', () => {
    const w = createWorld();
    w.project.web.respond(
      w.checkerUrl,
      checkerCsv([{ id: CASA.id, name: 'x', city: 'Antipolo', status: 'Sold' }], [...CHECKER_HEADERS].reverse()),
    );

    expect(properties(w).find((r) => r['id'] === CASA.id)).toMatchObject({ city: 'Antipolo', availability: 'Sold' });
  });

  it.each([
    ['the fetch fails', (w: ReturnType<typeof createWorld>) => void w.project.web.fail(w.checkerUrl)],
    ['the CSV answers 404', (w: ReturnType<typeof createWorld>) => void w.project.web.respond(w.checkerUrl, 'Not found', 404)],
    ['the CSV answers 500', (w: ReturnType<typeof createWorld>) => void w.project.web.respond(w.checkerUrl, '<html>', 500)],
    ['the page is not the Index (no Folder ID)', (w: ReturnType<typeof createWorld>) => void w.project.web.respond(w.checkerUrl, 'a,b\n1,2\n')],
    ['the CSV is empty', (w: ReturnType<typeof createWorld>) => void w.project.web.respond(w.checkerUrl, '')],
    ['the CSV is broken', (w: ReturnType<typeof createWorld>) => void w.project.web.respond(w.checkerUrl, 'Folder ID\n"unterminated')],
  ])('leaves the properties unchanged, without the fields, when %s', (_label, arrange) => {
    const w = createWorld();
    arrange(w);

    const rows = properties(w);

    expect(rows).toHaveLength(3);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual([...BASE].sort());
  });

  it('turns the join off when the URL is empty, and does not fetch at all', () => {
    const w = createWorld();
    w.publishChecker([{ id: CASA.id, name: 'x', city: 'Antipolo' }]);
    w.project.configure({ CHECKER_INDEX_CSV_URL: '' });

    const rows = properties(w);

    for (const row of rows) for (const field of JOINED) expect(row).not.toHaveProperty(field);
    expect(w.project.web.fetched).toEqual([]);
  });

  it('caches the parsed join for ten minutes', () => {
    const w = createWorld();
    w.publishChecker([{ id: CASA.id, name: 'x', city: 'Antipolo' }]);

    properties(w);
    w.publishChecker([{ id: CASA.id, name: 'x', city: 'Changed' }]);
    w.project.clock.advance(9 * 60_000);
    expect(properties(w).find((r) => r['id'] === CASA.id)).toMatchObject({ city: 'Antipolo' });
    expect(w.project.web.fetched).toHaveLength(1);

    w.project.clock.advance(2 * 60_000);
    expect(properties(w).find((r) => r['id'] === CASA.id)).toMatchObject({ city: 'Changed' });
    expect(w.project.web.fetched).toHaveLength(2);
  });

  it('caches an index bigger than one cache value (100 KB) in chunks, accents and all', () => {
    const w = createWorld();
    const many = Array.from({ length: 3000 }, (_, i) => ({
      id: `F-many-${i}`,
      name: `Listing number ${i} with a long enough name to take some room`,
      city: 'Parañaque',
      path: `CONDO / HOUSE AND LOT / FOR SALE / Ñ ${i} 🏠`,
    }));
    w.publishChecker([...many, { id: CASA.id, name: 'Casa', city: 'Las Piñas', size: '50' }]);
    expect(checkerCsv(many).length).toBeGreaterThan(200 * 1024);

    expect(properties(w).find((r) => r['id'] === CASA.id)).toMatchObject({ city: 'Las Piñas', size: '50' });
    expect(properties(w).find((r) => r['id'] === CASA.id)).toMatchObject({ city: 'Las Piñas' });
    expect(w.project.web.fetched).toHaveLength(1);
  });

  it('fetches again when a chunk has been evicted, rather than use half an index', () => {
    const w = createWorld();
    w.publishChecker([{ id: CASA.id, name: 'x', city: 'Antipolo' }]);
    properties(w);

    w.project.cache.clear();
    expect(properties(w).find((r) => r['id'] === CASA.id)).toMatchObject({ city: 'Antipolo' });
    expect(w.project.web.fetched).toHaveLength(2);
  });

  it('only ever reads: one GET of the published CSV, nothing written to any checker sheet', () => {
    const w = createWorld();
    w.publishChecker([{ id: CASA.id, name: 'x' }]);
    properties(w);

    expect(w.project.web.fetched).toEqual([PUBLISHED]);
    const code = w.project.evaluate('fetchCheckerIndex_.toString() + checkerIndex_.toString()') as string;
    expect(code).not.toMatch(/openById|openByUrl|method\s*:|payload|setValue|appendRow/);
  });
});

describe('the Issues text', () => {
  it('goes out with every row, as BuildDirectory.gs wrote it, so the planner can skip by it', () => {
    const w = createWorld();
    const by = new Map(properties(w).map((r) => [r['id'], r]));

    expect(by.get(LOT_9.id)).toMatchObject({
      hasIssues: true,
      issues: 'No separator line \u2014 the whole document is treated as postable. Check it.',
    });
    expect(by.get(TOWER.id)).toMatchObject({ hasIssues: true, issues: 'No photos' });
    expect(by.get(CASA.id)).toMatchObject({ hasIssues: false, issues: '' });
  });
});

describe('the checker join on one property', () => {
  const detail = (w: ReturnType<typeof createWorld>, person: 'jan' | 'maria', id: string): Row => {
    const reply = w.call(person, 'property', { id });
    expect(reply['ok']).toBe(true);
    return reply['property'] as Row;
  };

  it('adds the same fields as the list, joined the same way, for an intern and an admin', () => {
    const w = createWorld();
    w.publishChecker([{ id: CASA.id, name: 'x', city: 'Antipolo', size: '120', dealType: 'Sale', status: 'Sold' }]);

    for (const person of ['jan', 'maria'] as const) {
      expect(detail(w, person, CASA.id)).toMatchObject({
        city: 'Antipolo', size: '120', dealType: 'Sale', availability: 'Sold', inChecker: true,
      });
    }
    expect(detail(w, 'jan', LOT_9.id)).toMatchObject({ city: '', size: '', dealType: '', availability: '', inChecker: false });
  });

  it('leaves the fields out when the join is off or the index cannot be read', () => {
    const w = createWorld();
    w.project.web.fail(w.checkerUrl);
    for (const field of JOINED) expect(detail(w, 'jan', CASA.id)).not.toHaveProperty(field);

    const off = createWorld();
    off.project.configure({ CHECKER_INDEX_CSV_URL: '' });
    for (const field of JOINED) expect(detail(off, 'jan', CASA.id)).not.toHaveProperty(field);
  });
});

describe('the fakes the join runs on', () => {
  it('Utilities.parseCsv reads quotes, doubled quotes, line breaks in a field and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n"multi\nline",,x\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['multi\nline', '', 'x'],
    ]);
    expect(parseCsv('')).toEqual([]);
    expect(() => parseCsv('"open')).toThrow();
  });

  it('UrlFetchApp throws on an HTTP error unless muted, and always on a failed connection', () => {
    const w = createWorld();
    w.project.web.respond('https://x.example/404', 'nope', 404).fail('https://x.example/down');

    expect(w.project.evaluate(`UrlFetchApp.fetch('https://x.example/404', { muteHttpExceptions: true }).getResponseCode()`)).toBe(404);
    expect(() => w.project.evaluate(`UrlFetchApp.fetch('https://x.example/404')`)).toThrow(/returned code 404/);
    expect(() => w.project.evaluate(`UrlFetchApp.fetch('https://x.example/down', { muteHttpExceptions: true })`)).toThrow(
      /Address unavailable/,
    );
  });
});
