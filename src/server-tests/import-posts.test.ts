/**
 * ImportPosts.gs: the interns' posts from before Post-It, on their own
 * "POSTING TRACKER - INTERNS" sheet (one tab per intern), copied onto the
 * tracker's Posts tab. The interns' sheet is only read. PREVIEW_IMPORT writes
 * the Import preview tab only; RUN_IMPORT adds the rows, and adds nothing twice.
 */

import { describe, expect, it } from 'vitest';
import type { Tab } from './fake-sheets';
import { CASA, createWorld, LOT_9, PEOPLE } from './world';

const SOURCE_ID = 'S-interns';
// As the interns' tabs have them: the day column has no name of its own.
const HEADERS = ['Column 1', 'PROPERTY TYPE', 'PROPERTY TITLE', 'FB ACCOUNT NAME', 'LINK', 'TIME POSTED:', 'SHARE POSTING:'];
const POSTS = [
  'Date', 'Property type', 'Property title', 'FB account name', 'Link', 'Time posted', 'Share posting', 'Posted by',
  'Property ID', 'FB Group',
];

type Row = readonly [day: string, type: string, title: string, fb: string, link: string, time: string, status: string];

/** Types `cells` into row `row` of `tab`, as an intern types them; '' leaves a cell empty. */
function put(tab: Tab, row: number, cells: Row): void {
  cells.forEach((value, i) => {
    if (value !== '') tab.typeAt(row, i + 1, value);
  });
}

const share = (id: string) => `https://www.facebook.com/share/p/${id}/`;

/** The Posts rows, each by its header. The test world's tab has the older headers: Title, Post Link, PropertyId. */
function postsOf(w: ReturnType<typeof createWorld>): Record<string, string>[] {
  const headers = w.posts.row(1);
  return Array.from({ length: w.posts.lastRow - 1 }, (_, i) => {
    const row = w.posts.row(i + 2);
    return Object.fromEntries(headers.map((h, j) => [h, row[j] ?? '']));
  });
}

/** One of Jan's Posts rows, as the import writes it. */
function post(date: string, type: string, title: string, link: string, time: string, status: string, id: string, group: string) {
  return {
    Date: date, Title: title, Type: type, Time: time, Status: status, 'FB Account': 'APG Main', 'Post Link': link,
    'Posted By': PEOPLE.jan.name, PropertyId: id, Notes: '', 'FB Group': group,
  };
}

/** A world on 28 Oct 2026 with the interns' sheet beside it: Jan's tab laid out as the interns keep theirs. */
function world() {
  const w = createWorld({ now: '2026-10-28 10:00' });
  const source = w.project.sheets.create(SOURCE_ID, { name: 'POSTING TRACKER - INTERNS' });
  source.addSheet('(KEEP BLANK)', HEADERS);
  const jan = source.addSheet('Jan', HEADERS);
  // Rows 2 and 3 are the table's blank bands; the day is written once, on its first row.
  put(jan, 4, ['10/26/26', 'Condo / House and Lot', '*Casa Amara', 'APG Main', share('A1'), '10:23 AM', 'Posted']);
  put(jan, 5, ['', 'Lot', 'Verdant Hills Lot 9', 'APG Main', 'https://www.facebook.com/groups/apgmain/posts/77/', '11:35 AM', 'Posted']);
  put(jan, 6, ['', 'Warehouse', 'Pasig, 741 Santolan', 'APG Main', 'https://www.facebook.com/groups/870973150864070/my_pending_content', '1:16 PM', 'Pending']);
  put(jan, 7, ['', '', '', '', '', '', 'Not Shared']);
  put(jan, 8, ['', 'Warehouse', 'Pasig, 1000 Elisco Road', '', '', '', 'Not Shared']);
  // Row 9 blank: the band between days.
  put(jan, 10, ['10/27/26', 'Warehouse', 'Pasig, 741 Acacia', 'APG Main', 'https://www.facebook.com/groups/870973150864070/my_pending_content', '8:21 AM', 'Pending']);
  put(jan, 11, ['', 'Warehouse', 'Pulilan, 1728 Jolly Industrial', 'APG Main', '', '10:21 AM', 'Posted']);
  w.project.evaluate(`(IMPORT.SOURCE_SHEET_ID = '${SOURCE_ID}', 0)`);
  return { w, source, jan };
}

