// Tetapan: sambungan Google, pemasangan app dan perubahan yang gagal dihantar.
import { isAllowedBackend, loadQueue, loadSettings, processQueue, refresh, render, saveSettings, state } from '../lib/data.js';
import { field, h, toast } from '../lib/dom.js';
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
