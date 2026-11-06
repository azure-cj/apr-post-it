/**
 * The tracker, against a scripted `post`. Ports the tracker half of
 * ScriptBackendTests.cs: refusals reach the person as sentences, the sheet's
 * loose dates and times are read, a logged post takes the server's date and
 * name, and the one edit allowed from here is adding a pending post's link.
 */

import { createBackend, type BackendDeps } from './backend';
import { createTracker, readSheetDate, readSheetTime, type LogPostInput } from './tracker';
import { UserFacingError, type Assignment, type PostLogEntry } from './types';

const EXEC = 'https://script.google.com/macros/s/AKfy/exec';

type Wire = Record<string, unknown>;
type Scripted = unknown | ((body: Wire) => unknown);

/** A post that answers from a script — the last reply repeats — and keeps what was sent. */
function scripted(...replies: Scripted[]) {
  const sent: { url: string; body: Wire }[] = [];
  const queue = [...replies];
  const post = async (url: string, body: unknown): Promise<unknown> => {
    const wire = JSON.parse(JSON.stringify(body)) as Wire;
    sent.push({ url, body: wire });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const reply = typeof next === 'function' ? (next as (b: Wire) => unknown)(wire) : next;
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { post, sent };
}

function trackerOver(post: BackendDeps['post'], key = 'testkey', url = EXEC) {
  return createTracker({ backend: createBackend({ post, getConfig: () => ({ url, key }) }) });
}

async function refusal(p: Promise<unknown>): Promise<UserFacingError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(UserFacingError);
    return err as UserFacingError;
  }
  throw new Error('expected a refusal');
}

function entry(over: Partial<PostLogEntry> = {}): PostLogEntry {
  return {
    date: '2026-01-01',
    time: '09:00',
    type: 'Lot',
    title: 'Casa Amara',
    status: 'Posted',
    fbAccount: 'APG Homes',
    postLink: 'https://www.facebook.com/groups/x/posts/1/',
    postedBy: 'Jan Dela Cruz',
    propertyId: '1AbC',
    ...over,
  };
}

function logInput(over: Partial<LogPostInput> = {}): LogPostInput {
  return {
    propertyId: '1AbC',
    propertyName: 'Casa Amara',
    fbAccount: 'APG Homes',
    postLink: 'https://www.facebook.com/groups/x/posts/1/',
    status: 'Posted',
    ...over,
  };
}

function assignment(over: Partial<Assignment> = {}): Assignment {
  return {
    date: '2026-04-02',
    assignedTo: 'Jan Dela Cruz',
    propertyName: 'Casa Amara',
    propertyId: '1AbC',
    status: 'Not Shared',
    ...over,
  };
}

// ------------------------------------------------------------------ refusals reach the person

describe('a refusal', () => {
  it('for a cooldown arrives as the server\'s own sentence', async () => {
    const { post } = scripted({
      ok: false,
      error: 'cooldown',
      lastPosted: '2026-01-01',
      nextAllowed: '2026-01-08',
      message: 'Posted 2 day(s) ago. Next allowed Jan 8.',
    });
    const error = await refusal(trackerOver(post).logPost(logInput()));

    expect(error.message).toBe('Posted 2 day(s) ago. Next allowed Jan 8.');
  });

  it('for an unknown key says what to do about it', async () => {
    const { post } = scripted({ ok: false, error: 'unauthorized' });
    const error = await refusal(trackerOver(post).posts());

    expect(error.message).toContain('key');
  });

  it('for a forbidden action keeps the server\'s wording', async () => {
    const { post } = scripted({ ok: false, error: 'forbidden', message: 'You are not assigned to APG Rentals.' });
    const error = await refusal(trackerOver(post).logPost(logInput({ fbAccount: 'APG Rentals' })));

    expect(error.message).toBe('You are not assigned to APG Rentals.');
  });

  it('as a sign-in page instead of JSON names the real mistake', async () => {
    // The commonest setup error: the web app was deployed without "Anyone" access.
    const { post } = scripted('<!DOCTYPE html><html><body>Sign in</body></html>');
    const error = await refusal(trackerOver(post).posts());

    expect(error.message).toMatch(/redeploy/i);
  });

  it('from a dead connection does not leak the transport\'s exception', async () => {
    const { post } = scripted(new TypeError('no such host'));
    const error = await refusal(trackerOver(post).posts());

    expect(error.message).toContain('connection');
  });

  it('without a url and key comes before calling anything', async () => {
    const { post, sent } = scripted({ ok: true, posts: [] });
    const error = await refusal(trackerOver(post, '', '').posts());

    expect(error.message).toContain('Settings');
    expect(sent).toHaveLength(0);
  });

  it('for a busy lock says to try again', async () => {
    const { post } = scripted({ ok: false, error: 'busy' });
    const error = await refusal(trackerOver(post).setStatus(assignment(), 'Posted'));

    expect(error.message).toBe('Someone else is saving right now. Try again in a moment.');
  });

  it('for an intern\'s queue item that is not theirs keeps the server\'s wording', async () => {
    const { post } = scripted({ ok: false, error: 'forbidden', message: 'That is not your queue item.' });
    const error = await refusal(trackerOver(post).setStatus(assignment({ assignedTo: 'Bea Lim' }), 'Posted'));

    expect(error.message).toBe('That is not your queue item.');
  });
});

