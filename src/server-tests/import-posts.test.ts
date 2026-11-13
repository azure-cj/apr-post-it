/**
 * ImportPosts.gs: the interns' posts from before Post-It, on their own
 * "POSTING TRACKER - INTERNS" sheet (one tab per intern), copied onto the
 * tracker's Posts tab. The interns' sheet is only read. PREVIEW_IMPORT writes
 * the Import preview tab only; RUN_IMPORT adds the rows, and adds nothing twice.
 */

import { describe, expect, it } from 'vitest';
import { cooldown, lastPostedOn } from '../core/cooldown';
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
    expect(run(w, 'RUN_IMPORT')).toMatchObject({ added: 5, skipped: 0, notPosted: 1 });

    const pending = 'https://www.facebook.com/groups/870973150864070/my_pending_content';
    expect(postsOf(w)).toEqual([
      post('2026-10-26', 'Condo / House and Lot', '*Casa Amara', share('A1'), '10:23 AM', 'Posted', CASA.id, ''),
      post('2026-10-26', 'Lot', 'Verdant Hills Lot 9', 'https://www.facebook.com/groups/apgmain/posts/77/', '11:35 AM', 'Posted', LOT_9.id, 'apgmain'),
      // Pending then: saved as Posted, so it is not waiting in anyone's My queue.
      post('2026-10-26', 'Warehouse', 'Pasig, 741 Santolan', pending, '1:16 PM', 'Posted', '', ''),
      // A "pending posts" link stands for many posts: the day and the listing tell them apart.
      post('2026-10-27', 'Warehouse', 'Pasig, 741 Acacia', pending, '8:21 AM', 'Posted', '', ''),
      // Marked Posted with no link: added, its Link empty.
      post('2026-10-27', 'Warehouse', 'Pulilan, 1728 Jolly Industrial', '', '10:21 AM', 'Posted', '', ''),
    ]);
  });

  it('adds nothing twice, run again or for a post already on Posts', () => {
    const { w, jan } = world();
    // Jan's post of Lot 9 is on Posts already, logged from the app.
    w.logPost('jan', LOT_9, { postLink: 'https://m.facebook.com/groups/APGMAIN/permalink/77?ref=x' });
    put(jan, 12, ['', 'Lot', 'Verdant Hills Lot 9', 'APG Main', 'https://www.facebook.com/groups/apgmain/posts/77/', '3:00 PM', 'Posted']);

    expect(run(w, 'RUN_IMPORT')).toMatchObject({ added: 4, skipped: 2 });
    const after = w.posts.lastRow;
    expect(run(w, 'RUN_IMPORT')).toMatchObject({ added: 0 });
    expect(w.posts.lastRow).toBe(after);
  });

  it('makes the cooldown carry on from the old posts', async () => {
    const { w } = world();
    run(w, 'RUN_IMPORT');
    // Casa Amara was posted on 26 Oct, two days ago, on the interns' sheet: the app shows it as posted recently.
    const rows = await w.app('maria').tracker.posts();
    expect(cooldown(lastPostedOn(rows, CASA), '2026-10-28', { cooldownDays: 7 })).toMatchObject({
      blocked: true,
      lastPosted: '2026-10-26',
    });
    // The server warns, it doesn't block (v19): a post now is saved.
    expect(w.logPost('ana', CASA)).toMatchObject({ ok: true });
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

describe('the sync', () => {
  type Synced = { added: number } | null;
  const sync = (w: ReturnType<typeof createWorld>, name: 'START_SYNC' | 'SYNC_IMPORT') => w.project.run(name) as Synced;
  const waiting = (w: ReturnType<typeof createWorld>) => w.project.triggers.list().map((t) => t.handler);
  const halfHour = 30 * 60_000;

  it('adds only the rows with their own Facebook link from the last two weeks, then runs every half hour', () => {
    const { w, jan } = world();
    // Older than two weeks: RUN_IMPORT's, not the sync's.
    put(jan, 12, ['10/01/26', 'Lot', 'Verdant Hills Lot 9', 'APG Main', share('OLD'), '9:00 AM', 'Posted']);

    expect(sync(w, 'START_SYNC')).toMatchObject({ added: 2 });
    // Casa Amara and Lot 9: the two pending links and the row with no link wait.
    expect(postsOf(w).map((p) => p['Title'])).toEqual(['*Casa Amara', 'Verdant Hills Lot 9']);
    expect(waiting(w)).toEqual(['SYNC_IMPORT']);
    expect(w.project.run('SYNC_STATUS')).toMatchObject({ on: true, last: '2026-10-28 10:00: 2 added.' });

    // Jan logs a new post on the sheet, and the pending one gets its own link.
    put(jan, 13, ['10/28/26', 'Warehouse', 'Pasig, 741 Acacia', 'APG Main', share('B2'), '9:40 AM', 'Posted']);
    w.project.clock.advance(halfHour);
    expect(w.project.fireTriggers()).toEqual(['SYNC_IMPORT']);
    expect(postsOf(w).map((p) => p['Title'])).toEqual(['*Casa Amara', 'Verdant Hills Lot 9', 'Pasig, 741 Acacia']);
    expect(postsOf(w)[2]).toMatchObject({ Date: '2026-10-28', 'Posted By': PEOPLE.jan.name, Status: 'Posted' });

    // Nothing new: nothing added, and it carries on.
    w.project.clock.advance(halfHour);
    expect(w.project.fireTriggers()).toEqual(['SYNC_IMPORT']);
    expect(w.posts.lastRow).toBe(4);
    expect(waiting(w)).toEqual(['SYNC_IMPORT']);
  });

  it("doesn't add a post logged from the app as well, or a row whose title was fixed later", () => {
    const { w, jan } = world();
    w.logPost('jan', CASA, { postLink: share('A1') });
    sync(w, 'START_SYNC');
    jan.typeAt(5, 3, 'Verdant Hills Lot 9 (fixed)');
    w.project.clock.advance(halfHour);
    w.project.fireTriggers();

    expect(postsOf(w).map((p) => p['Post Link'])).toEqual([share('A1'), 'https://www.facebook.com/groups/apgmain/posts/77/']);
  });

  it('stops with STOP_SYNC, and keeps what it added', () => {
    const { w } = world();
    sync(w, 'START_SYNC');
    w.project.run('STOP_SYNC');

    expect(waiting(w)).toEqual([]);
    expect(w.project.run('SYNC_STATUS')).toMatchObject({ on: false });
    expect(sync(w, 'SYNC_IMPORT')).toBeNull();
    expect(w.posts.lastRow).toBe(3);
  });

  it('only reads the interns\' sheet, and says what to set before it starts', () => {
    const { w, source } = world();
    const before = source.tabs().map((t) => source.sheet(t).show());
    sync(w, 'START_SYNC');
    expect(source.tabs().map((t) => source.sheet(t).show())).toEqual(before);

    const other = world();
    other.w.project.evaluate(`(IMPORT.SOURCE_SHEET_ID = '', 0)`);
    expect(() => sync(other.w, 'START_SYNC')).toThrow(/Set IMPORT\.SOURCE_SHEET_ID/);
    expect(waiting(other.w)).toEqual([]);
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
      ['Add', 'Jan', '11'],
    ].map((r) => r));
    expect(rows[0]![1]).toBe('5 to add (1 with no link; 2 Pending, saved as Posted), 0 skipped. 1 not imported for their status ("Not Shared" 1). matched on the Team tab');
    expect(rows[0]![11]).toBe(PEOPLE.jan.name);
    expect(rows[5]![8]).toBe('');
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
    expect(tabs[1]!.note).toBe('no header row with Property title and Link, so not read. Its first row: "Reminders for the week".');
  });

  it('says a tab is empty, and reads "Ana " as Ana', () => {
    const { w, source } = world();
    source.addSheet('Blank');
    const ana = source.addSheet('Ana ', HEADERS);
    put(ana, 4, ['10/20/26', 'Lot', 'Ana listing', 'APG Main', share('X-ana'), '9:00 AM', 'Posted']);
    const tabs = run(w, 'PREVIEW_IMPORT').tabs;
    expect(tabs.find((t) => t.tab === 'Blank')!.note).toMatch(/The tab is empty\.$/);
    expect(tabs.find((t) => t.tab === 'Ana')!.postedBy).toBe(PEOPLE.ana.name);
  });

  it('counts why rows were skipped, and shows a day it could not read', () => {
    const { w, source } = world();
    const kim = source.addSheet('Kim', HEADERS);
    put(kim, 4, ['sometime', 'Lot', 'Kim one', 'APG Main', share('X-k1'), '9:00 AM', 'Posted']);
    put(kim, 5, ['', 'Lot', 'Kim two', 'APG Main', share('X-k2'), '9:00 AM', 'Posted']);
    const tab = run(w, 'PREVIEW_IMPORT').tabs.find((t) => t.tab === 'Kim')!;
    expect(tab).toMatchObject({ add: 0, skip: 2, why: { 'no date it can read': 2 } });
    expect(tabRow(w, 'Kim')[1]).toMatch(/^0 to add, 2 skipped \(2 no date it can read\)\. A day it could not read: "sometime"\./);
  });
});

