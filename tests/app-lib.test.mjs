// Jalankan: node --test tests/
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVideo } from '../docs/lib/video.js';
import { buildAiContext } from '../docs/lib/ai-context.js';
import { createVault, decrypt, encrypt, unlockVault } from '../docs/lib/vault.js';
import { autoMatches, dayGap, linkedReceipt, matchCandidates, paymentForReceipt, sameAmount } from '../docs/lib/payments.js';
import { cleanName, greetingFor } from '../docs/lib/profile.js';
import { createPinRecord, isValidPin, isWeakPin, lockoutSeconds, verifyPin } from '../docs/lib/pin.js';

test('YouTube dikenali dari semua bentuk link biasa', () => {
  const cases = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s', 'dQw4w9WgXcQ', false],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', false],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ', false],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ', true],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ', false]
  ];
  for (const [url, id, vertical] of cases) {
    const video = parseVideo(url);
    assert.equal(video.platform, 'youtube', url);
    assert.equal(video.vertical, vertical, url);
    assert.ok(video.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/' + id + '?'), url);
    assert.equal(video.thumbnail, 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg');
  }
});

test('TikTok penuh terus boleh dimainkan, link pendek perlu diselesaikan dahulu', () => {
  const full = parseVideo('https://www.tiktok.com/@kedai/video/7300000000000000000?is_from_webapp=1');
  assert.equal(full.embedUrl, 'https://www.tiktok.com/embed/v2/7300000000000000000');
  assert.equal(full.vertical, true);
  for (const short of ['https://vt.tiktok.com/ZSabc/', 'https://vm.tiktok.com/ZSabc/', 'https://www.tiktok.com/t/ZSabc/']) {
    const video = parseVideo(short);
    assert.equal(video.platform, 'tiktok');
    assert.equal(video.needsResolve, true, short);
    assert.equal(video.embedUrl, undefined);
  }
  assert.equal(parseVideo('https://www.tiktok.com/@kedai'), null);
});

test('Facebook dikenali dan alamatnya dikodkan', () => {
  const watch = parseVideo('https://www.facebook.com/watch/?v=123&a=b');
  assert.equal(watch.platform, 'facebook');
  assert.ok(watch.embedUrl.includes(encodeURIComponent('https://www.facebook.com/watch/?v=123&a=b')));
  assert.equal(parseVideo('https://www.facebook.com/kedai/videos/123/').vertical, false);
  assert.equal(parseVideo('https://www.facebook.com/reel/123').vertical, true);
  assert.equal(parseVideo('https://fb.watch/abc/').needsResolve, true);
  const share = parseVideo('https://www.facebook.com/share/r/abc/');
  assert.equal(share.needsResolve, true);
  assert.ok(share.fallback.embedUrl.startsWith('https://www.facebook.com/plugins/video.php'));
  assert.equal(parseVideo('https://www.facebook.com/kedai/posts/1'), null);
});

test('link lain atau menyamar bukan video', () => {
  for (const url of [
    'https://contoh.my/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.jahat.com/watch?v=dQw4w9WgXcQ',
    'https://jahat.com/?u=https://youtu.be/dQw4w9WgXcQ',
    'javascript:alert(1)',
    'bukan link',
    '',
    'https://www.youtube.com/watch?v=%22%3E%3Cscript%3E',
    'https://www.youtube.com/channel/UC123'
  ]) {
    assert.equal(parseVideo(url), null, url);
  }
});

test('peti password: kata laluan betul membuka, salah ditolak', async () => {
  const { key, record } = await createVault('kata laluan panjang');
  const sealed = await encrypt(key, 'Rahsia@123 ñ');
  assert.ok(!sealed.includes('Rahsia'));
  assert.ok(!JSON.stringify(record).includes('kata laluan'));
  assert.equal(await decrypt(key, sealed), 'Rahsia@123 ñ');

  const again = await unlockVault('kata laluan panjang', record);
  assert.equal(await decrypt(again, sealed), 'Rahsia@123 ñ');
  assert.equal(await unlockVault('salah', record), null);
  assert.notEqual(await encrypt(key, 'sama'), await encrypt(key, 'sama'));
});

