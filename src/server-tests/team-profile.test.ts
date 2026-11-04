/**
 * The FB broker name (FB Accounts) and FB profile link on the Team tab:
 * addPerson takes the link, team returns it, and updatePerson changes only
 * those two fields. A Team tab made before FB Profile Link keeps working.
 */

import { describe, expect, it } from 'vitest';
import { facebookProfileProblem, normalizeProfileLink } from '@/core/links';
import type { Reply } from './harness';
import { createWorld, PEOPLE } from './world';

const NEW_HEADERS = ['Name', 'Email', 'Role', 'Key', 'FB Accounts', 'FB Profile Link', 'Active'];
const LINK = 'https://www.facebook.com/cyrus.orbano';

function teamOf(reply: Reply): { name: string; fbAccounts: string[]; fbProfileLink: string }[] {
  return reply['team'] as { name: string; fbAccounts: string[]; fbProfileLink: string }[];
}

describe('addPerson with an FB profile link', () => {
  it('writes the broker name and the link under their own headers, and team returns them', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    const reply = w.call('maria', 'addPerson', { name: 'Cyrus Orbano', role: 'Intern', fbAccounts: ['CYRUS ORBANO'], fbProfileLink: LINK });

    expect(reply).toMatchObject({ ok: true, person: { name: 'Cyrus Orbano', fbAccounts: ['CYRUS ORBANO'], fbProfileLink: LINK } });
    expect(w.team.row(w.team.lastRow)).toEqual(['Cyrus Orbano', '', 'Intern', reply['key'], 'CYRUS ORBANO', LINK, 'TRUE']);
    expect(teamOf(w.call('maria', 'team')).find((t) => t.name === 'Cyrus Orbano')).toMatchObject({
      fbAccounts: ['CYRUS ORBANO'],
      fbProfileLink: LINK,
    });
  });

  it('adds without a link, which reads as blank', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    const reply = w.call('maria', 'addPerson', { name: 'Lia Gomez', role: 'Admin' });

    expect(reply).toMatchObject({ ok: true, person: { fbAccounts: [], fbProfileLink: '' } });
    expect(w.team.row(w.team.lastRow)[5]).toBe('');
  });

  it.each([
    ['facebook.com/cyrus', 'https://facebook.com/cyrus'],
    ['m.facebook.com/profile.php?id=1', 'https://m.facebook.com/profile.php?id=1'],
    ['https://web.facebook.com/cyrus', 'https://web.facebook.com/cyrus'],
    ['https://fb.com/cyrus', 'https://fb.com/cyrus'],
    ['https://www.facebook.com/groups/apg/posts/1/', 'https://www.facebook.com/groups/apg/posts/1/'],
  ])('accepts %j, written as %j', (typed, written) => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });

    expect(w.call('maria', 'addPerson', { name: 'Lia Gomez', role: 'Intern', fbProfileLink: typed })).toMatchObject({
      ok: true,
      person: { fbProfileLink: written },
    });
  });

  it.each([
    ['http://www.facebook.com/cyrus'],
    ['https://instagram.com/cyrus'],
    ['https://fb.me/cyrus'],
    ['https://facebook.com.evil.example/x'],
    ['https://www.facebook.com/a b'],
    ['ftp://facebook.com/cyrus'],
    [42],
  ])('refuses %j as bad-profile-link, writing nothing', (link) => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    const before = w.team.show();

    expect(w.call('maria', 'addPerson', { name: 'Lia Gomez', role: 'Intern', fbProfileLink: link })).toMatchObject({
      ok: false,
      error: 'bad-profile-link',
    });
    expect(w.team.show()).toEqual(before);
  });
});

describe('a Team tab without FB Profile Link', () => {
  it('still identifies everyone and lists the team, with a blank link', () => {
    const w = createWorld();

    expect(w.call('jan', 'ping')).toMatchObject({ ok: true, name: 'Jan Dela Cruz', fbAccounts: ['APG Main', 'APG Rentals'] });
    expect(teamOf(w.call('maria', 'team')).every((t) => t.fbProfileLink === '')).toBe(true);
  });

  it('gains the column after its last one on the first write, and keeps every key working', () => {
    const w = createWorld();
    const reply = w.call('maria', 'addPerson', { name: 'Cyrus Orbano', role: 'Intern', fbAccounts: ['CYRUS ORBANO'], fbProfileLink: LINK });

    expect(reply).toMatchObject({ ok: true });
    expect(w.team.row(1)).toEqual(['Name', 'Email', 'Role', 'Key', 'FB Accounts', 'Active', 'FB Profile Link']);
    expect(w.team.row(w.team.lastRow)).toEqual(['Cyrus Orbano', '', 'Intern', reply['key'], 'CYRUS ORBANO', 'TRUE', LINK]);
    for (const p of ['jan', 'ana', 'maria', 'rico'] as const) expect(w.call(p, 'ping')).toMatchObject({ ok: true });
    expect(teamOf(w.call('maria', 'team')).find((t) => t.name === 'Cyrus Orbano')).toMatchObject({ fbProfileLink: LINK });
  });

  it('takes updatePerson too, adding the column once', () => {
    const w = createWorld();

    expect(w.call('maria', 'updatePerson', { name: 'Ana Reyes', fbProfileLink: LINK })).toMatchObject({ ok: true });
    expect(w.call('maria', 'updatePerson', { name: 'Jan Dela Cruz', fbProfileLink: LINK })).toMatchObject({ ok: true });
    expect(w.team.row(1).filter((h) => h === 'FB Profile Link')).toHaveLength(1);
    expect(w.team.row(3)[6]).toBe(LINK);
    expect(w.team.row(3).slice(0, 5)).toEqual(['Ana Reyes', '', 'Intern', PEOPLE.ana.key, '']);
  });
});

