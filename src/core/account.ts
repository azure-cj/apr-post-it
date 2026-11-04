/**
 * Signing in with a Firebase account, the same one as in Alpha Listing Hub
 * (POST-IT-PLAN.md section 5). The role comes from the account, never from
 * the screen: an agent uses Post-It as an intern, an admin or owner as an
 * admin, and a scanner or an account with no role not at all.
 *
 * Listings, posts and queues stay in the Apps Script web app. It is sent the
 * account's sign-in token instead of a key and asks Google whose it is: the
 * account's name and role say who you are (v11). A Team row with the same
 * email lends its name, so history keeps matching; none is needed.
 */

import type { Role } from './types';

/** Who may use Post-It, and as what. Null: not at all. */
export function postItRole(firebaseRole: string | null): Role | null {
  if (firebaseRole === 'agent') return 'Intern';
  if (firebaseRole === 'admin' || firebaseRole === 'owner') return 'Admin';
  return null;
}

export const NO_ROLE = "This account can't use Post-It yet. Ask an admin to give it a role on the People screen.";

/** Firebase's sign-in errors in a sentence a person can act on. */
export function signInSentence(err: unknown): string {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Wrong email or password.';
    case 'auth/user-disabled':
      return 'This account is turned off. Ask an admin.';
    case 'auth/too-many-requests':
      return 'Too many tries. Wait a minute, then try again.';
    case 'auth/network-request-failed':
      return "Couldn't reach the sign-in server. Check your connection, then try again.";
    default:
      return "Couldn't sign you in. Try again.";
  }
}
