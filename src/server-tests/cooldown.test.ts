/**
 * The cooldown, which the server enforces and the app predicts (cooldown.ts).
 * The two must agree: when they do not, an intern is told one thing on screen
 * and another when they save. Where it can, this file asks the app's own code
 * — its matcher, its date reading, its cooldown, through its own client — and
 * holds the server to the same answers.
 */

import { describe, expect, it } from 'vitest';
import { cooldown, lastPostedOn } from '../core/cooldown';
import { normalize } from '../core/matcher';
import { readSheetDate } from '../core/tracker';
import type { Project, ProjectOptions, Reply } from './harness';
import { CASA, createWorld, type Listing, TOWER } from './world';

const LINK = 'https://www.facebook.com/groups/apg/posts/1/';

/** A Posts row for the world's column order. */
function postRow(date: string, title: string, status: string, propertyId: string): string[] {
  return [date, title, 'Group post', '09:00', status, 'APG Main', LINK, 'Ana Reyes', propertyId];
}

/** The server's own helpers, called in its scope. */
function server(project: Project, fn: string, arg: string): unknown {
  return project.evaluate(`${fn}(${JSON.stringify(arg)})`);
}

describe('what the cooldown counts (bug 3)', () => {
  it('counts a Pending post: a second intern cannot post a listing still waiting for approval', () => {
    const w = createWorld();

    expect(w.logPost('jan', CASA, { status: 'Pending' })).toMatchObject({ ok: true, status: 'Pending' });
    expect(w.logPost('ana', CASA)).toMatchObject({
      ok: false,
      error: 'cooldown',
      lastPosted: '2026-03-09',
      nextAllowed: '2026-03-16',
    });
  });

  it('matches by folder id when both rows have one, so a renamed folder keeps its history', () => {
    const w = createWorld();
    w.posts.type(postRow('2026-03-05', 'Casa Amara (before the rename)', 'Posted', CASA.id));

    expect(w.logPost('jan', CASA)).toMatchObject({ error: 'cooldown', lastPosted: '2026-03-05' });
  });

  it('does not match another listing of the same name when both have ids', () => {
    const w = createWorld();
    w.posts.type(postRow('2026-03-05', 'Casa Amara', 'Posted', 'F-another-casa'));

    expect(w.logPost('jan', CASA)).toMatchObject({ ok: true });
  });

  it.each([
    ['  CASA   amara! '],
    ['Casa Amara.'],
    ['Cása Amara'],
  ])('matches a row with no id by name, as the app normalises it: %j', (title) => {
    const w = createWorld();
    w.posts.type(postRow('2026-03-05', title, 'Posted', ''));

    expect(w.logPost('jan', CASA)).toMatchObject({ error: 'cooldown', lastPosted: '2026-03-05' });
  });

  it('reads Blk, Lt and Ph as the app reads them', () => {
    const sunrise: Listing = { ...CASA, id: 'F-sunrise', name: 'Sunrise Homes Block 3 Lot 9' };
    const w = createWorld({ listings: [sunrise] });
    w.posts.type(postRow('2026-03-05', 'Sunrise Homes Blk. 3, Lt 9', 'Posted', ''));

    expect(w.logPost('jan', sunrise)).toMatchObject({ error: 'cooldown' });
  });

  it('matches a folder named 1201 that Sheets made a number', () => {
    const w = createWorld();
    w.posts.type(postRow('2026-03-05', '1201', 'Posted', ''));
    expect(w.posts.row(2)[1]).toBe('#number 1201');

    expect(w.logPost('jan', TOWER)).toMatchObject({ error: 'cooldown' });
  });

  it('counts every status, as the app does: it reads anything but Pending as Posted', () => {
    const w = createWorld();
    w.posts.type(postRow('2026-03-05', 'Casa Amara', '', CASA.id));

    expect(w.logPost('jan', CASA)).toMatchObject({ error: 'cooldown' });
  });

  it('takes the latest of several rows', () => {
    const w = createWorld();
    w.posts.type(postRow('2026-02-01', 'Casa Amara', 'Posted', CASA.id), postRow('2026-03-04', 'Casa Amara', 'Posted', CASA.id));

    expect(w.logPost('jan', CASA)).toMatchObject({ lastPosted: '2026-03-04', nextAllowed: '2026-03-11' });
  });
});

