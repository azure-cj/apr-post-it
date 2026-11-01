import { describe, expect, it } from 'vitest';
import { flaggedLines_ } from '@server/Separators.gs';
import { copyTextFor, flaggedLinesOf, linesOf, parsePostingText } from './posting-text';

// TestApp.StandardDoc in the C# tests.
const STANDARD_DOC =
  'Category: Lot\nLocation: Tagaytay\n\nFOR SALE: 320 sqm lot\nCool climate.\nPrice: ₱4.2M\n' +
  'Contact: 0917 000 0000 / 0920 000 0000\n\n=== INTERNAL — DO NOT POST ===\nCommission: 3% to agent\nOwner: Mr. Reyes';

// src/PostIt.App/SampleData/Properties/House & Lot/Sunrise Homes Block 3 Lot 9/posting.txt,
// copied so these tests outlive the prototype.
const SUNRISE_DOC =
  'Category: House & Lot\nLocation: Bacoor\n\n' +
  'FOR SALE: 2BR townhouse · 80 sqm lot – Sunrise Homes Block 3 Lot 9, Bacoor\n' +
  'Flood-free, near Aguinaldo Highway and Molino Boulevard.\nPrice: ₱3.2M\n' +
  'Contact: 0917 000 0000 / 0920 000 0000\nSite visits by appointment. Message us to book a schedule.\n';

describe('parsePostingText — ported from PostingTextParserTests', () => {
  it('splits metadata, public text and internal notes', () => {
    const text = parsePostingText(STANDARD_DOC);

    expect(text.category).toBe('Lot');
    expect(text.location).toBe('Tagaytay');
    expect(text.hasInternal).toBe(true);
    expect(text.publicText.startsWith('FOR SALE: 320 sqm lot')).toBe(true);
    expect(text.publicText.endsWith('0920 000 0000')).toBe(true);
    // The C# assertions here ignore case.
    expect(text.publicText.toLowerCase()).not.toContain('category:');
    expect(text.publicText.toLowerCase()).not.toContain('internal');
    expect(text.publicText.toLowerCase()).not.toContain('commission');
    expect(text.internalText).toBe('Commission: 3% to agent\nOwner: Mr. Reyes');
  });

  it('allows blank lines in the metadata block, Type for Category, a byte-order mark and CRLF', () => {
    const text = parsePostingText('\u{FEFF}\r\nType: Condo\r\n\r\nlocation:  Pasay \r\nFOR SALE: 2BR\r\nBay view.\r\n');

    expect(text.category).toBe('Condo');
    expect(text.location).toBe('Pasay');
    expect(text.publicText).toBe('FOR SALE: 2BR\nBay view.');
    expect(text.hasInternal).toBe(false);
    expect(text.internalText).toBe('');
  });

  it('treats metadata keys after the top block as ordinary text', () => {
    const text = parsePostingText('FOR SALE: lot\nLocation: near the market\nPrice: ₱4.2M\nCategory: best buy');

    expect(text.category).toBeUndefined();
    expect(text.location).toBeUndefined();
    expect(text.publicText).toContain('Location: near the market');
    expect(text.publicText).toContain('Price: ₱4.2M');
    expect(text.publicText).toContain('Category: best buy');
  });

  it.each([
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
  ])('recognises the marker %j', (marker) => {
    const text = parsePostingText(`FOR SALE: lot\nPrice: ₱1M\n\n${marker}\nsecret commission 5%`);

    expect(text.hasInternal).toBe(true);
    expect(text.publicText).toBe('FOR SALE: lot\nPrice: ₱1M');
    expect(text.internalText).toBe('secret commission 5%');
  });

  it('cuts at the first marker only', () => {
    const text = parsePostingText('Public\n=== INTERNAL ===\nA\n=== INTERNAL ===\nB');

    expect(text.publicText).toBe('Public');
    expect(text.internalText).toBe('A\n=== INTERNAL ===\nB');
  });

  it('keeps words that merely start with "internal" in the public text', () => {
    const text = parsePostingText('Internally renovated kitchen\nDo not miss this!\nPrice: ₱2M');

    expect(text.hasInternal).toBe(false);
    expect(text.publicText).toContain('Internally renovated kitchen');
  });

  it('makes everything public when there is no marker', () => {
    const text = parsePostingText(SUNRISE_DOC);

    expect(text.hasInternal).toBe(false);
    expect(text.internalText).toBe('');
    expect(text.category).toBe('House & Lot');
    expect(text.publicText).toContain('Site visits by appointment');
  });

  it('trims and collapses blank lines, and keeps tabs', () => {
    expect(parsePostingText('\n\n  \nA\tB   \n\n\n \n\nC\n\n').publicText).toBe('A\tB\n\nC');
  });

  it('reads an empty or missing document as empty text', () => {
    const text = parsePostingText('');

    expect(text.publicText).toBe('');
    expect(text.hasInternal).toBe(false);
    expect(parsePostingText(null).publicText).toBe('');
    expect(parsePostingText(undefined).publicText).toBe('');
  });
});

