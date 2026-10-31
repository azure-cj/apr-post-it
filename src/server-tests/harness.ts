/**
 * Runs the Apps Script project in Node, the way Apps Script runs it.
 *
 * The .gs files are read from server, concatenated in project
 * order and run in ONE node:vm context. That is the scope Apps Script gives a
 * project: every file shares one global scope, so Code.gs calls Separators.gs's
 * splitAtSeparator_ as a plain global, and a top-level name declared in two
 * files collides here exactly as it would there.
 *
 * Every service Code.gs touches is faked — SpreadsheetApp (fake-sheets.ts),
 * LockService, CacheService, Utilities, ContentService, DocumentApp, DriveApp,
 * UrlFetchApp (FakeWeb), ScriptApp's triggers (FakeTriggers),
 * PropertiesService, Session and Logger — and each keeps the real one's rules wherever Code.gs
 * could trip on them. A fake kinder than Google hides the bugs it is here to
 * find.
 *
 * Each request is an execution of its own, as in Apps Script: a lock it holds
 * is released when it ends, and a test may start a second execution in the
 * middle of the first (`interleave`) to race the two.
 *
 * The clock is the harness's: `new Date()` and `Date.now()` in the script read
 * it. Anything that would read the script's own time zone — new Date(y, m, d),
 * getHours(), new Date('3/9/2026') — is refused, because Node's zone is not
 * Apps Script's (it may even be Manila, and then a time zone bug would pass).
 * Utilities.formatDate and Date.UTC are the way.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { HarnessError, MANILA, MANILA_OFFSET_MS, SheetsWorld } from './fake-sheets';

export { HarnessError } from './fake-sheets';

/**
 * server/ at the repo root. POSTIT_APPS_SCRIPT_DIR points the tests at
 * another copy, such as the version deployed now, to see what it gets wrong.
 */
export const SERVER_DIR =
  process.env['POSTIT_APPS_SCRIPT_DIR'] ?? fileURLToPath(new URL('../../server/', import.meta.url));

/** The project's files in the order Apps Script loads them. */
export const PROJECT_FILES: readonly string[] = ['Separators.gs', 'Code.gs', 'BuildDirectory.gs'];

/** A reply from the web app, parsed. */
export type Reply = Record<string, unknown>;

// ------------------------------------------------------------------ the clock

/** Manila wall-clock time, "yyyy-MM-dd HH:mm[:ss]", as ms since 1970. */
export function manila(when: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(when);
  if (!m) throw new HarnessError(`Write a Manila time as "yyyy-MM-dd HH:mm", not "${when}".`);
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)) - MANILA_OFFSET_MS;
}

export class Clock {
  #now: number;

  constructor(start: number) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  /** Sets the time, as Manila's clock reads it: "2026-03-09 07:59". */
  set(when: string): void {
    this.#now = manila(when);
  }

  advance(ms: number): void {
    this.#now += ms;
  }

