/**
 * Pins server/Separators.gs: the one place that decides where a
 * listing's postable text ends (D5, D13). The file under test is the file Apps
 * Script runs, linked in at build time, and both run it in V8, so what these
 * tests say of it is true on the server too.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markerKind_, splitAtSeparator_ } from '@server/Separators.gs';

const SOURCE = new URL('../../server/Separators.gs', import.meta.url);

// Not itself a marker, so a test that cuts above it cut at the line meant to.
const PRIVATE = 'Mr. Reyes, 0917 123 4567';

// DECISIONS.md D5: the separators found across the 1,474 listings in the library.
const D5_SHAPES = [
  { shape: '---', documents: 1079, kind: '--- line' },
  { shape: '__', documents: 124, kind: '__ line' },
  { shape: '===', documents: 93, kind: 'equals line' },
  { shape: '━━━', documents: 45, kind: 'bar line' },
  { shape: '1 MONTH STANDARD COMMISSION', documents: 54, kind: 'heading: 1 MONTH STANDARD COMMISSION' },
] as const;
const UNSEPARATED = 79; // D6

// The marker lines the C# prototype's tests used. The rules are now the union of
// those and the real library's, so every one of them must still cut.
const PROTOTYPE_MARKERS = [
  '=== INTERNAL — DO NOT POST ===',
  '--- Internal notes ---',
  '## For agents only',
  '[Do not post]',
  "Agent's notes:",
  'Agents notes',
  '*** NOT FOR POSTING ***',
  'Internal only',
  '(internal)',
  '> For internal use',
  'INTERNAL NOTE',
  '~~ do not post ~~',
  '=== INTERNAL ===',
  'Agent’s notes:',
  'FOR INTERNAL USE ONLY',
  'INTERNAL—DO NOT POST',
];

describe('the file itself', () => {
  // It is pasted into the Apps Script editor. A literal non-ASCII character in a
  // regex there is one encoding slip from silently matching something else, so
  // anything beyond printable ASCII must be written as an escape.
  it('is printable ASCII throughout', () => {
    const offenders = readFileSync(SOURCE, 'utf8')
      .split('\n')
      .flatMap((line, i) =>
        [...line]
          .filter((c) => !/[\t\r\x20-\x7E]/.test(c))
          .map((c) => `line ${i + 1}: U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`),
      );

    expect(offenders).toEqual([]);
  });
});

describe('the separators in the real library (D5)', () => {
  it('accounts for every document: the five shapes and the unseparated', () => {
    expect(D5_SHAPES.reduce((sum, s) => sum + s.documents, 0) + UNSEPARATED).toBe(1474);
  });

  it.each(D5_SHAPES)('cuts at $shape, the separator in $documents of them', ({ shape, kind }) => {
    const cut = splitAtSeparator_(`FOR SALE: 320 sqm lot\nPrice: ₱4.2M\n${shape}\n${PRIVATE}`);

    expect(markerKind_(shape)).toBe(kind);
    expect(cut.posting).toBe('FOR SALE: 320 sqm lot\nPrice: ₱4.2M');
    expect(cut.found).toBe(true);
    expect(cut.cutAt).toBe(kind);
  });

  it.each([
    ['-----', '--- line'],
    ['  ---  ', '--- line'],
    ['–––', '--- line'],
    ['———', '--- line'],
    ['___', '__ line'],
    ['~~~~', 'equals line'],
    ['────────', 'bar line'],
    ['═══', 'bar line'],
    ['━━━━━━━━', 'bar line'],
  ])('recognises the divider %j however long, indented or drawn', (line, kind) => {
    expect(markerKind_(line)).toBe(kind);
  });

  it('cuts at whichever marker comes first, of any kind', () => {
    expect(splitAtSeparator_('A\n---\nB\n=== INTERNAL ===\nC')).toEqual({
      posting: 'A',
      internal: 'B\n=== INTERNAL ===\nC',
      found: true,
      cutAt: '--- line',
    });
    expect(splitAtSeparator_('A\nOwner Name: Cruz\nB\n---\nC').cutAt).toBe('heading: Owner Name: Cruz');
  });

  it('cuts at underscores run into the text when no line is a marker', () => {
    expect(splitAtSeparator_('FOR SALE: lot, ₱1M____Mr. Reyes 0917')).toEqual({
      posting: 'FOR SALE: lot, ₱1M',
      internal: 'Mr. Reyes 0917',
      found: true,
      cutAt: 'inline __',
    });
  });
});

describe('the C# prototype\'s markers', () => {
  it.each(PROTOTYPE_MARKERS)('cuts at %j and drops it as a bare label', (marker) => {
    expect(splitAtSeparator_(`FOR SALE\n${marker}\n${PRIVATE}`)).toEqual({
      posting: 'FOR SALE',
      internal: PRIVATE,
      found: true,
      cutAt: `heading: ${marker}`,
    });
  });
});

describe('broker terms anywhere in a line', () => {
  it.each([
    ['Sale: 3-5% Commission', 'mentions commission'],
    ['Lot 9, net price 3.9M', 'mentions commission'],
    ['The net to owner is 3.9M', 'mentions commission'],
    ["Call the owner's mobile 0917 123 4567", 'mentions the owner'],
    ['Viber the owners number', 'mentions the owner'],
  ])('cuts at %j', (line, kind) => {
    expect(markerKind_(line)).toBe(kind);
  });

  it.each(['NET TO OWNER', "OWNER'S DETAILS", 'OWNERS INFO', '1 MONTH STANDARD COMMISSION'])(
    'cuts at the all-caps heading %j',
    (line) => {
      expect(markerKind_(line)).toBe(`heading: ${line}`);
    },
  );
});

describe('what goes into internal', () => {
  it('drops a divider line', () => {
    expect(splitAtSeparator_(`FOR SALE\n---\n${PRIVATE}`).internal).toBe(PRIVATE);
  });

  it.each([
    '1 MONTH STANDARD COMMISSION',
    'Owner Name: Cruz',
    'Net to owner ₱3.9M',
    'Do not post: the owner is Mr. Reyes',
  ])('keeps the heading %j, which says something a manager needs', (heading) => {
    expect(splitAtSeparator_(`FOR SALE\n${heading}\n0917 123 4567`)).toEqual({
      posting: 'FOR SALE',
      internal: `${heading}\n0917 123 4567`,
      found: true,
      cutAt: `heading: ${heading}`,
    });
  });
});

describe('line breaks', () => {
  it.each([
    ['NEL', '\x85'],
    ['LINE SEPARATOR', '\u{2028}'],
    ['PARAGRAPH SEPARATOR', '\u{2029}'],
  ])('treats %s as a line break, so a marker on a line it begins still cuts', (_name, br) => {
    expect(splitAtSeparator_(`FOR SALE${br}Price: ₱1M${br}=== INTERNAL ===${br}${PRIVATE}`)).toEqual({
      posting: 'FOR SALE\nPrice: ₱1M',
      internal: PRIVATE,
      found: true,
      cutAt: 'heading: === INTERNAL ===',
    });
  });

  it('reads CRLF and a lone CR as line breaks', () => {
    expect(splitAtSeparator_(`FOR SALE\r\n---\r\n${PRIVATE}`).posting).toBe('FOR SALE');
    expect(splitAtSeparator_(`FOR SALE\r---\r${PRIVATE}`).posting).toBe('FOR SALE');
  });
});

describe('ordinary text', () => {
  it.each([
    'Ownership: clean title',
    'Near the international school',
    'Internally renovated kitchen',
    'Do not miss this!',
    'Commissioner’s office nearby',
    'Price: ₱4.2M',
    'Contact: 0917 000 0000',
    'Notes: bring a valid ID',
  ])('does not cut at %j', (line) => {
    expect(markerKind_(line)).toBe('');
    expect(splitAtSeparator_(`FOR SALE\n${line}\nViewing by appointment`).found).toBe(false);
  });

  it('leaves a document with no separator whole, and says none was found', () => {
    const doc =
      'FOR SALE: 2BR townhouse · 80 sqm lot\nFlood-free, near Aguinaldo Highway.\nPrice: ₱3.2M\n' +
      'Contact: 0917 000 0000 / 0920 000 0000\nSite visits by appointment.\n';

    expect(splitAtSeparator_(doc)).toEqual({ posting: doc.trim(), internal: '', found: false, cutAt: '' });
  });

  it('reads a missing document as an empty one with no separator', () => {
    const none = { posting: '', internal: '', found: false, cutAt: '' };

    expect(splitAtSeparator_('')).toEqual(none);
    expect(splitAtSeparator_(null)).toEqual(none);
    expect(splitAtSeparator_(undefined)).toEqual(none);
  });
});

describe('the Cut at label', () => {
  it('never begins with "=", which Sheets would evaluate (D7)', () => {
    const kinds = [...D5_SHAPES.map((s) => s.shape), ...PROTOTYPE_MARKERS, '~~~'].map((line) => markerKind_(line));

    expect(kinds.filter((kind) => kind.startsWith('='))).toEqual([]);
  });

  it('quotes at most the first 40 characters of a heading, its spaces collapsed', () => {
    expect(markerKind_('  INTERNAL   NOTES: the owner asked for 3% and a quick sale  ')).toBe(
      'heading: INTERNAL NOTES: the owner asked for 3% a',
    );
  });
});

// Reported, not yet fixed. Each states what should happen and is marked .fails
// while Separators.gs does otherwise; the fix turns it red, and then .fails goes.
// Each of these was an it.fails() — a test stating the right behaviour that
// passed while the splitter got it wrong. All five were closed on Oct 31.
describe('gaps closed on Oct 31', () => {
  it('cuts at the plural "Commissions", as it does at "Commission"', () => {
    expect(markerKind_('Commissions to referring agents')).not.toBe('');
  });

  it('takes a curly apostrophe in "owner’s", as Google Docs types it, for a straight one', () => {
    expect(markerKind_('Call the owner’s mobile 0917 123 4567')).toBe('mentions the owner');
  });

  it('takes a curly apostrophe in an all-caps "OWNER’S DETAILS" heading for a straight one', () => {
    expect(markerKind_('1. OWNER’S DETAILS')).not.toBe('');
  });

  it('cuts at a heading bulleted with an emoji, as Facebook-style listings write them', () => {
    expect(markerKind_('📌 Owner: Juan 0917 123 4567')).not.toBe('');
  });

  it('keeps a heading whose text happens to end in "line" in internal', () => {
    expect(splitAtSeparator_('FOR SALE\nCommission: 3% online\n0917 123 4567').internal).toBe(
      'Commission: 3% online\n0917 123 4567',
    );
  });
});

// Added Oct 31 with the listing-copy exclusions and the owner-and-mobile rule.
describe('listing copy that starts like a marker but is meant to be posted', () => {
  // D5 prefers cutting early to leaking, but these are selling points, and
  // cutting at them drops everything below too: the contact line included.
  it.each([
    'Internal area: 120 sqm',
    'Internal floor area 85 sqm',
    'Owner financing available',
    'Owner-occupied unit, well kept',
    'Owner managed building',
    'Owner financing available, call 0917 123 4567',
  ])('does not cut at %j', (line) => {
    expect(markerKind_(line)).toBe('');
    expect(splitAtSeparator_(`FOR SALE\n${line}\nContact APR 0927 555 5803`).found).toBe(false);
  });
});

describe('the owner named beside a mobile number', () => {
  // "Call the owner at …" names no name, contact or number, so the other owner
  // rules miss it; but a line mentioning the owner with a mobile on it is the
  // owner's number.
  it.each([
    'Call the owner at 0917 123 4567',
    'For viewing, text owner 09171234567',
    'owner: +63 917 123 4567',
    'Viewing via the owner (0917.123.4567)',
  ])('cuts at %j', (line) => {
    const cut = splitAtSeparator_(`FOR SALE\nLot 7\n${line}`);
    expect(cut.found).toBe(true);
    expect(cut.posting).toBe('FOR SALE\nLot 7');
    expect(cut.posting).not.toMatch(/0917|917 123/);
  });

  it('leaves the agency\'s own number alone when no owner is mentioned', () => {
    expect(markerKind_('Contact Alpha Premier Realty: 0917 555 5803')).toBe('');
  });
});
