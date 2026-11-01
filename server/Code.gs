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

// This file's version. ping sends it, and the app compares it with its own
// EXPECTED_SERVER_VERSION (src/config.ts) to say when the deployment is behind.
// Change both together, whenever an action or a reply changes: yyyy-MM-dd.n.
const SERVER_VERSION = '2026-11-01.4';

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

  // The rules' defaults. The admin changes the live values from the app
  // (setRules), and they are kept on the Settings tab of the admin sheet;
  // these apply only to a rule that tab does not have.
  COOLDOWN_DAYS: 7,
  REPOST_DUE_DAYS: 14,
  PER_WEEK: 40,
  TZ: 'Asia/Manila',

  // The listing checker's published Index CSV (File > Share > Publish to web).
  // That script and its sheet belong to another team: this one only READS the
  // CSV, never writes anywhere near it. Its City, Size, Deal type and Status
  // are joined onto the directory by Folder ID. '' turns the join off.
  CHECKER_INDEX_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT_xOq-DEX-QXpSMfkkH8eEiwVkd1ylTKh6jhOxY4TfjrvnpLg-OqemlwcL6GLWlNXvjiWyTlZEymJU/pub?gid=90841346&single=true&output=csv',

  // The owner's geocoding sheet (FolderId, Property, Query, Lat, Lng, GeoStatus,
  // Checked): where each listing is, for the map on the app's startup screen.
  // Only ever READ. GEO_SHEET_ID '' means the directory spreadsheet; GEO_TAB ''
  // means the first tab whose header row has FolderId, Lat and Lng.
  GEO_SHEET_ID: '',
  GEO_TAB: '',
};

// Where the postable text ends is decided in Separators.gs, which this project
// must also contain. Do not add a marker list here (D13).

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME    = 'application/vnd.google-apps.document';
const PHOTO_MIME  = /^image\/(jpeg|png|webp|gif)$/;
const DOC_NAME    = /\.(docx?|txt|md)$/i;

// FB Accounts holds the person's FB broker name(s): the Facebook account name
// they post as (comma separated when more than one). FB Profile Link is the
// link to that profile. A Team tab made before it existed has no FB Profile
// Link column: it is read by header name, and added the first time a Team row
// is written (teamColumns_).
const TEAM_HEADERS   = ['Name', 'Email', 'Role', 'Key', 'FB Accounts', 'FB Profile Link', 'Active'];
const TEAM_OPTIONAL_HEADERS = ['FB Profile Link'];
const ROLES = ['Intern', 'Admin'];

// What each role may call. Admin may call anything.
// Two roles. The Admin assigns the postings and sees everything; an Intern posts.
// A Team row that still says "Manager" (the old middle role) counts as Admin.
const PERMISSIONS = {
  Intern:  ['ping', 'properties', 'property', 'posts', 'assignments', 'logPost', 'addLink', 'setStatus'],
  Admin:   ['*'],
};


// ---------------------------------------------------------------- routing

function doGet(e)  { return route_(e.parameter || {}); }
function doPost(e) { return route_(parseBody_(e)); }

