/**
 * The `team` action: the Team tab for an Admin's screens, and never a key.
 * The Team tab is the one place every key is kept (D2, D3), so the reply is
 * searched for each of them, not just checked for a `key` field.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, PEOPLE } from './world';

const KEYS = Object.values(PEOPLE).map((p) => p.key);

describe('team', () => {
  it('gives an admin everyone on the Team tab, revoked people included', () => {
    const w = createWorld();

    expect(w.call('maria', 'team')).toEqual({
      ok: true,
      team: [
        { name: 'Jan Dela Cruz', role: 'Intern', email: '', fbAccounts: ['APG Main', 'APG Rentals'], active: true },
        { name: 'Ana Reyes', role: 'Intern', email: '', fbAccounts: [], active: true },
        { name: 'Maria Santos', role: 'Admin', email: '', fbAccounts: [], active: true },
        { name: 'Rico Bautista', role: 'Admin', email: '', fbAccounts: [], active: true },
        { name: 'Former Intern', role: 'Intern', email: '', fbAccounts: [], active: false },
      ],
    });
  });

  it('never carries a key, under any field name', () => {
    const w = createWorld();
    // A key of digits, which Sheets stores as a number, and one with an email beside it.
    w.team.type(['Digits Person', 'digits@example.com', 'Intern', '12345678901234', '', 'TRUE']);
    const text = w.project.postText({ action: 'team', key: PEOPLE.maria.key });

    expect(JSON.parse(text)).toMatchObject({ ok: true });
    for (const key of [...KEYS, '12345678901234']) expect(text).not.toContain(key);
    expect(text).not.toMatch(/"key"/i);
  });

  it('reads the role as roleOf_ does: Manager is Admin, anything else Intern', () => {
    const w = createWorld();
    w.team.type(['Old Manager', '', 'Manager', 'key-old', '', 'TRUE'], ['Someone', '', 'Supervisor', 'key-sup', '', '']);
    const team = w.call('maria', 'team')['team'] as { name: string; role: string; active: boolean }[];

    expect(team.find((t) => t.name === 'Old Manager')).toMatchObject({ role: 'Admin', active: true });
    // A blank Active is active, as identify() reads it.
    expect(team.find((t) => t.name === 'Someone')).toMatchObject({ role: 'Intern', active: true });
  });

  it('leaves out a row with no name', () => {
    const w = createWorld();
    w.team.type(['', 'nobody@example.com', 'Intern', 'key-nameless', '', 'TRUE']);
    const team = w.call('maria', 'team')['team'] as unknown[];

    expect(team).toHaveLength(Object.keys(PEOPLE).length);
  });

  it.each(['jan', 'ana'] as const)('is refused to an intern (%s), as every Admin action is', (person) => {
    const w = createWorld();

    expect(w.call(person, 'team')).toEqual({ ok: false, error: 'forbidden', message: 'Your account cannot do that.' });
  });

  it('is refused to a revoked key and an unknown one', () => {
    const w = createWorld();

    expect(w.call('gone', 'team')).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(w.project.post({ action: 'team', key: 'guess' })).toMatchObject({ ok: false, error: 'unauthorized' });
  });

  it('is not on the Intern list in PERMISSIONS: only Admin\'s "*" covers it', () => {
    const w = createWorld();
    const permissions = w.project.evaluate('PERMISSIONS') as Record<string, string[]>;

    expect(permissions['Intern']).not.toContain('team');
    expect(permissions['Admin']).toEqual(['*']);
  });

  it('reaches the app as TeamMembers, through tracker.team()', async () => {
    const w = createWorld();

    await expect(w.app('maria').tracker.team()).resolves.toEqual([
      { name: 'Jan Dela Cruz', role: 'Intern', email: '', fbAccounts: ['APG Main', 'APG Rentals'], active: true },
      { name: 'Ana Reyes', role: 'Intern', email: '', fbAccounts: [], active: true },
      { name: 'Maria Santos', role: 'Admin', email: '', fbAccounts: [], active: true },
      { name: 'Rico Bautista', role: 'Admin', email: '', fbAccounts: [], active: true },
      { name: 'Former Intern', role: 'Intern', email: '', fbAccounts: [], active: false },
    ]);
    await expect(w.app('jan').tracker.team()).rejects.toThrow();
  });
});
