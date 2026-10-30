/**
 * Splits a posting document into the text that may be posted and the internal
 * notes that must never be.
 *
 * - A leading block of `Category:` / `Type:` / `Location:` lines is metadata, not
 *   posting text.
 * - The first line that looks like an internal marker (`=== INTERNAL — DO NOT POST ===`,
 *   `--- Internal notes ---`, `[Do not post]`…) starts the internal part. Only the
 *   first counts: cutting early costs a line of the post, cutting late leaks (D5).
 *
 * Ported from PostIt.Core/Rules/PostingTextParser.cs, markers and all. The server
 * splits the real library (D1) and also cuts at bare `---`, `__`, `===` and `━━━`
 * lines and at commission headings (D5); this, like the C#, does not.
 *
 * The patterns are .NET's, translated where JS would read them differently; see
 * the notes beside each.
 */

export interface PostingText {
  readonly publicText: string;
  /** Everything after the first internal marker. Empty when there is none. */
  readonly internalText: string;
  /** False when no marker was found: then none of the text is confirmed safe to post (D6). */
  readonly hasInternal: boolean;
  /** From a leading `Category:` or `Type:` line. */
  readonly category?: string;
  /** From a leading `Location:` line. */
  readonly location?: string;
}

// .NET's \s. JS's also matches U+FEFF and misses U+0085.
const S = String.raw`[\t-\r\x85\p{Z}]`;

// .NET's \b counts every letter, combining mark, digit and connector as part of a
// word, and the two zero-width joiners too. JS's \b knows only [A-Za-z0-9_], even
// with the u flag, so "\b" is spelled out as "not followed by one of these". .NET
// reads one UTF-16 unit at a time and so never sees a character outside the BMP
// (𝗳𝗮𝗻𝗰𝘆 text) as a letter; the lookahead holds JS to the same.
const WORD_END = String.raw`(?!(?=[\0-\u{FFFF}])[\p{L}\p{Mn}\p{Nd}\p{Pc}\u{200C}\u{200D}])`;

// .NET's "." is [^\n]; JS's also stops at \r, U+2028 and U+2029.
const METADATA_LINE = new RegExp(
  String.raw`^${S}*(?<key>category|type|location)${S}*:${S}*(?<value>[^\n]*?)${S}*$`,
  'iu',
);

// Under the i flag JS also lets ſ (long s) stand for s, which .NET does not; the
// difference only ever cuts earlier.
const INTERNAL_MARKER = new RegExp(
  String.raw`^${S}*[=\-#*_~>\[\(]*${S}*` +
    String.raw`(?:internal|for internal use|internal notes?|internal only|agent['’]?s?${S}+notes?` +
    String.raw`|do not post|not for posting|for agents only)${WORD_END}`,
  'iu',
);

const BLANK = new RegExp(String.raw`^${S}*$`, 'u');
const SPACE = new RegExp(S, 'u');

/** Parses the raw text of a posting document: any line endings, optional byte-order mark. */
export function parsePostingText(raw: string | null | undefined): PostingText {
  const lines = (raw ?? '').replace(/^\u{FEFF}+/u, '').split(/\r\n?|\n/);

  const { category, location, bodyStart } = readMetadata(lines);

  const markerAt = lines.findIndex((line, i) => i >= bodyStart && INTERNAL_MARKER.test(line));
  const publicLines = lines.slice(bodyStart, markerAt < 0 ? lines.length : markerAt);
  const internalLines = markerAt < 0 ? [] : lines.slice(markerAt + 1);

  return {
    publicText: tidy(publicLines),
    internalText: tidy(internalLines),
    hasInternal: markerAt >= 0,
    ...(category === undefined ? {} : { category }),
    ...(location === undefined ? {} : { location }),
  };
}

function readMetadata(lines: readonly string[]) {
  let category: string | undefined;
  let location: string | undefined;
  let bodyStart = 0;
  for (const [i, line] of lines.entries()) {
    if (BLANK.test(line)) continue;
    const m = METADATA_LINE.exec(line);
    if (!m) break;

    const value = m.groups?.value ?? '';
    if (value !== '') {
      if (m.groups?.key?.toLowerCase() === 'location') location ??= value;
      else category ??= value;
    }
    bodyStart = i + 1;
  }
  return { category, location, bodyStart };
}

function tidy(lines: readonly string[]): string {
  const kept: string[] = [];
  for (const line of lines.map(trimEnd)) {
    if (line === '' && (kept.length === 0 || kept.at(-1) === '')) continue;
    kept.push(line);
  }
  if (kept.at(-1) === '') kept.pop();
  return kept.join('\n');
}

// A loop, not /\s+$/: that regex backtracks quadratically through a long run of
// spaces in the middle of a line.
function trimEnd(line: string): string {
  let end = line.length;
  while (end > 0 && SPACE.test(line.charAt(end - 1))) end--;
  return line.slice(0, end);
}