test('data password yang diubah atau rosak gagal, bukan memberi teks salah', async () => {
  const { key } = await createVault('abc');
  const sealed = await encrypt(key, 'rahsia');
  const parts = sealed.split('.');
  const flipped = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  await assert.rejects(decrypt(key, parts[0] + '.' + parts[1] + '.' + flipped));
  await assert.rejects(decrypt(key, 'rosak'));
});

test('PIN: hanya hash disimpan, dan PIN salah ditolak', async () => {
  const record = await createPinRecord('482913');
  assert.ok(!JSON.stringify(record).includes('482913'));
  assert.equal(await verifyPin('482913', record), true);
  assert.equal(await verifyPin('482914', record), false);
  const other = await createPinRecord('482913');
  assert.notEqual(other.hash, record.hash);
});

test('PIN: format dan PIN lemah dikenali', () => {
  for (const pin of ['482913', '000000']) assert.equal(isValidPin(pin), true, pin);
  for (const pin of ['48291', '4829130', 'abcdef', '', '48 913']) assert.equal(isValidPin(pin), false, pin);
  for (const pin of ['111111', '123456', '654321', '456789']) assert.equal(isWeakPin(pin), true, pin);
  for (const pin of ['482913', '112233', '121212']) assert.equal(isWeakPin(pin), false, pin);
});

test('PIN: cubaan salah dilambatkan selepas 5 kali, dengan had', () => {
  assert.deepEqual([0, 4, 5, 6, 7].map(lockoutSeconds), [0, 0, 30, 60, 120]);
  assert.equal(lockoutSeconds(50), 900);
});

const contextTables = () => ({
  Item: [
    { id: 'a', jenis: 'note', tajuk: 'Idea kopi', nota: 'Jual kopi', dicipta: '2026-11-01T00:00:00Z', ruang: '', keadaan: '' },
    { id: 'b', jenis: 'link', tajuk: 'Artikel', url: 'https://contoh.my', dicipta: '2026-11-02T00:00:00Z', ruang: 'info', keadaan: 'arkib' },
    { id: 'c', jenis: 'note', tajuk: 'Sudah buang', nota: 'rahsia sampah', keadaan: 'sampah' },
    { id: 'd', jenis: 'image', tajuk: 'lampiran.png', ruang: 'lampiran', keadaan: '' }
  ],
  Tugasan: [{ id: 't', tajuk: 'Bayar yuran', nota: '', siap: '', tarikh_akhir: '2026-11-10', keadaan: '' }],
  Kad: [{ id: 'k', tajuk: 'Reka logo', nota: 'gelap', lajur_id: 'l1', keadaan: '' }],
  Lajur: [{ id: 'l1', tajuk: 'Nak buat' }],
  Resit: [
    { id: 'r', peniaga: 'Kedai Maju', tarikh: '2026-11-03', jumlah: '47.8', mata_wang: 'RM', kategori: 'Runcit', keadaan: '' },
    { id: 's', peniaga: 'Resit dibuang', jumlah: '9', keadaan: 'sampah' }
  ],
  Kelas: [{ id: 'm', nama: 'Canva', url: 'https://kelas.my', username: 'saya@emel.my', password_sulit: 'v1.SULIT.SULIT', status: 'tengah', berhenti_di: 'Modul 3', nota: 'best', keadaan: '' }],
  Tetapan: [{ id: 'peti-password', nilai: 'RAHSIA-PETI' }]
});

test('konteks AI mengandungi data berguna tanpa rahsia atau sampah', () => {
  const text = buildAiContext(contextTables(), { today: '2026-11-04', view: 'Inbox' });
  for (const wanted of ['Idea kopi', 'Jual kopi', 'Bayar yuran', '2026-11-10', 'Reka logo', 'Nak buat', 'Canva', 'Modul 3', 'Artikel', 'arkib', '2026-11-04', 'Inbox', 'Kedai Maju', 'RM 47.8', 'Runcit']) {
    assert.ok(text.includes(wanted), wanted);
  }
  for (const hidden of ['SULIT', 'saya@emel.my', 'RAHSIA-PETI', 'rahsia sampah', 'Sudah buang', 'lampiran.png', 'Resit dibuang']) {
    assert.ok(!text.includes(hidden), hidden);
  }
});

