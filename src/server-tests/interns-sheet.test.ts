/**
 * The Posts tab records what the interns' own "POSTING TRACKER - INTERNS"
 * sheet does, with its column names, words and formats: Date, Property type,
 * Property title, FB account name, Link, Time posted, Share posting, then our
 * Posted by and Property ID. A tab with the older headers keeps working, and a
 * queue item not posted yet is "Not Shared", the interns' word, with the older
 * "To post" read as the same thing.
 */

import { describe, expect, it } from 'vitest';
import { propertyType } from '../core/records';
import { CASA, createWorld, LOT_9, TOWER, type Listing } from './world';

const LINK = 'https://www.facebook.com/groups/apg/posts/1/';
const NEW_HEADERS = [
  'Date', 'Property type', 'Property title', 'FB account name', 'Link', 'Time posted', 'Share posting', 'Posted by', 'Property ID',
];

/** A world whose Posts tab does not exist yet, so the script creates it. */
function freshTabs() {
  const w = createWorld({ now: '2026-10-26 10:23' });
  w.project.configure({ POSTS_TAB: 'Posts (new)', ASSIGNMENTS_TAB: 'Assignments (new)' });
  return w;
}

describe('a new Posts tab', () => {
  it('gets the interns\' sheet\'s headers, in its order, then Posted by and Property ID', () => {
    const w = freshTabs();
    expect(w.logPost('jan', CASA)).toMatchObject({ ok: true });

    const tab = w.tracker.sheet('Posts (new)');
    expect(tab.row(1)).toEqual(NEW_HEADERS);
    expect(tab.row(2)).toEqual([
      '2026-10-26', 'Condo / House and Lot', 'Casa Amara', 'APG Main', 'https://www.facebook.com/groups/apg/posts/1/', '10:23 AM',
      'Posted', 'Jan Dela Cruz', CASA.id,
    ]);
  });

  it('is read back in the app\'s own formats: an ISO date and an HH:mm time', async () => {
    const w = freshTabs();
    w.project.clock.set('2026-10-26 14:05');
    w.logPost('jan', TOWER, { status: 'Pending' });

    expect(await w.app('maria').tracker.posts()).toEqual([
      {
        date: '2026-10-26',
        time: '14:05',
        type: 'Office Space',
        title: '1201',
        status: 'Pending',
        fbAccount: 'APG Main',
        postLink: LINK,
        postedBy: 'Jan Dela Cruz',
        propertyId: TOWER.id,
      },
    ]);
  });

  it('works for the cooldown, addLink and setStatus as the old one did', () => {
    const w = freshTabs();
    w.logPost('jan', CASA, { status: 'Pending' });
    expect(w.logPost('ana', CASA)).toMatchObject({ ok: false, error: 'cooldown' });
    expect(w.call('jan', 'addLink', { property: CASA.name, propertyId: CASA.id, postLink: LINK })).toMatchObject({ ok: true });
    expect(w.tracker.sheet('Posts (new)').row(2)[6]).toBe('Posted');
  });

  it('a new Assignments tab writes Not Shared for a slot not posted yet', () => {
    const w = freshTabs();
    w.call('maria', 'saveQueues', { date: '2026-10-26', queues: [{ assignedTo: 'Jan Dela Cruz', items: [{ propertyName: CASA.name }] }] });

    expect(w.tracker.sheet('Assignments (new)').show()).toEqual([
      ['Date', 'Assigned To', 'Property', 'Status', 'PropertyId'],
      ['2026-10-26', 'Jan Dela Cruz', 'Casa Amara', 'Not Shared', CASA.id],
    ]);
  });
});

