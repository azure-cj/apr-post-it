/**
 * Highlights (v19, 1.1.6): listings an admin wants advertised now. Kept on the
 * admin sheet's own Highlights tab, one row per listing, until an admin takes
 * it off. Every agent reads them; only an admin changes them. A listing's
 * detail also says when anyone last posted it, for the "Posted recently" warning.
 */

import { describe, expect, it } from 'vitest';
import { CASA, createWorld, PEOPLE, TOWER } from './world';

describe('highlights and setHighlight', () => {
  it('starts empty, and an admin highlights a listing with a note', () => {
    const w = createWorld();
    w.project.clock.set('2026-03-10 09:00');
    expect(w.call('jan', 'highlights')).toEqual({ ok: true, highlights: [] });

    const reply = w.call('maria', 'setHighlight', { propertyId: CASA.id, property: CASA.name, on: true, note: '  Owner wants it\n out  ' });
    expect(reply).toMatchObject({ ok: true });
    const one = { propertyId: CASA.id, property: CASA.name, note: 'Owner wants it out', by: PEOPLE.maria.name };
    expect(reply['highlights']).toEqual([expect.objectContaining(one)]);
    expect(w.call('jan', 'highlights')['highlights']).toEqual([expect.objectContaining(one)]);
    expect(w.admin.sheet('Highlights').show()[0]).toEqual(['Property ID', 'Property', 'Note', 'Highlighted by', 'Highlighted at']);
  });

  it('keeps one row per listing: highlighting again changes the note', () => {
    const w = createWorld();
    w.call('maria', 'setHighlight', { propertyId: CASA.id, property: CASA.name, on: true, note: 'first' });
    w.call('rico', 'setHighlight', { propertyId: CASA.id, property: CASA.name, on: true, note: 'second' });
    const list = w.call('jan', 'highlights')['highlights'] as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ note: 'second', by: PEOPLE.rico.name });
  });

  it('lists the newest first, and takes one off when it is removed', () => {
    const w = createWorld();
    w.call('maria', 'setHighlight', { propertyId: CASA.id, property: CASA.name, on: true });
    w.call('maria', 'setHighlight', { propertyId: TOWER.id, property: TOWER.name, on: true });
    const ids = () => (w.call('jan', 'highlights')['highlights'] as { propertyId: string }[]).map((h) => h.propertyId);
    expect(ids()).toEqual([TOWER.id, CASA.id]);

    expect(w.call('maria', 'setHighlight', { propertyId: CASA.id, on: false })).toMatchObject({ ok: true });
    expect(ids()).toEqual([TOWER.id]);
    // Removing one that isn't there is no harm.
    expect(w.call('maria', 'setHighlight', { propertyId: CASA.id, on: false })).toMatchObject({ ok: true });
    expect(ids()).toEqual([TOWER.id]);
  });

  it('refuses a note longer than 280 characters, and writes nothing', () => {
    const w = createWorld();
    expect(w.call('maria', 'setHighlight', { propertyId: CASA.id, on: true, note: 'x'.repeat(281) })).toMatchObject({ ok: false, error: 'too-long' });
    expect(w.call('jan', 'highlights')).toEqual({ ok: true, highlights: [] });
  });

  it('lets an agent read them but never change them', () => {
    const w = createWorld();
    expect(w.call('jan', 'setHighlight', { propertyId: CASA.id, on: true })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(w.admin.has('Highlights')).toBe(false);
  });

  it('round-trips through the app: set, read, remove', async () => {
    const w = createWorld();
    const admin = w.app('maria').tracker;
    expect(await admin.setHighlight({ propertyId: CASA.id, property: CASA.name, on: true, note: 'Rush' })).toEqual([
      expect.objectContaining({ propertyId: CASA.id, property: CASA.name, note: 'Rush', by: PEOPLE.maria.name }),
    ]);
    expect(await w.app('jan').tracker.highlights()).toHaveLength(1);
    expect(await admin.setHighlight({ propertyId: CASA.id, property: CASA.name, on: false })).toEqual([]);
  });
});

describe("a listing's detail says when anyone last posted it (v19)", () => {
  it("tells Jan about Ana's post, which his own posts can't show him", () => {
    const w = createWorld();
    w.project.clock.set('2026-03-10 09:00');
    w.logPost('ana', CASA);
    const property = w.call('jan', 'property', { id: CASA.id })['property'] as Record<string, unknown>;
    expect(property['lastPosted']).toEqual({ date: '2026-03-10', by: PEOPLE.ana.name });
    // Jan's own posts reply holds none of Ana's.
    expect(w.call('jan', 'posts')['posts']).toEqual([]);
  });

  it('is absent for a listing nobody has posted', () => {
    const w = createWorld();
    const property = w.call('jan', 'property', { id: TOWER.id })['property'] as Record<string, unknown>;
    expect(property).not.toHaveProperty('lastPosted');
  });
});
