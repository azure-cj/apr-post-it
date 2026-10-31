/**
 * APG Post-It — Google Drive + Sheets backend.
 *
 * A single Apps Script web app that the desktop app talks to over HTTPS.
 * The script runs as the owner, so interns never need Drive access and never
 * receive the internal section of a posting doc.
 *
 * It shares one Apps Script project with Separators.gs, which it requires, and
 * BuildDirectory.gs. Apps Script gives every file in a project one global
 * scope: a top-level name declared in two of them breaks the project or
 * silently replaces the other. src/server-tests loads them the same way.
 *
 * Deploy: see README.md next to this file.
 */

// ---------------------------------------------------------------- config

const CONFIG = {
  // The directory spreadsheet built by BuildDirectory.gs. This script does not
  // walk Drive at all: searching reads one sheet instead of hundreds of folders.
  DIRECTORY_SHEET_ID: '1jelzICcu6rmR-mQqK7tGD19VieN6B4Y2L6fNaMMkjTs',
  DIRECTORY_TAB: 'Directory',

  // The company tracker. Leave blank only when this script is bound to it.
  TRACKER_SHEET_ID: '',

  // A SEPARATE, PRIVATE spreadsheet for the Team tab, which holds everyone's
  // key. It must not live in a sheet the team can open: anyone who can read an
  // admin's key can act as that admin. Leave blank only if the tracker
  // itself is private to you.
  ADMIN_SHEET_ID: '',

  // Tab names in that spreadsheet. POSTS_TAB must match the real one.
  POSTS_TAB: 'Posts',
  ASSIGNMENTS_TAB: 'Assignments',

  // Long random string. The client sends it on every call. Never commit the real one.
  SHARED_KEY: '',

  COOLDOWN_DAYS: 7,
  TZ: 'Asia/Manila',
};

// Where the postable text ends is decided in Separators.gs, which this project
// must also contain. Do not add a marker list here (D13).

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME    = 'application/vnd.google-apps.document';
const PHOTO_MIME  = /^image\/(jpeg|png|webp|gif)$/;
const DOC_NAME    = /\.(docx?|txt|md)$/i;

const TEAM_HEADERS   = ['Name', 'Email', 'Role', 'Key', 'FB Accounts', 'Active'];
const ROLES = ['Intern', 'Admin'];

// What each role may call. Admin may call anything.
// Two roles. The Admin assigns the postings and sees everything; an Intern posts.
// A Team row that still says "Manager" (the old middle role) counts as Admin.
const PERMISSIONS = {
  Intern:  ['ping', 'properties', 'property', 'posts', 'assignments', 'logPost', 'addLink', 'setStatus'],
  Admin:   ['*'],
};


// ---------------------------------------------------------------- routing

function doGet(e)  { return route(e.parameter || {}); }
function doPost(e) { return route(parseBody(e)); }

