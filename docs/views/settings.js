// Tetapan: sambungan Google, pemasangan app dan perubahan yang gagal dihantar.
import { renderNameSettings } from './profile.js';
import { callBackend, isAllowedBackend, loadQueue, loadSettings, processQueue, refresh, render, saveSettings, state } from '../lib/data.js';
import { askConfirm, copyText, field, h, icon, toast } from '../lib/dom.js';
import { renderLockSettings } from './lock.js';
import { renderAiSettings } from './ai.js';

let installPrompt = null;
export const setInstallPrompt = (event) => { installPrompt = event; };

function checkRow(key, fallback) {
  const check = state.checks[key];
  return h('li', { class: 'check ' + (check ? check.state : '') }, check ? check.label : fallback);
}

const ENTRY_LABEL = { Tugasan: 'Tugasan', Kad: 'Kad', Lajur: 'Lajur', Kelas: 'Kelas', Tetapan: 'Tetapan', Item: 'Item' };

function failedRow(entry) {
  const label = entry.kind ? ENTRY_LABEL[entry.table] || 'Perubahan' : entry.title || entry.url || entry.text || 'Item';
  return h('article', { class: 'row' },
    h('div', { class: 'row-main' },
      h('span', { class: 'row-text' },
        h('span', { class: 'row-title' }, label),
        h('span', { class: 'row-sub row-state failed' }, entry.error))),
    h('div', { class: 'row-side' },
      h('button', {
        class: 'button plain',
        type: 'button',
        onclick: async () => {
          await SimpanStore.removeQueued(entry.id);
          await loadQueue();
          await refresh();
          render();
        }
      }, 'Buang')));
}

function shortcutStep(text) {
  return h('li', {}, text);
}

/** Panduan Apple Shortcuts, kerana iPhone tidak benarkan web app masuk senarai Share. */
function renderShortcutGuide() {
  const copyButton = (label, read, done) => h('button', {
    class: 'button',
    type: 'button',
    onclick: async () => {
      const value = await read();
      if (value) copyText(value, done);
    }
  }, icon('copy'), label);

  const readUrl = () => {
    const { url } = loadSettings();
    if (!url) toast('Isi sambungan Google dahulu', true);
    return url;
  };

  const fetchKey = async (action) => {
    try {
      const result = await callBackend({ action });
      if (result.ok) return result.key;
      toast(/Tindakan/.test(result.error) ? 'Backend Google perlu dikemas kini dahulu' : result.error, true);
    } catch {
      toast('Tidak dapat sampai ke Google', true);
    }
    return null;
  };

  return h('section', {},
    h('h2', {}, 'Share dari iPhone'),
    h('p', { class: 'field-hint section-hint' },
      'iPhone tidak benarkan web app masuk senarai Share. Bina 2 Shortcut kecil ini untuk menggantikannya. Android tidak perlukan ini. Guna kunci Shortcut, bukan kunci rahsia: ia cuma boleh menambah item, dan tidak boleh membaca data anda.'),
    h('div', { class: 'button-row shortcut-copy' },
      copyButton('Salin URL', readUrl, 'URL disalin'),
      copyButton('Salin kunci Shortcut', () => fetchKey('shortcutKey'), 'Kunci Shortcut disalin'),
      h('button', {
        class: 'button plain',
        type: 'button',
        onclick: async () => {
          const yes = await askConfirm({
            title: 'Tukar kunci Shortcut?',
            text: 'Kunci lama berhenti berfungsi serta-merta, dan kedua-dua Shortcut perlu dikemas kini dengan kunci baru.',
            confirmLabel: 'Tukar'
          });
          if (!yes) return;
          const key = await fetchKey('rotateShortcutKey');
          if (key) copyText(key, 'Kunci baru dibuat dan disalin');
        }
      }, 'Tukar kunci')),
    h('details', { class: 'shortcut-guide' },
      h('summary', {}, 'Shortcut 1: Simpan Gambar'),
      h('ol', {},
        shortcutStep('Buka app Shortcuts, tekan +, dan namakan Simpan Gambar.'),
        shortcutStep('Tekan ikon (i) atau menu tetapan, hidupkan Show in Share Sheet, dan pilih Images sahaja.'),
        shortcutStep('Tambah Repeat with Each, untuk Shortcut Input.'),
        shortcutStep('Di dalam Repeat, tambah Resize Image: Longest Edge, 2000.'),
        shortcutStep('Tambah Convert Image: JPEG, kualiti 80%.'),
        shortcutStep('Tambah Base64 Encode, dengan Line Breaks: None.'),
        shortcutStep('Tambah Get Contents of URL, dan tampal URL Web App.'),
        shortcutStep('Tekan Show More: Method POST, Request Body JSON.'),
        shortcutStep('Tambah 3 medan teks: secret (tampal kunci Shortcut), action (tulis quickSave), image (pilih Base64 Encoded).'),
        shortcutStep('Selepas End Repeat, tambah Show Notification: Disimpan.'))),
    h('details', { class: 'shortcut-guide' },
      h('summary', {}, 'Shortcut 2: Simpan Link'),
      h('ol', {},
        shortcutStep('Cipta Shortcut baru bernama Simpan Link.'),
        shortcutStep('Hidupkan Show in Share Sheet, dan pilih URLs dan Text sahaja.'),
        shortcutStep('Tambah Get Contents of URL, dan tampal URL Web App.'),
        shortcutStep('Tekan Show More: Method POST, Request Body JSON.'),
        shortcutStep('Tambah 3 medan teks: secret (tampal kunci Shortcut), action (tulis quickSave), text (pilih Shortcut Input).'),
        shortcutStep('Tambah Show Notification: Disimpan.'))),
    h('p', { class: 'field-hint' },
      'Selepas siap, Share dari Photos atau Safari dan pilih Shortcut itu. Kalau Shortcut tersebar, orang lain cuma boleh menambah item. Tekan Tukar kunci untuk menghentikannya.'));
}

