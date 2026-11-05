// Kelas online: link, akaun, password disulitkan, dan rekod sama ada sudah dibuka atau belum.
import { findRecord, idList, newId, state, writeRecord } from '../lib/data.js';
import { copyText, domainOf, emptyState, field, formatDate, formatRelative, h, icon, isWebUrl, openModal, openSheet, toast } from '../lib/dom.js';
import { attachmentEditor } from '../lib/images.js';
import { manageButtons } from './manage.js';
import { askAiButton } from './ai.js';
import { createVault, decrypt, encrypt, unlockVault } from '../lib/vault.js';

const STATUS_LABEL = { belum: 'Belum buka', tengah: 'Sedang belajar', siap: 'Sudah siap' };
const VAULT_ID = 'peti-password';
const AUTO_LOCK_MS = 15 * 60 * 1000;
const MIN_PASSPHRASE = 8;

let filter = 'semua';
let vaultKey = null;
let lockTimer = null;

function touchVault() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lockVault, AUTO_LOCK_MS);
}

export function lockVault() {
  vaultKey = null;
  clearTimeout(lockTimer);
}

function vaultRecord() {
  const row = state.tables.Tetapan.find((candidate) => candidate.id === VAULT_ID);
  if (!row) return null;
  try {
    return JSON.parse(row.nilai);
  } catch {
    return null;
  }
}

function askPassphrase({ title, intro, confirm, submitLabel, verify }) {
  return new Promise((resolve) => {
    let result = null;
    let dialog;
    const first = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const second = confirm ? h('input', { class: 'input', type: 'password', autocomplete: 'new-password' }) : null;
    const error = h('p', { class: 'form-error', hidden: true });
    const submit = h('button', { class: 'button primary', type: 'submit', form: 'vault-form' }, submitLabel);

    const showError = (message) => {
      error.textContent = message;
      error.hidden = false;
    };

    dialog = openModal({
      title,
      onClose: () => resolve(result),
      body: h('form', {
        id: 'vault-form',
        onsubmit: async (event) => {
          event.preventDefault();
          if (confirm && first.value.length < MIN_PASSPHRASE) {
            showError('Guna sekurang-kurangnya ' + MIN_PASSPHRASE + ' aksara.');
            return;
          }
          if (confirm && first.value !== second.value) {
            showError('Kedua-dua kata laluan tidak sama.');
            return;
          }
          submit.disabled = true;
          submit.textContent = 'Sedang memproses';
          error.hidden = true;
          const key = await verify(first.value);
          if (key) {
            result = key;
            dialog.close();
          } else {
            submit.disabled = false;
            submit.textContent = submitLabel;
            showError('Kata laluan induk salah.');
            first.select();
          }
        }
      },
      intro && h('p', { class: 'form-note' }, intro),
      field('Kata laluan induk', first),
      second && field('Ulang kata laluan induk', second),
      error),
      actions: [
        h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal'),
        submit
      ]
    });
    first.focus();
  });
}

/** Pulangkan kunci peti, dengan meminta kata laluan induk kalau perlu. */
async function ensureVault() {
  if (vaultKey) {
    touchVault();
    return vaultKey;
  }
  const record = vaultRecord();
  if (record) {
    vaultKey = await askPassphrase({
      title: 'Buka kunci password',
      submitLabel: 'Buka',
      verify: (passphrase) => unlockVault(passphrase, record)
    });
  } else {
    // Peti mungkin sudah wujud di Google tapi belum dimuat; mencipta yang baru akan menggantinya.
    if (!state.lastSync) {
      toast('Tunggu data dari Google dimuat dahulu', true);
      return null;
    }
    vaultKey = await askPassphrase({
      title: 'Cipta kata laluan induk',
      intro: 'Password kelas akan disulitkan dengan kata laluan ini sebelum disimpan. Kalau anda lupa, password yang tersimpan tidak boleh dipulihkan. Jangan guna kata laluan Google atau bank.',
      confirm: true,
      submitLabel: 'Cipta',
      verify: async (passphrase) => {
        const { key, record: created } = await createVault(passphrase);
        await writeRecord('Tetapan', { id: VAULT_ID, nilai: JSON.stringify(created) });
        return key;
      }
    });
  }
  if (vaultKey) touchVault();
  return vaultKey;
}

function statusLabel(kelas) {
  const status = STATUS_LABEL[kelas.status] ? kelas.status : 'belum';
  return h('span', { class: 'status ' + status }, STATUS_LABEL[status]);
}

