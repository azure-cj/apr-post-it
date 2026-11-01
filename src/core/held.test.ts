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

describe('heldListings', () => {
  it('holds a listing for the assignee of an open row on any date, keyed by id, else by normalised name', () => {
    const held = heldListings([
      row('Jan', '2026-10-01', 'Casa Amara', 'F1'),
      row('Ana', '2026-11-05', 'Sunrise Homes Blk. 3, Lt 9', '', 'To post'),
    ]);

    expect([...held.keys()]).toEqual(['id:F1', 'name:sunrise homes block 3 lot 9']);
    expect(held.get('id:F1')).toEqual({ heldBy: 'Jan', date: '2026-10-01', propertyName: 'Casa Amara', propertyId: 'F1' });
    expect(held.get('name:sunrise homes block 3 lot 9')?.heldBy).toBe('Ana');
  });

  it('is released by Posted and Pending', () => {
    const held = heldListings([
      row('Jan', '2026-10-01', 'Casa Amara', 'F1', 'Posted'),
      row('Jan', '2026-10-01', 'Tower 1201', 'F2', 'Pending'),
      row('Jan', '2026-10-01', 'Lot 9', 'F3', 'posted'),
    ]);
    expect(held.size).toBe(0);
  });

  it('gives the earliest date when two open rows hold one listing, then sheet order', () => {
    const held = heldListings([
      row('Ana', '2026-10-09', 'Casa Amara', 'F1'),
      row('Jan', '2026-10-02', 'Casa Amara', 'F1'),
      row('Mia', '2026-10-02', 'Casa Amara', 'F1'),
    ]);
    expect(held.get('id:F1')).toMatchObject({ heldBy: 'Jan', date: '2026-10-02' });
  });

  it('skips a row with neither id nor name', () => {
    expect(heldListings([row('Jan', '2026-10-01', '  ')]).size).toBe(0);
  });

  it('is found with heldBy by id, by name for a row with no id, and by name for a listing with no id', () => {
    const held = heldListings([
      row('Jan', '2026-10-01', 'Casa Amara', 'F1'),
      row('Ana', '2026-10-01', 'VERDANT HILLS, Lot 9'),
    ]);

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
