// Jalankan: node --test tests/
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
  const list = () => call({ action: 'listAll' }).tables;
  return { harness, secret, call, save, list };
}

const dataRows = (harness, sheet = 'Item') => harness.state.sheets[sheet].rows.slice(1);
const image = { type: 'image', mimeType: 'image/webp', dataBase64: PNG_BASE64, title: 'ss.png' };

test('setup boleh dijalankan semula tanpa menukar kunci atau mencipta berganda', () => {
  const { harness, secret } = ready();
  const folders = harness.state.folders.length;
  const columns = dataRows(harness, 'Lajur').length;
  harness.setup();
  assert.equal(harness.state.properties.APP_SECRET, secret);
  assert.equal(harness.state.folders.length, folders);
  assert.equal(dataRows(harness, 'Lajur').length, columns);
  assert.equal(secret.length, 64);
});

test('kunci salah ditolak untuk semua tindakan', () => {
  const { harness, save } = ready();
  save(image);
  const actions = [
    { action: 'listAll' },
    { action: 'getImage', id: ID },
    { action: 'saveItem', item: { id: 'lain-0001', type: 'note', text: 'x' } },
    { action: 'saveRecord', table: 'Tugasan', record: { id: 'tugas-001', tajuk: 'x' } },
    { action: 'deleteRecord', table: 'Item', id: ID },
    { action: 'resolveUrl', url: 'https://vt.tiktok.com/abc' }
  ];
  for (const body of actions) {
    assert.equal(harness.post(JSON.stringify({ secret: 'salah', ...body })).code, 'unauthorized', body.action);
  }
  assert.equal(dataRows(harness).length, 1);
  assert.equal(harness.state.fetched.length, 0);
});

test('backend yang belum setup menolak permintaan', () => {
  const harness = createHarness();
  assert.equal(harness.post(JSON.stringify({ secret: null, action: 'ping' })).code, 'not_setup');
});

test('JSON rosak dan tindakan tak dikenali ditolak dengan kemas', () => {
  const { harness, call } = ready();
  assert.equal(harness.post('bukan json').ok, false);
  assert.equal(call({ action: 'lain' }).code, 'bad_request');
});

test('naik taraf dari sheet lama menambah lajur tanpa mengusik data', () => {
  const { harness, call, list } = ready();
  const item = harness.state.sheets.Item;
  item.rows = [item.rows[0].slice(0, 11), ['lama-0001', '2026-11-04T00:00:00Z', 'note', '', '', 'nota lama', '', '', '', '', 'baru']];
  delete harness.state.sheets.Tugasan;
  const tables = list();
  assert.equal(item.rows[0].length, 13);
  assert.equal(tables.Item[0].nota, 'nota lama');
  assert.equal(tables.Item[0].ruang, '');
  assert.deepEqual(tables.Tugasan, []);
  assert.equal(call({ action: 'saveRecord', table: 'Item', record: { id: 'lama-0001', status: 'dilihat' } }).ok, true);
  assert.equal(list().Item[0].status, 'dilihat');
});

test('gambar masuk folder bulan dengan ruang dan senarai gambar', () => {
  const { harness, save, list } = ready();
  const result = save({ ...image, ruang: 'info' });
  assert.equal(result.ok, true);
  const [file] = harness.state.files;
  assert.equal(file.folder.name, '2026-11');
  assert.equal(file.folder.parent.name, 'Screenshot');
  const [row] = list().Item;
  assert.equal(row.id, ID);
  assert.equal(row.jenis, 'image');
  assert.equal(row.ruang, 'info');
  assert.match(row.drive_url, /^https:\/\/drive\.google\.com\/file/);
});

test('id sama yang dihantar semula tidak mencipta salinan', () => {
  const { harness, save } = ready();
  const first = save(image);
  const second = save(image);
  assert.equal(second.duplicate, true);
  assert.equal(second.driveUrl, first.driveUrl);
  assert.equal(harness.state.files.length, 1);
  assert.equal(dataRows(harness).length, 1);
});

test('nota boleh mempunyai lampiran gambar sahaja', () => {
  const { save, call, list } = ready();
  assert.equal(save({ type: 'note', gambar: 'gambar-0001,gambar-0002' }).ok, true);
  assert.equal(list().Item[0].gambar, 'gambar-0001,gambar-0002');
  assert.equal(call({ action: 'saveItem', item: { id: 'nota-0002', type: 'note', gambar: 'x/../y' } }).ok, false);
});

