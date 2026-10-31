/**
 * Contract v4 on the server: its version, the rules the admin edits from the
 * app (the Settings tab), rebuilding the directory from the app, and the
 * editor's Run list holding only what the owner should run.
 */

import { describe, expect, it } from 'vitest';
import { EXPECTED_SERVER_VERSION } from '../config';
import { BackendError } from '../core/backend';
import { ping, serverVersionStatus } from '../core/session';
import { DEFAULT_RULES, RULE_LIMITS } from '../core/types';
import { loadProject, PROJECT_FILES, readServerFile, type Project } from './harness';
import { CASA, createWorld, DIRECTORY_ID, type World } from './world';

const DEFAULTS = { cooldownDays: 7, repostDueDays: 14, perIntern: 20 };

// ------------------------------------------------------------------ the version

describe('the server\'s version', () => {
  it('is the one this app expects (src/config.ts EXPECTED_SERVER_VERSION)', () => {
    const version = loadProject().evaluate('SERVER_VERSION');

    expect(version).toBe(EXPECTED_SERVER_VERSION);
    expect(serverVersionStatus(version as string)).toBe('current');
  });

  it('comes with every ping, with the rules', () => {
    const w = createWorld();

    expect(w.call('jan', 'ping')).toMatchObject({ ok: true, version: EXPECTED_SERVER_VERSION, rules: DEFAULTS });
  });

  it('reaches the app\'s own reading of ping', async () => {
    const w = createWorld();

    const result = await ping(w.app('ana').backend);

    expect(result.user).toMatchObject({ name: 'Ana Reyes', role: 'Intern' });
    expect(result.server).toEqual({ version: EXPECTED_SERVER_VERSION, rules: DEFAULTS });
  });
});

// ------------------------------------------------------------------ the rules