describe('parsePostingText — beyond the C# tests', () => {
  it('recognises a marker written with a curly apostrophe', () => {
    const text = parsePostingText('FOR SALE: lot\nAgent’s notes:\nOwner: 0917 123 4567');

    expect(text.hasInternal).toBe(true);
    expect(text.publicText).toBe('FOR SALE: lot');
  });

  it('splits old Mac line endings, a lone CR', () => {
    const text = parsePostingText('FOR SALE: lot\r=== INTERNAL ===\rOwner: Mr. Reyes');

    expect(text.publicText).toBe('FOR SALE: lot');
    expect(text.internalText).toBe('Owner: Mr. Reyes');
  });

  it('strips every leading byte-order mark, not just one', () => {
    expect(parsePostingText('\u{FEFF}\u{FEFF}Category: Lot\nFOR SALE').category).toBe('Lot');
  });

  it('keeps the first Category or Type, and the first Location', () => {
    const text = parsePostingText('Category: Lot\nType: Condo\nLocation: Tagaytay\nLocation: Pasay\nFOR SALE');

    expect(text.category).toBe('Lot');
    expect(text.location).toBe('Tagaytay');
    expect(text.publicText).toBe('FOR SALE');
  });

  it('keeps an empty metadata line out of the post without taking its empty value', () => {
    const text = parsePostingText('Category:\nLocation: Tagaytay\nFOR SALE');

    expect(text.category).toBeUndefined();
    expect('category' in text).toBe(false);
    expect(text.location).toBe('Tagaytay');
    expect(text.publicText).toBe('FOR SALE');
  });

  it('finds a marker right under the metadata, leaving nothing public', () => {
    const text = parsePostingText('Category: Lot\n=== INTERNAL ===\nOwner: Mr. Reyes');

    expect(text.category).toBe('Lot');
    expect(text.hasInternal).toBe(true);
    expect(text.publicText).toBe('');
    expect(text.internalText).toBe('Owner: Mr. Reyes');
  });

  it('needs a marker heading at the start of a line, after any decoration', () => {
    expect(parsePostingText('FOR INTERNAL USE ONLY\nx').hasInternal).toBe(true);
    expect(parsePostingText('Notes: internal only\nx').hasInternal).toBe(false);
    expect(parsePostingText('Please do not post this photo twice').hasInternal).toBe(false);
  });

  // The metadata lines are still read by this file's own port of the C#, so
  // .NET is still the reference for them.
  it('lets "." cover U+2028 in a metadata value, as .NET\'s does', () => {
    const text = parsePostingText('Location: Pasay\u{2028}City\nFOR SALE');

    expect(text.location).toBe('Pasay\u{2028}City');
    expect(text.publicText).toBe('FOR SALE');
  });
});

// Where the postable text ends is no longer the C#'s rule, so .NET is no longer
// the reference for it. The cut is Separators.gs, the file Apps Script runs,
// linked in at build time (D13); Apps Script and the WebView are both V8, so the
// app agrees with the server by construction. These tests pin that shared
// behaviour end to end through this parser; separators.test.ts pins the file.
describe('parsePostingText — the cut, as the server makes it', () => {
  it('says where it cut, for auditing', () => {
    expect(parsePostingText(STANDARD_DOC).cutAt).toBe('heading: === INTERNAL — DO NOT POST ===');
    expect(parsePostingText('FOR SALE\n---\nMr. Reyes').cutAt).toBe('--- line');
    expect(parsePostingText(SUNRISE_DOC).cutAt).toBe('');
  });

  it('cuts at a line that mentions commission, wherever in the line it does', () => {
    const text = parsePostingText('FOR SALE: lot\nPrice: ₱1M\nSale: 3-5% Commission to agents\nCall 0917 123 4567');

    expect(text.publicText).toBe('FOR SALE: lot\nPrice: ₱1M');
    expect(text.internalText).toBe('Sale: 3-5% Commission to agents\nCall 0917 123 4567');
    expect(text.cutAt).toBe('mentions commission');
  });

  it("cuts at the owner's details, and keeps them for a manager", () => {
    const text = parsePostingText('FOR SALE: lot\nPrice: ₱1M\nOwner Name: Cruz\n0917 123 4567');

    expect(text.publicText).toBe('FOR SALE: lot\nPrice: ₱1M');
    expect(text.internalText).toBe('Owner Name: Cruz\n0917 123 4567');
    expect(text.cutAt).toBe('heading: Owner Name: Cruz');
  });

  it('cuts at a divider line and leaves the line itself out of both parts', () => {
    expect(parsePostingText('FOR SALE: lot\n━━━━━━━━\nMr. Reyes, 0917 123 4567')).toMatchObject({
      publicText: 'FOR SALE: lot',
      internalText: 'Mr. Reyes, 0917 123 4567',
      hasInternal: true,
      cutAt: 'bar line',
    });
  });

  it('breaks lines at NEL, U+2028 and U+2029', () => {
    for (const br of ['\x85', '\u{2028}', '\u{2029}']) {
      const text = parsePostingText(`FOR SALE${br}Price: ₱1M${br}=== INTERNAL ===${br}Mr. Reyes`);

      expect(text.publicText).toBe('FOR SALE\nPrice: ₱1M');
      expect(text.internalText).toBe('Mr. Reyes');
    }
  });

  it("finds a marker on a line begun by NEL, which JS's \\s alone would let past", () => {
    const text = parsePostingText('FOR SALE: lot\n\x85=== INTERNAL ===\nOwner: 0917 123 4567');

    expect(text.hasInternal).toBe(true);
    expect(text.publicText).toBe('FOR SALE: lot');
  });

  it('counts a non-breaking space before a marker as a space', () => {
    expect(parsePostingText('FOR SALE\n\u{A0}\u{A0}=== INTERNAL ===\nOwner').hasInternal).toBe(true);
  });

  it('ends a marker word at punctuation outside ASCII', () => {
    expect(parsePostingText('INTERNAL—DO NOT POST\nOwner').hasInternal).toBe(true);
    expect(parsePostingText('Internal’s notes\nOwner').hasInternal).toBe(true);
  });

  // JS's \b ends a word at any character outside ASCII, letters included, where
  // .NET's did not end one at é or a combining accent. So these lines cut now
  // and did not in the C# prototype. That is the safe direction: a line lost
  // from a post, never one leaked into it.
  it('cuts at a marker word run into an accented letter, where the C# did not', () => {
    for (const line of ['Internalé notes', 'Internal\u{301} notes']) {
      const text = parsePostingText(`FOR SALE\n${line}\nOwner`);

      expect(text.hasInternal).toBe(true);
      expect(text.publicText).toBe('FOR SALE');
      expect(text.cutAt).toBe(`heading: ${line}`);
    }
  });

  it('ends a marker word at "fancy" text outside the BMP', () => {
    const text = parsePostingText('FOR SALE\n## For agents only𝗫\nOwner');

    expect(text.hasInternal).toBe(true);
    expect(text.publicText).toBe('FOR SALE');
  });
});

