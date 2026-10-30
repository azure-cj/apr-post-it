/**
 * Where a listing's postable text ends. THE ONE PLACE this is decided.
 *
 * Used unchanged by:
 *   - BuildDirectory.gs, writing the directory sheet
 *   - Code.gs, re-reading a document live when a property is opened
 *   - the desktop app, which links this file at build time
 *
 * Pure JavaScript with no Apps Script services, so it runs in all three. Never
 * copy this logic. A second copy that drifts is exactly how owner details
 * reached interns once already: the directory had the full rules and the live
 * re-read still had an older list that missed 93% of the library (D13).
 *
 * The documents do not agree on one separator. Across 1,474 listings: '---' in
 * 1,079, '__' in 124, '===' in 93, a bar of box-drawing characters in 45, and a
 * bare heading such as '1 MONTH STANDARD COMMISSION' in 54. So every known
 * marker is checked and the text is cut at whichever comes first (D5).
 */

/**
 * Splits a document into what may be posted and what may not.
 *
 * Returns { posting, internal, found, cutAt }. When nothing is found the whole
 * document is in `posting` and `found` is false: nobody has separated it yet,
 * so none of it is confirmed safe (D6).
 */
function splitAtSeparator_(text) {
  // NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR are line breaks too. JS's \s
  // does not include NEL, so a marker on a line begun by one would slip past.
  var raw = String(text == null ? '' : text).replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n');
  var lines = raw.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var kind = markerKind_(lines[i]);
    if (!kind) continue;

    // A divider or a bare label ("=== INTERNAL ===", "[Do not post]") carries
    // nothing, so the private part starts after it. A line that says something
    // ("1 MONTH STANDARD COMMISSION", "Owner Name: Cruz") is private content a
    // manager should still see.
    var skipMarkerLine = isDividerKind_(kind) || isBareLabel_(lines[i]);
    return {
      posting: lines.slice(0, i).join('\n').trim(),
      internal: lines.slice(skipMarkerLine ? i + 1 : i).join('\n').trim(),
      found: true,
      cutAt: kind,
    };
  }

  // Underscores running into the text rather than sitting on their own line.
  var inline = raw.search(/_{2,}/);
  if (inline !== -1) {
    return {
      posting: raw.slice(0, inline).trim(),
      internal: raw.slice(inline).replace(/^_+/, '').trim(),
      found: true,
      cutAt: 'inline __',
    };
  }
  return { posting: raw.trim(), internal: '', found: false, cutAt: '' };
}

/**
 * True when a marker line is only a label: once its decoration and the marker
 * words are taken away, nothing is left. "agent's" is listed before "agents?",
 * or "agents?" takes the "Agent" and leaves "'s" behind. "Commission" and "owner" are not
 * among those words, so a line naming the commission or the owner is never
 * treated as a bare label.
 */
function isBareLabel_(line) {
  var rest = String(line == null ? '' : line)
    .replace(/\b(internal|notes?|only|for|use|agent['\u2019]s|agents?|do|not|post|posting)\b/gi, '')
    .replace(/[^A-Za-z0-9]+/g, '');
  return rest === '';
}

/**
 * The four divider kinds. A heading's kind is 'heading: ' plus its own text,
 * which can itself end in "line" ("Owner hotline", "Commission: 3% online"),
 * so the kinds are listed rather than matched on a pattern.
 */
function isDividerKind_(kind) {
  return kind === '__ line' || kind === 'bar line' || kind === 'equals line' || kind === '--- line';
}

/** What kind of marker a line is, or '' when it is ordinary text. */
function markerKind_(line) {
  var s = String(line == null ? '' : line);

  // Divider lines. A label beginning '=' would be a formula to Sheets (D7), so
  // the equals case is named in words.
  if (/^\s*_{2,}\s*$/.test(s))                    return '__ line';
  if (/^\s*[\u2500-\u257F]{3,}\s*$/.test(s))      return 'bar line';
  if (/^\s*[=~]{3,}\s*$/.test(s))                 return 'equals line';
  if (/^\s*[-\u2013\u2014]{3,}\s*$/.test(s))      return '--- line';

  // A broker-only heading. Any decoration may come first, emoji bullets
  // included (a pin emoji, then "Owner: Juan"). The words are the union of what the
  // real library uses and what the C# prototype recognised. Listing copy that
  // merely starts with one of them is let through: "Internal area: 120 sqm",
  // "Owner financing available" and "Owner-occupied" are things to post.
  if (/^[^A-Za-z0-9]*(owner(?![-\s]+(occupied|financ|managed))|internal(?!\s+(area|floor|size|space|dimensions?|measurements?))|for\s+internal(\s+use)?|commissions?|net\s+to\s+owner|net\s+price|for\s+agents?(\s+only)?|agent['\u2019]?s?\s+notes?|do\s+not\s+post|not\s+for\s+posting)\b/i
        .test(s)) {
    return 'heading: ' + s.trim().replace(/\s+/g, ' ').slice(0, 40);
  }
  // "1 MONTH STANDARD COMMISSION" and friends: a short all-caps line naming it.
  if (/^[^a-z]{0,60}\b(COMMISSIONS?|NET TO OWNER|OWNER['\u2019]?S? (DETAILS|INFO))\b/.test(s.trim())) {
    return 'heading: ' + s.trim().replace(/\s+/g, ' ').slice(0, 40);
  }

  // Broker terms do not always sit under a heading. "Sale: 3-5% Commission"
  // begins with "Sale", so matching only the start of a line let 21 through.
  // Anywhere in the line counts: cutting a line too early is recoverable, and
  // publishing the owner's terms is not.
  if (/\b(commissions?|net\s+to\s+owner|net\s+price)\b/i.test(s)) return 'mentions commission';

  // Google Docs types a curly apostrophe by default, so "owner's" is matched
  // either way.
  if (/\bowner['\u2019]?s?\s*(name|contact|number|mobile|viber)\b/i.test(s)) return 'mentions the owner';

  // "Call the owner at 0917 123 4567" names no name, contact or number, but a
  // line that mentions the owner and carries a mobile number is the owner's.
  if (/\bowner\b(?![-\s]+(occupied|financ|managed))/i.test(s) &&
      /(?:\+?63|\b0)9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}/.test(s)) {
    return 'mentions the owner';
  }
  return '';
}