test('konteks AI hanya mengandungi tajuk untuk Info Penting', () => {
  const tables = contextTables();
  tables.Item.push({ id: 'z', jenis: 'note', tajuk: 'Nombor akaun', nota: 'ISI-SULIT-123', url: 'https://sulit.my', ruang: 'info', keadaan: '' });
  const text = buildAiContext(tables, { today: '2026-11-04', view: 'Inbox' });
  assert.ok(text.includes('Nombor akaun'));
  assert.ok(!text.includes('ISI-SULIT-123'));
  assert.ok(!text.includes('sulit.my'));
});

test('konteks AI dipendekkan bila data terlalu banyak, dan yang terbaru dikekalkan', () => {
  const tables = contextTables();
  tables.Item = Array.from({ length: 2000 }, (_, i) => ({
    id: 'i' + i, jenis: 'note', tajuk: 'Nota ' + i, nota: 'x'.repeat(500),
    dicipta: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(), ruang: '', keadaan: ''
  }));
  const text = buildAiContext(tables, { today: '2026-11-04', view: 'Semua' });
  assert.ok(text.length <= 60000);
  assert.ok(text.includes('Nota 1999'));
  assert.ok(!text.includes('Nota 0 '));
  assert.ok(text.includes('Bayar yuran'));
});

const pay = (id, tarikh, jumlah, extra = {}) => ({ id, tarikh, jumlah: String(jumlah), mata_wang: 'RM', resit_id: '', padanan: '', ...extra });
const rec = (id, tarikh, jumlah, extra = {}) => ({ id, tarikh, jumlah: String(jumlah), mata_wang: 'RM', keadaan: '', ...extra });

test('sameAmount membandingkan jumlah dan mata wang', () => {
  assert.equal(sameAmount(pay('p', '2026-11-03', 47.8), rec('r', '2026-11-03', '47.80')), true);
  assert.equal(sameAmount(pay('p', '2026-11-03', 47.8), rec('r', '2026-11-03', 47.81)), false);
  assert.equal(sameAmount(pay('p', '2026-11-03', 47.8), rec('r', '2026-11-03', 47.8, { mata_wang: 'USD' })), false);
  assert.equal(sameAmount(pay('p', '2026-11-03', 47.8), rec('r', '2026-11-03', '')), false);
  assert.equal(dayGap('2026-11-01', '2026-11-03'), 2);
  assert.equal(dayGap('', '2026-11-03'), null);
});

test('autoMatches hanya memadankan bila tiada keraguan', () => {
  assert.deepEqual(autoMatches([pay('p1', '2026-11-03', 10)], [rec('r1', '2026-11-03', 10)]), [{ paymentId: 'p1', receiptId: 'r1' }]);
  // Tarikh hampir hanya jadi cadangan.
  assert.deepEqual(autoMatches([pay('p1', '2026-11-03', 10)], [rec('r1', '2026-11-04', 10)]), []);
  // Dua resit untuk satu bayaran, dan dua bayaran untuk satu resit.
  assert.deepEqual(autoMatches([pay('p1', '2026-11-03', 10)], [rec('r1', '2026-11-03', 10), rec('r2', '2026-11-03', 10)]), []);
  assert.deepEqual(autoMatches([pay('p1', '2026-11-03', 10), pay('p2', '2026-11-03', 10)], [rec('r1', '2026-11-03', 10)]), []);
  // Padanan yang pernah dibuang tidak dipadankan semula.
  assert.deepEqual(autoMatches([pay('p1', '2026-11-03', 10, { padanan: 'tolak' })], [rec('r1', '2026-11-03', 10)]), []);
  // Yang sudah dipadankan tidak berubah, dan resit itu tidak boleh diambil lagi.
  assert.deepEqual(autoMatches([pay('p1', '2026-11-03', 10, { resit_id: 'r1' }), pay('p2', '2026-11-03', 10)], [rec('r1', '2026-11-03', 10)]), []);
  // Resit dalam Sampah tidak dikira.
  assert.deepEqual(autoMatches([pay('p1', '2026-11-03', 10)], [rec('r1', '2026-11-03', 10, { keadaan: 'sampah' })]), []);
});

