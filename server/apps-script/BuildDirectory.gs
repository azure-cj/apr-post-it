/**
 * APG — build the listing directory sheet.
 *
 * Walks the Drive library and writes one row per property into the directory
 * spreadsheet: category, listing type, name, photo download links, and the
 * posting text from the document with the owner's section stripped off.
 *
 * Paste this into a NEW standalone Apps Script project (script.google.com) and
 * run START. It needs no advanced services and no manifest editing.
 *
 *   START      begin. Refuses if a run is already going.
 *   STATUS     how far along it is
 *   CONTINUE   resume after a STOP (a live run does this by itself)
 *   STOP       pause
 *   RESTART    throw away all progress and build again from zero
 *
 * There can be thousands of folders, and Apps Script stops a function after six
 * minutes, so CONTINUE does about four minutes of work, saves its place, and
 * schedules itself again a minute later. Leave it alone and it finishes.
 */

var CFG = {
  ROOT_FOLDER_ID: '1GXeGULYswb7jXcMGCCRm2RQ_h0EKsDll',   // the "APR LISTING" folder
  SHEET_ID: '1jelzICcu6rmR-mQqK7tGD19VieN6B4Y2L6fNaMMkjTs',

  TAB: 'Directory',
  QUEUE_TAB: '_Queue',

  // Top-level folders that are not property categories.
  EXCLUDE: [
    'sold', 'contents', 'hiring', 'archive', 'templates', 'old',
    'hiring-intern-staff-format',
    'vo',                          // LOGOS, PEGS, PICSS, VIDS — design assets
  ],

  // How deep to keep descending before treating a folder as a property.
  MAX_DEPTH: 4,

  // A sub-folder whose name looks like this is a listing type, not a property.
  LISTING_TYPE: /^\s*for\s+(sale|lease|rent)\b/i,

  BATCH_SECONDS: 240,
  TZ: 'Asia/Manila',
};

var HEADERS = [
  'Category', 'Listing type', 'Sub-category', 'Property', 'Folder',
  'Photos', 'Photo links', 'Posting text', 'Cut at', 'Owner section', 'Issues',
  // The app reads these two. FolderId is each property's stable id — folders
  // can be renamed, ids cannot. DocId lets it re-read the document live when
  // somebody opens a property, so a typo fixed minutes ago is already gone.
  'FolderId', 'DocId',
];

// ---------------------------------------------------------------- commands

function START() {
  var props = PropertiesService.getScriptProperties();
  var done = Number(props.getProperty('cursor') || 0);
  var total = Number(props.getProperty('total') || 0);

  if (total && done < total) {
    Logger.log('A run is already going: %s of %s properties done.', done, total);
    Logger.log('It continues on its own every minute — leave it be, or run STATUS to check.');
    Logger.log('To throw it away and begin again from zero, run RESTART.');
    return;
  }
  RESTART();
}

/** Discard any progress and build the directory from scratch. */
function RESTART() {
  STOP();
  var book = SpreadsheetApp.openById(CFG.SHEET_ID);

  var queue;
  try {
    queue = scanFolders_();
  } catch (e) {
    // Almost always a root folder this account cannot see. Say so in plain
    // words and run the diagnosis straight away rather than making you find it.
    Logger.log('Could not open the library folder %s.', CFG.ROOT_FOLDER_ID);
    Logger.log('Looking for the right one...\n');
    FIND_ROOT();
    Logger.log('\nPut the id above into CFG.ROOT_FOLDER_ID at the top, then run START again.');
    return;
  }
  if (!queue.length) {
    Logger.log('That folder has no sub-folders. Is %s the folder that holds the categories?',
               CFG.ROOT_FOLDER_ID);
    return;
  }

  var q = resetTab_(book, CFG.QUEUE_TAB, ['Category', 'Listing type', 'Sub-category', 'Property', 'FolderId']);
  if (queue.length) q.getRange(2, 1, queue.length, 5).setValues(queue);

  var out = resetTab_(book, CFG.TAB, HEADERS);
  out.setFrozenRows(1);
  out.setColumnWidth(4, 260);
  out.setColumnWidth(7, 220);
  out.setColumnWidth(8, 520);
  out.hideColumns(12, 2);        // FolderId, DocId: for the app, not for reading

  PropertiesService.getScriptProperties().setProperties({ cursor: '0', total: String(queue.length) });
  Logger.log('Queued %s properties across %s categories.', queue.length, countCategories_(queue));
  CONTINUE();
}