function parseBody(e) {
  var body = {};
  try {
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch (err) { /* fall through to query parameters */ }
  return Object.assign({}, e && e.parameter, body);
}

function route(req) {
  try {
    var me = identify(req.key);
    if (!me) return json({ ok: false, error: 'unauthorized', message: 'This copy of Post-It is not registered. Ask your admin for a key.' });
    if (!allowed(me.role, req.action)) {
      return json({ ok: false, error: 'forbidden', message: 'Your account cannot do that.' });
    }
    switch (req.action) {
      case 'ping':        return json({ ok: true, name: me.name, role: me.role, fbAccounts: me.fbAccounts, time: now() });
      case 'properties':  return json({ ok: true, properties: listProperties() });
      case 'property':    return json({ ok: true, property: getProperty(req.id, me.canSeeInternal) });
      case 'posts':       return json({ ok: true, posts: mine(me, readRows(CONFIG.POSTS_TAB, POST_FIELDS), 'postedBy') });
      case 'assignments': return json({ ok: true, assignments: mine(me, readRows(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS), 'assignedTo') });
      case 'team':        return json({ ok: true, team: teamList() });
      case 'logPost':     return json(logPost(req, me));
      case 'addLink':     return json(addLink(req, me));
      case 'saveQueue':   return json(saveQueue(req, me));
      case 'setStatus':   return json(setStatus(req, me));
      default:            return json({ ok: false, error: 'unknown action: ' + req.action });
    }
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- identity
//
// Every person gets their own key, listed on the Team tab. The key is how the
// script knows who is calling, so a role is enforced here rather than being a
// suggestion the client is trusted to honour. Revoking somebody is a matter of
// setting Active to FALSE.

function identify(key) {
  if (!key) return null;
  var team = teamRows();

  if (!team.length) {
    // Nothing set up yet: CONFIG.SHARED_KEY is a temporary admin key so you can
    // add the first people. It stops working once Team has a row.
    return (CONFIG.SHARED_KEY && key === CONFIG.SHARED_KEY)
      ? { name: 'Setup', email: '', role: 'Admin', fbAccounts: [], canSeeInternal: true }
      : null;
  }

  var row = team.filter(function (t) {
    return String(t.Key) === String(key) && String(t.Active).toUpperCase() !== 'FALSE';
  })[0];
  if (!row) return null;

  var role = roleOf_(row.Role);
  return {
    // Text, as every tracker value is (readRows): Posted By is matched with ===.
    name: textOf_(row.Name),
    email: row.Email,
    role: role,
    fbAccounts: String(row['FB Accounts'] || '').split(',').map(function (x) { return x.trim(); }).filter(String),
    canSeeInternal: role !== 'Intern',
  };
}

/** "Admin" or "Manager" (old name) is Admin; anything else, blank included, is Intern. */
function roleOf_(value) {
  var v = String(value || '').trim().toLowerCase();
  return (v === 'admin' || v === 'manager') ? 'Admin' : 'Intern';
}

/** The Team tab, cached for a minute so a key check is not a sheet read. */
function teamRows() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('team');
  if (hit) return JSON.parse(hit);
  var rows = readSheet('Team', TEAM_HEADERS);
  try { cache.put('team', JSON.stringify(rows), 60); } catch (e) { /* ignore */ }
  return rows;
}

/**
 * The Team tab for the app's screens: Admin only (PERMISSIONS). Built field by
 * field so the Key column can never come along with a row. Revoked people are
 * included, with active: false.
 */
function teamList() {
  return teamRows()
    .filter(function (t) { return textOf_(t.Name).trim(); })
    .map(function (t) {
      return {
        name: textOf_(t.Name),
        role: roleOf_(t.Role),
        email: textOf_(t.Email),
        fbAccounts: textOf_(t['FB Accounts']).split(',').map(function (x) { return x.trim(); }).filter(String),
        active: String(t.Active).toUpperCase() !== 'FALSE',
      };
    });
}

function allowed(role, action) {
  var list = PERMISSIONS[role] || [];
  return list.indexOf('*') !== -1 || list.indexOf(action) !== -1;
}

/** Interns see their own tracker rows and nobody else's. */
function mine(me, rows, column) {
  if (me.role !== 'Intern') return rows;
  return rows.filter(function (r) { return r[column] === me.name; });
}

/** Admin helper: add a person and hand back their key. */
function addTeamMember(name, email, role, fbAccounts) {
  var key = Utilities.getUuid().replace(/-/g, '');
  // As text, like every row this script writes (D7): a key of digits would
  // otherwise come back a number, and a name beginning "=" would be a formula.
  appendText_(plainTab('Team', TEAM_HEADERS),
              [name, email || '', role || 'Intern', key, fbAccounts || '', 'TRUE'].map(textOf_),
              [0, 1, 2, 3, 4, 5]);
  CacheService.getScriptCache().remove('team');
  return key;
}

// ---------------------------------------------------------------- the directory
//
// BuildDirectory.gs walks Drive on a schedule and writes one row per property.
// This script only reads that sheet, so a search is a single read rather than
// hundreds of Drive calls. Columns are found by header name, as with the
// tracker, so the sheet can be rearranged without breaking anything.

const DIRECTORY_FIELDS = {
  category:    { headers: ['Category'], required: true },
  listingType: { headers: ['Listing type'] },
  subCategory: { headers: ['Sub-category'] },
  name:        { headers: ['Property'], required: true },
  folder:      { headers: ['Folder'] },
  photoCount:  { headers: ['Photos'] },
  photoLinks:  { headers: ['Photo links'] },
  postingText: { headers: ['Posting text'] },
  cutAt:       { headers: ['Cut at'] },
  hasOwner:    { headers: ['Owner section'] },
  issues:      { headers: ['Issues'] },
  id:          { headers: ['FolderId'], required: true },
  docId:       { headers: ['DocId'] },
};

function directoryBook() {
  return CONFIG.DIRECTORY_SHEET_ID
    ? SpreadsheetApp.openById(CONFIG.DIRECTORY_SHEET_ID)
    : book();
}

/** Every property, cached for a minute so a burst of calls is one read. */
function directoryRows() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('dir');
  if (hit) return JSON.parse(hit);

  var sh = directoryBook().getSheetByName(CONFIG.DIRECTORY_TAB);
  if (!sh) {
    throw new Error('No "' + CONFIG.DIRECTORY_TAB + '" tab. Run BuildDirectory.gs first.');
  }
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  var col = columnsIn_(values[0], DIRECTORY_FIELDS, sh.getName());
  var tz = zoneOf_(sh);
  var out = values.slice(1)
    .filter(function (r) { return r[col.id]; })
    .map(function (r) { return fieldsOf_(r, DIRECTORY_FIELDS, col, tz); });

  try { cache.put('dir', JSON.stringify(out), 60); } catch (e) { /* too big to cache */ }
  return out;
}

/** Property name for a folder id. */
function nameOf(propertyId) {
  var row = directoryRows().filter(function (r) { return r.id === propertyId; })[0];
  return row ? row.name : '';
}

/** Folder id for a property name, so the client may send either. */
function idOf(propertyName) {
  var want = String(propertyName || '').trim().toLowerCase();
  var row = directoryRows().filter(function (r) {
    return String(r.name).trim().toLowerCase() === want;
  })[0];
  return row ? row.id : '';
}

// ---------------------------------------------------------------- properties

/** The search list: small, no document text. */
function listProperties() {
  return directoryRows().map(function (r) {
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      listingType: r.listingType,
      subCategory: r.subCategory,
      photoCount: Number(r.photoCount) || 0,
      hasIssues: !!String(r.issues || '').trim(),
    };
  });
}

