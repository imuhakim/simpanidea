// Arkib untuk rujukan, dan Sampah untuk memulihkan rekod yang dipadam.
import { TRASH_LIFETIME_DAYS, hardDelete, itemFromRow, recordsIn } from '../lib/data.js';
import { askConfirm, emptyState, formatDate, h, icon, startOfDay, toast } from '../lib/dom.js';
import { imageHolder } from '../lib/images.js';
import { displayTitle, infoTitle, openItem } from './library.js';
import { openTask } from './tasks.js';
import { openCard } from './board.js';
import { openClass } from './classes.js';
import { restoreRecord } from './manage.js';

const SECTIONS = [
  { table: 'Item', label: 'Simpanan', icon: 'inbox', open: openItem },
  { table: 'Tugasan', label: 'Tugasan', icon: 'tasks', open: openTask },
  { table: 'Kad', label: 'Papan', icon: 'board', open: openCard },
  { table: 'Kelas', label: 'Kelas', icon: 'class', open: openClass }
];

function titleOf(table, record) {
  if (table === 'Item' && record.ruang === 'info') return infoTitle(itemFromRow(record));
  if (table === 'Item') return displayTitle(itemFromRow(record));
  return record.tajuk || record.nama || 'Tanpa tajuk';
}

function thumbFor(table, record, iconName) {
  if (record.ruang === 'info') return h('span', { class: 'thumb' }, icon('lock'));
  if (table === 'Item' && record.jenis === 'image') return imageHolder(record.id, 'thumb');
  return h('span', { class: 'thumb' }, icon(iconName));
}

function group(section, rows) {
  if (!rows.length) return null;
  return [
    h('h2', { class: 'section-label' }, section.label, h('span', { class: 'count' }, String(rows.length))),
    h('div', { class: 'rows' }, rows)
  ];
}

export function renderArchive() {
  const entries = recordsIn('arkib');
  if (!entries.length) {
    return h('div', { class: 'page' }, emptyState('Arkib kosong',
      'Tekan Arkib pada mana-mana rekod. Ia keluar dari senarai harian, tapi kekal di sini untuk dirujuk bila-bila masa.'));
  }
  return h('div', { class: 'page' }, SECTIONS.map((section) => group(section, entries
    .filter((entry) => entry.table === section.table)
    .map(({ table, record }) => h('article', { class: 'row' },
      h('button', { class: 'row-main', type: 'button', onclick: () => section.open(record.id) },
        thumbFor(table, record, section.icon),
        h('span', { class: 'row-text' },
          h('span', { class: 'row-title' }, titleOf(table, record)),
          h('span', { class: 'row-sub' }, formatDate(record.kemas_kini || record.dicipta)))),
      h('div', { class: 'row-side' },
        h('button', {
          class: 'button plain',
          type: 'button',
          onclick: () => {
            restoreRecord(table, record.id);
            toast('Dikeluarkan dari Arkib');
          }
        }, icon('undo'), 'Keluarkan')))))));
}

function daysLeft(record) {
  const removed = new Date(record.dibuang_pada);
  if (Number.isNaN(removed.getTime())) return TRASH_LIFETIME_DAYS;
  const passed = Math.floor((startOfDay(new Date()) - startOfDay(removed)) / 86400000);
  return Math.max(TRASH_LIFETIME_DAYS - passed, 0);
}

export function renderTrash() {
  const entries = recordsIn('sampah');
  if (!entries.length) {
    return h('div', { class: 'page' }, emptyState('Sampah kosong',
      'Rekod yang dipadam ada di sini selama ' + TRASH_LIFETIME_DAYS + ' hari, dan boleh dipulihkan.'));
  }
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('p', { class: 'page-note' }, 'Dibuang kekal secara automatik selepas ' + TRASH_LIFETIME_DAYS + ' hari.'),
      h('button', {
        class: 'button danger',
        type: 'button',
        onclick: async () => {
          const yes = await askConfirm({
            title: 'Kosongkan Sampah?',
            text: entries.length + ' rekod dan gambarnya akan dibuang kekal. Gambar dialih ke tong sampah Google Drive.',
            confirmLabel: 'Kosongkan'
          });
          if (!yes) return;
          entries.forEach(({ table, record }) => hardDelete(table, record));
          toast('Sampah dikosongkan');
        }
      }, 'Kosongkan')),
    SECTIONS.map((section) => group(section, entries
      .filter((entry) => entry.table === section.table)
      .map(({ table, record }) => {
        const left = daysLeft(record);
        return h('article', { class: 'row' },
          h('div', { class: 'row-main' },
            thumbFor(table, record, section.icon),
            h('span', { class: 'row-text' },
              h('span', { class: 'row-title' }, titleOf(table, record)),
              h('span', { class: 'row-sub' }, left + ' hari lagi'))),
          h('div', { class: 'row-side' },
            h('button', {
              class: 'button',
              type: 'button',
              onclick: () => {
                restoreRecord(table, record.id);
                toast('Dipulihkan');
              }
            }, icon('undo'), 'Pulihkan'),
            h('button', {
              class: 'icon-button',
              type: 'button',
              'aria-label': 'Padam kekal: ' + titleOf(table, record),
              title: 'Padam kekal',
              onclick: async () => {
                const yes = await askConfirm({
                  title: 'Padam kekal?',
                  text: '"' + titleOf(table, record) + '" tak boleh dipulihkan selepas ini.',
                  confirmLabel: 'Padam kekal'
                });
                if (yes) hardDelete(table, record);
              }
            }, icon('close'))));
      }))));
}
