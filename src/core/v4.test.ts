/**
 * Contract v4 in core: the server's version and rules from ping, and the
 * tracker's setRules, rebuildDirectory and directoryStatus, against a
 * scripted `post`. The server itself is held to the same in
 * src/server-tests/v4.test.ts.
 */

import { EXPECTED_SERVER_VERSION } from '../config';
import { BackendError, createBackend, type BackendDeps } from './backend';
import { perInternOf, planQueues } from './planner';
import { ping, readRules, readServerInfo, serverVersionStatus, signIn } from './session';
import { createTracker } from './tracker';
import { DEFAULT_RULES, RULE_LIMITS, UserFacingError } from './types';

const EXEC = 'https://script.google.com/macros/s/AKfy/exec';

type Wire = Record<string, unknown>;

/** A post that answers every request with `reply` (or what it makes of the body), keeping what was sent. */
function answering(reply: unknown | ((body: Wire) => unknown)) {
  const sent: Wire[] = [];
  const post: BackendDeps['post'] = async (_url, body) => {
    const wire = JSON.parse(JSON.stringify(body)) as Wire;
    sent.push(wire);
    return typeof reply === 'function' ? (reply as (b: Wire) => unknown)(wire) : reply;
  };
  const backend = createBackend({ post, getConfig: () => ({ url: EXEC, key: 'k' }) });
  return { sent, backend, tracker: createTracker({ backend }) };
}

async function failure(p: Promise<unknown>): Promise<BackendError | UserFacingError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(UserFacingError);
    return err as UserFacingError;
  }
  throw new Error('expected a refusal');
}

// ------------------------------------------------------------------ version

describe('serverVersionStatus', () => {
  it.each([
    ['2026-10-31.1', '2026-10-31.1', 'current'],
    ['2026-10-31.2', '2026-10-31.1', 'current'],
    ['2026-11-01.1', '2026-10-31.9', 'current'],
    ['2026-10-31.10', '2026-10-31.9', 'current'],
    ['2026-10-31.1', '2026-10-31.2', 'behind'],
    ['2026-09-30.5', '2026-10-31.1', 'behind'],
    ['2025-12-31.9', '2026-01-01.1', 'behind'],
    ['', '2026-10-31.1', 'unknown'],
    ['v4', '2026-10-31.1', 'unknown'],
    [' 2026-10-31.1 ', '2026-10-31.1', 'current'],
  ] as const)('%j against %j is %s', (version, expected, status) => {
    expect(serverVersionStatus(version, expected)).toBe(status);
  });

  it('compares with EXPECTED_SERVER_VERSION by default', () => {
    expect(serverVersionStatus(EXPECTED_SERVER_VERSION)).toBe('current');
    expect(serverVersionStatus('2000-01-01.1')).toBe('behind');
    expect(serverVersionStatus('')).toBe('unknown');
  });
});

// ------------------------------------------------------------------ ping

describe('ping', () => {
  it('reads the version and the rules beside who you are', async () => {
    const { backend } = answering({
      ok: true,
      name: 'Maria Santos',
      role: 'Admin',
      fbAccounts: [],
      version: '2026-10-31.1',
      rules: { cooldownDays: 5, repostDueDays: 30, perIntern: 12 },
    });

    await expect(ping(backend)).resolves.toEqual({
      user: { name: 'Maria Santos', role: 'Admin', fbAccounts: [] },
      // A server before v6 sends perIntern only: read as perWeek.
      server: { version: '2026-10-31.1', rules: { cooldownDays: 5, repostDueDays: 30, perWeek: 12, perIntern: 12, queueWeeks: 2 } },
    });
    await expect(signIn(backend)).resolves.toEqual({ name: 'Maria Santos', role: 'Admin', fbAccounts: [] });
  });

  it('reads a server older than v4 as no version and no rules', async () => {
    const { backend } = answering({ ok: true, name: 'Jan', role: 'Intern', fbAccounts: [] });

    expect((await ping(backend)).server).toEqual({ version: '', rules: null });
  });

  it('still refuses a reply that names nobody', async () => {
    const { backend } = answering({ ok: true, version: '2026-10-31.1', rules: DEFAULT_RULES });

    expect((await failure(ping(backend))).message).toMatch(/did not say who that key belongs to/);
  });
});

