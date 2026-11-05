// Inbox, Semua, Screenshot, Link, Nota dan Info Penting.
import { addItems, findItem, idList, imageItem, patchItem, processQueue, isConfigured, state, render, loadQueue } from '../lib/data.js';
import { checklistSummary, checklistText, parseChecklist, readableNote } from '../lib/checklist.js';
import { askText, celebrate, domainOf, emptyState, field, formatDate, h, icon, isWebUrl, openSheet, toast } from '../lib/dom.js';
import { attachmentEditor, imageHolder, imageUrlFor, openImage, photoButtons } from '../lib/images.js';
import { parseVideo } from '../lib/video.js';
import { archiveWithUndo, manageButtons } from './manage.js';
import { askAiButton } from './ai.js';
import { noteEditor } from './checklist.js';
import { openComposer } from './compose.js';

// Info Penting berasingan dan tersorok, jadi isinya tidak muncul di senarai lain.
const notAttachment = (item) => item.ruang !== 'lampiran' && item.ruang !== 'info';
const TYPE_LABEL = { image: 'Gambar', link: 'Link', note: 'Nota' };
const TYPE_ICON = { image: 'image', link: 'link', note: 'note' };

export const LIBRARY_VIEWS = {
  inbox: {
    title: 'Inbox', icon: 'inbox', layout: 'rows',
    filter: (item) => item.ruang === '' && item.status !== 'dilihat',
    empty: ['Inbox kosong', 'Tekan Share di phone dan pilih SimpanIdea, atau tampal dengan Ctrl+V di sini.']
  },
  all: {
    title: 'Semua', icon: 'all', layout: 'rows', filter: notAttachment,
    empty: ['Belum ada apa-apa', 'Screenshot, link dan nota yang anda simpan akan ada di sini.']
  },
  image: {
    title: 'Screenshot', icon: 'image', layout: 'gallery',
    filter: (item) => item.type === 'image' && notAttachment(item),
    empty: ['Belum ada screenshot', 'Screenshot yang dikongsi dari phone akan ada di sini.']
  },
  link: {
    title: 'Link', icon: 'link', layout: 'rows',
    filter: (item) => item.type === 'link' && notAttachment(item),
    empty: ['Belum ada link', 'Kongsi link dari Chrome atau YouTube, atau tekan Tambah.']
  },
  note: {
    title: 'Nota', icon: 'note', layout: 'notes',
    filter: (item) => item.type === 'note' && notAttachment(item),
    empty: ['Belum ada nota', 'Tulis nota biasa, atau buat checklist untuk ditanda satu per satu.']
  },
  info: {
    title: 'Info Penting', icon: 'info', layout: 'hidden',
    filter: (item) => item.ruang === 'info',
    empty: ['Belum ada info penting', 'Ambil gambar resit, kad, tiket atau apa saja yang anda perlu rujuk semula.']
  }
};
for (const [key, view] of Object.entries(LIBRARY_VIEWS)) view.render = () => renderLibrary(key);

export function displayTitle(item) {
  if (item.title) return item.type === 'image' ? item.title.replace(/\.[a-z0-9]{2,5}$/i, '') : item.title;
  if (item.type === 'link') return domainOf(item.url) || item.url;
  if (item.type === 'note') {
    const rows = parseChecklist(item.text);
    if (rows) return rows[0].text;
    return (item.text || '').split('\n')[0] || 'Nota bergambar';
  }
  return 'Gambar';
}

function subtitle(item) {
  if (item.type === 'link') return item.text && item.title ? item.text : domainOf(item.url);
  if (item.type === 'note') {
    const rows = parseChecklist(item.text);
    if (rows) return checklistSummary(rows);
    return item.title ? item.text : (item.text || '').split('\n').slice(1).join(' ');
  }
  return item.text || '';
}

const newestFirst = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));

function queuedThumb(entry) {
  if (entry.ruang === 'info') return h('span', { class: 'thumb' }, icon('lock'));
  if (entry.type === 'image' && entry.ready) return imageHolder(entry.id, 'thumb');
  return h('span', { class: 'thumb' }, icon(TYPE_ICON[entry.type] || 'note'));
}