export function updateSettings() {
  const checks = document.getElementById('checks');
  if (!checks) return;
  checks.replaceChildren(
    checkRow('worker', 'Menyemak service worker'),
    checkRow('installed', 'Belum dipasang sebagai app'),
    checkRow('backend', 'Belum disambung ke Google'));
  const install = document.getElementById('install');
  if (install) install.hidden = !installPrompt;

  const failed = state.queue.filter((entry) => entry.status === 'failed');
  const box = document.getElementById('failed-box');
  if (box) {
    box.hidden = !failed.length;
    box.querySelector('.rows').replaceChildren(...failed.map(failedRow));
  }
}

export function renderSettings() {
  const settings = loadSettings();
  const urlInput = h('input', {
    class: 'input', name: 'url', type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false',
    required: true, placeholder: 'https://script.google.com/macros/s/.../exec', value: settings.url || ''
  });
  const secretInput = h('input', {
    class: 'input', name: 'secret', type: 'password', autocomplete: 'off', spellcheck: 'false',
    required: true, value: settings.secret || ''
  });

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const url = urlInput.value.trim();
      const secret = secretInput.value.trim();
      if (!isAllowedBackend(url)) {
        toast('URL mesti bermula dengan https://script.google.com/', true);
        return;
      }
      saveSettings({ url, secret });
      state.checks.backend = { state: '', label: 'Sedang menguji sambungan' };
      updateSettings();
      await refresh();
      updateSettings();
      if (state.checks.backend.state === 'ok') {
        toast('Sambungan berjaya');
        processQueue();
      } else {
        toast('Tetapan disimpan, tapi sambungan gagal', true);
      }
    }
  },
  field('URL Web App', urlInput),
  field('Kunci rahsia', secretInput, 'Dari log Apps Script selepas menjalankan setup.'),
  h('button', { class: 'button primary', type: 'submit' }, 'Simpan dan uji'));

  const page = h('div', { class: 'settings' },
    renderNameSettings(),
    h('section', {}, h('h2', {}, 'Sambungan Google'), form),
    renderShortcutGuide(),
    renderAiSettings(),
    renderLockSettings(),
    h('section', { id: 'failed-box', hidden: true },
      h('h2', {}, 'Gagal dihantar'),
      h('div', { class: 'rows' }),
      h('div', { class: 'button-row' }, h('button', { class: 'button', type: 'button', onclick: processQueue }, 'Cuba lagi'))),
    h('section', {},
      h('h2', {}, 'Semakan'),
      h('ul', { class: 'checks', id: 'checks' }),
      h('button', {
        class: 'button primary',
        id: 'install',
        type: 'button',
        hidden: true,
        onclick: async () => {
          if (!installPrompt) return;
          installPrompt.prompt();
          await installPrompt.userChoice;
          installPrompt = null;
          updateSettings();
        }
      }, 'Pasang app')));
  setTimeout(updateSettings, 0);
  return page;
}
