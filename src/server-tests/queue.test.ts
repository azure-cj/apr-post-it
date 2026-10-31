/**
 * Changing rows that already exist: a queue item's status (setStatus), a
 * Pending post's link (addLink), and a whole queue (saveQueue). Each must find
 * the one row it means, and say so when there is none.
 */

import { describe, expect, it } from 'vitest';
import { BackendError } from '../core/backend';
import { CASA, createWorld, LOT_9, TOWER } from './world';

const LINK = 'https://www.facebook.com/groups/apg/posts/1/';

describe('setStatus (bug 4)', () => {
  it('says notfound when no queue item matched, rather than ok', () => {
    const w = createWorld();
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'To post', CASA.id]);

    const reply = w.call('jan', 'setStatus', { property: 'Verdant Hills Lot 9', assignedTo: 'Jan Dela Cruz', status: 'Pending' });

    expect(reply).toMatchObject({ ok: false, error: 'notfound' });
    expect(reply['message']).toMatch(/no open queue item for Verdant Hills Lot 9 assigned to Jan Dela Cruz/);
    expect(w.assignments.row(2)[3]).toBe('To post');
  });

  it('reaches the app as notfound, in the server\'s words', async () => {
    const w = createWorld();
    const item = { date: '2026-03-09', assignedTo: 'Jan Dela Cruz', propertyName: 'Casa Amara', propertyId: '', status: 'To post' } as const;

    const failure = await w.app('jan').tracker.setStatus(item, 'Pending').catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(BackendError);
    expect(failure).toMatchObject({ code: 'notfound', message: expect.stringMatching(/^There is no open queue item/) });
  });

  it('moves the item it names, not the lowest row that has no id', () => {
    const w = createWorld();
    w.assignments.type(
      ['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'To post', ''],
      ['2026-03-09', 'Jan Dela Cruz', 'Sunrise Homes Lot 3', 'To post', ''],
    );

    // Not in the directory, so there is no id to match by: the name decides.
    expect(w.call('jan', 'setStatus', { property: 'Casa Amara', assignedTo: 'Jan Dela Cruz', status: 'Pending' })).toEqual({ ok: true });
    expect(w.assignments.show().slice(1).map((r) => [r[2], r[3]])).toEqual([
      ['Casa Amara', 'Pending'],
      ['Sunrise Homes Lot 3', 'To post'],
    ]);
  });

  it('matches by id when both have one, by name as the app spells it otherwise', () => {
    const w = createWorld();
    w.assignments.type(
      ['2026-03-09', 'Jan Dela Cruz', 'Casa Amara (old name)', 'To post', CASA.id],
      ['2026-03-09', 'Jan Dela Cruz', 'VERDANT HILLS, Lot 9', 'To post', ''],
    );

    expect(w.call('jan', 'setStatus', { property: CASA.name, propertyId: CASA.id, assignedTo: 'Jan Dela Cruz', status: 'Pending' })).toEqual({
      ok: true,
    });
    expect(w.call('jan', 'setStatus', { property: LOT_9.name, assignedTo: 'Jan Dela Cruz', status: 'Pending' })).toEqual({ ok: true });
    expect(w.assignments.show().slice(1).map((r) => r[3])).toEqual(['Pending', 'Pending']);
  });

  it('never reopens an item already posted', () => {
    const w = createWorld();
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'Posted', CASA.id]);

    expect(w.call('maria', 'setStatus', { property: CASA.name, propertyId: CASA.id, assignedTo: 'Jan Dela Cruz', status: 'To post' })).toMatchObject({
      ok: false,
      error: 'notfound',
    });
  });

  it('writes the status as text', () => {
    const w = createWorld();
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'To post', CASA.id]);
    w.call('maria', 'setStatus', { property: CASA.name, propertyId: CASA.id, assignedTo: 'Jan Dela Cruz', status: '=1+1' });

    expect(w.assignments.row(2)[3]).toBe('=1+1');
  });
});

