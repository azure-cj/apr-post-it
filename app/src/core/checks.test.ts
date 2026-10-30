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

// The public part of the Mabini sample as the C# prototype cut it, at its INTERNAL
// line: what its check was handed, commission line included.
const MABINI_PUBLIC_AS_THE_CSHARP_CUT_IT =
  'FOR LEASE: Ground floor · 120 sqm – Mabini Commercial Space, Makati\n' +
  'High foot traffic along Mabini, suitable for a café or clinic.\nPrice: ₱180K / month\n' +
  'Contact: 0917 000 0000 / 0920 000 0000\n5% commission to referring agents — inquire for details.\n' +
  'Site visits by appointment. Message us to book a schedule.';

const PRICE = 'Price present';
const CONTACTS = 'Contact numbers present';
const COMMISSION = 'No commission wording';
const INTERNAL = 'Internal section hidden';

function named(checks: CheckResult[], name: string): CheckResult {
  const found = checks.filter((c) => c.name === name);
  expect(found).toHaveLength(1);
  return found[0]!;
}

// End to end: the document is split first, by the same Separators.gs the server uses.
const run = (doc: string): CheckResult[] => runChecks(parsePostingText(doc));
const check = (doc: string, name: string): CheckResult => named(run(doc), name);

// The checks alone, handed public text no splitter has seen: the safety net.
const direct = (publicText: string, name: string): CheckResult =>
  named(runChecks({ publicText, hasInternal: true }), name);

const price = (doc: string): string => check(doc, PRICE).detail;
const contacts = (doc: string): string => check(doc, CONTACTS).detail;
const found = (quoted: string): string => `Found "${quoted}" — remove it before posting`;

describe('runChecks — ported from PrePostCheckerTests', () => {
  it('passes a clean document on all four checks, in order', () => {
    const checks = run(STANDARD_DOC);

    expect(checks.map((c) => c.name)).toEqual([PRICE, CONTACTS, COMMISSION, INTERNAL]);
    expect(checks.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(checks.map((c) => c.detail)).toEqual(['₱4.2M', '2 found', 'Clean', 'Kept out of the copy']);
  });

  it('reads the price formats', () => {
    expect(price('Price: ₱180K / month\n')).toBe('₱180K / month');
    expect(price('Selling at PHP 4,200,000, cash only')).toBe('PHP 4,200,000');
    expect(price('Php 3.5 million, negotiable')).toBe('Php 3.5 million');
    expect(price('Now P3.6M!')).toBe('P3.6M');
    expect(price('Price: 4,200,000 negotiable')).toBe('4,200,000 negotiable');

    const missing = check('Price: ask us\nUP 5 floors', PRICE);
    expect(missing.status).toBe('warn');
    expect(missing.detail).toBe('No price found in the public text');
  });

  it('does not count a price in the internal part', () => {
    expect(check('Nice lot\n=== INTERNAL ===\nNet ₱3.9M', PRICE).status).toBe('warn');
  });

  it('counts mobile and landline numbers, each once', () => {
    expect(contacts('Call +63 917 123 4567 or (02) 8123 4567')).toBe('2 found');
    expect(contacts('Text 0917-123-4567 / 0917 123 4567')).toBe('1 found');
    expect(contacts('Viber 09171234567')).toBe('1 found');

    const none = check('Message us on Facebook. Lot 12, 320 sqm.', CONTACTS);
    expect(none.status).toBe('warn');
    expect(none.detail).toBe('No contact number found');
  });

  // The C# handed these lines to the check inside a document. The splitter now
  // cuts some of them out first (see below), so the check is tested on them
  // directly: it is still the net behind the splitter.
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
  ])('fails on commission wording handed to it, and quotes it: %j', (line, quoted) => {
    const result = direct(`FOR SALE\n${line}\n`, COMMISSION);

    expect(result.status).toBe('fail');
    expect(result.detail).toBe(found(quoted));
  });

  it('quotes the first hit', () => {
    expect(direct('Rebate! Also a commission.', COMMISSION).detail).toBe(found('Rebate'));
  });

  it('passes commission wording in the internal part, and words that merely contain it', () => {
    expect(check(STANDARD_DOC, COMMISSION).status).toBe('pass');
    expect(check('Community pool and clubhouse', COMMISSION).status).toBe('pass');
  });

  it('blocks copying when there is no internal marker', () => {
    // Not a warning. A document with no separator has not been checked by anyone,
    // and in the real library those are exactly the ones carrying the owner's
    // mobile number (D6).
    const result = check('FOR SALE\nPrice: ₱1M', INTERNAL);

    expect(result.status).toBe('fail');
    expect(result.detail).toContain('No separator');
  });

  it("keeps the Mabini sample's commission line out of the public text", () => {
    const text = parsePostingText(MABINI_DOC);

    expect(text.publicText.toLowerCase()).not.toContain('commission');
    expect(text.internalText.startsWith('5% commission to referring agents')).toBe(true);
    expect(text.cutAt).toBe('mentions commission');
    // Cutting at the first marker costs the line after it too (D5): a short post
    // can be fixed, a published commission cannot.
    expect(text.publicText).not.toContain('Site visits by appointment');
    expect(runChecks(text).map((c) => `${c.status}: ${c.detail}`)).toEqual([
      'pass: ₱180K / month',
      'pass: 2 found',
      'pass: Clean',
      'pass: Kept out of the copy',
    ]);
  });

  it('would fail the Mabini sample on its commission line, had it reached the check', () => {
    expect(direct(MABINI_PUBLIC_AS_THE_CSHARP_CUT_IT, COMMISSION)).toMatchObject({
      status: 'fail',
      detail: found('commission'),
    });
  });
});

