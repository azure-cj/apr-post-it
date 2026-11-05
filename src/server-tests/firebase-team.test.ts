/**
 * The team from Firebase (v13): signed in by account, Post-It's people are
 * Alpha Listing Hub's (its listPeople, asked with the admin's sign-in). Agent is
 * Intern, admin or owner is Admin; a scanner or no role is left out. The Team
 * tab only keeps FB accounts and profile links, by email.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from './world';

const LOOKUP = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIzaSyCO7e6rg1geJWrjN1K_0-wX2ZiJek3kENQ';
const LIST_PEOPLE = 'https://asia-southeast1-apr-listing-live.cloudfunctions.net/listPeople';

const ACCOUNTS: Record<string, { email: string; displayName: string; role: string }> = {
  'token-boss': { email: 'thealphapremiergroup@gmail.com', displayName: 'APG', role: 'admin' },
  'token-cj': { email: 'cj@aureo.com', displayName: 'cj', role: 'agent' },
};

const PEOPLE = [
  { uid: 'u1', name: 'APG Admin', email: 'thealphapremiergroup@gmail.com', role: 'admin', active: true },
  { uid: 'u2', name: 'CJ', email: 'CJ@aureo.com', role: 'agent', active: true },
  { uid: 'u3', name: 'Off Agent', email: 'off@apg.test', role: 'agent', active: false },
  { uid: 'u4', name: 'Scanner', email: 'scan@apg.test', role: 'scanner', active: true },
  { uid: 'u5', name: 'No Role', email: 'none@apg.test', role: null, active: true },
];

function world(listPeople: { code: number; body: string } = { code: 200, body: JSON.stringify({ result: { people: PEOPLE } }) }) {
  const w = createWorld();
  // A sheet-only person (Maria and the others in createWorld are too): not on Firebase, so not on the team.
  w.team.type(['Sheet Only', 'sheet@apg.test', 'Intern', 'key-sheet', '', 'TRUE']);
  w.team.type(['CJ Aureo', 'cj@aureo.com', 'Admin', '', 'Cyrus, Kevs', 'FALSE']);
  w.project.web.respondTo(LOOKUP, (payload) => {
    const a = ACCOUNTS[(JSON.parse(payload) as { idToken: string }).idToken];
    if (!a) return { code: 400, body: '{}' };
    return { code: 200, body: JSON.stringify({ users: [{ localId: 'u', email: a.email, displayName: a.displayName, customAttributes: JSON.stringify({ role: a.role }) }] }) };
  });
  const asked: string[] = [];
  w.project.web.respondTo(LIST_PEOPLE, (_payload, headers) => {
    asked.push(headers['Authorization'] ?? '');
    return listPeople;
  });
  return { w, asked };
}

describe('the team, from Firebase', () => {
  it("lists Firebase's people with Post-It roles, and the FB accounts kept for their email", () => {
    const { w, asked } = world();
    const reply = w.project.post({ action: 'team', idToken: 'token-boss' }) as { ok: boolean; team: { name: string }[] };
    expect(reply.ok).toBe(true);
    expect(reply.team).toEqual([
      { name: 'APG Admin', role: 'Admin', email: 'thealphapremiergroup@gmail.com', fbAccounts: [], fbProfiles: [], fbProfileLink: '', active: true },
      {
        name: 'CJ',
        role: 'Intern',
        email: 'cj@aureo.com',
        fbAccounts: ['Cyrus', 'Kevs'],
        fbProfiles: [{ account: 'Cyrus', link: '' }, { account: 'Kevs', link: '' }],
        fbProfileLink: '',
        active: true,
      },
      { name: 'Off Agent', role: 'Intern', email: 'off@apg.test', fbAccounts: [], fbProfiles: [], fbProfileLink: '', active: false },
    ]);
    expect(asked).toEqual(['Bearer token-boss']);
  });

  it("credits an intern's own calls under the People screen's name, once an admin has read the team", () => {
    const { w } = world();
    expect(w.project.post({ action: 'ping', idToken: 'token-cj' })).toMatchObject({ name: 'cj' });
    w.project.post({ action: 'team', idToken: 'token-boss' });
    w.project.cache.clear();
    expect(w.project.post({ action: 'ping', idToken: 'token-cj' })).toMatchObject({ name: 'CJ', role: 'Intern', fbAccounts: ['Cyrus', 'Kevs'] });
  });

  it('gives queues only to an active intern on Firebase, not to one only on the sheet', () => {
    const { w } = world();
    const date = '2026-03-09';
    const ok = w.project.post({ action: 'saveQueues', idToken: 'token-boss', date, queues: [{ assignedTo: 'CJ', items: [] }] });
    expect(ok).toMatchObject({ ok: true });
    const sheetOnly = w.project.post({ action: 'saveQueues', idToken: 'token-boss', date, queues: [{ assignedTo: 'Sheet Only', items: [] }] });
    expect(sheetOnly).toMatchObject({ ok: false, error: 'bad-intern' });
    const off = w.project.post({ action: 'saveQueues', idToken: 'token-boss', date, queues: [{ assignedTo: 'Off Agent', items: [] }] });
    expect(off).toMatchObject({ ok: false, error: 'bad-intern' });
  });

  it("saves FB accounts on the Team tab by email, making the row when there is none", () => {
    const { w } = world();
    const reply = w.project.post({
      action: 'updatePerson',
      idToken: 'token-boss',
      name: 'APG Admin',
      fbProfiles: [{ account: 'APG Page', link: 'facebook.com/apg' }],
    });
    expect(reply).toMatchObject({ ok: true, person: { name: 'APG Admin', fbAccounts: ['APG Page'], fbProfiles: [{ account: 'APG Page', link: 'https://facebook.com/apg' }] } });
    const team = w.project.post({ action: 'team', idToken: 'token-boss' }) as { team: { name: string; fbAccounts: string[] }[] };
    expect(team.team.find((m) => m.name === 'APG Admin')?.fbAccounts).toEqual(['APG Page']);

    // An existing row keeps its place and takes the Firebase name.
    w.project.post({ action: 'updatePerson', idToken: 'token-boss', name: 'CJ', fbProfiles: [{ account: 'Cyrus' }] });
    const rows = w.team.show().filter((r) => String(r[1]).toLowerCase() === 'cj@aureo.com');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe('CJ');
  });

  it("refuses adding or turning off people: that's the People screen's job", () => {
    const { w } = world();
    expect(w.project.post({ action: 'addPerson', idToken: 'token-boss', name: 'X', role: 'Intern' })).toMatchObject({ ok: false, error: 'hub-people' });
    expect(w.project.post({ action: 'setActive', idToken: 'token-boss', name: 'CJ', active: false })).toMatchObject({ ok: false, error: 'hub-people' });
  });

  it("says so when Alpha Listing Hub can't be read", () => {
    const { w } = world({ code: 403, body: '{"error":{"status":"PERMISSION_DENIED"}}' });
    expect(w.project.post({ action: 'team', idToken: 'token-boss' })).toMatchObject({
      ok: false,
      error: "Couldn't read the people from Alpha Listing Hub. Try again.",
    });
  });

  it('keeps the Team tab for a copy still on keys', () => {
    const { w } = world();
    const team = w.call('maria', 'team') as { team: { name: string }[] };
    expect(team.team.map((m) => m.name)).toContain('Sheet Only');
  });
});
