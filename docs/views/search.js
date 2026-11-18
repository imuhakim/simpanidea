// Carian merentas semua fungsi, disusun ikut paling sepadan. Password tidak pernah dicari.
// Cari dengan AI pula mencari ikut maksud, dan hanya berjalan bila butangnya ditekan.
import { callBackend, itemFromRow, state } from '../lib/data.js';
import { emptyState, formatDate, h, icon } from '../lib/dom.js';
import { markSegments, recencyBonus, scoreRecord, snippet } from '../lib/search.js';
import { displayTitle, infoTitle, itemThumb, openItem } from './library.js';
import { openTask } from './tasks.js';
import { openCard } from './board.js';
import { openClass } from './classes.js';
import { openReceipt } from './receipts.js';
import { currentModel, openConversation } from './ai.js';

const MAX_RESULTS = 100;
const ARCHIVE_WEIGHT = 0.6;
const RECENT_KEY = 'simpanidea.carian';
const MAX_RECENT = 8;
const AI_CONTEXT_LENGTH = 55000;
const AI_FIELD_LENGTH = 180;
const AI_MAX_RESULTS = 10;

const ITEM_KIND = { image: ['Screenshot', 'image'], link: ['Link', 'link'], note: ['Nota', 'note'] };
const TYPES = [
  { key: 'note', label: 'Nota' },
  { key: 'image', label: 'Screenshot' },
  { key: 'link', label: 'Link' },
  { key: 'info', label: 'Info Penting' },
  { key: 'task', label: 'Tugasan' },
  { key: 'card', label: 'Papan' },
  { key: 'class', label: 'Kelas' },
  { key: 'receipt', label: 'Resit' },
  { key: 'chat', label: 'Tanya AI' }
];

let typeFilter = '';
// Jawapan AI disimpan ikut carian, supaya tidak hilang bila senarai dilukis semula.
let aiSearch = null;

const plainNote = (text) => String(text || '').replace(/^\[[ xX]\]\s+/gm, '');
const columnName = (id) => (state.tables.Lajur.find((column) => column.id === id) || {}).tajuk || '';

function openInfoPage() {
  clearQuery();
  if (location.hash === '#info') window.dispatchEvent(new Event('hashchange'));
  else location.hash = 'info';
}

function clearQuery() {
  state.query = '';
  document.getElementById('search').value = '';
}

/** Semua rekod yang boleh dicari, aktif atau dalam arkib. Rekod dalam sampah tidak dicari. */
function searchable() {
  const records = [];
  const add = (record, entry) => {
    if (record.keadaan === 'sampah') return;
    records.push({ archived: record.keadaan === 'arkib', when: record.dicipta, id: record.id, ...entry });
  };
  for (const row of state.raw.Item || []) {
    if (row.ruang === 'lampiran') continue;
    const item = itemFromRow(row);
    if (item.ruang === 'info') {
      // Info Penting hanya dicari ikut tajuk, dan dibuka di halamannya supaya isinya kekal tersorok.
      add(row, { type: 'info', label: 'Info Penting', iconName: 'lock', title: infoTitle(item), fields: [{ text: item.title, weight: 3 }], sub: 'Tersorok', open: openInfoPage });
      continue;
    }
    const [label, iconName] = ITEM_KIND[item.type] || ['Item', 'note'];
    const body = plainNote(item.text);
    add(row, {
      type: item.type,
      label: item.kategori ? label + ' · ' + item.kategori : label,
      iconName,
      thumb: () => itemThumb(item),
      title: displayTitle(item),
      body,
      fields: [{ text: item.title || displayTitle(item), weight: 3 }, { text: item.kategori, weight: 2 }, { text: body }, { text: item.url }],
      open: () => openItem(item.id)
    });
  }
  for (const task of state.raw.Tugasan || []) {
    add(task, { type: 'task', label: task.siap === 'ya' ? 'Tugasan · Siap' : 'Tugasan', iconName: 'tasks', title: task.tajuk, body: task.nota, fields: [{ text: task.tajuk, weight: 3 }, { text: task.nota }], open: () => openTask(task.id) });
  }
  for (const card of state.raw.Kad || []) {
    const column = columnName(card.lajur_id);
    add(card, { type: 'card', label: column ? 'Papan · ' + column : 'Papan', iconName: 'board', title: card.tajuk, body: card.nota, fields: [{ text: card.tajuk, weight: 3 }, { text: card.nota }, { text: column }], open: () => openCard(card.id) });
  }
  for (const kelas of state.raw.Kelas || []) {
    add(kelas, { type: 'class', label: 'Kelas', iconName: 'class', title: kelas.nama, body: kelas.berhenti_di || kelas.nota, fields: [{ text: kelas.nama, weight: 3 }, { text: kelas.nota }, { text: kelas.berhenti_di }, { text: kelas.url }], open: () => openClass(kelas.id) });
  }
  for (const receipt of state.raw.Resit || []) {
    const amount = receipt.jumlah ? (receipt.mata_wang || 'RM') + ' ' + Number(receipt.jumlah).toFixed(2) : '';
    add(receipt, {
      type: 'receipt',
      label: ['Resit', receipt.tarikh, amount].filter(Boolean).join(' · '),
      iconName: 'receipt',
      title: receipt.peniaga || 'Resit',
      body: receipt.nota,
      fields: [{ text: receipt.peniaga, weight: 3 }, { text: receipt.kategori, weight: 2 }, { text: receipt.no_resit }, { text: receipt.nota }, { text: receipt.barangan }],
      open: () => openReceipt(receipt.id)
    });
  }
  const messages = new Map();
  for (const message of state.raw.MesejAI || []) {
    messages.set(message.perbualan_id, (messages.get(message.perbualan_id) || '') + '\n' + message.teks);
  }
  for (const conversation of state.raw.Perbualan || []) {
    // Perbualan tentang Info Penting hanya dicari ikut tajuk, supaya isinya kekal tersorok.
    const hidden = conversation.ruang === 'info';
    add(conversation, {
      type: 'chat',
      label: 'Tanya AI',
      iconName: hidden ? 'lock' : 'sparkle',
      title: conversation.tajuk || 'Perbualan',
      body: hidden ? '' : messages.get(conversation.id),
      fields: [{ text: conversation.tajuk, weight: 3 }, { text: conversation.fokus_label, weight: 2 }, { text: hidden ? '' : messages.get(conversation.id) }],
      open: () => openConversation(conversation.id)
    });
  }
  return records;
}

