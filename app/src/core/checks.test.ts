import { describe, expect, it } from 'vitest';
import { runChecks } from './checks';
import { parsePostingText } from './posting-text';
import type { CheckResult } from './types';

// TestApp.StandardDoc in the C# tests.
const STANDARD_DOC =
  'Category: Lot\nLocation: Tagaytay\n\nFOR SALE: 320 sqm lot\nCool climate.\nPrice: ₱4.2M\n' +
  'Contact: 0917 000 0000 / 0920 000 0000\n\n=== INTERNAL — DO NOT POST ===\nCommission: 3% to agent\nOwner: Mr. Reyes';

// src/PostIt.App/SampleData/Properties/Commercial/Mabini Commercial Space/posting.txt,
// copied so these tests outlive the prototype.
const MABINI_DOC =
  'Category: Commercial\nLocation: Makati\n\n' +
  'FOR LEASE: Ground floor · 120 sqm – Mabini Commercial Space, Makati\n' +
  'High foot traffic along Mabini, suitable for a café or clinic.\nPrice: ₱180K / month\n' +
  'Contact: 0917 000 0000 / 0920 000 0000\n5% commission to referring agents — inquire for details.\n' +
  'Site visits by appointment. Message us to book a schedule.\n\n=== INTERNAL — DO NOT POST ===\n' +
  'Commission: 4% to agent, 1% referral fee\nOwner: Dr. Lim (direct). Net to owner ₱8.2M.\n' +
  'Terms: 20% DP, balance 12 months\nNotes: Title under transfer, ETA 2 weeks.\n';

const run = (doc: string): CheckResult[] => runChecks(parsePostingText(doc));

function check(doc: string, name: string): CheckResult {
  const found = run(doc).filter((c) => c.name === name);
  expect(found).toHaveLength(1);
  return found[0]!;
}

const price = (doc: string): string => check(doc, 'Price present').detail;
const contacts = (doc: string): string => check(doc, 'Contact numbers present').detail;
const commission = (doc: string): string => check(doc, 'No commission wording').detail;
const found = (quoted: string): string => `Found "${quoted}" — remove it before posting`;