describe('the key', () => {
  it('goes in the body, never in a header or the address', async () => {
    const { post, sent } = scripted({ ok: true, posts: [] });
    await trackerOver(post, 's3cret').posts();

    expect(sent[0]!.body['key']).toBe('s3cret');
    expect(sent[0]!.body['action']).toBe('posts');
    expect(sent[0]!.url).not.toContain('s3cret');
  });
});

// ------------------------------------------------------------------ reading

describe('the posts', () => {
  it('map out of the sheet\'s loose date and time formats', async () => {
    const { post } = scripted({
      ok: true,
      posts: [
        {
          date: '2026-01-05', type: 'Lot', title: 'Verdant Hills Lot 7', time: '14:30',
          status: 'Posted', fbAccount: 'APG Homes', postLink: 'https://fb.com/1', postedBy: 'Jan Dela Cruz',
        },
        {
          date: '2026-01-06T00:00:00.000Z', type: 'Condo', title: 'Casa Amara', time: '',
          status: 'Pending', fbAccount: 'APG Rentals', postLink: '', postedBy: 'Bea Lim',
        },
      ],
    });
    const posts = await trackerOver(post).posts();

    expect(posts).toHaveLength(2);
    expect(posts[0]!.date).toBe('2026-01-05');
    expect(posts[0]!.time).toBe('14:30');
    expect(posts[0]!.status).toBe('Posted');
    expect(posts[1]!.date).toBe('2026-01-06'); // a serialised date, not text
    expect(posts[1]!.status).toBe('Pending');
  });

  it('come out whole, in sheet order, with every field as text', async () => {
    const { post } = scripted({
      ok: true,
      posts: [
        { date: '2026-01-05', title: 'Lot 9', status: 'pending ', postLink: 12345, propertyId: 'F1', fbAccount: null },
        'not a row',
        { date: '1/6/2026', title: 'Lot 10', time: '2:05 PM' },
      ],
    });
    const posts = await trackerOver(post).posts();

    expect(posts).toEqual([
      { date: '2026-01-05', time: '', type: '', title: 'Lot 9', status: 'Pending', fbAccount: '', postLink: '12345', postedBy: '', propertyId: 'F1' },
      { date: '2026-01-06', time: '14:05', type: '', title: 'Lot 10', status: 'Posted', fbAccount: '', postLink: '', postedBy: '', propertyId: '' },
    ]);
  });

  it('keep names exactly as the sheet has them, because the server matches them exactly', async () => {
    const { post } = scripted({ ok: true, posts: [{ title: ' Casa Amara ', postedBy: 'Jan Dela Cruz ' }] });
    const [row] = await trackerOver(post).posts();

    expect(row!.title).toBe(' Casa Amara ');
    expect(row!.postedBy).toBe('Jan Dela Cruz ');
  });

  it('that do not arrive as a list are a sentence, not an empty tracker', async () => {
    const { post } = scripted({ ok: true });
    const error = await refusal(trackerOver(post).posts());

    expect(error.message).toContain('could not read');
  });
});

describe('the assignments', () => {
  it('map their status, date and property, in sheet order', async () => {
    const { post } = scripted({
      ok: true,
      assignments: [
        // "To post" is the old word for Not Shared: the same thing.
        { date: '2026-04-02', assignedTo: 'Jan Dela Cruz', property: 'Casa Amara', status: 'To post', propertyId: '1AbC' },
        { date: '2026-04-02', assignedTo: 'Jan Dela Cruz', property: 'Lot 3', status: ' not shared ' },
        { date: '2026-04-01T16:00:00.000Z', assignedTo: 'Jan Dela Cruz', property: 'Lot 9', status: 'pending' },
        { date: '2026-04-02', assignedTo: 'Bea Lim', property: 'Silang 40', status: 'POSTED' },
        { date: 'tomorrow', assignedTo: 'Bea Lim', property: 'Mabini', status: 'Draft' },
      ],
    });
    const rows = await trackerOver(post).assignments();

    // No `week` from a server before v6: the week of the date (Thursday 2 Apr: the week of 30 Mar).
    const week = '2026-03-30';
    expect(rows).toEqual([
      { date: '2026-04-02', week, due: '', assignedTo: 'Jan Dela Cruz', propertyName: 'Casa Amara', propertyId: '1AbC', status: 'Not Shared' },
      { date: '2026-04-02', week, due: '', assignedTo: 'Jan Dela Cruz', propertyName: 'Lot 3', propertyId: '', status: 'Not Shared' },
      // Manila's midnight on Apr 2 is 16:00 on Apr 1 in UTC.
      { date: '2026-04-02', week, due: '', assignedTo: 'Jan Dela Cruz', propertyName: 'Lot 9', propertyId: '', status: 'Pending' },
      { date: '2026-04-02', week, due: '', assignedTo: 'Bea Lim', propertyName: 'Silang 40', propertyId: '', status: 'Posted' },
      { date: '', week: '', due: '', assignedTo: 'Bea Lim', propertyName: 'Mabini', propertyId: '', status: 'Not Shared' },
    ]);
  });

  it('take the server\'s week (v6), and ignore one that is not a Monday', async () => {
    const { post } = scripted({
      ok: true,
      assignments: [
        { date: '2026-04-08', week: '2026-04-06', assignedTo: 'Jan', property: 'A', status: 'Not Shared' },
        // A Saturday's row belongs to the next week.
        { date: '2026-04-04', week: '', assignedTo: 'Jan', property: 'B', status: 'Not Shared' },
        { date: '2026-04-08', week: '2026-04-08', assignedTo: 'Jan', property: 'C', status: 'Not Shared' },
      ],
    });
    const rows = await trackerOver(post).assignments();

    expect(rows.map((r) => r.week)).toEqual(['2026-04-06', '2026-04-06', '2026-04-06']);
  });

  it('that do not arrive as a list are a sentence', async () => {
    const { post } = scripted({ ok: true, assignments: {} });
    await refusal(trackerOver(post).assignments());
  });
});