describe('days are calendar days in Manila (bug 3)', () => {
  it('allows the post from midnight of the seventh day, not from 08:00, when UTC reaches it', () => {
    const w = createWorld({ now: '2026-03-09 00:30' });
    w.posts.type(postRow('2026-03-02', 'Casa Amara', 'Posted', CASA.id));

    expect(w.logPost('jan', CASA)).toMatchObject({ ok: true });
  });

  it('refuses it until then, saying when, in the app\'s own words', () => {
    const w = createWorld({ now: '2026-03-08 23:59' });
    w.posts.type(postRow('2026-03-02', 'Casa Amara', 'Posted', CASA.id));

    expect(w.logPost('jan', CASA)).toEqual({
      ok: false,
      error: 'cooldown',
      lastPosted: '2026-03-02',
      nextAllowed: '2026-03-09',
      message: 'Posted 6 days ago (2 Mar). The cooldown is 7 days — it can be posted again on Mon 9 Mar 2026.',
    });
  });

  it('counts a row dated after today as posted today', () => {
    const w = createWorld({ now: '2026-03-09 10:00' });
    w.posts.type(postRow('2026-03-11', 'Casa Amara', 'Posted', CASA.id));

    expect(w.logPost('jan', CASA)).toMatchObject({ lastPosted: '2026-03-11', nextAllowed: '2026-03-18' });
  });

  it('skips a date the app cannot read, as the app skips it', () => {
    const w = createWorld();
    w.posts.writeText(postRow('2026-02-30', 'Casa Amara', 'Posted', CASA.id), postRow('last week', 'Casa Amara', 'Posted', CASA.id));

    expect(w.logPost('jan', CASA)).toMatchObject({ ok: true });
  });

  it('reads a date typed into a plain-text cell, M/d/yyyy, as the app does', () => {
    const w = createWorld();
    w.posts.writeText(postRow('3/8/2026', 'Casa Amara', 'Posted', CASA.id));

    expect(w.logPost('jan', CASA)).toMatchObject({ error: 'cooldown', lastPosted: '2026-03-08' });
  });
});

// ------------------------------------------------------------------ agreement with the app

