/**
 * v5: a listing assigned to an intern is held by that intern until it is
 * posted. summary.heldListings reads who holds what from the Assignments rows.
 */

import { describe, expect, it } from 'vitest';
import { heldBy, heldListings } from './summary';
import type { Assignment, AssignmentStatus } from './types';

function row(assignedTo: string, date: string, propertyName: string, propertyId = '', status = 'Not Shared'): Assignment {
  return { date, assignedTo, propertyName, propertyId, status: status as AssignmentStatus };
}

// Monday 2 Nov 2026: this week is 2–6 Nov; the week of 26–30 Oct is over.
const TODAY = '2026-11-02';

describe('heldListings', () => {
  it('holds a listing for the assignee of an open row in a week not over, keyed by id, else by normalised name', () => {
    const held = heldListings(
      [
        row('Jan', '2026-11-02', 'Casa Amara', 'F1'),
        // An old daily row, and one for next week: both weeks are not over.
        row('Ana', '2026-11-12', 'Sunrise Homes Blk. 3, Lt 9', '', 'To post'),
      ],
      TODAY,
    );

    expect([...held.keys()]).toEqual(['id:F1', 'name:sunrise homes block 3 lot 9']);
    expect(held.get('id:F1')).toEqual({ heldBy: 'Jan', date: '2026-11-02', week: '2026-11-02', propertyName: 'Casa Amara', propertyId: 'F1' });
    expect(held.get('name:sunrise homes block 3 lot 9')).toMatchObject({ heldBy: 'Ana', date: '2026-11-12', week: '2026-11-09' });
  });

  it('is released by Posted and Pending', () => {
    const held = heldListings(
      [
        row('Jan', '2026-11-02', 'Casa Amara', 'F1', 'Posted'),
        row('Jan', '2026-11-02', 'Tower 1201', 'F2', 'Pending'),
        row('Jan', '2026-11-02', 'Lot 9', 'F3', 'posted'),
      ],
      TODAY,
    );
    expect(held.size).toBe(0);
  });

  describe('expires with its week (v6)', () => {
    const rows = [row('Jan', '2026-10-26', 'Casa Amara', 'F1'), row('Ana', '2026-10-28', 'Tower', 'F2')];

    it('holds through Friday and lets go on Saturday', () => {
      expect(heldListings(rows, '2026-10-30').size).toBe(2);
      expect(heldListings(rows, '2026-10-31').size).toBe(0);
      expect(heldListings(rows, TODAY).size).toBe(0);
    });

    it('reads an old daily row as its week: a Sunday row is next week\'s', () => {
      const sunday = [row('Jan', '2026-11-01', 'Casa Amara', 'F1')];
      expect(heldListings(sunday, '2026-11-06').get('id:F1')).toMatchObject({ date: '2026-11-01', week: '2026-11-02' });
      expect(heldListings(sunday, '2026-11-07').size).toBe(0);
    });

    it('holds nothing for a row whose date cannot be read, and needs a real today', () => {
      expect(heldListings([row('Jan', 'someday', 'Casa Amara', 'F1')], TODAY).size).toBe(0);
      expect(() => heldListings(rows, '2 Nov')).toThrow();
    });

    it('takes the row\'s own week when it carries one', () => {
      const r: Assignment = { ...row('Jan', '2026-11-09', 'Casa Amara', 'F1'), week: '2026-11-09' };
      expect(heldListings([r], '2026-11-13').get('id:F1')?.week).toBe('2026-11-09');
      expect(heldListings([r], '2026-11-14').size).toBe(0);
    });
  });

  it('gives the earliest week when two open rows hold one listing, then sheet order', () => {
    const held = heldListings(
      [
        row('Ana', '2026-11-09', 'Casa Amara', 'F1'),
        row('Jan', '2026-11-03', 'Casa Amara', 'F1'),
        row('Mia', '2026-11-02', 'Casa Amara', 'F1'),
      ],
      TODAY,
    );
    expect(held.get('id:F1')).toMatchObject({ heldBy: 'Jan', week: '2026-11-02' });
  });

  it('skips a row with neither id nor name', () => {
    expect(heldListings([row('Jan', '2026-11-02', '  ')], TODAY).size).toBe(0);
  });

  it('is found with heldBy by id, by name for a row with no id, and by name for a listing with no id', () => {
    const held = heldListings(
      [row('Jan', '2026-11-02', 'Casa Amara', 'F1'), row('Ana', '2026-11-02', 'VERDANT HILLS, Lot 9')],
      TODAY,
    );

    expect(heldBy(held, { id: 'F1', name: 'Casa Amara (renamed)' })?.heldBy).toBe('Jan');
    expect(heldBy(held, { id: 'F9', name: 'Verdant Hills Lot 9' })?.heldBy).toBe('Ana');
    expect(heldBy(held, { id: '', name: 'casa amara' })?.heldBy).toBe('Jan');
    // Another folder with the same name is another listing.
    expect(heldBy(held, { id: 'F2', name: 'Casa Amara' })).toBeUndefined();
  });
});

import { naturalCompare } from './planner';
describe('naturalCompare', () => {
  it('orders numbers by value', () => {
    expect(['Warehouse 101', 'Warehouse 57', 'Warehouse 7'].sort(naturalCompare)).toEqual(['Warehouse 7', 'Warehouse 57', 'Warehouse 101']);
    expect(naturalCompare('a', 'a')).toBe(0);
    expect(naturalCompare('Lot 007', 'Lot 7')).not.toBe(NaN);
  });
});
