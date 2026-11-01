/**
 * Signing in. There is no password and no Google sign-in: each person has a
 * key from the Team tab, and the key is the identity (DECISIONS D2). `ping`
 * asks the server who the key belongs to, and the app believes the answer —
 * it never decides its own role, so a tampered client gains nothing.
 *
 * Ported from BackendConnection.cs.
 */

import { EXPECTED_SERVER_VERSION } from '../config';
import { asList, asRecord, asText, type Backend, type Reply } from './backend';
import {
  DEFAULT_RULES,
  RULE_LIMITS,
  UserFacingError,
  type Role,
  type ServerRules,
  type ServerVersionStatus,
  type User,
} from './types';

/** What `ping` says about the server itself, besides who you are. */
export interface ServerInfo {
  /** Code.gs's SERVER_VERSION. Blank from a server older than v4, which sends none. */
  readonly version: string;
  /** The live rules. Null from a server that sends none: then the app's own defaults apply. */
  readonly rules: ServerRules | null;
}

/** Who the key belongs to, and what the server said about itself. */
export interface PingResult {
  readonly user: User;
  readonly server: ServerInfo;
}

/**
 * Asks the server who this key belongs to. Rejects with a sentence when the
 * key is unknown, the server cannot be reached, or nothing is set up yet.
 */
export async function signIn(backend: Pick<Backend, 'call'>): Promise<User> {
  return (await ping(backend)).user;
}

/** `signIn`, with the server's version and rules from the same reply. */
export async function ping(backend: Pick<Backend, 'call'>): Promise<PingResult> {
  const reply = await backend.call('ping');
  return { user: readUser(reply), server: readServerInfo(reply) };
}

/** The person a `ping` reply names. Rejects a reply that names nobody. */
export function readUser(reply: Reply): User {
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

/** The version and rules a `ping` reply carries. Anything missing or damaged reads as absent. */
export function readServerInfo(reply: Reply): ServerInfo {
  return { version: asText(reply['version']).trim(), rules: readRules(reply['rules']) };
}

/**
 * The rules as the server sent them, or null when it sent none. A field that
 * is missing, or not a whole number in its range, is its default: one bad
 * cell on the Settings tab must not stop anyone working.
 */
export function readRules(value: unknown): ServerRules | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const valid = (name: keyof ServerRules, from: string = name): number | undefined => {
    const v = raw[from];
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
    const { min, max } = RULE_LIMITS[name];
    return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
  };
  const rule = (name: keyof ServerRules): number => valid(name) ?? DEFAULT_RULES[name];
  // v6: perWeek; a server before it sends only perIntern, its old name.
  const perWeek = valid('perWeek') ?? valid('perWeek', 'perIntern') ?? DEFAULT_RULES.perWeek;
  return { cooldownDays: rule('cooldownDays'), repostDueDays: rule('repostDueDays'), perWeek, perIntern: perWeek };
}

// yyyy-MM-dd.n, as SERVER_VERSION is written.
const VERSION = /^(\d{4})-(\d{2})-(\d{2})\.(\d+)$/;

/**
 * How the server's version compares with the one this app was built for:
 * 'current' when it is that version or newer, 'behind' when it is older (the
 * admin should deploy the latest Code.gs), 'unknown' when it sent none or one
 * that cannot be read (a server older than versions).
 */
export function serverVersionStatus(version: string, expected: string = EXPECTED_SERVER_VERSION): ServerVersionStatus {
  const have = VERSION.exec(version.trim());
  const want = VERSION.exec(expected.trim());
  if (!have || !want) return 'unknown';
  for (let i = 1; i <= 4; i++) {
    const a = Number(have[i]);
    const b = Number(want[i]);
    if (a !== b) return a > b ? 'current' : 'behind';
  }
  return 'current';
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

/** The accounts a person may post from. Empty means any. tracker.ts reads Team rows with it too. */
export function readAccounts(value: unknown): readonly string[] {
  // A list, as Code.gs sends it; a comma-separated cell, as the Team tab holds it.
  const items = asList(value) ?? (typeof value === 'string' ? value.split(',') : []);
  const out: string[] = [];
  for (const item of items) {
    const account = asText(item).trim();
    if (account && !out.includes(account)) out.push(account);
  }
  return out;
}
