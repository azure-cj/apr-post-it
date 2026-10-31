/**
 * Matches property names the way people type them: case, punctuation, accents, "&"
 * and the usual abbreviations (Blk, Lt, Ph, Bldg) don't matter, and small typos get
 * a suggestion — but never one with a different lot or unit number.
 *
 * Ported from PostIt.Core/Rules/PropertyNameMatcher.cs.
 */

export type NameMatch =
  | { readonly kind: 'exact'; readonly name: string }
  | { readonly kind: 'suggestion'; readonly name: string }
  | { readonly kind: 'notFound' };

const SUGGESTION_THRESHOLD = 0.75;

// A Map rather than an object literal, so that a name containing the word
// "constructor" cannot pick up Object.prototype.constructor.
const ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ['blk', 'block'],
  ['lt', 'lot'],
  ['ph', 'phase'],
  ['bldg', 'building'],
]);

// .NET tests one UTF-16 unit at a time, so a character outside the BMP (𝗳𝗮𝗻𝗰𝘆
// text) is never a letter, digit or combining mark to it.
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{Nd}]|[\u{10000}-\u{10FFFF}]/gu;
const COMBINING_MARK = /(?![\u{10000}-\u{10FFFF}])\p{Mn}/gu;
// .NET's \d is any decimal digit, not only 0-9.
const DIGIT_RUN = /\p{Nd}+/gu;

/** "Sunrise Homes Blk. 3, Lt 9" → "sunrise homes block 3 lot 9". */
export function normalize(name: string): string {
  const text = removeAccents(name.toLowerCase())
    .replaceAll('&', ' and ')
    .replaceAll("'", '')
    .replaceAll('’', '');
  return text
    .replace(NOT_LETTER_OR_DIGIT, ' ')
    .split(' ')
    .filter((token) => token !== '')
    .map((token) => ABBREVIATIONS.get(token) ?? token)
    .join(' ');
}

/** The exact match after normalising, else the best fuzzy suggestion, else notFound. */
export function matchName(typed: string, names: readonly string[]): NameMatch {
  const target = normalize(typed);
  if (target === '') return { kind: 'notFound' };

  const candidates = names.map((name) => ({ name, key: normalize(name) }));
  const exact = candidates.find((c) => c.key === target);
  if (exact) return { kind: 'exact', name: exact.name };

  let best: string | undefined;
  let bestScore = 0;
  for (const c of candidates) {
    const score = similarity(target, c.key);
    // Strictly greater: a tie goes to the name listed first.
    if (score > bestScore) [best, bestScore] = [c.name, score];
  }
  return best !== undefined && bestScore >= SUGGESTION_THRESHOLD
    ? { kind: 'suggestion', name: best }
    : { kind: 'notFound' };
}

function similarity(typed: string, candidate: string): number {
  const maxLength = Math.max(typed.length, candidate.length);
  let score = maxLength === 0 ? 1 : 1 - levenshtein(typed, candidate) / maxLength;

  const candidateTokens = new Set(candidate.split(' '));
  if (typed.split(' ').every((token) => candidateTokens.has(token))) score = Math.max(score, 0.9);

  // The numeric guard. Lot 13 is a different lot from Lot 12 however alike the
  // rest of the name is, and 0.6 keeps even a perfect score below the threshold.
  if (!sameNumbers(typed, candidate)) score *= 0.6;
  return score;
}

// Leading zeros are ignored because "Lot 07" is Lot 7.
function sameNumbers(a: string, b: string): boolean {
  const x = numbers(a);
  const y = numbers(b);
  return x.length === y.length && x.every((n, i) => n === y[i]);
}

function numbers(s: string): string[] {
  return Array.from(s.matchAll(DIGIT_RUN), (m) => m[0].replace(/^0+/, ''));
}

/** Edit distance in UTF-16 code units, as the C# measured it. */
function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  let current = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length]!;
}

function removeAccents(s: string): string {
  return s.normalize('NFD').replace(COMBINING_MARK, '').normalize('NFC');
}