test('matchCandidates menyusun ikut tarikh terdekat dalam 3 hari', () => {
  const receipts = [rec('jauh', '2026-11-10', 10), rec('dua', '2026-11-05', 10), rec('sama', '2026-11-03', 10), rec('lain', '2026-11-03', 11), rec('tiada', '', 10)];
  assert.deepEqual(matchCandidates(pay('p', '2026-11-03', 10), receipts, []).map((r) => r.id), ['sama', 'dua']);
  const others = [pay('q', '2026-11-03', 10, { resit_id: 'sama' })];
  assert.deepEqual(matchCandidates(pay('p', '2026-11-03', 10), receipts, others).map((r) => r.id), ['dua']);
});

test('padanan ke resit dalam Sampah atau yang hilang dianggap tiada', () => {
  const payment = pay('p', '2026-11-03', 10, { resit_id: 'r1' });
  assert.equal(linkedReceipt(payment, [rec('r1', '2026-11-03', 10)]).id, 'r1');
  assert.equal(linkedReceipt(payment, [rec('r1', '2026-11-03', 10, { keadaan: 'arkib' })]).id, 'r1');
  assert.equal(linkedReceipt(payment, [rec('r1', '2026-11-03', 10, { keadaan: 'sampah' })]), null);
  assert.equal(linkedReceipt(payment, []), null);
  assert.equal(paymentForReceipt('r1', [payment]).id, 'p');
});

test('buildAiContext menyenaraikan bayaran tanpa rujukan, dan menghadkan bilangannya', () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ id: 'b' + i, keterangan: 'KEDAI' + i, tarikh: '2026-11-03', jumlah: '5', rujukan: 'SULIT-RUJUKAN', keadaan: '' }));
  rows.push({ id: 'x', keterangan: 'DIABAIKAN', tarikh: '2026-11-03', jumlah: '1', keadaan: 'abai' });
  const text = buildAiContext({ Bayaran: rows }, { today: '2026-11-05', view: 'receipts' });
  assert.equal((text.match(/KEDAI/g) || []).length, 200);
  assert.ok(!text.includes('SULIT-RUJUKAN'));
  assert.ok(!text.includes('DIABAIKAN'));
});

test('buildAiContext tidak menghantar sejarah perbualan', () => {
  const text = buildAiContext({
    Perbualan: [{ id: 'b', tajuk: 'TAJUK-BUAL' }],
    MesejAI: [{ id: 'm', perbualan_id: 'b', peranan: 'assistant', teks: 'ISI-JAWAPAN' }]
  }, { today: '2026-11-05', view: 'inbox' });
  assert.ok(!text.includes('TAJUK-BUAL'));
  assert.ok(!text.includes('ISI-JAWAPAN'));
});

test('sapaan mengikut waktu, dan nama dibersihkan', () => {
  assert.equal(greetingFor('Ali', 8), 'Selamat pagi, Ali');
  assert.equal(greetingFor('Ali', 12), 'Selamat tengah hari, Ali');
  assert.equal(greetingFor('Ali', 16), 'Selamat petang, Ali');
  assert.equal(greetingFor('Ali', 21), 'Selamat malam, Ali');
  assert.equal(greetingFor('Ali', 2), 'Selamat malam, Ali');
  assert.equal(cleanName('  Ali   Abu \n'), 'Ali Abu');
  assert.equal(cleanName('x'.repeat(90)).length, 40);
  assert.equal(cleanName(null), '');
});
