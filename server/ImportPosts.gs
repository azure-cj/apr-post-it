/**
 * ImportPosts.gs: a one-off. The interns' posts from before Post-It, kept on
 * their own "POSTING TRACKER - INTERNS" sheet (one tab per intern), are copied
 * onto the tracker's Posts tab, so the cooldown, the link check and the records
 * carry on from them. The interns' sheet is only read: nothing on it changes.
 *
 * Run from the Apps Script editor, never from the app:
 *
 *   1. Set IMPORT.SOURCE_SHEET_ID below to the interns' sheet's id (the long
 *      part of its link, between /d/ and /edit).
 *   2. Run PREVIEW_IMPORT. It writes, on the tracker's "Import preview" tab,
 *      who each tab is credited to, every row it would add, and every row it
 *      skips and why. Nothing else is written.
 *   3. Check it. A tab credited to the wrong person, or to nobody on the team:
 *      set its name in IMPORT.NAMES and run PREVIEW_IMPORT again.
 *   4. Run RUN_IMPORT. It adds the rows to Posts, oldest first. Run again, it
 *      adds nothing twice: a post already on Posts is left out.
 *
 * Each intern tab is read as the interns keep it, which differs from tab to
 * tab: a header row with a title column (Property title, or Place) and a Link
 * column, found by its name or, failing that, by the Facebook links below it;
 * a tab with no header row at all read in the template's order; the day
 * written once beside the day's rows, and a merged cell's value read on every
 * row it covers; and the day written as each intern writes it ("08|14/2026",
 * "Sept. 1, 2026", "March 03", or day first, "15/09/2025", on a tab that
 * writes them so). A row is imported when it is marked posted (Posted,
 * Shared, Done, a ticked box) or pending; or when it is not marked either way
 * (no Status column, a blank, a word like "Post") and holds a Facebook link:
 * a post's link exists only once it is posted. A row marked not posted (Not
 * Shared, Limit, Archived) is left, link or not, and the rest are counted,
 * by what they are marked. A row marked posted with no link is added too,
 * its Link left empty, so the record of what was posted is whole. A row
 * marked pending is saved as Posted: it was months ago, and a Pending post
 * waits in its agent's My queue until someone marks it.
 *
 * Where a tab's header and its rows disagree, the rows win: the day is read
 * from the column holding days (a tab with two "Column 1"s), a header one
 * column off its rows is lined up by its Link column, and a Status column
 * with no name is found by the Posted and Pending in it.
 */

const IMPORT = {
  // The interns' "POSTING TRACKER - INTERNS" sheet. Only read.
  SOURCE_SHEET_ID: '1xzzuq8KHbzrRIGMyIo0AQVgq0LQklDkW8-S9Y__7RvM',
  // Tabs that are not an intern's.
  SKIP_TABS: ['(KEEP BLANK)'],
  // A tab's name -> the person it is credited to, exactly as the app names
  // them ('Christopher': 'Christopher Reyes'). Only for a tab the preview
  // credits wrongly: the rest are matched to the Team tab by first name.
  NAMES: {},
  PREVIEW_TAB: 'Import preview',
};

// The interns' headers, lower case, spaces single, without a trailing ":".
// A column is found by one of these names first, then by a name containing
// the field's word (IMPORT_HEADER_WORDS).
const IMPORT_HEADERS = {
  title:     ['property title', 'title', 'place', 'property', 'property name', 'listing'],
  postLink:  ['link', 'post link', 'fb link', 'links', 'facebook link'],
  date:      ['date', 'column 1', 'date scheduled/posted', 'mm/dd/yyyy', 'date posted', 'day'],
  time:      ['time posted', 'time', 'time scheduled/posted'],
  status:    ['share posting', 'status', 'share posting status', 'posting status'],
  fbAccount: ['fb account name', 'fb account', 'facebook name', 'facebook account', 'fb name', 'account'],
  type:      ['property type', 'type'],
};
const IMPORT_HEADER_WORDS = {
  title: ['title'], postLink: ['link'], date: ['date'], time: ['time'], status: ['status', 'share'],
  fbAccount: ['account', 'facebook'], type: ['type'],
};
// The template's order, for a tab with no header row (or Sheets' "Column 1",
// "Column 2"... of a table nobody named).
const IMPORT_TEMPLATE = { date: 0, type: 1, title: 2, fbAccount: 3, postLink: 4, time: 5, status: 6 };
// How far down a header row is looked for.
const IMPORT_HEADER_DEPTH = 30;