describe('the server and the app agree', () => {
  const NAMES = [
    'Sunrise Homes Blk. 3, Lt 9', 'Sunrise Homes Block 3 Lot 9', 'BLDG 5 Ph 2', 'Ph. 2 Blk 3 Lt 4 Bldg A',
    'Casa Amara', '  CASA   amara! ', 'Café Ñandú & Co.', 'Cafe\u{301} Amara', "Owner's Lot", 'Owner\u{2019}s Lot',
    'İstanbul Tower', 'ΣΊΣΥΦΟΣ', 'Straße 12', '\u{1D5F3}\u{1D5EE}\u{1D5FB}\u{1D5F0}\u{1D606} Tower', 'Ｆｕｌｌ ｗｉｄｔｈ １２',
    '\u{661}\u{662}\u{663} Tower', 'Lot 07', '1201', 'constructor', '__proto__', 'tab\tand\nnewline', 'x_y-z/w',
    '\u{1F3E0} Casa', 'ǅemal', '', '   ', '—', 'A&B', 'a & b', 'hasOwnProperty',
  ];

  it.each(NAMES)('normalise %j alike', (name) => {
    const project = createWorld().project;

    expect(server(project, 'normalizeName_', name)).toBe(normalize(name));
  });

  const DATES = [
    '2026-01-05', ' 2026-01-05 ', '2026-01-06T00:00:00.000Z', '2026-01-05T16:00:00.000Z', '2026-01-05T15:59:59Z',
    '2026-01-06T00:00:00+08:00', '2026-01-06T07:00:00-0500', '2026-01-06T00:00:00', '2026-01-06 09:30', '1/6/2026',
    '12/31/2026 14:00:00', '2026-02-29', '2028-02-29', '13/1/2026', 'Jan 6', '', '2026-1-5', '1899-12-30', '14:30',
    '3/8/2026', '2026-03-09T25:00:00Z', '2026-12-31T16:00:00Z', '2026-03-09T09:30:00.123+08:00', 'TRUE',
  ];

  it.each(DATES)('read the tracker date %j alike', (date) => {
    const project = createWorld().project;

    expect(server(project, 'sheetDay_', date)).toBe(readSheetDate(date));
  });

  interface Scenario {
    readonly now: string;
    readonly typed?: readonly (readonly string[])[];
    readonly text?: readonly (readonly string[])[];
    readonly listing?: Listing;
  }

  /** The app's verdict, from the rows its own client reads, and the server's, from logPost. */
  async function verdicts(s: Scenario) {
    const listing = s.listing ?? CASA;
    const w = createWorld({ now: s.now });
    for (const row of s.typed ?? []) w.posts.type(row);
    for (const row of s.text ?? []) w.posts.writeText(row);

    const rows = await w.app('maria').tracker.posts();
    const app = cooldown(lastPostedOn(rows, listing), s.now.slice(0, 10), { cooldownDays: 7 });
    const reply = w.logPost('ana', listing);
    return { app, reply };
  }

  function expectAgreement(app: ReturnType<typeof cooldown>, reply: Reply, label: string): void {
    if (app.blocked) {
      expect(reply, label).toEqual({
        ok: false,
        error: 'cooldown',
        lastPosted: app.lastPosted,
        nextAllowed: app.nextAllowed,
        message: app.message,
      });
    } else {
      expect(reply, label).toMatchObject({ ok: true });
    }
  }

  const DAYS: readonly [string, number][] = [
    ['2026-03-09', 0], ['2026-03-08', 1], ['2026-03-03', 6], ['2026-03-02', 7], ['2026-03-01', 8], ['2026-03-11', -2],
  ];
  const CLOCK = ['00:00', '00:30', '07:59', '08:00', '23:59'];
  const STATUSES = ['Posted', 'Pending', 'pending ', 'POSTED', ''];

  it('on every day either side of the cooldown, at every hour that UTC once got wrong, whatever the status', async () => {
    let blocked = 0;
    for (const [date] of DAYS) {
      for (const time of CLOCK) {
        for (const status of STATUSES) {
          const { app, reply } = await verdicts({ now: `2026-03-09 ${time}`, typed: [postRow(date, 'Casa Amara', status, CASA.id)] });
          expectAgreement(app, reply, `${date} ${status} at ${time}`);
          if (app.blocked) blocked++;
        }
      }
    }
    // Both answers occur, so agreement is not two refusals or two passes throughout.
    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThan(DAYS.length * CLOCK.length * STATUSES.length);
  });

  it.each([
    ['the same id', 'Casa Amara', CASA.id],
    ['the same id, renamed', 'Casa Amara (old)', CASA.id],
    ['another id, the same name', 'Casa Amara', 'F-other'],
    ['no id, the same name', 'Casa Amara', ''],
    ['no id, the name spelt otherwise', '  CASA   amara! ', ''],
    ['no id, an accent', 'Cása Amara', ''],
    ['no id, another name', 'Casa Amarah', ''],
    ['no id, another number', 'Casa Amara 2', ''],
  ])('on which rows are the property: %s', async (_label, title, id) => {
    const { app, reply } = await verdicts({ now: '2026-03-09 10:00', typed: [postRow('2026-03-06', title, 'Posted', id)] });

    expectAgreement(app, reply, title);
  });

  it.each([
    ['a date Sheets made a date', { typed: [postRow('3/6/2026', 'Casa Amara', 'Posted', CASA.id)] }],
    ['M/d/yyyy left as text', { text: [postRow('3/6/2026', 'Casa Amara', 'Posted', CASA.id)] }],
    ['an ISO timestamp in UTC', { text: [postRow('2026-03-06T23:30:00Z', 'Casa Amara', 'Posted', CASA.id)] }],
    ['an impossible date', { text: [postRow('2026-02-30', 'Casa Amara', 'Posted', CASA.id)] }],
    ['words', { text: [postRow('last Friday', 'Casa Amara', 'Posted', CASA.id)] }],
    ['a folder named 1201, made a number', { typed: [postRow('2026-03-06', '1201', 'Posted', '')], listing: TOWER }],
  ] as const)('on how a row is written: %s', async (_label, rows) => {
    const { app, reply } = await verdicts({ now: '2026-03-09 10:00', ...rows });

    expectAgreement(app, reply, _label);
  });

  it('on a post the server itself logged on an earlier day', async () => {
    const w = createWorld({ now: '2026-03-04 21:15' });
    w.logPost('jan', CASA, { status: 'Pending' });
    w.project.clock.set('2026-03-10 07:30');

    const rows = await w.app('maria').tracker.posts();
    const app = cooldown(lastPostedOn(rows, CASA), '2026-03-10', { cooldownDays: 7 });

    expectAgreement(app, w.logPost('ana', CASA), 'logged on the 4th');
    expect(app.blocked).toBe(true);
  });
});

