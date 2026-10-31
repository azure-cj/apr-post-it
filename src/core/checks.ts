/**
 * The checks shown before an intern copies the posting text. A 'fail' blocks Copy;
 * a 'warn' asks the intern to look again.
 *
 * Ported from PostIt.Core/Rules/PrePostChecker.cs. The patterns were tuned against
 * the real listings, so they are .NET's, translated only where JS would read the
 * same pattern differently:
 *
 * - \d is written D: .NET's \d is any decimal digit, JS's only 0-9.
 * - \s is written S: .NET's includes U+0085 and not U+FEFF, JS's the reverse.
 * - \b is written WORD_START / WORD_END: .NET's \b knows every script, JS's only
 *   [A-Za-z0-9_], even with the u flag.
 * - "." is [^\n], and multiline ^ / $ are lookarounds on \n: JS's also break at
 *   \r, U+2028 and U+2029.
 * - .NET reads one UTF-16 unit at a time, so a character outside the BMP (𝗳𝗮𝗻𝗰𝘆
 *   text) is never a letter, digit or word character to it. JS's u flag sees
 *   whole characters, so the classes are held to the BMP to agree.
 */

import type { PostingText } from './posting-text';
import type { CheckResult } from './types';

const SPACE = String.raw`\t-\r\x85\p{Z}`;
const S = `[${SPACE}]`;
// Not (?=[\0-\u{FFFF}]): Node 22's V8 compiles "(?:(?=[\0-\u{FFFF}])\p{Nd})+/"
// differently from how it interprets it, so "50/50 split" matched on a first
// call and not after. This form gives the same answer in both.
const BMP = String.raw`(?![\u{10000}-\u{10FFFF}])`;
const D = String.raw`(?:${BMP}\p{Nd})`;

// .NET's word characters for \b, the two zero-width joiners included.
const WORD = String.raw`(?:${BMP}[\p{L}\p{Mn}\p{Nd}\p{Pc}\u{200C}\u{200D}])`;
const WORD_START = `(?<!${WORD})`;
const WORD_END = `(?!${WORD})`;

// ₱4.2M · PHP 4,200,000 · P3.6 million · ₱180K / month
// Case-sensitive apart from the units, which .NET marks (?i:…). JS has no inline
// flags yet, so their cases are spelled out; .NET's case-insensitive k also takes
// the Kelvin sign.
const CURRENCY_AMOUNT = new RegExp(
  String.raw`(?<!${BMP}[\p{L}\p{N}])(?:₱|PHP|Php|P)${S}?${D}(?:(?:${D}|,)*${D})?(?:\.${D}+)?` +
    String.raw`(?:${S}?(?:[Mm][Ii][Ll][Ll][Ii][Oo][Nn]|[Tt][Hh][Oo][Uu][Ss][Aa][Nn][Dd]|[Mm][Ii][Ll]|[Mm]|[Kk\u{212A}])${WORD_END})?` +
    String.raw`(?:${S}*(?:/|per)${S}*(?:[Mm][Oo][Nn][Tt][Hh]|[Mm][Oo])${WORD_END})?`,
  'u',
);

const PRICE_LINE = new RegExp(
  String.raw`(?<![^\n])${S}*price${S}*:(?<value>[^\n]*${D}[^\n]*)(?![^\n])`,
  'iu',
);

// PH mobiles (0917 000 0000, +63 917 000 0000) and landlines like (02) 8123 4567.
// Dots are separators too ("0917.123.4567"), which the C# missed.
const CONTACT_NUMBER = new RegExp(
  String.raw`(?<!${D})(?:(?:\+?63|0)${S}?9${D}{2}[${SPACE}\-.]?${D}{3}[${SPACE}\-.]?${D}{4}` +
    String.raw`|\(${D}{2,4}\)${S}?${D}{3,4}[${SPACE}\-.]?${D}{4})(?!${D})`,
  'gu',
);

// A share of the price: "3%", "2.5 percent", "three per cent".
const PERCENT =
  String.raw`(?:${D}+(?:\.${D}+)?|${WORD_START}(?:one|two|three|four|five|six|seven|eight|nine|ten|half))` +
  String.raw`${S}*(?:%|percent${WORD_END}|per${S}+cent${WORD_END})`;

// Who a share goes to. A share "to" or "for" a person in the deal is commission
// however it is worded; a share of anything else ("3 percent discount", "10% down
// payment") is not, so the recipient has to be named.
const RECIPIENT =
  String.raw`(?:(?:the|any|all|our)${S}+)?(?:(?:co-?)?(?:agents?|brokers?)|referr(?:ers?|ing${S}+(?:agents?|brokers?))` +
  String.raw`|whoever${S}+(?:closes|sells|brings)|closing${S}+(?:agents?|brokers?))${WORD_END}`;

