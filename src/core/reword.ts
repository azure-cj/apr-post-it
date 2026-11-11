/**
 * Whether a reword from Claude (AID-129) may be posted in place of the
 * original. Claude is told to keep every fact and add none; this holds it to
 * that for the facts most easily changed by mistake, the numbers: a price, a
 * size, a phone number, a floor. The pre-post checks run on the reword too
 * (runChecks), so commission wording that slipped in still blocks Copy.
 */

import type { CheckResult } from './types';

/** The numbers a reword added and the ones it left out, as written ("4,200,000" and "4200000" are one). */
export interface NumberChanges {
  readonly added: readonly string[];
  readonly missing: readonly string[];
}

// Digit runs, with the commas and points inside them. Matched on an NFKC copy,
// so 𝟰.𝟮 and ４.２ are read as 4.2.
const NUMBER = /\d+(?:[.,]\d+)*/g;

function numbersIn(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [written] of text.normalize('NFKC').matchAll(NUMBER)) {
    const key = written.replace(/,/g, '');
    if (!found.has(key)) found.set(key, written);
  }
  return found;
}

export function numberChanges(original: string, reword: string): NumberChanges {
  const before = numbersIn(original);
  const after = numbersIn(reword);
  return {
    added: [...after].filter(([key]) => !before.has(key)).map(([, written]) => written),
    missing: [...before].filter(([key]) => !after.has(key)).map(([, written]) => written),
  };
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
