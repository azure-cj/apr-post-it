/**
 * saveQueues: a day's plan for several interns, saved all or none under one
 * lock, each queue replaced the way saveQueue replaces one.
 */

import { describe, expect, it } from 'vitest';
import type { Reply } from './harness';
import { CASA, createWorld, LOT_9, TOWER } from './world';

const DAY = '2026-03-09';

describe('saveQueues', () => {
  it('replaces each named intern\'s queue for the date, and leaves everyone and every other day alone', () => {
    const w = createWorld();
    w.assignments.writeText(
      [DAY, 'Jan Dela Cruz', 'Old Jan item', 'To post', ''],
      [DAY, 'Ana Reyes', 'Old Ana item', 'To post', ''],
      [DAY, 'Former Intern', 'Someone else\'s', 'To post', ''],
      ['2026-03-10', 'Jan Dela Cruz', 'Tomorrow', 'To post', ''],
    );

    const reply = w.call('maria', 'saveQueues', {
      date: DAY,
      queues: [
        { assignedTo: 'Jan Dela Cruz', items: [{ propertyName: CASA.name, propertyId: CASA.id }, { propertyName: '1201' }] },
        { assignedTo: 'ana reyes', items: [{ propertyName: LOT_9.name, status: 'Pending' }] },
      ],
    });

    expect(reply).toEqual({ ok: true, saved: 3 });
    expect(w.assignments.show().slice(1)).toEqual([
      [DAY, 'Former Intern', 'Someone else\'s', 'To post', ''],
      ['2026-03-10', 'Jan Dela Cruz', 'Tomorrow', 'To post', ''],
      [DAY, 'Jan Dela Cruz', 'Casa Amara', 'To post', CASA.id],
      [DAY, 'Jan Dela Cruz', '1201', 'To post', TOWER.id],
      // As the Team tab spells the name, so the intern's own queue finds it.
      [DAY, 'Ana Reyes', 'Verdant Hills Lot 9', 'Pending', LOT_9.id],
    ]);
  });

  it('empties a queue sent with no items', () => {
    const w = createWorld();
    w.assignments.writeText([DAY, 'Jan Dela Cruz', 'Old', 'To post', '']);

    expect(w.call('maria', 'saveQueues', { date: DAY, queues: [{ assignedTo: 'Jan Dela Cruz', items: [] }] })).toEqual({ ok: true, saved: 0 });
    expect(w.assignments.lastRow).toBe(1);
  });

  it('reaches the intern\'s own queue', () => {
    const w = createWorld();
    w.call('maria', 'saveQueues', { date: DAY, queues: [{ assignedTo: 'Jan Dela Cruz', items: [{ propertyName: CASA.name }] }] });

    expect(w.call('jan', 'assignments')['assignments']).toEqual([
      { date: DAY, assignedTo: 'Jan Dela Cruz', property: 'Casa Amara', status: 'To post', propertyId: CASA.id },
    ]);
  });

  describe('writes nothing at all when any part is wrong', () => {
    const GOOD = { assignedTo: 'Jan Dela Cruz', items: [{ propertyName: CASA.name }] };

    it.each([
      ['someone not on the Team tab', { assignedTo: 'Nobody', items: [] }, 'bad-intern'],
      ['a revoked intern', { assignedTo: 'Former Intern', items: [] }, 'bad-intern'],
      ['an admin', { assignedTo: 'Rico Bautista', items: [] }, 'bad-intern'],
      ['no name', { items: [] }, 'bad-intern'],
      ['an item with no property', { assignedTo: 'Ana Reyes', items: [{ propertyId: CASA.id }] }, 'bad-queues'],
      ['the same intern twice', { assignedTo: 'jan dela cruz', items: [] }, 'bad-queues'],
      ['items that are not a list', { assignedTo: 'Ana Reyes', items: 'Casa Amara' }, 'bad-queues'],
    ] as const)('%s, after a good queue', (_label, bad, error) => {
      const w = createWorld();
      w.assignments.writeText([DAY, 'Jan Dela Cruz', 'Old', 'To post', '']);
      const before = w.assignments.show();

      const reply = w.call('maria', 'saveQueues', { date: DAY, queues: [GOOD, bad] });

      expect(reply).toMatchObject({ ok: false, error, message: expect.any(String) });
      expect(w.assignments.show()).toEqual(before);
    });

    it.each([[''], ['9/3/2026'], ['2026-02-30'], [undefined]])('a date of %j', (date) => {
      const w = createWorld();

      expect(w.call('maria', 'saveQueues', { date, queues: [GOOD] })).toMatchObject({ ok: false });
      expect(w.assignments.lastRow).toBe(1);
    });

    it.each([[undefined], ['not json'], [{ assignedTo: 'Jan Dela Cruz' }]])('queues of %j', (queues) => {
      const w = createWorld();

      expect(w.call('maria', 'saveQueues', { date: DAY, queues })).toMatchObject({ ok: false, error: 'bad-queues' });
      expect(w.assignments.lastRow).toBe(1);
    });
  });

  it('is forbidden to an intern', () => {
    const w = createWorld();

    expect(w.call('jan', 'saveQueues', { date: DAY, queues: [{ assignedTo: 'Jan Dela Cruz', items: [] }] })).toMatchObject({
      ok: false,
      error: 'forbidden',
    });
  });

  it('holds the lock throughout: a save landing anywhere inside it is turned away, never interleaved', () => {
    const plan = {
      date: DAY,
      queues: [
        { assignedTo: 'Jan Dela Cruz', items: [{ propertyName: CASA.name }, { propertyName: TOWER.name }] },
        { assignedTo: 'Ana Reyes', items: [{ propertyName: LOT_9.name }] },
      ],
    };
    const count = (k: number) => {
      const w = createWorld();
      let points = 0;
      const intruders: Reply[] = [];
      w.project.interleave((_what, depth) => {
        if (depth !== 1) return;
        if (++points === k) {
          intruders.push(w.call('rico', 'saveQueue', { date: DAY, assignedTo: 'Jan Dela Cruz', items: [{ property: 'Intruder' }] }));
        }
      });
      const reply = w.call('maria', 'saveQueues', plan);
      w.project.interleave(null);
      return { reply, intruders, points, rows: w.assignments.show().slice(1) };
    };

    const total = count(0).points;
    expect(total).toBeGreaterThan(5);
    let busy = 0;
    for (let k = 1; k <= total; k++) {
      const { reply, intruders, rows } = count(k);
      expect(reply, `at point ${k}`).toEqual({ ok: true, saved: 3 });
      const [intruder] = intruders;
      if (intruder?.['error'] === 'busy') {
        busy++;
        // Turned away: the plan stands whole.
        expect(rows.map((r) => r[2]), `at point ${k}`).toEqual(['Casa Amara', '1201', 'Verdant Hills Lot 9']);
      }
    }
    expect(busy).toBeGreaterThan(0);
  });

  it('shares saveQueue\'s logic: saveQueue still replaces one person\'s queue', () => {
    const w = createWorld();
    w.call('maria', 'saveQueues', { date: DAY, queues: [{ assignedTo: 'Jan Dela Cruz', items: [{ propertyName: CASA.name }] }] });

    expect(w.call('maria', 'saveQueue', { date: DAY, assignedTo: 'Jan Dela Cruz', items: [{ property: '1201' }] })).toEqual({
      ok: true,
      saved: 1,
    });
    expect(w.assignments.show().slice(1)).toEqual([[DAY, 'Jan Dela Cruz', '1201', 'To post', TOWER.id]]);
  });
});