const IMPORT_FACEBOOK = /(?:facebook\.com|fb\.com|fb\.me|fb\.watch)\//i;
const IMPORT_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
                       'october', 'november', 'december'];

/** Writes what RUN_IMPORT would do on the Import preview tab. Changes nothing else. */
function PREVIEW_IMPORT() {
  var plan = importPlan_();
  writeImportPreview_(plan);
  logImportSummary_(plan, 'Preview');
  return importSummary_(plan);
}

/** Adds the interns' posts to the Posts tab, oldest first. A post already there is left out. */
function RUN_IMPORT() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Someone is saving a post. Run RUN_IMPORT again in a minute.');
  try {
    // Planned under the lock, so a post logged meanwhile is not added twice.
    var plan = importPlan_();
    appendImported_(plan.add);
    logImportSummary_(plan, 'Imported');
    return importSummary_(plan);
  } finally {
    lock.releaseLock();
  }
}

/**
 * What the import would do: { tabs, add, skip, notPosted }. `add` holds the
 * Posts rows, oldest first; `skip` the rows left out, each with its reason.
 */
function importPlan_() {
  var id = textOf_(IMPORT.SOURCE_SHEET_ID).trim();
  if (!id) throw new Error('Set IMPORT.SOURCE_SHEET_ID in ImportPosts.gs to the interns\' sheet\'s id first.');
  var source = SpreadsheetApp.openById(id);

  var people = importPeople_();
  var listings = importListings_();
  var today = today_();
  var seen = {};
  readRows_(CONFIG.POSTS_TAB, POST_FIELDS).forEach(function (p) {
    seen[importKey_(p)] = 'already on ' + CONFIG.POSTS_TAB;
  });

  var plan = { tabs: [], add: [], skip: [], notPosted: 0 };
  source.getSheets().forEach(function (sh, tabIndex) {
    // "Kurt " is Kurt: a space typed after a tab's name is not part of the name.
    var tab = sh.getName().trim();
    if (IMPORT.SKIP_TABS.indexOf(tab) !== -1) return;
    var credit = creditFor_(tab, people);
    var summary = {
      tab: tab, postedBy: credit.name, note: credit.note, add: 0, skip: 0, why: {}, unreadDay: '',
      layout: '', notPosted: 0, marked: {}, byLink: 0, noLink: 0, pending: 0, sample: '', header: '',
    };
    plan.tabs.push(summary);

    var values = importValues_(sh);
    var head = importHeaderRow_(values);
    if (!head) {
      summary.note = 'no header row with Property title and Link, so not read. ' + firstRowOf_(values);
      return;
    }
    summary.layout = head.layout;
    summary.header = head.row >= 0 && head.layout.indexOf('no header') !== 0 ? importRowWords_(values[head.row], head.row) : '';
    var tz = zoneOf_(sh);
    var dayFirst = importDayFirst_(values, head);
    var day = '', lastDay = '';
    for (var r = head.row + 1; r < values.length; r++) {
      var cells = values[r];
      var cell = function (field) { return head.col[field] === -1 ? '' : cells[head.col[field]]; };
      var title = textOf_(cell('title')).trim();
      // The header again, further down (a tab that starts each month afresh).
      if (head.titleName && title.toLowerCase() === head.titleName) continue;

      // The day is written once, beside the day's rows: it holds until the next one.
      var written = cell('date');
      if (textOf_(written).trim()) {
        day = importDay_(written, tz, today, dayFirst, lastDay);
        if (day) lastDay = day;
        if (!day && !summary.unreadDay && !importMonthOf_(textOf_(written))) summary.unreadDay = textOf_(written).trim();
      }

      // A link typed a column over is still the row's link.
      var link = textOf_(cell('postLink')).trim();
      if (!IMPORT_FACEBOOK.test(link)) link = importRowLink_(cells, head.col.title) || (/^https?:/i.test(link) ? link : '');
      if (!title && !link) continue;
      var status = head.col.status === -1 ? '' : importStatus_(cell('status'));
      if (!status && IMPORT_FACEBOOK.test(link)) {
        status = /pending/i.test(link) ? 'Pending' : 'Posted';
        summary.byLink++;
      }
      if (status !== 'Posted' && status !== 'Pending') {
        if (!summary.sample) summary.sample = importRowWords_(cells, r);
        plan.notPosted++;
        summary.notPosted++;
        var word = head.col.status === -1 ? 'no Status column'
          : textOf_(cell('status')).trim() ? '"' + textOf_(cell('status')).trim() + '"' : 'blank';
        var mark = summary.marked[word] = summary.marked[word] || { rows: 0, links: 0 };
        mark.rows++;
        if (IMPORT_FACEBOOK.test(link)) mark.links++;
        continue;
      }
      var at = { tab: tab, row: r + 1, tabIndex: tabIndex };
      // Marked posted with no link: added, its Link empty.
      if (!link) summary.noLink++;
      // Pending months ago: saved as Posted, so it is not waiting in anyone's My queue.
      if (status === 'Pending') {
        summary.pending++;
        status = 'Posted';
      }
      var reason = !title ? 'no property title' : !day ? 'no date it can read' : '';
      var post = reason ? null : importPost_(day, title, link, status, cell, tz, credit.name, listings);
      if (post) {
        var key = importKey_(post);
        if (seen[key]) reason = seen[key];
        else seen[key] = 'the same post as ' + tab + ' row ' + (r + 1);
      }
      if (reason) {
        if (!summary.sample) summary.sample = importRowWords_(cells, r);
        plan.skip.push({ at: at, reason: reason, title: title, link: link, day: day });
        summary.skip++;
        var kind = reason.indexOf('the same post as') === 0 ? 'the same post twice' : reason;
        summary.why[kind] = (summary.why[kind] || 0) + 1;
      } else {
        plan.add.push({ at: at, post: post });
        summary.add++;
      }
    }
  });

  plan.add.sort(function (a, b) {
    return a.post.date.localeCompare(b.post.date) ||
           sheetTime_(a.post.time).localeCompare(sheetTime_(b.post.time)) ||
           a.at.tabIndex - b.at.tabIndex || a.at.row - b.at.row;
  });
  return plan;
}