/** The Import preview's Tab row for `tab`. */
function tabRow(w: ReturnType<typeof createWorld>, tab: string): string[] {
  const preview = w.tracker.sheet('Import preview');
  return Array.from({ length: preview.lastRow }, (_, i) => preview.row(i + 1)).find((r) => r[0] === 'Tab' && r[2] === tab)!;
}

/** A world whose interns' sheet has one tab, `name`, set up by `fill`; returns the posts it would add. */
function oneTab(fill: (source: ReturnType<ReturnType<typeof createWorld>['project']['sheets']['create']>) => void) {
  const w = createWorld({ now: '2026-10-28 10:00' });
  const source = w.project.sheets.create(SOURCE_ID);
  fill(source);
  w.project.evaluate(`(IMPORT.SOURCE_SHEET_ID = '${SOURCE_ID}', 0)`);
  const summary = run(w, 'PREVIEW_IMPORT');
  const preview = w.tracker.sheet('Import preview');
  const added = Array.from({ length: preview.lastRow - 1 }, (_, i) => preview.row(i + 2))
    .filter((r) => r[0] === 'Add')
    .map((r) => ({ row: r[3], date: r[4], type: r[5], title: r[6], fb: r[7], link: r[8], time: r[9], status: r[10] }));
  return { w, summary, added };
}