/**
 * One property.
 *
 * The document is re-read live when it can be, so a typo corrected in Drive a
 * moment ago is already gone — the sheet is only as fresh as the last nightly
 * rebuild. The sheet's text is the fallback when there is no document id or the
 * read fails.
 *
 * includeInternal is decided by role, not by the client. For an intern the
 * internal half is never put in the reply at all.
 */
function getProperty(id, includeInternal) {
  // First, and outside the try below: without the one splitter every live
  // re-read would fail and quietly fall back to the sheet's copy.
  requireSeparators_();

  var row = directoryRows().filter(function (r) { return r.id === id; })[0];
  if (!row) throw new Error('property not found: ' + id);

  // The sheet's copy was already cut by BuildDirectory.gs; it is the fallback.
  var publicText = String(row.postingText || '');
  var internalText = '';
  var separated = row.hasOwner === 'Yes';
  var cutAt = String(row.cutAt || '');
  var live = false;

  if (row.docId) {
    try {
      // The same splitter the directory uses (Separators.gs), never a copy of
      // it. A second, older list here once missed 93% of the library (D13).
      var cut = splitAtSeparator_(readDoc(row.docId, DOC_MIME));
      publicText = cut.posting;
      internalText = cut.internal;
      separated = cut.found;
      cutAt = cut.cutAt;
      live = true;
    } catch (e) {
      // Fall back to the sheet's copy rather than failing the whole screen.
    }
  }

  // Nobody has separated this document, so none of it is confirmed safe.
  // Blocking the Copy button is not enough: the text can still be selected and
  // copied by hand. An intern is not sent it at all; a manager is, to fix it.
  if (!separated && !includeInternal) {
    publicText = '';
  }

  var photos = String(row.photoLinks || '')
    .split(/[\n,]/)
    .map(function (u) { return u.trim(); })
    .filter(function (u) { return u; })
    .map(function (u, i) {
      var m = u.match(/[?&]id=([^&]+)/);
      return {
        id: m ? m[1] : String(i),
        name: 'photo ' + (i + 1),
        url: u,
        thumb: m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w640' : '',
      };
    });

  var out = {
    id: row.id,
    name: row.name,
    category: row.category,
    listingType: row.listingType,
    subCategory: row.subCategory,
    folder: row.folder,
    publicText: publicText,
    hasInternal: separated,
    // True when the text was withheld because nobody has separated it yet, so
    // the screen can say why it is empty rather than look broken.
    withheld: !separated && !includeInternal,
    // A heading's label quotes the heading ("heading: Commission: 3%"), which
    // is the internal section's first line. An intern is told the kind only.
    cutAt: includeInternal ? cutAt : cutAt.split(':')[0],
    issues: row.issues,
    live: live,
    photos: photos,
  };
  if (includeInternal) out.internalText = internalText;
  return out;
}

/** Separators.gs must be in this project: it is where the postable text ends (D13). */
function requireSeparators_() {
  if (typeof splitAtSeparator_ !== 'function') {
    throw new Error('Separators.gs is missing from this Apps Script project. It decides where a ' +
                    'listing\'s postable text ends: add it beside Code.gs and deploy again.');
  }
}

function readDoc(fileId, mimeType) {
  if (mimeType === DOC_MIME) return docToText(DocumentApp.openById(fileId));
  if (mimeType === 'text/plain') return DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  return docToText(DocumentApp.openById(fileId));
}