function CONTINUE() {
  var props = PropertiesService.getScriptProperties();
  var cursor = Number(props.getProperty('cursor') || 0);
  var total = Number(props.getProperty('total') || 0);
  if (!total) { Logger.log('Nothing queued. Run START first.'); return; }

  var book = SpreadsheetApp.openById(CFG.SHEET_ID);
  var queue = book.getSheetByName(CFG.QUEUE_TAB);
  var out = book.getSheetByName(CFG.TAB);

  var started = Date.now();
  var rows = [];

  while (cursor < total && (Date.now() - started) / 1000 < CFG.BATCH_SECONDS) {
    var item = queue.getRange(cursor + 2, 1, 1, 5).getValues()[0];
    rows.push(describe_(item[0], item[1], item[2], item[3], item[4]));
    cursor++;

    if (rows.length >= 25) { flush_(out, rows); rows = []; props.setProperty('cursor', String(cursor)); }
  }
  if (rows.length) flush_(out, rows);
  props.setProperty('cursor', String(cursor));

  if (cursor < total) {
    Logger.log('%s of %s done. Continuing in a minute.', cursor, total);
    ScriptApp.newTrigger('CONTINUE').timeBased().after(60 * 1000).create();
  } else {
    clearTriggers_();
    book.getSheetByName(CFG.QUEUE_TAB).hideSheet();
    Logger.log('Finished: %s properties written to "%s".', total, CFG.TAB);
  }
}

function STOP() {
  clearTriggers_();
  Logger.log('Stopped. STATUS shows where it got to; CONTINUE resumes.');
}

function STATUS() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('%s of %s properties written.',
             props.getProperty('cursor') || 0, props.getProperty('total') || 0);
}

// ---------------------------------------------------------------- scanning

/**
 * Walk the library.
 *
 * The depth is not fixed. COMMERCIAL SPACE goes Category > For lease >
 * Property, while CONDO / HOUSE AND LOT goes Category > FOR SALE > Lot >
 * Property. So rather than counting levels, a folder is taken to be a property
 * when it holds files, and otherwise to be another layer of organisation.
 */
function scanFolders_() {
  var root = DriveApp.getFolderById(CFG.ROOT_FOLDER_ID);
  var queue = [];

  forEachFolder_(root, function (category) {
    if (CFG.EXCLUDE.indexOf(category.getName().trim().toLowerCase()) !== -1) return;
    descend_(category, category.getName(), '', '', 1, queue);
  });

  queue.sort(function (a, b) {
    return (a[0] + '|' + a[1] + '|' + a[2] + '|' + a[3])
      .localeCompare(b[0] + '|' + b[1] + '|' + b[2] + '|' + b[3]);
  });
  return queue;
}

function descend_(folder, category, listingType, subCategory, depth, queue) {
  forEachFolder_(folder, function (child) {
    var name = child.getName();

    // Holds files, so it is a property. Past MAX_DEPTH, stop regardless.
    if (depth >= CFG.MAX_DEPTH || child.getFiles().hasNext()) {
      queue.push([category, listingType, subCategory, name, child.getId()]);
      return;
    }

    // Another layer: a For sale / For lease folder, or a sub-category like "Lot".
    var isListingType = CFG.LISTING_TYPE.test(name);
    descend_(child,
             category,
             isListingType ? name : listingType,
             isListingType ? subCategory : name,
             depth + 1,
             queue);
  });
}

function forEachFolder_(parent, fn) {
  var it = parent.getFolders();
  while (it.hasNext()) fn(it.next());
}

// ---------------------------------------------------------------- one property

function describe_(category, listingType, subCategory, name, folderId) {
  var issues = [];
  var photos = [], doc = null;

  try {
    var files = DriveApp.getFolderById(folderId).getFiles();
    while (files.hasNext()) {
      var f = files.next();
      var mime = f.getMimeType();
      if (mime.indexOf('image/') === 0) photos.push(f);
      else if (!doc && isDoc_(f, mime)) doc = f;
    }
  } catch (e) {
    issues.push('Could not open folder: ' + e.message);
  }

  var posting = '', hasOwner = 'No', cutAt = '';
  if (!doc) {
    issues.push('No document');
  } else {
    try {
      var split = splitAtSeparator_(readDoc_(doc));
      posting = split.posting;
      hasOwner = split.found ? 'Yes' : 'No';
      cutAt = split.cutAt;
      if (!split.found) issues.push('No separator line — the whole document is treated as postable. Check it.');
      if (!posting.trim()) issues.push('Document is empty above the separator');
    } catch (e) {
      issues.push('Could not read document: ' + e.message);
    }
  }
  if (!photos.length) issues.push('No photos');

  return [
    category,
    listingType,
    subCategory,
    name,
    'https://drive.google.com/drive/folders/' + folderId,
    photos.length,
    photos.map(function (p) { return 'https://drive.google.com/uc?export=download&id=' + p.getId(); }).join('\n'),
    posting,
    cutAt,
    hasOwner,
    issues.join(' · '),
    folderId,
    doc ? doc.getId() : '',
  ];
}

function isDoc_(file, mime) {
  return mime === MimeType.GOOGLE_DOCS
      || mime === MimeType.MICROSOFT_WORD
      || mime === 'text/plain'
      || /\.(docx?|txt|md)$/i.test(file.getName());
}

/**
 * Split the document into what may be posted and what may not.
 *
 * The documents do not agree on one marker. Some use a line of underscores,
 * others a line of heavy bars, and the broker-only section is sometimes just a
 * heading. So every known marker is checked and the text is cut at whichever
 * comes FIRST — the cautious direction, since too little posted is a nuisance
 * and too much is a leak. Which marker was used is reported in "Cut at" so the
 * result can be audited.
 */