const run = (w: ReturnType<typeof createWorld>, name: 'PREVIEW_IMPORT' | 'RUN_IMPORT') =>
  w.project.run(name) as { added: number; skipped: number; notPosted: number; tabs: { tab: string; postedBy: string; note: string }[] };

describe('RUN_IMPORT', () => {
  it('adds each posted row to Posts as logPost writes one, the day carried down from its first row', () => {
    const { w } = world();
    expect(run(w, 'RUN_IMPORT')).toMatchObject({ added: 4, skipped: 1, notPosted: 1 });

    const pending = 'https://www.facebook.com/groups/870973150864070/my_pending_content';
    expect(postsOf(w)).toEqual([
      post('2026-10-26', 'Condo / House and Lot', '*Casa Amara', share('A1'), '10:23 AM', 'Posted', CASA.id, ''),
      post('2026-10-26', 'Lot', 'Verdant Hills Lot 9', 'https://www.facebook.com/groups/apgmain/posts/77/', '11:35 AM', 'Posted', LOT_9.id, 'apgmain'),
      post('2026-10-26', 'Warehouse', 'Pasig, 741 Santolan', pending, '1:16 PM', 'Pending', '', ''),
      // A "pending posts" link stands for many posts: the day and the listing tell them apart.
      post('2026-10-27', 'Warehouse', 'Pasig, 741 Acacia', pending, '8:21 AM', 'Pending', '', ''),
    ]);
  });

  it('adds nothing twice, run again or for a post already on Posts', () => {
    const { w, jan } = world();
    // Jan's post of Lot 9 is on Posts already, logged from the app.
    w.logPost('jan', LOT_9, { postLink: 'https://m.facebook.com/groups/APGMAIN/permalink/77?ref=x' });
    put(jan, 12, ['', 'Lot', 'Verdant Hills Lot 9', 'APG Main', 'https://www.facebook.com/groups/apgmain/posts/77/', '3:00 PM', 'Posted']);

    expect(run(w, 'RUN_IMPORT')).toMatchObject({ added: 3, skipped: 3 });
    const after = w.posts.lastRow;
    expect(run(w, 'RUN_IMPORT')).toMatchObject({ added: 0 });
    expect(w.posts.lastRow).toBe(after);
  });

  it('makes the cooldown carry on from the old posts', () => {
    const { w } = world();
    run(w, 'RUN_IMPORT');
    // Casa Amara was posted on 26 Oct, two days ago, on the interns' sheet.
    expect(w.logPost('ana', CASA)).toMatchObject({ ok: false, error: 'cooldown', lastPosted: '2026-10-26' });
  });

  it('only reads the interns\' sheet', () => {
    const { w, source } = world();
    const before = source.tabs().map((t) => source.sheet(t).show());
    run(w, 'PREVIEW_IMPORT');
    run(w, 'RUN_IMPORT');
    expect(source.tabs().map((t) => source.sheet(t).show())).toEqual(before);
  });

  it('says what to set when the interns\' sheet is not named', () => {
    const { w } = world();
    w.project.evaluate(`(IMPORT.SOURCE_SHEET_ID = '', 0)`);
    expect(() => run(w, 'RUN_IMPORT')).toThrow(/Set IMPORT\.SOURCE_SHEET_ID/);
    expect(w.posts.lastRow).toBe(1);
  });
});

describe('PREVIEW_IMPORT', () => {
  it('writes the Import preview tab only: each tab\'s credit, each row to add, each row skipped and why', () => {
    const { w } = world();
    const posts = w.posts.lastRow;
    run(w, 'PREVIEW_IMPORT');

    expect(w.posts.lastRow).toBe(posts);
    const tab = w.tracker.sheet('Import preview');
    expect(tab.row(1)).toEqual(['Action', 'Why', 'From tab', 'From row', ...POSTS]);
    const rows = Array.from({ length: tab.lastRow - 1 }, (_, i) => tab.row(i + 2));
    expect(rows.map((r) => [r[0], r[2], r[3]])).toEqual([
      ['Tab', 'Jan', ''],
      ['Add', 'Jan', '4'],
      ['Add', 'Jan', '5'],
      ['Add', 'Jan', '6'],
      ['Add', 'Jan', '10'],
      ['Skip', 'Jan', '11'],
    ].map((r) => r));
    expect(rows[0]![1]).toMatch(/^4 to add, 1 skipped\. matched on the Team tab$/);
    expect(rows[0]![11]).toBe(PEOPLE.jan.name);
    expect(rows[5]![1]).toBe('no link');
  });

  it('is written afresh each time', () => {
    const { w } = world();
    run(w, 'PREVIEW_IMPORT');
    const first = w.tracker.sheet('Import preview').show();
    run(w, 'PREVIEW_IMPORT');
    expect(w.tracker.sheet('Import preview').show()).toEqual(first);
  });
});