/**
 * getBody().getText() drops bullet glyphs and runs table cells together, which
 * ruins a feature list, so walk the body instead.
 */
function docToText(doc) {
  var body = doc.getBody(), counters = {}, out = [];
  for (var i = 0; i < body.getNumChildren(); i++) out.push(elementText(body.getChild(i), counters));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function elementText(el, counters) {
  var T = DocumentApp.ElementType, type = el.getType();

  if (type === T.LIST_ITEM) {
    var level = el.getNestingLevel(), marker = '•';
    if (el.getGlyphType() === DocumentApp.GlyphType.NUMBER) {
      var key = el.getListId() + ':' + level;
      counters[key] = (counters[key] || 0) + 1;
      marker = counters[key] + '.';
    }
    return new Array(level + 1).join('   ') + marker + ' ' + el.getText();
  }
  if (type === T.TABLE) {
    var rows = [];
    for (var r = 0; r < el.getNumRows(); r++) {
      var row = el.getRow(r), cells = [];
      for (var c = 0; c < row.getNumCells(); c++) cells.push(row.getCell(c).getText().trim());
      cells = cells.filter(String);
      rows.push(cells.length === 2 ? cells[0].replace(/:$/, '') + ': ' + cells[1] : cells.join('  '));
    }
    return rows.join('\n');
  }
  if (type === T.HORIZONTAL_RULE || type === T.PAGE_BREAK) return '';
  return el.getText ? el.getText() : '';
}

// ---------------------------------------------------------------- posting
//
// The cooldown is enforced here, under a lock. Two interns clicking Save on
// the same property at the same time cannot both get through.

function logPost(req, me) {
  requireAll(req, ['property', 'propertyId', 'fbAccount']);

  // Who the row is credited to comes from the key, not from the request, so an
  // intern cannot log a post against somebody else's name. A manager may log on
  // an intern's behalf.
  var postedBy = (me.role !== 'Intern' && req.postedBy) ? req.postedBy : me.name;

  if (me.fbAccounts.length && me.fbAccounts.indexOf(req.fbAccount) === -1) {
    return { ok: false, error: 'forbidden', message: 'You are not assigned to ' + req.fbAccount + '.' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'Someone else is saving. Try again.' };
  try {
    // One reading of the clock for the check and the row, so the two cannot
    // fall either side of midnight.
    var when = new Date();
    var guard = cooldownFor(req.propertyId, req.property, when);
    if (guard) return guard;

    var link = String(req.postLink || '').trim();
    var status = link ? 'Posted' : 'Pending';
    var date = Utilities.formatDate(when, CONFIG.TZ, 'yyyy-MM-dd');
    var time = Utilities.formatDate(when, CONFIG.TZ, 'HH:mm');

    appendRow(CONFIG.POSTS_TAB, POST_FIELDS, {
      date:       date,
      type:       req.type || 'Group post',
      title:      req.property,
      time:       time,
      status:     status,
      fbAccount:  req.fbAccount,
      postLink:   link,
      postedBy:   postedBy,
      propertyId: req.propertyId,
    });
    setAssignmentStatus(req.propertyId, req.property, postedBy, status);
    // The row as written. The app shows these, never its own clock or user.
    return { ok: true, status: status, date: date, time: time, postedBy: postedBy };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Returns a refusal object when the property is inside its cooldown, else null.
 *
 * The app applies the same rule before it asks (src/core/cooldown.ts), and
 * the two must agree:
 *
 * - Every row counts, Pending as much as Posted: a post still waiting for its
 *   link must stop a second intern posting the same listing. The app reads any
 *   status but Pending as Posted, so no row is left out there either.
 * - A row is the property's when the folder ids agree, if both have one, so a
 *   renamed folder keeps its history; otherwise when the names agree as the
 *   app's matcher normalises them.
 * - Days are calendar days in Manila. Counting 24-hour spans from UTC midnight
 *   refused until 08:00 on the day the app said posting was allowed again.
 * - A date the app cannot read is skipped, as the app skips it.
 */
function cooldownFor(propertyId, propertyName, when) {
  var key = normalizeName_(propertyName);
  var latest = '';
  readRows(CONFIG.POSTS_TAB, POST_FIELDS).forEach(function (p) {
    if (!sameProperty_(p.propertyId, p.title, propertyId, key)) return;
    var day = sheetDay_(p.date);
    if (day && day > latest) latest = day;
  });
  if (!latest) return null;

  var last = dayNumber_(latest);
  var today = dayNumber_(Utilities.formatDate(when || new Date(), CONFIG.TZ, 'yyyy-MM-dd'));
  // A row dated after today, from a skewed clock, counts as posted today.
  var daysAgo = Math.max(0, today - last);
  if (daysAgo >= CONFIG.COOLDOWN_DAYS) return null;

  var next = last + CONFIG.COOLDOWN_DAYS;
  return {
    ok: false,
    error: 'cooldown',
    lastPosted:  latest,
    nextAllowed: isoDay_(next),
    // The app's own sentence for the same refusal (cooldown.ts).
    message: 'Posted ' + ago_(daysAgo) + ' (' + dayMonth_(last) + '). The cooldown is ' +
             days_(CONFIG.COOLDOWN_DAYS) + ' \u{2014} it can be posted again on ' + fullDate_(next) + '.',
  };
}

/** Turn a Pending row into Posted once the live link exists. */
function addLink(req, me) {
  requireAll(req, ['postLink']);
  if (!req.propertyId && !req.property) throw new Error('missing: property');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var sh = sheetFor(CONFIG.POSTS_TAB, POST_FIELDS);
    var values = sh.getDataRange().getValues();
    var col = columnsIn_(values[0], POST_FIELDS, sh.getName());
    var tz = zoneOf_(sh);

    // By folder id when both the row and the request have one, otherwise by
    // name: rows logged before the PropertyId column was added have no id.
    var name = req.property || nameOf(req.propertyId);
    var id = req.propertyId || idOf(name);
    var key = normalizeName_(name) || null;   // a blank name finds no row by name

    for (var r = values.length - 1; r >= 1; r--) {
      var p = fieldsOf_(values[r], POST_FIELDS, col, tz);
      if (!sameProperty_(p.propertyId, p.title, id, key)) continue;
      if (postStatus_(p.status) !== 'Pending') continue;
      if (me.role === 'Intern' && p.postedBy !== me.name) continue;  // not yours

      setText_(sh.getRange(r + 1, col.status + 1), 'Posted');
      setText_(sh.getRange(r + 1, col.postLink + 1), String(req.postLink).trim());
      setAssignmentStatus(id, name, p.postedBy, 'Posted');
      return { ok: true, row: r + 1 };
    }
    return { ok: false, error: 'notfound', message: 'No pending post for that property.' };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- which property a row is
//
// The app decides these the same way (cooldown.ts, matcher.ts, tracker.ts),
// and the tests in src/server-tests hold the two to agreeing.

const NAME_ABBREVIATIONS = { blk: 'block', lt: 'lot', ph: 'phase', bldg: 'building' };

/**
 * Whether a tracker row is about the property: by folder id when both have
 * one, so a renamed folder keeps its history; otherwise by name. `key` is the
 * property's name already normalised.
 */
function sameProperty_(rowId, rowTitle, id, key) {
  var a = textOf_(rowId).trim();
  var b = textOf_(id).trim();
  if (a && b) return a === b;
  return normalizeName_(rowTitle) === key;
}

/**
 * "Sunrise Homes Blk. 3, Lt 9" -> "sunrise homes block 3 lot 9": case, accents,
 * punctuation and "&" do not matter, and the usual abbreviations are spelled
 * out. matcher.ts's normalize, character for character.
 */
function normalizeName_(name) {
  var text = textOf_(name).toLowerCase()
    .normalize('NFD').replace(/(?=[\0-\u{FFFF}])\p{Mn}/gu, '').normalize('NFC')
    .split('&').join(' and ')
    .replace(/['\u{2019}]/gu, '');
  return text
    .replace(/[^\p{L}\p{Nd}]|[\u{10000}-\u{10FFFF}]/gu, ' ')
    .split(' ')
    .filter(function (token) { return token !== ''; })
    .map(function (token) {
      return Object.prototype.hasOwnProperty.call(NAME_ABBREVIATIONS, token) ? NAME_ABBREVIATIONS[token] : token;
    })
    .join(' ');
}

/** A Posts row's status as the app reads it (tracker.ts): Pending, or else Posted. */
function postStatus_(value) {
  return textOf_(value).trim().toLowerCase() === 'pending' ? 'Pending' : 'Posted';
}

// ---------------------------------------------------------------- the tracker's dates
//
// Read as the app reads them (tracker.ts readSheetDate): yyyy-MM-dd, an ISO
// timestamp, or M/d/yyyy, which is what a date typed into a plain-text cell
// stays as. Days are counted as whole calendar days, by Date.UTC, so no clock
// but Manila's is involved.

const TRACKER_DAY      = /^(\d{4})-(\d{2})-(\d{2})$/;
const TRACKER_STAMP    = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const TRACKER_US_DAY   = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\sT,].*)?$/;
const TRACKER_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TRACKER_MONTHS   = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

/** A tracker date as yyyy-MM-dd, or '' when it is not one. */
function sheetDay_(value) {
  var text = textOf_(value).trim();

  var m = TRACKER_DAY.exec(text);
  if (m) return calendarDay_(+m[1], +m[2], +m[3]);

  m = TRACKER_STAMP.exec(text);
  if (m) {
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = +(m[6] || 0);
    if (!calendarDay_(y, mo, d) || h > 23 || mi > 59 || s > 59) return '';
    if (!m[7]) return calendarDay_(y, mo, d);   // no zone: the clock as written
    var offset = 0;
    if (m[7].toUpperCase() !== 'Z') {
      var digits = m[7].replace(':', '');
      offset = (digits.charAt(0) === '-' ? -1 : 1) * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)));
    }
    var instant = new Date(Date.UTC(y, mo - 1, d, h, mi, s) - offset * 60000);
    return Utilities.formatDate(instant, CONFIG.TZ, 'yyyy-MM-dd');
  }

  m = TRACKER_US_DAY.exec(text);
  if (m) return calendarDay_(+m[3], +m[1], +m[2]);
  return '';
}

/** yyyy-MM-dd for a real calendar day, '' for 2026-02-30 and friends. */
function calendarDay_(year, month, day) {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  var d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
  return year + '-' + pad2_(month) + '-' + pad2_(day);
}

/** Whole days since 1970 for a yyyy-MM-dd. */
function dayNumber_(iso) {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS;
}

function isoDay_(day) { return new Date(day * DAY_MS).toISOString().slice(0, 10); }

/** "9 Mar" */
function dayMonth_(day) {
  var d = new Date(day * DAY_MS);
  return d.getUTCDate() + ' ' + TRACKER_MONTHS[d.getUTCMonth()];
}

/** "Mon 9 Mar 2026" */
function fullDate_(day) {
  var d = new Date(day * DAY_MS);
  return TRACKER_WEEKDAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + TRACKER_MONTHS[d.getUTCMonth()] + ' ' +
         d.getUTCFullYear();
}

function days_(n) { return n === 1 ? '1 day' : n + ' days'; }
function ago_(n) { return n === 0 ? 'today' : days_(n) + ' ago'; }
function pad2_(n) { return n < 10 ? '0' + n : String(n); }

// ---------------------------------------------------------------- queues

function saveQueue(req, me) {
  requireAll(req, ['date', 'assignedTo']);
  var items = req.items || [];
  if (typeof items === 'string') items = JSON.parse(items);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var sh = sheetFor(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS);
    var values = sh.getDataRange().getValues();
    var col = columnsIn_(values[0], ASSIGN_FIELDS, sh.getName());
    var tz = zoneOf_(sh);

    // Replace this person's rows for this date, leave everyone else's alone.
    for (var r = values.length - 1; r >= 1; r--) {
      var a = fieldsOf_(values[r], ASSIGN_FIELDS, col, tz);
      if (a.date === String(req.date) && a.assignedTo === String(req.assignedTo)) sh.deleteRow(r + 1);
    }
    items.forEach(function (it) {
      appendRow(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS, {
        date:       req.date,
        assignedTo: req.assignedTo,
        property:   it.property,
        status:     it.status || 'To post',
        propertyId: it.propertyId || idOf(it.property),
      });
    });
    return { ok: true, saved: items.length };
  } finally {
    lock.releaseLock();
  }
}

/** Set one queue item's status directly (the client's UpdateAssignmentAsync). */
function setStatus(req, me) {
  requireAll(req, ['property', 'assignedTo', 'status']);
  if (me.role === 'Intern' && req.assignedTo !== me.name) {
    return { ok: false, error: 'forbidden', message: 'That is not your queue item.' };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var row = setAssignmentStatus(req.propertyId || idOf(req.property), req.property, req.assignedTo, req.status);
    if (!row) {
      return {
        ok: false,
        error: 'notfound',
        message: 'There is no open queue item for ' + req.property + ' assigned to ' + req.assignedTo +
                 '. Reload the queue: it may have changed.',
      };
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Moves the person's open queue item for the property to `status`: the lowest
 * such row, and never one already Posted. Returns its row number, or 0 when
 * there is none.
 */
function setAssignmentStatus(propertyId, propertyName, assignedTo, status) {
  var sh = sheetFor(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return 0;
  var col = columnsIn_(values[0], ASSIGN_FIELDS, sh.getName());
  var tz = zoneOf_(sh);
  var key = normalizeName_(propertyName) || null;   // a blank name finds no row by name

  for (var r = values.length - 1; r >= 1; r--) {
    var a = fieldsOf_(values[r], ASSIGN_FIELDS, col, tz);
    if (!sameProperty_(a.propertyId, a.property, propertyId, key)) continue;
    if (a.assignedTo !== textOf_(assignedTo)) continue;
    if (a.status.trim().toLowerCase() === 'posted') continue;
    setText_(sh.getRange(r + 1, col.status + 1), status);
    return r + 1;
  }
  return 0;
}

// ---------------------------------------------------------------- sheets
//
// The tracker already exists, with its own columns in its own order, and it is
// a live business document. So nothing here writes by position: every field is
// located by matching the header row against a list of accepted spellings. A
// column the sheet does not have is simply skipped, unless it is required.
//
// The header row is read with the rows, never cached: a column moved in the
// tracker must not send the next write into the wrong column.
//
// Everything written is written as plain text (D7). A value written to a cell
// Sheets formats automatically is read as if it were typed: "14:30" becomes a
// time, "1201" a number and "=..." a formula. Everything read comes back as
// text, the way the app reads it.

const POST_FIELDS = {
  date:       { headers: ['Date'], required: true },
  type:       { headers: ['Type', 'Category', 'Property Type'] },
  title:      { headers: ['Title', 'Property', 'Property Name'], required: true },
  time:       { headers: ['Time'] },
  status:     { headers: ['Status'], required: true },
  fbAccount:  { headers: ['FB Account', 'Account', 'Facebook Account', 'FB'] },
  postLink:   { headers: ['Post Link', 'Link', 'URL', 'Facebook Link'], required: true },
  postedBy:   { headers: ['Posted By', 'Posted by', 'Intern', 'By'], required: true },
  propertyId: { headers: ['PropertyId', 'Property Id', 'Folder Id'] },
};

const ASSIGN_FIELDS = {
  date:       { headers: ['Date'], required: true },
  assignedTo: { headers: ['Assigned To', 'Assigned to', 'Intern'], required: true },
  property:   { headers: ['Property', 'Title', 'Property Name'], required: true },
  status:     { headers: ['Status'], required: true },
  propertyId: { headers: ['PropertyId', 'Property Id', 'Folder Id'] },
};

// Sheets' day zero. A time of day is stored as a date on it.
const SHEETS_DAY_ZERO = '1899-12-30';

function book() {
  if (CONFIG.TRACKER_SHEET_ID) return SpreadsheetApp.openById(CONFIG.TRACKER_SHEET_ID);
  var bound = SpreadsheetApp.getActiveSpreadsheet();
  if (!bound) throw new Error('CONFIG.TRACKER_SHEET_ID is not set, and this script is not bound to the tracker.');
  return bound;
}

/** Where the script's own tabs live — private, because Team holds the keys. */
function adminBook() {
  return CONFIG.ADMIN_SHEET_ID ? SpreadsheetApp.openById(CONFIG.ADMIN_SHEET_ID) : book();
}

/** The tab, created with default headers only when it does not exist yet. */
function sheetFor(name, fields) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (sh) return sh;

  var headers = Object.keys(fields).map(function (f) { return fields[f].headers[0]; });
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

/** Logical field name -> 0-based column index, from the sheet's own header row. */
function columnsOf(sh, fields) {
  var header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  return columnsIn_(header, fields, sh.getName());
}

/** The same, from a header row already read. */
function columnsIn_(header, fields, tabName) {
  var names = header.map(function (h) { return String(h).trim().toLowerCase(); });
  var col = {}, missing = [];
  Object.keys(fields).forEach(function (f) {
    var idx = -1;
    fields[f].headers.some(function (h) {
      idx = names.indexOf(h.toLowerCase());
      return idx !== -1;
    });
    if (idx === -1 && fields[f].required) missing.push(fields[f].headers[0]);
    col[f] = idx;
  });

  if (missing.length) {
    throw new Error('Tab "' + tabName + '" has no column for: ' + missing.join(', ') +
                    '. Add it, or add an accepted spelling to its field list in Code.gs.');
  }
  return col;
}

/** Rows as objects keyed by logical field name, every value text. */
function readRows(name, fields) {
  var sh = sheetFor(name, fields);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var col = columnsIn_(values[0], fields, sh.getName());
  var tz = zoneOf_(sh);

  return values.slice(1)
    .filter(function (r) { return r.join(''); })
    .map(function (r) { return fieldsOf_(r, fields, col, tz); });
}

/** One row of getValues() as an object keyed by logical field name. */
function fieldsOf_(r, fields, col, tz) {
  var o = {};
  Object.keys(fields).forEach(function (f) {
    o[f] = col[f] === -1 ? '' : cellText_(r[col[f]], tz, f);
  });
  return o;
}

/**
 * A cell as text. A folder named "1201", written before the cell was plain
 * text, is a number to Sheets, and the app cannot match a number. A date is
 * yyyy-MM-dd and a time HH:mm, on the sheet's own clock, which is the one it
 * was typed on. A time of day is a date on Sheets' day zero: that is what
 * "14:30" became in a cell that was not plain text, and read as a date it came
 * back as "1899-12-30", the time lost.
 */
function cellText_(value, tz, field) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    var timeOfDay = field === 'time' || Utilities.formatDate(value, tz, 'yyyy-MM-dd') === SHEETS_DAY_ZERO;
    return Utilities.formatDate(value, tz, timeOfDay ? 'HH:mm' : 'yyyy-MM-dd');
  }
  if (value === true || value === false) return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** The time zone a sheet's dates were typed in. */
function zoneOf_(sh) {
  return sh.getParent().getSpreadsheetTimeZone() || CONFIG.TZ;
}

function textOf_(value) {
  return value === null || value === undefined ? '' : String(value);
}

/** Append, placing each value in whichever column the sheet keeps it in. */
function appendRow(name, fields, values) {
  var sh = sheetFor(name, fields);
  var col = columnsOf(sh, fields);
  var row = new Array(Math.max(sh.getLastColumn(), 1)).fill('');
  var filled = [];
  Object.keys(values).forEach(function (f) {
    if (col[f] === undefined || col[f] === -1) return;
    row[col[f]] = textOf_(values[f]);
    filled.push(col[f]);
  });
  appendText_(sh, row, filled);
}

/**
 * Writes `row` below the last row, with the cells in `columns` (0-based) made
 * plain text first. Only those: a column the script does not fill keeps
 * whatever format the tracker gives it. Not appendRow(), which cannot format
 * the row before it writes it.
 */
function appendText_(sh, row, columns) {
  var r = sh.getLastRow() + 1;
  if (r > sh.getMaxRows()) sh.insertRowAfter(sh.getMaxRows());
  columns.forEach(function (c) { sh.getRange(r, c + 1).setNumberFormat('@'); });
  sh.getRange(r, 1, 1, row.length).setValues([row]);
}

/** Writes one cell as plain text. */
function setText_(range, value) {
  range.setNumberFormat('@');
  range.setValue(textOf_(value));
}

/** The Team tab, read plainly — this one is ours, so its columns are known. */
function readSheet(name, headers) {
  var ss = adminBook();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return [];
  }
  if (sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var head = values[0];
  return values.slice(1).filter(function (r) { return r.join(''); }).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

/** A tab this script owns outright, with headers it defines. Private book. */
function plainTab(name, headers) {
  var ss = adminBook();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ---------------------------------------------------------------- odds and ends

function activeEmail() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function now() { return Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }

function truthy(v) { return v === true || v === 'true' || v === '1'; }

function requireAll(req, names) {
  var missing = names.filter(function (n) { return !req[n]; });
  if (missing.length) throw new Error('missing: ' + missing.join(', '));
}

// ---------------------------------------------------------------- setup

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Post-It')
    .addItem('Add a team member…', 'promptAddTeamMember')
    .addItem('Check the connection', 'SETUP')
    .addToUi();
}

/**
 * Standalone setup, for when this script is not bound to a spreadsheet (so there
 * is no Post-It menu). Edit the three values, press Run, and read the key from
 * the execution log.
 */
function ADD_PERSON() {
  var name       = 'Jan Dela Cruz';
  var role       = 'Admin';           // Admin (assigns postings) | Intern
  var fbAccounts = '';                // comma separated; blank = any

  var key = addTeamMember(name, '', role, fbAccounts);
  Logger.log('%s (%s) key: %s', name, role, key);
  return key;
}

/** Check that everything this script depends on is reachable. */
function SETUP() {
  requireSeparators_();
  Logger.log('Separators.gs: present.');
  var properties = listProperties();
  Logger.log('Directory: %s properties.', properties.length);
  Logger.log('Tracker tab "%s": %s rows.', CONFIG.POSTS_TAB, readRows(CONFIG.POSTS_TAB, POST_FIELDS).length);
  Logger.log('Team: %s people.', teamRows().length);
  if (!properties.length) {
    Logger.log('The directory is empty — run BuildDirectory.gs before using the app.');
  }
}

function promptAddTeamMember() {
  var ui = SpreadsheetApp.getUi();
  var name = ui.prompt('Full name').getResponseText();
  if (!name) return;
  var role = ui.prompt('Role: Admin or Intern').getResponseText();
  var fb = ui.prompt('Facebook accounts they may post from (comma separated, blank = any)').getResponseText();
  var key = addTeamMember(name, '', role, fb);
  ui.alert('Key for ' + name + ':\n\n' + key + '\n\nPaste it into their copy of Post-It. It is on the Team tab if you need it again.');
}
