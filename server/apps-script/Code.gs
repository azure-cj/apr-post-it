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
  PROPERTIES_FOLDER_ID: '1GXeGULYswb7jXcMGCCRm2RQ_h0EKsDlI',

  // Only these category folders are scanned. Everything else under the root —
  // SOLD, Contents, Hiring and the rest — is ignored. Empty = scan them all.
  CATEGORY_FOLDERS: [
    'Commercial Space',
    'Condo/House and Lot',
    'Lot',
    'Office Space',
    'Warehouse',
  ],

  // The company tracker. Leave blank only when this script is bound to it.
  TRACKER_SHEET_ID: '',

  // A SEPARATE, PRIVATE spreadsheet for the script's own tabs: Index and Team.
  // Team holds everyone's key, so it must not live in a sheet the team can open
  // — anyone who can read a manager's key can act as that manager. Leave blank
  // only if the tracker itself is private to you.
  ADMIN_SHEET_ID: '',

  // Tab names in that spreadsheet. POSTS_TAB must match the real one.
  POSTS_TAB: 'Posts',
  ASSIGNMENTS_TAB: 'Assignments',

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

const TEAM_HEADERS   = ['Name', 'Email', 'Role', 'Key', 'FB Accounts', 'Active'];
const ROLES = ['Intern', 'Manager', 'Admin'];

// What each role may call. Admin may call anything.
const PERMISSIONS = {
  Intern:  ['ping', 'properties', 'property', 'posts', 'assignments', 'logPost', 'addLink', 'setStatus'],
  Manager: ['ping', 'properties', 'property', 'texts', 'posts', 'assignments',
            'logPost', 'addLink', 'saveQueue', 'setStatus', 'reindex'],
  Admin:   ['*'],
};

const INDEX_HEADERS  = ['PropertyId', 'Name', 'Category', 'DocId', 'DocMime', 'DocModified', 'PhotoCount', 'Photos', 'Modified'];

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
      case 'texts':       return json({ ok: true, texts: allTexts(Number(req.limit) || 50, Number(req.offset) || 0) });
      case 'posts':       return json({ ok: true, posts: mine(me, readRows(CONFIG.POSTS_TAB, POST_FIELDS), 'postedBy') });
      case 'assignments': return json({ ok: true, assignments: mine(me, readRows(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS), 'assignedTo') });
      case 'logPost':     return json(logPost(req, me));
      case 'addLink':     return json(addLink(req, me));
      case 'saveQueue':   return json(saveQueue(req, me));
      case 'setStatus':   return json(setStatus(req, me));
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

/** Property name for a folder id, from the index. */
function nameOf(propertyId) {
  var row = indexRows().filter(function (r) { return r.id === propertyId; })[0];
  return row ? row.name : '';
}

