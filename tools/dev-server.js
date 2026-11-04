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
