/**
 * Signing in with a Firebase account instead of a key (v10, v11): the app
 * sends the account's sign-in token, and Google's accounts:lookup says whose it
 * is, with its name and role. The account decides who you are and your role;
 * an active Team row with the same email lends its name and FB accounts, so
 * Posted By and the history keep matching. Keys keep working beside it.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, PEOPLE } from './world';

const LOOKUP = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIzaSyCO7e6rg1geJWrjN1K_0-wX2ZiJek3kENQ';

interface Account {
  readonly email: string;
  readonly displayName?: string;
  readonly role?: string;
  readonly disabled?: boolean;
}

/** Google, knowing these tokens. A token not listed is refused, as a made-up or expired one is. */
function google(tokens: Record<string, Account>) {
  return (payload: string) => {
    const token = (JSON.parse(payload) as { idToken: string }).idToken;
    const a = tokens[token];
    if (!a) return { code: 400, body: '{"error":{"message":"INVALID_ID_TOKEN"}}' };
    const user = {
      localId: 'uid',
      email: a.email,
      ...(a.displayName ? { displayName: a.displayName } : {}),
      ...(a.disabled ? { disabled: true } : {}),
      ...(a.role ? { customAttributes: JSON.stringify({ role: a.role }) } : {}),
    };
    return { code: 200, body: JSON.stringify({ users: [user] }) };
  };
}

function world() {
  const w = createWorld();
  w.team.type(['CJ Aureo', 'CJ@Aureo.com', 'Admin', 'key-cj', 'Cyrus, Kevs', 'TRUE'], ['Off Person', 'off@apg.test', 'Intern', 'key-off', '', 'FALSE']);
  w.project.web.respondTo(
    LOOKUP,
    google({
      'token-cj': { email: 'cj@aureo.com', displayName: 'cj', role: 'agent' },
      'token-new': { email: 'new@apg.test', displayName: 'New Agent', role: 'agent' },
      'token-boss': { email: 'boss@apg.test', displayName: 'The Owner', role: 'owner' },
      'token-noname': { email: 'noname@apg.test', role: 'admin' },
      'token-off': { email: 'off@apg.test', displayName: 'Off', role: 'agent' },
      'token-norole': { email: 'norole@apg.test', displayName: 'No Role' },
      'token-scanner': { email: 'scan@apg.test', displayName: 'Scanner', role: 'scanner' },
      'token-disabled': { email: 'cj@aureo.com', role: 'agent', disabled: true },
    }),
  );
  return w;
}

const NO_ROLE = "This account can't use Post-It yet. Ask an admin to give it a role on the People screen.";
const ENDED = 'Your sign-in has ended. Sign in again.';

describe('a Firebase sign-in instead of a key', () => {
  it("needs no Team row: the account's own name and role", () => {
    const w = world();
    expect(w.project.post({ action: 'ping', idToken: 'token-new' })).toMatchObject({ ok: true, name: 'New Agent', role: 'Intern', fbAccounts: [] });
    expect(w.project.post({ action: 'ping', idToken: 'token-boss' })).toMatchObject({ ok: true, name: 'The Owner', role: 'Admin' });
    expect(w.project.post({ action: 'ping', idToken: 'token-noname' })).toMatchObject({ ok: true, name: 'noname@apg.test', role: 'Admin' });
  });

  it("takes the FB accounts the Team tab keeps for the email, but the account's name and role", () => {
    const w = world();
    // The row says CJ Aureo and Admin; the account is "cj", an agent, and the account wins.
    expect(w.project.post({ action: 'ping', idToken: 'token-cj' })).toMatchObject({
      ok: true,
      name: 'cj',
      role: 'Intern',
      fbAccounts: ['Cyrus', 'Kevs'],
    });
  });

  it('ignores a Team row that is turned off: the account still signs in, under its own name', () => {
    const w = world();
    expect(w.project.post({ action: 'ping', idToken: 'token-off' })).toMatchObject({ ok: true, name: 'Off', role: 'Intern' });
  });

  it('acts as that role: an agent gets no admin action', () => {
    const w = world();
    expect(w.project.post({ action: 'posts', idToken: 'token-new' })).toMatchObject({ ok: true, posts: [] });
    expect(w.project.post({ action: 'team', idToken: 'token-new' })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(w.project.post({ action: 'team', idToken: 'token-boss' })).not.toMatchObject({ error: 'forbidden' });
  });

  it.each([
    ['a token Google refuses', 'made-up', ENDED],
    ['a turned-off Firebase account', 'token-disabled', ENDED],
    ['an account with no role', 'token-norole', NO_ROLE],
    ['the scanner', 'token-scanner', NO_ROLE],
  ])('refuses %s', (_what, idToken, message) => {
    const w = world();
    expect(w.project.post({ action: 'ping', idToken })).toEqual({ ok: false, error: 'unauthorized', message });
  });

  it('wins over a key sent with it: the account, not the key, says who', () => {
    const w = world();
    expect(w.project.post({ action: 'ping', idToken: 'token-new', key: PEOPLE.maria.key })).toMatchObject({ name: 'New Agent', role: 'Intern' });
  });

  it('asks Google once for a token, then remembers it for a while', () => {
    const w = world();
    w.project.post({ action: 'ping', idToken: 'token-cj' });
    w.project.post({ action: 'posts', idToken: 'token-cj' });
    expect(w.project.web.fetched.filter((u) => u === LOOKUP)).toHaveLength(1);
  });

  it('leaves keys working, for a copy of the app not yet updated', () => {
    const w = world();
    expect(w.call('jan', 'ping')).toMatchObject({ ok: true, name: 'Jan Dela Cruz' });
  });
});