describe('runChecks — ported from PrePostCheckerTests', () => {
  it('passes a clean document on all four checks, in order', () => {
    const checks = run(STANDARD_DOC);

    expect(checks.map((c) => c.name)).toEqual([
      'Price present',
      'Contact numbers present',
      'No commission wording',
      'Internal section hidden',
    ]);
    expect(checks.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(checks.map((c) => c.detail)).toEqual(['₱4.2M', '2 found', 'Clean', 'Kept out of the copy']);
  });

  it('reads the price formats', () => {
    expect(price('Price: ₱180K / month\n')).toBe('₱180K / month');
    expect(price('Selling at PHP 4,200,000, cash only')).toBe('PHP 4,200,000');
    expect(price('Php 3.5 million, negotiable')).toBe('Php 3.5 million');
    expect(price('Now P3.6M!')).toBe('P3.6M');
    expect(price('Price: 4,200,000 negotiable')).toBe('4,200,000 negotiable');

    const missing = check('Price: ask us\nUP 5 floors', 'Price present');
    expect(missing.status).toBe('warn');
    expect(missing.detail).toBe('No price found in the public text');
  });

  it('does not count a price in the internal part', () => {
    expect(check('Nice lot\n=== INTERNAL ===\nNet ₱3.9M', 'Price present').status).toBe('warn');
  });

  it('counts mobile and landline numbers, each once', () => {
    expect(contacts('Call +63 917 123 4567 or (02) 8123 4567')).toBe('2 found');
    expect(contacts('Text 0917-123-4567 / 0917 123 4567')).toBe('1 found');
    expect(contacts('Viber 09171234567')).toBe('1 found');

    const none = check('Message us on Facebook. Lot 12, 320 sqm.', 'Contact numbers present');
    expect(none.status).toBe('warn');
    expect(none.detail).toBe('No contact number found');
  });

  it.each([
    ['5% Commission to referring agents', 'Commission'],
    ['Comm. 5% for brokers', 'Comm. 5%'],
    ['Referral fee available', 'Referral fee'],
    ["Agent's share is generous", "Agent's share"],
    ['Big incentive for buyers', 'incentive'],
    ['Net to owner ₱3.9M', 'Net to owner'],
    ['3% to agents', '3% to agents'],
    ["Finder's fee given", "Finder's fee"],
    ['Cash rebate on signing', 'rebate'],
  ])('fails on commission wording and quotes it: %j', (line, quoted) => {
    const result = check(`FOR SALE\n${line}\n`, 'No commission wording');

    expect(result.status).toBe('fail');
    expect(result.detail).toBe(found(quoted));
  });

  it('quotes the first hit', () => {
    expect(commission('Rebate! Also a commission.')).toBe(found('Rebate'));
  });

  it('passes commission wording in the internal part, and words that merely contain it', () => {
    expect(check(STANDARD_DOC, 'No commission wording').status).toBe('pass');
    expect(check('Community pool and clubhouse', 'No commission wording').status).toBe('pass');
  });

  it('blocks copying when there is no internal marker', () => {
    // Not a warning. A document with no separator has not been checked by anyone,
    // and in the real library those are exactly the ones carrying the owner's
    // mobile number (D6).
    const result = check('FOR SALE\nPrice: ₱1M', 'Internal section hidden');

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('No separator');
  });

  it('fails the Mabini sample on its commission line', () => {
    const checks = run(MABINI_DOC);

    expect(checks[0]).toMatchObject({ status: 'pass', detail: '₱180K / month' });
    expect(checks[1]?.detail).toBe('2 found');
    expect(checks[2]).toMatchObject({ status: 'fail', detail: found('commission') });
    expect(checks[3]?.status).toBe('pass');
  });
});

describe('runChecks — beyond the C# tests', () => {
  it('runs on a property as the server sent it', () => {
    const fromServer = { publicText: 'FOR SALE\nPrice: ₱1M\nCall 0917 123 4567', hasInternal: false };
    const checks = runChecks(fromServer);

    expect(checks.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'fail']);
    expect(checks[3]?.detail).toBe(
      "No separator in the document, so none of this text is confirmed safe to post. Add one above the owner's details.",
    );
  });

  it('reads the units in any case, as .NET\'s (?i:…) does, but not "per" or the currency', () => {
    expect(price('P3.6 MILLION')).toBe('P3.6 MILLION');
    expect(price('PHP 2 Thousand')).toBe('PHP 2 Thousand');
    expect(price('₱180k per MO')).toBe('₱180k per MO');
    expect(price('₱180K PER MONTH')).toBe('₱180K');
    // .NET's case-insensitive k also takes the Kelvin sign.
    expect(price('₱180\u{212A}')).toBe('₱180\u{212A}');
    expect(check('Ask php 5', 'Price present').status).toBe('warn');
  });

  it('does not take the "mil" of a Filipino "milyon" as a unit', () => {
    expect(price('₱3.5 milyon')).toBe('₱3.5');
  });

  it('quotes commission wording without the spaces the pattern swallowed', () => {
    expect(commission('Comm 5 for brokers')).toBe(found('Comm 5'));
  });

  it('ignores a number run into other digits', () => {
    expect(check('Lot 1209171234567', 'Contact numbers present').status).toBe('warn');
  });

  it('counts the same mobile written +63 and 0 as two, as the C# did: it compares digits as written', () => {
    expect(contacts('+63 917 123 4567 / 0917 123 4567')).toBe('2 found');
  });

  // Each of these reads differently under a literal translation of the .NET
  // patterns, and each expectation is what .NET 8 returns for the same input.
  describe('reads text as .NET does', () => {
    it('ends a word at ₱, ’ and other punctuation outside ASCII', () => {
      expect(commission('‘Commission’ negotiable')).toBe(found('Commission'));
      expect(commission('Agent’s share is generous')).toBe(found('Agent’s share'));
      expect(commission('Finder’s fee given')).toBe(found('Finder’s fee'));
      expect(price('₱4.2M—negotiable')).toBe('₱4.2M');
    });

    it('does not end a word at an accented letter or a combining mark', () => {
      expect(check('Commissioné', 'No commission wording').status).toBe('pass');
      expect(check('Rebate\u{301}', 'No commission wording').status).toBe('pass');
      expect(price('P5Mé')).toBe('P5');
    });

    it('does not read a currency sign at the end of a word, in any script, as a price', () => {
      expect(check('UP 5 floors', 'Price present').status).toBe('warn');
      expect(check('ÑP 5 floors', 'Price present').status).toBe('warn');
    });

    it('reads digits in any script, as .NET\'s \\d does', () => {
      expect(price('₱４.２M')).toBe('₱４.２M');
      expect(contacts('Call (０２) ８１２３ ４５６７')).toBe('1 found');
      expect(commission('Comm. ５% to brokers')).toBe(found('Comm. ５%'));
      // A mobile's leading 0, 9 or 63 is written literally in the pattern, so only ASCII will do.
      expect(check('Call ０９１７ １２３ ４５６７', 'Contact numbers present').status).toBe('warn');
    });

    it('counts U+0085 as a space, as .NET\'s \\s does', () => {
      expect(commission('Referral\x85fee available')).toBe(found('Referral\x85fee'));
    });

    it('ends a line only at \\n, for "." and for ^ and $', () => {
      expect(price('Price:\u{2028}call 0917 123 4567')).toBe('call 0917 123 4567');
      expect(check('Call us\u{2028}Price: 4,200,000', 'Price present').status).toBe('warn');
    });

    it('never takes "fancy" text outside the BMP for letters or digits', () => {
      expect(commission('commission𝗫')).toBe(found('commission'));
      expect(price('𝗫₱4.2M')).toBe('₱4.2M');
      expect(check('Price ₱𝟰.𝟮𝗠', 'Price present').status).toBe('warn');
    });
  });
});