describe('readRules', () => {
  it('is null for anything but an object', () => {
    for (const value of [undefined, null, 7, 'rules', [7, 14, 20]]) expect(readRules(value)).toBeNull();
  });

  it('takes each whole number in range, as a number or its digits', () => {
    expect(readRules({ cooldownDays: 60, repostDueDays: '120', perWeek: '200' })).toEqual({
      cooldownDays: 60,
      repostDueDays: 120,
      perWeek: 200,
      perIntern: 200,
      queueWeeks: 2,
    });
    // v14: the queue length, 1 to 3 weeks; a server before it sends none.
    expect(readRules({ queueWeeks: 3 })?.queueWeeks).toBe(3);
    expect(readRules({ queueWeeks: '1' })?.queueWeeks).toBe(1);
    expect(readRules({ queueWeeks: 4 })?.queueWeeks).toBe(2);
  });

  describe('perWeek (v6)', () => {
    it('reads perIntern, its old name, when perWeek is missing or bad', () => {
      expect(readRules({ perIntern: 1 })).toEqual({ ...DEFAULT_RULES, perWeek: 1, perIntern: 1 });
      expect(readRules({ perWeek: 'lots', perIntern: '25' })).toEqual({ ...DEFAULT_RULES, perWeek: 25, perIntern: 25 });
    });

    it('takes perWeek over perIntern, and keeps the two equal', () => {
      expect(readRules({ perWeek: 50, perIntern: 20 })).toEqual({ ...DEFAULT_RULES, perWeek: 50, perIntern: 50 });
    });

    it('defaults to 40 and allows 1 to 200', () => {
      expect(DEFAULT_RULES).toMatchObject({ perWeek: 40, perIntern: 40 });
      expect(RULE_LIMITS.perWeek).toMatchObject({ min: 1, max: 200 });
      expect(readRules({ perWeek: 201 })?.perWeek).toBe(40);
      expect(readRules({ perWeek: 0, perIntern: 0 })?.perWeek).toBe(40);
    });
  });

  it('puts the default in place of a field missing, out of range or not a whole number', () => {
    expect(readRules({})).toEqual(DEFAULT_RULES);
    expect(readRules({ cooldownDays: 0, repostDueDays: 121, perWeek: 2.5 })).toEqual(DEFAULT_RULES);
    expect(readRules({ cooldownDays: 'soon', repostDueDays: true, perIntern: '-3' })).toEqual(DEFAULT_RULES);
    expect(readRules({ cooldownDays: 3 })).toEqual({ ...DEFAULT_RULES, cooldownDays: 3 });
  });

  it('is what readServerInfo reads, with the version trimmed', () => {
    expect(readServerInfo({ version: ' 2026-10-31.1\n', rules: { perIntern: 9 } })).toEqual({
      version: '2026-10-31.1',
      rules: { ...DEFAULT_RULES, perWeek: 9, perIntern: 9 },
    });
    expect(readServerInfo({ version: 4 })).toEqual({ version: '4', rules: null });
  });
});

// ------------------------------------------------------------------ setRules

describe('tracker.setRules', () => {
  it('sends only the rules given, and gives back all three as the server has them', async () => {
    const { tracker, sent } = answering({ ok: true, rules: { cooldownDays: 3, repostDueDays: 14, perWeek: 20, perIntern: 20 } });

    await expect(tracker.setRules({ cooldownDays: 3 })).resolves.toEqual({ cooldownDays: 3, repostDueDays: 14, perWeek: 20, perIntern: 20, queueWeeks: 2 });
    expect(sent).toEqual([{ cooldownDays: 3, action: 'setRules', key: 'k' }]);
  });

  it('sends perIntern, perWeek\'s old name, as perWeek, and perWeek when both are given', async () => {
    const { tracker, sent } = answering({ ok: true, rules: DEFAULT_RULES });

    await tracker.setRules({ perIntern: 30 });
    await tracker.setRules({ perIntern: 30, perWeek: 60 });
    expect(sent).toEqual([
      { perWeek: 30, action: 'setRules', key: 'k' },
      { perWeek: 60, action: 'setRules', key: 'k' },
    ]);
  });

  it.each([
    [{ cooldownDays: 0 }, 'The cooldown must be a whole number from 1 to 60.'],
    [{ cooldownDays: 61 }, 'The cooldown must be a whole number from 1 to 60.'],
    [{ repostDueDays: 7.5 }, 'The repost age must be a whole number from 1 to 120.'],
    [{ perWeek: 201 }, 'Listings per week must be a whole number from 1 to 200.'],
    [{ perWeek: 0 }, 'Listings per week must be a whole number from 1 to 200.'],
    [{ perIntern: 201 }, 'Listings per week must be a whole number from 1 to 200.'],
    [{ perIntern: Number.NaN }, 'Listings per week must be a whole number from 1 to 200.'],
  ])('refuses %j before asking', async (changes, message) => {
    const { tracker, sent } = answering({ ok: true, rules: DEFAULT_RULES });

    expect((await failure(tracker.setRules(changes))).message).toBe(message);
    expect(sent).toEqual([]);
  });

  it('gives the server\'s sentence for bad-rules', async () => {
    const { tracker } = answering({
      ok: false,
      error: 'bad-rules',
      field: 'perIntern',
      message: 'Items per intern must be a whole number from 1 to 100.',
    });

    const err = await failure(tracker.setRules({ perIntern: 5 }));
    expect(err).toMatchObject({ code: 'bad-rules', message: 'Items per intern must be a whole number from 1 to 100.' });
  });

  it('calls a reply without rules unreadable', async () => {
    const { tracker } = answering({ ok: true });

    expect(await failure(tracker.setRules({ perIntern: 5 }))).toMatchObject({ code: 'unexpected', message: /the rules/ });
  });

  it('is an action an old web app does not know: it says to deploy', async () => {
    const { tracker } = answering({ ok: false, error: 'unknown action: setRules' });

    expect(await failure(tracker.setRules({ perIntern: 5 }))).toMatchObject({ code: 'outdated', message: /cannot save the rules/ });
  });

  it('may not have saved when it timed out, and says so', async () => {
    const backend = createBackend({
      post: () => new Promise(() => {}),
      getConfig: () => ({ url: EXEC, key: 'k' }),
      timeoutMs: 5,
    });

    const err = await failure(createTracker({ backend }).setRules({ perIntern: 5 }));
    expect(err.message).toMatch(/cannot tell whether that was saved/);
  });
});

