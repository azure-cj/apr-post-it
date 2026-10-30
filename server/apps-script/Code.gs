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
  // Drive folder holding <Category>/<Property>/ sub-folders (or <Property>/ directly).
  PROPERTIES_FOLDER_ID: '',

  // Tracker spreadsheet. Leave blank when this script is bound to that sheet.
  TRACKER_SHEET_ID: '',

  // Long random string. The client sends it on every call. Never commit the real one.
  SHARED_KEY: '',

  COOLDOWN_DAYS: 7,
  REPOST_DAYS: 14,
  TZ: 'Asia/Manila',

  // Give property photos "anyone with the link can view" so the client can
  // download them directly from Drive. These photos get posted publicly on
  // Facebook anyway. Set false to keep photos private (client gets no URLs).
  PUBLISH_PHOTOS: true,
};

// Lines that start the part of a posting doc that must never reach an intern.
const INTERNAL_MARKERS = [
  /^\s*=+\s*internal/i,
  /^\s*internal\s*(notes|only|section)?\s*[:\-]?\s*$/i,
  /^\s*for\s+agents?\s+only/i,
  /^\s*do\s+not\s+post/i,
];

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME    = 'application/vnd.google-apps.document';
const PHOTO_MIME  = /^image\/(jpeg|png|webp|gif)$/;
const DOC_NAME    = /\.(docx?|txt|md)$/i;

