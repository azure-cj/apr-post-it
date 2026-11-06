/**
 * v14: a queue runs 1 to 3 weeks of working days from its start, and its
 * rows say so: Date is the start, Due the deadline. Saved on a Friday for 2
 * weeks, it is due the Thursday after next; the weekends don't count. It holds
 * its listings until that deadline, and a person has one queue at a time.
 *
 * The harness's clock starts on Monday 2026-03-09 10:00, Manila.
 */

import { describe, expect, it } from 'vitest';
import { BackendError } from '../core/backend';
import { periodFrom } from '../core/queues';
import { CASA, createWorld, LOT_9, TOWER } from './world';

const JAN = 'Jan Dela Cruz';
const ANA = 'Ana Reyes';
const FRIDAY = '2026-03-13';
// 2 weeks of working days from Friday 13 Mar: 13, 16–20, 23–26 Mar.
const DUE = '2026-03-26';

describe('queue periods (v14)', () => {
  it('saves a queue from a Friday for 2 weeks: Date its start, Due the Thursday after next, the Due column added', () => {
    const w = createWorld();
    w.project.clock.set('2026-03-13 16:00');
    expect(periodFrom(FRIDAY, 2)).toMatchObject({ key: '2026-03-09', start: FRIDAY, due: DUE });

    const reply = w.call('maria', 'saveQueue', { week: '2026-03-09', start: FRIDAY, due: DUE, assignedTo: JAN, items: [{ property: CASA.name }] });

    expect(reply).toEqual({ ok: true, saved: 1 });
    expect(w.assignments.show()).toEqual([
      ['Date', 'Assigned To', 'Property', 'Status', 'PropertyId', 'Due'],
      [FRIDAY, JAN, CASA.name, 'Not Shared', CASA.id, DUE],
    ]);
    expect(w.call('jan', 'assignments')['assignments']).toEqual([
      { date: FRIDAY, week: '2026-03-09', due: DUE, assignedTo: JAN, property: CASA.name, status: 'Not Shared', propertyId: CASA.id },
    ]);
  });

  it('holds its listings until the deadline, across the weekend and the week after, then releases them', () => {
    const w = createWorld();
    w.project.clock.set('2026-03-13 16:00');
    w.call('maria', 'saveQueue', { start: FRIDAY, due: DUE, assignedTo: JAN, items: [{ property: CASA.name }] });

    // The week after: a one-week queue would be over, this one is not.
    w.project.clock.set('2026-03-23 09:00');
    expect(w.call('maria', 'saveQueue', { week: '2026-03-23', assignedTo: ANA, items: [{ property: CASA.name }] })).toMatchObject({
      ok: false,
      error: 'held',
      held: [{ heldBy: JAN, date: FRIDAY, week: '2026-03-09' }],
    });

    // The day after the deadline: Missed, and free.
    w.project.clock.set('2026-03-27 09:00');
    expect(w.call('maria', 'saveQueue', { week: '2026-03-23', assignedTo: ANA, items: [{ property: CASA.name }] })).toEqual({ ok: true, saved: 1 });
  });

  it('keeps one queue at a time: refuses one that shares a working day with another of theirs, and writes nothing', () => {
    const w = createWorld();
    w.call('maria', 'saveQueue', { start: '2026-03-09', due: '2026-03-20', assignedTo: JAN, items: [{ property: CASA.name }] });
    const before = w.assignments.show();

    const reply = w.call('maria', 'saveQueue', { start: '2026-03-16', due: '2026-03-20', assignedTo: JAN, items: [{ property: TOWER.name }] });

    expect(reply).toMatchObject({ ok: false, error: 'overlap', person: JAN, start: '2026-03-09', due: '2026-03-20' });
    expect(String(reply['message'])).toContain('One queue at a time');
    expect(w.assignments.show()).toEqual(before);
    // Starting after its deadline is fine, and so is someone else.
    expect(w.call('maria', 'saveQueue', { start: '2026-03-23', due: '2026-03-27', assignedTo: JAN, items: [{ property: TOWER.name }] })).toEqual({ ok: true, saved: 1 });
    expect(w.call('maria', 'saveQueue', { start: '2026-03-16', due: '2026-03-20', assignedTo: ANA, items: [{ property: LOT_9.name }] })).toEqual({ ok: true, saved: 1 });
  });

  it('lengthens a queue in place: the same start, a later deadline, its rows replaced', () => {
    const w = createWorld();
    w.call('maria', 'saveQueue', { start: '2026-03-09', due: '2026-03-13', assignedTo: JAN, items: [{ property: CASA.name }] });

    expect(w.call('maria', 'saveQueue', { start: '2026-03-09', due: '2026-03-27', assignedTo: JAN, items: [{ property: CASA.name }] })).toEqual({ ok: true, saved: 1 });
    expect(w.assignments.show().slice(1)).toEqual([['2026-03-09', JAN, CASA.name, 'Not Shared', CASA.id, '2026-03-27']]);
  });

  it('lets an app before v14 re-save a queue without losing its dates', () => {
    const w = createWorld();
    w.project.clock.set('2026-03-13 16:00');
    w.call('maria', 'saveQueue', { start: FRIDAY, due: DUE, assignedTo: JAN, items: [{ property: CASA.name }] });

    expect(w.call('maria', 'saveQueue', { week: '2026-03-09', assignedTo: JAN, items: [{ property: CASA.name }, { property: TOWER.name }] })).toEqual({ ok: true, saved: 2 });
    expect(w.assignments.show().slice(1)).toEqual([
      [FRIDAY, JAN, CASA.name, 'Not Shared', CASA.id, DUE],
      [FRIDAY, JAN, TOWER.name, 'Not Shared', TOWER.id, DUE],
    ]);
  });

  it('saves several queues, each with its own dates', () => {
    const w = createWorld();
    const reply = w.call('maria', 'saveQueues', {
      week: '2026-03-09',
      queues: [
        { assignedTo: JAN, start: '2026-03-09', due: '2026-03-20', items: [{ propertyName: CASA.name }] },
        { assignedTo: ANA, start: '2026-03-11', due: '2026-03-17', items: [{ propertyName: TOWER.name }] },
      ],
    });

    expect(reply).toEqual({ ok: true, saved: 2 });
    expect(w.assignments.show().slice(1)).toEqual([
      ['2026-03-09', JAN, CASA.name, 'Not Shared', CASA.id, '2026-03-20'],
      ['2026-03-11', ANA, TOWER.name, 'Not Shared', TOWER.id, '2026-03-17'],
    ]);
  });

  it.each([
    [{ start: '2026-03-14', due: '2026-03-20' }, 'working day'],
    [{ start: '2026-03-09', due: '2026-03-06' }, 'on or after'],
    [{ start: '2026-03-09', due: '2026-04-03' }, '3 weeks at most'],
    [{ start: '2026-03-09' }, 'yyyy-MM-dd'],
  ])('refuses dates it cannot use: %j', (dates, words) => {
    const w = createWorld();
    const reply = w.call('maria', 'saveQueue', { ...dates, assignedTo: JAN, items: [{ property: CASA.name }] });
    expect(reply).toMatchObject({ ok: false, error: 'bad-period' });
    expect(String(reply['message'])).toContain(words);
    expect(w.assignments.lastRow).toBe(1);
  });

  it('reaches the app: saveQueue sends the dates, and an overlap reads as a sentence', async () => {
    const w = createWorld();
    const admin = w.app('maria').tracker;
    await admin.saveQueue('2026-03-09', JAN, [{ propertyName: CASA.name }], { start: '2026-03-09', due: '2026-03-20' });

    const rows = await admin.assignments();
    expect(rows).toEqual([expect.objectContaining({ date: '2026-03-09', week: '2026-03-09', due: '2026-03-20' })]);
    const err = await admin.saveQueue('2026-03-16', JAN, [{ propertyName: TOWER.name }], { start: '2026-03-16', due: '2026-03-20' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err).toMatchObject({ code: 'overlap' });
  });
});
