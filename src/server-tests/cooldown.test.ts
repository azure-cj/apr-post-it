/**
 * The cooldown since v19: "warn, don't block". The server refuses nothing for
 * it; the app shows a listing posted inside the cooldown as posted recently
 * (cooldown.ts), from the rows the server wrote. So a post inside the cooldown
 * is saved like any other, and the lock only keeps one Facebook post from
 * being logged twice.
 */

import { describe, expect, it } from 'vitest';
import { cooldown, lastPostedOn } from '../core/cooldown';
import type { Reply } from './harness';
import { CASA, createWorld } from './world';

describe('a post inside the cooldown', () => {
  it('is saved, a second row beside the first', () => {
    const w = createWorld();

    expect(w.logPost('jan', CASA)).toMatchObject({ ok: true });
    expect(w.logPost('ana', CASA)).toMatchObject({ ok: true, status: 'Posted', postedBy: 'Ana Reyes' });
    expect(w.posts.lastRow).toBe(3);
    expect([w.posts.row(2)[7], w.posts.row(3)[7]]).toEqual(['Jan Dela Cruz', 'Ana Reyes']);
  });

  it('is saved when a Pending post of the listing is still waiting for approval', () => {
    const w = createWorld();

    expect(w.logPost('jan', CASA, { status: 'Pending' })).toMatchObject({ ok: true, status: 'Pending' });
    expect(w.logPost('ana', CASA)).toMatchObject({ ok: true, status: 'Posted' });
    expect(w.posts.lastRow).toBe(3);
  });

  it('is still shown by the app as posted recently, from the rows the server wrote', async () => {
    const w = createWorld({ now: '2026-03-09 10:00' });
    w.logPost('jan', CASA, { status: 'Pending' });

    const rows = await w.app('maria').tracker.posts();
    expect(cooldown(lastPostedOn(rows, CASA), '2026-03-09', { cooldownDays: 7 })).toMatchObject({
      blocked: true,
      lastPosted: '2026-03-09',
      nextAllowed: '2026-03-16',
    });
  });
});

// ------------------------------------------------------------------ the lock

describe('two interns saving the same listing at once', () => {
  /**
   * Jan logs CASA. At the k-th point between two of his request's Sheets
   * operations, Ana's request for CASA arrives and runs. If she is told the
   * server is busy, she tries again once his has finished.
   */
  function race(k: number, fields: Readonly<Record<string, unknown>> = {}) {
    const w = createWorld();
    let points = 0;
    let first: Reply | undefined;
    w.project.interleave((_what, depth) => {
      if (depth !== 1) return;
      if (++points === k) first = w.logPost('ana', CASA, fields);
    });
    const jan = w.logPost('jan', CASA, fields);
    w.project.interleave(null);
    const ana = first?.['error'] === 'busy' ? w.logPost('ana', CASA, fields) : first;
    return { jan, ana, firstTry: first, points, rows: w.posts.lastRow - 1 };
  }

  const POINTS = race(0).points;

  it('saves both, each with its own link, wherever the second request lands in the first', () => {
    expect(POINTS).toBeGreaterThan(10);
    for (let k = 1; k <= POINTS; k++) {
      const { jan, ana, rows } = race(k);

      expect([jan?.['ok'], ana?.['ok']], `second request at point ${k}`).toEqual([true, true]);
      expect(rows, `second request at point ${k}`).toBe(2);
    }
  });

  it('saves only one when both send the same link: the other is told the post is already logged', () => {
    const fields = { postLink: 'https://www.facebook.com/groups/apg/posts/700/' };
    for (let k = 1; k <= POINTS; k++) {
      const { jan, ana, rows } = race(k, fields);
      const outcomes = [jan, ana].map((r) => (r?.['ok'] === true ? 'ok' : r?.['error']));

      expect(outcomes.sort(), `second request at point ${k}`).toEqual(['link-taken', 'ok']);
      expect(rows, `second request at point ${k}`).toBe(1);
    }
  });

  it('turns the second request away as busy while the first holds the lock', () => {
    const busy = Array.from({ length: POINTS }, (_, i) => race(i + 1).firstTry?.['error']).filter((e) => e === 'busy');

    expect(busy.length).toBeGreaterThan(0);
  });
});
