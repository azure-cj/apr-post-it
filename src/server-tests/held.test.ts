/**
 * v5, made weekly by v6: a listing assigned to an intern is held by that
 * intern until it is posted, or until the week of that queue is over.
 * saveQueue and saveQueues refuse a held item, all or none.
 *
 * The harness's clock starts on Monday 2026-03-09 10:00, Manila: this week is
 * 9–13 Mar, last week (2–6 Mar) is over, next week starts on the 16th.
 */

import { describe, expect, it } from 'vitest';
import { BackendError } from '../core/backend';
import { CASA, createWorld, LOT_9, TOWER } from './world';

const THIS_WEEK = '2026-03-09';
const NEXT_WEEK = '2026-03-16';
const LAST_WEEK = '2026-03-02';
const JAN = 'Jan Dela Cruz';
const ANA = 'Ana Reyes';

describe('held listings', () => {
  it('refuses a listing held by another intern in a week that is not over, and writes nothing', () => {
    const w = createWorld();
    w.assignments.writeText([THIS_WEEK, ANA, CASA.name, 'Not Shared', CASA.id]);
    const before = w.assignments.show();

    const reply = w.call('maria', 'saveQueue', {
      week: NEXT_WEEK,
      assignedTo: JAN,
      items: [{ property: TOWER.name }, { property: CASA.name, propertyId: CASA.id }],
    });

    expect(reply).toEqual({
      ok: false,
      error: 'held',
      held: [{ propertyName: CASA.name, propertyId: CASA.id, heldBy: ANA, date: THIS_WEEK, week: THIS_WEEK }],
      message: 'Casa Amara is already with Ana Reyes (queue for the week of 9–13 Mar). Remove it from their queue first.',
    });
    expect(w.assignments.show()).toEqual(before);
  });

  it('holds by an old daily row too, read as its week, and matches by name when the row has no id', () => {
    const w = createWorld();
    w.assignments.writeText(['2026-03-11', ANA, 'VERDANT HILLS, Lot 9', 'To post', '']);

    const reply = w.call('maria', 'saveQueues', { week: THIS_WEEK, queues: [{ assignedTo: JAN, items: [{ propertyName: LOT_9.name }] }] });

    expect(reply).toMatchObject({
      ok: false,
      error: 'held',
      held: [{ propertyName: LOT_9.name, propertyId: LOT_9.id, heldBy: ANA, date: '2026-03-11', week: THIS_WEEK }],
    });
  });

  it('refuses a listing held by the same intern in another week', () => {
    const w = createWorld();
    w.assignments.writeText([NEXT_WEEK, JAN, CASA.name, 'Not Shared', CASA.id]);

    const reply = w.call('maria', 'saveQueue', { week: THIS_WEEK, assignedTo: JAN, items: [{ property: CASA.name }] });

    expect(reply).toMatchObject({
      ok: false,
      error: 'held',
      held: [{ propertyName: CASA.name, propertyId: CASA.id, heldBy: JAN, week: NEXT_WEEK }],
    });
    expect(w.assignments.lastRow).toBe(2);
  });

  it('lets the same intern and week be saved again: a replace, old daily rows of that week included', () => {
    const w = createWorld();
    w.assignments.writeText(
      [THIS_WEEK, JAN, CASA.name, 'Not Shared', CASA.id],
      ['2026-03-12', JAN, TOWER.name, 'Not Shared', TOWER.id],
    );

    expect(w.call('maria', 'saveQueue', { week: THIS_WEEK, assignedTo: JAN, items: [{ property: TOWER.name }, { property: CASA.name }] })).toEqual({
      ok: true,
      saved: 2,
    });
    expect(w.call('maria', 'saveQueues', { week: THIS_WEEK, queues: [{ assignedTo: JAN, items: [{ propertyName: CASA.name }] }] })).toEqual({
      ok: true,
      saved: 1,
    });
    expect(w.assignments.show().slice(1)).toEqual([[THIS_WEEK, JAN, CASA.name, 'Not Shared', CASA.id]]);
  });

  it.each([['Posted'], ['Pending']])('is released once %s', (status) => {
    const w = createWorld();
    w.assignments.writeText([THIS_WEEK, ANA, CASA.name, status, CASA.id]);

    expect(w.call('maria', 'saveQueue', { week: NEXT_WEEK, assignedTo: JAN, items: [{ property: CASA.name }] })).toEqual({ ok: true, saved: 1 });
  });

  describe('expires when the week is over (v6)', () => {
    it('holds nothing from a week already over: the row is Missed, and stays as it is', () => {
      const w = createWorld();
      // Sunday 1 Mar belongs to the week of 2 Mar, which ended on Friday 6 Mar.
      w.assignments.writeText(['2026-03-01', ANA, CASA.name, 'Not Shared', CASA.id], [LAST_WEEK, ANA, TOWER.name, 'To post', TOWER.id]);

      expect(w.call('maria', 'saveQueue', { week: THIS_WEEK, assignedTo: JAN, items: [{ property: CASA.name }, { property: TOWER.name }] })).toEqual({
        ok: true,
        saved: 2,
      });
      // Missed is never written: Ana's rows are untouched.
      expect(w.assignments.show().slice(1, 3)).toEqual([
        ['2026-03-01', ANA, CASA.name, 'Not Shared', CASA.id],
        [LAST_WEEK, ANA, TOWER.name, 'To post', TOWER.id],
      ]);
    });

    it('holds through Friday, Manila time, and lets go on Saturday', () => {
      const w = createWorld();
      w.assignments.writeText([THIS_WEEK, ANA, CASA.name, 'Not Shared', CASA.id]);
      const save = () => w.call('maria', 'saveQueue', { week: NEXT_WEEK, assignedTo: JAN, items: [{ property: CASA.name }] });

      w.project.clock.set('2026-03-13 23:59');
      expect(save()).toMatchObject({ ok: false, error: 'held' });

      w.project.clock.set('2026-03-14 00:01');
      expect(save()).toEqual({ ok: true, saved: 1 });
    });

    it('across a month boundary: the week of 30 Mar ends on Friday 3 Apr', () => {
      const w = createWorld({ now: '2026-04-03 18:00' });
      w.assignments.writeText(['2026-03-31', ANA, CASA.name, 'Not Shared', CASA.id]);
      const save = () => w.call('maria', 'saveQueue', { week: '2026-04-06', assignedTo: JAN, items: [{ property: CASA.name }] });

      expect(save()).toMatchObject({ ok: false, error: 'held', held: [{ week: '2026-03-30' }] });
      expect(save()).toMatchObject({ message: expect.stringContaining('(queue for the week of 30 Mar – 3 Apr)') });
      w.project.clock.set('2026-04-04 08:00');
      expect(save()).toEqual({ ok: true, saved: 1 });
    });

    it('holds nothing for a row whose date cannot be read', () => {
      const w = createWorld();
      w.assignments.writeText(['someday', ANA, CASA.name, 'Not Shared', CASA.id]);

      expect(w.call('maria', 'saveQueue', { week: THIS_WEEK, assignedTo: JAN, items: [{ property: CASA.name }] })).toEqual({ ok: true, saved: 1 });
    });
  });

  it('is released by taking it out of the first queue, and then moves', () => {
    const w = createWorld();
    w.call('maria', 'saveQueue', { week: THIS_WEEK, assignedTo: ANA, items: [{ property: CASA.name }, { property: TOWER.name }] });

    expect(w.call('maria', 'saveQueue', { week: THIS_WEEK, assignedTo: JAN, items: [{ property: CASA.name }] })).toMatchObject({ error: 'held' });

    expect(w.call('maria', 'saveQueue', { week: THIS_WEEK, assignedTo: ANA, items: [{ property: TOWER.name }] })).toEqual({ ok: true, saved: 1 });
    expect(w.call('maria', 'saveQueue', { week: THIS_WEEK, assignedTo: JAN, items: [{ property: CASA.name }] })).toEqual({ ok: true, saved: 1 });
    expect(w.assignments.show().slice(1)).toEqual([
      [THIS_WEEK, ANA, TOWER.name, 'Not Shared', TOWER.id],
      [THIS_WEEK, JAN, CASA.name, 'Not Shared', CASA.id],
    ]);
  });

  it('moves a listing between two interns in one saveQueues: both queues are replaced together', () => {
    const w = createWorld();
    w.assignments.writeText([THIS_WEEK, ANA, CASA.name, 'Not Shared', CASA.id]);

    const reply = w.call('maria', 'saveQueues', {
      week: THIS_WEEK,
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
        [THIS_WEEK, ANA, CASA.name, 'Not Shared', CASA.id],
        [NEXT_WEEK, JAN, LOT_9.name, 'Not Shared', LOT_9.id],
        [THIS_WEEK, JAN, 'Old item', 'Not Shared', ''],
      );
      const before = w.assignments.show();

      const reply = w.call('maria', 'saveQueues', {
        week: THIS_WEEK,
        queues: [
          { assignedTo: JAN, items: [{ propertyName: CASA.name }, { propertyName: LOT_9.name }] },
        ],
      });

      expect(reply).toMatchObject({
        ok: false,
        error: 'held',
        held: [
          { propertyName: CASA.name, propertyId: CASA.id, heldBy: ANA, week: THIS_WEEK },
          { propertyName: LOT_9.name, propertyId: LOT_9.id, heldBy: JAN, week: NEXT_WEEK },
        ],
      });
      expect(w.assignments.show()).toEqual(before);
    });

    it('gives a listing sent in two queues to neither', () => {
      const w = createWorld();

      const reply = w.call('maria', 'saveQueues', {
        week: THIS_WEEK,
        queues: [
          { assignedTo: ANA, items: [{ propertyName: CASA.name }] },
          { assignedTo: JAN, items: [{ propertyName: 'casa amara' }] },
        ],
      });

      expect(reply).toMatchObject({ ok: false, error: 'held', held: [{ propertyName: 'casa amara', heldBy: ANA, date: THIS_WEEK, week: THIS_WEEK }] });
      expect(w.assignments.lastRow).toBe(1);
    });
  });

  it('reaches the app as a BackendError carrying the held items, with their week', async () => {
    const w = createWorld();
    w.assignments.writeText(['2026-03-10', ANA, CASA.name, 'Not Shared', CASA.id]);

    const failure = await w
      .app('maria')
      .tracker.saveQueues(NEXT_WEEK, [{ assignedTo: JAN, items: [{ propertyName: CASA.name, propertyId: CASA.id }] }])
      .catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(BackendError);
    expect(failure).toMatchObject({
      code: 'held',
      message: 'Casa Amara is already with Ana Reyes. Remove it from their queue first.',
      held: [{ propertyName: CASA.name, propertyId: CASA.id, heldBy: ANA, date: '2026-03-10', week: THIS_WEEK }],
    });
  });
});