function itemThumb(item) {
  if (item.type === 'image') return imageHolder(item.id, 'thumb');
  const [firstImage] = idList(item.gambar);
  if (firstImage) return imageHolder(firstImage, 'thumb');
  return h('span', { class: 'thumb' }, icon(TYPE_ICON[item.type] || 'note'));
}

export function itemRow(item, { markable = false, showUnread = false } = {}) {
  return h('article', { class: 'row' },
    h('button', { class: 'row-main', type: 'button', onclick: () => openItem(item.id) },
      itemThumb(item),
      h('span', { class: 'row-text' },
        h('span', { class: 'row-title' }, displayTitle(item)),
        h('span', { class: 'row-sub' }, subtitle(item) || TYPE_LABEL[item.type] || ''),
        h('span', { class: 'row-when' }, formatDate(item.createdAt))),
      showUnread && item.status !== 'dilihat' && h('span', { class: 'unread', title: 'Belum dilihat' })),
    markable && h('div', { class: 'row-side' },
      h('button', {
        class: 'icon-button',
        type: 'button',
        'aria-label': 'Arkibkan: ' + displayTitle(item),
        title: 'Arkibkan',
        onclick: () => archiveWithUndo('Item', item.id)
      }, icon('archive')),
      h('button', {
        class: 'icon-button',
        type: 'button',
        'aria-label': 'Tanda sudah dilihat: ' + displayTitle(item),
        title: 'Tanda sudah dilihat',
        onclick: (event) => {
          // Baris meluncur keluar dahulu sebelum senarai dilukis semula.
          event.currentTarget.closest('.row').classList.add('leaving');
          setTimeout(() => patchItem(item.id, { status: 'dilihat' }), 200);
        }
      }, icon('check'))));
}

function queueRow(entry) {
  const failed = entry.status === 'failed';
  const label = { sending: 'Sedang dihantar' }[entry.status] ||
    (failed ? 'Gagal: ' + entry.error : entry.error || 'Menunggu dihantar');
  return h('article', { class: 'row' },
    h('div', { class: 'row-main' },
      queuedThumb(entry),
      h('span', { class: 'row-text' },
        h('span', { class: 'row-title' }, entry.ruang === 'info' ? infoTitle(entry) : displayTitle(entry)),
        h('span', { class: 'row-sub row-state' + (failed ? ' failed' : '') }, label),
        h('span', { class: 'row-when' }, formatDate(entry.createdAt)))),
    entry.status !== 'sending' && h('div', { class: 'row-side' },
      isConfigured() && h('button', { class: 'button plain', type: 'button', onclick: processQueue }, 'Cuba lagi'),
      h('button', {
        class: 'button plain',
        type: 'button',
        onclick: async () => {
          await SimpanStore.removeQueued(entry.id);
          await SimpanStore.removeImage(entry.id);
          await loadQueue();
          render();
        }
      }, 'Buang')));
}

function galleryTile(item) {
  return h('button', {
    class: 'tile',
    type: 'button',
    'aria-label': displayTitle(item),
    onclick: () => openItem(item.id)
  }, imageHolder(item.id, '', displayTitle(item)),
  item.title && !/\.[a-z0-9]{2,5}$/i.test(item.title) ? h('span', { class: 'tile-title' }, displayTitle(item)) : null,
  h('span', { class: 'tile-when' }, formatDate(item.createdAt)));
}

// Warna tetap untuk setiap nota, supaya tidak berubah setiap kali dibuka.
function noteColour(id) {
  let total = 0;
  for (const char of String(id)) total = (total + char.charCodeAt(0)) % 997;
  return total % 6;
}

function statTile(tone, iconName, value, label) {
  return h('a', { class: 'stat', href: '#' + tone, 'data-tone': tone },
    h('span', { class: 'stat-icon' }, icon(iconName)),
    h('span', { class: 'stat-value' }, String(value)),
    h('span', { class: 'stat-label' }, label));
}