const INDEX_HEADERS  = ['PropertyId', 'Name', 'Category', 'DocId', 'DocMime', 'PhotoCount', 'Photos', 'Modified'];
const POST_HEADERS   = ['Date', 'Type', 'Title', 'Time', 'Status', 'FB Account', 'Post Link', 'Posted By', 'PropertyId'];
const ASSIGN_HEADERS = ['Date', 'Assigned To', 'Property', 'Status', 'PropertyId'];

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
    if (!CONFIG.SHARED_KEY || req.key !== CONFIG.SHARED_KEY) {
      return json({ ok: false, error: 'unauthorized' });
    }
    switch (req.action) {
      case 'ping':        return json({ ok: true, signedInAs: activeEmail(), time: now() });
      case 'properties':  return json({ ok: true, properties: listProperties() });
      case 'property':    return json({ ok: true, property: getProperty(req.id, truthy(req.internal)) });
      case 'posts':       return json({ ok: true, posts: readSheet('Posts', POST_HEADERS) });
      case 'assignments': return json({ ok: true, assignments: readSheet('Assignments', ASSIGN_HEADERS) });
      case 'logPost':     return json(logPost(req));
      case 'addLink':     return json(addLink(req));
      case 'saveQueue':   return json(saveQueue(req));
      case 'reindex':     return json({ ok: true, indexed: buildIndex() });
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

// ---------------------------------------------------------------- the index
//
// Walking Drive on every search is far too slow. A time-driven trigger walks
// it and writes one row per property to an "Index" tab; reads are then a
// single getValues() on that tab.

function buildIndex() {
  var root = CONFIG.PROPERTIES_FOLDER_ID;
  if (!root) throw new Error('Set CONFIG.PROPERTIES_FOLDER_ID first.');

  var groups = children(root, FOLDER_MIME);
  if (!groups.length) groups = [{ id: root, name: '' }];   // no category level

  var rows = [];
  groups.forEach(function (group) {
    children(group.id, FOLDER_MIME).forEach(function (prop) {
      var files  = children(prop.id, null);
      var doc    = files.filter(isPostingDoc)[0];
      var photos = files.filter(function (f) { return PHOTO_MIME.test(f.mimeType); });
      rows.push([
        prop.id,
        prop.name,
        group.name,
        doc ? doc.id : '',
        doc ? doc.mimeType : '',
        photos.length,
        JSON.stringify(photos.map(function (p) { return { id: p.id, name: p.name }; })),
        prop.modifiedTime || '',
      ]);
    });
  });

  var sh = tab('Index', INDEX_HEADERS);
  sh.clearContents();
  sh.getRange(1, 1, 1, INDEX_HEADERS.length).setValues([INDEX_HEADERS]);
  if (rows.length) sh.getRange(2, 1, rows.length, INDEX_HEADERS.length).setValues(rows);

  CacheService.getScriptCache().remove('index');
  return rows.length;
}

function isPostingDoc(f) {
  return f.mimeType === DOC_MIME || DOC_NAME.test(f.name || '');
}

/** One Drive API page-through. mimeType null = everything except folders. */
function children(parentId, mimeType) {
  var q = "'" + parentId + "' in parents and trashed = false"
        + (mimeType ? " and mimeType = '" + mimeType + "'"
                    : " and mimeType != '" + FOLDER_MIME + "'");
  var out = [], token = null;
  do {
    var page = Drive.Files.list({
      q: q,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      pageSize: 1000,
      pageToken: token,
      orderBy: 'name',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    out = out.concat(page.files || []);
    token = page.nextPageToken;
  } while (token);
  return out;
}

function indexRows() {
  var sh = tab('Index', INDEX_HEADERS);
  if (sh.getLastRow() < 2) buildIndex();
  var values = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), INDEX_HEADERS.length).getValues();
  return values.filter(function (r) { return r[0]; }).map(function (r) {
    return {
      id: r[0], name: r[1], category: r[2], docId: r[3], docMime: r[4],
      photoCount: Number(r[5]) || 0, photos: r[6], modified: r[7],
    };
  });
}

// ---------------------------------------------------------------- properties

/** Search list: small payload, no document text. */
function listProperties() {
  return indexRows().map(function (r) {
    return { id: r.id, name: r.name, category: r.category, photoCount: r.photoCount, modified: r.modified };
  });
}

/**
 * One property. includeInternal is honoured only for managers — see the note
 * on identity in README.md. When false the internal text never leaves here.
 */
function getProperty(id, includeInternal) {
  var row = indexRows().filter(function (r) { return r.id === id; })[0];
  if (!row) throw new Error('property not found: ' + id);

  var parsed = row.docId
    ? splitPosting(readDoc(row.docId, row.docMime))
    : { publicText: '', internalText: '', meta: {} };

  var photos = JSON.parse(row.photos || '[]');
  if (CONFIG.PUBLISH_PHOTOS) publish(photos);

  var out = {
    id: row.id,
    name: row.name,
    category: parsed.meta.category || row.category,
    location: parsed.meta.location || '',
    publicText: parsed.publicText,
    hasInternal: parsed.internalText.length > 0,
    photos: photos.map(function (p) {
      return {
        id: p.id,
        name: p.name,
        url:   CONFIG.PUBLISH_PHOTOS ? 'https://drive.google.com/uc?export=download&id=' + p.id : '',
        thumb: CONFIG.PUBLISH_PHOTOS ? 'https://drive.google.com/thumbnail?id=' + p.id + '&sz=w640' : '',
      };
    }),
  };
  if (includeInternal) out.internalText = parsed.internalText;
  return out;
}

/** Public part, internal part, and the Category:/Location: header lines. */
function splitPosting(text) {
  var lines = String(text || '').split(/\r?\n/);
  var cut = -1;
  for (var i = 0; i < lines.length; i++) {
    if (INTERNAL_MARKERS.some(function (m) { return m.test(lines[i]); })) { cut = i; break; }
  }
  var pub = cut === -1 ? lines.slice() : lines.slice(0, cut);
  var internal = cut === -1 ? '' : lines.slice(cut + 1).join('\n').trim();

  var meta = {};
  while (pub.length && /^\s*(category|location)\s*:/i.test(pub[0])) {
    var parts = pub.shift().split(':');
    meta[parts[0].trim().toLowerCase()] = parts.slice(1).join(':').trim();
  }
  return { publicText: pub.join('\n').trim(), internalText: internal, meta: meta };
}

function readDoc(fileId, mimeType) {
  if (mimeType === DOC_MIME) {
    return DocumentApp.openById(fileId).getBody().getText();   // live, no cache
  }
  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  }
  // .docx: convert to a temporary Google Doc. Slow, so cache the result.
  var cache = CacheService.getScriptCache();
  var hit = cache.get('doc:' + fileId);
  if (hit) return hit;

  var copy = Drive.Files.copy({ name: 'postit-tmp', mimeType: DOC_MIME }, fileId, { supportsAllDrives: true });
  try {
    var text = DocumentApp.openById(copy.id).getBody().getText();
    try { cache.put('doc:' + fileId, text, 600); } catch (e) { /* over 100KB */ }
    return text;
  } finally {
    try { Drive.Files.remove(copy.id); } catch (e) { /* leave the temp file */ }
  }
}

function publish(photos) {
  photos.forEach(function (p) {
    try {
      var f = DriveApp.getFileById(p.id);
      if (f.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) {
        f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      }
    } catch (e) { /* shared drive policy may forbid it */ }
  });
}