function splitAtSeparator_(text) {
  var raw = String(text || '').replace(/\r\n?/g, '\n');
  var lines = raw.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var kind = markerKind_(line);
    if (kind) {
      return { posting: lines.slice(0, i).join('\n').trim(), found: true, cutAt: kind };
    }
  }

  // Underscores running into the text rather than sitting on their own line.
  var inline = raw.search(/_{2,}/);
  if (inline !== -1) {
    return { posting: raw.slice(0, inline).trim(), found: true, cutAt: 'inline __' };
  }
  return { posting: raw.trim(), found: false, cutAt: '' };
}

function markerKind_(line) {
  if (/^\s*_{2,}\s*$/.test(line))                  return '__ line';
  if (/^\s*[─-╿]{3,}\s*$/.test(line))    return 'bar line';
  if (/^\s*[=~]{3,}\s*$/.test(line))               return '=== line';
  if (/^\s*[-]{5,}\s*$/.test(line))                return '--- line';

  // A broker-only heading, with or without decoration around it.
  if (/^\s*[*_=\-#•\s]*(owner|internal|commission|net\s+to\s+owner|net\s+price|for\s+agents?|do\s+not\s+post|not\s+for\s+posting)\b/i
        .test(line)) {
    return 'heading: ' + line.trim().replace(/\s+/g, ' ').slice(0, 40);
  }
  // "1 MONTH STANDARD COMMISSION" and friends: a short all-caps line naming it.
  if (/^[^a-z]{0,60}\b(COMMISSION|NET TO OWNER|OWNER'?S? (DETAILS|INFO))\b/.test(line.trim())) {
    return 'heading: ' + line.trim().replace(/\s+/g, ' ').slice(0, 40);
  }
  return '';
}

/** Google Docs natively; .docx by converting a temporary copy; .txt as bytes. */
function readDoc_(file) {
  var mime = file.getMimeType();
  if (mime === MimeType.GOOGLE_DOCS) return docToText_(DocumentApp.openById(file.getId()));
  if (mime === 'text/plain' || /\.(txt|md)$/i.test(file.getName())) {
    return file.getBlob().getDataAsString('UTF-8');
  }
  // A .docx has to be converted first, and that needs the advanced Drive
  // service (Services + > Drive). Everything else here works without it.
  if (typeof Drive === 'undefined') {
    throw new Error('Word file — enable the Drive advanced service, or save it as a Google Doc');
  }
  var copy = Drive.Files.copy({ title: 'tmp-postit' }, file.getId(), { convert: true });
  try {
    return docToText_(DocumentApp.openById(copy.id));
  } finally {
    try { DriveApp.getFileById(copy.id).setTrashed(true); } catch (e) {}
  }
}

/**
 * getBody().getText() drops bullet glyphs and runs table cells together, which
 * ruins a feature list, so walk the body instead.
 */
function docToText_(doc) {
  var body = doc.getBody(), counters = {}, out = [];
  for (var i = 0; i < body.getNumChildren(); i++) out.push(element_(body.getChild(i), counters));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function element_(el, counters) {
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

// ---------------------------------------------------------------- sheet bits

function flush_(sheet, rows) {
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length)
       .setValues(rows)
       .setVerticalAlignment('top')
       .setWrap(false);
}

function resetTab_(book, name, headers) {
  var sh = book.getSheetByName(name);
  if (sh) { sh.showSheet(); sh.clear(); } else { sh = book.insertSheet(name); }
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  return sh;
}

function clearTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'CONTINUE') ScriptApp.deleteTrigger(t);
  });
}

function countCategories_(queue) {
  var seen = {};
  queue.forEach(function (r) { seen[r[0]] = 1; });
  return Object.keys(seen).length;
}

// ---------------------------------------------------------------- diagnosis

/**
 * Run this when START says it cannot find the root folder. It reports which
 * account is actually running, whether the configured id resolves, and — by
 * looking for the category folders by name — what the right id probably is.
 */
function FIND_ROOT() {
  Logger.log('Running as: %s', Session.getEffectiveUser().getEmail());

  try {
    var f = DriveApp.getFolderById(CFG.ROOT_FOLDER_ID);
    Logger.log('Configured id resolves to "%s" — so the problem is elsewhere.', f.getName());
  } catch (e) {
    Logger.log('Configured id %s: NOT VISIBLE to this account.', CFG.ROOT_FOLDER_ID);
  }

  ['COMMERCIAL SPACE', 'OFFICE SPACE', 'WAREHOUSE', 'LOT'].forEach(function (name) {
    var found = false;
    var it = DriveApp.getFoldersByName(name);
    while (it.hasNext()) {
      found = true;
      var folder = it.next();
      var parents = folder.getParents();
      if (!parents.hasNext()) Logger.log('"%s" sits at the top of a drive (no parent folder).', name);
      while (parents.hasNext()) {
        var p = parents.next();
        Logger.log('"%s" is inside "%s"  ->  ROOT_FOLDER_ID: %s', name, p.getName(), p.getId());
      }
    }
    if (!found) Logger.log('"%s": no folder of that name is visible to this account.', name);
  });
}