function parseBody_(e) {
  var body = {};
  try {
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch (err) { /* fall through to query parameters */ }
  return Object.assign({}, e && e.parameter, body);
}

function route_(req) {
  try {
    var me = identify_(req.key);
    if (!me) return json_({ ok: false, error: 'unauthorized', message: 'This copy of Post-It is not registered. Ask your admin for a key.' });
    if (!allowed_(me.role, req.action)) {
      return json_({ ok: false, error: 'forbidden', message: 'Your account cannot do that.' });
    }
    switch (req.action) {
      case 'ping':        return json_({ ok: true, name: me.name, role: me.role, fbAccounts: me.fbAccounts, time: now_(),
                                     version: SERVER_VERSION, rules: rules_() });
      case 'properties':  return json_({ ok: true, properties: listProperties_(me.canSeeInternal) });
      case 'indexCheck':  return json_(indexCheck_());
      case 'property':    return json_({ ok: true, property: getProperty_(req.id, me.canSeeInternal) });
      case 'posts':       return json_({ ok: true, posts: mine_(me, readRows_(CONFIG.POSTS_TAB, POST_FIELDS), 'postedBy') });
      case 'assignments': return json_({ ok: true, assignments: withWeeks_(mine_(me, readRows_(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS), 'assignedTo')) });
      case 'team':        return json_({ ok: true, team: teamList_() });
      case 'addPerson':   return json_(addPerson_(req, me));
      case 'setActive':   return json_(setActive_(req, me));
      case 'updatePerson': return json_(updatePerson_(req, me));
      case 'newKey':      return json_(newKey_(req, me));
      case 'logPost':     return json_(logPost_(req, me));
      case 'addLink':     return json_(addLink_(req, me));
      case 'saveQueue':   return json_(saveQueue_(req, me));
      case 'saveQueues':  return json_(saveQueues_(req, me));
      case 'setStatus':   return json_(setStatus_(req, me));
      case 'setRules':    return json_(setRules_(req));
      case 'rebuildDirectory': return json_(rebuildDirectory_());
      case 'directoryStatus':  return json_(directoryStatus_());
      default:            return json_({ ok: false, error: 'unknown action: ' + req.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(payload) {
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

function identify_(key) {
  if (!key) return null;
  var team = teamRows_();

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
function teamRows_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('team');
  if (hit) return JSON.parse(hit);
  var rows = readSheet_('Team', TEAM_HEADERS);
  try { cache.put('team', JSON.stringify(rows), 60); } catch (e) { /* ignore */ }
  return rows;
}

/**
 * The Team tab for the app's screens: Admin only (PERMISSIONS). Built field by
 * field so the Key column can never come along with a row. Revoked people are
 * included, with active: false.
 */
function teamList_() {
  return teamRows_()
    .filter(function (t) { return textOf_(t.Name).trim(); })
    .map(personOf_);
}

/**
 * One Team row as the app's TeamMember. Every reply that describes a person is
 * built here, field by field, so the Key column cannot come along with it.
 */
function personOf_(t) {
  return {
    name: textOf_(t.Name),
    role: roleOf_(t.Role),
    email: textOf_(t.Email),
    fbAccounts: accountsOf_(t['FB Accounts']),
    fbProfileLink: textOf_(t['FB Profile Link']).trim(),
    active: String(t.Active).toUpperCase() !== 'FALSE',
  };
}

/** "APG Main, APG Rentals" -> ['APG Main', 'APG Rentals']. */
function accountsOf_(value) {
  return textOf_(value).split(',').map(function (x) { return x.trim(); }).filter(String);
}

function allowed_(role, action) {
  var list = PERMISSIONS[role] || [];
  return list.indexOf('*') !== -1 || list.indexOf(action) !== -1;
}

/** Interns see their own tracker rows and nobody else's. */
function mine_(me, rows, column) {
  if (me.role !== 'Intern') return rows;
  return rows.filter(function (r) { return r[column] === me.name; });
}

/**
 * Editor helper (ADD_PERSON, the spreadsheet menu): add a person and hand back
 * their key. The same checks as the addPerson action; a refusal is thrown.
 */
function addTeamMember_(name, email, role, fbAccounts, fbProfileLink) {
  var result = addPersonNow_({ name: name, email: email, role: role, fbAccounts: fbAccounts, fbProfileLink: fbProfileLink });
  if (!result.ok) throw new Error(result.message);
  return result.key;
}

// ---------------------------------------------------------------- the team, from the app
//
// addPerson, setActive and newKey: Admin only (PERMISSIONS). Each writes the
// Team tab as text (D7), under the script lock, and clears the cached Team tab
// at once, so a new key works and a revoked or replaced one stops on the next
// call rather than a minute later. A key is in the reply of addPerson and
// newKey only, and in no other reply of any action.

/** A fresh key: 32 hex digits. */
function freshKey_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function addPerson_(req, me) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'Someone else is saving. Try again.' };
  try {
    return addPersonNow_(req);
  } finally {
    lock.releaseLock();
  }
}

/** The work of addPerson, for the action and the editor alike. */
function addPersonNow_(req) {
  var name = textOf_(req.name).trim();
  if (!name) return { ok: false, error: 'name-required', message: 'Type the person\'s name.' };

  var role = textOf_(req.role).trim();
  var canonical = ROLES.filter(function (r) { return r.toLowerCase() === role.toLowerCase(); })[0];
  if (!canonical) return { ok: false, error: 'bad-role', message: 'The role must be Admin or Intern.' };

  var accounts = accountsIn_(req.fbAccounts);
  if (accounts.problem) return accounts.problem;
  var link = profileLinkIn_(req.fbProfileLink);
  if (link.problem) return link.problem;

  // Read fresh, not from the cache: a name added a moment ago must count.
  var want = name.toLowerCase();
  var taken = readSheet_('Team', TEAM_HEADERS).some(function (t) { return textOf_(t.Name).trim().toLowerCase() === want; });
  if (taken) return { ok: false, error: 'duplicate', message: 'There is already someone called ' + name + ' on the team.' };

  var row = { Name: name, Email: textOf_(req.email).trim(), Role: canonical, Key: freshKey_(),
              'FB Accounts': accounts.list.join(', '), 'FB Profile Link': link.value, Active: 'TRUE' };
  var sh = plainTab_('Team', TEAM_HEADERS);
  var col = teamColumns_(sh);
  var out = new Array(Math.max(sh.getLastColumn(), TEAM_HEADERS.length)).fill('');
  TEAM_HEADERS.forEach(function (h) { out[col[h]] = textOf_(row[h]); });
  // As text, like every row this script writes (D7): a key of digits would
  // otherwise come back a number, and a name beginning "=" would be a formula.
  appendText_(sh, out, TEAM_HEADERS.map(function (h) { return col[h]; }));
  CacheService.getScriptCache().remove('team');
  return { ok: true, person: personOf_(row), key: row.Key };
}

function setActive_(req, me) {
  requireAll_(req, ['name']);
  var active = req.active;
  if (active === 'true') active = true;
  if (active === 'false') active = false;
  if (active !== true && active !== false) {
    return { ok: false, error: 'bad-active', message: 'Say whether the person is active: true or false.' };
  }
  if (!active && textOf_(req.name).trim().toLowerCase() === textOf_(me.name).trim().toLowerCase()) {
    return { ok: false, error: 'self', message: 'You cannot deactivate yourself. Ask another admin.' };
  }
  return editTeamRow_(req.name, function (sh, r, col, row) {
    row.Active = active ? 'TRUE' : 'FALSE';
    setText_(sh.getRange(r, col.Active + 1), row.Active);
    return { ok: true, person: personOf_(row) };
  });
}

/**
 * updatePerson { name, fbAccounts?, fbProfileLink? }: changes the person's FB
 * broker name(s) and profile link, only the fields sent, with addPerson's
 * checks. Name, role and key never change here. Replies { person }.
 */
function updatePerson_(req, me) {
  requireAll_(req, ['name']);
  var hasAccounts = req.fbAccounts !== undefined;
  var hasLink = req.fbProfileLink !== undefined;
  var accounts = hasAccounts ? accountsIn_(req.fbAccounts) : null;
  if (accounts && accounts.problem) return accounts.problem;
  var link = hasLink ? profileLinkIn_(req.fbProfileLink) : null;
  if (link && link.problem) return link.problem;
  return editTeamRow_(req.name, function (sh, r, col, row) {
    if (accounts) {
      row['FB Accounts'] = accounts.list.join(', ');
      setText_(sh.getRange(r, col['FB Accounts'] + 1), row['FB Accounts']);
    }
    if (link) {
      row['FB Profile Link'] = link.value;
      setText_(sh.getRange(r, col['FB Profile Link'] + 1), row['FB Profile Link']);
    }
    return { ok: true, person: personOf_(row) };
  });
}

/** FB Accounts as sent (a list, or comma-separated text): { list } or { problem }. */
function accountsIn_(value) {
  var accounts = value;
  if (accounts === undefined || accounts === null || accounts === '') accounts = [];
  if (typeof accounts === 'string') accounts = accountsOf_(accounts);
  if (!Array.isArray(accounts) || accounts.some(function (a) { return typeof a !== 'string'; })) {
    return { problem: { ok: false, error: 'bad-accounts', message: 'The Facebook accounts must be a list of names.' } };
  }
  accounts = accounts.map(function (a) { return a.trim(); }).filter(String);
  if (accounts.some(function (a) { return a.indexOf(',') !== -1; })) {
    return { problem: { ok: false, error: 'bad-accounts', message: 'A Facebook account name cannot contain a comma.' } };
  }
  return { list: accounts };
}

// A Facebook profile's address: https, on facebook.com (www., m., web.) or
// fb.com, any path. Typed without a scheme, https:// is put in front first.
// The app applies the same rule (src/core/links.ts, facebookProfileProblem).
const FACEBOOK_PROFILE_HOSTS = ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com'];

/** The profile link as sent: { value } ('' when blank) or { problem }. */
function profileLinkIn_(value) {
  if (value === undefined || value === null) return { value: '' };
  if (typeof value !== 'string') return { problem: badProfileLink_() };
  var text = value.trim();
  if (!text) return { value: '' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'https://' + text;
  var m = /^https:\/\/([^\/?#\s]+)(?:[\/?#][^\s]*)?$/i.exec(text);
  if (!m || FACEBOOK_PROFILE_HOSTS.indexOf(m[1].toLowerCase()) === -1) return { problem: badProfileLink_() };
  return { value: text };
}

function badProfileLink_() {
  return { ok: false, error: 'bad-profile-link', message: 'That isn\'t a Facebook profile link.' };
}

function newKey_(req, me) {
  requireAll_(req, ['name']);
  return editTeamRow_(req.name, function (sh, r, col, row) {
    var key = freshKey_();
    setText_(sh.getRange(r, col.Key + 1), key);
    return { ok: true, key: key };
  });
}

/**
 * Finds the person's one Team row by name, as case-insensitive as addPerson's
 * duplicate check, and hands it to `edit` under the lock. The cached Team tab
 * is cleared after the edit, so the change holds from the next call.
 */
function editTeamRow_(name, edit) {
  var want = textOf_(name).trim().toLowerCase();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'Someone else is saving. Try again.' };
  try {
    var sh = plainTab_('Team', TEAM_HEADERS);
    var col = teamColumns_(sh);
    var values = sh.getDataRange().getValues();
    var found = [];
    for (var r = 1; r < values.length; r++) {
      if (textOf_(values[r][col.Name]).trim().toLowerCase() === want) found.push(r);
    }
    if (!found.length) return { ok: false, error: 'notfound', message: 'There is nobody called ' + textOf_(name).trim() + ' on the team.' };
    if (found.length > 1) {
      return { ok: false, error: 'duplicate', message: 'Two rows on the Team tab are called ' + textOf_(name).trim() + '. Fix the tab first.' };
    }
    var row = {};
    TEAM_HEADERS.forEach(function (h) { row[h] = values[found[0]][col[h]]; });
    var result = edit(sh, found[0] + 1, col, row);
    CacheService.getScriptCache().remove('team');
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * The Team tab's header -> 0-based column. Every one of TEAM_HEADERS must be
 * there, except the optional ones (FB Profile Link), which a tab made before
 * them lacks: such a header is added after the last column, as it is about to
 * be written.
 */
function teamColumns_(sh) {
  var header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(function (h) { return textOf_(h).trim(); });
  var col = {}, missing = [];
  TEAM_HEADERS.forEach(function (h) {
    col[h] = header.indexOf(h);
    if (col[h] === -1 && TEAM_OPTIONAL_HEADERS.indexOf(h) === -1) missing.push(h);
  });
  if (missing.length) throw new Error('The Team tab has no column for: ' + missing.join(', ') + '.');
  TEAM_OPTIONAL_HEADERS.forEach(function (h) {
    if (col[h] !== -1) return;
    var last = sh.getLastColumn();
    if (last >= sh.getMaxColumns()) sh.insertColumnAfter(last);
    setText_(sh.getRange(1, last + 1), h);
    sh.getRange(1, last + 1).setFontWeight('bold');
    col[h] = last;
  });
  return col;
}

/** An active person on the Team tab, by name (case-insensitive), or null. */
function activePerson_(name) {
  var want = textOf_(name).trim().toLowerCase();
  if (!want) return null;
  var row = teamRows_().filter(function (t) {
    return textOf_(t.Name).trim().toLowerCase() === want && String(t.Active).toUpperCase() !== 'FALSE';
  })[0];
  return row ? personOf_(row) : null;
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

function directoryBook_() {
  return CONFIG.DIRECTORY_SHEET_ID
    ? SpreadsheetApp.openById(CONFIG.DIRECTORY_SHEET_ID)
    : book_();
}

/** Every property, cached for a minute so a burst of calls is one read. */
function directoryRows_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('dir');
  if (hit) return JSON.parse(hit);

  var sh = directoryBook_().getSheetByName(CONFIG.DIRECTORY_TAB);
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

/**
 * The Posts tab's Property type for a listing: its Directory category, title
 * cased the way the owner's tracker writes it ("Warehouse", "Commercial
 * Space", "Condo / House and Lot"). Found by folder id; `fallback` (the
 * category the app sent) when the Directory has no such row or cannot be read.
 */
function propertyTypeOf_(propertyId, fallback) {
  var category = '';
  try {
    var id = textOf_(propertyId).trim();
    var row = id ? directoryRows_().filter(function (r) { return r.id === id; })[0] : null;
    if (row) category = textOf_(row.category);
  } catch (e) { /* no directory: use what the app sent */ }
  return propertyType_(category.trim() ? category : fallback);
}

// Lower case inside a title, as the owner writes "Condo / House and Lot".
const TITLE_SMALL_WORDS = ['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with'];

/**
 * A category as the tracker's Property type: "COMMERCIAL SPACE" ->
 * "Commercial Space", "CONDO / HOUSE AND LOT" -> "Condo / House and Lot".
 * Only text written all in one case is recased; "Virtual Office for posting"
 * has been written with care already, and stays as it is. The app's
 * propertyType (core/records.ts), character for character.
 */
function propertyType_(category) {
  var text = textOf_(category).trim().replace(/\s+/g, ' ');
  if (text !== text.toUpperCase() && text !== text.toLowerCase()) return text;
  var index = 0;
  return text.toLowerCase().replace(/[\p{L}\p{N}']+/gu, function (word) {
    var first = index++ === 0;
    if (!first && TITLE_SMALL_WORDS.indexOf(word) !== -1) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}

/** Property name for a folder id. */
function nameOf_(propertyId) {
  var row = directoryRows_().filter(function (r) { return r.id === propertyId; })[0];
  return row ? row.name : '';
}

/** Folder id for a property name, so the client may send either. */
function idOf_(propertyName) {
  var want = String(propertyName || '').trim().toLowerCase();
  var row = directoryRows_().filter(function (r) {
    return String(r.name).trim().toLowerCase() === want;
  })[0];
  return row ? row.id : '';
}

// ---------------------------------------------------------------- properties

/**
 * The search list: small, no document text. With the checker's index joined
 * on, when it can be read: city, size, deal type and availability, and whether
 * the checker knows the listing at all. When it cannot (switched off, or the
 * fetch failed) the rows go out without those fields, and the call still works.
 */
function listProperties_(includeDocId) {
  var checker = checkerIndex_(false);
  var geo = geoIndex_();
  return directoryRows_().map(function (r) {
    var out = {
      id: r.id,
      name: r.name,
      category: r.category,
      listingType: r.listingType,
      subCategory: r.subCategory,
      photoCount: Number(r.photoCount) || 0,
      hasIssues: !!String(r.issues || '').trim(),
      // As BuildDirectory.gs wrote it: the planner skips "No separator" and "No document".
      issues: textOf_(r.issues),
    };
    // The posting document's id, for an Admin's "Open doc" (doc health). Only
    // when there is one, and never to an intern, who has no use for it.
    var docId = textOf_(r.docId).trim();
    if (includeDocId && docId) out.docId = docId;
    joinChecker_(out, checker, r.id);
    joinGeo_(out, geo, r.id);
    return out;
  });
}

/** Adds `lat` and `lng` for folder `id` when the geocoding sheet has them; nothing otherwise. */
function joinGeo_(out, geo, id) {
  var g = geo[textOf_(id).trim()];
  if (g) {
    out.lat = g.lat;
    out.lng = g.lng;
  }
  return out;
}

// ---------------------------------------------------------------- the geocoding sheet
//
// The owner keeps a sheet of where each listing is: FolderId, Property, Query,
// Lat, Lng, GeoStatus, Checked. It is read by header name, joined on FolderId,
// and never written. A row counts only when Lat and Lng are numbers inside the
// Philippines; anything else is left out, so a listing without a good position
// simply has no lat/lng.

const GEO_CACHE = 'geo';
const GEO_CACHE_SECONDS = 600;
// The Philippines, generously: the app's map is drawn over the same box.
const PH_BOUNDS = { south: 4.5, north: 19.5, west: 116.5, east: 127 };

/**
 * Folder ID -> { lat, lng }. Empty when the sheet or tab cannot be found or
 * read: the map is a bonus, never a reason for `properties` to fail. Cached
 * for ten minutes, like the checker's index.
 */
function geoIndex_() {
  var hit = getChunked_(GEO_CACHE);
  if (hit) return hit;
  var index = {};
  try {
    index = readGeoIndex_();
  } catch (e) {
    index = {};
  }
  putChunked_(GEO_CACHE, index, GEO_CACHE_SECONDS);
  return index;
}

function readGeoIndex_() {
  var id = textOf_(CONFIG.GEO_SHEET_ID).trim();
  var book = id ? SpreadsheetApp.openById(id) : directoryBook_();
  var wanted = textOf_(CONFIG.GEO_TAB).trim();
  var sheets = wanted ? [book.getSheetByName(wanted)] : book.getSheets();
  var index = {};
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    if (!sh) continue;
    var values = sh.getDataRange().getValues();
    if (values.length < 1) continue;
    var header = values[0].map(function (h) { return textOf_(h).trim().toLowerCase(); });
    var col = { id: header.indexOf('folderid'), lat: header.indexOf('lat'), lng: header.indexOf('lng') };
    if (col.id === -1 || col.lat === -1 || col.lng === -1) continue;
    values.slice(1).forEach(function (r) {
      var folder = textOf_(r[col.id]).trim();
      var lat = coordinate_(r[col.lat]);
      var lng = coordinate_(r[col.lng]);
      if (!folder || lat === null || lng === null) return;
      if (lat < PH_BOUNDS.south || lat > PH_BOUNDS.north || lng < PH_BOUNDS.west || lng > PH_BOUNDS.east) return;
      index[folder] = { lat: lat, lng: lng };
    });
    return index; // the first tab that has the columns is the one
  }
  return index;
}

/** A cell as a coordinate: a number, or text that is one. null for anything else. */
function coordinate_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : null;
  var text = textOf_(value).trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  var n = Number(text);
  return isFinite(n) ? n : null;
}

/**
 * Adds the checker's fields for folder `id` to `out`: city, size, deal type,
 * availability and inChecker. Nothing when the join is off or the index could
 * not be read (`checker` null), so the fields are then absent.
 */
function joinChecker_(out, checker, id) {
  if (!checker) return out;
  var c = checker[textOf_(id).trim()];
  out.city = c ? c.city : '';
  out.size = c ? c.size : '';
  out.dealType = c ? c.dealType : '';
  out.availability = c ? availabilityOf_(c.status) : '';
  out.inChecker = !!c;
  return out;
}

// ---------------------------------------------------------------- the listing checker's index
//
// The checker is another team's Apps Script. Its Index is published as CSV,
// and that published CSV is all this script touches: one read-only fetch,
// never a write, never its sheet. Rows are joined to the directory on Folder ID.

const CHECKER_COLUMNS = {
  id:       'Folder ID',
  name:     'Folder name',
  city:     'City',
  size:     'Size (sqm)',
  dealType: 'Deal type',
  status:   'Status',
  path:     'Path',
};
const CHECKER_CACHE = 'checker';
const CHECKER_CACHE_SECONDS = 600;
// A cache value is capped at 100 KB. The JSON is made ASCII before it is cut,
// so a chunk of this many characters is this many bytes.
const CACHE_CHUNK_CHARS = 90000;

/**
 * Folder ID -> { name, city, size, dealType, status, path }, or null when the
 * join is switched off or the CSV cannot be read. Cached for ten minutes;
 * `fresh` skips the cache (and refills it).
 */
function checkerIndex_(fresh) {
  var url = textOf_(CONFIG.CHECKER_INDEX_CSV_URL).trim();
  if (!url) return null;

  if (!fresh) {
    var hit = getChunked_(CHECKER_CACHE);
    if (hit) return hit;
  }
  var index = fetchCheckerIndex_(url);
  if (index) putChunked_(CHECKER_CACHE, index, CHECKER_CACHE_SECONDS);
  return index;
}

/** The published CSV, parsed. null on any failure: the join is a bonus, never a reason to fail. */
function fetchCheckerIndex_(url) {
  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (response.getResponseCode() !== 200) return null;
    var rows = Utilities.parseCsv(response.getContentText('UTF-8'));
    if (!rows || rows.length < 1) return null;

    var header = rows[0].map(function (h) { return textOf_(h).replace(/^\uFEFF/, '').trim().toLowerCase(); });
    var col = {};
    Object.keys(CHECKER_COLUMNS).forEach(function (f) { col[f] = header.indexOf(CHECKER_COLUMNS[f].toLowerCase()); });
    // Without Folder ID there is nothing to join on: that is not the Index.
    if (col.id === -1) return null;

    var index = {};
    rows.slice(1).forEach(function (r) {
      var id = textOf_(r[col.id]).trim();
      if (!id) return;
      var entry = {};
      Object.keys(CHECKER_COLUMNS).forEach(function (f) {
        if (f !== 'id') entry[f] = col[f] === -1 ? '' : textOf_(r[col[f]]).trim();
      });
      index[id] = entry;
    });
    return index;
  } catch (e) {
    return null;
  }
}

/** The checker's Status as the app reads it: 'Available', 'Sold', or '' for anything else. */
function availabilityOf_(status) {
  var s = textOf_(status).trim().toLowerCase();
  return s === 'available' ? 'Available' : s === 'sold' ? 'Sold' : '';
}

/** Stores a value too big for one cache entry in several. Best effort: a cache that refuses is skipped. */
function putChunked_(key, value, seconds) {
  try {
    var text = JSON.stringify(value).replace(/[\u0080-\uffff]/g, function (ch) {
      return '\\u' + ('000' + ch.charCodeAt(0).toString(16)).slice(-4);
    });
    var cache = CacheService.getScriptCache();
    var count = Math.max(1, Math.ceil(text.length / CACHE_CHUNK_CHARS));
    for (var i = 0; i < count; i++) {
      cache.put(key + ':' + i, text.slice(i * CACHE_CHUNK_CHARS, (i + 1) * CACHE_CHUNK_CHARS), seconds);
    }
    // Last, so a reader that finds the count finds its chunks.
    cache.put(key + ':n', String(count), seconds);
  } catch (e) { /* not cached; read again next time */ }
}

/** The value putChunked_ stored, or null when any piece of it is gone. */
function getChunked_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var count = Number(cache.get(key + ':n'));
    if (!(count > 0)) return null;
    var text = '';
    for (var i = 0; i < count; i++) {
      var part = cache.get(key + ':' + i);
      if (part === null) return null;
      text += part;
    }
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/**
 * Admin: how the directory and the checker's index disagree. Read fresh, not
 * from the cache, because this is the button somebody presses to find out now.
 */
function indexCheck_() {
  if (!textOf_(CONFIG.CHECKER_INDEX_CSV_URL).trim()) {
    return { ok: false, error: 'checker-off', message: 'The checker\'s index is switched off (CONFIG.CHECKER_INDEX_CSV_URL).' };
  }
  var checker = checkerIndex_(true);
  if (!checker) {
    return { ok: false, error: 'checker-unavailable', message: 'The checker\'s index could not be read. Try again later.' };
  }
  var directory = directoryRows_();
  var ours = {};
  var directoryOnly = [], sold = [];
  directory.forEach(function (r) {
    var id = textOf_(r.id).trim();
    ours[id] = true;
    var c = checker[id];
    if (!c) directoryOnly.push({ id: id, name: r.name });
    else if (availabilityOf_(c.status) === 'Sold') sold.push({ id: id, name: r.name });
  });
  var checkerOnly = Object.keys(checker)
    .filter(function (id) { return !ours[id]; })
    .map(function (id) { return { id: id, name: checker[id].name, path: checker[id].path }; });
  return {
    ok: true,
    checkedAt: now_(),
    directoryCount: directory.length,
    checkerCount: Object.keys(checker).length,
    directoryOnly: directoryOnly,
    checkerOnly: checkerOnly,
    sold: sold,
  };
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
function getProperty_(id, includeInternal) {
  // First, and outside the try below: without the one splitter every live
  // re-read would fail and quietly fall back to the sheet's copy.
  requireSeparators_();

  var row = directoryRows_().filter(function (r) { return r.id === id; })[0];
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
      var cut = splitAtSeparator_(readLiveDoc_(row.docId, DOC_MIME));
      publicText = cut.posting;
      internalText = cut.internal;
      separated = cut.found;
      cutAt = cut.cutAt;
      live = true;
    } catch (e) {
      // Fall back to the sheet's copy rather than failing the whole screen.
    }
  }

  // Nobody has separated this document, so none of it is confirmed safe. Since
  // v7 an intern is sent it anyway, with a warning, because the owner wants
  // these listings posted (D15): the lines that may hold the owner's or the
  // broker's details are flagged, and the app marks them and leaves them out of
  // what Copy copies. A folder with no document, or a document with no text,
  // has nothing to show, and stays withheld as before (D13).
  var unseparated = !separated && !!row.docId && publicText.trim() !== '';
  var withheld = !separated && !includeInternal && !unseparated;
  if (withheld) {
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
    // True when the text was withheld (no document, or nothing in it), so the
    // screen can say why it is empty rather than look broken.
    withheld: withheld,
    // A heading's label quotes the heading ("heading: Commission: 3%"), which
    // is the internal section's first line. An intern is told the kind only.
    cutAt: includeInternal ? cutAt : cutAt.split(':')[0],
    issues: row.issues,
    live: live,
    photos: photos,
  };
  if (includeInternal) out.internalText = internalText;
  // An Admin's reply is as it was: the whole document, to fix it.
  else if (unseparated) {
    out.unseparated = true;
    out.flaggedLines = flaggedLines_(publicText);
  }
  // The same join as the list's, so the screen can rely on the detail alone.
  joinChecker_(out, checkerIndex_(false), row.id);
  return out;
}

/** Separators.gs must be in this project: it is where the postable text ends (D13). */
function requireSeparators_() {
  if (typeof splitAtSeparator_ !== 'function') {
    throw new Error('Separators.gs is missing from this Apps Script project. It decides where a ' +
                    'listing\'s postable text ends: add it beside Code.gs and deploy again.');
  }
}

function readLiveDoc_(fileId, mimeType) {
  if (mimeType === DOC_MIME) return liveDocText_(DocumentApp.openById(fileId));
  if (mimeType === 'text/plain') return DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  return liveDocText_(DocumentApp.openById(fileId));
}

/**
 * getBody().getText() drops bullet glyphs and runs table cells together, which
 * ruins a feature list, so walk the body instead.
 */
function liveDocText_(doc) {
  var body = doc.getBody(), counters = {}, out = [];
  for (var i = 0; i < body.getNumChildren(); i++) out.push(elementText_(body.getChild(i), counters));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function elementText_(el, counters) {
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

function logPost_(req, me) {
  requireAll_(req, ['property', 'propertyId', 'fbAccount']);

  // Every post is logged with its link, so the tracker can always be checked
  // against Facebook. Pending means posted in a group, awaiting its admin.
  var link = textOf_(req.postLink).trim();
  var problem = postLinkProblem_(link);
  if (problem) return problem;
  var status = textOf_(req.status);
  if (status !== 'Posted' && status !== 'Pending') {
    return { ok: false, error: 'bad-status', message: 'Say whether the post is Posted or Pending.' };
  }

  // Who the row is credited to comes from the key, not from the request, so an
  // intern cannot log a post against somebody else's name. An admin may log on
  // someone's behalf, but only for a person who is on the Team tab and active,
  // and only from one of that person's own accounts.
  var poster = me;
  if (me.role !== 'Intern' && textOf_(req.postedBy).trim()) {
    poster = activePerson_(req.postedBy);
    if (!poster) {
      return { ok: false, error: 'unknown-person',
               message: 'There is nobody active called ' + textOf_(req.postedBy).trim() + ' on the team.' };
    }
  }
  var postedBy = poster.name;

  if (poster.fbAccounts.length && poster.fbAccounts.indexOf(req.fbAccount) === -1) {
    var who = poster === me ? 'You are' : poster.name + ' is';
    return { ok: false, error: 'forbidden', message: who + ' not assigned to ' + req.fbAccount + '.' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'Someone else is saving. Try again.' };
  try {
    // One reading of the clock for the check and the row, so the two cannot
    // fall either side of midnight.
    var when = new Date();
    var guard = cooldownFor_(req.propertyId, req.property, when);
    if (guard) return guard;

    // The date as ISO text, which the app reads; the time as the interns'
    // own sheet writes it, "10:23 AM", on Manila's clock.
    var date = Utilities.formatDate(when, CONFIG.TZ, 'yyyy-MM-dd');
    var time = Utilities.formatDate(when, CONFIG.TZ, 'HH:mm');
    // The listing's category from the Directory; what the app sent only when
    // the Directory has no row for it.
    var type = propertyTypeOf_(req.propertyId, req.type);

    appendRow_(CONFIG.POSTS_TAB, POST_FIELDS, {
      date:       date,
      type:       type,
      title:      req.property,
      fbAccount:  req.fbAccount,
      postLink:   link,
      time:       clockTime_(time),
      status:     status,
      postedBy:   postedBy,
      propertyId: req.propertyId,
    });
    setAssignmentStatus_(req.propertyId, req.property, postedBy, status);
    // The row as written. The app shows these, never its own clock or user.
    // The time goes back as HH:mm, the app's format.
    return { ok: true, status: status, date: date, time: time, type: type, postedBy: postedBy };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Returns a refusal object when the property is inside its cooldown, else null.
 * The cooldown is the live rule (rules_), which the admin sets from the app.
 *
 * The app applies the same rule before it asks (src/core/cooldown.ts), and
 * the two must agree:
 *
 * - Every row counts, Pending as much as Posted: a post still waiting for the
 *   group admin's approval must stop a second intern posting the same listing. The app reads any
 *   status but Pending as Posted, so no row is left out there either.
 * - A row is the property's when the folder ids agree, if both have one, so a
 *   renamed folder keeps its history; otherwise when the names agree as the
 *   app's matcher normalises them.
 * - Days are calendar days in Manila. Counting 24-hour spans from UTC midnight
 *   refused until 08:00 on the day the app said posting was allowed again.
 * - A date the app cannot read is skipped, as the app skips it.
 */
function cooldownFor_(propertyId, propertyName, when) {
  var key = normalizeName_(propertyName);
  var latest = '';
  readRows_(CONFIG.POSTS_TAB, POST_FIELDS).forEach(function (p) {
    if (!sameProperty_(p.propertyId, p.title, propertyId, key)) return;
    var day = sheetDay_(p.date);
    if (day && day > latest) latest = day;
  });
  if (!latest) return null;

  var cooldownDays = rules_().cooldownDays;
  var last = dayNumber_(latest);
  var today = dayNumber_(Utilities.formatDate(when || new Date(), CONFIG.TZ, 'yyyy-MM-dd'));
  // A row dated after today, from a skewed clock, counts as posted today.
  var daysAgo = Math.max(0, today - last);
  if (daysAgo >= cooldownDays) return null;

  var next = last + cooldownDays;
  return {
    ok: false,
    error: 'cooldown',
    lastPosted:  latest,
    nextAllowed: isoDay_(next),
    // The app's own sentence for the same refusal (cooldown.ts).
    message: 'Posted ' + ago_(daysAgo) + ' (' + dayMonth_(last) + '). The cooldown is ' +
             days_(cooldownDays) + ' \u{2014} it can be posted again on ' + fullDate_(next) + '.',
  };
}

// A Facebook post's address: https, on one of Facebook's own hosts. The app
// applies the same rule before it asks (src/core/links.ts).
const FACEBOOK_HOSTS = ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com', 'fb.me'];

/** A refusal for a post link that is missing or not Facebook's, else null. */
function postLinkProblem_(value) {
  var text = textOf_(value).trim();
  if (!text) return { ok: false, error: 'link-required', message: 'Paste the post\'s link.' };
  var m = /^https:\/\/([^\/?#\s]+)(?:[\/?#][^\s]*)?$/i.exec(text);
  if (!m || FACEBOOK_HOSTS.indexOf(m[1].toLowerCase()) === -1) {
    return { ok: false, error: 'bad-link', message: 'That isn\'t a Facebook link.' };
  }
  return null;
}

/** Turn a Pending row into Posted once the live link exists. */
function addLink_(req, me) {
  requireAll_(req, ['postLink']);
  if (!req.propertyId && !req.property) throw new Error('missing: property');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var sh = sheetFor_(CONFIG.POSTS_TAB, POST_FIELDS);
    var values = sh.getDataRange().getValues();
    var col = columnsIn_(values[0], POST_FIELDS, sh.getName());
    var tz = zoneOf_(sh);

    // By folder id when both the row and the request have one, otherwise by
    // name: rows logged before the PropertyId column was added have no id.
    var name = req.property || nameOf_(req.propertyId);
    var id = req.propertyId || idOf_(name);
    var key = normalizeName_(name) || null;   // a blank name finds no row by name

    for (var r = values.length - 1; r >= 1; r--) {
      var p = fieldsOf_(values[r], POST_FIELDS, col, tz);
      if (!sameProperty_(p.propertyId, p.title, id, key)) continue;
      if (postStatus_(p.status) !== 'Pending') continue;
      if (me.role === 'Intern' && p.postedBy !== me.name) continue;  // not yours

      setText_(sh.getRange(r + 1, col.status + 1), 'Posted');
      setText_(sh.getRange(r + 1, col.postLink + 1), String(req.postLink).trim());
      setAssignmentStatus_(id, name, p.postedBy, 'Posted');
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

// ---------------------------------------------------------------- the tracker's times
//
// The interns' sheet writes "10:23 AM". The app reads and shows HH:mm
// (tracker.ts readSheetTime), so the posts action gives every time back as
// HH:mm, whichever way the cell was written.

const TRACKER_CLOCK = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:\s*([ap])\.?\s*m\.?)?$/i;

/** "14:30" -> "2:30 PM", "00:15" -> "12:15 AM". */
function clockTime_(hhmm) {
  var h = +hhmm.slice(0, 2), m = hhmm.slice(3, 5);
  return (h % 12 === 0 ? 12 : h % 12) + ':' + m + (h < 12 ? ' AM' : ' PM');
}

/** "2:30 PM", "2:30pm", "14:30", "9:05" -> HH:mm. Anything else is returned as it was. */
function sheetTime_(text) {
  var m = TRACKER_CLOCK.exec(textOf_(text).trim());
  if (!m) return text;
  var h = +m[1], min = +m[2], half = m[3] ? m[3].toLowerCase() : '';
  if (min > 59) return text;
  if (half) {
    if (h < 1 || h > 12) return text;
    h = (h % 12) + (half === 'p' ? 12 : 0);
  } else if (h > 23) {
    return text;
  }
  return pad2_(h) + ':' + pad2_(min);
}

// ---------------------------------------------------------------- the queue's words
//
// A queue item not posted yet is "Not Shared", the word the interns' own
// sheet uses. Rows written before that say "To post": the same thing.

const NOT_SHARED = 'Not Shared';

/** A queue status as written: Posted, Pending, or else Not Shared ("To post" included). */
function queueStatus_(value) {
  var s = textOf_(value).trim().toLowerCase();
  if (s === 'posted') return 'Posted';
  if (s === 'pending') return 'Pending';
  return NOT_SHARED;
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

// ---------------------------------------------------------------- the work week (v6)
//
// Queues are weekly: Monday to Friday, and Friday is the deadline. A week is
// named by its Monday, yyyy-MM-dd on Manila's calendar (the "week key"), and
// an Assignments row's Date holds it. Saturday and Sunday belong to the NEXT
// week: the reset happens after Friday. The app's src/core/week.ts is the
// same rule.

/** The week key of a yyyy-MM-dd day: Mon–Fri give that Monday, Sat and Sun the next. '' for anything else. */
function weekOf_(iso) {
  var text = textOf_(iso).trim();
  if (!TRACKER_DAY.test(text) || !calendarDay_(+text.slice(0, 4), +text.slice(5, 7), +text.slice(8, 10))) return '';
  var day = dayNumber_(text);
  var weekday = new Date(day * DAY_MS).getUTCDay();   // 0 Sun … 6 Sat
  if (weekday === 0) return isoDay_(day + 1);
  if (weekday === 6) return isoDay_(day + 2);
  return isoDay_(day - (weekday - 1));
}

/** True for a real yyyy-MM-dd day that is a Monday. */
function isMonday_(iso) {
  var text = textOf_(iso).trim();
  return text !== '' && weekOf_(text) === text;   // a weekend maps to a later day, never itself
}

/** Manila's date now, yyyy-MM-dd: the server's "today" for the held rule. */
function today_() {
  return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd');
}

/** True once `today` is past the week's Friday: its open rows are Missed and hold nothing. */
function isWeekOver_(week, today) {
  return dayNumber_(today) > dayNumber_(week) + 4;
}

/** "2–6 Nov", or "30 Oct – 3 Nov" across months, for a week key. */
function weekLabel_(week) {
  var mon = new Date(dayNumber_(week) * DAY_MS);
  var fri = new Date((dayNumber_(week) + 4) * DAY_MS);
  if (mon.getUTCMonth() === fri.getUTCMonth()) {
    return mon.getUTCDate() + '\u2013' + fri.getUTCDate() + ' ' + TRACKER_MONTHS[fri.getUTCMonth()];
  }
  return mon.getUTCDate() + ' ' + TRACKER_MONTHS[mon.getUTCMonth()] + ' \u2013 ' +
         fri.getUTCDate() + ' ' + TRACKER_MONTHS[fri.getUTCMonth()];
}

/**
 * The week a saveQueue(s) request names: `week`, which must be a Monday, else
 * `date`, any day, read as its week (an app written for daily queues).
 * Returns { week } or a refusal.
 */
function requestWeek_(req) {
  var week = textOf_(req.week).trim();
  if (week) {
    if (!isMonday_(week)) {
      return { refusal: { ok: false, error: 'bad-week', message: 'The week must be a Monday written yyyy-MM-dd, not "' + week + '".' } };
    }
    return { week: week };
  }
  var date = textOf_(req.date).trim();
  if (!date) return { refusal: { ok: false, error: 'missing: week' } };
  var fromDate = weekOf_(date);
  if (!fromDate) return { refusal: { ok: false, error: 'bad-date', message: 'The date must be a day written yyyy-MM-dd.' } };
  return { week: fromDate };
}

/** Assignments rows as the reply gives them: each with its `week`, the Date kept as written. */
function withWeeks_(rows) {
  return rows.map(function (a) {
    return Object.assign({}, a, { week: weekOf_(sheetDay_(a.date)) });
  });
}

// ---------------------------------------------------------------- queues

function saveQueue_(req, me) {
  requireAll_(req, ['assignedTo']);
  var when = requestWeek_(req);
  if (when.refusal) return when.refusal;
  var items = req.items || [];
  if (typeof items === 'string') items = JSON.parse(items);
  var queue = {
    assignedTo: String(req.assignedTo),
    items: (Array.isArray(items) ? items : []).map(function (it) {
      it = it || {};
      return {
        property:   textOf_(it.property !== undefined ? it.property : it.propertyName),
        propertyId: textOf_(it.propertyId).trim(),
        status:     it.status,
      };
    }),
  };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    return saveHeldChecked_(when.week, [queue]);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Several interns' queues for one week, all or none: everything is checked
 * before anything is written, and the writing is done under one hold of the
 * lock, so nobody sees half a week's plan or saves into the middle of it.
 */
function saveQueues_(req, me) {
  var when = requestWeek_(req);
  if (when.refusal) return when.refusal;
  var week = when.week;
  var queues = req.queues;
  if (typeof queues === 'string') {
    try { queues = JSON.parse(queues); } catch (e) { queues = null; }
  }
  if (!Array.isArray(queues)) return { ok: false, error: 'bad-queues', message: 'Send the queues as a list.' };

  var seen = {}, clean = [];
  for (var q = 0; q < queues.length; q++) {
    var queue = queues[q] || {};
    var person = activePerson_(queue.assignedTo);
    if (!person || person.role !== 'Intern') {
      return { ok: false, error: 'bad-intern',
               message: textOf_(queue.assignedTo).trim() + ' is not an active intern on the Team tab.' };
    }
    if (seen[person.name]) {
      return { ok: false, error: 'bad-queues', message: person.name + ' has two queues for the week of ' + weekLabel_(week) + '. Send one.' };
    }
    seen[person.name] = true;
    var items = queue.items || [];
    if (!Array.isArray(items)) return { ok: false, error: 'bad-queues', message: person.name + '\'s items must be a list.' };
    var named = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var property = textOf_(it.propertyName !== undefined ? it.propertyName : it.property).trim();
      if (!property) {
        return { ok: false, error: 'bad-queues', message: 'Item ' + (i + 1) + ' of ' + person.name + '\'s queue has no property.' };
      }
      named.push({ property: property, propertyId: textOf_(it.propertyId).trim(), status: textOf_(it.status).trim() });
    }
    clean.push({ assignedTo: person.name, items: named });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'Someone else is saving. Try again.' };
  try {
    return saveHeldChecked_(week, clean);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- held listings
//
// The owner's rule: a listing assigned to an intern is held by that intern
// until it is posted, or until the week of that queue is over (v6). An open
// Assignments row (Not Shared, or the older "To post") holds the listing for
// its assignee while its week (weekOf_ its Date) is not over on Manila's
// today; after that Friday it is Missed and holds nothing. Posted and Pending
// release it. Nobody else may be given a held listing, and the same intern
// may not be given it again in another week. Re-saving the same intern's
// queue for the same week is a replace, so their own rows of that week hold
// nothing; and taking an item out of a queue releases it. A row whose date
// can't be read belongs to no week and holds nothing.

/**
 * Saves the queues when nothing in them is held, all or none. The caller
 * holds the lock, so the check and the writing see the same rows.
 */
function saveHeldChecked_(week, queues) {
  // Each item's folder id, found once: the check and the rows written agree.
  queues.forEach(function (q) {
    q.items.forEach(function (it) { it.propertyId = it.propertyId || idOf_(it.property); });
  });
  var held = heldItems_(week, queues);
  if (held.length) {
    return { ok: false, error: 'held', held: held, message: heldMessage_(held) };
  }
  return { ok: true, saved: replaceQueues_(week, queues) };
}

/**
 * The items in `queues` that someone holds: [{ propertyName, propertyId,
 * heldBy, date, week }], in request order, one per item. `date` is the
 * holding row's Date as a day, `week` its week. Matched the way every
 * tracker row is (sameProperty_): by folder id when both have one, else by
 * name as the app normalises it. A listing sent in two of the queues is held
 * by the first of them.
 */
function heldItems_(week, queues) {
  var sh = sheetFor_(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS);
  var values = sh.getDataRange().getValues();
  var col = values.length ? columnsIn_(values[0], ASSIGN_FIELDS, sh.getName()) : null;
  var tz = zoneOf_(sh);
  var today = today_();
  var replaced = {};
  queues.forEach(function (q) { replaced[q.assignedTo] = true; });

  var open = [];
  for (var r = 1; col && r < values.length; r++) {
    if (!values[r].join('')) continue;
    var a = fieldsOf_(values[r], ASSIGN_FIELDS, col, tz);
    if (queueStatus_(a.status) !== NOT_SHARED) continue;
    var day = sheetDay_(a.date);
    var rowWeek = weekOf_(day);
    // Missed (its week is over), or in no week at all: it holds nothing.
    if (!rowWeek || isWeekOver_(rowWeek, today)) continue;
    // The rows this save replaces (replaceQueues_ deletes exactly these) hold nothing.
    if (rowWeek === week && Object.prototype.hasOwnProperty.call(replaced, a.assignedTo)) continue;
    open.push({ propertyId: a.propertyId, property: a.property, heldBy: a.assignedTo, date: day, week: rowWeek });
  }

  var held = [];
  var given = [];   // what this request gives out, so no listing goes to two of its queues
  queues.forEach(function (q) {
    q.items.forEach(function (it) {
      var key = normalizeName_(it.property) || null;   // a blank name finds no row by name
      var holder = null;
      for (var i = 0; i < open.length && !holder; i++) {
        if (sameProperty_(open[i].propertyId, open[i].property, it.propertyId, key)) holder = open[i];
      }
      for (var g = 0; g < given.length && !holder; g++) {
        if (given[g].heldBy !== q.assignedTo &&
            sameProperty_(given[g].propertyId, given[g].property, it.propertyId, key)) holder = given[g];
      }
      if (holder) {
        held.push({ propertyName: it.property, propertyId: it.propertyId || '', heldBy: holder.heldBy,
                    date: holder.date, week: holder.week });
      } else {
        given.push({ propertyId: it.propertyId, property: it.property, heldBy: q.assignedTo, date: week, week: week });
      }
    });
  });
  return held;
}

/** "Casa Amara is already with Ana Reyes. Remove it from their queue first.", naming the first. */
function heldMessage_(held) {
  var first = held[0];
  var more = held.length > 1 ? ' ' + (held.length - 1) + ' more ' + (held.length === 2 ? 'is' : 'are') + ' held too.' : '';
  return first.propertyName + ' is already with ' + first.heldBy + ' (queue for the week of ' + weekLabel_(first.week) + '). ' +
         'Remove it from their queue first.' + more;
}

/**
 * Replaces each named person's Assignments rows of `week` with their items,
 * and leaves everyone else's alone. Their rows of that week are the ones whose
 * Date is in it: the week key, or a day written before v6. The new rows' Date
 * is the week key. The caller holds the lock. Returns the number of rows
 * written.
 */
function replaceQueues_(week, queues) {
  var sh = sheetFor_(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS);
  var values = sh.getDataRange().getValues();
  var col = columnsIn_(values[0], ASSIGN_FIELDS, sh.getName());
  var tz = zoneOf_(sh);
  var named = {};
  queues.forEach(function (q) { named[q.assignedTo] = true; });

  for (var r = values.length - 1; r >= 1; r--) {
    var a = fieldsOf_(values[r], ASSIGN_FIELDS, col, tz);
    if (Object.prototype.hasOwnProperty.call(named, a.assignedTo) && weekOf_(sheetDay_(a.date)) === week) sh.deleteRow(r + 1);
  }
  var saved = 0;
  queues.forEach(function (q) {
    q.items.forEach(function (it) {
      appendRow_(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS, {
        date:       week,
        assignedTo: q.assignedTo,
        property:   it.property,
        status:     queueStatus_(it.status),
        propertyId: it.propertyId || idOf_(it.property),
      });
      saved++;
    });
  });
  return saved;
}

/** Set one queue item's status directly (the client's UpdateAssignmentAsync). */
function setStatus_(req, me) {
  requireAll_(req, ['property', 'assignedTo', 'status']);
  if (me.role === 'Intern' && req.assignedTo !== me.name) {
    return { ok: false, error: 'forbidden', message: 'That is not your queue item.' };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var id = req.propertyId || idOf_(req.property);
    // "To post", from an older app, is written as Not Shared.
    var row = setAssignmentStatus_(id, req.property, req.assignedTo, queueStatus_(req.status));
    if (!row) {
      return {
        ok: false,
        error: 'notfound',
        message: 'There is no open queue item for ' + req.property + ' assigned to ' + req.assignedTo +
                 '. Reload the queue: it may have changed.',
      };
    }
    // Approved in the group: the post itself is live now too, or Records and
    // the Tracker would go on calling it Pending. Only the assignee's own post,
    // which for an intern is checked above to be their own.
    if (queueStatus_(req.status) === 'Posted') markPostPosted_(id, req.property, req.assignedTo);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Marks the person's newest Pending post of the property as Posted: by folder
 * id when both have one, otherwise by name as the app normalises it. Only
 * the newest, since an older Pending row is an earlier post the group admin
 * never approved. Its link is kept. Returns its row number, or 0 when there is
 * none (a queue item marked done by hand, with no post logged, is fine). The
 * caller holds the lock.
 */
function markPostPosted_(propertyId, propertyName, postedBy) {
  var sh = sheetFor_(CONFIG.POSTS_TAB, POST_FIELDS);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return 0;
  var col = columnsIn_(values[0], POST_FIELDS, sh.getName());
  var tz = zoneOf_(sh);
  var key = normalizeName_(propertyName) || null;   // a blank name finds no row by name
  var who = textOf_(postedBy);

  var best = 0, bestDay = '';
  for (var r = values.length - 1; r >= 1; r--) {
    var p = fieldsOf_(values[r], POST_FIELDS, col, tz);
    if (!sameProperty_(p.propertyId, p.title, propertyId, key)) continue;
    if (p.postedBy !== who) continue;
    if (postStatus_(p.status) !== 'Pending') continue;
    // Newest by date; on a tie, or a date nobody can read, the lower row.
    var day = sheetDay_(p.date);
    if (!best || day > bestDay) { best = r; bestDay = day; }
  }
  if (!best) return 0;
  setText_(sh.getRange(best + 1, col.status + 1), 'Posted');
  return best + 1;
}

/**
 * Moves the person's open queue item for the property to `status`: the lowest
 * such row, and never one already Posted. Returns its row number, or 0 when
 * there is none.
 */
function setAssignmentStatus_(propertyId, propertyName, assignedTo, status) {
  var sh = sheetFor_(CONFIG.ASSIGNMENTS_TAB, ASSIGN_FIELDS);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return 0;
  var col = columnsIn_(values[0], ASSIGN_FIELDS, sh.getName());
  var tz = zoneOf_(sh);
  var key = normalizeName_(propertyName) || null;   // a blank name finds no row by name

  for (var r = values.length - 1; r >= 1; r--) {
    var a = fieldsOf_(values[r], ASSIGN_FIELDS, col, tz);
    if (!sameProperty_(a.propertyId, a.property, propertyId, key)) continue;
    if (a.assignedTo !== textOf_(assignedTo)) continue;
    if (queueStatus_(a.status) === 'Posted') continue;
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

// The Posts tab's columns, in the order a new tab gets them: the interns' own
// "POSTING TRACKER - INTERNS" sheet's, then Posted by and Property ID, which
// the records and the cooldown need. The first spelling is the one a new tab
// is given; the rest are older spellings, still read, so an existing tab
// keeps working.
const POST_FIELDS = {
  date:       { headers: ['Date'], required: true },
  type:       { headers: ['Property type', 'Type', 'Category'] },
  title:      { headers: ['Property title', 'Title', 'Property', 'Property Name'], required: true },
  fbAccount:  { headers: ['FB account name', 'FB Account', 'Account', 'Facebook Account', 'FB'] },
  postLink:   { headers: ['Link', 'Post Link', 'URL', 'Facebook Link'], required: true },
  time:       { headers: ['Time posted', 'Time'] },
  status:     { headers: ['Share posting', 'Status'], required: true },
  postedBy:   { headers: ['Posted by', 'Intern', 'By'], required: true },
  propertyId: { headers: ['Property ID', 'PropertyId', 'Folder Id'] },
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

function book_() {
  if (CONFIG.TRACKER_SHEET_ID) return SpreadsheetApp.openById(CONFIG.TRACKER_SHEET_ID);
  var bound = SpreadsheetApp.getActiveSpreadsheet();
  if (!bound) throw new Error('CONFIG.TRACKER_SHEET_ID is not set, and this script is not bound to the tracker.');
  return bound;
}

/** Where the script's own tabs live — private, because Team holds the keys. */
function adminBook_() {
  return CONFIG.ADMIN_SHEET_ID ? SpreadsheetApp.openById(CONFIG.ADMIN_SHEET_ID) : book_();
}

/** The tab, created with default headers only when it does not exist yet. */
function sheetFor_(name, fields) {
  var ss = book_();
  var sh = ss.getSheetByName(name);
  if (sh) return sh;

  var headers = Object.keys(fields).map(function (f) { return fields[f].headers[0]; });
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

/** Logical field name -> 0-based column index, from the sheet's own header row. */
function columnsOf_(sh, fields) {
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
function readRows_(name, fields) {
  var sh = sheetFor_(name, fields);
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
  // "10:23 AM", as the script writes it and the interns type it: HH:mm.
  if (field === 'time') return sheetTime_(String(value));
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
function appendRow_(name, fields, values) {
  var sh = sheetFor_(name, fields);
  var col = columnsOf_(sh, fields);
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
 * whatever format the tracker gives it. Not Sheet.appendRow(), which cannot format
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
function readSheet_(name, headers) {
  var ss = adminBook_();
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
function plainTab_(name, headers) {
  var ss = adminBook_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ---------------------------------------------------------------- odds and ends

function activeEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function now_() { return Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }

function truthy_(v) { return v === true || v === 'true' || v === '1'; }

function requireAll_(req, names) {
  var missing = names.filter(function (n) { return !req[n]; });
  if (missing.length) throw new Error('missing: ' + missing.join(', '));
}

// ---------------------------------------------------------------- the rules
//
// The cooldown, the repost age and the planner's items per intern. The admin
// changes them from the app (setRules); they are kept on the Settings tab of
// the private admin sheet, one Key and Value per row, as text. A rule the tab
// does not have, or has as something other than a whole number in range, is
// CONFIG's default. Every reader goes through rules_(), the cooldown check
// included, so a change holds from the next call.

const SETTINGS_TAB = 'Settings';
const SETTINGS_HEADERS = ['Key', 'Value'];
const RULES_CACHE = 'rules';
const RULES_CACHE_SECONDS = 30;

/**
 * Each rule: its default (CONFIG), the whole numbers it may be, the Key it is
 * written under on the Settings tab, and the Keys it is read from, first
 * found wins. Keys are compared ignoring case, spaces and underscores, so
 * "Per week", "perWeek" and "per_week" are one key. v6: perWeek, the
 * listings per intern per week, replaces perIntern; an older tab's
 * "Per intern" (or "perIntern") is read when there is no good "Per week".
 */
function ruleSpecs_() {
  return {
    cooldownDays:  { fallback: CONFIG.COOLDOWN_DAYS,   min: 1, max: 60,  label: 'The cooldown',
                     key: 'cooldownDays',  reads: ['cooldownDays'] },
    repostDueDays: { fallback: CONFIG.REPOST_DUE_DAYS, min: 1, max: 120, label: 'The repost age',
                     key: 'repostDueDays', reads: ['repostDueDays'] },
    perWeek:       { fallback: CONFIG.PER_WEEK,        min: 1, max: 200, label: 'Listings per week',
                     key: 'Per week',      reads: ['Per week', 'Per intern'] },
  };
}

/** A Settings tab Key as compared: "Per week" → "perweek". */
function settingKey_(value) {
  return textOf_(value).replace(/[\s_]+/g, '').toLowerCase();
}

/** A whole number, as a number or its digits, or null. */
function wholeNumber_(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  var text = textOf_(value).trim();
  return /^\d{1,6}$/.test(text) ? Number(text) : null;
}

/**
 * { cooldownDays, repostDueDays, perWeek, perIntern }: the live rules, cached
 * briefly. perIntern is perWeek again, under its old name, for an app built
 * before v6.
 */
function rules_() {
  var cache = CacheService.getScriptCache();
  try {
    var hit = cache.get(RULES_CACHE);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* read the tab */ }

  var specs = ruleSpecs_();
  var saved = {};   // settingKey_ → the first value under it
  var sh = adminBook_().getSheetByName(SETTINGS_TAB);
  if (sh && sh.getLastRow() >= 2) {
    sh.getDataRange().getValues().slice(1).forEach(function (r) {
      var key = settingKey_(r[0]);
      if (key && !Object.prototype.hasOwnProperty.call(saved, key)) saved[key] = r[1];
    });
  }
  var out = {};
  Object.keys(specs).forEach(function (k) {
    var spec = specs[k];
    out[k] = spec.fallback;
    for (var i = 0; i < spec.reads.length; i++) {
      var n = wholeNumber_(saved[settingKey_(spec.reads[i])]);
      if (n !== null && n >= spec.min && n <= spec.max) { out[k] = n; break; }
    }
  });
  out.perIntern = out.perWeek;
  try { cache.put(RULES_CACHE, JSON.stringify(out), RULES_CACHE_SECONDS); } catch (e) { /* ignore */ }
  return out;
}

/**
 * setRules { cooldownDays?, repostDueDays?, perWeek? }: Admin only. perIntern,
 * perWeek's old name, is read when perWeek is not sent. Every field sent is
 * checked before any is written; a field left out stays as it is. Written as
 * text on the Settings tab (perWeek under "Per week"), under the lock.
 * Replies { rules }.
 */
function setRules_(req) {
  var specs = ruleSpecs_();
  var asked = {
    cooldownDays: req.cooldownDays,
    repostDueDays: req.repostDueDays,
    perWeek: blank_(req.perWeek) ? req.perIntern : req.perWeek,
  };
  var changes = {};
  var problem = null;
  Object.keys(specs).forEach(function (k) {
    if (problem || blank_(asked[k])) return;
    var n = wholeNumber_(asked[k]);
    var spec = specs[k];
    if (n === null || n < spec.min || n > spec.max) {
      problem = { ok: false, error: 'bad-rules', field: k,
                  message: spec.label + ' must be a whole number from ' + spec.min + ' to ' + spec.max + '.' };
      return;
    }
    changes[k] = n;
  });
  if (problem) return problem;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'Someone else is saving. Try again.' };
  try {
    var keys = Object.keys(changes);
    if (keys.length) {
      var sh = plainTab_(SETTINGS_TAB, SETTINGS_HEADERS);
      var values = sh.getDataRange().getValues();
      keys.forEach(function (k) {
        var key = specs[k].key;
        var row = 0;
        for (var r = 1; r < values.length; r++) {
          if (settingKey_(values[r][0]) === settingKey_(key)) { row = r + 1; break; }
        }
        if (row) {
          setText_(sh.getRange(row, 2), String(changes[k]));
        } else {
          appendText_(sh, [key, String(changes[k])], [0, 1]);
          values.push([key, String(changes[k])]);
        }
      });
    }
    CacheService.getScriptCache().remove(RULES_CACHE);
    return { ok: true, rules: rules_() };
  } finally {
    lock.releaseLock();
  }
}

function blank_(value) { return value === undefined || value === null || value === ''; }

// ---------------------------------------------------------------- rebuilding the directory from the app
//
// BuildDirectory.gs's RESTART scans the whole library, which takes minutes:
// far longer than a web request may run. So rebuildDirectory only schedules
// it, on a one-off trigger for RESTART_FROM_APP (BuildDirectory.gs) about ten
// seconds later, and answers at once. directoryStatus says how it is going,
// from the script properties BuildDirectory keeps (cursor, total, builtAt).

const REBUILD_HANDLER = 'RESTART_FROM_APP';
const REBUILD_DELAY_MS = 10 * 1000;

/** True when a trigger for RESTART_FROM_APP is waiting to fire. */
function rebuildScheduled_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === REBUILD_HANDLER; });
}

/** Admin: schedules a full rebuild of the directory. busy while one is running or scheduled. */
function rebuildDirectory_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'Someone else is saving. Try again.' };
  try {
    if (typeof RESTART_FROM_APP !== 'function') {
      return { ok: false, error: 'no-builder',
               message: 'BuildDirectory.gs is missing from this Apps Script project. Add it beside Code.gs and deploy again.' };
    }
    var status = directoryStatus_();
    if (status.running) {
      return { ok: false, error: 'busy',
               message: 'The directory is already being rebuilt (' + status.done + ' of ' + status.total + ' done).' };
    }
    ScriptApp.newTrigger(REBUILD_HANDLER).timeBased().after(REBUILD_DELAY_MS).create();
    return { ok: true, started: true };
  } finally {
    lock.releaseLock();
  }
}

/** Admin: { running, done, total, builtAt }. builtAt is '' until a build has finished. */
function directoryStatus_() {
  var props = PropertiesService.getScriptProperties();
  var done = Number(props.getProperty('cursor') || 0) || 0;
  var total = Number(props.getProperty('total') || 0) || 0;
  // Scheduled, or RESTART still scanning the library before it has set cursor and total.
  var starting = typeof rebuildStarting_ === 'function' && rebuildStarting_(props);
  var running = (total > 0 && done < total) || rebuildScheduled_() || starting;
  return { ok: true, running: running, done: done, total: total, builtAt: textOf_(props.getProperty('builtAt')) };
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
 * is no Post-It menu). Run it once, with your own name and role Admin, to get
 * the first admin key: it is printed in the execution log and written on the
 * Team tab. Add everyone else from the app (Settings > Team).
 */
function ADD_PERSON() {
  var name       = 'Your Name';
  var role       = 'Admin';           // Admin (assigns postings) | Intern
  var fbAccounts = '';                // FB broker name(s), comma separated; blank = any
  var fbProfileLink = '';             // optional: https://www.facebook.com/...

  var key = addTeamMember_(name, '', role, fbAccounts, fbProfileLink);
  Logger.log('%s (%s) key: %s', name, role, key);
  return key;
}

/** Check that everything this script depends on is reachable. */
function SETUP() {
  requireSeparators_();
  Logger.log('Separators.gs: present.');
  Logger.log('Server version: %s.', SERVER_VERSION);
  Logger.log('Rules: %s.', JSON.stringify(rules_()));
  var properties = listProperties_();
  Logger.log('Directory: %s properties.', properties.length);
  Logger.log('Tracker tab "%s": %s rows.', CONFIG.POSTS_TAB, readRows_(CONFIG.POSTS_TAB, POST_FIELDS).length);
  Logger.log('Team: %s people.', teamRows_().length);
  if (!textOf_(CONFIG.CHECKER_INDEX_CSV_URL).trim()) {
    Logger.log('Checker index: switched off.');
  } else {
    var checker = checkerIndex_(true);
    Logger.log(checker ? 'Checker index: %s listings.' : 'Checker index: could not be read%s.',
               checker ? Object.keys(checker).length : '');
  }
  if (!properties.length) {
    Logger.log('The directory is empty — run BuildDirectory.gs before using the app.');
  }
}

function promptAddTeamMember() {
  var ui = SpreadsheetApp.getUi();
  var name = ui.prompt('Full name').getResponseText();
  if (!name) return;
  var role = ui.prompt('Role: Admin or Intern').getResponseText();
  var fb = ui.prompt('FB broker name: the Facebook account name they post as (comma separated, blank = any)').getResponseText();
  var link = ui.prompt('FB profile link (optional)').getResponseText();
  var key = addTeamMember_(name, '', role, fb, link);
  ui.alert('Key for ' + name + ':\n\n' + key + '\n\nPaste it into their copy of Post-It. It is on the Team tab if you need it again.');
}