// ---------------------------------------------------------------- posting
//
// The cooldown is enforced here, under a lock. Two interns clicking Save on
// the same property at the same time cannot both get through.

function logPost(req) {
  requireAll(req, ['property', 'propertyId', 'fbAccount', 'postedBy']);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'Someone else is saving. Try again.' };
  try {
    var guard = cooldownFor(req.propertyId, req.property);
    if (guard) return guard;

    var link   = String(req.postLink || '').trim();
    var status = link ? 'Posted' : 'Pending';
    var when   = new Date();

    tab('Posts', POST_HEADERS).appendRow([
      Utilities.formatDate(when, CONFIG.TZ, 'yyyy-MM-dd'),
      req.type || 'Group post',
      req.property,
      Utilities.formatDate(when, CONFIG.TZ, 'HH:mm'),
      status,
      req.fbAccount,
      link,
      req.postedBy,
      req.propertyId,
    ]);
    setAssignmentStatus(req.propertyId, req.postedBy, status);
    return { ok: true, status: status, date: Utilities.formatDate(when, CONFIG.TZ, 'yyyy-MM-dd') };
  } finally {
    lock.releaseLock();
  }
}

/** Returns a refusal object when the property is inside its cooldown, else null. */
function cooldownFor(propertyId, propertyName) {
  var last = null;
  readSheet('Posts', POST_HEADERS).forEach(function (p) {
    var same = p.PropertyId ? p.PropertyId === propertyId : p.Title === propertyName;
    if (!same || p.Status !== 'Posted') return;
    var d = new Date(p.Date);
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
function addLink(req) {
  requireAll(req, ['propertyId', 'postLink']);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var sh = tab('Posts', POST_HEADERS);
    var values = sh.getDataRange().getValues();
    for (var r = values.length - 1; r >= 1; r--) {
      if (values[r][8] === req.propertyId && values[r][4] === 'Pending') {
        sh.getRange(r + 1, 5).setValue('Posted');
        sh.getRange(r + 1, 7).setValue(req.postLink);
        setAssignmentStatus(req.propertyId, values[r][7], 'Posted');
        return { ok: true, row: r + 1 };
      }
    }
    return { ok: false, error: 'no pending post for that property' };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- queues

function saveQueue(req) {
  requireAll(req, ['date', 'assignedTo']);
  var items = req.items || [];
  if (typeof items === 'string') items = JSON.parse(items);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var sh = tab('Assignments', ASSIGN_HEADERS);
    var values = sh.getDataRange().getValues();

    // Replace this person's rows for this date, keep everything else.
    for (var r = values.length - 1; r >= 1; r--) {
      if (String(values[r][0]) === String(req.date) && values[r][1] === req.assignedTo) {
        sh.deleteRow(r + 1);
      }
    }
    items.forEach(function (it) {
      sh.appendRow([req.date, req.assignedTo, it.property, it.status || 'To post', it.propertyId || '']);
    });
    return { ok: true, saved: items.length };
  } finally {
    lock.releaseLock();
  }
}

function setAssignmentStatus(propertyId, assignedTo, status) {
  var sh = tab('Assignments', ASSIGN_HEADERS);
  var values = sh.getDataRange().getValues();
  for (var r = values.length - 1; r >= 1; r--) {
    if (values[r][4] === propertyId && values[r][1] === assignedTo && values[r][3] !== 'Posted') {
      sh.getRange(r + 1, 4).setValue(status);
      return;
    }
  }
}

// ---------------------------------------------------------------- sheets

function book() {
  return CONFIG.TRACKER_SHEET_ID
    ? SpreadsheetApp.openById(CONFIG.TRACKER_SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function tab(name, headers) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Rows as objects keyed by header. */
function readSheet(name, headers) {
  var sh = tab(name, headers);
  if (sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var head = values[0];
  return values.slice(1).filter(function (r) { return r.join(''); }).map(function (r) {
    var o = {};
    head.forEach(function (h, i) {
      o[h] = r[i] instanceof Date ? Utilities.formatDate(r[i], CONFIG.TZ, 'yyyy-MM-dd') : r[i];
    });
    return o;
  });
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
    .addItem('Rebuild property index', 'buildIndex')
    .addItem('Install 15-minute refresh', 'installTrigger')
    .addToUi();
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'buildIndex') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildIndex').timeBased().everyMinutes(15).create();
}