describe('who a tab is credited to', () => {
  function credits(tabs: readonly string[], names: Readonly<Record<string, string>> = {}) {
    const { w, source } = world();
    for (const name of tabs) {
      const tab = source.addSheet(name, HEADERS);
      put(tab, 4, ['10/20/26', 'Lot', `Listing of ${name}`, 'APG Main', share(`X-${name}`), '9:00 AM', 'Posted']);
    }
    w.project.evaluate(`(IMPORT.NAMES = ${JSON.stringify(names)}, 0)`);
    return Object.fromEntries(run(w, 'PREVIEW_IMPORT').tabs.map((t) => [t.tab, t]));
  }

  it('is the one person on the Team tab whose name begins with the tab\'s', () => {
    const tabs = credits(['Ana', 'maria', 'Former']);
    expect(tabs['Ana']!.postedBy).toBe(PEOPLE.ana.name);
    expect(tabs['maria']!.postedBy).toBe(PEOPLE.maria.name);
    // Left the team, still theirs.
    expect(tabs['Former']!.postedBy).toBe(PEOPLE.gone.name);
  });

  it('is the tab\'s own name, with a note to set it, for nobody on the team or a name that is only a start', () => {
    const tabs = credits(['Prince', 'Ma']);
    expect(tabs['Prince']).toMatchObject({ postedBy: 'Prince', note: expect.stringMatching(/^nobody on the Team tab: .*IMPORT\.NAMES/) });
    // "Ma" begins "Maria", but is not a whole name of hers.
    expect(tabs['Ma']).toMatchObject({ postedBy: 'Ma' });
  });

  it('is IMPORT.NAMES\' when it names the tab', () => {
    const tabs = credits(['Prince'], { Prince: 'Prince Villanueva' });
    expect(tabs['Prince']).toMatchObject({ postedBy: 'Prince Villanueva', note: 'set in IMPORT.NAMES' });
  });

  it('skips the template tab, and says when a tab has no header row', () => {
    const { w, source } = world();
    source.addSheet('Notes').typeAt(1, 1, 'Reminders for the week');
    const tabs = run(w, 'PREVIEW_IMPORT').tabs;
    expect(tabs.map((t) => t.tab)).toEqual(['Jan', 'Notes']);
    expect(tabs[1]!.note).toMatch(/^no header row with Property title and Link/);
  });
});

describe('the day, as the interns write it', () => {
  it.each([
    ['10/26/26', '2026-10-26'],
    ['1/5/27', '2027-01-05'],
    ['10/26/2026', '2026-10-26'],
    ['2026-10-26', '2026-10-26'],
  ])('reads %j as %s, typed or as text', (written, day) => {
    for (const asText of [false, true]) {
      const w = createWorld({ now: '2027-02-01 10:00' });
      const tab = w.project.sheets.create(SOURCE_ID).addSheet('Jan', HEADERS);
      if (asText) tab.writeText(['', '', '', '', '', '', ''], [written, 'Lot', 'Casa Amara', 'APG Main', share('D'), '9:00 AM', 'Posted']);
      else put(tab, 2, [written, 'Lot', 'Casa Amara', 'APG Main', share('D'), '9:00 AM', 'Posted']);
      w.project.evaluate(`(IMPORT.SOURCE_SHEET_ID = '${SOURCE_ID}', 0)`);
      run(w, 'RUN_IMPORT');
      expect(w.posts.row(2)[0], `${written}, ${asText ? 'text' : 'typed'}`).toBe(day);
    }
  });

  it('skips a row whose day it cannot read, saying so', () => {
    const w = createWorld();
    const tab = w.project.sheets.create(SOURCE_ID).addSheet('Jan', HEADERS);
    tab.writeText(['', '', '', '', '', '', ''], ['Monday', 'Lot', 'Casa Amara', 'APG Main', share('E'), '9:00 AM', 'Posted']);
    w.project.evaluate(`(IMPORT.SOURCE_SHEET_ID = '${SOURCE_ID}', 0)`);
    run(w, 'PREVIEW_IMPORT');
    expect(w.tracker.sheet('Import preview').row(3).slice(0, 2)).toEqual(['Skip', 'no date it can read']);
  });
});
