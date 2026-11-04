// Inbox, Semua, Screenshot, Link, Nota dan Info Penting.
import { addItems, deleteRecord, idList, imageItem, patchItem, processQueue, isConfigured, state, render, loadQueue } from '../lib/data.js';
import { askConfirm, domainOf, emptyState, field, formatDate, h, icon, isWebUrl, openSheet, toast } from '../lib/dom.js';
import { attachmentEditor, deleteAttachments, imageHolder, imageUrlFor, openImage, photoButtons } from '../lib/images.js';
import { parseVideo } from '../lib/video.js';

const notAttachment = (item) => item.ruang !== 'lampiran';
const TYPE_LABEL = { image: 'Gambar', link: 'Link', note: 'Nota' };
const TYPE_ICON = { image: 'image', link: 'link', note: 'note' };

export const LIBRARY_VIEWS = {
  inbox: {
    title: 'Inbox', icon: 'inbox', layout: 'rows',
    filter: (item) => item.ruang === '' && item.status !== 'dilihat',
    empty: ['Inbox kosong', 'Tekan Share kat phone dan pilih SimpanIdea, atau tampal dengan Ctrl+V di sini.']
  },
  all: {
    title: 'Semua', icon: 'all', layout: 'rows', filter: notAttachment,
    empty: ['Belum ada apa-apa', 'Screenshot, link dan nota yang kau simpan akan ada di sini.']
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
    empty: ['Belum ada nota', 'Tekan Tambah untuk tulis idea kau.']
  },
  info: {
    title: 'Info Penting', icon: 'info', layout: 'mixed',
    filter: (item) => item.ruang === 'info',
    empty: ['Belum ada info penting', 'Ambil gambar resit, kad, tiket atau apa saja yang kau perlu rujuk semula.']
  }
};
for (const [key, view] of Object.entries(LIBRARY_VIEWS)) view.render = () => renderLibrary(key);

export function displayTitle(item) {
  if (item.title) return item.type === 'image' ? item.title.replace(/\.[a-z0-9]{2,5}$/i, '') : item.title;
  if (item.type === 'link') return domainOf(item.url) || item.url;
  if (item.type === 'note') return (item.text || '').split('\n')[0] || 'Nota bergambar';
  return 'Gambar';
}

function subtitle(item) {
  if (item.type === 'link') return item.text && item.title ? item.text : domainOf(item.url);
  if (item.type === 'note') return item.title ? item.text : (item.text || '').split('\n').slice(1).join(' ');
  return item.text || '';
}

const newestFirst = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));

function queuedThumb(entry) {
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
        h('span', { class: 'row-sub' }, subtitle(item) || TYPE_LABEL[item.type] || '')),
      showUnread && item.status !== 'dilihat' && h('span', { class: 'unread', title: 'Belum dilihat' }),
      h('span', { class: 'row-date' }, formatDate(item.createdAt))),
    markable && h('div', { class: 'row-side' },
      h('button', {
        class: 'icon-button',
        type: 'button',
        'aria-label': 'Tanda dah tengok: ' + displayTitle(item),
        title: 'Tanda dah tengok',
        onclick: () => patchItem(item.id, { status: 'dilihat' })
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
        h('span', { class: 'row-title' }, displayTitle(entry)),
        h('span', { class: 'row-sub row-state' + (failed ? ' failed' : '') }, label))),
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
  }, imageHolder(item.id, '', displayTitle(item)), item.title && !/\.[a-z0-9]{2,5}$/i.test(item.title)
    ? h('span', { class: 'tile-title' }, displayTitle(item))
    : null);
}

function noteCard(item) {
  const [firstImage] = idList(item.gambar);
  const images = idList(item.gambar).length;
  return h('button', { class: 'note', type: 'button', onclick: () => openItem(item.id) },
    firstImage && imageHolder(firstImage, 'card-image'),
    item.title && h('span', { class: 'note-title' }, item.title),
    item.text && h('span', { class: 'note-text' }, item.text),
    h('span', { class: 'note-meta' },
      formatDate(item.createdAt),
      images > 0 && [' · ', icon('clip'), String(images)]));
}