describe('a Posts tab with the old headers', () => {
  it('is still read, every column found by its older name', () => {
    const w = createWorld();
    // world.ts's tab: Date, Title, Type, Time, Status, FB Account, Post Link, Posted By, PropertyId, Notes.
    w.posts.writeText(['2026-03-02', 'Casa Amara', 'CONDO', '14:30', 'Pending', 'APG Main', LINK, 'Jan Dela Cruz', CASA.id, 'x']);

    expect(w.call('maria', 'posts')['posts']).toEqual([
      {
        date: '2026-03-02', type: 'CONDO', title: 'Casa Amara', time: '14:30', status: 'Pending',
        fbAccount: 'APG Main', postLink: LINK, postedBy: 'Jan Dela Cruz', propertyId: CASA.id,
      },
    ]);
  });

  it('is written into by those names, and keeps its own order', () => {
    const w = createWorld({ now: '2026-03-09 09:05' });
    w.logPost('jan', LOT_9);

    expect(w.posts.row(1)[0]).toBe('Date');
    expect(w.posts.row(2)).toEqual(['2026-03-09', LOT_9.name, 'Lot', '9:05 AM', 'Posted', 'APG Main', LINK, 'Jan Dela Cruz', LOT_9.id, '']);
  });

  it('matches the new names in any case, and a mix of old and new', () => {
    const w = createWorld({ now: '2026-03-09 21:40' });
    const tab = w.tracker.addSheet('Mixed', ['date', 'PROPERTY TITLE', 'Type', 'fb account name', 'Post Link', 'TIME POSTED', 'Status', 'Posted By', 'PropertyId']);
    w.project.configure({ POSTS_TAB: 'Mixed' });
    w.logPost('jan', CASA);

    expect(tab.row(2)).toEqual(['2026-03-09', 'Casa Amara', 'Condo / House and Lot', 'APG Main', LINK, '9:40 PM', 'Posted', 'Jan Dela Cruz', CASA.id]);
  });
});

describe('Time posted', () => {
  it.each([
    ['2026-03-09 00:00', '12:00 AM', '00:00'],
    ['2026-03-09 00:15', '12:15 AM', '00:15'],
    ['2026-03-09 09:05', '9:05 AM', '09:05'],
    ['2026-03-09 12:00', '12:00 PM', '12:00'],
    ['2026-03-09 12:59', '12:59 PM', '12:59'],
    ['2026-03-09 13:00', '1:00 PM', '13:00'],
    ['2026-03-09 23:59', '11:59 PM', '23:59'],
  ])('at %s is written "%s" and read back as %s', async (now, written, read) => {
    const w = freshTabs();
    w.project.clock.set(now);
    expect(w.logPost('jan', CASA)).toMatchObject({ time: read });
    expect(w.tracker.sheet('Posts (new)').row(2)[5]).toBe(written);
    expect(w.call('maria', 'posts')['posts']).toMatchObject([{ time: read }]);
    expect((await w.app('maria').tracker.posts())[0]!.time).toBe(read);
  });

  it.each([
    ['10:23 AM', '10:23'],
    ['10:23 am', '10:23'],
    ['2:05PM', '14:05'],
    ['2:05 p.m.', '14:05'],
    ['14:30', '14:30'],
    ['9:05', '09:05'],
    ['12:01 AM', '00:01'],
  ])('typed into a plain-text cell as "%s" reads as %s', (typed, read) => {
    const w = createWorld();
    w.posts.writeText(['2026-03-02', 'Casa Amara', '', typed, 'Posted', '', LINK, 'Jan Dela Cruz', '', '']);
    expect(w.call('maria', 'posts')['posts']).toMatchObject([{ time: read }]);
  });

  it('that is not a time is given back as it is, for the app to leave blank', async () => {
    const w = createWorld();
    w.posts.writeText(['2026-03-02', 'Casa Amara', '', 'morning', 'Posted', '', LINK, 'Jan Dela Cruz', '', '']);
    expect(w.call('maria', 'posts')['posts']).toMatchObject([{ time: 'morning' }]);
    expect((await w.app('maria').tracker.posts())[0]!.time).toBe('');
  });
});

