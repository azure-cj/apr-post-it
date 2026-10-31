/**
 * indexCheck: where the directory and the listing checker's index disagree,
 * read fresh for the admin who asks.
 */

import { describe, expect, it } from 'vitest';
import { CASA, createWorld, LOT_9, TOWER } from './world';

describe('indexCheck', () => {
  it('lists what only one side has, and which of our listings the checker marks Sold', () => {
    const w = createWorld({ now: '2026-03-09 10:00' });
    w.publishChecker([
      { id: CASA.id, name: 'Casa Amara', status: 'Available' },
      { id: TOWER.id, name: '1201', status: 'Sold' },
      { id: 'F-new', name: 'New Listing', path: 'LOT / FOR SALE / New Listing' },
      { id: 'F-gone', name: 'Gone, Sold', status: 'Sold', path: 'OFFICE / Gone, Sold' },
    ]);

    expect(w.call('maria', 'indexCheck')).toEqual({
      ok: true,
      checkedAt: '2026-03-09T10:00:00+08:00',
      directoryCount: 3,
      checkerCount: 4,
      directoryOnly: [{ id: LOT_9.id, name: LOT_9.name }],
      checkerOnly: [
        { id: 'F-new', name: 'New Listing', path: 'LOT / FOR SALE / New Listing' },
        { id: 'F-gone', name: 'Gone, Sold', path: 'OFFICE / Gone, Sold' },
      ],
      sold: [{ id: TOWER.id, name: '1201' }],
    });
  });

  it('agrees completely when both sides hold the same listings', () => {
    const w = createWorld();
    w.publishChecker([CASA, LOT_9, TOWER].map((l) => ({ id: l.id, name: l.name })));

    expect(w.call('maria', 'indexCheck')).toMatchObject({
      ok: true,
      directoryCount: 3,
      checkerCount: 3,
      directoryOnly: [],
      checkerOnly: [],
      sold: [],
    });
  });

  it('reads the CSV fresh, not the ten-minute cache properties uses, and refreshes that cache', () => {
    const w = createWorld();
    w.publishChecker([{ id: CASA.id, name: 'Casa', status: 'Available' }]);
    w.call('jan', 'properties');
    w.publishChecker([{ id: CASA.id, name: 'Casa', status: 'Sold' }]);

    expect(w.call('maria', 'indexCheck')).toMatchObject({ sold: [{ id: CASA.id, name: CASA.name }] });
    const casa = (w.call('jan', 'properties')['properties'] as Record<string, unknown>[]).find((r) => r['id'] === CASA.id);
    expect(casa).toMatchObject({ availability: 'Sold' });
    expect(w.project.web.fetched).toHaveLength(2);
  });

  it('says so when the checker cannot be read', () => {
    const w = createWorld();
    w.project.web.fail(w.checkerUrl);

    expect(w.call('maria', 'indexCheck')).toMatchObject({ ok: false, error: 'checker-unavailable', message: expect.any(String) });
  });

  it('says so when the join is switched off', () => {
    const w = createWorld();
    w.project.configure({ CHECKER_INDEX_CSV_URL: '' });

    expect(w.call('maria', 'indexCheck')).toMatchObject({ ok: false, error: 'checker-off' });
    expect(w.project.web.fetched).toEqual([]);
  });

  it('is forbidden to an intern', () => {
    const w = createWorld();
    w.publishChecker([]);

    expect(w.call('jan', 'indexCheck')).toEqual({ ok: false, error: 'forbidden', message: 'Your account cannot do that.' });
    expect(w.project.web.fetched).toEqual([]);
  });
});
