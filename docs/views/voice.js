// Perbelanjaan melalui suara: ucapan jadi teks, dan AI mengisi kategori serta jumlah.
import { callBackend, isConfigured, newId, writeRecord } from '../lib/data.js';
import { h, icon, openModal, toast } from '../lib/dom.js';
import { currentModel } from './ai.js';
import { restoreRecord, trashRecord } from './manage.js';
import { applyAutoMatch } from './payments.js';

const SPEECH_LANGUAGE = 'ms-MY';
const SPEECH_ERRORS = {
  'not-allowed': 'Kebenaran mikrofon ditolak. Benarkan dalam tetapan browser, atau taip sahaja.',
  'service-not-allowed': 'Pengecaman suara tidak dibenarkan di sini. Taip sahaja.',
  'no-speech': 'Tiada suara didengar. Tekan mikrofon dan cuba lagi.',
  'audio-capture': 'Mikrofon tidak dijumpai. Taip sahaja.',
  network: 'Pengecaman suara perlukan internet. Taip, atau cuba lagi.'
};

const localDate = (now) => new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const money = (amount, currency) => (amount === '' || amount == null ? '' : (currency || 'RM') + ' ' + Number(amount).toFixed(2));

async function saveExpenses(text) {
  const result = await callBackend({ action: 'parseExpense', text, today: localDate(new Date()), model: currentModel() });
  if (!result.ok) {
    if (result.code === 'no_key') throw new Error('Masukkan kunci API di Tetapan untuk menyimpan melalui suara.');
    throw new Error(/Tindakan/.test(result.error) ? 'Backend Google perlu dikemas kini dahulu.' : result.error);
  }
  const expenses = result.data.perbelanjaan;
  if (!expenses.length) throw new Error('Tiada perbelanjaan dikesan. Sebut barang dan jumlahnya.');
  const ids = [];
  for (const expense of expenses) {
    const id = newId();
    ids.push(id);
    await writeRecord('Resit', {
      id,
      gambar: '',
      peniaga: expense.peniaga,
      tarikh: expense.tarikh,
      masa: expense.masa,
      jumlah: expense.jumlah,
      mata_wang: expense.mata_wang,
      cukai: '',
      kategori: expense.kategori,
      no_resit: '',
      barangan: JSON.stringify(expense.barangan),
      nota: text,
      status_imbas: 'siap'
    });
  }
  await applyAutoMatch();
  const first = expenses[0];
  const summary = expenses.length === 1
    ? [first.peniaga, first.kategori, money(first.jumlah, first.mata_wang)].filter(Boolean).join(' · ')
    : expenses.length + ' perbelanjaan disimpan';
  toast(summary, false, {
    label: 'Batal',
    onClick: () => {
      ids.forEach((id) => trashRecord('Resit', id));
      toast('Dialih ke Sampah', false, { label: 'Pulihkan', onClick: () => ids.forEach((id) => restoreRecord('Resit', id)) });
    }
  });
}

export function openVoiceExpense() {
  if (!isConfigured()) {
    toast('Sambungkan ke Google dahulu di Tetapan', true);
    return;
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let spokenBase = '';
  let dialog;

  const status = h('p', { class: 'field-hint', role: 'status' });
  const textInput = h('textarea', {
    class: 'input',
    rows: 4,
    'aria-label': 'Perbelanjaan',
    placeholder: 'Contoh: makan tengah hari di Restoran Selera dua belas ringgit'
  });
  const micLabel = h('span', {}, 'Tekan dan bercakap');
  const mic = h('button', {
    class: 'button voice-mic',
    type: 'button',
    onclick: () => (listening ? recognition.stop() : startListening())
  }, icon('mic'), micLabel);

  const setListening = (value) => {
    listening = value;
    mic.classList.toggle('listening', value);
    micLabel.textContent = value ? 'Sedang mendengar. Tekan untuk berhenti' : 'Tekan dan bercakap';
  };

  function startListening() {
    spokenBase = textInput.value.trim();
    status.textContent = '';
    recognition = new Recognition();
    recognition.lang = SPEECH_LANGUAGE;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const spoken = [...event.results].map((result) => result[0].transcript).join(' ').trim();
      textInput.value = [spokenBase, spoken].filter(Boolean).join(' ');
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') status.textContent = SPEECH_ERRORS[event.error] || 'Suara tidak dapat dibaca. Cuba lagi, atau taip sahaja.';
    };
    recognition.onend = () => setListening(false);
    try {
      recognition.start();
      setListening(true);
    } catch {
      status.textContent = 'Mikrofon tidak dapat dimulakan. Taip sahaja.';
    }
  }

  const save = h('button', {
    class: 'button primary',
    type: 'button',
    onclick: async () => {
      const text = textInput.value.trim();
      if (!text) {
        status.textContent = 'Sebut atau taip perbelanjaan dahulu.';
        return;
      }
      if (listening) recognition.stop();
      save.disabled = true;
      status.textContent = 'AI sedang mengisi kategori dan jumlah.';
      try {
        await saveExpenses(text);
        dialog.close();
      } catch (err) {
        save.disabled = false;
        status.textContent = err instanceof TypeError ? 'Tidak dapat sampai ke Google. Semak internet dan cuba lagi.' : err.message;
      }
    }
  }, 'Simpan');

  dialog = openModal({
    title: 'Catat perbelanjaan',
    body: [
      h('p', { class: 'form-note' }, 'Sebut apa yang dibeli, di mana dan berapa. Anda boleh sebut beberapa perbelanjaan sekali gus.'),
      Recognition
        ? mic
        : h('p', { class: 'field-hint' }, 'Browser ini tiada pengecaman suara. Taip di bawah, atau gunakan butang mikrofon pada papan kekunci phone.'),
      textInput,
      status
    ],
    onClose: () => {
      if (recognition) recognition.abort();
    },
    actions: [h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal'), save]
  });
  dialog.classList.add('voice-modal');
  if (Recognition) startListening();
}

export const voiceButton = () =>
  h('button', { class: 'button', type: 'button', onclick: openVoiceExpense }, icon('mic'), 'Cakap');