describe('the rules', () => {
  it('default to CONFIG, and agree with the app\'s defaults and limits', () => {
    const w = createWorld();

    expect(DEFAULT_RULES).toEqual(DEFAULTS);
    expect(w.project.evaluate('rules_()')).toEqual(DEFAULTS);
    const specs = w.project.evaluate('ruleSpecs_()') as Record<string, { min: number; max: number; fallback: number }>;
    for (const [name, limits] of Object.entries(RULE_LIMITS)) {
      expect(specs[name], name).toMatchObject({ min: limits.min, max: limits.max });
    }
    // Reading them writes nothing: there is no Settings tab until one is saved.
    expect(w.admin.has('Settings')).toBe(false);
  });

  it('are changed by an admin, only the fields sent, and kept on the Settings tab as text', () => {
    const w = createWorld();

    expect(w.call('maria', 'setRules', { cooldownDays: 3 })).toEqual({ ok: true, rules: { ...DEFAULTS, cooldownDays: 3 } });
    expect(w.call('maria', 'setRules', { perIntern: '12' })).toEqual({
      ok: true,
      rules: { cooldownDays: 3, repostDueDays: 14, perIntern: 12 },
    });

    const tab = w.admin.sheet('Settings');
    expect(tab.show()).toEqual([['Key', 'Value'], ['cooldownDays', '3'], ['perIntern', '12']]);
    expect(tab.formats(2)).toEqual(['@', '@']);
    // Changed again: the same row, not a second one.
    w.call('maria', 'setRules', { cooldownDays: 5 });
    expect(tab.show()).toEqual([['Key', 'Value'], ['cooldownDays', '5'], ['perIntern', '12']]);
    expect(w.call('ana', 'ping')['rules']).toEqual({ cooldownDays: 5, repostDueDays: 14, perIntern: 12 });
  });

  it('are the admin\'s alone', () => {
    const w = createWorld();

    expect(w.call('jan', 'setRules', { cooldownDays: 1 })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(w.admin.has('Settings')).toBe(false);
  });

  it.each([
    [{ cooldownDays: 0 }, 'cooldownDays'],
    [{ cooldownDays: 61 }, 'cooldownDays'],
    [{ repostDueDays: 121 }, 'repostDueDays'],
    [{ perIntern: 2.5 }, 'perIntern'],
    [{ perIntern: 'ten' }, 'perIntern'],
    [{ perIntern: -1 }, 'perIntern'],
    [{ cooldownDays: 3, perIntern: 101 }, 'perIntern'],
  ])('refuse %j, and write nothing', (fields, field) => {
    const w = createWorld();

    expect(w.call('maria', 'setRules', fields)).toMatchObject({ ok: false, error: 'bad-rules', field });
    expect(w.admin.has('Settings')).toBe(false);
    expect(w.call('maria', 'ping')['rules']).toEqual(DEFAULTS);
  });

  it('are cached briefly: a cell typed on the tab holds within half a minute', () => {
    const w = createWorld();
    w.call('maria', 'setRules', { repostDueDays: 30 });
    expect(w.call('jan', 'ping')['rules']).toMatchObject({ repostDueDays: 30 });

    w.admin.sheet('Settings').typeAt(2, 2, '21');
    expect(w.call('jan', 'ping')['rules']).toMatchObject({ repostDueDays: 30 });
    w.project.clock.advance(31_000);
    expect(w.call('jan', 'ping')['rules']).toMatchObject({ repostDueDays: 21 });
  });

  it('fall back to the default for a cell that is not a whole number in range', () => {
    const w = createWorld();
    const tab = w.admin.addSheet('Settings', ['Key', 'Value']);
    tab.type(['cooldownDays', 'soon'], ['repostDueDays', '500'], ['perIntern', '8'], ['somethingElse', '3']);

    expect(w.call('jan', 'ping')['rules']).toEqual({ cooldownDays: 7, repostDueDays: 14, perIntern: 8 });
  });

  it('drive the server\'s own cooldown', () => {
    const w = createWorld();
    w.call('maria', 'setRules', { cooldownDays: 3 });
    expect(w.logPost('jan', CASA)).toMatchObject({ ok: true });

    w.project.clock.set('2026-03-11 10:00');
    expect(w.logPost('ana', CASA)).toMatchObject({
      ok: false,
      error: 'cooldown',
      nextAllowed: '2026-03-12',
      message: expect.stringContaining('The cooldown is 3 days'),
    });

    w.project.clock.set('2026-03-12 00:05');
    expect(w.logPost('ana', CASA)).toMatchObject({ ok: true });
  });

  it('take effect at once: a longer cooldown refuses what the shorter one allowed', () => {
    const w = createWorld();
    w.logPost('jan', CASA);
    w.project.clock.set('2026-03-17 10:00');
    w.call('maria', 'setRules', { cooldownDays: 14 });

    expect(w.logPost('ana', CASA)).toMatchObject({ ok: false, error: 'cooldown', nextAllowed: '2026-03-23' });
  });

  it('reach the app\'s client, which checks them before asking', async () => {
    const w = createWorld();
    const admin = w.app('maria').tracker;

    await expect(admin.setRules({ repostDueDays: 21 })).resolves.toEqual({ ...DEFAULTS, repostDueDays: 21 });
    await expect(admin.setRules({ cooldownDays: 99 })).rejects.toThrow('The cooldown must be a whole number from 1 to 60.');
    await expect(w.app('jan').tracker.setRules({ cooldownDays: 3 })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

// ------------------------------------------------------------------ rebuilding the directory

/** Runs RESTART_FROM_APP with RESTART replaced, noting what directoryStatus said while it ran. */
function stubRestart(project: Project): void {
  project.evaluate(
    "(RESTART = function () { Logger.log('RESTART ran; running: ' + directoryStatus_().running); }, true)",
  );
}

function status(w: World): Record<string, unknown> {
  return w.call('maria', 'directoryStatus');
}

describe('rebuilding the directory from the app', () => {
  it('is idle, never built, before anything has run', () => {
    const w = createWorld();

    expect(status(w)).toEqual({ ok: true, running: false, done: 0, total: 0, builtAt: '' });
  });

  it('schedules RESTART_FROM_APP about ten seconds later and answers at once', () => {
    const w = createWorld();

    expect(w.call('maria', 'rebuildDirectory')).toEqual({ ok: true, started: true });

    const [trigger, ...more] = w.project.triggers.list();
    expect(more).toEqual([]);
    expect(trigger).toMatchObject({ handler: 'RESTART_FROM_APP', at: w.project.clock.now() + 10_000 });
    expect(status(w)).toMatchObject({ running: true });
  });

  it('refuses a second rebuild while one is scheduled', () => {
    const w = createWorld();
    w.call('maria', 'rebuildDirectory');

    expect(w.call('rico', 'rebuildDirectory')).toMatchObject({ ok: false, error: 'busy' });
    expect(w.project.triggers.list()).toHaveLength(1);
  });

  it('refuses while a build is part way through', () => {
    const w = createWorld();
    w.project.properties.set('cursor', '40').set('total', '120');

    expect(status(w)).toMatchObject({ running: true, done: 40, total: 120 });
    expect(w.call('maria', 'rebuildDirectory')).toMatchObject({
      ok: false,
      error: 'busy',
      message: 'The directory is already being rebuilt (40 of 120 done).',
    });
    expect(w.project.triggers.list()).toEqual([]);
  });

  it('runs RESTART from the trigger, marked as running while it scans, and removes its trigger', () => {
    const w = createWorld();
    stubRestart(w.project);
    w.call('maria', 'rebuildDirectory');

    expect(w.project.fireTriggers()).toEqual([]);
    w.project.clock.advance(10_000);
    expect(w.project.fireTriggers()).toEqual(['RESTART_FROM_APP']);

    expect(w.project.logs).toContain('RESTART ran; running: true');
    expect(w.project.triggers.list()).toEqual([]);
    expect([...w.project.properties.keys()]).not.toContain('rebuildStarted');
    expect(status(w)).toMatchObject({ running: false });
    expect(w.call('maria', 'rebuildDirectory')).toMatchObject({ ok: true });
  });

  it('forgets a scan that Apps Script stopped, after ten minutes', () => {
    const w = createWorld();
    w.project.properties.set('rebuildStarted', String(w.project.clock.now()));

    expect(status(w)).toMatchObject({ running: true });
    w.project.clock.advance(10 * 60_000);
    expect(status(w)).toMatchObject({ running: false });
  });

  it('is the admin\'s alone', () => {
    const w = createWorld();

    expect(w.call('jan', 'rebuildDirectory')).toMatchObject({ ok: false, error: 'forbidden' });
    expect(w.call('jan', 'directoryStatus')).toMatchObject({ ok: false, error: 'forbidden' });
    expect(w.project.triggers.list()).toEqual([]);
  });

  it('says so when BuildDirectory.gs is not in the project', () => {
    const w = createWorld({ files: ['Separators.gs', 'Code.gs'] });

    expect(w.call('maria', 'rebuildDirectory')).toMatchObject({ ok: false, error: 'no-builder' });
    expect(w.project.triggers.list()).toEqual([]);
  });

  it('reaches the app\'s client, busy included', async () => {
    const w = createWorld();
    const admin = w.app('maria').tracker;

    await expect(admin.rebuildDirectory()).resolves.toEqual({ started: true });
    await expect(admin.directoryStatus()).resolves.toEqual({ running: true, done: 0, total: 0, builtAt: '' });
    const busy = await admin.rebuildDirectory().catch((err: unknown) => err);
    expect(busy).toBeInstanceOf(BackendError);
    expect(busy).toMatchObject({ code: 'busy', message: expect.stringMatching(/already being rebuilt/) });
  });
});

describe('BuildDirectory.gs, finishing a build', () => {
  /** A build with one listing left to write, in the world's directory spreadsheet. */
  function oneLeft(w: World) {
    w.project.evaluate(`(CFG.SHEET_ID = ${JSON.stringify(DIRECTORY_ID)})`);
    const queue = w.directory.addSheet('_Queue', ['Category', 'Listing type', 'Sub-category', 'Property', 'FolderId']);
    queue.writeText(['LOT', 'FOR SALE', '', 'New Lot', 'F-new']);
    w.directoryTab.writeText([]);
    w.project.properties.set('cursor', '0').set('total', '1');
    return queue;
  }

  it('records when it finished in builtAt, which directoryStatus sends', () => {
    const w = createWorld();
    const queue = oneLeft(w);
    w.project.clock.set('2026-03-09 03:15');

    w.project.run('CONTINUE');

    expect(w.project.properties.get('builtAt')).toBe('2026-03-09T03:15:00+08:00');
    expect(w.project.properties.get('cursor')).toBe('1');
    expect(queue.hidden).toBe(true);
    expect(w.project.triggers.list()).toEqual([]);
    expect(w.directoryTab.show().at(-1)?.[3]).toBe('New Lot');
    expect(status(w)).toEqual({ ok: true, running: false, done: 1, total: 1, builtAt: '2026-03-09T03:15:00+08:00' });
  });

  it('leaves builtAt alone part way through', () => {
    const w = createWorld();
    oneLeft(w);
    w.project.properties.set('total', '2');
    w.directory.sheet('_Queue').writeText(['LOT', 'FOR SALE', '', 'Another', 'F-another']);
    // A batch with no time left: it writes nothing and hands over to the next.
    w.project.evaluate('(CFG.BATCH_SECONDS = 0)');

    w.project.run('CONTINUE');

    expect(w.project.properties.has('builtAt')).toBe(false);
    expect(w.project.triggers.list().map((t) => t.handler)).toEqual(['CONTINUE']);
    expect(status(w)).toMatchObject({ running: true, done: 0, total: 2, builtAt: '' });
  });
});

// ------------------------------------------------------------------ the editor's Run list

/** What the owner may run from the editor, the menu and the triggers call. Nothing else is public. */
const PUBLIC = [
  // Code.gs: the web app, the menu and the editor helpers.
  'doGet', 'doPost', 'onOpen', 'ADD_PERSON', 'SETUP', 'promptAddTeamMember',
  // BuildDirectory.gs: its commands, and the trigger rebuildDirectory sets.
  'START', 'RESTART', 'CONTINUE', 'STOP', 'STATUS', 'FIND_ROOT', 'VERIFY', 'RESTART_FROM_APP',
].sort();

/** Top-level function declarations, file by file. */
function functionsIn(file: string): string[] {
  return Array.from(readServerFile(file).matchAll(/^(?:async\s+)?function\*?\s*([A-Za-z_$][\w$]*)/gm), (m) => m[1]!);
}

describe('the Apps Script editor\'s Run list', () => {
  it('lists exactly the functions meant to be run: every other one ends in _', () => {
    const shown = PROJECT_FILES.flatMap(functionsIn).filter((name) => !name.endsWith('_')).sort();

    expect(shown).toEqual(PUBLIC);
  });

  it('holds every function a trigger or the menu names', () => {
    const named = PROJECT_FILES.flatMap((file) => {
      const src = readServerFile(file);
      return [
        ...Array.from(src.matchAll(/newTrigger\(\s*'([^']+)'/g), (m) => m[1]!),
        ...Array.from(src.matchAll(/addItem\([^,]+,\s*'([^']+)'/g), (m) => m[1]!),
        ...Array.from(src.matchAll(/getHandlerFunction\(\)\s*===\s*'([^']+)'/g), (m) => m[1]!),
      ];
    });
    named.push(loadProject().evaluate('REBUILD_HANDLER') as string);

    expect(named.length).toBeGreaterThan(3);
    for (const name of named) expect(PUBLIC, name).toContain(name);
  });

  it('cannot schedule a trigger for a hidden function', () => {
    const project = loadProject();

    expect(() => project.evaluate("ScriptApp.newTrigger('route_').timeBased().after(1000).create()")).toThrow(
      /no trailing underscore/,
    );
  });
});