// ------------------------------------------------------------------ the week a save names (v6)

describe('the week of saveQueue and saveQueues', () => {
  const items = [{ property: CASA.name }];
  const queues = [{ assignedTo: JAN, items: [{ propertyName: CASA.name }] }];

  it.each([
    ['saveQueue', { assignedTo: JAN, items }],
    ['saveQueues', { queues }],
  ] as const)('%s refuses a week that is not a Monday, and writes nothing', (action, fields) => {
    for (const week of ['2026-03-10', '2026-03-14', '2026-03-15', '2026-02-30', '9 Mar', '3/9/2026']) {
      const w = createWorld();
      expect(w.call('maria', action, { ...fields, week }), week).toMatchObject({ ok: false, error: 'bad-week' });
      expect(w.assignments.lastRow).toBe(1);
    }
  });

  it.each([
    ['saveQueue', { assignedTo: JAN, items }],
    ['saveQueues', { queues }],
  ] as const)('%s reads a date, as an older app sends it, as its week: a weekend as the next one', (action, fields) => {
    for (const [date, week] of [
      ['2026-03-11', THIS_WEEK],
      ['2026-03-13', THIS_WEEK],
      ['2026-03-14', NEXT_WEEK],
      ['2026-03-15', NEXT_WEEK],
      // Across a month boundary: Saturday 28 Feb and Sunday 1 Mar are the week of 2 Mar.
      ['2026-02-28', LAST_WEEK],
      ['2026-04-02', '2026-03-30'],
    ] as const) {
      const w = createWorld();
      expect(w.call('maria', action, { ...fields, date }), date).toEqual({ ok: true, saved: 1 });
      expect(w.assignments.show()[1]![0], date).toBe(week);
    }
  });

  it('takes `week` over `date` when both are sent', () => {
    const w = createWorld();
    expect(w.call('maria', 'saveQueues', { week: NEXT_WEEK, date: '2026-03-10', queues })).toEqual({ ok: true, saved: 1 });
    expect(w.assignments.show()[1]![0]).toBe(NEXT_WEEK);
  });

  it('refuses a request with neither, and a date that is not a day', () => {
    const w = createWorld();
    expect(w.call('maria', 'saveQueues', { queues })).toMatchObject({ ok: false, error: 'missing: week' });
    expect(w.call('maria', 'saveQueue', { assignedTo: JAN, items })).toMatchObject({ ok: false, error: 'missing: week' });
    expect(w.call('maria', 'saveQueues', { date: '2026-02-30', queues })).toMatchObject({ ok: false, error: 'bad-date' });
    expect(w.assignments.lastRow).toBe(1);
  });

  it('is sent by the app\'s client as the Monday of whatever day it is given', async () => {
    const w = createWorld();
    const tracker = w.app('maria').tracker;

    await expect(tracker.saveQueue('2026-03-15', JAN, [{ propertyName: CASA.name }])).resolves.toBe(1);
    await expect(tracker.saveQueues(THIS_WEEK, [{ assignedTo: ANA, items: [{ propertyName: TOWER.name }] }])).resolves.toBe(1);
    expect(w.assignments.show().slice(1).map((r) => r[0])).toEqual([NEXT_WEEK, THIS_WEEK]);
  });
});

