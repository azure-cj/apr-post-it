/**
 * SpreadsheetApp as Code.gs uses it, and no more forgiving than Sheets.
 *
 * A fake that is kinder than the real thing hides exactly the bugs it is here
 * to find, so these keep Sheets' rules wherever Code.gs can trip on them:
 *
 * - Text written to a cell whose format is automatic is read as if a person
 *   typed it: "14:30" becomes a time, "1201" a number, "TRUE" a boolean,
 *   "2026-03-09" a date, and "=...", "+..." or "- ..." a formula, which this
 *   fake cannot evaluate and reads back as #ERROR! (DECISIONS D7). In a cell
 *   formatted '@', plain text, it stays exactly as written.
 * - getValues() returns dates and times as Date objects of the script's own
 *   realm, so `instanceof Date` in the script behaves as in Apps Script. A
 *   time of day is a date on Sheets' day zero, 1899-12-30.
 * - A range must lie inside the grid. appendRow() grows the grid; getRange()
 *   does not.
 * - The first tab of every spreadsheet has sheet id 0.
 * - setValues() wants exactly the range's shape.
 * - Deleting the last row that is not frozen is refused.
 *
 * Only Manila's clock is kept: UTC+8, which Manila has kept since 1978 and
 * also kept on Sheets' day zero.
 */

export const MANILA = 'Asia/Manila';
export const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
export const PLAIN_TEXT = '@';

const DAY_ZERO = Date.UTC(1899, 11, 30);
const DEFAULT_ROWS = 1000;
const DEFAULT_COLUMNS = 26;

/** A mistake in how the script uses the fake, rather than something Sheets would answer. */
export class HarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessError';
  }
}

/** What a cell holds. A date is kept as its wall-clock time in the sheet's zone, as Sheets keeps a serial number. */
export type Stored =
  | { readonly kind: 'empty' }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'number'; readonly number: number }
  | { readonly kind: 'boolean'; readonly boolean: boolean }
  | { readonly kind: 'date'; readonly wall: number }
  | { readonly kind: 'formula'; readonly formula: string };

interface Cell {
  value: Stored;
  /** '' is automatic; '@' is plain text. */
  format: string;
}

const EMPTY: Stored = { kind: 'empty' };

/** What the fakes need from the harness. */
export interface SheetsHost {
  /** A Date of the script's realm, for `ms` since 1970. */
  scriptDate(ms: number): unknown;
  /**
   * Called before and after every read and write: the points where another
   * request could run in the middle of this one, and where a race test starts one.
   */
  touch(what: string): void;
}

/** Runs one read or write between two touches. */
function op<T>(host: SheetsHost, what: string, fn: () => T): T {
  host.touch(`before ${what}`);
  const result = fn();
  host.touch(`after ${what}`);
  return result;
}

// ------------------------------------------------------------------ typing

const NUMBER = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const PERCENT = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))%$/;
const BOOLEAN = /^(?:true|false)$/i;
const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?\s*m\.?)?$/i;
const YMD = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const MDY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * What Sheets makes of text written to a cell whose format is automatic: the
 * same as if a person had typed it, in an en_US spreadsheet.
 */
export function asTyped(input: string): Stored {
  if (input === '') return EMPTY;
  // A leading apostrophe is Sheets' way of saying "this is text". It is not kept.
  if (input.startsWith("'")) return input.length > 1 ? { kind: 'text', text: input.slice(1) } : EMPTY;

  const t = input.trim();
  if (NUMBER.test(t)) return { kind: 'number', number: Number(t.replace(/,/g, '')) };
  const percent = PERCENT.exec(t);
  if (percent) return { kind: 'number', number: Number(percent[1]) / 100 };
  // "+63 917 123 4567" and "- 3 bedrooms" are formulas to Sheets, and broken ones.
  if (/^[=+-]/.test(input)) return { kind: 'formula', formula: input };
  if (BOOLEAN.test(t)) return { kind: 'boolean', boolean: t.toLowerCase() === 'true' };

  const time = clockTime(t);
  if (time !== null) return { kind: 'date', wall: DAY_ZERO + time };
  const date = calendarDate(t);
  if (date !== null) return { kind: 'date', wall: date };
  return { kind: 'text', text: input };
}