// ------------------------------------------------------------------ rebuilding the directory

describe('tracker.rebuildDirectory', () => {
  it('resolves when the server says it started', async () => {
    const { tracker, sent } = answering({ ok: true, started: true });

    await expect(tracker.rebuildDirectory()).resolves.toEqual({ started: true });
    expect(sent).toEqual([{ action: 'rebuildDirectory', key: 'k' }]);
  });

  it('says a rebuild is already running, with the server\'s count', async () => {
    const { tracker } = answering({
      ok: false,
      error: 'busy',
      message: 'The directory is already being rebuilt (40 of 120 done).',
    });

    expect(await failure(tracker.rebuildDirectory())).toMatchObject({
      code: 'busy',
      message: 'The directory is already being rebuilt (40 of 120 done).',
    });
  });

  it('has a sentence of its own for busy when the server sends none', async () => {
    const { tracker } = answering({ ok: false, error: 'busy' });

    expect((await failure(tracker.rebuildDirectory())).message).toBe('The directory is already being rebuilt.');
  });

  it('says when BuildDirectory.gs is missing', async () => {
    const { tracker } = answering({ ok: false, error: 'no-builder' });

    expect(await failure(tracker.rebuildDirectory())).toMatchObject({ code: 'no-builder', message: /BuildDirectory\.gs/ });
  });

  it('calls a reply without started unreadable', async () => {
    const { tracker } = answering({ ok: true, started: 'yes' });

    expect(await failure(tracker.rebuildDirectory())).toMatchObject({ code: 'unexpected' });
  });
});

describe('tracker.directoryStatus', () => {
  it('reads the progress and when the last build finished', async () => {
    const { tracker } = answering({ ok: true, running: true, done: 40, total: 120, builtAt: '2026-10-30T03:15:00+08:00' });

    await expect(tracker.directoryStatus()).resolves.toEqual({
      running: true,
      done: 40,
      total: 120,
      builtAt: '2026-10-30T03:15:00+08:00',
    });
  });

  it('reads damaged counts as 0 and a missing builtAt as never', async () => {
    const { tracker } = answering({ ok: true, running: false, done: 'many', total: -3 });

    await expect(tracker.directoryStatus()).resolves.toEqual({ running: false, done: 0, total: 0, builtAt: '' });
  });

  it('never says more done than there are', async () => {
    const { tracker } = answering({ ok: true, running: true, done: 130, total: 120, builtAt: '' });

    expect((await tracker.directoryStatus()).done).toBe(120);
  });

  it('calls a reply without running unreadable', async () => {
    const { tracker } = answering({ ok: true, done: 1, total: 2 });

    expect(await failure(tracker.directoryStatus())).toMatchObject({ code: 'unexpected', message: /progress/ });
  });
});

// ------------------------------------------------------------------ the planner

describe('the planner\'s items per intern', () => {
  it('comes from the input, else the rules, else the default', () => {
    const rules = { cooldownDays: 7, repostDueDays: 14 };
    expect(perInternOf({ rules })).toBe(DEFAULT_RULES.perIntern);
    expect(perInternOf({ rules: { ...rules, perIntern: 4 } })).toBe(4);
    expect(perInternOf({ rules: { ...rules, perIntern: 4 }, perIntern: 2 })).toBe(2);
    expect(perInternOf({ rules: { ...rules, perIntern: Number.NaN } })).toBe(DEFAULT_RULES.perIntern);
  });

  it('fills each queue to the rules\' perIntern when the plan names none', () => {
    const properties = Array.from({ length: 10 }, (_, i) => ({
      id: `P${i}`,
      name: `Listing ${i}`,
      category: 'LOT',
      listingType: '',
      subCategory: '',
      photoCount: 1,
      hasIssues: false,
      issues: '',
    }));

    const plan = planQueues({
      properties,
      posts: [],
      assignments: [],
      interns: ['Jan', 'Ana'],
      date: '2026-11-02',
      rules: { cooldownDays: 7, repostDueDays: 14, perIntern: 3 },
      keepExisting: true,
    });

    expect(plan.queues.get('Jan')).toHaveLength(3);
    expect(plan.queues.get('Ana')).toHaveLength(3);
    expect(plan.shortBy).toBe(0);
  });
});