/**
 * A tab's values, a merged cell's value on every row and column it covers: a
 * day, or a title posted to several groups, is often one cell merged down
 * the rows it is for, and Sheets gives its value to the first row only.
 */
function importValues_(sh) {
  var range = sh.getDataRange();
  var values = range.getValues();
  range.getMergedRanges().forEach(function (m) {
    var r0 = m.getRow() - 1, c0 = m.getColumn() - 1;
    if (!values[r0]) return;
    var value = values[r0][c0];
    for (var r = r0; r < Math.min(r0 + m.getNumRows(), values.length); r++) {
      for (var c = c0; c < Math.min(c0 + m.getNumColumns(), values[r].length); c++) values[r][c] = value;
    }
  });
  return values;
}

/** One Posts row from an intern's row, filled in as logPost fills it. */
function importPost_(day, title, link, status, cell, tz, postedBy, listings) {
  var ids = listings[normalizeName_(title)] || [];
  var listing = ids.length === 1 ? ids[0] : null;
  var type = textOf_(cell('type')).trim();
  var time = cellText_(cell('time'), tz, 'time').trim();
  return {
    date:       day,
    type:       type || (listing ? propertyType_(listing.category) : ''),
    title:      title,
    fbAccount:  textOf_(cell('fbAccount')).trim(),
    postLink:   link,
    time:       /^\d{2}:\d{2}$/.test(time) ? clockTime_(time) : time,
    status:     status,
    postedBy:   postedBy,
    propertyId: listing ? listing.id : '',
    fbGroup:    postGroup_(link),
  };
}

/**
 * Posted, Pending, Not Shared, or '' when it is not marked either way (blank,
 * or a word that says neither). A ticked box is Posted.
 */