function clockTime(t: string): number | null {
  const m = CLOCK.exec(t);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = Number(m[3] ?? 0);
  const half = m[4]?.toLowerCase();
  if (minutes > 59 || seconds > 59) return null;
  if (half) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (half === 'p' ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

function calendarDate(t: string): number | null {
  let year: number, month: number, day: number;
  let m = YMD.exec(t);
  if (m) {
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = MDY.exec(t);
    if (!m) return null;
    [year, month, day] = [Number(m[3]), Number(m[1]), Number(m[2])];
  }
  const [hours, minutes, seconds] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return wall;
}

function isDate(value: unknown): value is Date {
  // Across realms: the script's Dates are not this module's.
  return Object.prototype.toString.call(value) === '[object Date]';
}

/** A value written by setValue(s) or appendRow into a cell with `format`. */
function enter(input: unknown, format: string, offset: number): Stored {
  if (input === null) return EMPTY;
  if (typeof input === 'string') {
    if (input === '') return EMPTY;
    return format === PLAIN_TEXT ? { kind: 'text', text: input } : asTyped(input);
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`Exception: Invalid argument: ${input}`);
    return { kind: 'number', number: input };
  }
  if (typeof input === 'boolean') return { kind: 'boolean', boolean: input };
  if (isDate(input)) {
    const ms = input.getTime();
    if (Number.isNaN(ms)) throw new Error('Exception: Invalid argument: Invalid Date');
    return { kind: 'date', wall: ms + offset };
  }
  throw new HarnessError(
    `The script wrote ${input === undefined ? 'undefined' : typeof input} to a cell. ` +
      'Sheets takes text, numbers, booleans and dates; write "" for an empty cell.',
  );
}

/** A cell as getValues() returns it. */
function read(value: Stored, offset: number, host: SheetsHost): unknown {
  switch (value.kind) {
    case 'empty':
      return '';
    case 'text':
      return value.text;
    case 'number':
      return value.number;
    case 'boolean':
      return value.boolean;
    case 'date':
      return host.scriptDate(value.wall - offset);
    case 'formula':
      return '#ERROR!';
  }
}

/**
 * A cell for a test to read: text as itself, anything else tagged with what
 * Sheets made of it — "#time 14:30", "#date 2026-03-09", "#number 1201",
 * "#boolean TRUE", "#formula =1+1".
 */
export function show(value: Stored): string {
  switch (value.kind) {
    case 'empty':
      return '';
    case 'text':
      return value.text;
    case 'number':
      return `#number ${value.number}`;
    case 'boolean':
      return `#boolean ${value.boolean ? 'TRUE' : 'FALSE'}`;
    case 'formula':
      return `#formula ${value.formula}`;
    case 'date': {
      const iso = new Date(value.wall).toISOString();
      const [day, time] = [iso.slice(0, 10), iso.slice(11, 16)];
      if (value.wall >= DAY_ZERO && value.wall < DAY_ZERO + 86_400_000) return `#time ${time}`;
      return time === '00:00' ? `#date ${day}` : `#datetime ${day} ${time}`;
    }
  }
}

// ------------------------------------------------------------------ state

class BookState {
  readonly sheets: SheetState[] = [];
  constructor(
    readonly id: string,
    readonly name: string,
    readonly timeZone: string,
  ) {}

  get offset(): number {
    if (this.timeZone !== MANILA) {
      throw new HarnessError(`Spreadsheet "${this.name}" is in ${this.timeZone}; the fake keeps Manila's clock only.`);
    }
    return MANILA_OFFSET_MS;
  }
}

class SheetState {
  /** One array per grid row; a row's array holds only the cells ever touched. */
  readonly grid: Cell[][];
  maxColumns: number;
  frozenRows = 0;
  hidden = false;

  constructor(
    readonly book: BookState,
    public name: string,
    readonly gid: number,
    rows: number,
    columns: number,
  ) {
    this.grid = Array.from({ length: rows }, () => []);
    this.maxColumns = columns;
  }

  get maxRows(): number {
    return this.grid.length;
  }

  /** The cell at 1-based (row, column), created on first touch. */
  cell(row: number, column: number): Cell {
    const cells = this.grid[row - 1];
    if (!cells) throw new HarnessError(`Row ${row} is outside "${this.name}".`);
    return (cells[column - 1] ??= { value: EMPTY, format: '' });
  }

  peek(row: number, column: number): Stored {
    return this.grid[row - 1]?.[column - 1]?.value ?? EMPTY;
  }

  formatAt(row: number, column: number): string {
    return this.grid[row - 1]?.[column - 1]?.format ?? '';
  }

  /** The last row with anything in it, as Sheet.getLastRow(). 0 when empty. */
  lastRow(): number {
    for (let r = this.grid.length; r >= 1; r--) {
      if (this.grid[r - 1]!.some((cell) => cell && cell.value.kind !== 'empty')) return r;
    }
    return 0;
  }

  lastColumn(): number {
    let last = 0;
    for (const cells of this.grid) {
      cells.forEach((cell, i) => {
        if (cell && cell.value.kind !== 'empty' && i + 1 > last) last = i + 1;
      });
    }
    return last;
  }
}

// ------------------------------------------------------------------ the Apps Script surface

interface Shared {
  readonly host: SheetsHost;
  spreadsheet(book: BookState): FakeSpreadsheet;
  sheet(state: SheetState): FakeSheet;
  newGid(book: BookState): number;
}

function integer(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Exception: The parameters (${typeof value}) don't match the method signature (${what} must be a whole number).`);
  }
  return value;
}

