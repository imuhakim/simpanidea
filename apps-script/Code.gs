/**
 * SimpanIdea backend.
 * Gambar disimpan dalam Google Drive, maklumat lain dalam Google Sheets.
 *
 * Setup: jalankan fungsi setup() sekali, salin kunci rahsia dari log,
 * kemudian Deploy > Web app (Execute as: Me, Who has access: Anyone).
 */

var ROOT_FOLDER_NAME = 'SimpanIdea';
var IMAGE_FOLDER_NAME = 'Screenshot';
var SPREADSHEET_NAME = 'SimpanIdea Data';

// Lajur baru mesti ditambah di hujung supaya data sedia ada tidak teralih.
var SHEETS = {
  Item: ['id', 'dicipta', 'jenis', 'tajuk', 'url', 'nota', 'drive_file_id', 'drive_url', 'nama_fail', 'saiz_bait', 'status', 'ruang', 'gambar'],
  Tugasan: ['id', 'dicipta', 'tajuk', 'nota', 'siap', 'tarikh_akhir', 'gambar', 'kemas_kini'],
  Kad: ['id', 'dicipta', 'tajuk', 'nota', 'lajur_id', 'kedudukan', 'gambar', 'kemas_kini'],
  Lajur: ['id', 'tajuk', 'kedudukan'],
  Kelas: ['id', 'dicipta', 'nama', 'url', 'username', 'password_sulit', 'status', 'terakhir_dibuka', 'berhenti_di', 'nota', 'gambar', 'kemas_kini'],
  Tetapan: ['id', 'nilai']
};
var DEFAULT_COLUMNS = [
  ['lajur-nak-buat', 'Nak buat', '1024'],
  ['lajur-sedang-buat', 'Sedang buat', '2048'],
  ['lajur-siap', 'Siap', '3072']
];

// Lajur Item yang boleh diubah selepas dicipta. Fail dan pautan Drive tidak boleh ditukar.
var ITEM_EDITABLE = ['tajuk', 'nota', 'status', 'ruang', 'gambar'];
var ALLOWED_VALUES = {
  'Item.status': ['baru', 'dilihat'],
  'Item.ruang': ['', 'info', 'lampiran'],
  'Kelas.status': ['belum', 'tengah', 'siap'],
  'Tugasan.siap': ['', 'ya']
};
var RESOLVABLE_HOSTS = [
  'vm.tiktok.com', 'vt.tiktok.com', 'www.tiktok.com', 'tiktok.com', 'm.tiktok.com',
  'fb.watch', 'www.facebook.com', 'facebook.com', 'm.facebook.com', 'web.facebook.com',
  'youtu.be', 'www.youtube.com', 'youtube.com', 'm.youtube.com'
];

var MAX_IMAGE_BYTES = 15 * 1024 * 1024;
var MAX_TITLE_LENGTH = 500;
var MAX_TEXT_LENGTH = 5000;
var MAX_URL_LENGTH = 2000;
var IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Jalankan dari editor. Selamat dijalankan semula; kunci dan data sedia ada dikekalkan. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var root = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  props.setProperty('ROOT_FOLDER_ID', root.getId());

  if (!props.getProperty('SPREADSHEET_ID')) {
    var spreadsheet = SpreadsheetApp.create(SPREADSHEET_NAME);
    DriveApp.getFileById(spreadsheet.getId()).moveTo(root);
    spreadsheet.getSheets()[0].setName('Item');
    var first = spreadsheet.getSheets()[0];
    first.getRange(1, 1, 1, SHEETS.Item.length).setValues([SHEETS.Item]);
    first.setFrozenRows(1);
    props.setProperty('SPREADSHEET_ID', spreadsheet.getId());
  }

  Object.keys(SHEETS).forEach(getSheet_);

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

    switch (request.action) {
      case 'ping': return jsonResponse_({ ok: true, app: 'SimpanIdea' });
      case 'listAll': return jsonResponse_(listAll_());
      case 'saveItem': return jsonResponse_(saveItem_(request.item));
      case 'getImage': return jsonResponse_(getImage_(request.id));
      case 'saveRecord': return jsonResponse_(saveRecord_(request.table, request.record));
      case 'deleteRecord': return jsonResponse_(deleteRecord_(request.table, request.id));
      case 'resolveUrl': return jsonResponse_(resolveUrl_(request.url));
      default: return jsonResponse_({ ok: false, code: 'bad_request', error: 'Tindakan tidak dikenali.' });
    }
  } catch (err) {
    return jsonResponse_({ ok: false, code: 'error', error: String(err && err.message || err) });
  }
}