function overviewStats() {
  const today = new Date().toISOString().slice(0, 10);
  const openTasks = state.tables.Tugasan.filter((task) => task.siap !== 'ya');
  const dueTasks = openTasks.filter((task) => task.tarikh_akhir && task.tarikh_akhir <= today).length;
  const videos = state.items.filter((item) => item.type === 'link' && item.status !== 'dilihat' && parseVideo(item.url)).length;
  const learning = state.tables.Kelas.filter((kelas) => kelas.status !== 'siap').length;
  return h('div', { class: 'stats' },
    statTile('tasks', 'tasks', openTasks.length, dueTasks ? dueTasks + ' perlu disiapkan' : 'Tugasan belum siap'),
    statTile('board', 'board', state.tables.Kad.length, 'Kad di papan'),
    statTile('classes', 'class', learning, 'Kelas belum siap'),
    statTile('watch', 'watch', videos, 'Video belum ditonton'));
}

/** Ditanda terus dari senarai, tanpa perlu membuka nota. */
function toggleChecklist(id, index, done, box) {
  const item = findItem(id);
  const rows = item && parseChecklist(item.text);
  if (!rows || !rows[index]) return;
  rows[index].done = done;
  if (done && rows.every((row) => row.done)) celebrate(box.left + box.width / 2, box.top);
  patchItem(id, { text: checklistText(rows) });
}

function checklistCard(item, rows) {
  return h('article', {
    class: 'note note-list note-c' + noteColour(item.id),
    onclick: (event) => { if (!event.target.closest('label, button')) openItem(item.id); }
  },
  h('button', { class: 'note-open', type: 'button', onclick: () => openItem(item.id) },
    h('span', { class: 'note-title' }, item.title || 'Checklist')),
  h('div', { class: 'note-checks' }, rows.map((row, index) => h('label', { class: 'note-check' + (row.done ? ' done' : '') },
    h('input', {
      class: 'check-box',
      type: 'checkbox',
      checked: row.done,
      onchange: (event) => {
        const box = event.target.getBoundingClientRect();
        // Lepaskan fokus supaya senarai boleh dilukis semula dengan segera.
        event.target.blur();
        toggleChecklist(item.id, index, event.target.checked, box);
      }
    }),
    h('span', {}, row.text)))),
  h('span', { class: 'note-meta' }, checklistSummary(rows) + ' · ' + formatDate(item.createdAt)));
}

function noteCard(item) {
  const rows = parseChecklist(item.text);
  if (rows) return checklistCard(item, rows);
  const [firstImage] = idList(item.gambar);
  const images = idList(item.gambar).length;
  return h('button', { class: 'note note-c' + noteColour(item.id), type: 'button', onclick: () => openItem(item.id) },
    firstImage && imageHolder(firstImage, 'card-image'),
    item.title && h('span', { class: 'note-title' }, item.title),
    item.text && h('span', { class: 'note-text' }, item.text),
    h('span', { class: 'note-meta' },
      formatDate(item.createdAt),
      images > 0 && [' · ', icon('clip'), String(images)]));
}

/* Info Penting: hanya tajuk kelihatan, dan isi keluar bila ikon mata ditekan. */
const revealed = new Set();

export function hideAllInfo() {
  revealed.clear();
}

export function infoTitle(item) {
  const title = String(item.title || '').replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  return title || 'Tanpa tajuk';
}

