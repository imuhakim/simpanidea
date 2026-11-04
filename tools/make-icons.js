// Jana ikon PNG tanpa kebergantungan luar: node tools/make-icons.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BG = [0xd9, 0x43, 0x2f];
const FG = [0xff, 0xff, 0xff];

// Bentuk penanda buku, dalam zon selamat ikon maskable.
function isBookmark(x, y) {
  const left = 0.34, right = 0.66, top = 0.26, bottom = 0.74;
  if (x < left || x > right || y < top || y > bottom) return false;
  const notchDepth = 0.11;
  const distance = Math.abs(x - 0.5) / ((right - left) / 2);
  return y <= bottom - notchDepth * (1 - distance);
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function chunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), data.length + 8);
  return out;
}

function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const colour = isBookmark((x + 0.5) / size, (y + 0.5) / size) ? FG : BG;
      raw[offset++] = colour[0];
      raw[offset++] = colour[1];
      raw[offset++] = colour[2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const outDir = path.join(__dirname, '..', 'docs');
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png(size));
}
