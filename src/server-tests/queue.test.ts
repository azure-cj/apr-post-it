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
    const item = { date: '2026-03-09', assignedTo: 'Jan Dela Cruz', propertyName: 'Casa Amara', propertyId: '', status: 'Not Shared' } as const;

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

  it('writes the status as text, and only a word it knows: anything else is Not Shared', () => {
    const w = createWorld();
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'To post', CASA.id]);
    w.call('maria', 'setStatus', { property: CASA.name, propertyId: CASA.id, assignedTo: 'Jan Dela Cruz', status: '=1+1' });

    expect(w.assignments.row(2)[3]).toBe('Not Shared');
    expect(w.assignments.formats(2)[3]).toBe('@');
  });
});

describe('setStatus Posted: the post goes live with the queue item', () => {
  const pendingPost = (date: string, title: string, by: string, id: string, link = LINK) =>
    [date, title, 'Group post', '9:15', 'Pending', 'APG Main', link, by, id];

  it('marks the assignee\'s newest Pending post of the property as Posted, and keeps its link', () => {
    const w = createWorld();
    w.posts.type(
      pendingPost('2026-02-01', 'Casa Amara', 'Jan Dela Cruz', CASA.id, 'https://www.facebook.com/old'),
      pendingPost('2026-03-09', 'Casa Amara', 'Jan Dela Cruz', CASA.id),
    );
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'Pending', CASA.id]);

    expect(w.call('jan', 'setStatus', { property: CASA.name, propertyId: CASA.id, assignedTo: 'Jan Dela Cruz', status: 'Posted' })).toEqual({ ok: true });

    expect(w.assignments.row(2)[3]).toBe('Posted');
    // The older one was an earlier post the group admin never approved.
    expect(w.posts.row(2)[4]).toBe('Pending');
    expect(w.posts.row(3).slice(4, 8)).toEqual(['Posted', 'APG Main', LINK, 'Jan Dela Cruz']);
  });

  it('matches by id first, then by name as the app normalises it', () => {
    const w = createWorld();
    w.posts.type(
      pendingPost('2026-03-09', 'Casa Amara (renamed)', 'Jan Dela Cruz', CASA.id),
      pendingPost('2026-03-09', 'VERDANT HILLS, Lot 9', 'Jan Dela Cruz', ''),
      pendingPost('2026-03-09', 'Casa Amara', 'Jan Dela Cruz', 'F-another-casa'),
    );
    w.assignments.type(
      ['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'Pending', CASA.id],
      ['2026-03-09', 'Jan Dela Cruz', 'Verdant Hills Lot 9', 'Pending', ''],
    );

    w.call('jan', 'setStatus', { property: CASA.name, propertyId: CASA.id, assignedTo: 'Jan Dela Cruz', status: 'Posted' });
    w.call('jan', 'setStatus', { property: 'Verdant Hills Lot 9', assignedTo: 'Jan Dela Cruz', status: 'Posted' });

    expect(w.posts.show().slice(1).map((r) => r[4])).toEqual(['Posted', 'Posted', 'Pending']);
  });

  it('touches only the assignee\'s post; an intern cannot reach another\'s, an admin can', () => {
    const w = createWorld();
    w.posts.type(
      pendingPost('2026-03-09', 'Casa Amara', 'Ana Reyes', CASA.id),
      pendingPost('2026-03-09', 'Casa Amara', 'Jan Dela Cruz', CASA.id),
    );
    w.assignments.type(
      ['2026-03-09', 'Ana Reyes', 'Casa Amara', 'Pending', CASA.id],
      ['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'Pending', CASA.id],
    );

    expect(w.call('jan', 'setStatus', { property: CASA.name, propertyId: CASA.id, assignedTo: 'Ana Reyes', status: 'Posted' })).toMatchObject({
      ok: false,
      error: 'forbidden',
    });
    expect(w.posts.show().slice(1).map((r) => r[4])).toEqual(['Pending', 'Pending']);

    w.call('jan', 'setStatus', { property: CASA.name, propertyId: CASA.id, assignedTo: 'Jan Dela Cruz', status: 'Posted' });
    expect(w.posts.show().slice(1).map((r) => r[4])).toEqual(['Pending', 'Posted']);

    w.call('maria', 'setStatus', { property: CASA.name, propertyId: CASA.id, assignedTo: 'Ana Reyes', status: 'Posted' });
    expect(w.posts.show().slice(1).map((r) => r[4])).toEqual(['Posted', 'Posted']);
  });

  it('leaves the posts alone for any other status, or when no queue item matched', () => {
    const w = createWorld();
    w.posts.type(pendingPost('2026-03-09', 'Casa Amara', 'Jan Dela Cruz', CASA.id));
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'To post', CASA.id]);

    w.call('jan', 'setStatus', { property: CASA.name, propertyId: CASA.id, assignedTo: 'Jan Dela Cruz', status: 'Pending' });
    expect(w.posts.row(2)[4]).toBe('Pending');

    expect(w.call('jan', 'setStatus', { property: TOWER.name, propertyId: TOWER.id, assignedTo: 'Jan Dela Cruz', status: 'Posted' })).toMatchObject({
      error: 'notfound',
    });
    expect(w.posts.row(2)[4]).toBe('Pending');
  });

  it('is still ok for a queue item with no post logged', () => {
    const w = createWorld();
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'To post', CASA.id]);

    expect(w.call('jan', 'setStatus', { property: CASA.name, propertyId: CASA.id, assignedTo: 'Jan Dela Cruz', status: 'Posted' })).toEqual({ ok: true });
    expect(w.posts.lastRow).toBe(1);
  });

  it('shows the post as Posted to the app on its next read', async () => {
    const w = createWorld();
    w.logPost('jan', CASA, { status: 'Pending' });
    const app = w.app('jan');
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'Pending', CASA.id]);
    const [queued] = await app.tracker.assignments();
    await app.tracker.setStatus(queued!, 'Posted');

    expect((await app.tracker.posts()).map((p) => p.status)).toEqual(['Posted']);
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

  it("completes an admin's own post, not someone else's newer one of the listing (D31)", async () => {
    const w = createWorld();
    w.assignments.type(['2026-03-09', 'Maria Santos', 'Casa Amara', 'Not Shared', CASA.id], ['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'Not Shared', CASA.id]);
    w.logPost('maria', CASA, { status: 'Pending' });   // posts/1, row 2
    w.logPost('jan', CASA, { status: 'Pending' });     // posts/2, row 3
    const app = w.app('maria');
    const mine = (await app.tracker.posts()).find((p) => p.postedBy === 'Maria Santos')!;

    // Approved: the link it was logged with.
    await expect(app.tracker.addLink(mine, mine.postLink)).resolves.toMatchObject({ status: 'Posted' });
    expect(w.posts.row(2)[4]).toBe('Posted');
    expect([w.posts.row(3)[4], w.posts.row(3)[6]]).toEqual(['Pending', 'https://www.facebook.com/groups/apg/posts/2/']);
    expect([w.assignments.row(2)[3], w.assignments.row(3)[3]]).toEqual(['Posted', 'Pending']);
  });

  it("gives an admin's old linkless post the new link, and refuses someone else's link for it (D31)", () => {
    const w = createWorld();
    w.posts.type(
      ['2026-03-05', 'Casa Amara', 'Group post', '9:15', 'Pending', 'APG Main', '', 'Maria Santos', CASA.id],
      // Jan's of the same listing, with its link: not hers to complete.
      ['2026-03-06', 'Casa Amara', 'Group post', '9:15', 'Pending', 'APG Main', LINK, 'Jan Dela Cruz', CASA.id],
    );
    const mine = { property: CASA.name, propertyId: CASA.id, postedBy: 'Maria Santos' };

    expect(w.call('maria', 'addLink', { ...mine, postLink: LINK })).toMatchObject({ ok: false, error: 'link-taken' });
    expect(w.posts.row(3)[4]).toBe('Pending');
    expect(w.call('maria', 'addLink', { ...mine, postLink: 'https://www.facebook.com/groups/apg/posts/9/' })).toEqual({ ok: true, row: 2 });
    expect([w.posts.row(3)[4], w.posts.row(3)[6]]).toEqual(['Pending', LINK]);
  });

  it('completes the Pending row that has the link, not a newer one of the same listing', () => {
    const w = createWorld();
    w.logPost('jan', CASA, { status: 'Pending' });   // posts/1, row 2
    w.logPost('jan', CASA, { status: 'Pending' });   // posts/2, row 3

    expect(w.call('jan', 'addLink', { property: CASA.name, propertyId: CASA.id, postLink: LINK })).toEqual({ ok: true, row: 2 });
    expect(w.posts.row(2)[4]).toBe('Posted');
    expect([w.posts.row(3)[4], w.posts.row(3)[6]]).toEqual(['Pending', 'https://www.facebook.com/groups/apg/posts/2/']);
  });

  it('knows the post by any copy of its link', () => {
    const w = createWorld();
    w.logPost('jan', CASA, { status: 'Pending' });   // posts/1, row 2
    w.logPost('jan', CASA, { status: 'Pending' });   // posts/2, row 3
    const copy = 'https://m.facebook.com/groups/apg/permalink/1/?mibextid=abc';

    expect(w.call('jan', 'addLink', { property: CASA.name, propertyId: CASA.id, postLink: copy })).toEqual({ ok: true, row: 2 });
    expect([w.posts.row(3)[4], w.posts.row(3)[6]]).toEqual(['Pending', 'https://www.facebook.com/groups/apg/posts/2/']);
  });

  it('refuses a second Approved once the first was saved, rather than put its link on another post', () => {
    const w = createWorld();
    w.logPost('jan', CASA, { status: 'Pending' });   // posts/1, row 2
    w.logPost('jan', CASA, { status: 'Pending' });   // posts/2, row 3
    const approve = { property: CASA.name, propertyId: CASA.id, postLink: LINK };

    expect(w.call('jan', 'addLink', approve)).toEqual({ ok: true, row: 2 });
    // Its answer lost, Approved again: the post is in already.
    expect(w.call('jan', 'addLink', approve)).toMatchObject({ ok: false, error: 'link-taken' });
    expect([w.posts.row(3)[4], w.posts.row(3)[6]]).toEqual(['Pending', 'https://www.facebook.com/groups/apg/posts/2/']);
  });

  it('moves the item of the queue the post was made in, not a later queue\'s', () => {
    const w = createWorld();
    w.assignments.type(
      ['2026-03-02', 'Jan Dela Cruz', 'Casa Amara', 'Pending', CASA.id],   // last week's queue
      ['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'Pending', CASA.id],   // this week's
    );
    w.posts.type(
      ['2026-03-03', 'Casa Amara', 'Group post', '9:15', 'Pending', 'APG Main', LINK, 'Jan Dela Cruz', CASA.id],
      ['2026-03-09', 'Casa Amara', 'Group post', '9:15', 'Pending', 'APG Main', 'https://www.facebook.com/groups/apg/posts/2/', 'Jan Dela Cruz', CASA.id],
    );

    expect(w.call('jan', 'addLink', { property: CASA.name, propertyId: CASA.id, postLink: LINK })).toEqual({ ok: true, row: 2 });
    expect(w.assignments.show().slice(1).map((r) => r[3])).toEqual(['Posted', 'Pending']);
    expect(
      w.call('jan', 'addLink', { property: CASA.name, propertyId: CASA.id, postLink: 'https://www.facebook.com/groups/apg/posts/2/' }),
    ).toEqual({ ok: true, row: 3 });
    expect(w.assignments.show().slice(1).map((r) => r[3])).toEqual(['Posted', 'Posted']);
  });

  it('completes the lowest Pending row, and finds none once it is done', () => {
    const w = createWorld();
    w.logPost('jan', TOWER, { status: 'Pending' });

    expect(w.call('jan', 'addLink', { property: TOWER.name, propertyId: TOWER.id, postLink: LINK })).toEqual({ ok: true, row: 2 });
    expect(w.call('jan', 'addLink', { property: TOWER.name, propertyId: TOWER.id, postLink: LINK })).toMatchObject({
      ok: false,
      error: 'notfound',
    });
  });
});

describe('the queue item a post moves', () => {
  // The harness's clock: Monday 2026-03-09, so this week's queue is the 9th's.
  const item = (week: string, status: string) => [week, 'Jan Dela Cruz', 'Casa Amara', status, CASA.id];

  it("moves this queue's item, not a later queue's saved below it", () => {
    const w = createWorld();
    w.assignments.type(item('2026-03-09', 'Not Shared'), item('2026-03-16', 'Not Shared'));

    w.logPost('jan', CASA, { status: 'Pending' });
    expect(w.assignments.show().slice(1).map((r) => r[3])).toEqual(['Pending', 'Not Shared']);
  });

  it("moves no other queue's item when this queue's is already Posted", () => {
    const w = createWorld();
    w.assignments.type(item('2026-03-09', 'Posted'), item('2026-03-16', 'Not Shared'));

    w.logPost('jan', CASA, { status: 'Posted' });
    expect(w.assignments.show().slice(1).map((r) => r[3])).toEqual(['Posted', 'Not Shared']);
  });

  it('moves the lowest open item, as before, when the day is in none of their queues', () => {
    const w = createWorld();
    w.assignments.type(item('2026-03-02', 'Not Shared'), item('2026-03-16', 'Not Shared'));

    w.logPost('jan', CASA, { status: 'Pending' });
    expect(w.assignments.show().slice(1).map((r) => r[3])).toEqual(['Not Shared', 'Pending']);
  });
});

describe('saveQueue', () => {
  it('replaces one person\'s queue for one week, however its dates were written, and leaves the rest', () => {
    const w = createWorld();
    w.assignments.type(
      ['2026-03-09', 'Jan Dela Cruz', 'Old item, typed', 'To post', ''],
      ['2026-03-09', 'Ana Reyes', 'Ana\'s item', 'To post', ''],
      // A daily row from before v6, in the same week: part of the queue replaced.
      ['2026-03-11', 'Jan Dela Cruz', 'Wednesday\'s item', 'To post', ''],
      // Saturday belongs to the next week: left alone.
      ['2026-03-14', 'Jan Dela Cruz', 'Next week\'s item', 'To post', ''],
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
      ['#date 2026-03-14', 'Jan Dela Cruz', 'Next week\'s item', 'To post', ''],
      ['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'Not Shared', CASA.id],
      // The id found in the directory by name; the name kept as text.
      ['2026-03-09', 'Jan Dela Cruz', '1201', 'Not Shared', TOWER.id],
    ]);
  });
});