test('teks yang menyerupai formula tidak jadi formula dan dibaca semula sebagai asal', () => {
  const { harness, save, call, list } = ready();
  const formula = '=IMPORTXML("http://jahat","//a")';
  save({ type: 'note', title: formula, text: '+1' });
  assert.equal(dataRows(harness)[0][3], `'${formula}`);
  assert.equal(list().Item[0].tajuk, formula);
  call({ action: 'saveRecord', table: 'Tugasan', record: { id: 'tugas-001', tajuk: formula } });
  assert.equal(dataRows(harness, 'Tugasan')[0][2], `'${formula}`);
  assert.equal(list().Tugasan[0].tajuk, formula);
});

test('input item tidak sah ditolak', () => {
  const { harness, save, call } = ready();
  const bad = [
    { type: 'link', url: 'javascript:alert(1)' },
    { type: 'link', url: '' },
    { type: 'note', text: '' },
    { type: 'lain', text: 'x' },
    { type: 'image', mimeType: 'text/html', dataBase64: PNG_BASE64 },
    { type: 'image', mimeType: 'image/svg+xml', dataBase64: PNG_BASE64 },
    { type: 'image', mimeType: 'image/png', dataBase64: '' },
    { type: 'note', text: 'x', ruang: 'rahsia' }
  ];
  for (const item of bad) assert.equal(save(item).ok, false, JSON.stringify(item));
  assert.equal(call({ action: 'saveItem', item: { id: '../../x', type: 'note', text: 'x' } }).ok, false);
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

test('getImage hanya memberi gambar yang direkod', () => {
  const { save, call } = ready();
  save(image);
  call({ action: 'saveItem', item: { id: 'nota-0001', type: 'note', text: 'x' } });
  const result = call({ action: 'getImage', id: ID });
  assert.equal(result.mimeType, 'image/webp');
  assert.equal(result.dataBase64, PNG_BASE64);
  assert.equal(call({ action: 'getImage', id: 'nota-0001' }).code, 'not_found');
  assert.equal(call({ action: 'getImage', id: 'tiada-0001' }).code, 'not_found');
  assert.equal(call({ action: 'getImage', id: '../rahsia' }).ok, false);
});

test('saveRecord pada Item hanya mengubah lajur yang dibenarkan', () => {
  const { save, call, list } = ready();
  save(image);
  const before = list().Item[0];
  const result = call({
    action: 'saveRecord',
    table: 'Item',
    record: { id: ID, tajuk: 'Baru', status: 'dilihat', drive_file_id: 'fail-orang-lain', drive_url: 'https://jahat', jenis: 'note' }
  });
  assert.equal(result.ok, true);
  const after = list().Item[0];
  assert.equal(after.tajuk, 'Baru');
  assert.equal(after.status, 'dilihat');
  assert.equal(after.drive_file_id, before.drive_file_id);
  assert.equal(after.drive_url, before.drive_url);
  assert.equal(after.jenis, 'image');
});

test('saveRecord tidak mencipta Item baru dan menolak nilai tak sah', () => {
  const { save, call, list } = ready();
  assert.equal(call({ action: 'saveRecord', table: 'Item', record: { id: 'tiada-0001', tajuk: 'x' } }).code, 'not_found');
  save(image);
  assert.equal(call({ action: 'saveRecord', table: 'Item', record: { id: ID, status: '=F()' } }).ok, false);
  assert.equal(call({ action: 'saveRecord', table: 'Item', record: { id: ID, ruang: 'lain' } }).ok, false);
  assert.equal(list().Item[0].status, 'baru');
  assert.equal(call({ action: 'saveRecord', table: 'JadualLain', record: { id: 'tugas-001' } }).ok, false);
  assert.equal(call({ action: 'saveRecord', table: 'constructor', record: { id: 'tugas-001' } }).ok, false);
});

test('tugasan boleh dicipta, dikemas kini separa dan dipadam', () => {
  const { call, list } = ready();
  const saveTask = (record) => call({ action: 'saveRecord', table: 'Tugasan', record });
  assert.equal(saveTask({ id: 'tugas-001', tajuk: 'Beli kopi', tarikh_akhir: '2026-11-10', nota: 'Arabica' }).ok, true);
  assert.equal(saveTask({ id: 'tugas-001', siap: 'ya' }).ok, true);
  const [task] = list().Tugasan;
  assert.equal(task.tajuk, 'Beli kopi');
  assert.equal(task.nota, 'Arabica');
  assert.equal(task.siap, 'ya');
  assert.equal(task.tarikh_akhir, '2026-11-10');
  assert.ok(task.dicipta);
  assert.ok(task.kemas_kini);
  assert.equal(saveTask({ id: 'tugas-001', tarikh_akhir: 'esok' }).ok, false);
  assert.equal(saveTask({ id: 'tugas-001', siap: 'mungkin' }).ok, false);
  assert.equal(call({ action: 'deleteRecord', table: 'Tugasan', id: 'tugas-001' }).ok, true);
  assert.deepEqual(list().Tugasan, []);
  assert.equal(call({ action: 'deleteRecord', table: 'Tugasan', id: 'tugas-001' }).missing, true);
});

test('papan bermula dengan 3 lajur, boleh tambah lajur dan alih kad', () => {
  const { call, list } = ready();
  const tables = list();
  assert.deepEqual(tables.Lajur.map((column) => column.tajuk), ['Nak buat', 'Sedang buat', 'Siap']);
  call({ action: 'saveRecord', table: 'Lajur', record: { id: 'lajur-baru', tajuk: 'Tunggu', kedudukan: 4096 } });
  assert.equal(list().Lajur.length, 4);
  call({ action: 'saveRecord', table: 'Kad', record: { id: 'kad-00001', tajuk: 'Reka logo', lajur_id: 'lajur-nak-buat', kedudukan: 1024 } });
  call({ action: 'saveRecord', table: 'Kad', record: { id: 'kad-00001', lajur_id: 'lajur-baru', kedudukan: 512.5 } });
  const [card] = list().Kad;
  assert.equal(card.tajuk, 'Reka logo');
  assert.equal(card.lajur_id, 'lajur-baru');
  assert.equal(card.kedudukan, '512.5');
  assert.equal(call({ action: 'saveRecord', table: 'Kad', record: { id: 'kad-00001', kedudukan: 'x' } }).ok, false);
  assert.equal(call({ action: 'saveRecord', table: 'Kad', record: { id: 'kad-00001', lajur_id: '../x' } }).ok, false);
});

test('kelas menyimpan data dan hanya menerima status sah', () => {
  const { call, list } = ready();
  const save = (record) => call({ action: 'saveRecord', table: 'Kelas', record });
  assert.equal(save({ id: 'kelas-001', nama: 'Canva', url: 'https://kelas.my/a', username: 'aku', password_sulit: 'v1.abc.def', status: 'belum' }).ok, true);
  assert.equal(save({ id: 'kelas-001', status: 'tengah', terakhir_dibuka: '2026-11-04T01:00:00Z' }).ok, true);
  const [kelas] = list().Kelas;
  assert.equal(kelas.status, 'tengah');
  assert.equal(kelas.password_sulit, 'v1.abc.def');
  assert.equal(kelas.nama, 'Canva');
  assert.equal(save({ id: 'kelas-001', status: 'lain' }).ok, false);
  save({ id: 'kelas-001', url: 'javascript:alert(1)' });
  assert.equal(list().Kelas[0].url, '');
});

test('padam Item membuang failnya ke tong sampah', () => {
  const { harness, save, call, list } = ready();
  save(image);
  assert.equal(call({ action: 'deleteRecord', table: 'Item', id: ID }).ok, true);
  assert.equal(harness.state.files[0].trashed, true);
  assert.deepEqual(list().Item, []);
  assert.equal(harness.state.locks, 0);
});

test('resolveUrl mengikut redirect dan hanya untuk laman video', () => {
  const { harness, call } = ready();
  harness.state.redirects['https://vt.tiktok.com/abc'] = 'https://www.tiktok.com/@a/video/123?x=1';
  assert.equal(call({ action: 'resolveUrl', url: 'https://vt.tiktok.com/abc' }).url, 'https://www.tiktok.com/@a/video/123?x=1');

  harness.state.redirects['https://fb.watch/x'] = '/watch/?v=9';
  harness.state.redirects['https://fb.watch/watch/?v=9'] = 'https://www.facebook.com/watch/?v=9';
  assert.equal(call({ action: 'resolveUrl', url: 'https://fb.watch/x' }).url, 'https://www.facebook.com/watch/?v=9');

  const before = harness.state.fetched.length;
  const blocked = [
    'http://vt.tiktok.com/abc',
    'https://169.254.169.254/latest',
    'https://vt.tiktok.com.jahat.com/a',
    'https://vt.tiktok.com:8080/a',
    'https://vt.tiktok.com@jahat.com/a',
    'https://localhost/a',
    ''
  ];
  for (const url of blocked) assert.equal(call({ action: 'resolveUrl', url }).ok, false, url);
  assert.equal(harness.state.fetched.length, before);

  harness.state.redirects['https://vt.tiktok.com/lari'] = 'https://jahat.com/rahsia';
  assert.equal(call({ action: 'resolveUrl', url: 'https://vt.tiktok.com/lari' }).ok, false);
  assert.ok(!harness.state.fetched.includes('https://jahat.com/rahsia'));
});

test('rotateSecret membatalkan kunci lama', () => {
  const { harness, secret, call } = ready();
  harness.rotateSecret();
  assert.notEqual(harness.state.properties.APP_SECRET, secret);
  assert.equal(call({ action: 'ping' }).code, 'unauthorized');
});
