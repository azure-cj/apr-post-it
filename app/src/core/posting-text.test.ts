import { describe, expect, it } from 'vitest';
import { parsePostingText } from './posting-text';

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

  it('needs the marker words at the start of the line, after any decoration', () => {
    expect(parsePostingText('FOR INTERNAL USE ONLY\nx').hasInternal).toBe(true);
    expect(parsePostingText('Notes: internal only\nx').hasInternal).toBe(false);
    expect(parsePostingText('Please do not post this photo twice').hasInternal).toBe(false);
  });

  // Each of these reads differently under a literal translation of the .NET pattern
  // into JS, and each expectation is what .NET 8 returns for the same input.
  describe('reads text as .NET does', () => {
    it('counts U+0085 as a space before a marker, as .NET\'s \\s does and JS\'s does not', () => {
      const text = parsePostingText('FOR SALE: lot\n\x85=== INTERNAL ===\nOwner: 0917 123 4567');

      expect(text.hasInternal).toBe(true);
      expect(text.publicText).toBe('FOR SALE: lot');
    });

    it('counts a non-breaking space before a marker as a space', () => {
      expect(parsePostingText('FOR SALE\n\u{A0}\u{A0}=== INTERNAL ===\nOwner').hasInternal).toBe(true);
    });

    it('does not end a marker word at an accented letter, as .NET\'s \\b does not', () => {
      expect(parsePostingText('Internalé notes\nOwner').hasInternal).toBe(false);
      expect(parsePostingText('Internal\u{301} notes\nOwner').hasInternal).toBe(false);
    });

    it('ends a marker word at punctuation outside ASCII', () => {
      expect(parsePostingText('INTERNAL—DO NOT POST\nOwner').hasInternal).toBe(true);
      expect(parsePostingText('Internal’s notes\nOwner').hasInternal).toBe(true);
    });

    it('ends a marker word at "fancy" text outside the BMP, which .NET never takes for a letter', () => {
      const text = parsePostingText('FOR SALE\n## For agents only𝗫\nOwner');

      expect(text.hasInternal).toBe(true);
      expect(text.publicText).toBe('FOR SALE');
    });

    it('lets "." cover U+2028 in a metadata value, as .NET\'s does', () => {
      const text = parsePostingText('Location: Pasay\u{2028}City\nFOR SALE');

      expect(text.location).toBe('Pasay\u{2028}City');
      expect(text.publicText).toBe('FOR SALE');
    });

    it('trims U+0085 from the end of a line but leaves U+FEFF, as .NET\'s TrimEnd does', () => {
      expect(parsePostingText('FOR SALE\x85\nPrice\u{FEFF}').publicText).toBe('FOR SALE\nPrice\u{FEFF}');
    });
  });
});
