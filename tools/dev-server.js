// Pelayan ujian tempatan: hidangkan docs/ dan jalankan Code.gs sebenar di /mock-exec.
// Meniru Apps Script: POST dijawab dengan 302 ke URL lain yang memulangkan JSON.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createHarness } = require('./gas-harness');

const PORT = Number(process.env.PORT || 5173);
const DOCS = path.join(__dirname, '..', 'docs');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png'
};

const harness = createHarness();
harness.setup();
// Jawapan tiruan untuk AI, supaya panel boleh diuji tanpa kunci API sebenar.
const FAKE_RECEIPT = {
  adakah_resit: true,
  peniaga: 'Kedai Runcit Maju',
  tarikh: '2026-11-03',
  masa: '14:32',
  jumlah: 47.8,
  mata_wang: 'RM',
  cukai: 2.7,
  kategori: 'Runcit',
  no_resit: 'INV-10293',
  barangan: [{ nama: 'Beras 5kg', kuantiti: 1, harga: 23.9 }, { nama: 'Telur gred A', kuantiti: 2, harga: 11.9 }]
};
const FAKE_STATEMENT = {
  adakah_penyata: true,
  transaksi: [
    { tarikh: '2026-11-03', masa: '14:33', keterangan: 'KEDAI RUNCIT MAJU', jumlah: 47.8, arah: 'keluar', mata_wang: 'RM', rujukan: 'TNG-1001', jenis: 'DuitNow QR' },
    { tarikh: '2026-11-02', masa: '08:10', keterangan: 'PLUS TOLL SUNGAI BESI', jumlah: 3.5, arah: 'keluar', mata_wang: 'RM', rujukan: 'TNG-1002', jenis: 'Tol' },
    { tarikh: '2026-11-01', masa: '19:45', keterangan: 'RESTORAN SELERA', jumlah: 26, arah: 'keluar', mata_wang: 'RM', rujukan: 'TNG-1003', jenis: 'Bayaran' },
    { tarikh: '2026-11-01', masa: '09:00', keterangan: 'Tambah nilai', jumlah: 100, arah: 'masuk', mata_wang: 'RM', rujukan: 'TNG-1004', jenis: 'Tambah nilai' }
  ]
};
const fakeStructured = (data) => ({ stop_reason: 'end_turn', model: 'claude-opus-5-5', usage: { input_tokens: 900, output_tokens: 120 }, content: [{ type: 'text', text: JSON.stringify(data) }] });
harness.state.anthropic = (url, options) => ({
  code: 200,
  body: url.endsWith('/messages') && JSON.parse(options.payload).output_config.format
    ? JSON.parse(options.payload).output_config.format.schema.properties.transaksi ? fakeStructured(FAKE_STATEMENT) : { stop_reason: 'end_turn', model: 'claude-opus-5-5', usage: { input_tokens: 900, output_tokens: 120 }, content: [{ type: 'text', text: JSON.stringify(FAKE_RECEIPT) }] }
    : url.endsWith('/messages')
    ? {
      stop_reason: 'end_turn',
      model: 'claude-opus-5-5',
      usage: { input_tokens: 1200, output_tokens: 80 },
      content: [{ type: 'text', text: 'Ini **jawapan tiruan**.\n\n- Perkara satu\n- Perkara `dua`\n\n<img src=x onerror=alert(1)>' }]
    }
    : { data: [] }
});
const results = new Map();
let nextResult = 0;

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function sendJson(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);

  if (request.method === 'POST' && url.pathname === '/mock-exec') {
    const id = String(++nextResult);
    results.set(id, harness.post(await readBody(request)));
    response.writeHead(302, { Location: `/mock-result?id=${id}` });
    response.end();
    return;
  }
  if (url.pathname === '/mock-result') {
    sendJson(response, results.get(url.searchParams.get('id')) || { ok: false, error: 'tiada' });
    return;
  }
  // Maklumat ujian sahaja: kunci rahsia tiruan dan apa yang tersimpan.
  if (url.pathname === '/mock-state') {
    sendJson(response, {
      secret: harness.state.properties.APP_SECRET,
      sheets: Object.fromEntries(
        Object.entries(harness.state.sheets).map(([name, sheet]) => [name, sheet.rows])
      ),
      ai: harness.state.requests.map((request) => ({ url: request.url, body: request.body })),
      files: harness.state.files.map((file) => ({
        name: file.blob.name,
        mimeType: file.blob.mimeType,
        bytes: file.blob.bytes.length,
        folder: file.folder.name,
        trashed: file.trashed
      }))
    });
    return;
  }

  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const filePath = path.resolve(DOCS, relative);
  if (!filePath.startsWith(DOCS + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end('Tiada');
    return;
  }
  response.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
});

server.listen(PORT, () => {
  console.log(`SimpanIdea dev server: http://localhost:${PORT}`);
});