function launch(kelas) {
  if (!isWebUrl(kelas.url)) {
    toast('Kelas ini belum ada link', true);
    return;
  }
  window.open(kelas.url, '_blank', 'noopener,noreferrer');
  const record = { id: kelas.id, terakhir_dibuka: new Date().toISOString() };
  if (kelas.status !== 'siap' && kelas.status !== 'tengah') record.status = 'tengah';
  writeRecord('Kelas', record);
}

function classRow(kelas) {
  const opened = kelas.terakhir_dibuka
    ? 'Dibuka ' + formatRelative(kelas.terakhir_dibuka)
    : 'Belum pernah dibuka';
  return h('article', { class: 'row class-row' },
    h('button', { class: 'row-main', type: 'button', onclick: () => openClass(kelas.id) },
      h('span', { class: 'row-text' },
        h('span', { class: 'row-title' }, kelas.nama),
        h('span', { class: 'row-sub' }, kelas.berhenti_di ? 'Berhenti di ' + kelas.berhenti_di : opened),
        h('span', { class: 'row-when' }, 'Ditambah ' + formatDate(kelas.dicipta))),
      statusLabel(kelas)),
    h('button', {
      class: 'button',
      type: 'button',
      'aria-label': 'Buka kelas ' + kelas.nama,
      onclick: () => launch(kelas)
    }, 'Buka'));
}

export function renderClasses() {
  const classes = [...state.tables.Kelas].sort((a, b) =>
    String(b.terakhir_dibuka || b.dicipta).localeCompare(String(a.terakhir_dibuka || a.dicipta)));
  const count = (status) => classes.filter((kelas) => (kelas.status || 'belum') === status).length;
  const tabs = [
    ['semua', 'Semua', classes.length],
    ['belum', 'Belum buka', count('belum')],
    ['tengah', 'Sedang belajar', count('tengah')],
    ['siap', 'Sudah siap', count('siap')]
  ];
  const shown = filter === 'semua' ? classes : classes.filter((kelas) => (kelas.status || 'belum') === filter);

  const page = h('div', { class: 'page' });
  const redraw = () => page.replaceWith(renderClasses());
  page.append(
    h('div', { class: 'page-head' },
      h('p', { class: 'page-note' }, 'Tekan Buka, dan tarikh serta status direkod sendiri.'),
      vaultKey && h('button', {
        class: 'button plain',
        type: 'button',
        onclick: () => {
          lockVault();
          redraw();
          toast('Password dikunci');
        }
      }, icon('lock'), 'Kunci password'),
      h('button', { class: 'button primary', type: 'button', onclick: () => openClass(null) }, icon('plus'), 'Kelas baru')),
    classes.length > 0 && h('div', { class: 'tabs-inline' }, tabs.map(([key, label, total]) => h('button', {
      class: 'tab-inline',
      type: 'button',
      'aria-pressed': String(filter === key),
      onclick: () => {
        filter = key;
        redraw();
      }
    }, label, h('span', { class: 'count' }, String(total))))),
    classes.length === 0
      ? emptyState('Belum ada kelas', 'Simpan link, akaun dan password kelas online anda di sini.')
      : shown.length === 0
        ? emptyState('Tiada kelas', 'Tiada kelas dalam kategori ini.')
        : h('div', { class: 'rows' }, shown.map(classRow)));
  return page;
}

function passwordField(kelas) {
  const input = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', spellcheck: 'false', placeholder: 'Password kelas' });
  const sealed = kelas ? kelas.password_sulit : '';
  let original = '';
  let unlocked = !sealed;

  const box = h('div', { class: 'secret-box' });

  function drawLocked() {
    box.replaceChildren(
      h('span', { class: 'input', 'aria-label': 'Password tersimpan' }, '••••••••'),
      h('button', { class: 'button', type: 'button', onclick: unlock }, icon('lock'), 'Buka kunci'));
  }

  function drawOpen() {
    const reveal = h('button', {
      class: 'icon-button',
      type: 'button',
      'aria-label': 'Tunjuk password',
      onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; }
    }, icon('eye'));
    const copy = h('button', {
      class: 'icon-button',
      type: 'button',
      'aria-label': 'Salin password',
      onclick: () => {
        if (input.value) copyText(input.value, 'Password disalin');
      }
    }, icon('copy'));
    box.replaceChildren(input, reveal, copy);
  }

  async function unlock() {
    const key = await ensureVault();
    if (!key) return;
    try {
      original = await decrypt(key, sealed);
      input.value = original;
      unlocked = true;
      drawOpen();
    } catch {
      toast('Password ini tidak dapat dibuka', true);
    }
  }

  if (sealed && vaultKey) unlock();
  else if (sealed) drawLocked();
  else drawOpen();

  return {
    element: box,
    /** Pulangkan nilai untuk disimpan, undefined kalau tiada perubahan, atau null kalau dibatalkan. */
    async sealedValue() {
      if (!unlocked || input.value === original) return undefined;
      if (!input.value) return '';
      const key = await ensureVault();
      if (!key) return null;
      return encrypt(key, input.value);
    }
  };
}

