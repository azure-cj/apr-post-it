/**
 * Signing in with a Firebase account instead of a key (v10): the app sends the
 * account's sign-in token, Google's accounts:lookup says whose it is, and the
 * Team tab's Email says which person that is. Keys keep working beside it.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, PEOPLE } from './world';

const LOOKUP = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=AIzaSyCO7e6rg1geJWrjN1K_0-wX2ZiJek3kENQ';

/** Google, knowing these tokens. A token not listed is refused, as a made-up or expired one is. */
function google(tokens: Record<string, { email: string; disabled?: boolean }>) {
  return (payload: string) => {
    const token = (JSON.parse(payload) as { idToken: string }).idToken;
    const user = tokens[token];
    return user ? { code: 200, body: JSON.stringify({ users: [{ localId: 'uid', ...user }] }) } : { code: 400, body: '{"error":{"message":"INVALID_ID_TOKEN"}}' };
  };
}

function worldWithEmails() {
  const w = createWorld();
  w.team.type(['CJ Aureo', 'CJ@Aureo.com', 'Intern', 'key-cj', 'Cyrus, Kevs', 'TRUE'], ['Off Person', 'off@apg.test', 'Intern', 'key-off', '', 'FALSE']);
  w.project.web.respondTo(
    LOOKUP,
    google({
      'token-cj': { email: 'cj@aureo.com' },
      'token-off': { email: 'off@apg.test' },
      'token-stranger': { email: 'stranger@apg.test' },
      'token-disabled': { email: 'cj@aureo.com', disabled: true },
    }),
  );
  return w;
}

describe('a Firebase sign-in instead of a key (v10)', () => {
  it('is the Team row with that email, in any case, with its name, role and FB accounts', () => {
    const w = worldWithEmails();
    expect(w.project.post({ action: 'ping', idToken: 'token-cj' })).toMatchObject({
      ok: true,
      name: 'CJ Aureo',
      role: 'Intern',
      fbAccounts: ['Cyrus', 'Kevs'],
    });
  });

  it('acts as that person: an intern gets only their own posts, and no admin action', () => {
    const w = worldWithEmails();
    expect(w.project.post({ action: 'posts', idToken: 'token-cj' })).toMatchObject({ ok: true, posts: [] });
    expect(w.project.post({ action: 'team', idToken: 'token-cj' })).toMatchObject({ ok: false, error: 'forbidden' });
  });

  it.each([
    ['a token Google refuses', 'made-up', 'Your sign-in has ended. Sign in again.'],
    ['a turned-off Firebase account', 'token-disabled', 'Your sign-in has ended. Sign in again.'],
    ['an email on no Team row', 'token-stranger', 'Nobody active on the Team tab has the email stranger@apg.test. Ask your admin to add it.'],
    ['a Team row turned off', 'token-off', 'Nobody active on the Team tab has the email off@apg.test. Ask your admin to add it.'],
  ])('refuses %s', (_what, idToken, message) => {
    const w = worldWithEmails();
    expect(w.project.post({ action: 'ping', idToken })).toEqual({ ok: false, error: 'unauthorized', message });
  });

  it('wins over a key sent with it: the account, not the key, says who', () => {
    const w = worldWithEmails();
    expect(w.project.post({ action: 'ping', idToken: 'token-cj', key: PEOPLE.maria.key })).toMatchObject({ name: 'CJ Aureo', role: 'Intern' });
  });

  it('asks Google once for a token, then remembers it for a while', () => {
    const w = worldWithEmails();
    w.project.post({ action: 'ping', idToken: 'token-cj' });
    w.project.post({ action: 'posts', idToken: 'token-cj' });
    expect(w.project.web.fetched.filter((u) => u === LOOKUP)).toHaveLength(1);
  });

  it('leaves keys working, for a copy of the app not yet updated', () => {
    const w = worldWithEmails();
    expect(w.call('jan', 'ping')).toMatchObject({ ok: true, name: 'Jan Dela Cruz' });
  });
});