function columnLetters(column: number): string {
  let out = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}

class FakeSpreadsheet {
  readonly #book: BookState;
  readonly #shared: Shared;

  constructor(book: BookState, shared: Shared) {
    this.#book = book;
    this.#shared = shared;
  }

  getId(): string {
    return this.#book.id;
  }

  getName(): string {
    return this.#book.name;
  }

  getSpreadsheetTimeZone(): string {
    return this.#book.timeZone;
  }

  getSheets(): FakeSheet[] {
    return this.#book.sheets.map((s) => this.#shared.sheet(s));
  }

  getSheetByName(name: unknown): FakeSheet | null {
    const found = this.#book.sheets.find((s) => s.name === String(name));
    return found ? this.#shared.sheet(found) : null;
  }

  insertSheet(name: unknown): FakeSheet {
    const wanted = String(name);
    if (this.#book.sheets.some((s) => s.name.toLowerCase() === wanted.toLowerCase())) {
      throw new Error(`Exception: A sheet with the name "${wanted}" already exists. Please enter another name.`);
    }
    return op(this.#shared.host, `insertSheet ${wanted}`, () => {
      const state = new SheetState(this.#book, wanted, this.#shared.newGid(this.#book), DEFAULT_ROWS, DEFAULT_COLUMNS);
      this.#book.sheets.push(state);
      return this.#shared.sheet(state);
    });
  }
}

class FakeSheet {
  readonly #s: SheetState;
  readonly #shared: Shared;

  constructor(state: SheetState, shared: Shared) {
    this.#s = state;
    this.#shared = shared;
  }

  getName(): string {
    return this.#s.name;
  }

  getSheetId(): number {
    return this.#s.gid;
  }

  getParent(): FakeSpreadsheet {
    return this.#shared.spreadsheet(this.#s.book);
  }

  getMaxRows(): number {
    return this.#s.maxRows;
  }

  getMaxColumns(): number {
    return this.#s.maxColumns;
  }

