// Borang Tambah: tulis nota, tampal link, ambil gambar atau pilih dari galeri.
import { addItems, imageItem, itemFromText } from '../lib/data.js';
import { field, h, icon, openSheet, toast } from '../lib/dom.js';
import { photoButtons } from '../lib/images.js';

export function openComposer({ text = '', ruang = '' } = {}) {
  const files = [];
  const previewUrls = new Map();
  const previews = h('div', { class: 'compose-previews' });
  const textInput = h('textarea', { class: 'input', rows: 4, value: text, placeholder: 'Tampal link, atau tulis idea kau' });
  const titleInput = h('input', { class: 'input', type: 'text', placeholder: 'Contoh: Resit servis kereta' });
  const titleField = field('Tajuk (ini sahaja yang kelihatan di Info Penting)', titleInput);
  const place = h('select', {
    class: 'input',
    onchange: () => { titleField.hidden = place.value !== 'info'; }
  },
    h('option', { value: '', selected: ruang === '' }, 'Inbox'),
    h('option', { value: 'info', selected: ruang === 'info' }, 'Info Penting'));
  titleField.hidden = ruang !== 'info';

  function drawPreviews() {
    previews.replaceChildren(...files.map((file) => h('div', { class: 'compose-preview' },
      h('img', { src: previewUrls.get(file), alt: file.name || 'Gambar' }),
      h('button', {
        class: 'attachment-remove',
        type: 'button',
        'aria-label': 'Buang gambar',
        onclick: () => {
          URL.revokeObjectURL(previewUrls.get(file));
          files.splice(files.indexOf(file), 1);
          drawPreviews();
        }
      }, icon('close')))));
    previews.hidden = !files.length;
  }
  drawPreviews();

  function addFiles(newFiles) {
    for (const file of newFiles) {
      if (!file.type.startsWith('image/')) continue;
      previewUrls.set(file, URL.createObjectURL(file));
      files.push(file);
    }
    drawPreviews();
  }

  let dialog;
  async function save() {
    const value = textInput.value.trim();
    if (!value && !files.length) {
      toast('Tulis sesuatu atau tambah gambar dulu', true);
      return;
    }
    const chosenPlace = place.value;
    const chosenTitle = chosenPlace === 'info' ? titleInput.value.trim() : '';
    try {
      // Dengan teks, gambar menjadi lampiran nota. Tanpa teks, setiap gambar berdiri sendiri.
      const images = await Promise.all(files.map((file) => imageItem(
        file, value ? { ruang: 'lampiran', title: '' } : (chosenPlace === 'info' ? { ruang: 'info', title: chosenTitle } : { ruang: chosenPlace }))));
      const entries = [...images];
      if (value) {
        entries.push(itemFromText(value, {
          ruang: chosenPlace,
          title: chosenTitle,
          gambar: images.map((image) => image.id).join(',')
        }));
      }
      dialog.close();
      await addItems(entries);
    } catch (err) {
      toast(err.message, true);
    }
  }

  dialog = openSheet({
    title: 'Tambah',
    body: [
      field('Link atau nota', textInput),
      previews,
      h('div', { class: 'button-row field' }, photoButtons(addFiles)),
      field('Simpan ke', place),
      titleField
    ],
    actions: [
      h('span', { class: 'foot-spacer' }),
      h('button', { class: 'button plain', type: 'button', onclick: () => dialog.close() }, 'Batal'),
      h('button', { class: 'button primary', type: 'button', onclick: save }, 'Simpan')
    ],
    onClose: () => previewUrls.forEach((url) => URL.revokeObjectURL(url))
  });
  textInput.focus();
}
