// Memuat gambar dan menguruskan lampiran. Gambar disimpan dalam peranti selepas dimuat,
// jadi Drive hanya dipanggil sekali untuk setiap gambar.
import { callBackend, deleteRecord, idList, imageItem, addItems } from './data.js';
import { h, icon, showLightbox, toast } from './dom.js';

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
    toast('Gambar tak dapat dimuat', true);
  }
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