describe('updatePerson', () => {
  it('changes only the broker name and the link: name, role, key, email and active stay', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    const before = w.team.row(2);

    const reply = w.call('maria', 'updatePerson', {
      name: 'jan dela cruz',
      fbAccounts: ['CYRUS ORBANO'],
      fbProfileLink: 'facebook.com/cyrus',
      role: 'Admin',
      key: 'stolen',
      active: false,
    });

    expect(reply).toEqual({
      ok: true,
      person: {
        name: 'Jan Dela Cruz',
        role: 'Intern',
        email: '',
        fbAccounts: ['CYRUS ORBANO'],
        fbProfiles: [{ account: 'CYRUS ORBANO', link: 'https://facebook.com/cyrus' }],
        fbProfileLink: 'https://facebook.com/cyrus',
        active: true,
      },
    });
    expect(w.team.row(2)).toEqual([before[0], before[1], before[2], before[3], 'CYRUS ORBANO', 'https://facebook.com/cyrus', before[6]]);
    expect(w.team.formats(2)[4]).toBe('@');
    expect(w.team.formats(2)[5]).toBe('@');
  });

  it('leaves a field it is not sent alone, and clears one sent blank', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    w.call('maria', 'updatePerson', { name: 'Jan Dela Cruz', fbProfileLink: LINK });

    expect(w.team.row(2)[4]).toBe('APG Main, APG Rentals');
    expect(w.call('maria', 'updatePerson', { name: 'Jan Dela Cruz', fbAccounts: ['APG Main'] })).toMatchObject({
      person: { fbAccounts: ['APG Main'], fbProfileLink: LINK },
    });
    expect(w.call('maria', 'updatePerson', { name: 'Jan Dela Cruz', fbProfileLink: '' })).toMatchObject({
      person: { fbAccounts: ['APG Main'], fbProfileLink: '' },
    });
  });

  it('takes effect at once: the log step checks the new broker name', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    expect(w.call('jan', 'ping')).toMatchObject({ fbAccounts: ['APG Main', 'APG Rentals'] }); // cached

    w.call('maria', 'updatePerson', { name: 'Jan Dela Cruz', fbAccounts: ['CYRUS ORBANO'] });

    expect(w.call('jan', 'ping')).toMatchObject({ fbAccounts: ['CYRUS ORBANO'] });
  });

  it('refuses a bad link and a bad account list, writing nothing', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    const before = w.team.show();

    expect(w.call('maria', 'updatePerson', { name: 'Jan Dela Cruz', fbProfileLink: 'https://x.com/a' })).toMatchObject({
      ok: false,
      error: 'bad-profile-link',
    });
    expect(w.call('maria', 'updatePerson', { name: 'Jan Dela Cruz', fbAccounts: ['A, B'] })).toMatchObject({
      ok: false,
      error: 'bad-accounts',
    });
    expect(w.team.show()).toEqual(before);
  });

  it('says notfound for a name not on the tab', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });

    expect(w.call('maria', 'updatePerson', { name: 'Nobody', fbProfileLink: LINK })).toMatchObject({ ok: false, error: 'notfound' });
  });

  it('is forbidden to an intern, even for their own row', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    const before = w.team.show();

    expect(w.call('jan', 'updatePerson', { name: 'Jan Dela Cruz', fbAccounts: ['Anything'] })).toEqual({
      ok: false,
      error: 'forbidden',
      message: 'Your account cannot do that.',
    });
    expect(w.team.show()).toEqual(before);
    expect((w.project.evaluate('PERMISSIONS') as Record<string, string[]>)['Intern']).not.toContain('updatePerson');
  });

  it('never carries a key, succeeding or refusing', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    const texts = [
      w.project.postText({ action: 'updatePerson', key: PEOPLE.maria.key, name: 'Jan Dela Cruz', fbProfileLink: LINK }),
      w.project.postText({ action: 'updatePerson', key: PEOPLE.maria.key, name: 'Maria Santos', fbAccounts: ['X'] }),
      w.project.postText({ action: 'updatePerson', key: PEOPLE.maria.key, name: 'Jan Dela Cruz', fbProfileLink: 'nope' }),
      w.project.postText({ action: 'updatePerson', key: PEOPLE.jan.key, name: 'Jan Dela Cruz' }),
    ];
    const keys = Object.values(PEOPLE).map((p) => p.key);

    for (const text of texts) {
      for (const key of keys) expect(text).not.toContain(key);
      expect(text).not.toMatch(/"key"/i);
    }
  });
});

