/**
 * The demo stands in for Google in the browser, so it must keep the server's
 * promises: an intern gets no internal text and none of an unseparated
 * document, the cooldown refuses with a sentence and a date, and the library
 * covers what the screens have to show.
 */

import { createBackend } from '../core/backend';
import { createDirectory } from '../core/directory';
import { createTracker } from '../core/tracker';
import { runChecks } from '../core/checks';
import { BackendError } from '../core/backend';
import { createDemoPlatform, DEMO_URL } from './demo-data';

const NOW = Date.parse('2026-10-31T02:00:00Z'); // 10:00 in Manila

function connect(key: string) {
  const platform = createDemoPlatform({ instant: true, now: () => NOW, signedInAs: key });
  const backend = createBackend({ post: platform.post, getConfig: () => ({ url: DEMO_URL, key }) });
  return { platform, backend, directory: createDirectory({ backend }), tracker: createTracker({ backend }) };
}

describe('the demo web app', () => {
  it('has about 25 listings across the four categories, with Lot as a sub-category', async () => {
    const { directory } = connect('intern');
    const list = await directory.list();
    expect(list.length).toBe(25);
    expect(directory.facets().categories.map((c) => c.label)).toEqual([
      'COMMERCIAL SPACE',
      'CONDO / HOUSE AND LOT',
      'OFFICE SPACE',
      'WAREHOUSE',
    ]);
    expect(list.some((p) => p.subCategory === 'Lot')).toBe(true);
    // "For sale" and "FOR SALE" are one listing type.
    expect(directory.facets().listingTypes.map((t) => t.key)).toEqual(['for lease for rent', 'for sale']);
    expect(list.filter((p) => p.hasIssues).length).toBeGreaterThanOrEqual(3);
  });

  it('cuts its documents at separators of every kind', async () => {
    const { directory } = connect('manager');
    const kinds = new Set<string>();
    for (const p of await directory.list()) {
      const detail = await directory.detail(p.id);
      if (detail.cutAt) kinds.add(detail.cutAt.replace(/:.*/, ''));
    }
    expect([...kinds].sort()).toEqual(['--- line', '__ line', 'bar line', 'equals line', 'heading', 'inline __']);
  });

  it('withholds the one unseparated document from an intern, and shows it whole to a manager', async () => {
    const intern = connect('intern');
    const list = await intern.directory.list();
    const unseparated = [];
    for (const p of list) {
      const detail = await intern.directory.detail(p.id);
      if (!detail.hasInternal) unseparated.push(detail);
    }
    // Seaside has no separator; Meycauayan has no document at all.
    expect(unseparated.map((d) => d.name).sort()).toEqual([
      'Meycauayan Warehouse with Office, Bulacan',
      'Seaside Residences 2BR, Pasay',
    ]);
    for (const d of unseparated) expect(d.publicText).toBe('');

    const manager = connect('manager');
    await manager.directory.list();
    const seaside = await manager.directory.detail(unseparated.find((d) => d.name.startsWith('Seaside'))!.id);
    expect(seaside.publicText).toContain('0918 555 0135');
  });

  it('never sends an intern internal text', async () => {
    const { directory } = connect('intern');
    for (const p of await directory.list()) {
      const detail = await directory.detail(p.id);
      expect('internalText' in detail).toBe(false);
      expect(detail.publicText).not.toMatch(/Owner:|Commission/);
    }
  });

  it('has public text that passes, warns and fails the checks', async () => {
    const { directory } = connect('intern');
    const statuses = new Set<string>();
    for (const p of await directory.list()) {
      const detail = await directory.detail(p.id);
      if (!detail.hasInternal) continue;
      for (const check of runChecks(detail)) statuses.add(`${check.name}: ${check.status}`);
    }
    expect(statuses).toContain('No commission wording: fail');
    expect(statuses).toContain('Price present: warn');
    expect(statuses).toContain('Contact numbers present: warn');
    expect(statuses).toContain('Internal section hidden: pass');
  });

  it('refuses a post inside the cooldown with a sentence and the next allowed date', async () => {
    const { directory, tracker } = connect('intern');
    const villa = (await directory.list()).find((p) => p.name.startsWith('Villa Rosario'))!;
    const refusal = await tracker
      .logPost({ propertyId: villa.id, propertyName: villa.name, fbAccount: 'APG Main', postLink: '' })
      .then(() => null, (err: unknown) => err);
    expect(refusal).toBeInstanceOf(BackendError);
    expect((refusal as BackendError).code).toBe('cooldown');
    expect((refusal as BackendError).message).toBe('Posted 3 days ago by Bea Ramos. You can post it again on Wed 4 Nov.');
    expect((refusal as BackendError).nextAllowed).toBe('2026-11-04');
  });

  it("shows an intern only their own posts and queue, and logs a post under the key's name", async () => {
    const { directory, tracker } = connect('intern');
    expect(new Set((await tracker.posts()).map((p) => p.postedBy))).toEqual(new Set(['Jan Dela Cruz']));
    const queue = (await tracker.assignments()).filter((a) => a.date === '2026-10-31');
    expect(queue.map((a) => a.status)).toEqual(['To post', 'Posted', 'Pending', 'To post', 'Posted', 'To post', 'To post']);

    const lot12 = (await directory.list()).find((p) => p.name.startsWith('Verdant Hills Lot 12'))!;
    const logged = await tracker.logPost({
      propertyId: lot12.id,
      propertyName: lot12.name,
      fbAccount: 'APG Main',
      postLink: 'https://www.facebook.com/groups/apgmain/posts/1/',
    });
    expect(logged).toMatchObject({ status: 'Posted', postedBy: 'Jan Dela Cruz', date: '2026-10-31' });
    const after = (await tracker.assignments()).find((a) => a.propertyId === lot12.id);
    expect(after?.status).toBe('Posted');
  });

  it('answers only to the keys it knows', async () => {
    const { backend } = connect('nobody');
    await expect(backend.call('ping')).rejects.toThrow("That key isn't on the team.");
  });
});