  getLastRow(): number {
    return op(this.#shared.host, `${this.#s.name} getLastRow`, () => this.#s.lastRow());
  }

  getLastColumn(): number {
    return op(this.#shared.host, `${this.#s.name} getLastColumn`, () => this.#s.lastColumn());
  }

  getFrozenRows(): number {
    return this.#s.frozenRows;
  }

  hideSheet(): FakeSheet {
    this.#s.hidden = true;
    return this;
  }

  showSheet(): FakeSheet {
    this.#s.hidden = false;
    return this;
  }

  isSheetHidden(): boolean {
    return this.#s.hidden;
  }

  setFrozenRows(rows: unknown): FakeSheet {
    const n = integer(rows, 'rows');
    if (n < 0 || n > this.#s.maxRows) throw new Error('Exception: Those rows are out of bounds.');
    this.#s.frozenRows = n;
    return this;
  }

  getRange(row: unknown, column?: unknown, numRows?: unknown, numColumns?: unknown): FakeRange {
    if (typeof row === 'string') throw new HarnessError('getRange("A1") is not faked: Code.gs uses numbers.');
    const r = integer(row, 'row');
    const c = integer(column, 'column');
    const rows = numRows === undefined ? 1 : integer(numRows, 'numRows');
    const columns = numColumns === undefined ? 1 : integer(numColumns, 'numColumns');
    if (rows < 1) throw new Error('Exception: The number of rows in the range must be at least 1.');
    if (columns < 1) throw new Error('Exception: The number of columns in the range must be at least 1.');
    if (r < 1 || c < 1 || r + rows - 1 > this.#s.maxRows || c + columns - 1 > this.#s.maxColumns) {
      throw new Error('Exception: The coordinates of the range are outside the dimensions of the sheet.');
    }
    return new FakeRange(this.#s, this.#shared, r, c, rows, columns);
  }

  getDataRange(): FakeRange {
    return new FakeRange(this.#s, this.#shared, 1, 1, Math.max(this.#s.lastRow(), 1), Math.max(this.#s.lastColumn(), 1));
  }

  /** Below the last row with anything in it, growing the grid when that is full. */
  appendRow(contents: unknown): FakeSheet {
    if (!Array.isArray(contents)) throw new Error('Exception: The parameters don\'t match the method signature for SpreadsheetApp.Sheet.appendRow.');
    op(this.#shared.host, `${this.#s.name} appendRow`, () => {
      const r = this.#s.lastRow() + 1;
      if (r > this.#s.maxRows) this.#s.grid.push([]);
      if (contents.length > this.#s.maxColumns) this.#s.maxColumns = contents.length;
      const offset = this.#s.book.offset;
      contents.forEach((value: unknown, i: number) => {
        const cell = this.#s.cell(r, i + 1);
        cell.value = enter(value, cell.format, offset);
      });
    });
    return this;
  }

  deleteRow(row: unknown): FakeSheet {
    const r = integer(row, 'rowPosition');
    if (r < 1 || r > this.#s.maxRows) throw new Error('Exception: Those rows are out of bounds.');
    if (r > this.#s.frozenRows && this.#s.maxRows - this.#s.frozenRows <= 1) {
      throw new Error('Exception: Sorry, it is not possible to delete all non-frozen rows.');
    }
    op(this.#shared.host, `${this.#s.name} deleteRow ${r}`, () => this.#s.grid.splice(r - 1, 1));
    return this;
  }

  insertRowAfter(after: unknown): FakeSheet {
    return this.insertRowsAfter(after, 1);
  }

  insertRowsAfter(after: unknown, howMany: unknown): FakeSheet {
    const r = integer(after, 'afterPosition');
    const n = integer(howMany, 'howMany');
    if (r < 1 || r > this.#s.maxRows || n < 1) throw new Error('Exception: Those rows are out of bounds.');
    // New rows have no format of their own: whatever is written to them is read as typed.
    op(this.#shared.host, `${this.#s.name} insertRowsAfter ${r}`, () =>
      this.#s.grid.splice(r, 0, ...Array.from({ length: n }, (): Cell[] => [])),
    );
    return this;
  }
}

class FakeRange {
  readonly #s: SheetState;
  readonly #shared: Shared;
  readonly #row: number;
  readonly #column: number;
  readonly #rows: number;
  readonly #columns: number;

  constructor(state: SheetState, shared: Shared, row: number, column: number, rows: number, columns: number) {
    this.#s = state;
    this.#shared = shared;
    this.#row = row;
    this.#column = column;
    this.#rows = rows;
    this.#columns = columns;
  }

  getRow(): number {
    return this.#row;
  }

  getColumn(): number {
    return this.#column;
  }

  getNumRows(): number {
    return this.#rows;
  }

  getNumColumns(): number {
    return this.#columns;
  }

  getA1Notation(): string {
    const first = `${columnLetters(this.#column)}${this.#row}`;
    if (this.#rows === 1 && this.#columns === 1) return first;
    return `${first}:${columnLetters(this.#column + this.#columns - 1)}${this.#row + this.#rows - 1}`;
  }

  getValues(): unknown[][] {
    return this.#op('getValues', () => {
      const offset = this.#s.book.offset;
      const out: unknown[][] = [];
      for (let r = 0; r < this.#rows; r++) {
        const row: unknown[] = [];
        for (let c = 0; c < this.#columns; c++) {
          row.push(read(this.#s.peek(this.#row + r, this.#column + c), offset, this.#shared.host));
        }
        out.push(row);
      }
      return out;
    });
  }

  getValue(): unknown {
    return this.#op('getValue', () => read(this.#s.peek(this.#row, this.#column), this.#s.book.offset, this.#shared.host));
  }

  setValues(values: unknown): FakeRange {
    if (!Array.isArray(values) || !values.every((row) => Array.isArray(row))) {
      throw new Error('Exception: The parameters don\'t match the method signature for SpreadsheetApp.Range.setValues.');
    }
    if (values.length !== this.#rows) {
      throw new Error(
        `Exception: The number of rows in the data does not match the number of rows in the range. ` +
          `The data has ${values.length} but the range has ${this.#rows}.`,
      );
    }
    for (const row of values as unknown[][]) {
      if (row.length !== this.#columns) {
        throw new Error(
          `Exception: The number of columns in the data does not match the number of columns in the range. ` +
            `The data has ${row.length} but the range has ${this.#columns}.`,
        );
      }
    }
    const offset = this.#s.book.offset;
    this.#op('setValues', () =>
      (values as unknown[][]).forEach((row, r) =>
        row.forEach((value, c) => {
          const cell = this.#s.cell(this.#row + r, this.#column + c);
          cell.value = enter(value, cell.format, offset);
        }),
      ),
    );
    return this;
  }

  setValue(value: unknown): FakeRange {
    const offset = this.#s.book.offset;
    this.#op('setValue', () =>
      this.#each((cell) => {
        cell.value = enter(value, cell.format, offset);
      }),
    );
    return this;
  }

  setNumberFormat(format: unknown): FakeRange {
    if (typeof format !== 'string') throw new Error('Exception: The parameters don\'t match the method signature for SpreadsheetApp.Range.setNumberFormat.');
    this.#op(`setNumberFormat ${format}`, () =>
      this.#each((cell) => {
        cell.format = format;
      }),
    );
    return this;
  }

  setFontWeight(_weight: unknown): FakeRange {
    return this;
  }

  setVerticalAlignment(_alignment: unknown): FakeRange {
    return this;
  }

  setWrap(_wrap: unknown): FakeRange {
    return this;
  }

  clearContent(): FakeRange {
    this.#op('clearContent', () =>
      this.#each((cell) => {
        cell.value = EMPTY;
      }),
    );
    return this;
  }