// ------------------------------------------------------------------ the lock

describe('the cooldown is decided under the lock', () => {
  /**
   * Jan logs CASA. At the k-th point between two of his request's Sheets
   * operations, Ana's request for CASA arrives and runs. If she is told the
   * server is busy, she tries again once his has finished.
   */
  function race(k: number, options: ProjectOptions = {}) {
    const w = createWorld(options);
    let points = 0;
    let first: Reply | undefined;
    w.project.interleave((_what, depth) => {
      if (depth !== 1) return;
      if (++points === k) first = w.logPost('ana', CASA);
    });
    const jan = w.logPost('jan', CASA);
    w.project.interleave(null);
    const ana = first?.['error'] === 'busy' ? w.logPost('ana', CASA) : first;
    return { jan, ana, firstTry: first, points, rows: w.posts.lastRow - 1 };
  }

  const POINTS = race(0).points;

  it('lets exactly one of two interns through, wherever the second request lands in the first', () => {
    expect(POINTS).toBeGreaterThan(10);
    for (let k = 1; k <= POINTS; k++) {
      const { jan, ana, rows } = race(k);
      const outcomes = [jan, ana].map((r) => (r?.['ok'] === true ? 'ok' : r?.['error']));

      expect(outcomes.sort(), `second request at point ${k}`).toEqual(['cooldown', 'ok']);
      expect(rows, `second request at point ${k}`).toBe(1);
    }
  });

  it('turns the second request away as busy while the first holds the lock', () => {
    const busy = Array.from({ length: POINTS }, (_, i) => race(i + 1).firstTry?.['error']).filter((e) => e === 'busy');

    expect(busy.length).toBeGreaterThan(0);
  });

  /** logPost with its cooldown check moved above the lock: the bug this test exists to catch. */
  function checkBeforeLock(file: string, src: string): string {
    if (file !== 'Code.gs') return src;
    const start = src.indexOf('function logPost_(');
    const lock = src.indexOf('  var lock = LockService.getScriptLock();', start);
    const checkStart = src.indexOf('    var when = new Date();', lock);
    const checkEnd = src.indexOf('    if (guard) return guard;\n', checkStart);
    if (start < 0 || lock < 0 || checkStart < 0 || checkEnd < 0) {
      throw new Error('logPost no longer reads as this mutation expects: update checkBeforeLock.');
    }
    const end = checkEnd + '    if (guard) return guard;\n'.length;
    const check = src.slice(checkStart, end).replace(/^ {4}/gm, '  ');
    return src.slice(0, lock) + check + src.slice(lock, checkStart) + src.slice(end);
  }

  it('would catch a check made before the lock: then both get through', () => {
    const points = race(0, { patch: checkBeforeLock }).points;
    const doubled = Array.from({ length: points }, (_, i) => race(i + 1, { patch: checkBeforeLock }).rows).filter(
      (rows) => rows === 2,
    );

    expect(doubled.length).toBeGreaterThan(0);
  });
});
