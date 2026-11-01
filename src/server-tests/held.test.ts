/**
 * v5: a listing assigned to an intern is held by that intern until it is
 * posted. saveQueue and saveQueues refuse a held item, all or none.
 */

import { describe, expect, it } from 'vitest';
import { BackendError } from '../core/backend';
import { CASA, createWorld, LOT_9, TOWER } from './world';

const DAY = '2026-03-09';
const JAN = 'Jan Dela Cruz';
const ANA = 'Ana Reyes';

describe('held listings', () => {
  it('refuses a listing held by another intern on any date, and writes nothing', () => {
    const w = createWorld();
    w.assignments.writeText(['2026-03-01', ANA, CASA.name, 'Not Shared', CASA.id]);
    const before = w.assignments.show();

    const reply = w.call('maria', 'saveQueue', {
      date: DAY,
      assignedTo: JAN,
      items: [{ property: TOWER.name }, { property: CASA.name, propertyId: CASA.id }],
    });

    expect(reply).toEqual({
      ok: false,
      error: 'held',
      held: [{ propertyName: CASA.name, propertyId: CASA.id, heldBy: ANA, date: '2026-03-01' }],
      message: expect.stringMatching(/^Casa Amara is already with Ana Reyes\b.*Remove it from their queue first\.$/),
    });
    expect(w.assignments.show()).toEqual(before);
  });

  it('matches by name when the holding row has no id, as the app normalises names', () => {
    const w = createWorld();
    w.assignments.writeText(['2026-03-01', ANA, 'VERDANT HILLS, Lot 9', 'To post', '']);

    const reply = w.call('maria', 'saveQueues', { date: DAY, queues: [{ assignedTo: JAN, items: [{ propertyName: LOT_9.name }] }] });

    expect(reply).toMatchObject({ ok: false, error: 'held', held: [{ propertyName: LOT_9.name, propertyId: LOT_9.id, heldBy: ANA }] });
  });

  it('refuses a listing held by the same intern on another date', () => {
    const w = createWorld();
    w.assignments.writeText(['2026-03-10', JAN, CASA.name, 'Not Shared', CASA.id]);

    const reply = w.call('maria', 'saveQueue', { date: DAY, assignedTo: JAN, items: [{ property: CASA.name }] });

    expect(reply).toMatchObject({
      ok: false,
      error: 'held',
      held: [{ propertyName: CASA.name, propertyId: CASA.id, heldBy: JAN, date: '2026-03-10' }],
    });
    expect(w.assignments.lastRow).toBe(2);
  });

  it('lets the same intern and date be saved again: a replace', () => {
    const w = createWorld();
    w.assignments.writeText([DAY, JAN, CASA.name, 'Not Shared', CASA.id], [DAY, JAN, TOWER.name, 'Not Shared', TOWER.id]);

    expect(w.call('maria', 'saveQueue', { date: DAY, assignedTo: JAN, items: [{ property: TOWER.name }, { property: CASA.name }] })).toEqual({
      ok: true,
      saved: 2,
    });
    expect(w.call('maria', 'saveQueues', { date: DAY, queues: [{ assignedTo: JAN, items: [{ propertyName: CASA.name }] }] })).toEqual({
      ok: true,
      saved: 1,
    });
    expect(w.assignments.show().slice(1)).toEqual([[DAY, JAN, CASA.name, 'Not Shared', CASA.id]]);
  });

  it.each([['Posted'], ['Pending']])('is released once %s', (status) => {
    const w = createWorld();
    w.assignments.writeText(['2026-03-01', ANA, CASA.name, status, CASA.id]);

    expect(w.call('maria', 'saveQueue', { date: DAY, assignedTo: JAN, items: [{ property: CASA.name }] })).toEqual({ ok: true, saved: 1 });
  });

  it('is released by taking it out of the first queue, and then moves', () => {
    const w = createWorld();
    w.call('maria', 'saveQueue', { date: DAY, assignedTo: ANA, items: [{ property: CASA.name }, { property: TOWER.name }] });

    expect(w.call('maria', 'saveQueue', { date: DAY, assignedTo: JAN, items: [{ property: CASA.name }] })).toMatchObject({ error: 'held' });

    expect(w.call('maria', 'saveQueue', { date: DAY, assignedTo: ANA, items: [{ property: TOWER.name }] })).toEqual({ ok: true, saved: 1 });
    expect(w.call('maria', 'saveQueue', { date: DAY, assignedTo: JAN, items: [{ property: CASA.name }] })).toEqual({ ok: true, saved: 1 });
    expect(w.assignments.show().slice(1)).toEqual([
      [DAY, ANA, TOWER.name, 'Not Shared', TOWER.id],
      [DAY, JAN, CASA.name, 'Not Shared', CASA.id],
    ]);
  });

  it('moves a listing between two interns in one saveQueues: both queues are replaced together', () => {
    const w = createWorld();
    w.assignments.writeText([DAY, ANA, CASA.name, 'Not Shared', CASA.id]);

    const reply = w.call('maria', 'saveQueues', {
      date: DAY,
      queues: [
        { assignedTo: ANA, items: [] },
        { assignedTo: JAN, items: [{ propertyName: CASA.name }] },
      ],
    });

    expect(reply).toEqual({ ok: true, saved: 1 });
  });

  describe('saveQueues refuses all or none', () => {
    it('writes nothing when one queue has a held item, and lists every held item', () => {
      const w = createWorld();
      w.assignments.writeText(
        ['2026-03-01', ANA, CASA.name, 'Not Shared', CASA.id],
        ['2026-03-12', JAN, LOT_9.name, 'Not Shared', LOT_9.id],
        [DAY, JAN, 'Old item', 'Not Shared', ''],
      );
      const before = w.assignments.show();

      const reply = w.call('maria', 'saveQueues', {
        date: DAY,
        queues: [
          { assignedTo: ANA, items: [{ propertyName: TOWER.name }] },
          { assignedTo: JAN, items: [{ propertyName: CASA.name }, { propertyName: LOT_9.name }] },
        ],
      });

      expect(reply).toMatchObject({
        ok: false,
        error: 'held',
        held: [
          { propertyName: CASA.name, propertyId: CASA.id, heldBy: ANA, date: '2026-03-01' },
          { propertyName: LOT_9.name, propertyId: LOT_9.id, heldBy: JAN, date: '2026-03-12' },
        ],
      });
      expect(w.assignments.show()).toEqual(before);
    });

    it('gives a listing sent in two queues to neither', () => {
      const w = createWorld();

      const reply = w.call('maria', 'saveQueues', {
        date: DAY,
        queues: [
          { assignedTo: ANA, items: [{ propertyName: CASA.name }] },
          { assignedTo: JAN, items: [{ propertyName: 'casa amara' }] },
        ],
      });

      expect(reply).toMatchObject({ ok: false, error: 'held', held: [{ propertyName: 'casa amara', heldBy: ANA, date: DAY }] });
      expect(w.assignments.lastRow).toBe(1);
    });
  });

  it('reaches the app as a BackendError carrying the held items', async () => {
    const w = createWorld();
    w.assignments.writeText(['2026-03-01', ANA, CASA.name, 'Not Shared', CASA.id]);

    const failure = await w
      .app('maria')
      .tracker.saveQueues(DAY, [{ assignedTo: JAN, items: [{ propertyName: CASA.name, propertyId: CASA.id }] }])
      .catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(BackendError);
    expect(failure).toMatchObject({
      code: 'held',
      message: 'Casa Amara is already with Ana Reyes. Remove it from their queue first.',
      held: [{ propertyName: CASA.name, propertyId: CASA.id, heldBy: ANA, date: '2026-03-01' }],
    });
  });
});
