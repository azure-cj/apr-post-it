/**
 * Refused posts (v18, AID-189): a post the app kept on its PC and sent again
 * later, inside the cooldown, was refused and written on the admin sheet's own
 * Refused posts tab for an admin to handle. Since v19 the cooldown refuses
 * nothing: such a retry is saved, and nothing new is written on the tab. The
 * rows already there are still listed and handled. Admins only.
 */

import { describe, expect, it } from 'vitest';
import { CASA, createWorld, PEOPLE } from './world';

const HEADERS = [
  'Post', 'Link', 'Agent', 'Logged at', 'Property', 'Property ID', 'FB account',
  'Last posted', 'Last posted by', 'Next allowed', 'Handled by', 'Handled at',
];
const LINK = 'https://www.facebook.com/groups/apg/posts/900/';
// 2:10 PM in Manila.
const LOGGED_AT = '2026-03-10T06:10:00Z';

/** A row as v18 wrote it: Jan's post of Casa Amara, refused because Ana posted it that morning. */
const REFUSED_ROW = [
  'groups/apg/posts/900', LINK, PEOPLE.jan.name, '2026-03-10T14:10:00+08:00', CASA.name, CASA.id, 'APG Main',
  '2026-03-10', PEOPLE.ana.name, '2026-03-17', '', '',
];

/** A world at 4 PM on 10 Mar whose Refused posts tab holds the row v18 wrote. */
function seeded() {
  const w = createWorld();
  w.project.clock.set('2026-03-10 16:00');
  w.admin.addSheet('Refused posts', HEADERS).writeText(REFUSED_ROW);
  return w;
}

describe('a retry inside the cooldown', () => {
  it('is saved, dated when it was logged, and nothing goes on the Refused posts tab', () => {
    const w = createWorld();
    w.project.clock.set('2026-03-10 09:00');
    expect(w.logPost('ana', CASA)).toMatchObject({ ok: true });
    w.project.clock.set('2026-03-10 16:00');

    expect(w.logPost('jan', CASA, { postLink: LINK, loggedAt: LOGGED_AT })).toEqual({
      ok: true,
      status: 'Posted',
      date: '2026-03-10',
      time: '14:10',
      type: 'Condo / House and Lot',
      postedBy: PEOPLE.jan.name,
    });
    expect(w.posts.lastRow).toBe(3);
    expect(w.admin.has('Refused posts')).toBe(false);
  });

  it('is saved once, however often it is sent', () => {
    const w = createWorld();
    w.logPost('jan', CASA);
    w.logPost('jan', CASA, { postLink: LINK, loggedAt: LOGGED_AT });

    expect(w.logPost('jan', CASA, { postLink: 'https://m.facebook.com/groups/apg/permalink/900/', loggedAt: LOGGED_AT })).toMatchObject({
      ok: true,
      repeat: true,
    });
    expect(w.posts.lastRow).toBe(3);
    expect(w.admin.has('Refused posts')).toBe(false);
  });

  it('leaves the rows already on the tab as they were', () => {
    const w = seeded();
    w.logPost('ana', CASA);
    w.logPost('jan', CASA, { postLink: 'https://www.facebook.com/groups/apg/posts/901/', loggedAt: LOGGED_AT });

    const tab = w.admin.sheet('Refused posts');
    expect(tab.lastRow).toBe(2);
    expect(tab.row(2)).toEqual(REFUSED_ROW);
  });
});

describe('refusedPosts and handleRefused', () => {
  it('lists every refused post already on the tab', () => {
    const w = seeded();

    expect(w.call('maria', 'refusedPosts')).toEqual({
      ok: true,
      refused: [
        {
          postKey: 'groups/apg/posts/900',
          link: LINK,
          agent: PEOPLE.jan.name,
          loggedAt: '2026-03-10T14:10:00+08:00',
          property: CASA.name,
          propertyId: CASA.id,
          fbAccount: 'APG Main',
          lastPosted: '2026-03-10',
          lastPostedBy: PEOPLE.ana.name,
          nextAllowed: '2026-03-17',
          handledBy: '',
          handledAt: '',
        },
      ],
    });
  });

  it('lists none when there is no tab', () => {
    expect(createWorld().call('maria', 'refusedPosts')).toEqual({ ok: true, refused: [] });
  });

  it('marks one handled, by who and when, from any copy of its link', () => {
    const w = seeded();
    const postsBefore = w.posts.lastRow;
    const reply = w.call('rico', 'handleRefused', { postLink: 'https://www.facebook.com/groups/APG/permalink/900?ref=x' });

    expect(reply).toMatchObject({ ok: true, refused: { postKey: 'groups/apg/posts/900', handledBy: PEOPLE.rico.name } });
    expect((reply['refused'] as { handledAt: string }).handledAt).toMatch(/^2026-03-10T16:00:00\+08:00$/);
    expect(w.admin.sheet('Refused posts').row(2).slice(10, 12)).toEqual([PEOPLE.rico.name, '2026-03-10T16:00:00+08:00']);
    // The tracker is left as it was.
    expect(w.posts.lastRow).toBe(postsBefore);
  });

  it("refuses a link that isn't a post's, and a post that isn't on the list", () => {
    const w = seeded();
    expect(w.call('maria', 'handleRefused', { postLink: 'https://www.facebook.com/groups/apg' })).toMatchObject({
      ok: false,
      error: 'not-a-post',
    });
    expect(w.call('maria', 'handleRefused', { postLink: 'https://www.facebook.com/groups/apg/posts/1/' })).toMatchObject({
      ok: false,
      error: 'notfound',
    });
  });

  it('is for admins only', () => {
    const w = seeded();
    expect(w.call('jan', 'refusedPosts')).toMatchObject({ ok: false, error: 'forbidden' });
    expect(w.call('jan', 'handleRefused', { postLink: LINK })).toMatchObject({ ok: false, error: 'forbidden' });
  });
});

describe("the app's client, against this server", () => {
  it('saves a retry inside the cooldown, and the admin lists and handles a refused post already on the tab', async () => {
    const w = seeded();
    w.logPost('ana', CASA);

    await expect(
      w.app('jan').tracker.logPost({
        propertyId: CASA.id,
        propertyName: CASA.name,
        fbAccount: 'APG Main',
        postLink: 'https://www.facebook.com/groups/apg/posts/901/',
        status: 'Posted',
        loggedAt: LOGGED_AT,
      }),
    ).resolves.toMatchObject({ status: 'Posted', date: '2026-03-10', postedBy: PEOPLE.jan.name });

    const admin = w.app('maria').tracker;
    const [post, ...others] = await admin.refusedPosts();
    expect(others).toEqual([]);
    expect(post).toMatchObject({ postKey: 'groups/apg/posts/900', agent: PEOPLE.jan.name, handledBy: '' });
    expect(await admin.handleRefused(post!)).toMatchObject({ handledBy: PEOPLE.maria.name });
  });
});
