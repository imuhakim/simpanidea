// Pindah, arkib dan sampah, dikongsi oleh semua panel butiran.
import { addItems, deleteRecord, findRecord, idList, newId, newItem, state, writeRecord } from '../lib/data.js';
import { domainOf, h, icon, isWebUrl, openModal, toast } from '../lib/dom.js';

const POSITION_STEP = 1024;
const TITLE_LENGTH = 120;
const DESTINATIONS = [
  { key: 'tasks', label: 'Tugasan', icon: 'tasks', table: 'Tugasan' },
  { key: 'board', label: 'Papan', icon: 'board', table: 'Kad' },
  { key: 'note', label: 'Nota', icon: 'note' },
  { key: 'info', label: 'Info Penting', icon: 'info' }
];

const setState = (table, id, keadaan) => writeRecord(table, {
  id,
  keadaan,
  dibuang_pada: keadaan === 'sampah' ? new Date().toISOString() : ''
});

export function archiveWithUndo(table, id) {
  setState(table, id, 'arkib');
  toast('Dialih ke Arkib', false, { label: 'Batal', onClick: () => restoreRecord(table, id) });
}

export const trashRecord = (table, id) => setState(table, id, 'sampah');

export function trashWithUndo(table, id) {
  trashRecord(table, id);
  toast('Dialih ke Sampah', false, { label: 'Batal', onClick: () => restoreRecord(table, id) });
}

/** Pulihkan rekod. Kad yang lajurnya sudah dipadam dimasukkan ke lajur pertama. */
export function restoreRecord(table, id) {
  const fields = { id, keadaan: '', dibuang_pada: '' };
  if (table === 'Kad') {
    const card = findRecord('Kad', id);
    const columns = state.tables.Lajur;
    if (card && !columns.some((column) => column.id === card.lajur_id) && columns.length) {
      fields.lajur_id = firstColumn().id;
    }
  }
  return writeRecord(table, fields);
}

function firstColumn() {
  return [...state.tables.Lajur].sort((a, b) => Number(a.kedudukan) - Number(b.kedudukan))[0];
}

function endOfColumn(columnId) {
  const positions = state.tables.Kad
    .filter((card) => card.lajur_id === columnId)
    .map((card) => Number(card.kedudukan) || 0);
  return (positions.length ? Math.max(...positions) : 0) + POSITION_STEP;
}

/** Teks panjang tanpa tajuk dipecah: baris pertama jadi tajuk, selebihnya jadi butiran. */
export function splitTitle(title, text) {
  const body = String(text || '').trim();
  if (title) return { title, text: body };
  const [first, ...rest] = body.split('\n');
  if (first.length <= TITLE_LENGTH) return { title: first, text: rest.join('\n').trim() };
  return { title: first.slice(0, TITLE_LENGTH) + '...', text: body };
}

function readSource(table, id, overrides) {
  const record = findRecord(table, id);
  const title = overrides.title !== undefined ? overrides.title : record.tajuk;
  const noteText = overrides.text !== undefined ? overrides.text : record.nota;
  const gambar = idList(overrides.gambar !== undefined ? overrides.gambar : record.gambar);
  const isImage = table === 'Item' && record.jenis === 'image';
  // Gambar kekal sebagai rekod, dan menjadi lampiran di tempat baru.
  if (isImage && !gambar.includes(record.id)) gambar.unshift(record.id);
  const url = table === 'Item' && isWebUrl(record.url) ? record.url : '';
  const withUrl = [noteText, url].filter(Boolean).join('\n');
  const parts = splitTitle(title, withUrl);
  return {
    record,
    isImage,
    title: parts.title || (url && domainOf(url)) || (isImage ? 'Gambar' : 'Tanpa tajuk'),
    text: parts.text,
    gambar: gambar.join(',')
  };
}

async function moveTo(destination, table, id, overrides, columnId) {
  const source = readSource(table, id, overrides);
  if (destination === 'tasks') {
    await writeRecord('Tugasan', { id: newId(), tajuk: source.title, nota: source.text, gambar: source.gambar, siap: '', tarikh_akhir: '' });
  } else if (destination === 'board') {
    await writeRecord('Kad', { id: newId(), tajuk: source.title, nota: source.text, gambar: source.gambar, lajur_id: columnId, kedudukan: endOfColumn(columnId) });
  } else {
    await addItems([newItem({
      type: 'note',
      title: source.title,
      text: source.text,
      gambar: source.gambar,
      ruang: destination === 'info' ? 'info' : ''
    })]);
  }
  // Rekod asal dibuang kerana isinya sudah pindah. Gambar tidak dibuang, cuma bertukar menjadi lampiran.
  if (source.isImage) await writeRecord('Item', { id, ruang: 'lampiran', status: 'dilihat' });
  else await deleteRecord(table, id);
}

function choice(label, iconName, tone, onclick) {
  return h('button', { class: 'move-choice', type: 'button', 'data-tone': tone, onclick },
    h('span', { class: 'nav-icon' }, icon(iconName)), label);
}

function chooseColumn(onPick) {
  let dialog;
  const columns = [...state.tables.Lajur].sort((a, b) => Number(a.kedudukan) - Number(b.kedudukan));
  dialog = openModal({
    title: 'Masuk ke lajur mana?',
    body: h('div', { class: 'move-choices' }, columns.map((column) => choice(column.tajuk, 'board', 'board', () => {
      dialog.close();
      onPick(column.id);
    }))),
    actions: [h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal')]
  });
}

function openMoveMenu({ table, id, read, done, exclude }) {
  let dialog;
  const go = async (destination, columnId) => {
    const overrides = read ? read() : {};
    done();
    await moveTo(destination.key, table, id, overrides, columnId);
    toast('Dipindah ke ' + destination.label);
  };
  dialog = openModal({
    title: 'Pindah ke mana?',
    body: h('div', { class: 'move-choices' }, DESTINATIONS
      .filter((destination) => destination.key !== exclude)
      .map((destination) => choice(destination.label, destination.icon, destination.key, () => {
        dialog.close();
        if (destination.key !== 'board') {
          go(destination);
          return;
        }
        if (!state.tables.Lajur.length) {
          toast('Papan belum ada lajur', true);
          return;
        }
        chooseColumn((columnId) => go(destination, columnId));
      }))),
    actions: [h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal')]
  });
}

/** Butang Pindah, Arkib dan Padam untuk kaki panel. */
export function manageButtons({ table, id, read, done }) {
  const record = findRecord(table, id);
  const archived = record && record.keadaan === 'arkib';
  const movable = table !== 'Kelas' && table !== 'Resit' && !archived;
  const exclude = { Tugasan: 'tasks', Kad: 'board' }[table] ||
    (record && record.ruang === 'info' ? 'info' : record && record.jenis === 'note' ? 'note' : null);
  return [
    movable && h('button', {
      class: 'button',
      type: 'button',
      onclick: () => openMoveMenu({ table, id, read, done, exclude })
    }, icon('move'), 'Pindah'),
    h('button', {
      class: 'button plain',
      type: 'button',
      onclick: () => {
        done();
        if (archived) {
          restoreRecord(table, id);
          toast('Dikeluarkan dari Arkib');
        } else {
          archiveWithUndo(table, id);
        }
      }
    }, icon(archived ? 'undo' : 'archive'), archived ? 'Keluarkan' : 'Arkib'),
    h('button', {
      class: 'button plain',
      type: 'button',
      onclick: () => {
        done();
        trashWithUndo(table, id);
      }
    }, icon('trash'), 'Padam')
  ].filter(Boolean);
}
