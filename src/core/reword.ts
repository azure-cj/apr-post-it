/**
 * Whether a reword from Claude (AID-129) may be posted in place of the
 * original. Claude is told to keep every fact and add none; this holds it to
 * that for the facts most easily changed by mistake, the numbers: a price, a
 * size, a phone number, a floor. The pre-post checks run on the reword too
 * (runChecks), so commission wording that slipped in still blocks Copy.
 *
 * Two kinds of new number are allowed, because the caption is asked for them:
 * the agency's own phone numbers, and a rate worked out from two numbers in
 * the original (the rent over the area, a per-sqm rate times the area). The
 * rate is worked out here as well, so a wrong sum is refused like any other
 * new number.
 */

import type { CheckResult } from './types';

/** The numbers a reword added and the ones it left out, as written ("4,200,000" and "4200000" are one). */
export interface NumberChanges {
  readonly added: readonly string[];
  readonly missing: readonly string[];
}

/**
 * Alpha Premier Realty's numbers, which every caption ends with. Claude is
 * given the same ones in firebase/functions/src/prompt.ts; change both.
 */
export const AGENCY_NUMBERS: readonly string[] = ['0927 555 5803', '0915 888 9482', '0921 217 4555'];

// Digit runs, with the commas and points inside them. Matched on an NFKC copy,
// so 𝟰.𝟮 and ４.２ are read as 4.2. The words after one say how big it is.
const NUMBER = /\d+(?:[.,]\d+)*(?:\s?(million|mil|m|thousand|k)(?![a-z]))?/gi;

// An agency number however it is spaced, with +63 or 63 in place of the 0.
const AGENCY = AGENCY_NUMBERS.map((n) => {
  const [first = '', ...rest] = n.split(' ');
  const body = [first.slice(1), ...rest].join('[\\s.-]?');
  return new RegExp(`(?<!\\d)(?:\\+?63\\s?|0)${body}(?!\\d)`, 'g');
});

interface Found {
  readonly written: string;
  readonly value: number;
}

function numbersIn(text: string): Map<string, Found> {
  const found = new Map<string, Found>();
  for (const match of text.matchAll(NUMBER)) {
    const digits = match[0].replace(/\s?[a-z]+$/i, '');
    const key = digits.replace(/,/g, '');
    if (found.has(key)) continue;
    found.set(key, { written: digits, value: Number(key) * scale(match[1]) });
  }
  return found;
}

function scale(word: string | undefined): number {
  const w = word?.toLowerCase();
  if (w === 'million' || w === 'mil' || w === 'm') return 1_000_000;
  if (w === 'thousand' || w === 'k') return 1_000;
  return 1;
}

/** The text without the agency's numbers, and which of them it had. */
function withoutAgency(text: string): { rest: string; agency: Set<number> } {
  const agency = new Set<number>();
  let rest = text;
  AGENCY.forEach((pattern, i) => {
    rest = rest.replace(pattern, () => {
      agency.add(i);
      return ' ';
    });
  });
  return { rest, agency };
}

export function numberChanges(original: string, reword: string): NumberChanges {
  const before = withoutAgency(original.normalize('NFKC'));
  const after = withoutAgency(reword.normalize('NFKC'));
  const was = numbersIn(before.rest);
  const now = numbersIn(after.rest);
  const values = [...was.values()].map((n) => n.value).filter((v) => Number.isFinite(v) && v > 0);
  return {
    added: [...now]
      .filter(([key, n]) => !was.has(key) && !workedOut(n.value, values))
      .map(([, n]) => n.written),
    missing: [
      ...[...was].filter(([key]) => !now.has(key)).map(([, n]) => n.written),
      ...[...before.agency].filter((i) => !after.agency.has(i)).map((i) => AGENCY_NUMBERS[i] ?? ''),
    ],
  };
}

/** Whether `value` is two of the original's numbers divided or multiplied, rounded as a person would. */
function workedOut(value: number, values: readonly number[]): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  const near = (sum: number) => Math.abs(sum - value) <= Math.max(0.01, sum * 0.005);
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values.length; j++) {
      if (i === j) continue;
      const a = values[i] as number;
      const b = values[j] as number;
      if (near(a / b) || (i < j && near(a * b))) return true;
    }
  }
  return false;
}

/** Why the reword may not be posted, as a sentence; null when it may. */
export function rewordProblem(original: string, reword: string, checks: readonly CheckResult[]): string | null {
  const { added, missing } = numberChanges(original, reword);
  if (added.length > 0 || missing.length > 0) {
    const parts = [
      added.length > 0 ? `adds ${list(added)}` : null,
      missing.length > 0 ? `leaves out ${list(missing)}` : null,
    ].filter((p) => p !== null);
    return `It changes the numbers: it ${parts.join(' and ')}.`;
  }
  const failed = checks.find((c) => c.status === 'fail');
  if (failed) return `${failed.name}: ${failed.detail}.`;
  return null;
}

function list(numbers: readonly string[]): string {
  const quoted = numbers.slice(0, 3).map((n) => `“${n}”`);
  const more = numbers.length - quoted.length;
  return more > 0 ? `${quoted.join(', ')} and ${more} more` : quoted.join(numbers.length === 2 ? ' and ' : ', ');
}