function marked(text, hits) {
  return markSegments(text, hits).map((part) => (part.hit ? h('mark', {}, part.text) : part.text));
}

/* Carian terakhir */
export function recentSearches() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(list) ? list.filter((value) => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberSearch(query) {
  const value = String(query || '').trim();
  if (!value) return;
  const list = [value, ...recentSearches().filter((other) => other.toLowerCase() !== value.toLowerCase())].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Carian terakhir hanya kemudahan; abaikan kalau storan penuh atau disekat.
  }
}

function forgetSearches() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // Abaikan.
  }
}

/** Dipaparkan bila kotak carian ditekan tetapi masih kosong. */
function renderRecent() {
  const list = recentSearches();
  const search = document.getElementById('search');
  const choose = (value) => (event) => {
    // Kekalkan fokus pada kotak carian supaya panel ini tidak tertutup sebelum pilihan diterima.
    event.preventDefault();
    search.value = value;
    search.dispatchEvent(new Event('input'));
  };
  return h('div', { class: 'page' },
    list.length
      ? [
        h('h2', { class: 'section-label' }, 'Carian terakhir'),
        h('div', { class: 'tabs-inline' }, list.map((value) => h('button', { class: 'tab-inline', type: 'button', onpointerdown: choose(value) }, icon('search'), value))),
        h('button', {
          class: 'button plain',
          type: 'button',
          onpointerdown: (event) => {
            event.preventDefault();
            forgetSearches();
            window.dispatchEvent(new Event('simpanidea:redraw'));
          }
        }, 'Padam carian terakhir')
      ]
      : null,
    h('p', { class: 'page-note' }, 'Taip apa yang anda ingat. Susunan perkataan, ejaan sedikit salah dan imbuhan seperti "menyimpan" atau "simpanan" tidak menjadi masalah.'));
}

/* Cari dengan AI */
function aiLine(ref, record) {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim().slice(0, AI_FIELD_LENGTH);
  return [ref, record.label, clean(record.title), record.type === 'info' ? '' : clean(record.body)].filter(Boolean).join(' | ');
}