/* Membaca */

function listAll_() {
  var tables = {};
  Object.keys(SHEETS).forEach(function (name) { tables[name] = readTable_(name); });
  return { ok: true, tables: tables };
}

function readTable_(name) {
  var sheet = getSheet_(name);
  var headers = SHEETS[name];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
    .filter(function (row) { return row[0]; })
    .map(function (row) {
      var record = {};
      headers.forEach(function (header, index) { record[header] = readCell_(row[index]); });
      return record;
    });
}

function readCell_(value) {
  if (value instanceof Date) return value.toISOString();
  var text = value == null ? '' : String(value);
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

function getImage_(id) {
  var cleanId = validateId_(id);
  var sheet = getSheet_('Item');
  var row = findRowById_(sheet, cleanId);
  if (!row) return { ok: false, code: 'not_found', error: 'Item tidak dijumpai.' };
  // Hanya fail yang direkod dalam Sheet boleh dibaca, bukan sebarang fail Drive.
  var fileId = cellValue_(sheet, 'Item', row, 'drive_file_id');
  if (!fileId) return { ok: false, code: 'not_found', error: 'Item ini tiada gambar.' };
  var blob = DriveApp.getFileById(String(fileId)).getBlob();
  return { ok: true, mimeType: blob.getContentType(), dataBase64: Utilities.base64Encode(blob.getBytes()) };
}

/** Link pendek TikTok dan Facebook perlu dibuka dulu untuk dapat alamat video sebenar. */
function resolveUrl_(url) {
  var current = String(url || '');
  for (var hop = 0; hop < 4; hop++) {
    if (!isResolvableUrl_(current)) return { ok: false, code: 'bad_request', error: 'Link tidak dibenarkan.' };
    var response = UrlFetchApp.fetch(current, { followRedirects: false, muteHttpExceptions: true });
    var code = response.getResponseCode();
    if (code < 300 || code >= 400) return { ok: true, url: current };
    var headers = response.getHeaders();
    var location = headers.Location || headers.location;
    if (!location) return { ok: true, url: current };
    location = String(location);
    if (location.charAt(0) === '/') {
      location = current.match(/^https:\/\/[^\/]+/)[0] + location;
    }
    current = location;
  }
  if (!isResolvableUrl_(current)) return { ok: false, code: 'bad_request', error: 'Link tidak dibenarkan.' };
  return { ok: true, url: current };
}

function isResolvableUrl_(url) {
  var match = /^https:\/\/([^\/?#:@]+)(?:[\/?#]|$)/i.exec(url);
  return Boolean(match) && url.length <= MAX_URL_LENGTH &&
    RESOLVABLE_HOSTS.indexOf(match[1].toLowerCase()) !== -1;
}

/* Menulis */

function saveItem_(item) {
  var clean = validateItem_(item);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var file = null;
  try {
    var sheet = getSheet_('Item');

    // App mengulang hantar kalau jawapan hilang, jadi id yang sama tidak disimpan dua kali.
    var existingRow = findRowById_(sheet, clean.id);
    if (existingRow) {
      return { ok: true, duplicate: true, id: clean.id, driveUrl: cellValue_(sheet, 'Item', existingRow, 'drive_url') };
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
      'baru',
      clean.ruang,
      clean.gambar
    ]);

    return { ok: true, id: clean.id, driveUrl: file ? file.getUrl() : '' };
  } catch (err) {
    if (file) file.setTrashed(true);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function saveRecord_(table, record) {
  if (!Object.prototype.hasOwnProperty.call(SHEETS, table)) throw new Error('Jadual tidak sah.');
  if (!record || typeof record !== 'object') throw new Error('Rekod kosong.');
  var id = validateId_(record.id);
  var headers = SHEETS[table];

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_(table);
    var row = findRowById_(sheet, id);
    if (table === 'Item' && !row) return { ok: false, code: 'not_found', error: 'Item tidak dijumpai.' };

    var values = row
      ? sheet.getRange(row, 1, 1, headers.length).getValues()[0]
      : headers.map(function () { return ''; });
    var nowIso = new Date().toISOString();

    headers.forEach(function (header, index) {
      if (header === 'id') values[index] = id;
      else if (header === 'dicipta') { if (!row) values[index] = nowIso; }
      else if (header === 'kemas_kini') values[index] = nowIso;
      else if (table === 'Item' && ITEM_EDITABLE.indexOf(header) === -1) return;
      else if (Object.prototype.hasOwnProperty.call(record, header)) {
        values[index] = cleanField_(table, header, record[header]);
      }
    });

    var output = values.map(function (value) {
      return typeof value === 'string' ? safeCell_(value) : value;
    });
    if (row) {
      sheet.getRange(row, 1, 1, headers.length).setValues([output]);
    } else {
      sheet.appendRow(output);
    }
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function deleteRecord_(table, id) {
  if (!Object.prototype.hasOwnProperty.call(SHEETS, table)) throw new Error('Jadual tidak sah.');
  var cleanId = validateId_(id);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_(table);
    var row = findRowById_(sheet, cleanId);
    if (!row) return { ok: true, id: cleanId, missing: true };
    if (table === 'Item') {
      var fileId = cellValue_(sheet, 'Item', row, 'drive_file_id');
      if (fileId) DriveApp.getFileById(String(fileId)).setTrashed(true);
    }
    sheet.deleteRow(row);
    return { ok: true, id: cleanId };
  } finally {
    lock.releaseLock();
  }
}

/* Pengesahan */

function cleanField_(table, header, value) {
  var allowed = ALLOWED_VALUES[table + '.' + header];
  if (allowed) {
    var choice = value == null ? '' : String(value);
    if (allowed.indexOf(choice) === -1) throw new Error('Nilai ' + header + ' tidak sah.');
    return choice;
  }
  if (header === 'url') return cleanUrl_(value);
  if (header === 'gambar') return cleanIdList_(value);
  if (header === 'kedudukan') {
    var number = Number(value);
    if (!isFinite(number)) throw new Error('Kedudukan tidak sah.');
    return String(number);
  }
  if (header === 'tarikh_akhir') {
    var date = value == null ? '' : String(value);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Tarikh tidak sah.');
    return date;
  }
  if (header === 'lajur_id') return validateId_(value);
  if (header === 'tajuk' || header === 'nama' || header === 'username' || header === 'berhenti_di') {
    return cleanText_(value, MAX_TITLE_LENGTH);
  }
  return cleanText_(value, MAX_TEXT_LENGTH);
}

function validateId_(id) {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(String(id))) throw new Error('Id tidak sah.');
  return String(id);
}

function cleanIdList_(value) {
  var list = value == null ? '' : String(value);
  if (!list) return '';
  list.split(',').forEach(validateId_);
  return list;
}

function validateItem_(item) {
  if (!item || typeof item !== 'object') throw new Error('Item kosong.');
  if (['image', 'link', 'note'].indexOf(item.type) === -1) throw new Error('Jenis tidak sah.');

  var clean = {
    id: validateId_(item.id),
    type: item.type,
    title: cleanText_(item.title, MAX_TITLE_LENGTH),
    text: cleanText_(item.text, MAX_TEXT_LENGTH),
    url: cleanUrl_(item.url),
    ruang: cleanField_('Item', 'ruang', item.ruang),
    gambar: cleanIdList_(item.gambar)
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
  } else if (item.type === 'note' && !clean.text && !clean.title && !clean.gambar) {
    throw new Error('Nota kosong.');
  }
  return clean;
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

/* Drive dan Sheets */

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

/** Dapatkan tab, dan cipta atau lengkapkan lajurnya kalau backend baru dinaik taraf. */
function getSheet_(name) {
  var spreadsheet = SpreadsheetApp
    .openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  var headers = SHEETS[name];
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    // Teks biasa, supaya Sheets tidak menukar tarikh dan nombor yang disimpan.
    sheet.getRange(2, 1, sheet.getMaxRows() - 1, headers.length).setNumberFormat('@');
    if (name === 'Lajur') {
      DEFAULT_COLUMNS.forEach(function (column) { sheet.appendRow(column); });
    }
  } else if (sheet.getLastColumn() < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
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

function cellValue_(sheet, table, row, header) {
  return sheet.getRange(row, SHEETS[table].indexOf(header) + 1).getValue();
}

function newSecret_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function jsonResponse_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
