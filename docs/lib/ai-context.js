// Ringkasan simpanan untuk AI. Password, username, dan rekod dalam sampah sengaja tidak dimasukkan.
const MAX_LENGTH = 60000;
const FIELD_LENGTH = 400;

const clip = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, FIELD_LENGTH);
const inTrash = (record) => record.keadaan === 'sampah';
const newestFirst = (a, b) => String(b.dicipta).localeCompare(String(a.dicipta));
const archivedMark = (record) => (record.keadaan === 'arkib' ? ' [arkib]' : '');
const line = (...parts) => '- ' + parts.filter(Boolean).join(' | ');

const STATUS_LABEL = { belum: 'belum buka', tengah: 'tengah belajar', siap: 'dah siap' };
const PLACE_LABEL = { info: 'info penting' };

function itemLine(item) {
  return line(
    (item.jenis || 'item') + archivedMark(item),
    PLACE_LABEL[item.ruang],
    clip(item.tajuk),
    clip(item.nota),
    clip(item.url),
    String(item.dicipta || '').slice(0, 10),
    item.status === 'dilihat' ? 'dah dilihat' : 'belum dilihat');
}

export function buildAiContext(tables, { today, view }) {
  const columns = new Map((tables.Lajur || []).map((column) => [column.id, column.tajuk]));
  const tasks = (tables.Tugasan || []).filter((task) => !inTrash(task)).map((task) => line(
    clip(task.tajuk) + archivedMark(task),
    task.siap === 'ya' ? 'siap' : 'belum siap',
    task.tarikh_akhir && 'tarikh akhir ' + task.tarikh_akhir,
    clip(task.nota)));
  const cards = (tables.Kad || []).filter((card) => !inTrash(card)).map((card) => line(
    clip(card.tajuk) + archivedMark(card),
    'lajur ' + (columns.get(card.lajur_id) || 'tiada'),
    clip(card.nota)));
  const classes = (tables.Kelas || []).filter((kelas) => !inTrash(kelas)).map((kelas) => line(
    clip(kelas.nama) + archivedMark(kelas),
    STATUS_LABEL[kelas.status] || STATUS_LABEL.belum,
    clip(kelas.url),
    kelas.berhenti_di && 'berhenti di ' + clip(kelas.berhenti_di),
    kelas.terakhir_dibuka && 'terakhir dibuka ' + String(kelas.terakhir_dibuka).slice(0, 10),
    clip(kelas.nota)));

  const head = [
    'Tarikh hari ini: ' + today,
    'Halaman yang sedang dibuka: ' + view,
    '',
    'TUGASAN', ...tasks,
    '',
    'PAPAN KANBAN', ...cards,
    '',
    'KELAS ONLINE', ...classes,
    '',
    'SIMPANAN (terbaru dahulu)'
  ].join('\n');

  // Simpanan paling banyak, jadi ia yang dipotong dulu, bermula dari yang paling lama.
  let text = head;
  const items = (tables.Item || [])
    .filter((item) => !inTrash(item) && item.ruang !== 'lampiran')
    .sort(newestFirst);
  for (const item of items) {
    const next = '\n' + itemLine(item);
    if (text.length + next.length > MAX_LENGTH) break;
    text += next;
  }
  return text.slice(0, MAX_LENGTH);
}