export function openClass(id) {
  const kelas = id ? findRecord('Kelas', id) : null;
  if (id && !kelas) return;

  const nameInput = h('input', { class: 'input', type: 'text', value: kelas ? kelas.nama : '', placeholder: 'Contoh: Kelas Canva' });
  const urlInput = h('input', { class: 'input', type: 'url', inputmode: 'url', value: kelas ? kelas.url : '', placeholder: 'https://' });
  const userInput = h('input', { class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', value: kelas ? kelas.username : '', placeholder: 'Email atau username' });
  const status = h('select', { class: 'input' }, Object.entries(STATUS_LABEL).map(([value, label]) =>
    h('option', { value, selected: (kelas ? kelas.status || 'belum' : 'belum') === value }, label)));
  const stopInput = h('input', { class: 'input', type: 'text', value: kelas ? kelas.berhenti_di : '', placeholder: 'Contoh: Modul 3, video 2' });
  const noteInput = h('textarea', { class: 'input', rows: 4, value: kelas ? kelas.nota : '', placeholder: 'Catatan kelas' });
  const password = passwordField(kelas);
  const attachments = attachmentEditor(kelas ? kelas.gambar : '');
  let saved = false;
  let dialog;

  const body = [];
  if (kelas) {
    body.push(h('div', { class: 'sheet-actions' },
      h('button', { class: 'button primary', type: 'button', onclick: () => launch(kelas) }, icon('open'), 'Buka kelas'),
      // Password dan username sengaja tidak dihantar kepada AI.
      askAiButton(() => ({
        label: nameInput.value,
        text: 'Kelas: ' + nameInput.value + '\nStatus: ' + STATUS_LABEL[status.value] + '\nBerhenti di: ' + stopInput.value + '\nCatatan: ' + noteInput.value,
        imageIds: idList(attachments.value())
      })),
      kelas.username && h('button', {
        class: 'button', type: 'button', onclick: () => copyText(kelas.username, 'Username disalin')
      }, icon('copy'), 'Salin username')));
    if (kelas.terakhir_dibuka) {
      body.push(h('p', { class: 'form-note' }, 'Terakhir dibuka ' + formatRelative(kelas.terakhir_dibuka)
        + (domainOf(kelas.url) ? ' di ' + domainOf(kelas.url) : '') + '.'));
    }
  }
  body.push(
    field('Nama kelas', nameInput),
    field('Link kelas', urlInput),
    field('Username', userInput),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Password'), password.element,
      h('span', { class: 'field-hint' }, 'Disulitkan dalam peranti ini sebelum disimpan.')),
    field('Status', status),
    field('Berhenti di', stopInput),
    field('Catatan', noteInput),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Gambar'), attachments.element));

  async function save() {
    const nama = nameInput.value.trim();
    const url = urlInput.value.trim();
    if (!nama) {
      toast('Kelas perlukan nama', true);
      return;
    }
    if (url && !isWebUrl(url)) {
      toast('Link mesti bermula dengan https://', true);
      return;
    }
    const sealedPassword = await password.sealedValue();
    if (sealedPassword === null) return;
    const record = {
      id: kelas ? kelas.id : newId(),
      nama,
      url,
      username: userInput.value.trim(),
      status: status.value,
      berhenti_di: stopInput.value.trim(),
      nota: noteInput.value,
      gambar: attachments.value()
    };
    if (sealedPassword !== undefined) record.password_sulit = sealedPassword;
    saved = true;
    attachments.commit();
    writeRecord('Kelas', record);
    dialog.close();
  }

  dialog = openSheet({
    title: kelas ? kelas.nama : 'Kelas baru',
    kicker: kelas ? 'Ditambah ' + formatDate(kelas.dicipta) : 'Kelas',
    body,
    onClose: () => { if (!saved) attachments.discard(); },
    actions: [
      ...(kelas ? manageButtons({
        table: 'Kelas',
        id: kelas.id,
        done: () => {
          saved = true;
          attachments.commit();
          dialog.close();
        }
      }) : []),
      h('span', { class: 'foot-spacer' }),
      h('button', { class: 'button primary', type: 'button', onclick: save }, 'Simpan')
    ]
  });
  if (!kelas) nameInput.focus();
}