  /** The time as Manila's clock reads it, "yyyy-MM-dd HH:mm". */
  get manila(): string {
    return new Date(this.#now + MANILA_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
  }
}

// Date methods that read or set the time in the process's own zone.
const LOCAL_TIME = [
  'getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds',
  'getTimezoneOffset', 'getYear', 'setFullYear', 'setMonth', 'setDate', 'setHours', 'setMinutes', 'setSeconds',
  'setMilliseconds', 'setYear', 'toDateString', 'toTimeString', 'toLocaleString', 'toLocaleDateString',
  'toLocaleTimeString',
] as const;

type ScriptDateConstructor = new (ms: number) => object;

/**
 * Replaces the script's Date with one that reads the harness's clock and
 * refuses whatever would depend on the time zone of the machine running it.
 * Its instances are the script realm's own Dates, so `instanceof Date` in the
 * script holds for them and for the dates the fake sheets return.
 */
function installClock(context: vm.Context, now: () => number, refuse: (what: string) => never): ScriptDateConstructor {
  const RealDate = vm.runInContext('Date', context) as DateConstructor;
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/; // read as UTC everywhere
  const ZONED = /(?:Z|[+-]\d{2}:?\d{2})$/i;
  const readable = (text: string): boolean => DATE_ONLY.test(text) || ZONED.test(text);

  function ClockDate(...args: unknown[]): object {
    if (!new.target) refuse('Date() without new, which gives the time as text in the script\'s time zone');
    if (args.length === 0) return new RealDate(now());
    if (args.length > 1) refuse('new Date(year, month, ...), which counts in the script\'s time zone');
    const [value] = args;
    if (typeof value === 'string' && !readable(value)) {
      refuse(`new Date(${JSON.stringify(value)}), which reads the text in the script's time zone`);
    }
    return new RealDate(value as number);
  }
  ClockDate.prototype = RealDate.prototype;
  Object.assign(ClockDate, {
    now: (): number => now(),
    UTC: RealDate.UTC,
    parse: (text: unknown): number => {
      if (!readable(String(text))) refuse(`Date.parse(${JSON.stringify(text)}), which reads the text in the script's time zone`);
      return RealDate.parse(String(text));
    },
  });
  const proto = RealDate.prototype as unknown as Record<string, unknown>;
  for (const name of LOCAL_TIME) {
    proto[name] = function refused(): never {
      return refuse(`Date.prototype.${name}, which reads the script's time zone`);
    };
  }
  (context as Record<string, unknown>)['Date'] = ClockDate;
  return ClockDate as unknown as ScriptDateConstructor;
}

// ------------------------------------------------------------------ Utilities

const UTC_PLUS_8 = new Set([MANILA, 'GMT+8', 'GMT+08:00', 'Etc/GMT-8']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function kindOf(value: unknown): string {
  if (Object.prototype.toString.call(value) === '[object Date]') return 'Date';
  if (value === null) return 'null';
  return typeof value === 'string' ? 'String' : typeof value === 'number' ? 'number' : typeof value;
}

/**
 * Utilities.formatDate on a UTC+8 clock: Java SimpleDateFormat letters, those
 * Code.gs uses and their neighbours. Any other zone, or letter, is refused
 * rather than guessed.
 */
export function formatDate(date: unknown, timeZone: unknown, pattern: unknown): string {
  if (kindOf(date) !== 'Date' || typeof timeZone !== 'string' || typeof pattern !== 'string') {
    throw new Error(
      `Exception: The parameters (${[date, timeZone, pattern].map(kindOf).join(',')}) don't match the method ` +
        'signature for Utilities.formatDate.',
    );
  }
  const ms = (date as Date).getTime();
  if (Number.isNaN(ms)) throw new Error('Exception: Invalid argument: date');
  if (!UTC_PLUS_8.has(timeZone)) {
    throw new HarnessError(`Utilities.formatDate: the fake keeps Manila's clock (UTC+8) only, not "${timeZone}".`);
  }
  const d = new Date(ms + MANILA_OFFSET_MS); // its UTC fields are Manila's wall clock
  let out = '';
  for (let i = 0; i < pattern.length; ) {
    const ch = pattern.charAt(i);
    if (ch === "'") {
      const end = pattern.indexOf("'", i + 1);
      if (end === -1) throw new Error(`Exception: Invalid argument: ${pattern}`);
      out += end === i + 1 ? "'" : pattern.slice(i + 1, end);
      i = end + 1;
    } else if (/[A-Za-z]/.test(ch)) {
      let n = 1;
      while (pattern.charAt(i + n) === ch) n++;
      out += dateField(ch, n, d, pattern);
      i += n;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function dateField(letter: string, count: number, d: Date, pattern: string): string {
  const pad = (n: number, width = count): string => String(n).padStart(width, '0');
  const month = d.getUTCMonth();
  switch (letter) {
    case 'y':
      return count === 2 ? pad(d.getUTCFullYear() % 100, 2) : pad(d.getUTCFullYear());
    case 'M':
      return count >= 4 ? MONTHS[month]! : count === 3 ? MONTHS[month]!.slice(0, 3) : pad(month + 1);
    case 'd':
      return pad(d.getUTCDate());
    case 'E':
      return count >= 4 ? WEEKDAYS[d.getUTCDay()]! : WEEKDAYS[d.getUTCDay()]!.slice(0, 3);
    case 'H':
      return pad(d.getUTCHours());
    case 'h':
      return pad(d.getUTCHours() % 12 || 12);
    case 'm':
      return pad(d.getUTCMinutes());
    case 's':
      return pad(d.getUTCSeconds());
    case 'S':
      return pad(d.getUTCMilliseconds(), 3).slice(0, Math.max(count, 3));
    case 'a':
      return d.getUTCHours() < 12 ? 'AM' : 'PM';
    case 'X':
      return count === 1 ? '+08' : count === 2 ? '+0800' : '+08:00';
    case 'Z':
      return '+0800';
    default:
      throw new HarnessError(`Utilities.formatDate: the fake does not know the letter "${letter}" in "${pattern}".`);
  }
}

// ------------------------------------------------------------------ executions and locks

class Executions {
  readonly #stack: number[] = [];
  #next = 1;

  get current(): number {
    const top = this.#stack.at(-1);
    if (top === undefined) {
      throw new HarnessError('Apps Script code ran outside an execution: call it through post, get, run or evaluate.');
    }
    return top;
  }

  /** 1 inside a request, 2 inside a request started in the middle of another. */
  get depth(): number {
    return this.#stack.length;
  }

  run<T>(fn: () => T, ended: (id: number) => void): T {
    const id = this.#next++;
    this.#stack.push(id);
    try {
      return fn();
    } finally {
      this.#stack.pop();
      ended(id);
    }
  }
}

/** The script lock: one holder at a time, across every execution. */
class LockState {
  holder: number | null = null;
}

class FakeLock {
  readonly #state: LockState;
  readonly #executions: Executions;

  constructor(state: LockState, executions: Executions) {
    this.#state = state;
    this.#executions = executions;
  }

  tryLock(timeoutInMillis: unknown): boolean {
    if (typeof timeoutInMillis !== 'number') {
      throw new Error("Exception: The parameters don't match the method signature for LockService.Lock.tryLock.");
    }
    const me = this.#executions.current;
    if (this.#state.holder === null || this.#state.holder === me) {
      this.#state.holder = me;
      return true;
    }
    // Held by another execution. Here the two share one thread, so the holder
    // cannot finish while this one waits: waiting out the timeout ends the same way.
    return false;
  }

  waitLock(timeoutInMillis: unknown): void {
    if (!this.tryLock(timeoutInMillis)) {
      throw new Error('Exception: Lock timeout: another process was holding the lock for too long.');
    }
  }

  releaseLock(): void {
    if (this.#state.holder === this.#executions.current) this.#state.holder = null;
  }

  hasLock(): boolean {
    return this.#state.holder === this.#executions.current;
  }
}

// ------------------------------------------------------------------ CacheService

const CACHE_VALUE_LIMIT = 100 * 1024;
const CACHE_KEY_LIMIT = 250;
const CACHE_MAX_SECONDS = 21_600;

class FakeCache {
  readonly #entries = new Map<string, { readonly value: string; readonly expires: number }>();
  readonly #now: () => number;

  constructor(now: () => number) {
    this.#now = now;
  }

  get(key: unknown): string | null {
    const k = cacheKey(key);
    const entry = this.#entries.get(k);
    if (!entry) return null;
    if (entry.expires <= this.#now()) {
      this.#entries.delete(k);
      return null;
    }
    return entry.value;
  }

  put(key: unknown, value: unknown, expirationInSeconds: unknown = 600): void {
    const k = cacheKey(key);
    if (typeof value !== 'string') throw new Error("Exception: The parameters don't match the method signature for CacheService.Cache.put.");
    if (Buffer.byteLength(value, 'utf8') > CACHE_VALUE_LIMIT) throw new Error('Exception: Argument too large: value');
    const seconds = Math.min(Number(expirationInSeconds), CACHE_MAX_SECONDS);
    if (!(seconds > 0)) throw new Error('Exception: Invalid argument: expirationInSeconds');
    this.#entries.set(k, { value, expires: this.#now() + seconds * 1000 });
  }

  remove(key: unknown): void {
    this.#entries.delete(cacheKey(key));
  }

  /** For tests: forget everything, as if the cache had been evicted. */
  clear(): void {
    this.#entries.clear();
  }
}

function cacheKey(key: unknown): string {
  if (typeof key !== 'string' || key === '') throw new Error('Exception: Invalid argument: key');
  if (key.length > CACHE_KEY_LIMIT) throw new Error('Exception: Argument too large: key');
  return key;
}

// ------------------------------------------------------------------ PropertiesService

const SIGNATURE = (method: string): Error =>
  new Error(`Exception: The parameters don't match the method signature for ${method}.`);

/** The script's properties: text keys to text values, kept across executions. */
export class FakeProperties {
  readonly values = new Map<string, string>();

  readonly service = Object.freeze({
    getScriptProperties: () => this.#store,
  });

  readonly #store = Object.freeze({
    getProperty: (key: unknown): string | null => {
      if (typeof key !== 'string') throw SIGNATURE('PropertiesService.Properties.getProperty');
      return this.values.get(key) ?? null;
    },
    // A value must be text: setProperty('cursor', 3) is refused here, as a
    // number would come back from getProperty as the text "3.0" in Apps Script.
    setProperty: (key: unknown, value: unknown): object => {
      if (typeof key !== 'string' || typeof value !== 'string') throw SIGNATURE('PropertiesService.Properties.setProperty');
      this.values.set(key, value);
      return this.#store;
    },
    setProperties: (properties: unknown, deleteAllOthers: unknown = false): object => {
      if (typeof properties !== 'object' || properties === null) throw SIGNATURE('PropertiesService.Properties.setProperties');
      const entries = Object.entries(properties as Record<string, unknown>);
      if (entries.some(([, v]) => typeof v !== 'string')) throw SIGNATURE('PropertiesService.Properties.setProperties');
      if (deleteAllOthers === true) this.values.clear();
      for (const [k, v] of entries) this.values.set(k, v as string);
      return this.#store;
    },
    deleteProperty: (key: unknown): object => {
      if (typeof key !== 'string') throw SIGNATURE('PropertiesService.Properties.deleteProperty');
      this.values.delete(key);
      return this.#store;
    },
    deleteAllProperties: (): object => {
      this.values.clear();
      return this.#store;
    },
    getProperties: (): Record<string, string> => Object.fromEntries(this.values),
    getKeys: (): string[] => [...this.values.keys()],
  });
}

// ------------------------------------------------------------------ ScriptApp's triggers

/** A trigger as a test sees it. */
export interface TriggerInfo {
  readonly id: string;
  readonly handler: string;
  /** When it fires (ms since 1970). */
  readonly at: number;
}

/** Apps Script's limit on triggers per user per script. */
const TRIGGER_LIMIT = 20;

/**
 * One-off time triggers, as BuildDirectory.gs and Code.gs make them:
 * newTrigger(name).timeBased().after(ms).create(). A trigger can only call a
 * top-level function whose name has no trailing underscore, as in Apps Script,
 * where such a function is private. Recurring schedules are not faked.
 */
export class FakeTriggers {
  readonly #list: TriggerInfo[] = [];
  readonly #now: () => number;
  readonly #callable: (name: string) => boolean;
  #next = 1;

  constructor(now: () => number, callable: (name: string) => boolean) {
    this.#now = now;
    this.#callable = callable;
  }

  /** Every trigger waiting, oldest first. */
  list(): TriggerInfo[] {
    return [...this.#list];
  }

  /** Removes the trigger, as it fires. */
  take(id: string): void {
    const i = this.#list.findIndex((t) => t.id === id);
    if (i !== -1) this.#list.splice(i, 1);
  }

  #view(t: TriggerInfo): object {
    return Object.freeze({
      getUniqueId: () => t.id,
      getHandlerFunction: () => t.handler,
      getEventType: () => 'CLOCK',
      getTriggerSource: () => 'CLOCK',
    });
  }

  #create(handler: string, at: number): object {
    if (!this.#callable(handler)) {
      throw new HarnessError(
        `A trigger for ${handler} would never run: it must name a top-level function with no trailing underscore.`,
      );
    }
    if (this.#list.length >= TRIGGER_LIMIT) {
      throw new Error('Exception: This script has too many triggers. Triggers must be deleted from the script before more can be added.');
    }
    const t: TriggerInfo = { id: `trigger-${this.#next++}`, handler, at };
    this.#list.push(t);
    return this.#view(t);
  }

  readonly scriptApp = Object.freeze({
    newTrigger: (functionName: unknown): object => {
      if (typeof functionName !== 'string') throw SIGNATURE('ScriptApp.newTrigger');
      return Object.freeze({
        timeBased: () => {
          let at: number | null = null;
          const builder = {
            after: (ms: unknown) => {
              if (typeof ms !== 'number' || !(ms >= 0)) throw SIGNATURE('ScriptApp.ClockTriggerBuilder.after');
              at = this.#now() + ms;
              return builder;
            },
            at: (date: unknown) => {
              if (Object.prototype.toString.call(date) !== '[object Date]') throw SIGNATURE('ScriptApp.ClockTriggerBuilder.at');
              at = (date as Date).getTime();
              return builder;
            },
            create: () => {
              if (at === null) throw new HarnessError('The fake makes one-off triggers only: call after() or at() before create().');
              return this.#create(functionName, at);
            },
          };
          return builder;
        },
      });
    },
    getProjectTriggers: (): object[] => this.#list.map((t) => this.#view(t)),
    deleteTrigger: (trigger: unknown): void => {
      const id = (trigger as { getUniqueId?: () => string } | null)?.getUniqueId?.();
      if (typeof id !== 'string') throw SIGNATURE('ScriptApp.deleteTrigger');
      this.take(id);
    },
  });
}

// ------------------------------------------------------------------ ContentService

const MIME_TYPES = Object.freeze({
  JSON: Object.freeze({ name: 'JSON', type: 'application/json' }),
  TEXT: Object.freeze({ name: 'TEXT', type: 'text/plain' }),
  CSV: Object.freeze({ name: 'CSV', type: 'text/csv' }),
});
const KNOWN_MIME_TYPES: ReadonlySet<unknown> = new Set(Object.values(MIME_TYPES));

export class TextOutput {
  #content: string;
  #mimeType: unknown = MIME_TYPES.TEXT;

  constructor(content: string) {
    this.#content = content;
  }

  getContent(): string {
    return this.#content;
  }

  setContent(content: unknown): TextOutput {
    this.#content = String(content);
    return this;
  }

  append(content: unknown): TextOutput {
    this.#content += String(content);
    return this;
  }

  getMimeType(): unknown {
    return this.#mimeType;
  }

  setMimeType(mimeType: unknown): TextOutput {
    // An enum value, not a string: setMimeType('application/json') fails in Apps Script.
    if (!KNOWN_MIME_TYPES.has(mimeType)) {
      throw new Error("Exception: The parameters don't match the method signature for ContentService.TextOutput.setMimeType.");
    }
    this.#mimeType = mimeType;
    return this;
  }
}

// ------------------------------------------------------------------ Drive and Docs

/** One element of a document's body: a paragraph's text, a list item, or a table. */
export type DocElement =
  | string
  | { readonly bullet: string; readonly level?: number }
  | { readonly numbered: string; readonly level?: number; readonly list?: string }
  | { readonly table: readonly (readonly string[])[] };

const ELEMENT_TYPE = Object.freeze({
  PARAGRAPH: 'PARAGRAPH',
  LIST_ITEM: 'LIST_ITEM',
  TABLE: 'TABLE',
  TABLE_ROW: 'TABLE_ROW',
  TABLE_CELL: 'TABLE_CELL',
  HORIZONTAL_RULE: 'HORIZONTAL_RULE',
  PAGE_BREAK: 'PAGE_BREAK',
});
const GLYPH_TYPE = Object.freeze({ BULLET: 'BULLET', HOLLOW_BULLET: 'HOLLOW_BULLET', NUMBER: 'NUMBER' });

function docElement(spec: DocElement): object {
  if (typeof spec === 'string') {
    return { getType: () => ELEMENT_TYPE.PARAGRAPH, getText: () => spec };
  }
  if ('table' in spec) {
    const rows = spec.table;
    return {
      getType: () => ELEMENT_TYPE.TABLE,
      getNumRows: () => rows.length,
      getRow: (r: number) => ({
        getNumCells: () => rows[r]?.length ?? 0,
        getCell: (c: number) => ({ getText: () => rows[r]?.[c] ?? '' }),
      }),
      getText: () => rows.map((row) => row.join('\n')).join('\n'),
    };
  }
  const numbered = 'numbered' in spec;
  const text = numbered ? spec.numbered : spec.bullet;
  return {
    getType: () => ELEMENT_TYPE.LIST_ITEM,
    getText: () => text,
    getNestingLevel: () => spec.level ?? 0,
    getGlyphType: () => (numbered ? GLYPH_TYPE.NUMBER : GLYPH_TYPE.BULLET),
    getListId: () => (numbered && spec.list) || 'list',
  };
}

const NO_DOCUMENT = "Exception: Document is missing (perhaps it was deleted, or you don't have read access?)";
const NO_FILE =
  'Exception: No item with the given ID could be found. Possibly because you have not edited this item ' +
  'or you do not have permission to access it.';

/** The Drive files the script can read: Google Docs by DocumentApp, anything by DriveApp. */
export class FakeDrive {
  readonly #docs = new Map<string, readonly DocElement[]>();
  readonly #files = new Map<string, { readonly name: string; readonly mimeType: string; readonly text: string }>();

  /** A Google Doc whose body is these elements: a string is a paragraph. */
  addDoc(id: string, ...body: readonly DocElement[]): this {
    this.#docs.set(id, body);
    this.#files.set(id, { name: id, mimeType: 'application/vnd.google-apps.document', text: '' });
    return this;
  }

  /** A Google Doc with one paragraph per line of `text`. */
  addDocText(id: string, text: string): this {
    return this.addDoc(id, ...text.split('\n'));
  }

  /** A file that is not a Google Doc: a .docx, a .txt. DocumentApp cannot open it. */
  addFile(id: string, file: { readonly name: string; readonly mimeType: string; readonly text?: string }): this {
    this.#docs.delete(id);
    this.#files.set(id, { name: file.name, mimeType: file.mimeType, text: file.text ?? '' });
    return this;
  }

  remove(id: string): this {
    this.#docs.delete(id);
    this.#files.delete(id);
    return this;
  }

  readonly documentApp = Object.freeze({
    ElementType: ELEMENT_TYPE,
    GlyphType: GLYPH_TYPE,
    openById: (id: unknown): object => {
      const body = this.#docs.get(String(id));
      if (!body) throw new Error(NO_DOCUMENT);
      const children = body.map(docElement);
      return {
        getId: () => String(id),
        getName: () => String(id),
        getBody: () => ({
          getNumChildren: () => children.length,
          getChild: (i: number) => {
            const child = children[i];
            if (!child) throw new Error('Exception: Child index out of bounds.');
            return child;
          },
          getText: () => body.map((e) => (typeof e === 'string' ? e : '')).join('\n'),
        }),
      };
    },
  });

  readonly driveApp = Object.freeze({
    getFileById: (id: unknown): object => {
      const file = this.#files.get(String(id));
      if (!file) throw new Error(NO_FILE);
      return {
        getId: () => String(id),
        getName: () => file.name,
        getMimeType: () => file.mimeType,
        getBlob: () => ({ getDataAsString: () => file.text }),
      };
    },
  });
}

// ------------------------------------------------------------------ UrlFetchApp

interface WebAnswer {
  readonly code: number;
  readonly body: string;
}

/**
 * The web as UrlFetchApp sees it: a URL answers with what a test registered,
 * or fails to connect, which throws whatever muteHttpExceptions says (it only
 * mutes an HTTP status, never a failed connection). Every fetch is recorded.
 */
export class FakeWeb {
  readonly #answers = new Map<string, WebAnswer | { readonly fail: string }>();
  /** Every URL fetched, oldest first. */
  readonly fetched: string[] = [];

  /** `url` answers `code` with `body`. */
  respond(url: string, body: string, code = 200): this {
    this.#answers.set(url, { code, body });
    return this;
  }

  /** Fetching `url` throws, as an unreachable host does. */
  fail(url: string, message = 'Exception: Address unavailable: ' + url): this {
    this.#answers.set(url, { fail: message });
    return this;
  }

  readonly urlFetchApp = Object.freeze({
    fetch: (url: unknown, params: unknown = {}): object => {
      if (typeof url !== 'string') throw new Error("Exception: The parameters don't match the method signature for UrlFetchApp.fetch.");
      if (!/^https?:\/\//i.test(url)) throw new Error(`Exception: Invalid argument: ${url}`);
      this.fetched.push(url);
      const answer = this.#answers.get(url) ?? { fail: `Exception: Address unavailable: ${url}` };
      if ('fail' in answer) throw new Error(answer.fail);
      const mute = !!(params && typeof params === 'object' && (params as Record<string, unknown>)['muteHttpExceptions']);
      if (answer.code >= 400 && !mute) {
        throw new Error(`Exception: Request failed for ${url} returned code ${answer.code}. Truncated server response: ${answer.body.slice(0, 50)}`);
      }
      return {
        getResponseCode: () => answer.code,
        getContentText: (_charset?: unknown) => answer.body,
        getHeaders: () => ({ 'Content-Type': 'text/csv' }),
      };
    },
  });
}

/**
 * Utilities.parseCsv: RFC 4180, as Apps Script reads it. Quoted fields may
 * hold the delimiter, a doubled quote and line breaks; \r\n and \n both end a
 * row; a final line break does not make an empty last row.
 */
export function parseCsv(csv: unknown, delimiter: unknown = ','): string[][] {
  if (typeof csv !== 'string') throw new Error("Exception: The parameters don't match the method signature for Utilities.parseCsv.");
  const sep = typeof delimiter === 'string' && delimiter.length === 1 ? delimiter : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endRow = (): void => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };
  while (i < csv.length) {
    const ch = csv.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (csv.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += ch;
      }
      i++;
    } else if (ch === '"' && field === '') {
      quoted = true;
      i++;
    } else if (ch === sep) {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r' && csv.charAt(i + 1) === '\n') {
      endRow();
      i += 2;
    } else if (ch === '\n' || ch === '\r') {
      endRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (quoted) throw new Error('Exception: Could not parse text.');
  if (field !== '' || row.length) endRow();
  return rows;
}

// ------------------------------------------------------------------ the project

export interface ProjectOptions {
  /** The .gs files, in load order. Default: the whole project. */
  readonly files?: readonly string[];
  /** Changes a file before it is loaded: how a test tries a broken variant of the code. */
  readonly patch?: (file: string, source: string) => string;
  /** The time to start at, on Manila's clock. Default "2026-03-09 10:00". */
  readonly now?: string;
}

/** Called at every Sheets read and write with what it was and how deep in nested executions. */
export type Interleave = (what: string, depth: number) => void;

export interface Project {
  readonly sheets: SheetsWorld;
  readonly drive: FakeDrive;
  /** What UrlFetchApp reaches. */
  readonly web: FakeWeb;
  readonly clock: Clock;
  readonly cache: { clear(): void };
  /** The script properties, as PropertiesService keeps them. */
  readonly properties: Map<string, string>;
  /** The triggers waiting to fire. */
  readonly triggers: { list(): TriggerInfo[] };
  /**
   * Runs every trigger due by now, each as an execution of its own, and
   * removes it, as a one-off trigger is once it has fired. Returns the
   * handlers run, in order. One that throws is logged, as Apps Script would.
   */
  fireTriggers(): string[];
  /** Everything Logger.log and console wrote, oldest first. */
  readonly logs: string[];
  /** Sets fields of CONFIG. */
  configure(values: Readonly<Record<string, unknown>>): void;
  /** One web request posted as JSON, as the app sends it. Resolves with the reply's text. */
  postText(body: unknown): string;
  /** The same, parsed. */
  post(body: unknown): Reply;
  /** One GET request with these query parameters, parsed. */
  get(params: Readonly<Record<string, string>>): Reply;
  /** Runs a top-level function as an execution of its own, as the editor's Run button does. */
  run(name: string, ...args: unknown[]): unknown;
  /** Evaluates an expression in the script's global scope, as an execution of its own, and returns it through JSON. */
  evaluate(expression: string): unknown;
  /** Called at every Sheets read and write; null to stop. */
  interleave(fn: Interleave | null): void;
}

interface LoadedFile {
  readonly file: string;
  readonly text: string;
  readonly firstLine: number;
}

const DECLARATION = /^(?:async\s+)?(?:function\*?\s*([A-Za-z_$][\w$]*)|(?:var|let|const|class)\s+([A-Za-z_$][\w$]*))/gm;

/** The names a file declares at its top level (declarations that start a line). */
export function topLevelNames(source: string): string[] {
  return Array.from(source.matchAll(DECLARATION), (m) => (m[1] ?? m[2])!);
}

/** Names declared at the top level of more than one file: one global scope makes them collide. */
export function collisions(files: readonly { readonly file: string; readonly text: string }[]): string[] {
  const owner = new Map<string, string>();
  const out: string[] = [];
  for (const { file, text } of files) {
    for (const name of new Set(topLevelNames(text))) {
      const first = owner.get(name);
      if (first !== undefined) out.push(`${name} (${first} and ${file})`);
      else owner.set(name, file);
    }
  }
  return out;
}

export function readServerFile(file: string): string {
  return readFileSync(join(SERVER_DIR, file), 'utf8');
}

function concatenate(options: ProjectOptions): { readonly source: string; readonly files: readonly LoadedFile[] } {
  const files: LoadedFile[] = [];
  let source = '';
  let line = 1;
  for (const file of options.files ?? PROJECT_FILES) {
    let text = readServerFile(file);
    if (options.patch) text = options.patch(file, text);
    if (!text.endsWith('\n')) text += '\n';
    files.push({ file, text, firstLine: line });
    source += text;
    line += text.split('\n').length - 1;
  }
  return { source, files };
}

const SCRIPT_NAME = 'apps-script-project.gs';

/** "Code.gs:412" for a line of the concatenated source. */
function whereIs(line: number, files: readonly LoadedFile[]): string {
  const file = [...files].reverse().find((f) => f.firstLine <= line);
  return file ? `${file.file}:${line - file.firstLine + 1}` : `line ${line}`;
}

function explainLoadError(err: unknown, files: readonly LoadedFile[]): string {
  const text = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  const at = new RegExp(`${SCRIPT_NAME.replace(/\./g, '\\.')}:(\\d+)`).exec(text);
  const message = err instanceof Error ? err.message : String(err);
  return at ? `${message} (${whereIs(Number(at[1]), files)})` : message;
}

/** The project, loaded into one fresh global scope with every service faked. */
export function loadProject(options: ProjectOptions = {}): Project {
  const clock = new Clock(manila(options.now ?? '2026-03-09 10:00'));
  const logs: string[] = [];
  const refusals: string[] = [];
  const executions = new Executions();
  const lockState = new LockState();
  let interleave: Interleave | null = null;
  let interleaving = false;

  const sandbox: Record<string, unknown> = {};
  const context = vm.createContext(sandbox, { name: 'Apps Script' });
  const ScriptDate = installClock(context, () => clock.now(), (what) => {
    refusals.push(what);
    throw new HarnessError(`The script used ${what}. Use Utilities.formatDate or Date.UTC.`);
  });

  const sheets = new SheetsWorld({
    scriptDate: (ms) => new ScriptDate(ms),
    touch: (what) => {
      if (!interleave || interleaving) return;
      interleaving = true;
      try {
        interleave(what, executions.depth);
      } finally {
        interleaving = false;
      }
    },
  });
  const drive = new FakeDrive();
  const web = new FakeWeb();
  const cache = new FakeCache(() => clock.now());
  const properties = new FakeProperties();
  const triggers = new FakeTriggers(
    () => clock.now(),
    (name) => !name.endsWith('_') && typeof sandbox[name] === 'function',
  );

  const format = (args: readonly unknown[]): string => {
    const [first, ...rest] = args;
    if (typeof first !== 'string') return args.map(String).join(' ');
    let i = 0;
    return first.replace(/%s/g, () => String(rest[i++]));
  };
  const Logger = {
    log(...args: unknown[]): unknown {
      logs.push(format(args));
      return Logger;
    },
  };

  Object.assign(sandbox, {
    SpreadsheetApp: sheets.app,
    DocumentApp: drive.documentApp,
    DriveApp: drive.driveApp,
    UrlFetchApp: web.urlFetchApp,
    LockService: Object.freeze({ getScriptLock: () => new FakeLock(lockState, executions) }),
    CacheService: Object.freeze({ getScriptCache: () => cache }),
    PropertiesService: properties.service,
    ScriptApp: triggers.scriptApp,
    ContentService: Object.freeze({
      MimeType: MIME_TYPES,
      createTextOutput: (content?: unknown) => new TextOutput(content === undefined ? '' : String(content)),
    }),
    Utilities: Object.freeze({
      formatDate,
      getUuid: () => randomUUID(),
      parseCsv,
    }),
    Session: Object.freeze({
      // A web app that executes as its owner, opened by anyone: nobody is signed in.
      getActiveUser: () => ({ getEmail: () => '' }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@apg.example' }),
      getScriptTimeZone: () => MANILA,
    }),
    Logger,
    console: Object.freeze({
      log: (...args: unknown[]) => void logs.push(format(args)),
      info: (...args: unknown[]) => void logs.push(format(args)),
      warn: (...args: unknown[]) => void logs.push(format(args)),
      error: (...args: unknown[]) => void logs.push(format(args)),
    }),
  });

  const { source, files } = concatenate(options);
  const clashes = collisions(files);
  if (clashes.length) {
    throw new HarnessError(
      `Apps Script gives a project's files one global scope, and these are declared in two of them: ${clashes.join(', ')}.`,
    );
  }
  try {
    new vm.Script(source, { filename: SCRIPT_NAME }).runInContext(context);
  } catch (err) {
    throw new HarnessError(`Apps Script would not load the project: ${explainLoadError(err, files)}`);
  }

  /** One execution: what Apps Script runs for one request or one press of Run. */
  function execute<T>(fn: () => T): T {
    const before = refusals.length;
    const result = executions.run(fn, (id) => {
      // Apps Script releases a lock when the execution that holds it ends.
      if (lockState.holder === id) lockState.holder = null;
    });
    // Refused even when the script caught it: a try/catch must not hide one.
    if (refusals.length > before) {
      throw new HarnessError(`The script read the machine's time zone: ${refusals.slice(before).join('; ')}.`);
    }
    return result;
  }

  function global(name: string): (...args: unknown[]) => unknown {
    const fn = sandbox[name];
    if (typeof fn !== 'function') throw new HarnessError(`The project has no top-level function ${name}.`);
    return fn as (...args: unknown[]) => unknown;
  }

  function replyText(output: unknown): string {
    if (!(output instanceof TextOutput)) throw new HarnessError('The web app did not answer with ContentService output.');
    if (output.getMimeType() !== MIME_TYPES.JSON) throw new HarnessError('The web app did not answer with JSON.');
    return output.getContent();
  }

  function postText(body: unknown): string {
    const contents = JSON.stringify(body);
    const event = {
      postData: { contents, length: contents.length, type: 'application/json', name: 'postData' },
      parameter: {},
      parameters: {},
      queryString: '',
      contentLength: contents.length,
      contextPath: '',
    };
    return execute(() => replyText(global('doPost')(event)));
  }

  return {
    sheets,
    drive,
    web,
    clock,
    cache,
    logs,
    properties: properties.values,
    triggers,

    fireTriggers() {
      const ran: string[] = [];
      for (;;) {
        const due = triggers.list().filter((t) => t.at <= clock.now())[0];
        if (!due) return ran;
        triggers.take(due.id);
        ran.push(due.handler);
        try {
          execute(() => global(due.handler)());
        } catch (err) {
          if (err instanceof HarnessError) throw err;
          logs.push(`Trigger ${due.handler} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },

    configure(values) {
      Object.assign(vm.runInContext('CONFIG', context) as object, values);
    },

    postText,

    post(body) {
      return JSON.parse(postText(body)) as Reply;
    },

    get(params) {
      const event = {
        parameter: { ...params },
        parameters: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, [v]])),
        queryString: new URLSearchParams(params).toString(),
        contentLength: -1,
        contextPath: '',
      };
      return JSON.parse(execute(() => replyText(global('doGet')(event)))) as Reply;
    },

    run(name, ...args) {
      return execute(() => global(name)(...args));
    },

    evaluate(expression) {
      const json = execute(() => vm.runInContext(`JSON.stringify(${expression})`, context) as string | undefined);
      return json === undefined ? undefined : JSON.parse(json);
    },

    interleave(fn) {
      interleave = fn;
    },
  };
}
