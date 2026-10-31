/**
 * Splits a posting document into the text that may be posted and the part that
 * must never be.
 *
 * A leading block of `Category:` / `Type:` / `Location:` lines is metadata, not
 * posting text, and is read here. **Where the postable text ends is not decided
 * here.** It is decided once, in `server/Separators.gs`, which the
 * directory builder and the web app also use, linked in at build time (D13).
 *
 * Do not add a marker list to this file. A second list that drifted from the
 * server's is exactly how owner details once reached interns: the directory had
 * the full rules, the live re-read had an older list, and 93% of the library
 * went through the gap.
 */

import { splitAtSeparator_ } from '@server/Separators.gs';

export interface PostingText {
  readonly publicText: string;
  /** Everything after the first internal marker. Empty when there is none. */
  readonly internalText: string;
  /** False when no marker was found: then none of the text is confirmed safe to post (D6). */
  readonly hasInternal: boolean;
  /** Which marker the cut was made at, for auditing ("--- line", "heading: …"). '' when none. */
  readonly cutAt: string;
  /** From a leading `Category:` or `Type:` line. */
  readonly category?: string;
  /** From a leading `Location:` line. */
  readonly location?: string;
}

// .NET's \s. JS's also matches U+FEFF and misses U+0085.
const S = String.raw`[\t-\r\x85\p{Z}]`;


// .NET's "." is [^\n]; JS's also stops at \r, U+2028 and U+2029.
const METADATA_LINE = new RegExp(
  String.raw`^${S}*(?<key>category|type|location)${S}*:${S}*(?<value>[^\n]*?)${S}*$`,
  'iu',
);


const BLANK = new RegExp(String.raw`^${S}*$`, 'u');
const SPACE = new RegExp(S, 'u');

/** Parses the raw text of a posting document: any line endings, optional byte-order mark. */
export function parsePostingText(raw: string | null | undefined): PostingText {
  const lines = (raw ?? '').replace(/^\u{FEFF}+/u, '').split(/\r\n?|\n/);

  const { category, location, bodyStart } = readMetadata(lines);

  const cut = splitAtSeparator_(lines.slice(bodyStart).join('\n'));

  return {
    publicText: tidy(cut.posting.split('\n')),
    internalText: tidy(cut.internal.split('\n')),
    hasInternal: cut.found,
    cutAt: cut.cutAt,
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
