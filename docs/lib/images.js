// Memuat gambar dan menguruskan lampiran. Gambar disimpan dalam peranti selepas dimuat,
// jadi Drive hanya dipanggil sekali untuk setiap gambar.
import { callBackend, deleteRecord, idList, imageItem, addItems } from './data.js';
import { h, icon, showDialog, showLightbox, toast } from './dom.js';

const CONCURRENCY = 3;
const urls = new Map();
const pending = new Map();
const waiting = [];
let active = 0;

function fromBase64(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function pump() {
  while (active < CONCURRENCY && waiting.length) {
    const job = waiting.shift();
    active += 1;
    job().finally(() => {
      active -= 1;
      pump();
    });
  }
}

function download(id) {
  return new Promise((resolve, reject) => {
    waiting.push(async () => {
      try {
        const result = await callBackend({ action: 'getImage', id });
        if (!result.ok) throw new Error(result.error);
        resolve(fromBase64(result.dataBase64, result.mimeType));
      } catch (err) {
        reject(err);
      }
    });
    pump();
  });
}

export function imageUrlFor(id) {
  if (urls.has(id)) return Promise.resolve(urls.get(id));
  if (pending.has(id)) return pending.get(id);
  const promise = (async () => {
    let blob = await SimpanStore.getImage(id);
    if (!blob) {
      blob = await download(id);
      await SimpanStore.putImage(id, blob);
    }
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
  })();
  pending.set(id, promise);
  promise.catch(() => {}).finally(() => pending.delete(id));
  return promise;
}

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    fill(entry.target);
  }
}, { rootMargin: '300px' });

async function fill(holder) {
  try {
    const url = await imageUrlFor(holder.dataset.imageId);
    holder.classList.add('loaded');
    holder.replaceChildren(h('img', { src: url, alt: holder.dataset.alt || '', draggable: 'false' }));
  } catch {
    // Kekalkan ikon kalau gambar gagal dimuat; rekod masih boleh dibuka.
  }
}

/** Tempat gambar yang memuat sendiri bila hampir kelihatan. */
export function imageHolder(id, className, alt) {
  const holder = h('span', { class: 'image-holder ' + (className || ''), 'data-image-id': id, 'data-alt': alt || '' }, icon('image'));
  observer.observe(holder);
  return holder;
}

export async function openImage(id, alt) {
  try {
    showLightbox(await imageUrlFor(id), alt);
  } catch {
    toast('Gambar tidak dapat dimuat', true);
  }
}

/**
 * Gambar skrin penuh yang boleh dileret ke kiri dan kanan.
 * slides: [{ id, title, when }]. onDetails(id) membuka butiran gambar yang sedang dilihat.
 */
export function openGallery(slides, start = 0, { onDetails } = {}) {
  let index = start;
  let dialog;
  const track = h('div', { class: 'viewer-track' }, slides.map((slide) => h('div', { class: 'viewer-slide' },
    imageHolder(slide.id, 'viewer-image', slide.title))));
  const title = h('p', { class: 'viewer-title' });
  const sub = h('p', { class: 'viewer-sub' });
  const go = (next) => {
    const target = Math.max(0, Math.min(slides.length - 1, next));
    track.scrollTo({ left: target * track.clientWidth, behavior: 'smooth' });
  };
  const prev = h('button', { class: 'icon-button viewer-nav viewer-prev', type: 'button', 'aria-label': 'Gambar sebelum', onclick: () => go(index - 1) }, icon('move'));
  const next = h('button', { class: 'icon-button viewer-nav viewer-next', type: 'button', 'aria-label': 'Gambar seterusnya', onclick: () => go(index + 1) }, icon('move'));

  function show() {
    const slide = slides[index];
    title.textContent = slide.title;
    sub.textContent = (index + 1) + ' / ' + slides.length + (slide.when ? ' · ' + slide.when : '');
    prev.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    // Gambar bersebelahan dimuat awal supaya leretan tidak menunggu.
    [index - 1, index + 1].forEach((near) => { if (slides[near]) imageUrlFor(slides[near].id).catch(() => {}); });
  }

  track.addEventListener('scroll', () => {
    const now = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (now !== index && slides[now]) {
      index = now;
      show();
    }
  }, { passive: true });

  dialog = showDialog('viewer', [
    track,
    h('button', { class: 'icon-button viewer-close', type: 'button', 'aria-label': 'Tutup', onclick: () => dialog.close() }, icon('close')),
    slides.length > 1 && [prev, next],
    h('div', { class: 'viewer-bar' },
      h('div', { class: 'viewer-caption' }, title, sub),
      onDetails && h('button', {
        class: 'button',
        type: 'button',
        onclick: () => {
          const { id } = slides[index];
          dialog.close();
          onDetails(id);
        }
      }, 'Butiran'))
  ]);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') go(index + 1);
    if (event.key === 'ArrowLeft') go(index - 1);
  });
  track.scrollLeft = start * track.clientWidth;
  show();
}

/** Butang kamera dan galeri yang dikongsi semua borang. */
export function photoButtons(onFiles) {
  const onChange = (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (files.length) onFiles(files);
  };
  return [
    h('label', { class: 'button' }, icon('camera'), 'Ambil gambar',
      h('input', { class: 'visually-hidden', type: 'file', accept: 'image/*', capture: 'environment', onchange: onChange })),
    h('label', { class: 'button' }, icon('image'), 'Pilih gambar',
      h('input', { class: 'visually-hidden', type: 'file', accept: 'image/*', multiple: true, onchange: onChange }))
  ];
}

/**
 * Lampiran untuk borang nota, tugasan, kad dan kelas.
 * Gambar baru terus dihantar; save() membuang yang dialih keluar, discard() membuang yang baru ditambah.
 */
export function attachmentEditor(initial) {
  const original = idList(initial);
  let ids = [...original];
  const added = new Set();
  const list = h('div', { class: 'attachments' });

  function draw() {
    list.replaceChildren(...ids.map((id) => h('div', { class: 'attachment' },
      h('button', {
        class: 'attachment-open', type: 'button', 'aria-label': 'Lihat gambar', onclick: () => openImage(id)
      }, imageHolder(id)),
      h('button', {
        class: 'attachment-remove',
        type: 'button',
        'aria-label': 'Buang gambar',
        onclick: () => {
          ids = ids.filter((other) => other !== id);
          draw();
        }
      }, icon('close')))));
    list.hidden = !ids.length;
  }
  draw();

  async function addFiles(files) {
    const items = [];
    for (const file of files) {
      try {
        items.push(await imageItem(file, { ruang: 'lampiran' }));
      } catch (err) {
        toast(err.message, true);
      }
    }
    items.forEach((item) => {
      ids.push(item.id);
      added.add(item.id);
    });
    draw();
    if (items.length) await addItems(items);
  }

  return {
    element: h('div', { class: 'attachment-field' }, list, h('div', { class: 'button-row' }, photoButtons(addFiles))),
    value: () => ids.join(','),
    commit() {
      original.filter((id) => !ids.includes(id)).forEach((id) => deleteRecord('Item', id));
      added.clear();
    },
    discard() {
      added.forEach((id) => deleteRecord('Item', id));
      added.clear();
    }
  };
}