/** Folder id for a property name, so the client can send either one. */
function idOf(propertyName) {
  var want = String(propertyName || '').trim().toLowerCase();
  var row = indexRows().filter(function (r) { return String(r.name).trim().toLowerCase() === want; })[0];
  return row ? row.id : '';
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

// ---------------------------------------------------------------- the index
//
// Walking Drive on every search is far too slow. A time-driven trigger walks
// it and writes one row per property to an "Index" tab; reads are then a
// single getValues() on that tab.

function buildIndex() {
  var root = CONFIG.PROPERTIES_FOLDER_ID;
  if (!root) throw new Error('Set CONFIG.PROPERTIES_FOLDER_ID first.');

  var groups = children(root, FOLDER_MIME);
  if (CONFIG.CATEGORY_FOLDERS && CONFIG.CATEGORY_FOLDERS.length) {
    groups = groups.filter(function (g) { return CONFIG.CATEGORY_FOLDERS.indexOf(g.name) !== -1; });
    if (!groups.length) {
      throw new Error('None of CONFIG.CATEGORY_FOLDERS were found under the root folder.');
    }
  } else if (!groups.length) {
    groups = [{ id: root, name: '' }];   // no category level at all
  }

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
        doc ? (doc.modifiedTime || '') : '',
        photos.length,
        JSON.stringify(photos.map(function (p) { return { id: p.id, name: p.name }; })),
        prop.modifiedTime || '',
      ]);
    });
  });

  var sh = plainTab('Index', INDEX_HEADERS);
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
  var sh = plainTab('Index', INDEX_HEADERS);
  if (sh.getLastRow() < 2) buildIndex();
  var values = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), INDEX_HEADERS.length).getValues();
  return values.filter(function (r) { return r[0]; }).map(function (r) {
    return {
      id: r[0], name: r[1], category: r[2], docId: r[3], docMime: r[4], docModified: r[5],
      photoCount: Number(r[6]) || 0, photos: r[7], modified: r[8],
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
    ? splitPosting(readDoc(row.docId, row.docMime))      // live: no `modified` argument
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

/**
 * Read a posting doc as the plain text that will be pasted into Facebook.
 *
 * Pass `modified` (the doc's modifiedTime from the index) to allow caching;
 * omit it to force a live read. Opening a property reads live, so a typo fixed
 * in Drive a moment ago is already gone. The doc-health sweep reads cached,
 * because a 15-minute-old answer is fine for a report.
 */
function readDoc(fileId, mimeType, modified) {
  var cache = CacheService.getScriptCache();
  var key = 'doc:' + fileId + ':' + (modified || '');
  if (modified) {
    var hit = cache.get(key);
    if (hit) return hit;
  }

  var text;
  if (mimeType === DOC_MIME) {
    text = docToText(DocumentApp.openById(fileId));
  } else if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    text = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  } else {
    // .docx and friends: convert to a temporary Google Doc, read it, bin it.
    var copy = Drive.Files.copy({ name: 'postit-tmp', mimeType: DOC_MIME }, fileId, { supportsAllDrives: true });
    try {
      text = docToText(DocumentApp.openById(copy.id));
    } finally {
      try { Drive.Files.remove(copy.id); } catch (e) { /* leave the temp file */ }
    }
  }

  if (modified) {
    try { cache.put(key, text, 21600); } catch (e) { /* over the 100KB cache limit */ }
  }
  return text;
}

/**
 * Flatten a Google Doc to posting text.
 *
 * Body.getText() is not enough: it drops bullet glyphs, so a feature list
 * arrives as unreadable run-on lines, and it concatenates table cells with no
 * separator. Walk the body instead.
 */
function docToText(doc) {
  var body = doc.getBody();
  var counters = {};
  var out = [];
  for (var i = 0; i < body.getNumChildren(); i++) {
    out.push(elementText(body.getChild(i), counters));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function elementText(el, counters) {
  var T = DocumentApp.ElementType;
  var type = el.getType();

  if (type === T.LIST_ITEM) {
    var level = el.getNestingLevel();
    var marker = '\u2022';
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
      var row = el.getRow(r);
      var cells = [];
      for (var c = 0; c < row.getNumCells(); c++) {
        cells.push(row.getCell(c).getText().trim());
      }
      cells = cells.filter(String);
      // A two-column spec table reads naturally as "Lot area: 120 sqm".
      rows.push(cells.length === 2 ? cells[0].replace(/:$/, '') + ': ' + cells[1] : cells.join('  '));
    }
    return rows.join('\n');
  }

  if (type === T.HORIZONTAL_RULE || type === T.PAGE_BREAK) return '';
  return el.getText ? el.getText() : '';
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

/**
 * Public text for a page of properties, for the manager's doc-health screen.
 *
 * Paged on purpose: reading a few hundred docs in one request would run past
 * the 6-minute execution limit. The client walks it 50 at a time. Internal
 * text is never included — only whether a marker was found.
 */
function allTexts(limit, offset) {
  return indexRows().slice(offset, offset + limit).map(function (r) {
    var parsed = r.docId
      ? splitPosting(readDoc(r.docId, r.docMime, r.docModified))   // cached
      : { publicText: '', internalText: '', meta: {} };
    return {
      id: r.id,
      name: r.name,
      hasDoc: !!r.docId,
      docMime: r.docMime,
      publicText: parsed.publicText,
      hasInternal: parsed.internalText.length > 0,
      photoCount: r.photoCount,
    };
  });
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
    .addItem('Rebuild property index', 'buildIndex')
    .addItem('Install 15-minute refresh', 'installTrigger')
    .addItem('Add a team member…', 'promptAddTeamMember')
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

/** Standalone equivalent of the menu item, for a first run. */
function SETUP() {
  var count = buildIndex();
  installTrigger();
  Logger.log('Indexed %s properties. 15-minute refresh installed.', count);
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

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'buildIndex') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildIndex').timeBased().everyMinutes(15).create();
}