describe('the server and the app', () => {
  it.each([
    'https://www.facebook.com/cyrus',
    'facebook.com/cyrus',
    'm.facebook.com/x?y=1',
    'https://fb.com/',
    'https://fb.me/cyrus',
    'http://facebook.com/cyrus',
    'https://www.fb.com/cyrus',
    'https://facebook.com:8443/x',
    'https://u@facebook.com/x',
    'https://facebook.com/a b',
    'HTTPS://FACEBOOK.COM/X',
    'mailto:x@facebook.com',
    '',
  ])('agree on %j', (typed) => {
    const w = createWorld();
    const server = w.project.evaluate(`profileLinkIn_(${JSON.stringify(typed)})`) as { value?: string; problem?: unknown };
    const problem = facebookProfileProblem(typed);

    expect(server.problem !== undefined, typed).toBe(problem !== null);
    if (!problem) expect(server.value).toBe(normalizeProfileLink(typed));
  });
});

describe('one person, several FB accounts, each with its own profile link (v9)', () => {
  const CYRUS = 'https://www.facebook.com/cyrus';
  const KEVS = 'https://www.facebook.com/kevs';

  it('adds them as pairs: names in FB Accounts, links one per line in the same order', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    const reply = w.call('maria', 'addPerson', {
      name: 'CJ',
      role: 'Intern',
      fbProfiles: [
        { account: 'Cyrus', link: CYRUS },
        { account: 'Kevs', link: 'www.facebook.com/kevs' },
      ],
    });

    expect(reply).toMatchObject({
      ok: true,
      person: { fbAccounts: ['Cyrus', 'Kevs'], fbProfiles: [{ account: 'Cyrus', link: CYRUS }, { account: 'Kevs', link: KEVS }], fbProfileLink: CYRUS },
    });
    expect(w.team.row(w.team.lastRow).slice(4, 6)).toEqual(['Cyrus, Kevs', `${CYRUS}\n${KEVS}`]);
  });

  it('keeps an account with no link in its place', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    const reply = w.call('maria', 'updatePerson', {
      name: 'Jan Dela Cruz',
      fbProfiles: [
        { account: 'Cyrus', link: '' },
        { account: 'Kevs', link: KEVS },
      ],
    });

    expect(reply['person']).toMatchObject({ fbProfiles: [{ account: 'Cyrus', link: '' }, { account: 'Kevs', link: KEVS }], fbProfileLink: KEVS });
    expect(w.team.row(2).slice(4, 6)).toEqual(['Cyrus, Kevs', `\n${KEVS}`]);
  });

  it('reads a cell from before v9 as the first account\'s link', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    w.call('maria', 'updatePerson', { name: 'Jan Dela Cruz', fbAccounts: ['Cyrus', 'Kevs'], fbProfileLink: CYRUS });

    expect(teamOf(w.call('maria', 'team')).find((t) => t.name === 'Jan Dela Cruz')).toMatchObject({
      fbProfiles: [{ account: 'Cyrus', link: CYRUS }, { account: 'Kevs', link: '' }],
    });
  });

  it('lets them log a post from either account', () => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    w.call('maria', 'updatePerson', { name: 'Jan Dela Cruz', fbProfiles: [{ account: 'Cyrus' }, { account: 'Kevs' }] });

    expect(w.call('jan', 'ping')).toMatchObject({ fbAccounts: ['Cyrus', 'Kevs'] });
  });

  it.each([
    [[{ account: 'Cyrus' }, { account: 'cyrus' }], 'cyrus is listed twice.'],
    [[{ account: '', link: KEVS }], `Type the name of the account for ${KEVS}.`],
    [[{ account: 'A, B' }], 'A Facebook account name cannot contain a comma.'],
    [[{ account: 'Kevs', link: 'https://instagram.com/kevs' }], "That isn't a Facebook profile link."],
    ['Cyrus', 'The Facebook accounts must be a list.'],
  ] as const)('refuses %j and writes nothing', (fbProfiles, message) => {
    const w = createWorld({ teamHeaders: NEW_HEADERS });
    const before = w.team.row(2);

    expect(w.call('maria', 'updatePerson', { name: 'Jan Dela Cruz', fbProfiles })).toMatchObject({ ok: false, message });
    expect(w.team.row(2)).toEqual(before);
  });
});