describe('the layouts the interns\' tabs have', () => {
  it('reads Type, Place, Facebook name and Status by those names, Place as the title', () => {
    const { added } = oneTab((source) => {
      const tab = source.addSheet('Lorraine', ['DATE SCHEDULED/POSTED', 'TYPE', 'PLACE', 'FACEBOOK NAME', 'LINK', 'STATUS', 'TIME SCHEDULED/POSTED']);
      tab.writeText(['10/20/2026', 'Office', 'Makati, Ayala Ave', 'Luna Mae', share('L1'), 'Posted', '9:00 AM']);
    });
    expect(added).toEqual([{ row: '2', date: '2026-10-20', type: 'Office', title: 'Makati, Ayala Ave', fb: 'Luna Mae', link: share('L1'), time: '9:00 AM', status: 'Posted' }]);
  });

  it('finds the Link column by the Facebook links below a header row that does not name it', () => {
    const { added, summary } = oneTab((source) => {
      const tab = source.addSheet('Frederik', ['OFFICE SPACE FOR RENT', 'PROPERTY TYPE', 'PROPERTY TITLE', 'FB ACCOUNT', '', 'TIME', 'STATUS']);
      tab.writeText(['10/20/2026', 'Office', 'BGC Tower', 'Luna Mae', share('F1'), '9:00 AM', 'Posted']);
    });
    expect(summary.tabs[0]).toMatchObject({ add: 1 });
    expect(added[0]).toMatchObject({ title: 'BGC Tower', link: share('F1') });
  });

  it('reads a table of "Column 1", "Column 2"..., and a tab with no header row, in the template\'s order', () => {
    const { added } = oneTab((source) => {
      source.addSheet('Bea', ['Column 1', 'Column 2', 'Column 3', 'Column 4', 'Column 5', 'Column 6', 'Column 7'])
        .writeText(['10/20/2026', 'Lot', 'Bea lot', 'Luna Mae', share('B1'), '9:00 AM', 'Posted']);
      source.addSheet('Kristel')
        .writeText(['10/21/2026', 'Virtual Office', 'New Virtual Office', 'Luna Mae', share('K1'), '4:33 PM', 'Posted']);
    });
    expect(added.map((a) => [a.title, a.date, a.row])).toEqual([['Bea lot', '2026-10-20', '2'], ['New Virtual Office', '2026-10-21', '1']]);
  });

  it('gives a merged cell\'s value to every row it covers', () => {
    const { added } = oneTab((source) => {
      const tab = source.addSheet('Ishi', HEADERS);
      tab.writeText(
        ['10/20/2026', 'Lot', 'Merged lot', 'APG Main', share('M1'), '9:00 AM', 'Posted'],
        ['', '', '', 'APG Main', share('M2'), '9:05 AM', 'Posted'],
      );
      tab.merge(2, 2, 2).merge(2, 3, 2);
    });
    expect(added.map((a) => [a.type, a.title, a.link])).toEqual([['Lot', 'Merged lot', share('M1')], ['Lot', 'Merged lot', share('M2')]]);
  });

  it('passes over the header written again further down', () => {
    const { summary } = oneTab((source) => {
      source.addSheet('Mcximoz', HEADERS).writeText(
        ['10/20/2026', 'Lot', 'First lot', 'APG Main', share('X1'), '9:00 AM', 'Posted'],
        ['DATE', 'PROPERTY TYPE', 'PROPERTY TITLE', 'FB ACCOUNT NAME', 'LINK', 'TIME POSTED', 'SHARE POSTING'],
        ['10/21/2026', 'Lot', 'Second lot', 'APG Main', share('X2'), '9:00 AM', 'Posted'],
      );
    });
    expect(summary.tabs[0]).toMatchObject({ add: 2, skip: 0, note: expect.not.stringContaining('could not read') });
  });
});