async function runAiSearch(query, records) {
  const sorted = [...records].sort((a, b) => String(b.when).localeCompare(String(a.when)));
  const lines = [];
  const refs = new Map();
  let length = 0;
  for (const record of sorted) {
    const ref = String(refs.size + 1);
    const line = aiLine(ref, record);
    if (length + line.length + 1 > AI_CONTEXT_LENGTH) break;
    lines.push(line);
    refs.set(ref, record);
    length += line.length + 1;
  }
  aiSearch = { query, status: 'loading', rows: [], error: '' };
  window.dispatchEvent(new Event('simpanidea:redraw'));
  const message = 'Cari dalam <data_simpanidea> rekod yang berkaitan dengan maksud carian ini, walaupun perkataannya berbeza: "' + query + '"\n' +
    'Setiap baris data bermula dengan nombor rujukan. Jawab dengan paling banyak ' + AI_MAX_RESULTS + ' baris, yang paling berkaitan dahulu, ' +
    'dalam bentuk "nombor | sebab ringkas" (kurang 12 patah perkataan, dalam bahasa carian). Jangan tulis apa-apa lagi. Kalau tiada yang berkaitan, jawab TIADA sahaja.';
  let result;
  try {
    result = await callBackend({ action: 'aiChat', model: currentModel(), messages: [{ role: 'user', text: message }], context: lines.join('\n') });
  } catch {
    result = { ok: false, error: 'Tidak dapat sampai ke Google. Semak internet dan cuba lagi.' };
  }
  if (!aiSearch || aiSearch.query !== query) return;
  if (!result.ok) {
    aiSearch = { query, status: 'error', rows: [], error: result.code === 'no_key' ? 'Masukkan kunci API Claude dalam Tetapan dahulu.' : result.error };
  } else {
    const seen = new Set();
    const rows = [];
    for (const line of String(result.text || '').split('\n')) {
      const match = line.trim().match(/^[-*#[]*\s*(\d+)\]?\s*[|:.)-]\s*(.+)$/);
      if (!match || seen.has(match[1]) || !refs.has(match[1])) continue;
      seen.add(match[1]);
      rows.push({ record: refs.get(match[1]), reason: match[2].trim() });
    }
    aiSearch = { query, status: 'done', rows: rows.slice(0, AI_MAX_RESULTS), error: '' };
  }
  window.dispatchEvent(new Event('simpanidea:redraw'));
}

function resultRow(record, { hits, reason } = {}) {
  const open = () => {
    rememberSearch(state.query);
    record.open();
  };
  const sub = reason || (record.body ? snippet(record.body, hits) : '');
  return h('article', { class: 'row' + (record.archived ? ' archived' : '') },
    h('button', { class: 'row-main', type: 'button', onclick: open },
      record.thumb ? record.thumb() : h('span', { class: 'thumb' }, icon(record.iconName)),
      h('span', { class: 'row-text' },
        h('span', { class: 'row-title' }, hits ? marked(record.title, hits) : record.title),
        sub && h('span', { class: 'row-sub' + (reason ? ' ai-reason' : '') }, hits ? marked(sub, hits) : sub),
        h('span', { class: 'row-when' }, [record.label, record.archived && 'Dalam arkib', record.when && formatDate(record.when)].filter(Boolean).join(' · ')))));
}

function aiSection(query, records) {
  const current = aiSearch && aiSearch.query === query ? aiSearch : null;
  const button = h('button', {
    class: 'button ai-button',
    type: 'button',
    disabled: Boolean(current && current.status === 'loading'),
    onclick: () => {
      rememberSearch(query);
      runAiSearch(query, records);
    }
  }, icon('sparkle'), current && current.status === 'loading' ? 'AI sedang mencari…' : current ? 'Cari semula dengan AI' : 'Cari dengan AI');
  const children = [h('h2', { class: 'section-label' }, icon('sparkle'), 'Ikut maksud')];
  if (!current || current.status === 'loading') {
    children.push(h('p', { class: 'page-note' }, 'Tidak jumpa? AI boleh mencari yang berkaitan walaupun perkataannya lain. Isi Info Penting dan kata laluan tidak dihantar.'));
  } else if (current.status === 'error') {
    children.push(h('p', { class: 'page-note failed' }, current.error));
  } else if (!current.rows.length) {
    children.push(h('p', { class: 'page-note' }, 'AI tidak menjumpai apa-apa yang berkaitan.'));
  } else {
    children.push(h('div', { class: 'rows' }, current.rows.map((row) => resultRow(row.record, { reason: row.reason }))));
  }
  children.push(h('div', { class: 'button-row' }, button));
  return h('section', { class: 'ai-search' }, children);
}

export function renderSearch() {
  const query = state.query.trim();
  if (!query) return renderRecent();
  const records = searchable();
  const now = Date.now();
  const results = [];
  for (const record of records) {
    const match = scoreRecord(query, record.fields);
    if (!match) continue;
    const score = (match.score + recencyBonus(record.when, now)) * (record.archived ? ARCHIVE_WEIGHT : 1);
    results.push({ record, hits: match.hits, score });
  }
  results.sort((a, b) => b.score - a.score);

  const counts = new Map();
  for (const { record } of results) counts.set(record.type, (counts.get(record.type) || 0) + 1);
  if (typeFilter && !counts.has(typeFilter)) typeFilter = '';
  const shown = results.filter(({ record }) => !typeFilter || record.type === typeFilter).slice(0, MAX_RESULTS);

  const chip = (key, label, count) => h('button', {
    class: 'tab-inline',
    type: 'button',
    'aria-pressed': String(typeFilter === key),
    onclick: () => {
      typeFilter = key;
      window.dispatchEvent(new Event('simpanidea:redraw'));
    }
  }, label, h('span', { class: 'count' }, String(count)));

  return h('div', { class: 'page' },
    results.length
      ? [
        counts.size > 1 && h('div', { class: 'tabs-inline', role: 'group', 'aria-label': 'Jenis' },
          chip('', 'Semua', results.length),
          TYPES.filter((type) => counts.has(type.key)).map((type) => chip(type.key, type.label, counts.get(type.key)))),
        h('div', { class: 'rows' }, shown.map(({ record, hits }) => resultRow(record, { hits })))
      ]
      : emptyState('Tiada hasil', 'Tiada apa-apa sepadan dengan "' + query + '". Cuba perkataan lain, atau tekan Cari dengan AI.'),
    aiSection(query, records));
}
