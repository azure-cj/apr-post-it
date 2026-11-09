/**
 * Spot checks (v16): an admin says what they found on opening one of an
 * agent's posts. Kept on the admin sheet's own Spot checks tab, one row per
 * post; the tracker is not changed. Admins only.
 */

import { describe, expect, it } from 'vitest';
import { CASA, createWorld, LOT_9, PEOPLE } from './world';

const HEADERS = ['Post', 'Link', 'Agent', 'Posted', 'Property', 'Property ID', 'Result', 'Checked by', 'Checked at'];
const LINK = 'https://www.facebook.com/groups/apg/posts/1/';

function logged() {
  const w = createWorld();
  expect(w.logPost('jan', CASA)).toMatchObject({ ok: true });
  return w;
}

describe('saveSpotCheck', () => {
  it("writes the post's agent, day and listing from the tracker, with who checked", () => {
    const w = logged();
    const postsBefore = w.posts.lastRow;
    const reply = w.call('maria', 'saveSpotCheck', { postLink: LINK, result: 'Verified' });

    expect(reply).toMatchObject({
      ok: true,
      check: {
        postKey: 'groups/apg/posts/1',
        link: LINK,
        agent: PEOPLE.jan.name,
        property: CASA.name,
        propertyId: CASA.id,
        result: 'Verified',
        checkedBy: PEOPLE.maria.name,
      },
    });
    const tab = w.admin.sheet('Spot checks');
    expect(tab.row(1)).toEqual(HEADERS);
    expect(tab.row(2).slice(0, 8)).toEqual([
      'groups/apg/posts/1',
      LINK,
      PEOPLE.jan.name,
      (reply['check'] as { posted: string }).posted,
      CASA.name,
      CASA.id,
      'Verified',
      PEOPLE.maria.name,
    ]);
    expect((reply['check'] as { posted: string }).posted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The tracker itself is left as it was.
    expect(w.posts.lastRow).toBe(postsBefore);
    expect(w.posts.row(1)).not.toContain('Result');
  });

  it('finds the post from any copy of its link, and checking again replaces the result', () => {
    const w = logged();
    w.call('maria', 'saveSpotCheck', { postLink: LINK, result: 'Verified' });
    const again = w.call('rico', 'saveSpotCheck', { postLink: 'https://m.facebook.com/groups/APG/permalink/1?ref=share', result: 'Not found' });

    expect(again).toMatchObject({ ok: true, check: { result: 'Not found', checkedBy: PEOPLE.rico.name } });
    const tab = w.admin.sheet('Spot checks');
    expect(tab.lastRow).toBe(2);
    expect(tab.row(2)[6]).toBe('Not found');
  });

  it('lists every check with spotChecks', () => {
    const w = logged();
    expect(w.logPost('ana', LOT_9)).toMatchObject({ ok: true });
    w.call('maria', 'saveSpotCheck', { postLink: LINK, result: 'Verified' });
    w.call('maria', 'saveSpotCheck', { postLink: 'https://www.facebook.com/groups/apg/posts/2/', result: 'Wrong listing' });

    const reply = w.call('maria', 'spotChecks');
    expect(reply).toMatchObject({ ok: true });
    expect(reply['checks']).toEqual([
      expect.objectContaining({ postKey: 'groups/apg/posts/1', agent: PEOPLE.jan.name, result: 'Verified' }),
      expect.objectContaining({ postKey: 'groups/apg/posts/2', agent: PEOPLE.ana.name, property: LOT_9.name, result: 'Wrong listing' }),
    ]);
  });

  it('lists none before the first check', () => {
    const w = createWorld();
    expect(w.call('maria', 'spotChecks')).toEqual({ ok: true, checks: [] });
  });

  it.each([['Ok'], [''], ['verified ']])('refuses the result %j', (result) => {
    const w = logged();
    const reply = w.call('maria', 'saveSpotCheck', { postLink: LINK, result });
    expect(reply['ok']).toBe(false);
    if (result.trim()) expect(reply).toMatchObject({ error: 'bad-result' });
  });

  it("refuses a link that isn't a post's, and a post not on the tracker", () => {
    const w = logged();
    expect(w.call('maria', 'saveSpotCheck', { postLink: 'https://www.facebook.com/groups/apg', result: 'Verified' })).toMatchObject({
      ok: false,
      error: 'not-a-post',
    });
    expect(w.call('maria', 'saveSpotCheck', { postLink: 'https://www.facebook.com/groups/apg/posts/99/', result: 'Verified' })).toMatchObject({
      ok: false,
      error: 'notfound',
    });
    // Nothing written: not even the tab is made.
    expect(() => w.admin.sheet('Spot checks')).toThrow(/No tab Spot checks/);
  });

  it('is for admins only', () => {
    const w = logged();
    expect(w.call('jan', 'saveSpotCheck', { postLink: LINK, result: 'Verified' })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(w.call('jan', 'spotChecks')).toMatchObject({ ok: false, error: 'forbidden' });
  });
});
