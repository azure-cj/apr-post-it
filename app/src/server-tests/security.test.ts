/**
 * The boundaries that must hold even against a tampered client (docs/ROLES.md):
 * an intern never receives the internal section (D1) or text nobody has
 * separated (D13); a role is the key's, never the request's (D2); a revoked
 * key stops working.
 */

import { describe, expect, it } from 'vitest';
import { CASA, createWorld, LISTINGS, LOT_9, PEOPLE, PRIVATE, TOWER } from './world';

const LINK = 'https://www.facebook.com/groups/apg/posts/1/';

describe('an intern\'s property reply carries nothing private (D1)', () => {
  it.each(LISTINGS.map((l) => [l.name, l] as const))('%s, read live from the document', (_name, listing) => {
    const w = createWorld();
    const text = w.project.postText({ action: 'property', id: listing.id, key: PEOPLE.jan.key });
    const reply = JSON.parse(text) as { ok: boolean; property: Record<string, unknown> };

    expect(reply.ok).toBe(true);
    expect(reply.property['live']).toBe(true);
    expect(reply.property).not.toHaveProperty('internalText');
    for (const secret of PRIVATE[listing.id]!) expect(text).not.toContain(secret);
  });

  it.each(LISTINGS.map((l) => [l.name, l] as const))('%s, from the sheet\'s copy when the document cannot be read', (_name, listing) => {
    const w = createWorld();
    w.project.drive.remove(listing.docId);
    const text = w.project.postText({ action: 'property', id: listing.id, key: PEOPLE.jan.key });
    const reply = JSON.parse(text) as { ok: boolean; property: Record<string, unknown> };

    expect(reply.property['live']).toBe(false);
    expect(reply.property).not.toHaveProperty('internalText');
    for (const secret of PRIVATE[listing.id]!) expect(text).not.toContain(secret);
  });

  it('whatever the request asks for: internal=true is not the client\'s to decide', () => {
    const w = createWorld();
    const byGet = w.project.get({ action: 'property', id: CASA.id, key: PEOPLE.jan.key, internal: 'true' });
    const byPost = w.call('jan', 'property', { id: CASA.id, internal: true, includeInternal: true, role: 'Admin' });

    for (const reply of [byGet, byPost]) {
      expect(reply['property']).not.toHaveProperty('internalText');
      expect(JSON.stringify(reply)).not.toContain('0917 123 4567');
    }
  });

  it('tells an intern the kind of marker only, never the heading it quotes', () => {
    const w = createWorld();

    expect(w.call('jan', 'property', { id: TOWER.id })['property']).toMatchObject({ cutAt: 'heading', hasInternal: true });
    expect(w.call('maria', 'property', { id: TOWER.id })['property']).toMatchObject({
      cutAt: 'heading: Commission: 1 month, net to owner PHP 40',
      internalText: 'Commission: 1 month, net to owner PHP 40,000\nOwner Mrs. Lim 0917 555 0000',
    });
  });

  it('while a manager gets the internal section, to work from', () => {
    const w = createWorld();

    expect(w.call('maria', 'property', { id: CASA.id })['property']).toMatchObject({
      publicText: 'FOR SALE: Casa Amara, Antipolo\nPrice: PHP 8,500,000\n3 bedrooms, 2 baths\nCall 0917 000 1111',
      internalText: 'Owner: Mr. Reyes 0917 123 4567\nCommission: 3%',
      hasInternal: true,
      withheld: false,
      cutAt: '--- line',
    });
  });
});

describe('a document nobody has separated (D6, D13)', () => {
  it('reaches an intern as empty publicText, withheld', () => {
    const w = createWorld();

    expect(w.call('jan', 'property', { id: LOT_9.id })['property']).toMatchObject({
      publicText: '',
      withheld: true,
      hasInternal: false,
      live: true,
    });
  });

  it('is withheld from the sheet\'s copy too, which holds the whole document', () => {
    const w = createWorld();
    w.project.drive.remove(LOT_9.docId);

    expect(w.call('ana', 'property', { id: LOT_9.id })['property']).toMatchObject({ publicText: '', withheld: true, live: false });
  });

  it.each(['maria', 'rico'] as const)('reaches a %s whole, to fix it', (person) => {
    const w = createWorld();

    expect(w.call(person, 'property', { id: LOT_9.id })['property']).toMatchObject({
      publicText: LOT_9.doc.join('\n'),
      internalText: '',
      withheld: false,
      hasInternal: false,
    });
  });
});