  #each(fn: (cell: Cell) => void): void {
    for (let r = 0; r < this.#rows; r++) {
      for (let c = 0; c < this.#columns; c++) fn(this.#s.cell(this.#row + r, this.#column + c));
    }
  }

  #op<T>(what: string, fn: () => T): T {
    return op(this.#shared.host, `${this.#s.name}!${this.getA1Notation()} ${what}`, fn);
  }
}

// ------------------------------------------------------------------ the world, for tests

/** All the spreadsheets the script can open, and the SpreadsheetApp it opens them with. */
export class SheetsWorld {
  readonly #books = new Map<string, BookState>();
  readonly #spreadsheets = new Map<BookState, FakeSpreadsheet>();
  readonly #sheets = new Map<SheetState, FakeSheet>();
  readonly #shared: Shared;
  #bound: BookState | null = null;
  #seed = 20_261_031;

  /** The SpreadsheetApp global. */
  readonly app: Readonly<Record<string, unknown>>;

  constructor(host: SheetsHost) {
    this.#shared = {
      host,
      spreadsheet: (book) => {
        let s = this.#spreadsheets.get(book);
        if (!s) this.#spreadsheets.set(book, (s = new FakeSpreadsheet(book, this.#shared)));
        return s;
      },
      sheet: (state) => {
        let s = this.#sheets.get(state);
        if (!s) this.#sheets.set(state, (s = new FakeSheet(state, this.#shared)));
        return s;
      },
      // The first tab of a spreadsheet is gid 0; later ones get large random-looking ids.
      newGid: (book) => {
        if (book.sheets.length === 0) return 0;
        this.#seed = (this.#seed * 48_271) % 2_147_483_647;
        return this.#seed;
      },
    };