describe('the status, as the interns mark it', () => {
  it('imports Posted, Shared, Done and a ticked box as Posted; counts the rest by what they say', () => {
    const { w, summary, added } = oneTab((source) => {
      source.addSheet('Jan', HEADERS).writeText(
        ['10/20/2026', 'Lot', 'One', 'APG Main', share('S1'), '9:00 AM', 'Shared'],
        ['', 'Lot', 'Two', 'APG Main', share('S2'), '9:00 AM', 'done'],
        ['', 'Lot', 'Three', 'APG Main', share('S3'), '9:00 AM', 'TRUE'],
        ['', 'Lot', 'Four', 'APG Main', share('S4'), '9:00 AM', 'Scheduled'],
        ['', 'Lot', 'Five', 'APG Main', '', '', 'Not Shared'],
        ['', 'Lot', 'Six', 'APG Main', share('S6'), '9:00 AM', 'Not Shared'],
        ['', 'Lot', 'Seven', 'APG Main', share('S7'), '9:00 AM', 'LIMIT'],
        ['', 'Lot', 'Eight', 'APG Main', '', '', 'maybe'],
      );
    });
    // Scheduled is Pending, saved as Posted.
    expect(added.map((a) => [a.title, a.status])).toEqual([['One', 'Posted'], ['Two', 'Posted'], ['Three', 'Posted'], ['Four', 'Posted']]);
    expect(summary.notPosted).toBe(4);
    expect(tabRow(w, 'Jan')[1]).toContain('4 not imported for their status ("Not Shared" 2, 1 with a link; "LIMIT" 1, 1 with a link; "maybe" 1).');
  });

  it('imports a row not marked either way that holds a Facebook link, as posted', () => {
    const { w, added } = oneTab((source) => {
      source.addSheet('Jan', HEADERS).writeText(
        ['10/20/2026', 'Lot', 'One', 'APG Main', share('U1'), '9:00 AM', ''],
        ['', 'Lot', 'Two', 'APG Main', share('U2'), '9:00 AM', 'Post (Group Page)'],
        ['', 'Lot', 'Three', 'APG Main', 'https://www.facebook.com/groups/1/my_pending_content', '9:00 AM', ''],
        ['', 'Lot', 'Four', 'APG Main', '', '', ''],
      );
    });
    expect(added.map((a) => [a.title, a.status])).toEqual([['One', 'Posted'], ['Two', 'Posted'], ['Three', 'Posted']]);
    expect(tabRow(w, 'Jan')[1]).toMatch(
      /^3 to add \(3 not marked, posted by their link; 1 Pending, saved as Posted\), 0 skipped\. 1 not imported for their status \(blank 1\)\./);
  });

  it('reads every row with a link as posted on a tab with no Status column', () => {
    const { added, summary } = oneTab((source) => {
      source.addSheet('Jan', ['DATE', 'PROPERTY TITLE', 'LINK']).writeText(['10/20/2026', 'One', share('N1')], ['', 'Two', '']);
    });
    expect(added.map((a) => [a.title, a.status])).toEqual([['One', 'Posted']]);
    expect(summary.tabs[0]).toMatchObject({ add: 1, byLink: 1, notPosted: 1 });
  });

  it('takes a link typed in another column, and adds a row marked Posted with no link, its Link empty', () => {
    const { w, added } = oneTab((source) => {
      source.addSheet('Ralph', HEADERS).writeText(
        ['10/20/2026', 'Lot', 'One', 'APG Main', '', '9:00 AM', 'Posted', share('R1')],
        ['', 'Lot', 'Two', 'APG Main', '', '9:00 AM', 'Posted'],
        ['', 'Lot', 'Three', 'APG Main', 'Facebook Page', '9:00 AM', 'Posted'],
      );
    });
    expect(added.map((a) => [a.title, a.link])).toEqual([['One', share('R1')], ['Two', ''], ['Three', '']]);
    expect(tabRow(w, 'Ralph')[1]).toMatch(/^3 to add \(2 with no link\), 0 skipped\./);
  });

  it('shows the header and a row left out when little is added', () => {
    const { w } = oneTab((source) => {
      source.addSheet('Princess', HEADERS).writeText(
        ['10/20/2026', 'Lot', 'One', 'APG Main', '', '9:00 AM', 'Archived'],
        ['', 'Lot', 'Two', 'APG Main', share('P2'), '9:00 AM', 'Posted'],
      );
    });
    expect(tabRow(w, 'Princess')[1]).toContain(
      'Header row 1: "Column 1 | PROPERTY TYPE | PROPERTY TITLE | FB ACCOUNT NAME | LINK | TIME POSTED: | SHARE POSTING:". ' +
      'First row left out, row 2: "10/20/2026 | Lot | One | APG Main |  | 9:00 AM | Archived".');
  });
});