describe('Separators.gs is required', () => {
  it('without it, opening a property fails and says why, rather than quietly using the sheet\'s copy', () => {
    const w = createWorld({ files: ['Code.gs', 'BuildDirectory.gs'] });

    expect(w.call('jan', 'property', { id: CASA.id })).toEqual({
      ok: false,
      error: expect.stringMatching(/^Separators\.gs is missing from this Apps Script project/),
    });
  });

  it('SETUP checks for it first', () => {
    const w = createWorld({ files: ['Code.gs'] });

    expect(() => w.project.run('SETUP')).toThrow(/Separators\.gs is missing/);
  });
});

describe('a role is the key\'s, never the request\'s (D2)', () => {
  it('an intern cannot saveQueue', () => {
    const w = createWorld();
    w.assignments.type(['2026-03-09', 'Jan Dela Cruz', 'Casa Amara', 'To post', CASA.id]);
    const before = w.assignments.show();

    expect(w.call('jan', 'saveQueue', { date: '2026-03-09', assignedTo: 'Jan Dela Cruz', items: [], role: 'Admin' })).toEqual({
      ok: false,
      error: 'forbidden',
      message: 'Your account cannot do that.',
    });
    expect(w.assignments.show()).toEqual(before);
  });

  it('an admin can', () => {
    const w = createWorld();

    expect(w.call('maria', 'saveQueue', { date: '2026-03-09', assignedTo: 'Jan Dela Cruz', items: [{ property: CASA.name }] })).toEqual({
      ok: true,
      saved: 1,
    });
  });

  it('Posted By comes from the key, not the request', () => {
    const w = createWorld();

    expect(w.logPost('jan', CASA, { postedBy: 'Maria Santos' })).toMatchObject({ ok: true, postedBy: 'Jan Dela Cruz' });
    expect(w.posts.row(2)[7]).toBe('Jan Dela Cruz');
  });

  it('an admin may log a post for an intern, by name', () => {
    const w = createWorld();

    expect(w.logPost('maria', CASA, { postedBy: 'Jan Dela Cruz' })).toMatchObject({ ok: true, postedBy: 'Jan Dela Cruz' });
    expect(w.posts.row(2)[7]).toBe('Jan Dela Cruz');
  });

  it('an intern sees only their own rows, and only their own queue', () => {
    const w = createWorld();
    w.posts.type(
      ['2026-03-01', 'Casa Amara', '', '', 'Posted', '', LINK, 'Ana Reyes', CASA.id],
      ['2026-03-02', '1201', '', '', 'Posted', '', LINK, 'Jan Dela Cruz', TOWER.id],
    );
    w.assignments.type(['2026-03-09', 'Ana Reyes', 'Casa Amara', 'To post', ''], ['2026-03-09', 'Jan Dela Cruz', '1201', 'To post', '']);

    expect(w.call('jan', 'posts')['posts']).toMatchObject([{ title: '1201', postedBy: 'Jan Dela Cruz' }]);
    expect(w.call('jan', 'assignments')['assignments']).toMatchObject([{ property: '1201', assignedTo: 'Jan Dela Cruz' }]);
    expect(w.call('maria', 'posts')['posts']).toHaveLength(2);
  });

  it('an intern may not move another intern\'s queue item', () => {
    const w = createWorld();
    w.assignments.type(['2026-03-09', 'Ana Reyes', 'Casa Amara', 'To post', CASA.id]);

    expect(w.call('jan', 'setStatus', { property: CASA.name, assignedTo: 'Ana Reyes', status: 'Posted' })).toMatchObject({
      ok: false,
      error: 'forbidden',
    });
    expect(w.assignments.row(2)[3]).toBe('To post');
  });

  it('an intern may post only from the Facebook accounts on their row', () => {
    const w = createWorld();

    expect(w.logPost('jan', CASA, { fbAccount: 'Someone Else\'s Page' })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(w.posts.lastRow).toBe(1);
  });
});

describe('two roles (D14)', () => {
  it('treats a Team row that still says "Manager", the old middle role, as Admin', () => {
    const w = createWorld();
    w.team.type(['Old Manager', '', 'Manager', 'key-old-manager', '', 'TRUE']);
    const call = (action: string, extra: Record<string, unknown> = {}) =>
      w.project.post({ action, key: 'key-old-manager', ...extra });

    expect(call('ping')).toMatchObject({ ok: true, name: 'Old Manager', role: 'Admin' });
    expect(call('saveQueue', { date: '2026-03-09', assignedTo: 'Jan Dela Cruz', items: [{ property: CASA.name }] })).toEqual({
      ok: true,
      saved: 1,
    });
    expect(call('property', { id: CASA.id })['property']).toHaveProperty('internalText');
  });

  it('treats any other role, blank included, as Intern', () => {
    const w = createWorld();
    w.team.type(['Someone', '', 'Supervisor', 'key-someone', '', 'TRUE'], ['Nobody', '', '', 'key-nobody', '', 'TRUE']);

    for (const key of ['key-someone', 'key-nobody']) {
      expect(w.project.post({ action: 'ping', key })).toMatchObject({ ok: true, role: 'Intern' });
      expect(w.project.post({ action: 'saveQueue', key, date: '2026-03-09', assignedTo: 'Jan Dela Cruz', items: [] })).toMatchObject({
        ok: false,
        error: 'forbidden',
      });
    }
  });
});

describe('keys', () => {
  it('refuses a revoked key', () => {
    const w = createWorld();

    expect(w.call('gone', 'ping')).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(w.call('gone', 'property', { id: CASA.id })).toMatchObject({ ok: false, error: 'unauthorized' });
  });

  it('refuses a key revoked while it was in use, once the minute the Team tab is cached for is up', () => {
    const w = createWorld();
    expect(w.call('jan', 'ping')).toMatchObject({ ok: true, name: 'Jan Dela Cruz' });

    w.team.typeAt(2, 6, 'FALSE');
    w.project.clock.advance(59_000);
    expect(w.call('jan', 'ping')).toMatchObject({ ok: true }); // the cached Team tab, as documented
    w.project.clock.advance(2_000);
    expect(w.call('jan', 'ping')).toMatchObject({ ok: false, error: 'unauthorized' });
  });

  it('refuses an unknown key and a missing one', () => {
    const w = createWorld();

    expect(w.project.post({ action: 'ping', key: 'guess' })).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(w.project.post({ action: 'ping' })).toMatchObject({ ok: false, error: 'unauthorized' });
  });

  it('honours the setup key only until the Team tab has its first person', () => {
    const w = createWorld();
    // A private admin spreadsheet with nothing in it yet.
    const fresh = w.project.sheets.create('fresh-admin');
    w.project.configure({ ADMIN_SHEET_ID: 'fresh-admin', SHARED_KEY: 'setup-key' });

    expect(w.project.post({ action: 'ping', key: 'setup-key' })).toMatchObject({ ok: true, name: 'Setup', role: 'Admin' });
    expect(fresh.tabs()).toEqual(['Team']);

    const key = w.project.run('ADD_PERSON') as string;

    expect(w.project.post({ action: 'ping', key: 'setup-key' })).toMatchObject({ ok: false, error: 'unauthorized' });
    // The first person in is the admin who assigns the postings (D14).
    expect(w.project.post({ action: 'ping', key })).toMatchObject({ ok: true, name: 'Jan Dela Cruz', role: 'Admin' });
    // Written as text: a key, a name or a flag is never evaluated (D7).
    expect(fresh.sheet('Team').row(2)).toEqual(['Jan Dela Cruz', '', 'Admin', key, '', 'TRUE']);
    expect(fresh.sheet('Team').formats(2)).toEqual(['@', '@', '@', '@', '@', '@']);
  });
});
