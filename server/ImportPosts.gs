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
 * Each intern tab is read as the interns keep it: a header row with Property
 * title and Link; the day in the first column, written once beside the day's
 * rows (a merged cell gives its value to its first row only); blank rows
 * between days; and rows not posted yet marked "Not Shared".
 */

const IMPORT = {
  // The interns' "POSTING TRACKER - INTERNS" sheet. Only read.
  SOURCE_SHEET_ID: '',
  // Tabs that are not an intern's.
  SKIP_TABS: ['(KEEP BLANK)'],
  // A tab's name -> the person it is credited to, exactly as the app names
  // them ('Christopher': 'Christopher Reyes'). Only for a tab the preview
  // credits wrongly: the rest are matched to the Team tab by first name.
  NAMES: {},
  PREVIEW_TAB: 'Import preview',
};

// The interns' headers, as found in their sheet, lower case, without a trailing ":".
const IMPORT_HEADERS = {
  date:      ['date', 'column 1'],
  type:      ['property type'],
  title:     ['property title'],
  fbAccount: ['fb account name', 'fb account'],
  postLink:  ['link'],
  time:      ['time posted', 'time'],
  status:    ['share posting', 'status'],
};

const IMPORT_US_SHORT_DAY = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/;

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
  var seen = {};
  readRows_(CONFIG.POSTS_TAB, POST_FIELDS).forEach(function (p) {
    seen[importKey_(p)] = 'already on ' + CONFIG.POSTS_TAB;
  });

  var plan = { tabs: [], add: [], skip: [], notPosted: 0 };
  source.getSheets().forEach(function (sh, tabIndex) {
    var tab = sh.getName();
    if (IMPORT.SKIP_TABS.indexOf(tab) !== -1) return;
    var credit = creditFor_(tab, people);
    var summary = { tab: tab, postedBy: credit.name, note: credit.note, add: 0, skip: 0 };
    plan.tabs.push(summary);

    var values = sh.getDataRange().getValues();
    var head = importHeaderRow_(values);
    if (!head) {
      summary.note = 'no header row with Property title and Link: not read';
      return;
    }
    var tz = zoneOf_(sh);
    var day = '';
    for (var r = head.row + 1; r < values.length; r++) {
      var cells = values[r];
      var cell = function (field) { return head.col[field] === -1 ? '' : cells[head.col[field]]; };
      // The day is written once, beside the day's rows: it holds until the next one.
      var written = cell('date');
      if (textOf_(written).trim()) day = importDay_(written, tz);

      var title = textOf_(cell('title')).trim();
      var link = textOf_(cell('postLink')).trim();
      var status = queueStatus_(cell('status'));
      if (status === NOT_SHARED) {
        if (title || link) plan.notPosted++;
        continue;
      }
      var at = { tab: tab, row: r + 1, tabIndex: tabIndex };
      var reason = !title ? 'no property title' : !link ? 'no link' : !day ? 'no date it can read' : '';
      var post = reason ? null : importPost_(day, title, link, status, cell, tz, credit.name, listings);
      if (post) {
        var key = importKey_(post);
        if (seen[key]) reason = seen[key];
        else seen[key] = 'the same post as ' + tab + ' row ' + (r + 1);
      }
      if (reason) {
        plan.skip.push({ at: at, reason: reason, title: title, link: link, day: day });
        summary.skip++;
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

/** The header row (0-based) and each field's column, or null when the tab has none in its first 10 rows. */
function importHeaderRow_(values) {
  for (var r = 0; r < Math.min(values.length, 10); r++) {
    var names = values[r].map(function (h) { return textOf_(h).trim().toLowerCase().replace(/\s*:$/, ''); });
    if (names.indexOf('property title') === -1 || names.indexOf('link') === -1) continue;
    var col = {};
    Object.keys(IMPORT_HEADERS).forEach(function (f) {
      col[f] = -1;
      IMPORT_HEADERS[f].some(function (h) { col[f] = names.indexOf(h); return col[f] !== -1; });
    });
    // The interns' day column has no name of its own: the first.
    if (col.date === -1) col.date = 0;
    return { row: r, col: col };
  }
  return null;
}

/** A day as the interns write it, "10/26/26", or a date cell: yyyy-MM-dd, or '' when it is not one. */
function importDay_(value, tz) {
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  var text = textOf_(value).trim();
  var m = IMPORT_US_SHORT_DAY.exec(text);
  if (m) return calendarDay_(2000 + Number(m[3]), Number(m[1]), Number(m[2]));
  return sheetDay_(text);
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

const IMPORT_PREVIEW_HEADERS = ['Action', 'Why', 'From tab', 'From row'];

/** The Import preview tab, written afresh: each tab's credit, then each row added, then each skipped. */
function writeImportPreview_(plan) {
  var postHeaders = Object.keys(POST_FIELDS).map(function (f) { return POST_FIELDS[f].headers[0]; });
  var rows = [IMPORT_PREVIEW_HEADERS.concat(postHeaders)];
  var blank = postHeaders.map(function () { return ''; });
  plan.tabs.forEach(function (t) {
    rows.push(['Tab', t.add + ' to add, ' + t.skip + ' skipped. ' + t.note, t.tab, '']
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
    tabs: plan.tabs.map(function (t) { return { tab: t.tab, postedBy: t.postedBy, add: t.add, skip: t.skip, note: t.note }; }),
  };
}

function logImportSummary_(plan, what) {
  Logger.log('%s: %s posts to add, %s skipped, %s rows not posted (Not Shared).',
             what, plan.add.length, plan.skip.length, plan.notPosted);
  plan.tabs.forEach(function (t) {
    Logger.log('  %s -> %s: %s to add, %s skipped. %s', t.tab, t.postedBy, t.add, t.skip, t.note);
  });
}
