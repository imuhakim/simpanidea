/**
 * SimpanIdea backend (Fasa 0).
 * Simpan gambar ke Google Drive dan maklumat ke Google Sheets.
 *
 * Setup: jalankan fungsi setup() sekali, salin kunci rahsia dari log,
 * kemudian Deploy > Web app (Execute as: Me, Who has access: Anyone).
 */

var ROOT_FOLDER_NAME = 'SimpanIdea';
var IMAGE_FOLDER_NAME = 'Screenshot';
var SPREADSHEET_NAME = 'SimpanIdea Data';
var ITEM_SHEET_NAME = 'Item';
var ITEM_HEADERS = [
  'id', 'dicipta', 'jenis', 'tajuk', 'url', 'nota',
  'drive_file_id', 'drive_url', 'nama_fail', 'saiz_bait', 'status'
];

var ITEM_STATUSES = ['baru', 'dilihat'];

var MAX_IMAGE_BYTES = 15 * 1024 * 1024;
var MAX_TITLE_LENGTH = 500;
var MAX_TEXT_LENGTH = 5000;
var MAX_URL_LENGTH = 2000;
var IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Jalankan sekali dari editor. Selamat dijalankan semula; kunci lama dikekalkan. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var root = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  props.setProperty('ROOT_FOLDER_ID', root.getId());

  if (!props.getProperty('SPREADSHEET_ID')) {
    var spreadsheet = SpreadsheetApp.create(SPREADSHEET_NAME);
    DriveApp.getFileById(spreadsheet.getId()).moveTo(root);
    var sheet = spreadsheet.getSheets()[0];
    sheet.setName(ITEM_SHEET_NAME);
    sheet.getRange(1, 1, 1, ITEM_HEADERS.length).setValues([ITEM_HEADERS]);
    sheet.setFrozenRows(1);
    props.setProperty('SPREADSHEET_ID', spreadsheet.getId());
  }

  if (!props.getProperty('APP_SECRET')) {
    props.setProperty('APP_SECRET', newSecret_());
  }

  Logger.log('Kunci rahsia SimpanIdea: ' + props.getProperty('APP_SECRET'));
  Logger.log('Folder Drive: ' + root.getUrl());
}

/** Jalankan kalau kunci rahsia terdedah. App perlu dimasukkan kunci baru. */
function rotateSecret() {
  var secret = newSecret_();
  PropertiesService.getScriptProperties().setProperty('APP_SECRET', secret);
  Logger.log('Kunci rahsia baru: ' + secret);
}

function doGet() {
  return jsonResponse_({ ok: true, app: 'SimpanIdea' });
}

function doPost(e) {
  try {
    var request = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('APP_SECRET');
    if (!secret) return jsonResponse_({ ok: false, code: 'not_setup', error: 'Jalankan setup() dahulu.' });
    if (request.secret !== secret) return jsonResponse_({ ok: false, code: 'unauthorized', error: 'Kunci rahsia salah.' });

    if (request.action === 'ping') return jsonResponse_({ ok: true, app: 'SimpanIdea' });
    if (request.action === 'saveItem') return jsonResponse_(saveItem_(request.item));
    if (request.action === 'listItems') return jsonResponse_(listItems_());
    if (request.action === 'getImage') return jsonResponse_(getImage_(request.id));
    if (request.action === 'setStatus') return jsonResponse_(setStatus_(request.id, request.status));
    return jsonResponse_({ ok: false, code: 'bad_request', error: 'Tindakan tidak dikenali.' });
  } catch (err) {
    return jsonResponse_({ ok: false, code: 'error', error: String(err && err.message || err) });
  }
}