describe('addLink (bug 5)', () => {
  /** A Pending post logged before the tracker had a PropertyId column: the cell is blank. */
  function withOldPendingRow() {
    const w = createWorld();
    w.posts.type(['2026-03-05', 'Casa Amara', 'Group post', '9:15', 'Pending', 'APG Main', '', 'Jan Dela Cruz', '']);
    w.assignments.type(['2026-03-05', 'Jan Dela Cruz', 'Casa Amara', 'Pending', '']);
    return w;
  }

  it('finds a Pending row with no PropertyId by its title, as the app sends it', async () => {
    const w = withOldPendingRow();
    const app = w.app('jan');
    const [pending] = await app.tracker.posts();

    // The app sends no id for a row that has none; the server finds the
    // listing's id in the directory, and must still match the row by title.
    await expect(app.tracker.addLink(pending!, LINK)).resolves.toMatchObject({ status: 'Posted', postLink: LINK });
    expect(w.posts.row(2).slice(4, 7)).toEqual(['Posted', 'APG Main', LINK]);
    expect(w.assignments.row(2)[3]).toBe('Posted');
  });

  it('finds it when the request carries the listing\'s id too', () => {
    const w = withOldPendingRow();

    expect(w.call('jan', 'addLink', { property: CASA.name, propertyId: CASA.id, postLink: LINK })).toEqual({ ok: true, row: 2 });
  });

  it('matches the title as the app spells names, not character for character', () => {
    const w = withOldPendingRow();

    expect(w.call('jan', 'addLink', { property: 'CASA AMARA', postLink: LINK })).toEqual({ ok: true, row: 2 });
  });

  it('still tells listings apart by id when the row has one', () => {
    const w = createWorld();
    w.posts.type(['2026-03-05', 'Casa Amara', 'Group post', '9:15', 'Pending', 'APG Main', '', 'Jan Dela Cruz', 'F-another-casa']);

    expect(w.call('jan', 'addLink', { property: CASA.name, propertyId: CASA.id, postLink: LINK })).toMatchObject({
      ok: false,
      error: 'notfound',
    });
  });

  it('will not complete another intern\'s post, though a manager may', () => {
    const w = withOldPendingRow();

    expect(w.call('ana', 'addLink', { property: CASA.name, postLink: LINK })).toMatchObject({ ok: false, error: 'notfound' });
    expect(w.call('maria', 'addLink', { property: CASA.name, postLink: LINK })).toEqual({ ok: true, row: 2 });
  });

  it('completes the lowest Pending row, and finds none once it is done', () => {
    const w = createWorld();
    w.logPost('jan', TOWER, { postLink: '' });

    expect(w.call('jan', 'addLink', { property: TOWER.name, propertyId: TOWER.id, postLink: LINK })).toEqual({ ok: true, row: 2 });
    expect(w.call('jan', 'addLink', { property: TOWER.name, propertyId: TOWER.id, postLink: LINK })).toMatchObject({
      ok: false,
      error: 'notfound',
    });
  });
});

describe('saveQueue', () => {
  it('replaces one person\'s queue for one date, however its dates were written, and leaves the rest', () => {
    const w = createWorld();
    w.assignments.type(
      ['2026-03-09', 'Jan Dela Cruz', 'Old item, typed', 'To post', ''],
      ['2026-03-09', 'Ana Reyes', 'Ana\'s item', 'To post', ''],
      ['2026-03-10', 'Jan Dela Cruz', 'Tomorrow\'s item', 'To post', ''],
    );
    w.assignments.writeText(['2026-03-09', 'Jan Dela Cruz', 'Old item, as text', 'To post', '']);

    const reply = w.call('maria', 'saveQueue', {
      date: '2026-03-09',
      assignedTo: 'Jan Dela Cruz',
      items: [{ property: CASA.name, propertyId: CASA.id }, { property: '1201' }],
    });

    expect(reply).toEqual({ ok: true, saved: 2 });
    expect(w.assignments.show().slice(1)).toEqual([
      ['#date 2026-03-09', 'Ana Reyes', 'Ana\'s item', 'To post', ''],
      ['#date 2026-03-10', 'Jan Dela Cruz', 'Tomorrow\'s item', 'To post', ''],
      ['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'To post', CASA.id],
      // The id found in the directory by name; the name kept as text.
      ['2026-03-09', 'Jan Dela Cruz', '1201', 'To post', TOWER.id],
    ]);
  });
});
