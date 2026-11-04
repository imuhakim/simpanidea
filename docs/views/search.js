// Carian merentas semua fungsi. Password tidak pernah dicari.
import { state } from '../lib/data.js';
import { emptyState, h, icon } from '../lib/dom.js';
import { itemRow } from './library.js';
import { openTask } from './tasks.js';
import { openCard } from './board.js';
import { openClass } from './classes.js';

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
  const items = state.items.filter((item) => item.ruang !== 'lampiran' && matches(item.title, item.text, item.url));
  const tasks = state.tables.Tugasan.filter((task) => matches(task.tajuk, task.nota));
  const cards = state.tables.Kad.filter((card) => matches(card.tajuk, card.nota));
  const classes = state.tables.Kelas.filter((kelas) => matches(kelas.nama, kelas.url, kelas.nota, kelas.berhenti_di));

  if (!items.length && !tasks.length && !cards.length && !classes.length) {
    return h('div', { class: 'page' }, emptyState('Tiada hasil', 'Tiada apa-apa sepadan dengan "' + state.query.trim() + '".'));
  }
  const columnName = (id) => (state.tables.Lajur.find((column) => column.id === id) || {}).tajuk;
  return h('div', { class: 'page' },
    section('Simpanan', items.map((item) => itemRow(item, { showUnread: true }))),
    section('Tugasan', tasks.map((task) => resultRow('tasks', task.tajuk, task.siap === 'ya' ? 'Siap' : task.nota, () => openTask(task.id)))),
    section('Papan', cards.map((card) => resultRow('board', card.tajuk, columnName(card.lajur_id), () => openCard(card.id)))),
    section('Kelas', classes.map((kelas) => resultRow('class', kelas.nama, kelas.berhenti_di, () => openClass(kelas.id)))));
}