describe('a header that disagrees with its rows', () => {
  it('reads the day from the column holding days, of two named "Column 1"', () => {
    const { added } = oneTab((source) => {
      source.addSheet('Jeremy', ['Column 1', 'Column 1', 'PROPERTY TYPE', 'PROPERTY TITLE', 'FB ACCOUNT NAME', 'LINK', 'TIME POSTED:', 'SHARE POSTING:'])
        .writeText(['', '06/24/2026', 'Warehouse', 'Novaliches', 'Xer Sam', share('J1'), '12:46 PM', 'Posted']);
    });
    expect(added.map((a) => [a.title, a.date])).toEqual([['Novaliches', '2026-06-24']]);
  });

  it('lines up a header one column off its rows by its Link column', () => {
    const { added } = oneTab((source) => {
      source.addSheet('John', ['', 'Elevate', 'PROPERTY TYPE', 'PROPERTY TITLE', 'FB ACCOUNT NAME', 'LINK', 'TIME POSTED:']).writeText(
        ['11/26/2025', 'virtual office', 'Office one', 'jan', share('H1'), '9:54 AM'],
        ['', 'virtual office', 'Office two', 'jan', share('H2'), '9:55 AM'],
        ['', 'virtual office', 'Office three', 'jan', share('H3'), '9:56 AM'],
      );
    });
    expect(added.map((a) => [a.date, a.type, a.title, a.fb, a.link])).toEqual([
      ['2025-11-26', 'virtual office', 'Office one', 'jan', share('H1')],
      ['2025-11-26', 'virtual office', 'Office two', 'jan', share('H2')],
      ['2025-11-26', 'virtual office', 'Office three', 'jan', share('H3')],
    ]);
  });

  it('finds a Status column with no name by the Posted and Not Shared in it', () => {
    const { added, summary } = oneTab((source) => {
      source.addSheet('Kurt', ['', 'PROPERTY TYPE', 'PROPERTY TITLE', '', 'LINK']).writeText(
        ['10/20/2026', 'Office', 'One', 'Alpha Premier', share('K1'), '9:25 AM', 'Posted'],
        ['', 'Office', 'Two', 'Alpha Premier', share('K2'), '9:26 AM', 'Not Shared'],
        ['', 'Office', 'Three', 'Alpha Premier', '', '9:27 AM', 'Posted'],
      );
    });
    expect(added.map((a) => [a.title, a.status])).toEqual([['One', 'Posted'], ['Three', 'Posted']]);
    expect(summary.tabs[0]).toMatchObject({ notPosted: 1, byLink: 0 });
  });
});