function pendingEntries(filter) {
  return state.queue.filter((entry) => !entry.kind && filter(entry));
}

export function renderLibrary(key) {
  const view = LIBRARY_VIEWS[key];
  const queued = pendingEntries(view.filter);
  const items = state.items.filter(view.filter).sort(newestFirst);
  const children = [];

  if (key === 'info') {
    children.push(h('div', { class: 'page-head' },
      h('p', { class: 'page-note' }, 'Gambar dan catatan yang kau perlu rujuk semula, berasingan daripada Inbox.'),
      h('div', { class: 'button-row' }, photoButtons(saveInfoPhotos))));
  }

  if (queued.length) {
    children.push(h('div', { class: 'rows' }, queued.map(queueRow)));
  }

  if (!queued.length && !items.length) {
    children.push(isConfigured() || key === 'info'
      ? emptyState(view.empty[0], view.empty[1])
      : emptyState('Sambungkan ke Google dulu', 'Masukkan URL Web App dan kunci rahsia supaya data kau boleh disimpan.',
        h('a', { class: 'button primary', href: '#settings' }, 'Buka Tetapan')));
  } else if (view.layout === 'gallery') {
    children.push(h('div', { class: 'gallery' }, items.map(galleryTile)));
  } else if (view.layout === 'notes') {
    children.push(h('div', { class: 'notes' }, items.map(noteCard)));
  } else if (view.layout === 'mixed') {
    const images = items.filter((item) => item.type === 'image');
    const others = items.filter((item) => item.type !== 'image');
    if (images.length) children.push(h('div', { class: 'gallery' }, images.map(galleryTile)));
    if (others.length) children.push(h('div', { class: 'rows' }, others.map((item) => itemRow(item))));
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
    await addItems(await Promise.all(files.map((file) => imageItem(file, { ruang: 'info', title: '' }))));
  } catch (err) {
    toast(err.message, true);
  }
}

export function openItem(id) {
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item) return;

  const titleInput = h('input', { class: 'input', type: 'text', value: item.title, placeholder: 'Tiada tajuk' });
  const textInput = h('textarea', { class: 'input', rows: 5, value: item.text, placeholder: 'Catatan' });
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
      .catch(() => { frame.textContent = 'Gambar tak dapat dimuat.'; });
    body.push(frame);
  }
  if (isWebUrl(item.url)) {
    body.push(h('a', { class: 'sheet-link', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, item.url));
  }
  const quickActions = [
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
    }, icon(isNew ? 'check' : 'undo'), isNew ? 'Tanda dah tengok' : 'Pulangkan ke Inbox')
  ];
  body.push(h('div', { class: 'sheet-actions' }, quickActions));
  body.push(field('Tajuk', titleInput), field('Catatan', textInput), field('Simpan di', place));
  if (item.type !== 'image') body.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Gambar'), attachments.element));

  dialog = openSheet({
    title: displayTitle(item),
    kicker: (TYPE_LABEL[item.type] || 'Item') + ' · ' + formatDate(item.createdAt),
    body,
    onClose: () => { if (!saved) attachments.discard(); },
    actions: [
      h('button', {
        class: 'button plain',
        type: 'button',
        onclick: async () => {
          const yes = await askConfirm({
            title: 'Padam item ini?',
            text: item.type === 'image' ? 'Gambarnya akan dialih ke tong sampah Google Drive.' : 'Item ini akan dibuang dari Sheet.',
            confirmLabel: 'Padam'
          });
          if (!yes) return;
          saved = true;
          deleteAttachments(item.gambar);
          deleteRecord('Item', item.id);
          dialog.close();
        }
      }, 'Padam'),
      h('span', { class: 'foot-spacer' }),
      h('button', {
        class: 'button primary',
        type: 'button',
        onclick: () => {
          saved = true;
          attachments.commit();
          patchItem(item.id, {
            title: titleInput.value.trim(),
            text: textInput.value,
            ruang: place.value,
            gambar: attachments.value()
          });
          dialog.close();
        }
      }, 'Simpan')
    ]
  });
}
