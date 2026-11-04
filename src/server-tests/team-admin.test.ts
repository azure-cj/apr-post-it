/**
 * addPerson, setActive and newKey: running the Team tab from the app. A key is
 * handed out by addPerson and newKey and by nothing else, an old key dies at
 * once, and nobody can lock themselves out.
 */

import { describe, expect, it } from 'vitest';
import type { Reply } from './harness';
import { createWorld, PEOPLE, type World } from './world';

const KEY = /^[0-9a-f]{32}$/;

/** Every key on the Team tab now, read straight from the sheet. */
function keysOnTab(w: World): string[] {
  return w.team
    .show()
    .slice(1)
    .map((r) => String(r[3]).replace(/^#\w+ /, ''))
    .filter(Boolean);
}

describe('addPerson', () => {
  it('adds an intern, writes the row as text, and replies with the person and a key', () => {
    const w = createWorld();
    const reply = w.call('maria', 'addPerson', {
      name: '  Lia Gomez ',
      role: 'Intern',
      fbAccounts: ['APG Main', ' APG Leasing '],
      email: 'lia@apg.example',
    });

    expect(reply).toEqual({
      ok: true,
      person: {
        name: 'Lia Gomez',
        role: 'Intern',
        email: 'lia@apg.example',
        fbAccounts: ['APG Main', 'APG Leasing'],
        fbProfiles: [{ account: 'APG Main', link: '' }, { account: 'APG Leasing', link: '' }],
        fbProfileLink: '',
        active: true,
      },
      key: expect.stringMatching(KEY),
    });
    const row = w.team.lastRow;
    // The world's Team tab predates FB Profile Link: the column is added after Active.
    expect(w.team.row(row)).toEqual(['Lia Gomez', 'lia@apg.example', 'Intern', reply['key'], 'APG Main, APG Leasing', 'TRUE', '']);
    expect(w.team.formats(row)).toEqual(['@', '@', '@', '@', '@', '@', '@']);
  });

  it('gives a key that works at once, though the Team tab was cached a moment before', () => {
    const w = createWorld();
    expect(w.call('maria', 'ping')).toMatchObject({ ok: true });
    const { key } = w.call('maria', 'addPerson', { name: 'Lia Gomez', role: 'Admin' }) as { key: string };

    expect(w.project.post({ action: 'ping', key })).toMatchObject({ ok: true, name: 'Lia Gomez', role: 'Admin', fbAccounts: [] });
  });

  it('gives every person a different key', () => {
    const w = createWorld();
    const a = w.call('maria', 'addPerson', { name: 'A Person', role: 'Intern' })['key'];
    const b = w.call('maria', 'addPerson', { name: 'B Person', role: 'Intern' })['key'];

    expect(a).not.toBe(b);
  });

  it.each([['Jan Dela Cruz'], ['jan dela cruz'], ['  JAN DELA CRUZ  '], ['Former Intern']])(
    'refuses %j as a duplicate, revoked people included',
    (name) => {
      const w = createWorld();
      const before = w.team.show();

      expect(w.call('maria', 'addPerson', { name, role: 'Intern' })).toMatchObject({ ok: false, error: 'duplicate' });
      expect(w.team.show()).toEqual(before);
    },
  );

  it.each([['Manager'], ['Owner'], [''], [undefined], ['Admin, Intern']])('refuses the role %j', (role) => {
    const w = createWorld();
    const before = w.team.show();

    expect(w.call('maria', 'addPerson', { name: 'Lia Gomez', role })).toMatchObject({ ok: false, error: 'bad-role' });
    expect(w.team.show()).toEqual(before);
  });

  it('reads the role in any case and writes it as the server spells it', () => {
    const w = createWorld();

    expect(w.call('maria', 'addPerson', { name: 'Lia Gomez', role: 'intern' })).toMatchObject({ person: { role: 'Intern' } });
    expect(w.team.row(w.team.lastRow)[2]).toBe('Intern');
  });

  it('refuses a blank name', () => {
    const w = createWorld();

    expect(w.call('maria', 'addPerson', { name: '  ', role: 'Intern' })).toMatchObject({ ok: false, error: 'name-required' });
  });

  it('writes a name Sheets would evaluate as the text it is', () => {
    const w = createWorld();
    w.call('maria', 'addPerson', { name: '=1+1', role: 'Intern' });

    expect(w.team.row(w.team.lastRow)[0]).toBe('=1+1');
  });
});

describe('setActive', () => {
  it('revokes a person, whose key stops at once, and restores them', () => {
    const w = createWorld();
    expect(w.call('jan', 'ping')).toMatchObject({ ok: true }); // cached

    expect(w.call('maria', 'setActive', { name: 'Jan Dela Cruz', active: false })).toEqual({
      ok: true,
      person: { name: 'Jan Dela Cruz', role: 'Intern', email: '', fbAccounts: ['APG Main', 'APG Rentals'], fbProfiles: [{ account: 'APG Main', link: '' }, { account: 'APG Rentals', link: '' }], fbProfileLink: '', active: false },
    });
    expect(w.call('jan', 'ping')).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(w.team.row(2)[5]).toBe('FALSE');
    expect(w.team.formats(2)[5]).toBe('@');

    expect(w.call('maria', 'setActive', { name: 'jan dela cruz', active: true })).toMatchObject({ ok: true, person: { active: true } });
    expect(w.call('jan', 'ping')).toMatchObject({ ok: true, name: 'Jan Dela Cruz' });
  });

  it('refuses to deactivate yourself, however you spell your name', () => {
    const w = createWorld();

    expect(w.call('maria', 'setActive', { name: ' maria santos ', active: false })).toMatchObject({ ok: false, error: 'self' });
    expect(w.call('maria', 'ping')).toMatchObject({ ok: true });
  });

  it('lets another admin deactivate you', () => {
    const w = createWorld();

    expect(w.call('rico', 'setActive', { name: 'Maria Santos', active: false })).toMatchObject({ ok: true });
    expect(w.call('maria', 'ping')).toMatchObject({ ok: false, error: 'unauthorized' });
  });

  it('says notfound for a name not on the tab, and refuses an active that is not a boolean', () => {
    const w = createWorld();

    expect(w.call('maria', 'setActive', { name: 'Nobody', active: false })).toMatchObject({ ok: false, error: 'notfound' });
    expect(w.call('maria', 'setActive', { name: 'Jan Dela Cruz', active: 'no' })).toMatchObject({ ok: false, error: 'bad-active' });
    expect(w.call('maria', 'setActive', { name: 'Jan Dela Cruz' })).toMatchObject({ ok: false, error: 'bad-active' });
  });
});

describe('newKey', () => {
  it('replaces the key: the old one is dead at once, the new one works', () => {
    const w = createWorld();
    expect(w.call('jan', 'ping')).toMatchObject({ ok: true }); // cached

    const reply = w.call('maria', 'newKey', { name: 'Jan Dela Cruz' });

    expect(reply).toEqual({ ok: true, key: expect.stringMatching(KEY) });
    expect(w.project.post({ action: 'ping', key: PEOPLE.jan.key })).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(w.project.post({ action: 'ping', key: reply['key'] })).toMatchObject({ ok: true, name: 'Jan Dela Cruz' });
    expect(w.team.row(2)[3]).toBe(reply['key']);
    expect(w.team.formats(2)[3]).toBe('@');
  });

  it('says notfound for a name not on the tab', () => {
    const w = createWorld();

    expect(w.call('maria', 'newKey', { name: 'Nobody' })).toMatchObject({ ok: false, error: 'notfound' });
  });

  it('refuses when two rows share the name, rather than guess', () => {
    const w = createWorld();
    w.team.type(['Jan Dela Cruz', '', 'Intern', 'key-jan-2', '', 'TRUE']);

    expect(w.call('maria', 'newKey', { name: 'Jan Dela Cruz' })).toMatchObject({ ok: false, error: 'duplicate' });
    expect(w.project.post({ action: 'ping', key: PEOPLE.jan.key })).toMatchObject({ ok: true });
  });
});

describe('only an admin', () => {
  it.each([
    ['addPerson', { name: 'Sneaky', role: 'Admin' }],
    ['setActive', { name: 'Maria Santos', active: false }],
    ['newKey', { name: 'Maria Santos' }],
  ] as const)('%s is forbidden to an intern, whatever the request claims', (action, fields) => {
    const w = createWorld();
    const before = w.team.show();

    expect(w.call('jan', action, { ...fields, role: 'Admin' })).toEqual({
      ok: false,
      error: 'forbidden',
      message: 'Your account cannot do that.',
    });
    expect(w.team.show()).toEqual(before);
  });

  it('none of them is on the Intern list in PERMISSIONS', () => {
    const w = createWorld();
    const permissions = w.project.evaluate('PERMISSIONS') as Record<string, string[]>;

    for (const action of ['addPerson', 'setActive', 'newKey']) expect(permissions['Intern']).not.toContain(action);
  });
});

describe('keys never leak', () => {
  it('no reply but addPerson\'s and newKey\'s carries any key on the Team tab', () => {
    const w = createWorld();
    const replies: { action: string; text: string }[] = [];
    const send = (person: keyof typeof PEOPLE, action: string, fields: Record<string, unknown> = {}): Reply => {
      const text = w.project.postText({ ...fields, action, key: PEOPLE[person].key });
      replies.push({ action, text });
      return JSON.parse(text) as Reply;
    };

    // Everything an admin and an intern can ask, successes and refusals alike.
    send('maria', 'addPerson', { name: 'Lia Gomez', role: 'Intern', fbAccounts: ['APG Main'] });
    send('maria', 'addPerson', { name: 'Lia Gomez', role: 'Intern' }); // duplicate
    send('maria', 'newKey', { name: 'Ana Reyes' });
    send('maria', 'setActive', { name: 'Lia Gomez', active: false });
    send('maria', 'setActive', { name: 'Lia Gomez', active: true });
    send('maria', 'setActive', { name: 'Maria Santos', active: false }); // self
    send('maria', 'team');
    send('maria', 'ping');
    send('maria', 'posts');
    send('maria', 'assignments');
    send('maria', 'properties');
    send('maria', 'logPost', { property: 'Casa Amara', propertyId: 'F-casa', fbAccount: 'APG Main', postedBy: 'Lia Gomez',
      postLink: 'https://www.facebook.com/groups/apg/posts/1/', status: 'Posted' });
    send('maria', 'saveQueues', { date: '2026-03-09', queues: [{ assignedTo: 'Lia Gomez', items: [{ propertyName: '1201' }] }] });
    send('jan', 'ping');
    send('jan', 'team');
    send('jan', 'addPerson', { name: 'X', role: 'Admin' });
    send('jan', 'newKey', { name: 'Jan Dela Cruz' });

    const keys = keysOnTab(w);
    expect(keys.length).toBeGreaterThanOrEqual(Object.keys(PEOPLE).length + 1);
    const allowed = new Set(['addPerson', 'newKey']);
    for (const { action, text } of replies) {
      const reply = JSON.parse(text) as Reply;
      if (allowed.has(action) && reply['ok'] === true) continue;
      for (const key of keys) expect(text, `${action} carried a key`).not.toContain(key);
      expect(text, action).not.toMatch(/"key"/i);
    }
    // And each key-bearing reply carries exactly the one key it issued.
    for (const { action, text } of replies.filter((r) => allowed.has(r.action))) {
      const reply = JSON.parse(text) as Reply;
      if (reply['ok'] !== true) continue;
      expect(keys.filter((k) => text.includes(k)), action).toEqual([reply['key']]);
    }
  });
});
