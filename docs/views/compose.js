// Borang Tambah: tulis nota atau checklist, tampal link, ambil gambar atau pilih dari galeri.
import { addItems, imageItem, itemFromText, newItem } from '../lib/data.js';
import { field, h, icon, openSheet, toast } from '../lib/dom.js';
import { photoButtons } from '../lib/images.js';
import { noteEditor } from './checklist.js';

const KINDS = {
  '': { sheet: 'Tambah', label: 'Link atau nota', placeholder: 'Tampal link, atau tulis idea anda' },
  note: { sheet: 'Tambah nota', label: 'Nota', placeholder: 'Tulis idea anda' },
  link: { sheet: 'Tambah link', label: 'Link', placeholder: 'Tampal link di sini' },
  image: { sheet: 'Tambah screenshot', label: 'Catatan (pilihan)', placeholder: 'Catatan untuk screenshot ini' }
};

/** kind mengikut halaman yang sedang dibuka: note, link, image, atau kosong untuk umum. */
export function openComposer({ text = '', ruang = '', kind = '', mode = '', files: initialFiles = [] } = {}) {
  const words = KINDS[kind] || KINDS[''];
  const files = [];
  const previewUrls = new Map();
  const previews = h('div', { class: 'compose-previews' });
  const editor = noteEditor({
    text,
    mode,
    label: words.label,
    placeholder: words.placeholder,
    rows: 4,
    showModes: kind !== 'link' && kind !== 'image'
  });
  const titleInput = h('input', {
    class: 'input',
    type: 'text',
    maxlength: 200,
    placeholder: 'Contoh: Resit servis kereta',
    onkeydown: (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      if (editor.value().trim() || files.length) save(false);
      else editor.focus();
    }
  });
  const infoHint = h('span', { class: 'field-hint', hidden: ruang !== 'info' }, 'Hanya tajuk ini yang kelihatan di Info Penting.');
  const place = h('select', {
    class: 'input',
    onchange: () => { infoHint.hidden = place.value !== 'info'; }
  },
    h('option', { value: '', selected: ruang === '' }, 'Inbox'),
    h('option', { value: 'info', selected: ruang === 'info' }, 'Info Penting'));

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

  function addFiles(newFiles) {
    for (const file of newFiles) {
      if (!file.type.startsWith('image/')) continue;
      previewUrls.set(file, URL.createObjectURL(file));
      files.push(file);
    }
    drawPreviews();
  }
  addFiles(initialFiles);

  let dialog;
  let saved = false;
  let cancelled = false;
  /** quiet bermakna disimpan sendiri semasa panel ditutup, jadi borang kosong diabaikan tanpa amaran. */
  async function save(quiet) {
    if (saved || cancelled) return;
    const value = editor.value().trim();
    const title = titleInput.value.trim();
    const isChecklist = editor.mode() === 'checklist';
    const staysNote = kind === 'note' || isChecklist;
    if (isChecklist && !value && !(quiet && title)) {
      if (!quiet) toast('Tambah sekurang-kurangnya satu perkara', true);
      return;
    }
    if (!value && !files.length && (!title || kind === 'link' || kind === 'image')) {
      if (!quiet) toast('Tulis sesuatu atau tambah gambar dahulu', true);
      return;
    }
    saved = true;
    const chosenPlace = place.value;
    // Screenshot kekal berdiri sendiri. Selain itu, gambar bersama teks menjadi lampiran nota.
    const standalone = files.length > 0 && (kind === 'image' || (!value && !staysNote));
    const imageFields = standalone
      ? {
        ruang: chosenPlace,
        ...(title || chosenPlace === 'info' ? { title } : {}),
        ...(value ? { text: value } : {})
      }
      : { ruang: 'lampiran', title: '' };
    try {
      const images = await Promise.all(files.map((file) => imageItem(file, imageFields)));
      const entries = [...images];
      if (!standalone) {
        const fields = { ruang: chosenPlace, title, gambar: images.map((image) => image.id).join(',') };
        // Nota yang ditulis di halaman Nota kekal nota, walaupun ada link di dalamnya.
        entries.push(value && !staysNote ? itemFromText(value, fields) : newItem({ type: 'note', text: value, ...fields }));
      }
      dialog.close();
      await addItems(entries);
      if (quiet) toast('Disimpan secara automatik');
    } catch (err) {
      saved = false;
      toast(err.message, true);
    }
  }

  const photos = [previews, h('div', { class: 'button-row field' }, photoButtons(addFiles))];
  dialog = openSheet({
    title: words.sheet,
    body: [
      field('Tajuk (pilihan)', titleInput, infoHint),
      kind === 'image' ? [photos, editor.element] : [editor.element, photos],
      field('Simpan ke', place)
    ].flat(),
    actions: [
      h('span', { class: 'foot-spacer' }),
      h('button', {
        class: 'button plain',
        type: 'button',
        onclick: () => {
          cancelled = true;
          dialog.close();
        }
      }, 'Batal'),
      h('button', { class: 'button primary', type: 'button', onclick: () => save(false) }, 'Simpan')
    ],
    // Hanya Batal yang membuang. Menekan di luar panel atau keluar dari app tetap menyimpan.
    autosave: () => save(true),
    onClose: () => {
      // Gambar mesti dibaca dahulu sebelum pautan pratonton dilepaskan.
      setTimeout(() => previewUrls.forEach((url) => URL.revokeObjectURL(url)), 0);
    }
  });
  // Kalau isi sudah ada, yang tinggal cuma tajuk. Di halaman Screenshot, papan kekunci jangan menutup butang gambar.
  if (text || files.length) titleInput.focus();
  else if (kind !== 'image') editor.focus();
}
