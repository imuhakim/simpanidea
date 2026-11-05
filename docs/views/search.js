// Carian merentas semua fungsi. Password tidak pernah dicari.
import { itemFromRow, recordsIn, state } from '../lib/data.js';
import { emptyState, h, icon } from '../lib/dom.js';
import { displayTitle, infoTitle, itemRow, openItem } from './library.js';
import { openTask } from './tasks.js';
import { openCard } from './board.js';
import { openClass } from './classes.js';
import { openReceipt } from './receipts.js';
import { openConversation } from './ai.js';

function matcher(query) {
  const needle = query.trim().toLowerCase();
  return (...fields) => fields.some((value) => String(value || '').toLowerCase().includes(needle));
}

function resultRow(iconName, title, sub, onclick) {
  return h('article', { class: 'row' },
    h('button', { class: 'row-main', type: 'button', onclick },
      h('span', { class: 'thumb' }, icon(iconName)),
      h('span', { class: 'row-text' },
        h('span', { class: 'row-title' }, title),
        sub && h('span', { class: 'row-sub' }, sub))));
}

function section(label, rows) {
  if (!rows.length) return null;
  return [
    h('h2', { class: 'section-label' }, label, h('span', { class: 'count' }, String(rows.length))),
    h('div', { class: 'rows' }, rows)
  ];
}

export function renderSearch() {
  const matches = matcher(state.query);
  const items = state.items.filter((item) => item.ruang === '' && matches(item.title, item.text, item.url));
  // Info Penting hanya dicari ikut tajuk, dan dibuka di halamannya supaya isinya kekal tersorok.
  const hiddenItems = state.items.filter((item) => item.ruang === 'info' && matches(item.title));
  const tasks = state.tables.Tugasan.filter((task) => matches(task.tajuk, task.nota));
  const cards = state.tables.Kad.filter((card) => matches(card.tajuk, card.nota));
  const classes = state.tables.Kelas.filter((kelas) => matches(kelas.nama, kelas.url, kelas.nota, kelas.berhenti_di));

  const receipts = state.tables.Resit.filter((receipt) => matches(receipt.peniaga, receipt.kategori, receipt.no_resit, receipt.nota, receipt.barangan));
  // Perbualan tentang Info Penting hanya dicari ikut tajuk, supaya isinya kekal tersorok.
  const openConversationIds = new Set(state.raw.MesejAI
    .filter((message) => matches(message.teks))
    .map((message) => message.perbualan_id));
  const conversations = state.tables.Perbualan.filter((conversation) => matches(conversation.tajuk, conversation.fokus_label) ||
    (conversation.ruang !== 'info' && openConversationIds.has(conversation.id)));
  const openers = { Tugasan: openTask, Kad: openCard, Kelas: openClass, Item: openItem, Resit: openReceipt };
  const archived = recordsIn('arkib').filter(({ record }) => (record.ruang === 'info'
    ? matches(record.tajuk)
    : matches(record.tajuk, record.nama, record.nota, record.url, record.peniaga)));
  const archivedTitle = ({ table, record }) => {
    if (table !== 'Item') return record.tajuk || record.nama || record.peniaga || 'Resit';
    const item = itemFromRow(record);
    return item.ruang === 'info' ? infoTitle(item) : displayTitle(item);
  };

  if (!items.length && !conversations.length && !receipts.length && !hiddenItems.length && !tasks.length && !cards.length && !classes.length && !archived.length) {
    return h('div', { class: 'page' }, emptyState('Tiada hasil', 'Tiada apa-apa sepadan dengan "' + state.query.trim() + '".'));
  }
  const columnName = (id) => (state.tables.Lajur.find((column) => column.id === id) || {}).tajuk;
  return h('div', { class: 'page' },
    section('Simpanan', items.map((item) => itemRow(item, { showUnread: true }))),
    section('Info Penting', hiddenItems.map((item) => resultRow('lock', infoTitle(item), 'Tersorok', () => {
      state.query = '';
      document.getElementById('search').value = '';
      if (location.hash === '#info') window.dispatchEvent(new Event('hashchange'));
      else location.hash = 'info';
    }))),
    section('Resit', receipts.map((receipt) => resultRow('receipt', receipt.peniaga || 'Resit', [receipt.tarikh, receipt.jumlah && (receipt.mata_wang || 'RM') + ' ' + Number(receipt.jumlah).toFixed(2)].filter(Boolean).join(' · '), () => openReceipt(receipt.id)))),
    section('Tanya AI', conversations.map((conversation) => resultRow(conversation.ruang === 'info' ? 'lock' : 'sparkle', conversation.tajuk || 'Perbualan', conversation.fokus_label, () => openConversation(conversation.id)))),
    section('Tugasan', tasks.map((task) => resultRow('tasks', task.tajuk, task.siap === 'ya' ? 'Siap' : task.nota, () => openTask(task.id)))),
    section('Papan', cards.map((card) => resultRow('board', card.tajuk, columnName(card.lajur_id), () => openCard(card.id)))),
    section('Kelas', classes.map((kelas) => resultRow('class', kelas.nama, kelas.berhenti_di, () => openClass(kelas.id)))),
    section('Arkib', archived.map((entry) => resultRow('archive', archivedTitle(entry), 'Dalam arkib', () => openers[entry.table](entry.record.id)))));
}