function saveItem_(item) {
  var clean = validateItem_(item);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var file = null;
  try {
    var sheet = getItemSheet_();

    // App mengulang hantar kalau jawapan hilang, jadi id yang sama tidak disimpan dua kali.
    var existingRow = findRowById_(sheet, clean.id);
    if (existingRow) {
      return { ok: true, duplicate: true, id: clean.id, driveUrl: cellValue_(sheet, existingRow, 'drive_url') };
    }

    var now = new Date();
    if (clean.type === 'image') file = saveImage_(clean, now);

    sheet.appendRow([
      clean.id,
      now.toISOString(),
      clean.type,
      safeCell_(clean.title),
      safeCell_(clean.url),
      safeCell_(clean.text),
      file ? file.getId() : '',
      file ? file.getUrl() : '',
      file ? file.getName() : '',
      clean.bytes ? clean.bytes.length : '',
      'baru'
    ]);

    return { ok: true, id: clean.id, driveUrl: file ? file.getUrl() : '' };
  } catch (err) {
    if (file) file.setTrashed(true);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function listItems_() {
  var sheet = getItemSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, items: [] };
  var rows = sheet.getRange(2, 1, lastRow - 1, ITEM_HEADERS.length).getValues();
  var col = {};
  ITEM_HEADERS.forEach(function (name, index) { col[name] = index; });
  var items = rows.filter(function (row) { return row[col.id]; }).map(function (row) {
    var created = row[col.dicipta];
    return {
      id: String(row[col.id]),
      createdAt: created instanceof Date ? created.toISOString() : String(created),
      type: String(row[col.jenis]),
      title: String(row[col.tajuk]),
      url: String(row[col.url]),
      text: String(row[col.nota]),
      driveUrl: String(row[col.drive_url]),
      status: String(row[col.status])
    };
  });
  return { ok: true, items: items };
}

function getImage_(id) {
  var cleanId = validateId_(id);
  var sheet = getItemSheet_();
  var row = findRowById_(sheet, cleanId);
  if (!row) return { ok: false, code: 'not_found', error: 'Item tidak dijumpai.' };
  // Hanya fail yang direkod dalam Sheet boleh dibaca, bukan sebarang fail Drive.
  var fileId = cellValue_(sheet, row, 'drive_file_id');
  if (!fileId) return { ok: false, code: 'not_found', error: 'Item ini tiada gambar.' };
  var blob = DriveApp.getFileById(String(fileId)).getBlob();
  return { ok: true, mimeType: blob.getContentType(), dataBase64: Utilities.base64Encode(blob.getBytes()) };
}

function setStatus_(id, status) {
  var cleanId = validateId_(id);
  if (ITEM_STATUSES.indexOf(status) === -1) throw new Error('Status tidak sah.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getItemSheet_();
    var row = findRowById_(sheet, cleanId);
    if (!row) return { ok: false, code: 'not_found', error: 'Item tidak dijumpai.' };
    sheet.getRange(row, ITEM_HEADERS.indexOf('status') + 1).setValue(status);
    return { ok: true, id: cleanId, status: status };
  } finally {
    lock.releaseLock();
  }
}

function getItemSheet_() {
  return SpreadsheetApp
    .openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'))
    .getSheetByName(ITEM_SHEET_NAME);
}

function validateId_(id) {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(String(id))) throw new Error('Id tidak sah.');
  return String(id);
}

function validateItem_(item) {
  if (!item || typeof item !== 'object') throw new Error('Item kosong.');
  if (['image', 'link', 'note'].indexOf(item.type) === -1) throw new Error('Jenis tidak sah.');

  var clean = {
    id: validateId_(item.id),
    type: item.type,
    title: cleanText_(item.title, MAX_TITLE_LENGTH),
    text: cleanText_(item.text, MAX_TEXT_LENGTH),
    url: cleanUrl_(item.url)
  };

  if (item.type === 'image') {
    clean.extension = IMAGE_EXTENSIONS[item.mimeType];
    if (!clean.extension) throw new Error('Format gambar tidak disokong.');
    clean.mimeType = item.mimeType;
    clean.bytes = Utilities.base64Decode(String(item.dataBase64 || ''));
    if (!clean.bytes.length) throw new Error('Gambar kosong.');
    if (clean.bytes.length > MAX_IMAGE_BYTES) throw new Error('Gambar terlalu besar.');
  } else if (item.type === 'link' && !clean.url) {
    throw new Error('Link tidak sah.');
  } else if (item.type === 'note' && !clean.text && !clean.title) {
    throw new Error('Nota kosong.');
  }
  return clean;
}

function saveImage_(clean, now) {
  var timeZone = Session.getScriptTimeZone();
  var name = Utilities.formatDate(now, timeZone, 'yyyyMMdd-HHmmss') + '-' +
    clean.id.slice(0, 8) + '.' + clean.extension;
  var blob = Utilities.newBlob(clean.bytes, clean.mimeType, name);
  return getMonthFolder_(now, timeZone).createFile(blob);
}

function getMonthFolder_(now, timeZone) {
  var rootId = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID');
  var images = getOrCreateFolder_(DriveApp.getFolderById(rootId), IMAGE_FOLDER_NAME);
  return getOrCreateFolder_(images, Utilities.formatDate(now, timeZone, 'yyyy-MM'));
}

function getOrCreateFolder_(parent, name) {
  var folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function findRowById_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var match = sheet.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(id)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : null;
}

function cellValue_(sheet, row, header) {
  return sheet.getRange(row, ITEM_HEADERS.indexOf(header) + 1).getValue();
}

function cleanText_(value, maxLength) {
  return value == null ? '' : String(value).slice(0, maxLength);
}

function cleanUrl_(value) {
  var url = value == null ? '' : String(value).trim();
  if (url.length > MAX_URL_LENGTH || !/^https?:\/\/\S+$/i.test(url)) return '';
  return url;
}

/** Elak teks yang dikongsi daripada dianggap formula oleh Sheets. */
function safeCell_(value) {
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

function newSecret_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function jsonResponse_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
