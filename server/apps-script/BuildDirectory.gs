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
 *   START      scan the folders and queue every property   (seconds)
 *   CONTINUE   read docs and write rows, in batches         (runs itself until done)
 *   STOP       cancel a run in progress
 *   STATUS     how far along it is
 *
 * There can be thousands of folders, and Apps Script stops a function after six
 * minutes, so CONTINUE does about four minutes of work, saves its place, and
 * schedules itself again a minute later. Leave it alone and it finishes.
 */

var CFG = {
  ROOT_FOLDER_ID: '1GXeGULYswb7jXcMGCCRm2RQ_h0EKsDlI',
  SHEET_ID: '1jelzICcu6rmR-mQqK7tGD19VieN6B4Y2L6fNaMMkjTs',

  TAB: 'Directory',
  QUEUE_TAB: '_Queue',

  // Top-level folders that are not property categories.
  EXCLUDE: ['sold', 'contents', 'hiring', 'archive', 'templates', 'old'],

  // A sub-folder whose name looks like this is a listing type, not a property.
  LISTING_TYPE: /^\s*for\s+(sale|lease|rent)\b/i,

  BATCH_SECONDS: 240,
  TZ: 'Asia/Manila',
};

var HEADERS = [
  'Category', 'Listing type', 'Property', 'Folder',
  'Photos', 'Photo links', 'Posting text', 'Owner section', 'Issues',
];

// ---------------------------------------------------------------- commands

function START() {
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

  var q = resetTab_(book, CFG.QUEUE_TAB, ['Category', 'Listing type', 'Property', 'FolderId']);
  if (queue.length) q.getRange(2, 1, queue.length, 4).setValues(queue);

  var out = resetTab_(book, CFG.TAB, HEADERS);
  out.setFrozenRows(1);
  out.setColumnWidth(3, 260);
  out.setColumnWidth(6, 220);
  out.setColumnWidth(7, 520);

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
    var item = queue.getRange(cursor + 2, 1, 1, 4).getValues()[0];
    rows.push(describe_(item[0], item[1], item[2], item[3]));
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

/** Category -> (For sale | For lease) -> property. A category may also hold properties directly. */
function scanFolders_() {
  var root = DriveApp.getFolderById(CFG.ROOT_FOLDER_ID);
  var queue = [];

  forEachFolder_(root, function (category) {
    if (CFG.EXCLUDE.indexOf(category.getName().trim().toLowerCase()) !== -1) return;

    forEachFolder_(category, function (child) {
      if (CFG.LISTING_TYPE.test(child.getName())) {
        forEachFolder_(child, function (property) {
          queue.push([category.getName(), child.getName(), property.getName(), property.getId()]);
        });
      } else {
        // No For sale / For lease level under this category.
        queue.push([category.getName(), '', child.getName(), child.getId()]);
      }
    });
  });

  queue.sort(function (a, b) {
    return (a[0] + '|' + a[1] + '|' + a[2]).localeCompare(b[0] + '|' + b[1] + '|' + b[2]);
  });
  return queue;
}

function forEachFolder_(parent, fn) {
  var it = parent.getFolders();
  while (it.hasNext()) fn(it.next());
}

// ---------------------------------------------------------------- one property

function describe_(category, listingType, name, folderId) {
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

  var posting = '', hasOwner = 'No';
  if (!doc) {
    issues.push('No document');
  } else {
    try {
      var split = splitAtSeparator_(readDoc_(doc));
      posting = split.posting;
      hasOwner = split.found ? 'Yes' : 'No';
      if (!split.found) issues.push('No "__" separator — the whole document is treated as postable. Check it.');
      if (!posting.trim()) issues.push('Document is empty above the separator');
    } catch (e) {
      issues.push('Could not read document: ' + e.message);
    }
  }
  if (!photos.length) issues.push('No photos');

  return [
    category,
    listingType,
    name,
    'https://drive.google.com/drive/folders/' + folderId,
    photos.length,
    photos.map(function (p) { return 'https://drive.google.com/uc?export=download&id=' + p.getId(); }).join('\n'),
    posting,
    hasOwner,
    issues.join(' · '),
  ];
}

function isDoc_(file, mime) {
  return mime === MimeType.GOOGLE_DOCS
      || mime === MimeType.MICROSOFT_WORD
      || mime === 'text/plain'
      || /\.(docx?|txt|md)$/i.test(file.getName());
}

/**
 * The owner's details sit below a line of underscores. Everything above it is
 * what gets posted.
 */
function splitAtSeparator_(text) {
  var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');

  for (var i = 0; i < lines.length; i++) {
    if (/^\s*_{2,}\s*$/.test(lines[i])) {
      return { posting: lines.slice(0, i).join('\n').trim(), found: true };
    }
  }
  // Underscores run into the text rather than sitting on their own line.
  var inline = String(text || '').search(/_{2,}/);
  if (inline !== -1) {
    return { posting: String(text).slice(0, inline).trim(), found: true };
  }
  // Last resort: a heading that names the owner's section.
  for (var j = 0; j < lines.length; j++) {
    if (/^\s*[*_=\-#\s]*(owner|internal|commission|for agents?|do not post)\b/i.test(lines[j])) {
      return { posting: lines.slice(0, j).join('\n').trim(), found: true };
    }
  }
  return { posting: String(text || '').trim(), found: false };
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
