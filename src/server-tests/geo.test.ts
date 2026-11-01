/**
 * The owner's geocoding sheet, joined onto `properties` by FolderId as `lat`
 * and `lng`, for the map on the app's startup screen. Read by header, never
 * written, and never a reason for `properties` to fail.
 */

import { describe, expect, it } from 'vitest';
import { CASA, createWorld, DIRECTORY_ID, LOT_9, TOWER } from './world';

type Row = Record<string, unknown>;

const GEO_HEADERS = ['FolderId', 'Property', 'Query', 'Lat', 'Lng', 'GeoStatus', 'Checked'];

function properties(w: ReturnType<typeof createWorld>): Row[] {
  const reply = w.call('jan', 'properties');
  expect(reply['ok']).toBe(true);
  return reply['properties'] as Row[];
}

function byId(rows: Row[]): Map<unknown, Row> {
  return new Map(rows.map((r) => [r['id'], r]));
}

describe('the geocoding sheet', () => {
  it('adds lat and lng by FolderId from a tab in the directory spreadsheet', () => {
    const w = createWorld();
    const geo = w.directory.addSheet('Geocode', GEO_HEADERS);
    geo.type(
      [CASA.id, 'Casa Amara', 'Casa Amara, Antipolo', '14.5862', '121.1761', 'OK', 'TRUE'],
      [` ${TOWER.id} `, 'Tower', 'Ortigas, Pasig', '14.5869', '121.0614', 'OK', ''],
    );
    const before = geo.show();

    const rows = byId(properties(w));

    expect(rows.get(CASA.id)).toMatchObject({ lat: 14.5862, lng: 121.1761 });
    expect(rows.get(TOWER.id)).toMatchObject({ lat: 14.5869, lng: 121.0614 });
    // No row for it: no fields at all, not zeros.
    expect(rows.get(LOT_9.id)).not.toHaveProperty('lat');
    expect(rows.get(LOT_9.id)).not.toHaveProperty('lng');
    // Read only.
    expect(geo.show()).toEqual(before);
  });

  it('finds the columns by header in any order and any case', () => {
    const w = createWorld();
    w.directory.addSheet('Where', ['lng', 'Checked', 'LAT', 'folderid']).type(['123.8854', '', '10.3157', CASA.id]);

    expect(byId(properties(w)).get(CASA.id)).toMatchObject({ lat: 10.3157, lng: 123.8854 });
  });

  it('auto-detects the first tab with FolderId, Lat and Lng, skipping tabs without them', () => {
    const w = createWorld();
    w.directory.addSheet('Notes', ['FolderId', 'Lat']).type([CASA.id, '1']);
    w.directory.addSheet('Geo A', GEO_HEADERS).type([CASA.id, '', '', '14.1', '121.1', '', '']);
    w.directory.addSheet('Geo B', GEO_HEADERS).type([CASA.id, '', '', '7.1', '125.6', '', '']);

    expect(byId(properties(w)).get(CASA.id)).toMatchObject({ lat: 14.1, lng: 121.1 });
  });

  it('reads the tab CONFIG.GEO_TAB names, in the spreadsheet CONFIG.GEO_SHEET_ID names', () => {
    const w = createWorld();
    const other = w.project.sheets.create('geo-sheet');
    other.addSheet('Geo A', GEO_HEADERS).type([CASA.id, '', '', '14.1', '121.1', '', '']);
    other.addSheet('Geo B', GEO_HEADERS).type([CASA.id, '', '', '7.1', '125.6', '', '']);
    w.project.configure({ GEO_SHEET_ID: 'geo-sheet', GEO_TAB: 'Geo B' });

    expect(byId(properties(w)).get(CASA.id)).toMatchObject({ lat: 7.1, lng: 125.6 });
  });

  it('leaves out rows whose Lat or Lng is not a number, or is outside the Philippines', () => {
    const w = createWorld();
    w.directory.addSheet('Geocode', GEO_HEADERS).type(
      [CASA.id, '', '', 'NOT FOUND', '121.1', 'ZERO_RESULTS', ''],
      [LOT_9.id, '', '', '', '', '', ''],
      [TOWER.id, '', '', '35.68', '139.69', 'OK', ''], // Tokyo
    );

    for (const row of properties(w)) {
      expect(row).not.toHaveProperty('lat');
      expect(row).not.toHaveProperty('lng');
    }
  });

  it.each([
    ['there is no such tab', (w: ReturnType<typeof createWorld>) => w.project.configure({ GEO_TAB: 'Nowhere' })],
    ['no tab has the columns', () => undefined],
    ['the spreadsheet cannot be opened', (w: ReturnType<typeof createWorld>) => w.project.configure({ GEO_SHEET_ID: 'missing' })],
  ])('answers without lat and lng when %s', (_label, arrange) => {
    const w = createWorld();
    arrange(w);

    const rows = properties(w);

    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).not.toHaveProperty('lat');
  });

  it('caches the join for ten minutes', () => {
    const w = createWorld();
    const geo = w.directory.addSheet('Geocode', GEO_HEADERS);
    geo.type([CASA.id, '', '', '14.1', '121.1', '', '']);

    properties(w);
    geo.typeAt(2, 4, '15.5');
    w.project.clock.advance(9 * 60_000);
    expect(byId(properties(w)).get(CASA.id)).toMatchObject({ lat: 14.1 });

    w.project.clock.advance(2 * 60_000);
    expect(byId(properties(w)).get(CASA.id)).toMatchObject({ lat: 15.5 });
  });

  it('is in the directory spreadsheet by default', () => {
    const w = createWorld();
    expect(w.project.evaluate('CONFIG.GEO_SHEET_ID')).toBe('');
    expect(w.project.evaluate('CONFIG.GEO_TAB')).toBe('');
    expect(w.directory.id).toBe(DIRECTORY_ID);
  });
});