describe('commission wording, end to end', () => {
  // The splitter cuts at any line that mentions commission or the net to owner,
  // so these never reach the check: the cut is the defence, and Cut at says so.
  it.each([
    ['5% Commission to referring agents', 'mentions commission'],
    ['Net to owner ₱3.9M', 'heading: Net to owner ₱3.9M'],
    ['Rebate! Also a commission.', 'mentions commission'],
    // Moved here from the check-alone table below when the splitter learned the
    // plural (Oct 31): its row went red there, as it was written to.
    ['Commissions to referring agents', 'heading: Commissions to referring agents'],
  ])('cuts %j out of the public text before the check sees it', (line, cutAt) => {
    const text = parsePostingText(`FOR SALE\n${line}\nMr. Reyes, 0917 123 4567`);

    expect(text.publicText).toBe('FOR SALE');
    expect(text.cutAt).toBe(cutAt);
    expect(text.internalText).toBe(`${line}\nMr. Reyes, 0917 123 4567`);
    expect(named(runChecks(text), COMMISSION).status).toBe('pass');
  });

  // The splitter does not cut at these, so the check is the only defence: it must
  // fail the document with the wording still in its public text. If the splitter
  // starts cutting one, its row goes red: move it to the table above.
  it.each([
    ['Comm. 5% for brokers', 'Comm. 5%'],
    ['Referral fee available', 'Referral fee'],
    ["Agent's share is generous", "Agent's share"],
    ['Agent’s cut is 2%', 'Agent’s cut'],
    ['Agents fee: ₱50,000', 'Agents fee'],
    ['Big incentive for buyers', 'incentive'],
    ['3% to agents', '3% to agents'],
    ["Finder's fee given", "Finder's fee"],
    ['Finder’s fee given', 'Finder’s fee'],
    ['Cash rebate on signing', 'rebate'],
  ])('leaves %j in the public text, where the check alone fails it', (line, quoted) => {
    const text = parsePostingText(`FOR SALE\n${line}\n=== INTERNAL ===\nMr. Reyes, 0917 123 4567`);

    expect(text.publicText).toBe(`FOR SALE\n${line}`);
    expect(text.cutAt).toBe('heading: === INTERNAL ===');
    expect(named(runChecks(text), COMMISSION)).toMatchObject({ status: 'fail', detail: found(quoted) });
  });

  it('still fails a referral fee split over two lines by NEL, which is a line break now', () => {
    expect(check('FOR SALE\nReferral\x85fee available\n=== INTERNAL ===\nx', COMMISSION).status).toBe('fail');
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

  it('still says why when the server withheld an unseparated document from an intern', () => {
    expect(runChecks({ publicText: '', hasInternal: false }).map((c) => c.status)).toEqual(['warn', 'warn', 'pass', 'fail']);
  });

  it('reads the units in any case, as .NET\'s (?i:…) does, but not "per" or the currency', () => {
    expect(price('P3.6 MILLION')).toBe('P3.6 MILLION');
    expect(price('PHP 2 Thousand')).toBe('PHP 2 Thousand');
    expect(price('₱180k per MO')).toBe('₱180k per MO');
    expect(price('₱180K PER MONTH')).toBe('₱180K');
    // .NET's case-insensitive k also takes the Kelvin sign.
    expect(price('₱180\u{212A}')).toBe('₱180\u{212A}');
    expect(check('Ask php 5', PRICE).status).toBe('warn');
  });

  it('does not take the "mil" of a Filipino "milyon" as a unit', () => {
    expect(price('₱3.5 milyon')).toBe('₱3.5');
  });

  it('quotes commission wording without the spaces the pattern swallowed', () => {
    expect(check('Comm 5 for brokers', COMMISSION).detail).toBe(found('Comm 5'));
  });

  it('ignores a number run into other digits', () => {
    expect(check('Lot 1209171234567', CONTACTS).status).toBe('warn');
  });

  it('counts the same mobile written +63 and 0 as two, as the C# did: it compares digits as written', () => {
    expect(contacts('+63 917 123 4567 / 0917 123 4567')).toBe('2 found');
  });

  // The splitter breaks lines at U+2028, so a "Price:" after one starts a line by
  // the time the check sees it. Handed the raw text, the check reads it as .NET
  // did (below) and does not.
  it('reads a price line begun by U+2028, which the splitter has made a line break', () => {
    expect(price('Call us\u{2028}Price: 4,200,000')).toBe('4,200,000');
  });
});

// Handed the public text directly, so these test the checks' own patterns,
// whatever the splitter in front of them does. Each reads differently under a
// literal translation of the .NET pattern into JS, and each expectation is what
// .NET 8 returned for the same input to the C# they were ported from.
describe("the checks' own patterns read text as .NET does", () => {
  it('end a word at ₱, ’ and other punctuation outside ASCII', () => {
    expect(direct('‘Commission’ negotiable', COMMISSION).detail).toBe(found('Commission'));
    expect(direct('Agent’s share is generous', COMMISSION).detail).toBe(found('Agent’s share'));
    expect(direct('Finder’s fee given', COMMISSION).detail).toBe(found('Finder’s fee'));
    expect(direct('₱4.2M—negotiable', PRICE).detail).toBe('₱4.2M');
  });

  it('do not end a word at an accented letter or a combining mark', () => {
    expect(direct('Commissioné', COMMISSION).status).toBe('pass');
    expect(direct('Rebate\u{301}', COMMISSION).status).toBe('pass');
    expect(direct('P5Mé', PRICE).detail).toBe('P5');
  });

  it('do not read a currency sign at the end of a word, in any script, as a price', () => {
    expect(direct('UP 5 floors', PRICE).status).toBe('warn');
    expect(direct('ÑP 5 floors', PRICE).status).toBe('warn');
  });

  it('read digits in any script, as .NET\'s \\d does', () => {
    expect(direct('₱４.２M', PRICE).detail).toBe('₱４.２M');
    expect(direct('Call (０２) ８１２３ ４５６７', CONTACTS).detail).toBe('1 found');
    expect(direct('Comm. ５% to brokers', COMMISSION).detail).toBe(found('Comm. ５%'));
    // A mobile's leading 0, 9 or 63 is written literally in the pattern, so only ASCII will do.
    expect(direct('Call ０９１７ １２３ ４５６７', CONTACTS).status).toBe('warn');
  });

  it('count U+0085 as a space, as .NET\'s \\s does', () => {
    expect(direct('Referral\x85fee available', COMMISSION).detail).toBe(found('Referral\x85fee'));
  });

  it('end a line only at \\n, for "." and for ^ and $', () => {
    expect(direct('Price:\u{2028}call 0917 123 4567', PRICE).detail).toBe('call 0917 123 4567');
    expect(direct('Call us\u{2028}Price: 4,200,000', PRICE).status).toBe('warn');
  });

  it('never take "fancy" text outside the BMP for letters or digits', () => {
    expect(direct('commission𝗫', COMMISSION).detail).toBe(found('commission'));
    expect(direct('𝗫₱4.2M', PRICE).detail).toBe('₱4.2M');
    expect(direct('Price ₱𝟰.𝟮𝗠', PRICE).status).toBe('warn');
  });
});
