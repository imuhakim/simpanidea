// Tetapan: sambungan Google, pemasangan app dan perubahan yang gagal dihantar.
import { isAllowedBackend, loadQueue, loadSettings, processQueue, refresh, render, saveSettings, state } from '../lib/data.js';
import { copyText, field, h, icon, toast } from '../lib/dom.js';
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

/** Panduan Apple Shortcuts, kerana iPhone tak benarkan web app masuk senarai Share. */
function renderShortcutGuide() {
  const copyButton = (label, read, done) => h('button', {
    class: 'button',
    type: 'button',
    onclick: () => {
      const value = read();
      if (value) copyText(value, done);
      else toast('Isi sambungan Google dulu', true);
    }
  }, icon('copy'), label);

  return h('section', {},
    h('h2', {}, 'Share dari iPhone'),
    h('p', { class: 'field-hint section-hint' },
      'iPhone tak benarkan web app masuk senarai Share. Bina 2 Shortcut kecil ni untuk menggantikannya. Android tak perlukan ini.'),
    h('div', { class: 'button-row shortcut-copy' },
      copyButton('Salin URL', () => loadSettings().url, 'URL disalin'),
      copyButton('Salin kunci', () => loadSettings().secret, 'Kunci rahsia disalin')),
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
        shortcutStep('Tambah 3 medan teks: secret (tampal kunci rahsia), action (tulis quickSave), image (pilih Base64 Encoded).'),
        shortcutStep('Selepas End Repeat, tambah Show Notification: Disimpan.'))),
    h('details', { class: 'shortcut-guide' },
      h('summary', {}, 'Shortcut 2: Simpan Link'),
      h('ol', {},
        shortcutStep('Cipta Shortcut baru bernama Simpan Link.'),
        shortcutStep('Hidupkan Show in Share Sheet, dan pilih URLs dan Text sahaja.'),
        shortcutStep('Tambah Get Contents of URL, dan tampal URL Web App.'),
        shortcutStep('Tekan Show More: Method POST, Request Body JSON.'),
        shortcutStep('Tambah 3 medan teks: secret (tampal kunci rahsia), action (tulis quickSave), text (pilih Shortcut Input).'),
        shortcutStep('Tambah Show Notification: Disimpan.'))),
    h('p', { class: 'field-hint' },
      'Selepas siap, Share dari Photos atau Safari dan pilih Shortcut tu. Jangan kongsi Shortcut ni dengan sesiapa, sebab kunci rahsia ada di dalamnya.'));
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
