/**
 * Signing in, against a scripted `post`. The server says who the key belongs
 * to; the app believes it, and reads anything it does not recognise as the
 * role with the least power.
 */

import { createBackend, type BackendDeps } from './backend';
import { parseRole, signIn } from './session';
import { UserFacingError, canManage, isAdmin } from './types';

const EXEC = 'https://script.google.com/macros/s/AKfy/exec';

type Wire = Record<string, unknown>;

/** A post that always gives `reply`, and keeps what was sent. */
function answering(reply: unknown) {
  const sent: Wire[] = [];
  const post = async (_url: string, body: unknown): Promise<unknown> => {
    sent.push(JSON.parse(JSON.stringify(body)) as Wire);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { post, sent };
}

function backendOver(post: BackendDeps['post'], key = 'testkey', url = EXEC) {
  return createBackend({ post, getConfig: () => ({ url, key }) });
}

async function refusal(p: Promise<unknown>): Promise<UserFacingError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(UserFacingError);
    return err as UserFacingError;
  }
  throw new Error('expected a refusal');
}

describe('signing in', () => {
  it('asks the server who the key belongs to, and believes the answer', async () => {
    const { post, sent } = answering({
      ok: true,
      name: 'Jan Dela Cruz',
      role: 'Intern',
      fbAccounts: ['APG Main', 'APG Rentals'],
      time: '2026-10-31T09:00:00+08:00',
    });
    const user = await signIn(backendOver(post, '9b2c'));

    expect(user).toEqual({ name: 'Jan Dela Cruz', role: 'Intern', fbAccounts: ['APG Main', 'APG Rentals'] });
    expect(sent).toEqual([{ action: 'ping', key: '9b2c' }]);
  });

  it('gives a manager and an admin their roles, and an admin keeps manager powers', async () => {
    const manager = await signIn(backendOver(answering({ ok: true, name: 'Maria Santos', role: 'Manager', fbAccounts: [] }).post));
    const admin = await signIn(backendOver(answering({ ok: true, name: 'Setup', role: 'Admin', fbAccounts: [] }).post));

    expect(manager.role).toBe('Admin');
    expect(canManage(manager)).toBe(true);
    expect(admin.role).toBe('Admin');
    expect(canManage(admin)).toBe(true);
    expect(isAdmin(admin)).toBe(true);
  });

  it('reads a role it does not recognise as an intern: the least power, not the most', async () => {
    for (const role of ['Owner', 'Superuser', '', null, 42, undefined]) {
      const user = await signIn(backendOver(answering({ ok: true, name: 'Jan Dela Cruz', role }).post));
      expect(user.role).toBe('Intern');
      expect(canManage(user)).toBe(false);
    }
  });

  it('with no accounts listed may post from any', async () => {
    const user = await signIn(backendOver(answering({ ok: true, name: 'Maria Santos', role: 'Manager' }).post));
    expect(user.fbAccounts).toEqual([]);
  });

  it('reads the accounts as the Team tab holds them, too: one cell, commas between', async () => {
    const user = await signIn(
      backendOver(answering({ ok: true, name: 'Jan', role: 'Intern', fbAccounts: ' APG Main, APG Rentals,, APG Main ' }).post),
    );
    expect(user.fbAccounts).toEqual(['APG Main', 'APG Rentals']);
  });

  it('drops accounts that are blank or not text', async () => {
    const user = await signIn(
      backendOver(answering({ ok: true, name: 'Jan', role: 'Intern', fbAccounts: ['APG Main', '', null, { a: 1 }, ' APG Homes '] }).post),
    );
    expect(user.fbAccounts).toEqual(['APG Main', 'APG Homes']);
  });

  it('keeps the name exactly as the server sent it, since the server matches it exactly', async () => {
    const user = await signIn(backendOver(answering({ ok: true, name: 'Jan Dela Cruz ', role: 'Intern' }).post));
    expect(user.name).toBe('Jan Dela Cruz ');
  });

  it('without a name in the answer says who to ask', async () => {
    const error = await refusal(signIn(backendOver(answering({ ok: true, name: '  ', role: 'Admin' }).post)));

    expect(error.message).toBe('The server did not say who that key belongs to. Ask your admin to check the Team tab.');
  });

  it('with an unknown key says what to do about it', async () => {
    const error = await refusal(
      signIn(
        backendOver(
          answering({
            ok: false,
            error: 'unauthorized',
            message: 'This copy of Post-It is not registered. Ask your admin for a key.',
          }).post,
        ),
      ),
    );

    expect(error.message).toBe('This copy of Post-It is not registered. Ask your admin for a key.');
  });

  it('with no key yet says so before asking', async () => {
    const { post, sent } = answering({ ok: true, name: 'Jan Dela Cruz', role: 'Intern' });
    const error = await refusal(signIn(backendOver(post, '')));

    expect(error.message).toContain('key');
    expect(error.message).toContain('Settings');
    expect(sent).toHaveLength(0);
  });

  it('with no connection says to check it', async () => {
    const error = await refusal(signIn(backendOver(answering(new TypeError('fetch failed')).post)));
    expect(error.message).toContain('connection');
  });
});

describe('a role', () => {
  it.each([
    ['Admin', 'Admin'],
    ['admin', 'Admin'],
    [' ADMIN ', 'Admin'],
    ['Manager', 'Admin'],
    ['manager', 'Admin'],
    ['Intern', 'Intern'],
    ['Managers', 'Intern'],
    ['', 'Intern'],
  ])('%j reads as %s', (raw, role) => {
    expect(parseRole(raw)).toBe(role);
  });

  it('that is not text at all reads as Intern', () => {
    expect(parseRole(undefined)).toBe('Intern');
    expect(parseRole({ role: 'Admin' })).toBe('Intern');
    expect(parseRole(['Admin'])).toBe('Intern');
  });
});