describe('the team', () => {
  it('asks the server for the team action', async () => {
    const { post, sent } = scripted({ ok: true, team: [] });
    await expect(trackerOver(post).team()).resolves.toEqual([]);

    expect(sent.map((s) => s.body['action'])).toEqual(['team']);
  });

  it('maps each row, reading the role as sign-in does', async () => {
    const { post } = scripted({
      ok: true,
      team: [
        { name: 'Jan Dela Cruz', role: 'Intern', email: 'jan@example.com', fbAccounts: ['APG Main', 'APG Rentals'], active: true },
        { name: 'Maria Santos', role: 'Admin', email: '', fbAccounts: [], active: true },
        { name: 'Old Manager', role: 'manager', fbAccounts: [] },
        { name: 'Someone', role: 'Supervisor' },
      ],
    });

    expect(await trackerOver(post).team()).toEqual([
      { name: 'Jan Dela Cruz', role: 'Intern', email: 'jan@example.com', fbAccounts: ['APG Main', 'APG Rentals'], fbProfiles: [{ account: 'APG Main', link: '' }, { account: 'APG Rentals', link: '' }], active: true },
      { name: 'Maria Santos', role: 'Admin', email: '', fbAccounts: [], fbProfiles: [], active: true },
      { name: 'Old Manager', role: 'Admin', email: '', fbAccounts: [], fbProfiles: [], active: true },
      { name: 'Someone', role: 'Intern', email: '', fbAccounts: [], fbProfiles: [], active: true },
    ]);
  });

  it('reads FB accounts from a list or a comma-separated cell, trimmed, without blanks or repeats', async () => {
    const { post } = scripted({
      ok: true,
      team: [
        { name: 'A', fbAccounts: 'APG Main, APG Rentals ,, APG Main' },
        { name: 'B', fbAccounts: [' APG Main', '', 7, null] },
        { name: 'C', fbAccounts: { 0: 'APG Main' } },
      ],
    });
    const team = await trackerOver(post).team();

    expect(team.map((t) => t.fbAccounts)).toEqual([['APG Main', 'APG Rentals'], ['APG Main', '7'], []]);
  });

  it('is active unless the row says false or FALSE', async () => {
    const values: unknown[] = [true, 'TRUE', '', undefined, null, 0, 'no', false, 'FALSE', ' false '];
    const { post } = scripted({ ok: true, team: values.map((active, i) => ({ name: `P${i}`, active })) });
    const team = await trackerOver(post).team();

    expect(team.map((t) => t.active)).toEqual([true, true, true, true, true, true, true, false, false, false]);
  });

  it('drops rows with no name, and anything that is not a row', async () => {
    const { post } = scripted({
      ok: true,
      team: [{ name: '' }, { name: '   ' }, { role: 'Admin' }, null, 'Jan', ['Jan'], { name: 'Ana Reyes' }],
    });

    expect((await trackerOver(post).team()).map((t) => t.name)).toEqual(['Ana Reyes']);
  });

  it('keeps names exactly as the sheet has them', async () => {
    const { post } = scripted({ ok: true, team: [{ name: 'Jan Dela Cruz ' }] });

    expect((await trackerOver(post).team())[0]!.name).toBe('Jan Dela Cruz ');
  });

  it('never keeps a key, if one were ever sent', async () => {
    const { post } = scripted({ ok: true, team: [{ name: 'Jan', key: 'key-jan', Key: 'key-jan' }] });
    const team = await trackerOver(post).team();

    expect(JSON.stringify(team)).not.toContain('key-jan');
  });

  it('that does not arrive as a list is a sentence, not an empty team', async () => {
    const { post } = scripted({ ok: true, team: 'Jan, Ana' });
    const error = await refusal(trackerOver(post).team());

    expect(error.message).toContain('could not read');
  });

  it('passes on the server refusing an intern', async () => {
    const { post } = scripted({ ok: false, error: 'forbidden', message: 'Your account cannot do that.' });
    await refusal(trackerOver(post).team());
  });
});

// ------------------------------------------------------------------ logging a post

