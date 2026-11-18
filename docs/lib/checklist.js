// Checklist disimpan sebagai teks biasa dalam lajur nota, satu perkara setiap baris:
// "[ ] Beli susu" belum siap dan "[x] Bayar bil" sudah siap.
// Jadi ia kekal mudah dibaca dalam Sheets, boleh dicari, dan tidak memerlukan lajur baru.
const LINE = /^\[([ xX])\]\s+(\S.*)$/;

const cleanLine = (value) => String(value || '').replace(/\s*\n\s*/g, ' ').trim();

/** Kembalikan senarai perkara, atau null kalau teks ini nota biasa. */
export function parseChecklist(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const rows = [];
  for (const line of lines) {
    const match = line.match(LINE);
    if (!match) return null;
    rows.push({ text: match[2].trim(), done: match[1] !== ' ' });
  }
  return rows;
}

export function checklistText(rows) {
  return rows
    .map((row) => ({ text: cleanLine(row.text), done: Boolean(row.done) }))
    .filter((row) => row.text)
    .map((row) => (row.done ? '[x] ' : '[ ] ') + row.text)
    .join('\n');
}

/** Tukar nota biasa kepada checklist: setiap baris menjadi satu perkara. */
export function rowsFromText(text) {
  const parsed = parseChecklist(text);
  if (parsed) return parsed;
  return String(text || '').split('\n').map(cleanLine).filter(Boolean).map((line) => ({ text: line, done: false }));
}

/** Tukar checklist kepada nota biasa: tanda dibuang, teks dikekalkan. */
export const textFromRows = (rows) => rows.map((row) => cleanLine(row.text)).filter(Boolean).join('\n');

export function checklistSummary(rows) {
  return rows.filter((row) => row.done).length + ' daripada ' + rows.length + ' siap';
}

/** Bentuk untuk dibaca sahaja, seperti di Info Penting. */
export function readableNote(text) {
  const rows = parseChecklist(text);
  if (!rows) return String(text || '');
  return rows.map((row) => (row.done ? '☑ ' : '☐ ') + row.text).join('\n');
}

const sameText = (text) => cleanLine(text).replace(/\s+/g, ' ').toLowerCase();

/** Satukan beberapa checklist. Perkara yang sama dikira sekali, dan kekal belum siap kalau ada yang belum siap. */
export function mergeRows(lists) {
  const seen = new Map();
  const merged = [];
  for (const rows of lists) {
    for (const row of rows || []) {
      const text = cleanLine(row.text);
      if (!text) continue;
      const found = seen.get(sameText(text));
      if (found) {
        found.done = found.done && Boolean(row.done);
        continue;
      }
      const copy = { text, done: Boolean(row.done) };
      seen.set(sameText(text), copy);
      merged.push(copy);
    }
  }
  return merged;
}

/** Baca checklist daripada jawapan AI, yang mungkin dimulakan dengan "-" atau dibungkus ayat lain. */
export function rowsFromAiText(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    const match = line.trim().match(/^(?:[-*•]\s*)?\[([ xX])\]\s+(\S.*)$/);
    if (match) rows.push({ text: cleanLine(match[2]), done: match[1] !== ' ' });
  }
  return rows;
}