describe('Property type', () => {
  const CATEGORIES: readonly [string, string][] = [
    ['WAREHOUSE', 'Warehouse'],
    ['COMMERCIAL SPACE', 'Commercial Space'],
    ['OFFICE SPACE', 'Office Space'],
    ['LOT', 'Lot'],
    ['CONDO / HOUSE AND LOT', 'Condo / House and Lot'],
    ['LOTS FOR SALE', 'Lots for Sale'],
    ['  WAREHOUSE   FOR  LEASE ', 'Warehouse for Lease'],
    ['commercial space', 'Commercial Space'],
    ['PARAÑAQUE OFFICES', 'Parañaque Offices'],
    ['MIXED-USE', 'Mixed-Use'],
    ['Virtual Office for posting', 'Virtual Office for posting'],
    ['Commercial Space', 'Commercial Space'],
    ['', ''],
  ];

  it.each(CATEGORIES)('of the category "%s" is "%s", on the server and in the app alike', (category, type) => {
    const w = createWorld();
    expect(w.project.evaluate(`propertyType_(${JSON.stringify(category)})`)).toBe(type);
    expect(propertyType(category)).toBe(type);
  });

  it('comes from the Directory by folder id, whatever the app sends', () => {
    const w = createWorld();
    expect(w.logPost('jan', TOWER, { type: 'Group post' })).toMatchObject({ ok: true, type: 'Office Space' });
    expect(w.posts.row(2)[2]).toBe('Office Space');
  });

  it('falls back to the category the app sent when the Directory has no such folder', () => {
    const elsewhere: Listing = { ...CASA, id: 'F-not-in-directory', name: 'Somewhere New' };
    const w = createWorld();
    expect(w.logPost('jan', elsewhere, { type: 'COMMERCIAL SPACE' })).toMatchObject({ ok: true, type: 'Commercial Space' });
    expect(w.posts.row(2)[2]).toBe('Commercial Space');
  });

  it('is blank when neither knows', () => {
    const elsewhere: Listing = { ...CASA, id: 'F-not-in-directory', name: 'Somewhere New' };
    const w = createWorld();
    w.logPost('jan', elsewhere);
    expect(w.posts.row(2)[2]).toBe('');
  });
});

describe('Not Shared and To post', () => {
  it.each(['Not Shared', 'To post', 'not shared', 'TO POST'])('a queue item written "%s" is open: logPost and setStatus move it', (word) => {
    const w = createWorld();
    w.assignments.writeText(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', word, CASA.id]);
    w.assignments.writeText(['2026-03-09', 'Jan Dela Cruz', '1201', word, TOWER.id]);

    w.logPost('jan', CASA, { status: 'Pending' });
    expect(w.call('jan', 'setStatus', { property: TOWER.name, propertyId: TOWER.id, assignedTo: 'Jan Dela Cruz', status: 'Posted' })).toEqual({ ok: true });
    expect(w.assignments.show().slice(1).map((r) => r[3])).toEqual(['Pending', 'Posted']);
  });

  it('setStatus back to "To post", from an older app, writes Not Shared', () => {
    const w = createWorld();
    w.assignments.writeText(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'Pending', CASA.id]);
    expect(w.call('maria', 'setStatus', { property: CASA.name, propertyId: CASA.id, assignedTo: 'Jan Dela Cruz', status: 'To post' })).toEqual({ ok: true });
    expect(w.assignments.row(2)[3]).toBe('Not Shared');
  });

  it('a queue saved with "To post", from an older app, is written Not Shared', () => {
    const w = createWorld();
    w.call('maria', 'saveQueues', {
      date: '2026-03-09',
      queues: [{ assignedTo: 'Jan Dela Cruz', items: [{ propertyName: CASA.name, status: 'To post' }, { propertyName: '1201', status: 'Pending' }] }],
    });
    expect(w.assignments.show().slice(1).map((r) => r[3])).toEqual(['Not Shared', 'Pending']);
  });

  it('both reach the app as Not Shared', async () => {
    const w = createWorld();
    w.assignments.writeText(
      ['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'To post', CASA.id],
      ['2026-03-09', 'Jan Dela Cruz', '1201', 'Not Shared', TOWER.id],
    );
    expect((await w.app('jan').tracker.assignments()).map((a) => a.status)).toEqual(['Not Shared', 'Not Shared']);
  });
});