describe('logging a post', () => {
  it('takes the server\'s date and name, not the client\'s', async () => {
    const { post } = scripted({ ok: true, status: 'Pending', date: '2026-03-09', postedBy: 'Jan Dela Cruz' });
    const saved = await trackerOver(post).logPost(logInput({ status: 'Pending', postedBy: 'Somebody Else' }));

    expect(saved.date).toBe('2026-03-09');
    expect(saved.status).toBe('Pending');
    expect(saved.postedBy).toBe('Jan Dela Cruz');
  });

  it('sends what the person said, and no date, time or clock of its own', async () => {
    const { post, sent } = scripted({ ok: true, status: 'Posted', date: '2026-03-09', postedBy: 'Jan Dela Cruz' });
    await trackerOver(post).logPost(logInput({ fbAccount: '  APG Homes ', type: 'CONDO / HOUSE AND LOT' }));

    expect(sent[0]!.body).toEqual({
      property: 'Casa Amara',
      propertyId: '1AbC',
      fbAccount: 'APG Homes',
      postLink: 'https://www.facebook.com/groups/x/posts/1/',
      status: 'Posted',
      type: 'CONDO / HOUSE AND LOT',
      action: 'logPost',
      key: 'testkey',
    });
  });

  it('sends Posted By only when a manager logs for someone, and exactly as given', async () => {
    const { post, sent } = scripted({ ok: true, status: 'Posted', date: '2026-03-09', postedBy: 'Jan Dela Cruz ' });
    const tracker = trackerOver(post);

    await tracker.logPost(logInput({ postedBy: '   ' }));
    const saved = await tracker.logPost(logInput({ postedBy: 'Jan Dela Cruz ' }));

    expect(sent[0]!.body).not.toHaveProperty('postedBy');
    expect(sent[1]!.body['postedBy']).toBe('Jan Dela Cruz ');
    expect(saved.postedBy).toBe('Jan Dela Cruz ');
  });

  it('comes back as the row the server wrote', async () => {
    const { post } = scripted({ ok: true, status: 'Posted', date: '2026-03-09', time: '16:45', postedBy: 'Jan Dela Cruz' });
    const saved = await trackerOver(post).logPost(logInput());

    expect(saved).toEqual({
      date: '2026-03-09',
      time: '16:45',
      type: '', // no type sent, and an older server replies with none
      title: 'Casa Amara',
      status: 'Posted',
      fbAccount: 'APG Homes',
      postLink: 'https://www.facebook.com/groups/x/posts/1/',
      postedBy: 'Jan Dela Cruz',
      propertyId: '1AbC',
    });
  });

  it('takes the Property type the server wrote, else title cases the category it sent', async () => {
    const fromServer = scripted({ ok: true, status: 'Posted', date: '2026-03-09', time: '10:23', type: 'Commercial Space', postedBy: 'Jan' });
    expect((await trackerOver(fromServer.post).logPost(logInput({ type: 'WAREHOUSE' }))).type).toBe('Commercial Space');

    const older = scripted({ ok: true, status: 'Posted', date: '2026-03-09', time: '10:23', postedBy: 'Jan' });
    expect((await trackerOver(older.post).logPost(logInput({ type: 'CONDO / HOUSE AND LOT' }))).type).toBe('Condo / House and Lot');
  });

  it('reads the time the sheet writes, "10:23 AM", as HH:mm', async () => {
    const { post } = scripted({ ok: true, status: 'Posted', date: '2026-03-09', time: '2:05 PM', postedBy: 'Jan' });
    expect((await trackerOver(post).logPost(logInput())).time).toBe('14:05');
  });

  it('never fills in a time or a name the server did not send', async () => {
    // Code.gs's logPost reply carries no time today: blank, not this PC's clock.
    const { post } = scripted({ ok: true, date: '2026-03-09' });
    const saved = await trackerOver(post).logPost(logInput({ status: 'Pending', postedBy: 'Jan Dela Cruz' }));

    expect(saved.time).toBe('');
    expect(saved.postedBy).toBe('');
    expect(saved.status).toBe('Pending'); // what was asked, since the server did not say otherwise
  });

  it('without a property is refused before asking', async () => {
    const { post, sent } = scripted({ ok: true });
    const tracker = trackerOver(post);

    const noId = await refusal(tracker.logPost(logInput({ propertyId: ' ' })));
    const noName = await refusal(tracker.logPost(logInput({ propertyName: '' })));

    expect(noId.message).toBe('Choose the property you posted before logging it.');
    expect(noName.message).toBe(noId.message);
    expect(sent).toHaveLength(0);
  });

  it('without an FB account is refused before asking', async () => {
    const { post, sent } = scripted({ ok: true });
    const error = await refusal(trackerOver(post).logPost(logInput({ fbAccount: '   ' })));

    expect(error.message).toBe('Type the FB account name.');
    expect(sent).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ the one edit

describe('completing a pending post', () => {
  it('sends the link for that property and comes back Posted', async () => {
    const { post, sent } = scripted({ ok: true, row: 7 });
    const pending = entry({ status: 'Pending', postLink: '' });

    const done = await trackerOver(post).addLink(pending, '  https://www.facebook.com/groups/x/posts/2/ ');

    expect(sent[0]!.body).toEqual({
      property: 'Casa Amara',
      propertyId: '1AbC',
      postLink: 'https://www.facebook.com/groups/x/posts/2/',
      action: 'addLink',
      key: 'testkey',
    });
    expect(done).toEqual({ ...pending, status: 'Posted', postLink: 'https://www.facebook.com/groups/x/posts/2/' });
  });

  it('on a row with no property id, lets the server find it by name', async () => {
    const { post, sent } = scripted({ ok: true, row: 7 });
    await trackerOver(post).addLink(entry({ status: 'Pending', postLink: '', propertyId: '' }), 'https://fb.com/2');

    expect(sent[0]!.body).not.toHaveProperty('propertyId');
    expect(sent[0]!.body['property']).toBe('Casa Amara');
  });

  it('when the server has no such pending post, keeps its wording', async () => {
    const { post } = scripted({ ok: false, error: 'notfound', message: 'No pending post for that property.' });
    const error = await refusal(trackerOver(post).addLink(entry({ status: 'Pending', postLink: '' }), 'https://fb.com/2'));

    expect(error.message).toBe('No pending post for that property.');
  });

  it('is refused here for a post that is already live, or without a link', async () => {
    const { post, sent } = scripted({ ok: true });
    const tracker = trackerOver(post);

    const live = await refusal(tracker.addLink(entry({ status: 'Posted' }), 'https://fb.com/2'));
    const blank = await refusal(tracker.addLink(entry({ status: 'Pending', postLink: '' }), '   '));
    const nowhere = await refusal(tracker.addLink(entry({ status: 'Pending', title: ' ', propertyId: '' }), 'https://fb.com/2'));

    expect(live.message).toContain('already live');
    expect(blank.message).toBe('Paste the post link.');
    expect(nowhere.message).toContain('tracker sheet');
    expect(sent).toHaveLength(0);
  });
});

describe('editing a row', () => {
  it('other than adding its link is refused here, without asking', async () => {
    const { post, sent } = scripted({ ok: true });
    const pending = entry({ status: 'Pending', postLink: '' });

    const error = await refusal(trackerOver(post).updatePost(pending, pending));

    expect(error.message).toContain('sheet');
    expect(sent).toHaveLength(0); // never reached the network
  });

  it.each([
    ['the title', { title: 'Casa Amara 2' }],
    ['the date', { date: '2026-01-02' }],
    ['the time', { time: '10:00' }],
    ['the account', { fbAccount: 'APG Rentals' }],
    ['the name', { postedBy: 'Bea Lim' }],
    ['the type', { type: 'Condo' }],
    ['the property', { propertyId: 'other' }],
  ])('that changes %s along with the link is refused', async (_, change) => {
    const { post, sent } = scripted({ ok: true });
    const pending = entry({ status: 'Pending', postLink: '' });

    const error = await refusal(
      trackerOver(post).updatePost(pending, { ...pending, status: 'Posted', postLink: 'https://fb.com/2', ...change }),
    );

    expect(error.message).toBe(
      'Only adding the live link to a pending post can be saved from here. Edit the sheet for anything else.',
    );
    expect(sent).toHaveLength(0);
  });

  it('that is already live is refused', async () => {
    const { post, sent } = scripted({ ok: true });
    const live = entry();

    const error = await refusal(trackerOver(post).updatePost(live, { ...live, postLink: 'https://fb.com/other' }));

    expect(error.message).toContain('sheet');
    expect(sent).toHaveLength(0);
  });

  it('that only adds the live link is saved', async () => {
    const { post, sent } = scripted({ ok: true, row: 3 });
    const pending = entry({ status: 'Pending', postLink: '' });

    const done = await trackerOver(post).updatePost(pending, { ...pending, status: 'Posted', postLink: 'https://fb.com/2' });

    expect(done.status).toBe('Posted');
    expect(sent[0]!.body['action']).toBe('addLink');
  });
});

// ------------------------------------------------------------------ queues

describe('saving a queue', () => {
  it('sends the items in order', async () => {
    const { post, sent } = scripted({ ok: true, saved: 2 });

    const saved = await trackerOver(post).saveQueue('2026-04-02', 'Jan Dela Cruz', [
      assignment({ propertyName: 'Casa Amara', propertyId: '', status: 'Not Shared' }),
      assignment({ propertyName: 'Lot 9', propertyId: '', status: 'Pending' }),
    ]);

    const body = sent[0]!.body;
    // v6: the week, as its Monday. Thursday 2 Apr is in the week of 30 Mar.
    expect(body['week']).toBe('2026-03-30');
    expect(body['date']).toBeUndefined();
    expect(body['assignedTo']).toBe('Jan Dela Cruz');
    const items = body['items'] as Wire[];
    expect(items[0]!['property']).toBe('Casa Amara');
    expect(items[0]!['status']).toBe('Not Shared');
    expect(items[1]!['status']).toBe('Pending');
    expect(saved).toBe(2);
  });

  it('sends each item\'s folder id when it has one, and Not Shared when it has no status', async () => {
    const { post, sent } = scripted({ ok: true, saved: 2 });

    await trackerOver(post).saveQueue('2026-04-02', 'Jan Dela Cruz', [
      { propertyName: 'Casa Amara', propertyId: '1AbC' },
      { propertyName: 'Lot 9', propertyId: '  ', status: 'Posted' },
    ]);

    expect(sent[0]!.body['items']).toEqual([
      { property: 'Casa Amara', status: 'Not Shared', propertyId: '1AbC' },
      { property: 'Lot 9', status: 'Posted' },
    ]);
  });

  it('with no items empties that queue', async () => {
    const { post, sent } = scripted({ ok: true, saved: 0 });

    expect(await trackerOver(post).saveQueue('2026-04-02', 'Jan Dela Cruz', [])).toBe(0);
    expect(sent[0]!.body['items']).toEqual([]);
  });

  it.each([
    ['no week', '', 'Jan Dela Cruz', 'Pick a week for the queue.'],
    ['a date the server would not match', '2026-4-2', 'Jan Dela Cruz', 'Pick a week for the queue.'],
    ['a day that does not exist', '2026-02-30', 'Jan Dela Cruz', 'Pick a week for the queue.'],
    ['nobody to give it to', '2026-04-02', '  ', 'Choose who the queue is for.'],
  ])('with %s is refused before asking', async (_, date, who, message) => {
    const { post, sent } = scripted({ ok: true, saved: 1 });
    const error = await refusal(trackerOver(post).saveQueue(date, who, [{ propertyName: 'Casa Amara' }]));

    expect(error.message).toBe(message);
    expect(sent).toHaveLength(0);
  });

  it('with an item that has no property is refused before asking', async () => {
    const { post, sent } = scripted({ ok: true, saved: 1 });
    const error = await refusal(
      trackerOver(post).saveQueue('2026-04-02', 'Jan Dela Cruz', [{ propertyName: 'Casa Amara' }, { propertyName: ' ' }]),
    );

    expect(error.message).toContain('needs a property');
    expect(sent).toHaveLength(0);
  });

  it('for an intern is the server\'s to refuse', async () => {
    const { post } = scripted({ ok: false, error: 'forbidden', message: 'Your account cannot do that.' });
    const error = await refusal(trackerOver(post).saveQueue('2026-04-02', 'Jan Dela Cruz', []));

    expect(error.message).toBe('Your account cannot do that.');
  });
});

describe('setting a queue item\'s status', () => {
  it('sends the item as the sheet has it, and comes back moved', async () => {
    const { post, sent } = scripted({ ok: true });
    const item = assignment({ assignedTo: 'Jan Dela Cruz ' });

    const moved = await trackerOver(post).setStatus(item, 'Pending');

    expect(sent[0]!.body).toEqual({
      property: 'Casa Amara',
      propertyId: '1AbC',
      assignedTo: 'Jan Dela Cruz ', // matched with === on the server: not tidied
      status: 'Pending',
      action: 'setStatus',
      key: 'testkey',
    });
    expect(moved).toEqual({ ...item, status: 'Pending' });
  });

  it('without a property or an assignee is refused before asking', async () => {
    const { post, sent } = scripted({ ok: true });
    const tracker = trackerOver(post);

    const noProperty = await refusal(tracker.setStatus(assignment({ propertyName: '' }), 'Posted'));
    const nobody = await refusal(tracker.setStatus(assignment({ assignedTo: '' }), 'Posted'));

    expect(noProperty.message).toContain('no property');
    expect(nobody.message).toContain('not assigned to anyone');
    expect(sent).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ the sheet's dates and times

describe('reading the sheet', () => {
  it.each([
    ['2026-01-05', '2026-01-05'],
    [' 2026-01-05 ', '2026-01-05'],
    ['2026-01-06T00:00:00.000Z', '2026-01-06'],
    ['2026-01-05T16:00:00.000Z', '2026-01-06'], // Manila's midnight
    ['2026-01-05T15:59:59Z', '2026-01-05'],
    ['2026-01-06T00:00:00+08:00', '2026-01-06'],
    ['2026-01-06T07:00:00-0500', '2026-01-06'],
    ['2026-01-06T00:00:00', '2026-01-06'], // no zone: the clock as written
    ['2026-01-06 09:30', '2026-01-06'],
    ['1/6/2026', '2026-01-06'],
    ['12/31/2026 14:00:00', '2026-12-31'],
    ['2026-02-29', ''],
    ['2028-02-29', '2028-02-29'],
    ['13/1/2026', ''],
    ['Jan 6', ''],
    ['', ''],
  ])('reads the date %j as %j', (raw, date) => {
    expect(readSheetDate(raw)).toBe(date);
  });

  it('reads no date out of what is not text', () => {
    expect(readSheetDate(46027)).toBe('');
    expect(readSheetDate(null)).toBe('');
    expect(readSheetDate(undefined)).toBe('');
  });

  it.each([
    ['14:30', '14:30'],
    ['9:05', '09:05'],
    ['14:30:59', '14:30'],
    ['2:30 PM', '14:30'],
    ['2:30:00 pm', '14:30'],
    ['12:15 AM', '00:15'],
    ['12:15 p.m.', '12:15'],
    ['1899-12-30T06:30:00.000Z', '14:30'], // a time cell, serialised: read on Manila's clock
    ['2026-01-06T09:15:00', '09:15'],
    ['1899-12-30', ''], // what Code.gs makes of a time-formatted cell: the time is gone
    ['25:00', ''],
    ['13:00 PM', ''],
    ['9:60', ''],
    ['noon', ''],
    ['', ''],
  ])('reads the time %j as %j', (raw, time) => {
    expect(readSheetTime(raw)).toBe(time);
  });
});

// ------------------------------------------------------------------ contract v3

describe('logging a post (v3)', () => {
  it('needs a Facebook link, and says so before asking', async () => {
    const { post, sent } = scripted({ ok: true });
    const tracker = trackerOver(post);

    const blank = await refusal(tracker.logPost(logInput({ postLink: '  ' })));
    const other = await refusal(tracker.logPost(logInput({ postLink: 'https://instagram.com/p/1' })));

    expect(blank.message).toBe("Paste the post's link.");
    expect(other.message).toBe("That isn't a Facebook link.");
    expect(sent).toHaveLength(0);
  });

  it('sends the status and the trimmed link', async () => {
    const { post, sent } = scripted({ ok: true, date: '2026-03-09', postedBy: 'Jan' });
    const saved = await trackerOver(post).logPost(logInput({ status: 'Pending', postLink: ' https://fb.me/x ' }));

    expect(sent[0]!.body['status']).toBe('Pending');
    expect(sent[0]!.body['postLink']).toBe('https://fb.me/x');
    expect(saved.status).toBe('Pending');
  });

  it.each([
    ['link-required', "Paste the post's link."],
    ['bad-link', "That isn't a Facebook link."],
    ['bad-status', 'Choose Posted or Pending.'],
  ])('reads the server refusing with %s', async (error, message) => {
    const { post } = scripted({ ok: false, error, message: 'postLink is required (https facebook.com …)' });
    const refused = await refusal(trackerOver(post).logPost(logInput()));
    expect(refused.message).toBe(message);
  });
});

describe('saving a queue for a week (v6)', () => {
  it.each([
    ['a Monday', '2026-11-02', '2026-11-02'],
    ['a Friday', '2026-11-06', '2026-11-02'],
    ['a Saturday: the next week', '2026-11-07', '2026-11-09'],
    ['a Sunday: the next week', '2026-11-01', '2026-11-02'],
    ['a day across a month boundary', '2026-10-30', '2026-10-26'],
    ['a Sunday across a month boundary', '2026-05-31', '2026-06-01'],
  ])('sends %s as its week', async (_, day, week) => {
    const { post, sent } = scripted({ ok: true, saved: 0 });
    await trackerOver(post).saveQueue(day, 'Jan', []);
    await trackerOver(post).saveQueues(day, [{ assignedTo: 'Jan', items: [] }]);

    expect(sent.map((s) => s.body['week'])).toEqual([week, week]);
  });
});

describe('saving several queues', () => {
  it('sends every queue in one request and returns what was saved', async () => {
    const { post, sent } = scripted({ ok: true, saved: 3 });
    const queues = new Map([
      ['Jan', [{ propertyName: 'Casa Amara', propertyId: '1AbC' }, { propertyName: 'Lot 9' }]],
      ['Bea', [{ propertyName: 'Lot 10', status: 'Posted' as const }]],
    ]);
    const saved = await trackerOver(post).saveQueues('2026-04-02', queues);

    expect(saved).toBe(3);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({
      week: '2026-03-30',
      queues: [
        {
          assignedTo: 'Jan',
          items: [
            { propertyName: 'Casa Amara', propertyId: '1AbC', status: 'Not Shared' },
            { propertyName: 'Lot 9', status: 'Not Shared' },
          ],
        },
        { assignedTo: 'Bea', items: [{ propertyName: 'Lot 10', status: 'Posted' }] },
      ],
      action: 'saveQueues',
      key: 'testkey',
    });
  });

  it('accepts a list, counts the items when the reply does not, and sends nothing for none', async () => {
    const { post, sent } = scripted({ ok: true });
    const tracker = trackerOver(post);
    expect(await tracker.saveQueues('2026-04-02', [{ assignedTo: 'Jan', items: [{ propertyName: 'A' }, { propertyName: 'B' }] }])).toBe(2);
    expect(await tracker.saveQueues('2026-04-02', [])).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('refuses a bad date, a nameless queue or an empty item before asking', async () => {
    const { post, sent } = scripted({ ok: true });
    const tracker = trackerOver(post);
    await refusal(tracker.saveQueues('4/2/2026', [{ assignedTo: 'Jan', items: [] }]));
    await refusal(tracker.saveQueues('2026-04-02', [{ assignedTo: ' ', items: [] }]));
    await refusal(tracker.saveQueues('2026-04-02', [{ assignedTo: 'Jan', items: [{ propertyName: '' }] }]));
    await refusal(tracker.saveQueues('2026-04-02', [{ assignedTo: 'Jan', items: [] }, { assignedTo: 'Jan', items: [] }]));
    expect(sent).toHaveLength(0);
  });
});

describe('managing the team', () => {
  it('adds a person and returns their key once', async () => {
    const { post, sent } = scripted({
      ok: true,
      person: { name: 'Mia Santos', role: 'Intern', fbAccounts: ['APG Homes'], email: '', active: true },
      key: 'k-123',
    });
    const added = await trackerOver(post).addPerson({ name: ' Mia Santos ', role: 'Intern', fbAccounts: [' APG Homes ', ''] });

    expect(added).toEqual({
      person: { name: 'Mia Santos', role: 'Intern', fbAccounts: ['APG Homes'], fbProfiles: [{ account: 'APG Homes', link: '' }], email: '', active: true },
      key: 'k-123',
    });
    expect(sent[0]!.body).toEqual({ name: 'Mia Santos', role: 'Intern', fbAccounts: ['APG Homes'], action: 'addPerson', key: 'testkey' });
  });

  it('cannot read a new person without their key', async () => {
    const { post } = scripted({ ok: true, person: { name: 'Mia', role: 'Intern' } });
    const error = await refusal(trackerOver(post).addPerson({ name: 'Mia', role: 'Intern' }));
    expect(error.message).toMatch(/could not read/);
  });

  it('says plainly that the name is taken, or that you cannot deactivate yourself', async () => {
    const dup = scripted({ ok: false, error: 'duplicate' });
    expect((await refusal(trackerOver(dup.post).addPerson({ name: 'Mia', role: 'Intern' }))).message)
      .toBe('Someone on the team already has that name.');
    const self = scripted({ ok: false, error: 'self' });
    expect((await refusal(trackerOver(self.post).setActive('Me', false))).message).toBe("You can't deactivate yourself.");
  });

  it('sets someone inactive and reads the row back', async () => {
    const { post, sent } = scripted({ ok: true, person: { name: 'Mia', role: 'Intern', active: false } });
    const person = await trackerOver(post).setActive('Mia', false);
    expect(person.active).toBe(false);
    expect(sent[0]!.body).toMatchObject({ name: 'Mia', active: false });
  });

  it('sends the profile link with a new person, https:// put in front, and refuses a bad one without asking', async () => {
    const { post, sent } = scripted({
      ok: true,
      person: { name: 'Cyrus', role: 'Intern', fbAccounts: ['CYRUS ORBANO'], fbProfileLink: 'https://facebook.com/cyrus' },
      key: 'k-1',
    });
    const added = await trackerOver(post).addPerson({
      name: 'Cyrus',
      role: 'Intern',
      fbAccounts: ['CYRUS ORBANO'],
      fbProfileLink: ' facebook.com/cyrus ',
    });
    expect(added.person.fbProfileLink).toBe('https://facebook.com/cyrus');
    expect(sent[0]!.body).toMatchObject({ fbProfileLink: 'https://facebook.com/cyrus' });

    const bad = scripted({ ok: true });
    expect((await refusal(trackerOver(bad.post).addPerson({ name: 'X', role: 'Admin', fbProfileLink: 'https://x.com/a' }))).message)
      .toBe("That isn't a Facebook profile link.");
    expect(bad.sent).toHaveLength(0);
  });

  it('warns when an older web app saves the person but drops the profile link', async () => {
    const old = scripted({ ok: true, person: { name: 'Cyrus', role: 'Intern', fbAccounts: ['CYRUS ORBANO'] }, key: 'k-1' });
    const added = await trackerOver(old.post).addPerson({ name: 'Cyrus', role: 'Intern', fbProfileLink: 'facebook.com/cyrus' });
    expect(added.key).toBe('k-1');
    expect(added.warning).toMatch(/New version/);

    const current = scripted({ ok: true, person: { name: 'Cyrus', role: 'Intern', fbProfileLink: '' }, key: 'k-2' });
    expect((await trackerOver(current.post).addPerson({ name: 'Cyrus', role: 'Intern' })).warning).toBeUndefined();
  });

  it('updates only the fields given, and reads the person back', async () => {
    const { post, sent } = scripted((body: Wire) => ({
      ok: true,
      person: { name: body['name'], role: 'Intern', fbAccounts: ['CYRUS ORBANO'], fbProfileLink: 'https://www.facebook.com/cyrus', active: true },
    }));
    const tracker = trackerOver(post);

    const person = await tracker.updatePerson('Cyrus', { fbAccounts: [' CYRUS ORBANO ', ''], fbProfileLink: 'www.facebook.com/cyrus' });
    expect(person).toEqual({
      name: 'Cyrus',
      role: 'Intern',
      email: '',
      fbAccounts: ['CYRUS ORBANO'],
      fbProfileLink: 'https://www.facebook.com/cyrus',
      fbProfiles: [{ account: 'CYRUS ORBANO', link: 'https://www.facebook.com/cyrus' }],
      active: true,
    });
    expect(sent[0]!.body).toEqual({
      action: 'updatePerson',
      key: 'testkey',
      name: 'Cyrus',
      fbAccounts: ['CYRUS ORBANO'],
      fbProfileLink: 'https://www.facebook.com/cyrus',
    });

    await tracker.updatePerson('Cyrus', { fbProfileLink: '' });
    expect(sent[1]!.body).toEqual({ action: 'updatePerson', key: 'testkey', name: 'Cyrus', fbProfileLink: '' });

    expect((await refusal(tracker.updatePerson('Cyrus', { fbProfileLink: 'http://facebook.com/x' }))).message)
      .toBe("That isn't a Facebook profile link.");
    expect(sent).toHaveLength(2);
  });

  it('says a bad profile link and a person it cannot read plainly', async () => {
    const refused = scripted({ ok: false, error: 'bad-profile-link', message: 'Server words.' });
    expect((await refusal(trackerOver(refused.post).updatePerson('Mia', { fbAccounts: ['A'] }))).message)
      .toBe("That isn't a Facebook profile link.");
    const empty = scripted({ ok: true });
    expect((await refusal(trackerOver(empty.post).updatePerson('Mia', { fbAccounts: ['A'] }))).message).toMatch(/could not read/);
  });

  it('makes a new key', async () => {
    const { post } = scripted({ ok: true, key: ' k-9 ' });
    expect(await trackerOver(post).newKey('Mia')).toBe('k-9');
    const empty = scripted({ ok: true });
    await refusal(trackerOver(empty.post).newKey('Mia'));
  });
});

describe('the index check', () => {
  it('reads the reply, dropping rows it cannot use', async () => {
    const { post } = scripted({
      ok: true,
      checkedAt: '2026-10-31 09:00',
      directoryCount: 1474,
      checkerCount: '1470',
      directoryOnly: [{ id: 'A', name: 'Lot 1' }, null, {}],
      checkerOnly: [{ id: 'B', name: 'Lot 2', path: 'CONDO / Lot 2' }],
      sold: [{ id: 'C', name: 'Lot 3', extra: 1 }],
    });
    expect(await trackerOver(post).indexCheck()).toEqual({
      checkedAt: '2026-10-31 09:00',
      directoryCount: 1474,
      checkerCount: 1470,
      directoryOnly: [{ id: 'A', name: 'Lot 1' }],
      checkerOnly: [{ id: 'B', name: 'Lot 2', path: 'CONDO / Lot 2' }],
      sold: [{ id: 'C', name: 'Lot 3' }],
    });
  });

  it('refuses a reply without its lists', async () => {
    const { post } = scripted({ ok: true, directoryOnly: [] });
    await refusal(trackerOver(post).indexCheck());
  });
});
