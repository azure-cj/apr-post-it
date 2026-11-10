/**
 * Refused posts (v18, AID-189): a post the app kept on its PC and sent again
 * later is already on Facebook. Inside the cooldown it is still refused, and
 * nothing goes on the tracker, but it is written on the admin sheet's own
 * Refused posts tab for an admin to handle. Admins only.
 */

import { describe, expect, it } from 'vitest';
import { CASA, createWorld, LOT_9, PEOPLE } from './world';

const HEADERS = [
  'Post', 'Link', 'Agent', 'Logged at', 'Property', 'Property ID', 'FB account',
  'Last posted', 'Last posted by', 'Next allowed', 'Handled by', 'Handled at',
];
const LINK = 'https://www.facebook.com/groups/apg/posts/900/';
// 2:10 PM in Manila.
const LOGGED_AT = '2026-03-10T06:10:00Z';

/** Ana posts Casa Amara on 10 Mar; Jan's post of it, kept on his PC, comes in later that day. */
function retried(fields: Readonly<Record<string, unknown>> = {}) {
  const w = createWorld();
  w.project.clock.set('2026-03-10 09:00');
  expect(w.logPost('ana', CASA)).toMatchObject({ ok: true });
  w.project.clock.set('2026-03-10 16:00');
  const reply = w.logPost('jan', CASA, { postLink: LINK, loggedAt: LOGGED_AT, ...fields });
  return { w, reply };
}

describe('a retry inside the cooldown', () => {
  it('is refused, worded for a post already made, and says the admin has it', () => {
    const { w, reply } = retried();

    expect(reply).toEqual({
      ok: false,
      error: 'cooldown',
      lastPosted: '2026-03-10',
      nextAllowed: '2026-03-17',
      lastPostedBy: PEOPLE.ana.name,
      reported: true,
      message:
        'Logged 10 Mar at 2:10 PM, but Ana Reyes posted it on 10 Mar, inside the cooldown of 7 days. ' +
        'It is on Facebook but not on the tracker. Your admin has been told.',
    });
    // The cooldown still decides: nothing on the tracker.
    expect(w.posts.lastRow).toBe(2);
  });

  it('is written on the Refused posts tab, with who posted it last', () => {
    const { w } = retried();
    const tab = w.admin.sheet('Refused posts');

    expect(tab.row(1)).toEqual(HEADERS);
    expect(tab.row(2)).toEqual([
      'groups/apg/posts/900', LINK, PEOPLE.jan.name, '2026-03-10T14:10:00+08:00', CASA.name, CASA.id, 'APG Main',
      '2026-03-10', PEOPLE.ana.name, '2026-03-17', '', '',
    ]);
  });

  it('says "you" when the earlier post was your own', () => {
    const w = createWorld();
    w.project.clock.set('2026-03-10 09:00');
    w.logPost('jan', CASA);
    w.project.clock.set('2026-03-10 16:00');
    const reply = w.logPost('jan', CASA, { postLink: LINK, loggedAt: LOGGED_AT });

    expect(reply['message']).toMatch(/^Logged 10 Mar at 2:10 PM, but you posted it on 10 Mar,/);
  });

  it('is written once, however often it is sent', () => {
    const { w } = retried();
    w.logPost('jan', CASA, { postLink: 'https://m.facebook.com/groups/apg/permalink/900/', loggedAt: LOGGED_AT });

    expect(w.admin.sheet('Refused posts').lastRow).toBe(2);
  });

  it('is not written for a first try, which the agent sees at once', () => {
    const w = createWorld();
    w.logPost('ana', CASA);
    const reply = w.logPost('jan', CASA, { postLink: LINK });

    expect(reply).toMatchObject({ ok: false, error: 'cooldown' });
    expect(reply).not.toHaveProperty('reported');
    expect(reply['message']).toMatch(/^Posted today/);
    expect(() => w.admin.sheet('Refused posts')).toThrow(/No tab Refused posts/);
  });

  it('is not written when the retry is outside the cooldown: it is saved', () => {
    const w = createWorld();
    w.project.clock.set('2026-03-10 16:00');
    expect(w.logPost('jan', LOT_9, { postLink: LINK, loggedAt: LOGGED_AT })).toMatchObject({ ok: true });
    expect(() => w.admin.sheet('Refused posts')).toThrow(/No tab Refused posts/);
  });
});

describe('refusedPosts and handleRefused', () => {
  it('lists every refused post', () => {
    const { w } = retried();

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

  it('lists none before the first', () => {
    expect(createWorld().call('maria', 'refusedPosts')).toEqual({ ok: true, refused: [] });
  });

  it('marks one handled, by who and when, from any copy of its link', () => {
    const { w } = retried();
    const postsBefore = w.posts.lastRow;
    const reply = w.call('rico', 'handleRefused', { postLink: 'https://www.facebook.com/groups/APG/permalink/900?ref=x' });

    expect(reply).toMatchObject({ ok: true, refused: { postKey: 'groups/apg/posts/900', handledBy: PEOPLE.rico.name } });
    expect((reply['refused'] as { handledAt: string }).handledAt).toMatch(/^2026-03-10T16:00:00\+08:00$/);
    expect(w.admin.sheet('Refused posts').row(2).slice(10, 12)).toEqual([PEOPLE.rico.name, '2026-03-10T16:00:00+08:00']);
    // The tracker is left as it was.
    expect(w.posts.lastRow).toBe(postsBefore);
  });

  it("refuses a link that isn't a post's, and a post that isn't on the list", () => {
    const { w } = retried();
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
    const { w } = retried();
    expect(w.call('jan', 'refusedPosts')).toMatchObject({ ok: false, error: 'forbidden' });
    expect(w.call('jan', 'handleRefused', { postLink: LINK })).toMatchObject({ ok: false, error: 'forbidden' });
  });
});

describe("the app's client, against this server", () => {
  it('reads the refusal as reported, and the admin lists and handles it', async () => {
    const w = createWorld();
    w.project.clock.set('2026-03-10 09:00');
    w.logPost('ana', CASA);
    w.project.clock.set('2026-03-10 16:00');

    const err = await w
      .app('jan')
      .tracker.logPost({
        propertyId: CASA.id,
        propertyName: CASA.name,
        fbAccount: 'APG Main',
        postLink: LINK,
        status: 'Posted',
        loggedAt: LOGGED_AT,
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'cooldown', reported: true, lastPostedBy: PEOPLE.ana.name, nextAllowed: '2026-03-17' });

    const admin = w.app('maria').tracker;
    const [post] = await admin.refusedPosts();
    expect(post).toMatchObject({ postKey: 'groups/apg/posts/900', agent: PEOPLE.jan.name, handledBy: '' });
    expect(await admin.handleRefused(post!)).toMatchObject({ handledBy: PEOPLE.maria.name });
  });
});
