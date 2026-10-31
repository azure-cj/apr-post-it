/**
 * Signing in. There is no password and no Google sign-in: each person has a
 * key from the Team tab, and the key is the identity (DECISIONS D2). `ping`
 * asks the server who the key belongs to, and the app believes the answer —
 * it never decides its own role, so a tampered client gains nothing.
 *
 * Ported from BackendConnection.cs.
 */

import { asList, asText, type Backend } from './backend';
import { UserFacingError, type Role, type User } from './types';

/**
 * Asks the server who this key belongs to. Rejects with a sentence when the
 * key is unknown, the server cannot be reached, or nothing is set up yet.
 */
export async function signIn(backend: Pick<Backend, 'call'>): Promise<User> {
  const reply = await backend.call('ping');

  // Kept exactly as sent: the server matches this name with === against the
  // tracker's Posted By and Assigned To.
  const name = asText(reply['name']);
  if (!name.trim()) {
    throw new UserFacingError(
      'The server did not say who that key belongs to. Ask your admin to check the Team tab.',
    );
  }
  return { name, role: parseRole(reply['role']), fbAccounts: readAccounts(reply['fbAccounts']) };
}

/** Anything unrecognised is an intern: the least power, not the most. */
export function parseRole(value: unknown): Role {
  switch (typeof value === 'string' ? value.trim().toLowerCase() : '') {
    case 'admin':
    case 'manager': // the old middle role, now part of Admin
      return 'Admin';
    default:
      return 'Intern';
  }
}

/** The accounts this person may post from. Empty means any. */
function readAccounts(value: unknown): readonly string[] {
  // A list, as Code.gs sends it; a comma-separated cell, as the Team tab holds it.
  const items = asList(value) ?? (typeof value === 'string' ? value.split(',') : []);
  const out: string[] = [];
  for (const item of items) {
    const account = asText(item).trim();
    if (account && !out.includes(account)) out.push(account);
  }
  return out;
}