function importStatus_(value) {
  var s = textOf_(value).trim().toLowerCase().replace(/[.!\s]+$/, '');
  if (!s) return '';
  if (/^(not|un|no\b|to post|cancel|declin|reject|remov|delet|fail|false$|limit|archiv|draft|hold|skip)/.test(s)) return NOT_SHARED;
  if (/^(pending|sched|for approval|waiting|queued)/.test(s)) return 'Pending';
  if (/^(posted|shared|done|published|approved|live|yes|true$|ok\b|success|✓|✔|✅)/.test(s)) return 'Posted';
  return '';
}

/**
 * The same post, however its link was copied. A link that is not one post's
 * (a group's "pending posts" page) can stand for many: then the day, the
 * listing and who posted it say which.
 */
function importKey_(p) {
  var key = postKey_(p.postLink);
  if (key) return 'post:' + key;
  return 'row:' + sheetDay_(p.date) + '|' + normalizeName_(p.title) + '|' + textOf_(p.postedBy).trim() + '|' +
         textOf_(p.postLink).trim();
}

function importHeaderName_(h) {
  return textOf_(h).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*:$/, '');
}

/**
 * The header row (0-based) and each field's column: { row, col, titleName,
 * layout }, or null when the tab has none it can read. A row with a title
 * column is the header; its Link column is the one named so, or else the
 * column below it holding the most Facebook links. A table of "Column 1",
 * "Column 2"..., or a tab whose rows start at once with the template's
 * columns (its fifth a Facebook link), is read in the template's order.
 */
function importHeaderRow_(values) {
  var depth = Math.min(values.length, IMPORT_HEADER_DEPTH);
  for (var r = 0; r < depth; r++) {
    var names = values[r].map(importHeaderName_);
    if (names[0] === 'column 1' && names[1] === 'column 2') {
      return { row: r, col: importTemplate_(), titleName: '', layout: 'read in the template\'s order' };
    }
    var col = importColumns_(names);
    if (col.title === -1) continue;
    if (col.postLink === -1) col.postLink = importLinkColumn_(values, r + 1, col);
    else importLineUp_(values, r + 1, col);
    if (col.postLink === -1) continue;
    if (col.date === -1 && Object.keys(col).every(function (f) { return col[f] !== 0; })) col.date = 0;
    importDayColumn_(values, r + 1, col);
    if (col.status === -1) col.status = importStatusColumn_(values, r + 1, col);
    return { row: r, col: col, titleName: names[col.title], layout: '' };
  }
  // No header row: rows that start at once in the template's order.
  for (var d = 0; d < depth; d++) {
    if (IMPORT_FACEBOOK.test(textOf_(values[d][IMPORT_TEMPLATE.postLink]))) {
      return { row: d - 1, col: importTemplate_(), titleName: '', layout: 'no header row: read in the template\'s order' };
    }
  }
  return null;
}

/** How many cells of column `c`, from row `from` down, pass `test`. */
function importCount_(values, from, c, test) {
  var n = 0;
  for (var r = from; r < values.length; r++) {
    if (c >= 0 && c < values[r].length && test(values[r][c])) n++;
  }
  return n;
}

function importIsLink_(v) { return IMPORT_FACEBOOK.test(textOf_(v)); }

function importIsDay_(v) {
  // Not a time of day, which Sheets keeps on 30 Dec 1899.
  if (v instanceof Date) return !isNaN(v.getTime()) && Utilities.formatDate(v, CONFIG.TZ, 'yyyy') > '1900';
  var t = textOf_(v).trim();
  return !!(t && (importNumericDay_(t) || sheetDay_(t)));
}

function importIsStatus_(v) { return importStatus_(v) !== ''; }

/**
 * A header one or two columns off its rows (John's: every value a column left
 * of its name): when a column that near holds far more Facebook links than the
 * Link column, every named column moves by as much.
 */
function importLineUp_(values, from, col) {
  var here = importCount_(values, from, col.postLink, importIsLink_);
  var best = 0, shift = 0;
  [-2, -1, 1, 2].forEach(function (d) {
    var n = importCount_(values, from, col.postLink + d, importIsLink_);
    if (n > best) { best = n; shift = d; }
  });
  if (best < 3 || best <= 2 * here) return;
  Object.keys(col).forEach(function (f) {
    if (col[f] !== -1 && col[f] + shift >= 0) col[f] += shift;
  });
}

