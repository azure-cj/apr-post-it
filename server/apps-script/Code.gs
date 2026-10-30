/**
 * APG Post-It — Google Drive + Sheets backend.
 *
 * A single Apps Script web app that the Windows client talks to over HTTPS.
 * The script runs as the owner, so interns never need Drive access and never
 * receive the internal section of a posting doc.
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
  // key. It must not live in a sheet the team can open: anyone who can read a
  // manager's key can act as that manager. Leave blank only if the tracker
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
const ROLES = ['Intern', 'Manager', 'Admin'];

// What each role may call. Admin may call anything.
const PERMISSIONS = {
  Intern:  ['ping', 'properties', 'property', 'posts', 'assignments', 'logPost', 'addLink', 'setStatus'],
  Manager: ['ping', 'properties', 'property', 'posts', 'assignments',
            'logPost', 'addLink', 'saveQueue', 'setStatus'],
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
    if (!me) return json({ ok: false, error: 'unauthorized', message: 'This copy of Post-It is not registered. Ask your manager for a key.' });
    if (!allowed(me.role, req.action)) {
      return json({ ok: false, error: 'forbidden', message: 'Your account cannot do that.' });
    }
    switch (req.action) {
      case 'ping':        return json({ ok: true, name: me.name, role: me.role, fbAccounts: me.fbAccounts, time: now() });
      case 'properties':  return json({ ok: true, properties: listProperties() });
      case 'property':    return json({ ok: true, property: getProperty(req.id, me.canSeeInternal) });
      case 'posts':       return json({ ok: true, posts: mine(me, readRows(CONFIG.POSTS_TAB, POST_FIELDS), 'postedBy') });
      case 'assignments': return json({ ok: true, assignments: mine(me, readRows(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS), 'assignedTo') });
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
    // reindex and add the first people. It stops working once Team has a row.
    return (CONFIG.SHARED_KEY && key === CONFIG.SHARED_KEY)
      ? { name: 'Setup', email: '', role: 'Admin', fbAccounts: [], canSeeInternal: true }
      : null;
  }

  var row = team.filter(function (t) {
    return String(t.Key) === String(key) && String(t.Active).toUpperCase() !== 'FALSE';
  })[0];
  if (!row) return null;

  var role = ROLES.indexOf(row.Role) === -1 ? 'Intern' : row.Role;
  return {
    name: row.Name,
    email: row.Email,
    role: role,
    fbAccounts: String(row['FB Accounts'] || '').split(',').map(function (x) { return x.trim(); }).filter(String),
    canSeeInternal: role !== 'Intern',
  };
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
  plainTab('Team', TEAM_HEADERS).appendRow([name, email || '', role || 'Intern', key, fbAccounts || '', true]);
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
  if (sh.getLastRow() < 2) return [];

  var col = columnsOf(sh, DIRECTORY_FIELDS);
  var values = sh.getDataRange().getValues();

  var out = values.slice(1)
    .filter(function (r) { return r[col.id]; })
    .map(function (r) {
      var o = {};
      Object.keys(DIRECTORY_FIELDS).forEach(function (f) {
        o[f] = col[f] === -1 ? '' : r[col[f]];
      });
      return o;
    });

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
    cutAt: cutAt,
    issues: row.issues,
    live: live,
    photos: photos,
  };
  if (includeInternal) out.internalText = internalText;
  return out;
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
    var guard = cooldownFor(req.propertyId, req.property);
    if (guard) return guard;

    var link = String(req.postLink || '').trim();
    var status = link ? 'Posted' : 'Pending';
    var when = new Date();

    appendRow(CONFIG.POSTS_TAB, POST_FIELDS, {
      date:       Utilities.formatDate(when, CONFIG.TZ, 'yyyy-MM-dd'),
      type:       req.type || 'Group post',
      title:      req.property,
      time:       Utilities.formatDate(when, CONFIG.TZ, 'HH:mm'),
      status:     status,
      fbAccount:  req.fbAccount,
      postLink:   link,
      postedBy:   postedBy,
      propertyId: req.propertyId,
    });
    setAssignmentStatus(req.propertyId, req.property, postedBy, status);
    return { ok: true, status: status, date: Utilities.formatDate(when, CONFIG.TZ, 'yyyy-MM-dd'), postedBy: postedBy };
  } finally {
    lock.releaseLock();
  }
}

/** Returns a refusal object when the property is inside its cooldown, else null. */
function cooldownFor(propertyId, propertyName) {
  var last = null;
  readRows(CONFIG.POSTS_TAB, POST_FIELDS).forEach(function (p) {
    var same = p.propertyId ? p.propertyId === propertyId : p.title === propertyName;
    if (!same || p.status !== 'Posted') return;
    var d = new Date(p.date);
    if (!isNaN(d) && (!last || d > last)) last = d;
  });
  if (!last) return null;

  var days = Math.floor((Date.now() - last.getTime()) / 86400000);
  if (days >= CONFIG.COOLDOWN_DAYS) return null;

  var next = new Date(last.getTime() + CONFIG.COOLDOWN_DAYS * 86400000);
  return {
    ok: false,
    error: 'cooldown',
    lastPosted:  Utilities.formatDate(last, CONFIG.TZ, 'yyyy-MM-dd'),
    nextAllowed: Utilities.formatDate(next, CONFIG.TZ, 'yyyy-MM-dd'),
    message: 'Posted ' + days + ' day(s) ago. Next allowed ' +
             Utilities.formatDate(next, CONFIG.TZ, 'MMM d') + '.',
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
    var col = columnsOf(sh, POST_FIELDS);
    var values = sh.getDataRange().getValues();

    // Match on the folder id when the sheet carries one, otherwise on the name.
    var name = req.property || nameOf(req.propertyId);
    var id = req.propertyId || idOf(name);

    for (var r = values.length - 1; r >= 1; r--) {
      var isOurs = col.propertyId !== -1 && id
        ? values[r][col.propertyId] === id
        : String(values[r][col.title]).trim() === String(name).trim();
      if (!isOurs) continue;
      if (values[r][col.status] !== 'Pending') continue;
      if (me.role === 'Intern' && values[r][col.postedBy] !== me.name) continue;  // not yours

      sh.getRange(r + 1, col.status + 1).setValue('Posted');
      sh.getRange(r + 1, col.postLink + 1).setValue(req.postLink);
      setAssignmentStatus(id, name, values[r][col.postedBy], 'Posted');
      return { ok: true, row: r + 1 };
    }
    return { ok: false, error: 'notfound', message: 'No pending post for that property.' };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- queues

function saveQueue(req, me) {
  requireAll(req, ['date', 'assignedTo']);
  var items = req.items || [];
  if (typeof items === 'string') items = JSON.parse(items);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var sh = sheetFor(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS);
    var col = columnsOf(sh, ASSIGN_FIELDS);
    var values = sh.getDataRange().getValues();

    // Replace this person's rows for this date, leave everyone else's alone.
    for (var r = values.length - 1; r >= 1; r--) {
      var d = values[r][col.date];
      var same = (d instanceof Date ? Utilities.formatDate(d, CONFIG.TZ, 'yyyy-MM-dd') : String(d));
      if (same === String(req.date) && values[r][col.assignedTo] === req.assignedTo) sh.deleteRow(r + 1);
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
    setAssignmentStatus(req.propertyId || idOf(req.property), req.property, req.assignedTo, req.status);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function setAssignmentStatus(propertyId, propertyName, assignedTo, status) {
  var sh = sheetFor(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS);
  var col = columnsOf(sh, ASSIGN_FIELDS);
  var values = sh.getDataRange().getValues();
  for (var r = values.length - 1; r >= 1; r--) {
    var isOurs = col.propertyId !== -1
      ? values[r][col.propertyId] === propertyId
      : String(values[r][col.property]).trim() === String(propertyName).trim();
    if (isOurs &&
        values[r][col.assignedTo] === assignedTo &&
        values[r][col.status] !== 'Posted') {
      sh.getRange(r + 1, col.status + 1).setValue(status);
      return;
    }
  }
}

// ---------------------------------------------------------------- sheets
//
// The tracker already exists, with its own columns in its own order, and it is
// a live business document. So nothing here writes by position: every field is
// located by matching the header row against a list of accepted spellings. A
// column the sheet does not have is simply skipped, unless it is required.

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

function book() {
  return CONFIG.TRACKER_SHEET_ID
    ? SpreadsheetApp.openById(CONFIG.TRACKER_SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
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
  var cacheKey = 'cols:' + sh.getSheetId();
  var cache = CacheService.getScriptCache();
  var hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);

  var header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
                 .map(function (h) { return String(h).trim().toLowerCase(); });

  var col = {}, missing = [];
  Object.keys(fields).forEach(function (f) {
    var idx = -1;
    fields[f].headers.some(function (h) {
      idx = header.indexOf(h.toLowerCase());
      return idx !== -1;
    });
    if (idx === -1 && fields[f].required) missing.push(fields[f].headers[0]);
    col[f] = idx;
  });

  if (missing.length) {
    throw new Error('Tab "' + sh.getName() + '" has no column for: ' + missing.join(', ') +
                    '. Add it, or add an accepted spelling to POST_FIELDS/ASSIGN_FIELDS.');
  }
  try { cache.put(cacheKey, JSON.stringify(col), 300); } catch (e) { /* ignore */ }
  return col;
}

/** Rows as objects keyed by logical field name. */
function readRows(name, fields) {
  var sh = sheetFor(name, fields);
  if (sh.getLastRow() < 2) return [];
  var col = columnsOf(sh, fields);
  var values = sh.getDataRange().getValues();

  return values.slice(1).filter(function (r) { return r.join(''); }).map(function (r) {
    var o = {};
    Object.keys(fields).forEach(function (f) {
      var v = col[f] === -1 ? '' : r[col[f]];
      o[f] = v instanceof Date ? Utilities.formatDate(v, CONFIG.TZ, 'yyyy-MM-dd') : v;
    });
    return o;
  });
}

/** Append, placing each value in whichever column the sheet keeps it in. */
function appendRow(name, fields, values) {
  var sh = sheetFor(name, fields);
  var col = columnsOf(sh, fields);
  var width = Math.max(sh.getLastColumn(), 1);
  var row = new Array(width).fill('');
  Object.keys(values).forEach(function (f) {
    if (col[f] !== undefined && col[f] !== -1) row[col[f]] = values[f];
  });
  sh.appendRow(row);
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
  var role       = 'Intern';          // Intern | Manager | Admin
  var fbAccounts = '';                // comma separated; blank = any

  var key = addTeamMember(name, '', role, fbAccounts);
  Logger.log('%s (%s) key: %s', name, role, key);
  return key;
}

/** Check that everything this script depends on is reachable. */
function SETUP() {
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
  var role = ui.prompt('Role: Intern, Manager or Admin').getResponseText();
  var fb = ui.prompt('Facebook accounts they may post from (comma separated, blank = any)').getResponseText();
  var key = addTeamMember(name, '', role, fb);
  ui.alert('Key for ' + name + ':\n\n' + key + '\n\nPaste it into their copy of Post-It. It is on the Team tab if you need it again.');
}