// ------------------------------------------------------------------ the assignments reply (v6)

describe('the assignments reply', () => {
  it('gives each row its week, and its Date as written: old daily rows read as their week', async () => {
    const w = createWorld();
    w.assignments.writeText(
      [THIS_WEEK, JAN, 'A', 'Not Shared', ''],
      ['2026-03-11', JAN, 'B', 'Posted', ''],
      ['2026-03-15', JAN, 'C', 'To post', ''],
      ['2026-02-28', JAN, 'D', 'Pending', ''],
      ['3/31/2026', JAN, 'E', 'Not Shared', ''],
      ['someday', JAN, 'F', 'Not Shared', ''],
    );

    const rows = w.call('jan', 'assignments')['assignments'] as { date: string; week: string }[];
    expect(rows.map((r) => [r.date, r.week])).toEqual([
      [THIS_WEEK, THIS_WEEK],
      ['2026-03-11', THIS_WEEK],
      ['2026-03-15', NEXT_WEEK],
      ['2026-02-28', LAST_WEEK],
      ['3/31/2026', '2026-03-30'],
      ['someday', ''],
    ]);

    const read = await w.app('jan').tracker.assignments();
    expect(read.map((r) => [r.date, r.week])).toEqual([
      [THIS_WEEK, THIS_WEEK],
      ['2026-03-11', THIS_WEEK],
      ['2026-03-15', NEXT_WEEK],
      ['2026-02-28', LAST_WEEK],
      ['2026-03-31', '2026-03-30'],
      ['', ''],
    ]);
  });
});