describe('the day as "Sched 13"', () => {
  it('is that day of the month of the day before it, or of the next month once it has gone by', () => {
    const { added } = oneTab((source) => {
      source.addSheet('Kristel').writeText(
        ['10/05/2026', 'Warehouse', 'One', 'PAGE', share('K1'), '11:40 AM', 'Shared'],
        ['Sched 13', 'Warehouse', 'Two', 'PAGE', '', '11:40 AM', 'Shared'],
        ['Sched 2', 'Warehouse', 'Three', 'PAGE', '', '11:40 AM', 'Shared'],
        // No year: the year of the day before it, the next once the month is far behind.
        ['Sched 12/01', 'Warehouse', 'Four', 'PAGE', '', '11:40 AM', 'Shared'],
        ['Sched 3/01', 'Warehouse', 'Five', 'PAGE', '', '11:40 AM', 'Shared'],
      );
    });
    expect(added.map((a) => [a.title, a.date])).toEqual([
      ['One', '2026-10-05'], ['Two', '2026-10-13'], ['Three', '2026-11-02'], ['Four', '2026-12-01'], ['Five', '2027-03-01'],
    ]);
  });
});

describe('the day, on a tab that writes it day first', () => {
  it('reads every day on the tab day first once one begins past 12', () => {
    const { added } = oneTab((source) => {
      source.addSheet('Mcximoz', HEADERS).writeText(
        ['05/09/2025', 'Lot', 'One', 'APG Main', share('D1'), '9:00 AM', 'Posted'],
        ['15/09/2025', 'Lot', 'Two', 'APG Main', share('D2'), '9:00 AM', 'Posted'],
      );
    });
    expect(added.map((a) => [a.title, a.date])).toEqual([['One', '2025-09-05'], ['Two', '2025-09-15']]);
  });

  it('leaves a tab month first when its days are', () => {
    const { added } = oneTab((source) => {
      source.addSheet('Jan', HEADERS).writeText(
        ['05/09/2026', 'Lot', 'One', 'APG Main', share('E1'), '9:00 AM', 'Posted'],
        ['09/15/2026', 'Lot', 'Two', 'APG Main', share('E2'), '9:00 AM', 'Posted'],
        ["03/30/2026'", 'Lot', 'Three', 'APG Main', share('E3'), '9:00 AM', 'Posted'],
      );
    });
    expect(added.map((a) => [a.title, a.date])).toEqual([['Three', '2026-03-30'], ['One', '2026-05-09'], ['Two', '2026-09-15']]);
  });
});

describe('the day, as the interns write it', () => {
  it.each([
    ['10/26/26', '2026-10-26'],
    ['1/5/27', '2027-01-05'],
    ['10/26/2026', '2026-10-26'],
    ['2026-10-26', '2026-10-26'],
    ['08|14/2026', '2026-08-14'],
    ['06/ 16/ 2026', '2026-06-16'],
    ['03/30,2026', '2026-03-30'],
    ['03/03.26', '2026-03-03'],
    ['03/024/26', '2026-03-24'],
    ['8/112026', '2026-08-11'],
    ['1/32026', '2026-01-03'],
    ['Sept 10, 2026', '2026-09-10'],
    ['Sept. 1, 2026', '2026-09-01'],
    // No year: the latest that is not after today, 1 Feb 2027.
    ['March 03', '2026-03-03'],
    ['SEPT. 8', '2026-09-08'],
    ['Jan 5', '2027-01-05'],
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