    const books = this.#books;
    const shared = this.#shared;
    const world = this;
    this.app = {
      openById(id: unknown): FakeSpreadsheet {
        const book = books.get(String(id));
        if (!book) {
          throw new Error('Exception: Unexpected error while getting the method or property openById on object SpreadsheetApp.');
        }
        return shared.spreadsheet(book);
      },
      // Null unless the script is bound to a spreadsheet: a standalone web app has none.
      getActiveSpreadsheet(): FakeSpreadsheet | null {
        const bound = world.#bound;
        return bound ? shared.spreadsheet(bound) : null;
      },
      getUi(): never {
        throw new Error('Exception: Cannot call SpreadsheetApp.getUi() from this context.');
      },
      flush(): void {},
    };
  }

  /** A new spreadsheet with no tabs yet. */
  create(id: string, options: { readonly name?: string; readonly timeZone?: string } = {}): Book {
    if (this.#books.has(id)) throw new HarnessError(`Spreadsheet ${id} already exists.`);
    const book = new BookState(id, options.name ?? id, options.timeZone ?? MANILA);
    this.#books.set(id, book);
    return new Book(book, this.#shared);
  }

  book(id: string): Book {
    const book = this.#books.get(id);
    if (!book) throw new HarnessError(`No spreadsheet ${id}.`);
    return new Book(book, this.#shared);
  }

  /** Makes the script a bound one: getActiveSpreadsheet() returns this spreadsheet. */
  bindTo(id: string | null): void {
    this.#bound = id === null ? null : (this.#books.get(id) ?? null);
  }
}

/** A spreadsheet, as a test sets it up and inspects it. */
export class Book {
  readonly #state: BookState;
  readonly #shared: Shared;

  constructor(state: BookState, shared: Shared) {
    this.#state = state;
    this.#shared = shared;
  }

  get id(): string {
    return this.#state.id;
  }

  /** A tab with a header row, frozen as Code.gs freezes its own. */
  addSheet(name: string, headers: readonly string[] = [], options: { readonly rows?: number; readonly columns?: number } = {}): Tab {
    if (this.#state.sheets.some((s) => s.name === name)) throw new HarnessError(`Tab ${name} already exists.`);
    const state = new SheetState(
      this.#state,
      name,
      this.#shared.newGid(this.#state),
      options.rows ?? DEFAULT_ROWS,
      options.columns ?? DEFAULT_COLUMNS,
    );
    this.#state.sheets.push(state);
    const tab = new Tab(state);
    if (headers.length) {
      tab.type(headers);
      state.frozenRows = 1;
    }
    return tab;
  }

  has(name: string): boolean {
    return this.#state.sheets.some((s) => s.name === name);
  }

  sheet(name: string): Tab {
    const state = this.#state.sheets.find((s) => s.name === name);
    if (!state) throw new HarnessError(`No tab ${name} in ${this.#state.id}.`);
    return new Tab(state);
  }

  tabs(): string[] {
    return this.#state.sheets.map((s) => s.name);
  }
}

/** One tab, as a test sets it up and inspects it. */
export class Tab {
  readonly #s: SheetState;

  constructor(state: SheetState) {
    this.#s = state;
  }

  get name(): string {
    return this.#s.name;
  }

  /** Hidden with Sheet.hideSheet(). */
  get hidden(): boolean {
    return this.#s.hidden;
  }

  get gid(): number {
    return this.#s.gid;
  }

  get maxRows(): number {
    return this.#s.maxRows;
  }

  /** Rows typed below the last one, as a person types them: Sheets reads each value as typing. */
  type(...rows: readonly (readonly string[])[]): this {
    for (const row of rows) {
      const r = this.#s.lastRow() + 1;
      if (r > this.#s.maxRows) this.#s.grid.push([]);
      row.forEach((value, i) => this.typeAt(r, i + 1, value));
    }
    return this;
  }

  /** One value typed into one cell (1-based). In a plain-text cell it stays text. */
  typeAt(row: number, column: number, value: string): this {
    const cell = this.#s.cell(row, column);
    cell.value = value === '' ? EMPTY : cell.format === PLAIN_TEXT ? { kind: 'text', text: value } : asTyped(value);
    return this;
  }

  /** Rows written below the last one as plain text, the way BuildDirectory.gs writes the directory. */
  writeText(...rows: readonly (readonly (string | number)[])[]): this {
    for (const row of rows) {
      const r = this.#s.lastRow() + 1;
      if (r > this.#s.maxRows) this.#s.grid.push([]);
      row.forEach((value, i) => {
        const cell = this.#s.cell(r, i + 1);
        cell.format = PLAIN_TEXT;
        cell.value = enter(value, PLAIN_TEXT, 0);
      });
    }
    return this;
  }

  /** What each cell holds, rows 1 to the last: text as itself, anything else tagged (see show). */
  show(): string[][] {
    const out: string[][] = [];
    const columns = this.#s.lastColumn();
    for (let r = 1; r <= this.#s.lastRow(); r++) {
      out.push(Array.from({ length: columns }, (_, c) => show(this.#s.peek(r, c + 1))));
    }
    return out;
  }

  /** One row as show() gives it, 1-based. */
  row(n: number): string[] {
    return Array.from({ length: this.#s.lastColumn() }, (_, c) => show(this.#s.peek(n, c + 1)));
  }

  /** The formats of one row, 1-based: '' automatic, '@' plain text. */
  formats(n: number): string[] {
    return Array.from({ length: this.#s.lastColumn() }, (_, c) => this.#s.formatAt(n, c + 1));
  }

  /** Rows with anything in them, the header included. */
  get lastRow(): number {
    return this.#s.lastRow();
  }
}