function infoContent(item) {
  const [firstAttachment] = idList(item.gambar);
  const imageIds = item.type === 'image' ? [item.id] : idList(item.gambar);
  return h('div', { class: 'info-content' },
    imageIds.length > 0 && h('div', { class: 'info-images' }, imageIds.map((id) => h('button', {
      class: 'info-image',
      type: 'button',
      'aria-label': 'Besarkan gambar',
      onclick: () => openImage(id, infoTitle(item))
    }, imageHolder(id)))),
    item.text && h('p', { class: 'info-text' }, readableNote(item.text)),
    isWebUrl(item.url) && h('a', { class: 'sheet-link', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, item.url),
    !imageIds.length && !item.text && !item.url && !firstAttachment && h('p', { class: 'info-text muted' }, 'Tiada isi.'),
    h('div', { class: 'button-row' },
      h('button', { class: 'button', type: 'button', onclick: () => openItem(item.id) }, 'Buka dan edit')));
}

function infoRow(item) {
  const open = revealed.has(item.id);
  const title = infoTitle(item);
  return h('article', { class: 'info-row' + (open ? ' open' : '') },
    h('div', { class: 'info-head' },
      h('span', { class: 'thumb' }, icon(open ? TYPE_ICON[item.type] || 'note' : 'lock')),
      h('span', { class: 'row-text' },
        h('span', { class: 'row-title' }, title),
        h('span', { class: 'row-sub' }, formatDate(item.createdAt))),
      h('button', {
        class: 'icon-button info-eye',
        type: 'button',
        'aria-pressed': String(open),
        'aria-label': (open ? 'Sorok isi: ' : 'Tunjuk isi: ') + title,
        title: open ? 'Sorok' : 'Tunjuk',
        onclick: () => {
          if (open) revealed.delete(item.id);
          else revealed.add(item.id);
          render();
        }
      }, icon(open ? 'eye-off' : 'eye'))),
    open && infoContent(item));
}

function pendingEntries(filter) {
  return state.queue.filter((entry) => !entry.kind && filter(entry));
}

export function renderLibrary(key) {
  const view = LIBRARY_VIEWS[key];
  const queued = pendingEntries(view.filter);
  const items = state.items.filter(view.filter).sort(newestFirst);
  const children = [];

  if (key === 'inbox' && isConfigured()) children.push(overviewStats());

  if (key === 'note') {
    children.push(h('div', { class: 'page-head' },
      h('div', { class: 'button-row' },
        h('button', { class: 'button', type: 'button', onclick: () => openComposer({ kind: 'note', mode: 'note' }) }, icon('note'), 'Nota baru'),
        h('button', { class: 'button', type: 'button', onclick: () => openComposer({ kind: 'note', mode: 'checklist' }) }, icon('check'), 'Checklist baru'))));
  }

  if (key === 'info') {
    children.push(h('div', { class: 'page-head' },
      h('p', { class: 'page-note' }, 'Hanya tajuk kelihatan. Tekan ikon mata untuk lihat isi.'),
      h('div', { class: 'button-row' }, photoButtons(saveInfoPhotos))));
  }

  if (queued.length) {
    children.push(h('div', { class: 'rows' }, queued.map(queueRow)));
  }

  if (!queued.length && !items.length) {
    children.push(isConfigured() || key === 'info'
      ? emptyState(view.empty[0], view.empty[1])
      : emptyState('Sambungkan ke Google dahulu', 'Masukkan URL Web App dan kunci rahsia supaya data anda boleh disimpan.',
        h('a', { class: 'button primary', href: '#settings' }, 'Buka Tetapan')));
  } else if (view.layout === 'gallery') {
    children.push(h('div', { class: 'gallery' }, items.map(galleryTile)));
  } else if (view.layout === 'notes') {
    children.push(h('div', { class: 'notes' }, items.map(noteCard)));
  } else if (view.layout === 'hidden') {
    children.push(h('div', { class: 'rows' }, items.map(infoRow)));
  } else {
    children.push(h('div', { class: 'rows' }, items.map((item) => itemRow(item, {
      markable: key === 'inbox',
      showUnread: key !== 'inbox'
    }))));
  }
  return h('div', { class: view.layout === 'rows' ? 'page' : 'page wide' }, children);
}

// Gambar terus disimpan; tajuk boleh diisi kemudian dalam butiran.
async function saveInfoPhotos(files) {
  try {
    // Tajuk sahaja yang kelihatan di sini, jadi minta terus masa menyimpan.
    const title = await askText({ title: 'Tajuk untuk gambar ini', label: 'Tajuk', confirmLabel: 'Simpan' });
    if (title === null) return;
    await addItems(await Promise.all(files.map((file) => imageItem(file, { ruang: 'info', title }))));
  } catch (err) {
    toast(err.message, true);
  }
}

export function openItem(id) {
  const item = findItem(id);
  if (!item) return;

  const titleInput = h('input', { class: 'input', type: 'text', value: item.title, placeholder: 'Tiada tajuk' });
  const editor = noteEditor({ text: item.text, showModes: item.type === 'note' });
  const attachments = attachmentEditor(item.gambar);
  const place = h('select', { class: 'input' },
    h('option', { value: '', selected: item.ruang === '' }, 'Inbox'),
    h('option', { value: 'info', selected: item.ruang === 'info' }, 'Info Penting'));
  const isNew = item.status !== 'dilihat';
  const video = item.type === 'link' ? parseVideo(item.url) : null;
  let saved = false;
  let dialog;

  const body = [];
  if (item.type === 'image') {
    const frame = h('button', { class: 'sheet-image', type: 'button', 'aria-label': 'Besarkan gambar', onclick: () => openImage(item.id, displayTitle(item)) });
    imageUrlFor(item.id)
      .then((url) => frame.append(h('img', { src: url, alt: displayTitle(item) })))
      .catch(() => { frame.textContent = 'Gambar tidak dapat dimuat.'; });
    body.push(frame);
  }
  if (isWebUrl(item.url)) {
    body.push(h('a', { class: 'sheet-link', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, item.url));
  }
  const quickActions = [
    askAiButton(() => ({
      label: displayTitle(item),
      text: 'Jenis: ' + (TYPE_LABEL[item.type] || 'Item') + '\nTajuk: ' + titleInput.value +
        '\nCatatan: ' + editor.value() + (item.url ? '\nLink: ' + item.url : ''),
      imageIds: item.type === 'image' ? [item.id] : idList(attachments.value()),
      hidden: item.ruang === 'info'
    })),
    video && h('a', { class: 'button primary', href: '#watch', onclick: () => {
      state.watchTarget = item.id;
      dialog.close();
    } }, icon('play'), 'Tonton'),
    isWebUrl(item.url) && h('a', { class: 'button', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, icon('open'), 'Buka link'),
    isWebUrl(item.driveUrl) && h('a', { class: 'button', href: item.driveUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('open'), 'Buka di Drive'),
    h('button', {
      class: 'button',
      type: 'button',
      onclick: () => {
        patchItem(item.id, { status: isNew ? 'dilihat' : 'baru' });
        dialog.close();
      }
    }, icon(isNew ? 'check' : 'undo'), isNew ? 'Tanda sudah dilihat' : 'Pulangkan ke Inbox')
  ];
  body.push(h('div', { class: 'sheet-actions' }, quickActions));
  body.push(field('Tajuk', titleInput), editor.element, field('Simpan di', place));
  if (item.type !== 'image') body.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Gambar'), attachments.element));

  dialog = openSheet({
    title: displayTitle(item),
    kicker: (TYPE_LABEL[item.type] || 'Item') + ' · ' + formatDate(item.createdAt),
    body,
    onClose: () => { if (!saved) attachments.discard(); },
    actions: [
      ...manageButtons({
        table: 'Item',
        id: item.id,
        read: () => ({ title: titleInput.value.trim(), text: editor.value(), gambar: attachments.value() }),
        done: () => {
          saved = true;
          attachments.commit();
          dialog.close();
        }
      }),
      h('span', { class: 'foot-spacer' }),
      h('button', {
        class: 'button primary',
        type: 'button',
        onclick: () => {
          saved = true;
          attachments.commit();
          patchItem(item.id, {
            title: titleInput.value.trim(),
            text: editor.value(),
            ruang: place.value,
            gambar: attachments.value()
          });
          dialog.close();
        }
      }, 'Simpan')
    ]
  });
}