// The C# patterns first, in their order, then what it missed. Under the i flag
// JS also lets ſ (long s) stand for s, which .NET does not; the check runs on an
// NFKC copy anyway, which folds ſ to s.
const COMMISSION_WORDING = new RegExp(
  [
    String.raw`${WORD_START}commissions?${WORD_END}`,
    String.raw`${WORD_START}comm\.?${S}*${D}+(?:\.${D}+)?${S}*%?`,
    String.raw`${WORD_START}referral${S}+fees?${WORD_END}`,
    String.raw`${WORD_START}agent['’]?s?${S}+(?:share|fee|cut)s?${WORD_END}`,
    String.raw`${WORD_START}incentives?${WORD_END}`,
    String.raw`${WORD_START}net${S}+to${S}+owner${WORD_END}`,
    String.raw`${D}+(?:\.${D}+)?${S}*%${S}*to${S}+(?:the${S}+)?agents?${WORD_END}`,
    String.raw`${WORD_START}finder['’]?s?${S}+fees?${WORD_END}`,
    String.raw`${WORD_START}rebates?${WORD_END}`,
    String.raw`${PERCENT}${S}*(?:to|for)${S}+${RECIPIENT}`,
    String.raw`${PERCENT}${S}*(?:sharing|split)${WORD_END}`,
    String.raw`${WORD_START}co[-${SPACE}]?brok(?:e|ers?|ing)${WORD_END}`,
    String.raw`${WORD_START}brokers?['’]?s?${S}+(?:fees?|share|cut)${WORD_END}`,
    String.raw`${WORD_START}sharing${S}*(?:of${S}+)?${D}+${S}*/${S}*${D}+`,
    String.raw`${D}+${S}*/${S}*${D}+${S}*(?:sharing|split)${WORD_END}`,
    String.raw`${WORD_START}split${S}+(?:with|among|between)${S}+${RECIPIENT}`,
    String.raw`${WORD_START}[ck]omis[iy]on${WORD_END}`,
  ].join('|'),
  'iu',
);

const SPACE_CHAR = new RegExp(S, 'u');
const NOT_DIGIT = /\P{Nd}/gu;

/**
 * Runs every check on the public part of the document. Always the same four, in
 * the same order: price, contact numbers, commission wording, internal section.
 * Takes a parsed document or a property as the server sent it.
 */
export function runChecks(text: Pick<PostingText, 'publicText' | 'hasInternal'>): CheckResult[] {
  return [
    checkPrice(text.publicText),
    checkContacts(text.publicText),
    checkCommission(text.publicText),
    // Blocks, rather than warns (D6). Across the real library, 79 of 1,474
    // documents had no marker of any kind, and documents in that state were found
    // to carry owner names, mobile numbers and commission terms. "No marker" does
    // not mean "nothing private in here", it means nobody has separated it yet —
    // so Copy waits for a person.
    text.hasInternal
      ? { name: 'Internal section hidden', status: 'pass', detail: 'Kept out of the copy' }
      : {
          name: 'Internal section hidden',
          status: 'fail',
          detail:
            "No separator in the document, so none of this text is confirmed safe to post. Add one above the owner's details.",
        },
  ];
}

function checkPrice(text: string): CheckResult {
  const name = 'Price present';
  const amount = CURRENCY_AMOUNT.exec(text);
  if (amount) return { name, status: 'pass', detail: trim(amount[0]) };

  const line = PRICE_LINE.exec(text);
  return line
    ? { name, status: 'pass', detail: trim(line.groups?.value ?? '') }
    : { name, status: 'warn', detail: 'No price found in the public text' };
}

function checkContacts(text: string): CheckResult {
  const name = 'Contact numbers present';
  // 0917-123-4567 and 0917 123 4567 are one number written two ways.
  const distinct = new Set(Array.from(text.matchAll(CONTACT_NUMBER), (m) => m[0].replace(NOT_DIGIT, ''))).size;
  return distinct > 0
    ? { name, status: 'pass', detail: `${distinct} found` }
    : { name, status: 'warn', detail: 'No contact number found' };
}

function checkCommission(text: string): CheckResult {
  const name = 'No commission wording';
  const { folded, origin } = foldCompatibility(text);
  const hit = COMMISSION_WORDING.exec(folded);
  if (!hit) return { name, status: 'pass', detail: 'Clean' };
  const quoted = text.slice(origin[hit.index], origin[hit.index + hit[0].length]);
  return { name, status: 'fail', detail: `Found "${trim(quoted)}" — remove it before posting` };
}

// "𝗖𝗼𝗺𝗺𝗶𝘀𝘀𝗶𝗼𝗻" and "ｃｏｍｍｉｓｓｉｏｎ" are commission to a reader, so the
// pattern is matched against an NFKC copy, folded one character at a time so
// that every position in it maps back to the original, which is what is quoted.
function foldCompatibility(text: string): { folded: string; origin: number[] } {
  let folded = '';
  const origin: number[] = [];
  let at = 0;
  for (const char of text) {
    const piece = char.normalize('NFKC');
    for (let i = 0; i < piece.length; i++) origin.push(at);
    folded += piece;
    at += char.length;
  }
  origin.push(at);
  return { folded, origin };
}

// .NET's Trim(), by the same whitespace as S. A loop, because /\s+$/ backtracks
// quadratically through a long run of spaces in the middle of a line.
function trim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && SPACE_CHAR.test(s.charAt(start))) start++;
  while (end > start && SPACE_CHAR.test(s.charAt(end - 1))) end--;
  return s.slice(start, end);
}