/** The day's column: of the date column and those no field has, the one holding the most days. */
function importDayColumn_(values, from, col) {
  var taken = {};
  Object.keys(col).forEach(function (f) { if (f !== 'date' && col[f] !== -1) taken[col[f]] = true; });
  var best = importCount_(values, from, col.date, importIsDay_);
  var width = values[from - 1] ? values[from - 1].length : 0;
  for (var c = 0; c < width; c++) {
    if (taken[c] || c === col.date) continue;
    var n = importCount_(values, from, c, importIsDay_);
    if (n > best) { best = n; col.date = c; }
  }
}

/** A Status column with no name: the column no field has holding the most Posted, Pending or Not Shared (3 at least). */
function importStatusColumn_(values, from, col) {
  var taken = {};
  Object.keys(col).forEach(function (f) { if (col[f] !== -1) taken[col[f]] = true; });
  var width = 0;
  for (var r = from; r < values.length; r++) width = Math.max(width, values[r].length);
  var best = -1, most = 2;
  for (var c = 0; c < width; c++) {
    if (taken[c]) continue;
    var n = importCount_(values, from, c, importIsStatus_);
    if (n > most) { most = n; best = c; }
  }
  return best;
}

function importTemplate_() {
  var col = {};
  Object.keys(IMPORT_HEADERS).forEach(function (f) {
    col[f] = Object.prototype.hasOwnProperty.call(IMPORT_TEMPLATE, f) ? IMPORT_TEMPLATE[f] : -1;
  });
  return col;
}

/** Each field's column in a header row: a name it is known by first, then a name containing its word. */
function importColumns_(names) {
  var col = {}, used = {};
  var fields = Object.keys(IMPORT_HEADERS);
  fields.forEach(function (f) {
    col[f] = -1;
    IMPORT_HEADERS[f].some(function (h) {
      var c = names.indexOf(h);
      if (c !== -1 && !used[c]) { col[f] = c; used[c] = true; }
      return col[f] !== -1;
    });
  });
  fields.forEach(function (f) {
    if (col[f] !== -1) return;
    for (var c = 0; c < names.length && col[f] === -1; c++) {
      if (used[c] || !names[c]) continue;
      if (IMPORT_HEADER_WORDS[f].some(function (w) { return names[c].indexOf(w) !== -1; })) {
        col[f] = c;
        used[c] = true;
      }
    }
  });
  return col;
}

/** The column, not already some field's, holding the most Facebook links from `from` down; -1 when none. */
function importLinkColumn_(values, from, col) {
  var taken = {};
  Object.keys(col).forEach(function (f) { if (col[f] !== -1) taken[col[f]] = true; });
  var counts = {};
  for (var r = from; r < values.length; r++) {
    values[r].forEach(function (v, c) {
      if (!taken[c] && IMPORT_FACEBOOK.test(textOf_(v))) counts[c] = (counts[c] || 0) + 1;
    });
  }
  var best = -1;
  Object.keys(counts).forEach(function (c) { if (best === -1 || counts[c] > counts[best]) best = Number(c); });
  return best;
}

/**
 * A day as the interns write it, or a date cell: yyyy-MM-dd, or '' when it is
 * not one. "10/26/26", "08|14/2026", "06/ 16/ 2026", "03/30,2026", "03/024/26",
 * "8/112026" (the year run into the day), "Sept. 1, 2026", and "March 03",
 * whose year is the latest that is not after `today`, and "Sched 13", the
 * 13th after `lastDay`, the day read last on the tab.
 */