describe('copyTextFor and flaggedLinesOf (D15)', () => {
  const unseparated = {
    publicText: 'FOR SALE: Lot 9\nPrice: PHP 1,200,000\n\nCall the owner 0918 765 4321\n\nTitle clean',
    hasInternal: false,
  };

  it('copies a separated document as it stands, flags or not', () => {
    const separated = { publicText: 'FOR SALE\nCall 0917 000 1111', hasInternal: true, flaggedLines: [1] };
    expect(copyTextFor(separated)).toBe(separated.publicText);
    expect([...flaggedLinesOf(separated)]).toEqual([]);
  });

  it('drops the flagged lines of an unseparated one, and tidies the blank lines they leave', () => {
    expect(copyTextFor({ ...unseparated, flaggedLines: [3] })).toBe('FOR SALE: Lot 9\nPrice: PHP 1,200,000\n\nTitle clean');
  });

  it('flags with Separators.gs too, so a line the server missed is still left out', () => {
    expect([...flaggedLinesOf({ ...unseparated, flaggedLines: [] })]).toEqual([3]);
    expect([...flaggedLinesOf({ ...unseparated, flaggedLines: [0] })].sort()).toEqual([0, 3]);
    expect(copyTextFor(unseparated)).toBe('FOR SALE: Lot 9\nPrice: PHP 1,200,000\n\nTitle clean');
  });

  it('numbers lines as the server does, whatever the line endings', () => {
    expect(linesOf('a\r\nb\rc d')).toEqual(['a', 'b', 'c', 'd']);
    expect(copyTextFor({ publicText: 'a\r\nOwner: x\r\nb', hasInternal: false, flaggedLines: [1] })).toBe('a\nb');
  });

  it('copies nothing when every line is flagged', () => {
    expect(copyTextFor({ publicText: 'Owner 0917 123 4567\n\n(02) 8123 4567', hasInternal: false })).toBe('');
  });
});

describe('flaggedLines_ (Separators.gs)', () => {
  it.each([
    ['a mobile', 'Call Juan 0918 765 4321'],
    ['a mobile with +63', 'Viber +63 917 222 3333'],
    ['a mobile with dots', '0917.123.4567'],
    ['a landline in brackets', 'Tel (02) 8123 4567'],
    ['a provincial landline', '(049) 123 4567'],
    ['a landline written out', '02 8123 4567'],
    ['the owner', 'Ask for the owner, Mrs. Dizon'],
    ["the owner's", 'Owner’s cousin will show the unit'],
    ['commission', '3% commission'],
    ['komisyon', 'May komisyon'],
    ['net to owner', 'PHP 4M net to owner'],
  ])('flags %s', (_name, line) => {
    expect(flaggedLines_(`FOR SALE\n${line}`)).toEqual([1]);
  });

  it.each([
    ['a price', 'Price: PHP 1,200,000'],
    ['a size', '320 sqm, 12 x 26.6 m'],
    ['owner financing', 'Owner financing available'],
    ['owner-occupied', 'Owner-occupied, move-in ready'],
    ['a date', 'Available 2026-11-01'],
    ['a blank line', '   '],
  ])('leaves %s alone', (_name, line) => {
    expect(flaggedLines_(`FOR SALE\n${line}`)).toEqual([]);
  });
});
