/**
 * The tracker's FB Group column (v17, AID-197): where a post went, read from
 * its link. Added after the tab's last column on the first post that has a
 * group; a post whose link doesn't say leaves it blank.
 */

import { describe, expect, it } from 'vitest';
import { CASA, createWorld, LOT_9, TOWER } from './world';

/** The FB Group cell of a Posts row, by its header. */
function groupOf(w: ReturnType<typeof createWorld>, row: number): string | undefined {
  const at = w.posts.row(1).indexOf('FB Group');
  return at === -1 ? undefined : w.posts.row(row)[at];
}

describe('the FB Group column', () => {
  it.each([
    ['https://www.facebook.com/groups/apgmain/posts/111/', 'apgmain'],
    ['https://m.facebook.com/groups/APGMain/permalink/112?ref=share', 'apgmain'],
    ['https://www.facebook.com/groups/1234567890123/posts/113/', '1234567890123'],
    ['https://www.facebook.com/marketplace/item/9988/', 'Marketplace'],
  ])('is filled from the link %j as %j', (postLink, group) => {
    const w = createWorld();
    expect(w.logPost('jan', CASA, { postLink })).toMatchObject({ ok: true });
    expect(groupOf(w, 2)).toBe(group);
  });

  it('is added once, after the last column, on the first post with a group', () => {
    const w = createWorld();
    const before = w.posts.row(1).length;
    w.logPost('jan', CASA);
    w.logPost('ana', LOT_9);

    expect(w.posts.row(1)).toHaveLength(before + 1);
    expect(w.posts.row(1)[before]).toBe('FB Group');
    expect(w.posts.row(1).filter((h) => h === 'FB Group')).toHaveLength(1);
    expect([groupOf(w, 2), groupOf(w, 3)]).toEqual(['apg', 'apg']);
  });

  it("is left blank, and not added, when the link doesn't say: a page's post, a share link, a photo", () => {
    const w = createWorld();
    w.logPost('jan', CASA, { postLink: 'https://www.facebook.com/AlphaPremier/posts/555/' });
    w.logPost('ana', LOT_9, { postLink: 'https://www.facebook.com/share/p/AbC123/' });
    w.logPost('jan', TOWER, { postLink: 'https://www.facebook.com/photo.php?fbid=777' });

    expect(w.posts.row(1)).not.toContain('FB Group');
  });

  it('uses a tab that already has the column, wherever it is', () => {
    const w = createWorld();
    const tab = w.tracker.addSheet('With group', ['Date', 'FB Group', 'Title', 'Status', 'Post Link', 'Posted By']);
    w.project.configure({ POSTS_TAB: 'With group' });
    w.logPost('jan', CASA);

    expect(tab.row(1)).toHaveLength(6);
    expect(tab.row(2)[1]).toBe('apg');
  });

  it('is filled when a pending post gets its live link', () => {
    const w = createWorld();
    w.logPost('jan', CASA, { status: 'Pending', postLink: 'https://www.facebook.com/AlphaPremier/posts/1/' });
    expect(w.posts.row(1)).not.toContain('FB Group');

    const live = 'https://www.facebook.com/groups/rentals.ph/posts/42/';
    expect(w.call('jan', 'addLink', { property: CASA.name, propertyId: CASA.id, postLink: live })).toMatchObject({ ok: true });
    expect(groupOf(w, 2)).toBe('rentals.ph');
  });

  it('comes back with the posts', () => {
    const w = createWorld();
    w.logPost('jan', CASA);
    expect(w.call('maria', 'posts')['posts']).toMatchObject([{ title: CASA.name, fbGroup: 'apg' }]);
  });
});