function importDay_(value, tz, today, dayFirst, lastDay) {
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  // "03/30/2026'": a quote typed before or after is not part of the day, nor
  // "Sched" before it.
  var text = textOf_(value).trim().replace(/^['"`\s]+|['"`\s]+$/g, '').replace(/^sched(?:uled?)?\.?\s*/i, '');
  if (!text) return '';
  var n = importNumericDay_(text);
  if (n) {
    var first = Number(n[1]), second = Number(n[2]);
    return dayFirst || first > 12 ? calendarDay_(n[3], second, first) : calendarDay_(n[3], first, second);
  }
  var known = sheetDay_(text);
  if (known) return known;

  var m = /^([a-z]+)\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?$/i.exec(text);
  var month = m ? importMonthOf_(m[1]) : 0;
  if (month) {
    var dayOfMonth = Number(m[2]);
    if (m[3]) return calendarDay_(Number(m[3]), month, dayOfMonth);
    var year = Number(textOf_(today).slice(0, 4));
    var guess = calendarDay_(year, month, dayOfMonth);
    return guess && guess > today ? calendarDay_(year - 1, month, dayOfMonth) : guess;
  }

  // "Sched 3/01", "3/01": no year. The year of the day read before it (the
  // next, when the month is half a year behind it), else the latest that is
  // not after today.
  m = /^(\d{1,2})\s*[\/|.\-]\s*(\d{1,2})$/.exec(text);
  if (m) {
    var a = Number(m[1]), b = Number(m[2]);
    var mon = dayFirst || a > 12 ? b : a, dd = dayFirst || a > 12 ? a : b;
    if (lastDay) {
      var yr = Number(lastDay.slice(0, 4));
      if (mon < Number(lastDay.slice(5, 7)) - 6) yr++;
      return calendarDay_(yr, mon, dd);
    }
    var thisYear = Number(textOf_(today).slice(0, 4));
    var near = calendarDay_(thisYear, mon, dd);
    return near && near > today ? calendarDay_(thisYear - 1, mon, dd) : near;
  }

  // "Sched 13", or "13": the 13th of the month of the day read before it, or
  // of the next month when the 13th has gone by.
  m = /^(\d{1,2})(?:st|nd|rd|th)?$/i.exec(text);
  if (m && lastDay) {
    var y = Number(lastDay.slice(0, 4)), mo = Number(lastDay.slice(5, 7)), d = Number(m[1]);
    if (d < Number(lastDay.slice(8, 10))) {
      mo++;
      if (mo > 12) { mo = 1; y++; }
    }
    return calendarDay_(y, mo, d);
  }
  return '';
}

var IMPORT_DAY_SEP = '\\s*[\\/|.,\\-]\\s*';
var IMPORT_NUMERIC_DAY = new RegExp('^(\\d{1,2})' + IMPORT_DAY_SEP + '(\\d{1,3})' + IMPORT_DAY_SEP + '(\\d{4}|\\d{2})$');
// The year run into the day: "8/112026".
var IMPORT_RUN_ON_DAY = new RegExp('^(\\d{1,2})' + IMPORT_DAY_SEP + '(\\d{1,2})(20\\d{2})$');

/** [text, first, second, year] for a day written in numbers, else null. */
function importNumericDay_(text) {
  var m = IMPORT_NUMERIC_DAY.exec(text) || IMPORT_RUN_ON_DAY.exec(text);
  return m ? [m[0], m[1], m[2], importYear_(m[3])] : null;
}

/**
 * True for a tab that writes its days day first, "15/09/2025": one of its
 * days begins past 12, and none has a second number past 12.
 */
function importDayFirst_(values, head) {
  if (head.col.date === -1) return false;
  var past12 = false;
  for (var r = head.row + 1; r < values.length; r++) {
    var n = importNumericDay_(textOf_(values[r][head.col.date]).trim());
    if (!n) continue;
    if (Number(n[2]) > 12 && Number(n[2]) <= 31) return false;
    if (Number(n[1]) > 12) past12 = true;
  }
  return past12;
}

/** The first Facebook link anywhere in a row but the title's cell; '' when none. */
function importRowLink_(cells, titleCol) {
  for (var c = 0; c < cells.length; c++) {
    if (c !== titleCol && IMPORT_FACEBOOK.test(textOf_(cells[c]))) return textOf_(cells[c]).trim();
  }
  return '';
}

/** 'row 12: "a | b | c"', a row's cells as the preview shows them. */
function importRowWords_(cells, r) {
  var shown = cells.map(function (v) {
    var t = v instanceof Date ? Utilities.formatDate(v, CONFIG.TZ, 'yyyy-MM-dd HH:mm') : textOf_(v).trim();
    return t.length > 40 ? t.slice(0, 40) + '...' : t;
  });
  while (shown.length && !shown[shown.length - 1]) shown.pop();
  return 'row ' + (r + 1) + ': "' + shown.slice(0, 9).join(' | ') + '"';
}

function importYear_(written) {
  return written.length === 2 ? 2000 + Number(written) : Number(written);
}

/** 1 to 12 for a month's name or its start ("Sept", "FEB"), else 0. */
function importMonthOf_(word) {
  var w = textOf_(word).trim().toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return 0;
  for (var i = 0; i < IMPORT_MONTHS.length; i++) {
    if (IMPORT_MONTHS[i].indexOf(w) === 0) return i + 1;
  }
  return 0;
}

/** Everyone on the Team tab, left ones included: their posts are theirs. */
function importPeople_() {
  return teamRows_()
    .map(function (t) { return textOf_(t.Name).trim(); })
    .filter(String);
}

/** The Directory's listings by normalized name: { name: [{ id, category }] }. */
function importListings_() {
  var out = {};
  directoryRows_().forEach(function (d) {
    var key = normalizeName_(d.name);
    (out[key] = out[key] || []).push({ id: d.id, category: d.category });
  });
  return out;
}

/**
 * Who a tab's posts are credited to: IMPORT.NAMES first; then the one person
 * whose name begins with the tab's ("Christopher" -> "Christopher Reyes",
 * "Ar-jee" -> "Arjee Santos", but "Prince" is not "Princess"); else the tab's
 * own name, with a note to set it.
 */
function creditFor_(tab, people) {
  if (Object.prototype.hasOwnProperty.call(IMPORT.NAMES, tab)) {
    return { name: textOf_(IMPORT.NAMES[tab]).trim(), note: 'set in IMPORT.NAMES' };
  }
  var want = normalizeName_(tab).split(' ').join('');
  var matches = people.filter(function (name) {
    var words = normalizeName_(name).split(' ');
    for (var k = 1; k <= words.length; k++) {
      if (words.slice(0, k).join('') === want) return true;
    }
    return false;
  });
  if (matches.length === 1) return { name: matches[0], note: 'matched on the Team tab' };
  var why = matches.length ? 'more than one on the Team tab (' + matches.join(', ') + ')' : 'nobody on the Team tab';
  return { name: tab, note: why + ': credited as "' + tab + '". Set it in IMPORT.NAMES.' };
}

/** What a tab without a header row starts with, so the preview can say why it was not read. */
function firstRowOf_(values) {
  var shown = [];
  for (var r = 0; r < Math.min(values.length, IMPORT_HEADER_DEPTH) && shown.length < 2; r++) {
    var cells = values[r].map(function (v) {
      var t = textOf_(v).trim();
      return t.length > 40 ? t.slice(0, 40) + '...' : t;
    }).filter(String);
    if (cells.length) shown.push('"' + cells.slice(0, 8).join(' | ') + '"');
  }
  if (!shown.length) return 'The tab is empty.';
  return (shown.length === 1 ? 'Its first row: ' : 'Its first rows: ') + shown.join(', then ') + '.';
}

/**
 * "4 to add, 3 skipped (2 no link, 1 already on Posts). 9 not imported for
 * their status ("Not Shared" 8, blank 1 (1 with a link))", with a day it
 * could not read when there was one.
 */
function tabWords_(t) {
  var why = Object.keys(t.why).map(function (k) { return t.why[k] + ' ' + k; });
  var notes = [];
  if (t.byLink) notes.push(t.byLink + ' not marked, posted by their link');
  if (t.noLink) notes.push(t.noLink + ' with no link');
  if (t.pending) notes.push(t.pending + ' Pending, saved as Posted');
  var words = t.add + ' to add' + (notes.length ? ' (' + notes.join('; ') + ')' : '') + ', ' +
              t.skip + ' skipped' + (why.length ? ' (' + why.join(', ') + ')' : '') + '.';
  if (t.notPosted) {
    var marks = Object.keys(t.marked || {}).sort(function (a, b) { return t.marked[b].rows - t.marked[a].rows; });
    words += ' ' + t.notPosted + ' not imported for their status (' + marks.slice(0, 4).map(function (k) {
      var m = t.marked[k];
      return k + ' ' + m.rows + (m.links ? ', ' + m.links + ' with a link' : '');
    }).join('; ') + (marks.length > 4 ? '; ...' : '') + ').';
  }
  if (t.unreadDay) words += ' A day it could not read: "' + t.unreadDay + '".';
  if (t.layout) words += ' ' + t.layout.charAt(0).toUpperCase() + t.layout.slice(1) + '.';
  // As much left out as added: what the tab looks like, so its layout can be read.
  if (t.sample && t.add <= t.skip + t.notPosted) {
    words += ' Header ' + (t.header || 'none') + '. First row left out, ' + t.sample + '.';
  }
  return words + ' ' + t.note;
}

const IMPORT_PREVIEW_HEADERS = ['Action', 'Why', 'From tab', 'From row'];

/** The Import preview tab, written afresh: each tab's credit, then each row added, then each skipped. */
function writeImportPreview_(plan) {
  var postHeaders = Object.keys(POST_FIELDS).map(function (f) { return POST_FIELDS[f].headers[0]; });
  var rows = [IMPORT_PREVIEW_HEADERS.concat(postHeaders)];
  var blank = postHeaders.map(function () { return ''; });
  plan.tabs.forEach(function (t) {
    rows.push(['Tab', tabWords_(t), t.tab, '']
      .concat(blank.slice(0, 7), [t.postedBy], blank.slice(8)));
  });
  plan.add.forEach(function (a) {
    rows.push(['Add', '', a.at.tab, String(a.at.row)].concat(Object.keys(POST_FIELDS).map(function (f) {
      return textOf_(a.post[f]);
    })));
  });
  plan.skip.forEach(function (s) {
    rows.push(['Skip', s.reason, s.at.tab, String(s.at.row), s.day, '', s.title, '', s.link].concat(blank.slice(5)));
  });

  var ss = book_();
  var sh = ss.getSheetByName(IMPORT.PREVIEW_TAB) || ss.insertSheet(IMPORT.PREVIEW_TAB);
  if (sh.getLastRow() > 0) sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).clearContent();
  var width = rows[0].length;
  if (rows.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length - sh.getMaxRows());
  if (width > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  var range = sh.getRange(1, 1, rows.length, width);
  range.setNumberFormat('@');
  range.setValues(rows);
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
  sh.setFrozenRows(1);
}

/** The rows below Posts' last, each value in the column Posts keeps it in, as plain text. */
function appendImported_(add) {
  if (!add.length) return;
  if (add.some(function (a) { return a.post.fbGroup; })) ensurePostColumn_('fbGroup');
  var sh = sheetFor_(CONFIG.POSTS_TAB, POST_FIELDS);
  var col = columnsOf_(sh, POST_FIELDS);
  var width = Math.max(sh.getLastColumn(), 1);
  var rows = add.map(function (a) {
    var row = new Array(width).fill('');
    Object.keys(POST_FIELDS).forEach(function (f) {
      if (col[f] !== -1) row[col[f]] = textOf_(a.post[f]);
    });
    return row;
  });
  var first = sh.getLastRow() + 1;
  var last = first + rows.length - 1;
  if (last > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), last - sh.getMaxRows());
  Object.keys(POST_FIELDS).forEach(function (f) {
    if (col[f] !== -1) sh.getRange(first, col[f] + 1, rows.length, 1).setNumberFormat('@');
  });
  sh.getRange(first, 1, rows.length, width).setValues(rows);
}

function importSummary_(plan) {
  return {
    added: plan.add.length,
    skipped: plan.skip.length,
    notPosted: plan.notPosted,
    tabs: plan.tabs.map(function (t) {
      return {
        tab: t.tab, postedBy: t.postedBy, add: t.add, skip: t.skip, why: t.why, note: t.note,
        notPosted: t.notPosted, marked: t.marked, layout: t.layout, byLink: t.byLink, noLink: t.noLink, pending: t.pending,
      };
    }),
  };
}

function logImportSummary_(plan, what) {
  Logger.log(what + ': ' + plan.add.length + ' posts to add, ' + plan.skip.length + ' skipped, ' +
             plan.notPosted + ' rows not imported for their status.');
  plan.tabs.forEach(function (t) {
    Logger.log('  ' + t.tab + ' -> ' + t.postedBy + ': ' + tabWords_(t));
  });
}
