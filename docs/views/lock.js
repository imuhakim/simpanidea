// Kunci PIN untuk peranti ini. Ia menghalang orang yang memegang peranti daripada membuka app,
// tapi bukan penyulitan: data dalam peranti masih bergantung pada kunci skrin phone.
import { askConfirm, field, h, icon, openModal, parkToast, toast } from '../lib/dom.js';
import { createPinRecord, isWeakPin, lockoutSeconds, PIN_LENGTH, verifyPin } from '../lib/pin.js';

const PIN_KEY = 'simpanidea.pin';
const TIMEOUT_KEY = 'simpanidea.lock-minutes';
const DEFAULT_MINUTES = 5;
const TIMEOUT_CHOICES = [1, 5, 15, 30];
const IDLE_CHECK_MS = 15000;

let locked = false;
let lockDialog = null;
let onLock = () => {};
let onChange = () => {};
let lastActive = Date.now();
let hiddenAt = null;

export const setLockHandlers = (handlers) => {
  onLock = handlers.onLock || onLock;
  onChange = handlers.onChange || onChange;
};

function loadRecord() {
  try {
    return JSON.parse(localStorage.getItem(PIN_KEY));
  } catch {
    return null;
  }
}

const saveRecord = (record) => localStorage.setItem(PIN_KEY, JSON.stringify(record));
export const isPinEnabled = () => Boolean(loadRecord());
export const isLocked = () => locked;

function lockMinutes() {
  const value = Number(localStorage.getItem(TIMEOUT_KEY));
  return TIMEOUT_CHOICES.includes(value) ? value : DEFAULT_MINUTES;
}

/* Pad nombor */
function pinPad({ onComplete }) {
  let digits = '';
  let disabled = false;
  const dots = h('div', { class: 'pin-dots', role: 'img', 'aria-label': 'Tiada digit dimasukkan' });
  const message = h('p', { class: 'pin-message', role: 'status' });

  function drawDots() {
    dots.replaceChildren(...Array.from({ length: PIN_LENGTH }, (_, index) =>
      h('span', { class: 'pin-dot' + (index < digits.length ? ' filled' : '') })));
    dots.setAttribute('aria-label', digits.length + ' daripada ' + PIN_LENGTH + ' digit dimasukkan');
  }

  function press(digit) {
    if (disabled || digits.length >= PIN_LENGTH) return;
    digits += digit;
    drawDots();
    if (digits.length === PIN_LENGTH) {
      const entered = digits;
      // Beri masa titik terakhir kelihatan sebelum disemak.
      setTimeout(() => onComplete(entered), 90);
    }
  }

  function erase() {
    if (disabled || !digits) return;
    digits = digits.slice(0, -1);
    drawDots();
  }

  const key = (label, action, ariaLabel) => h('button', {
    class: 'pin-key', type: 'button', 'aria-label': ariaLabel || label, onclick: action
  }, label);
  const keys = h('div', { class: 'pin-keys' },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => key(digit, () => press(digit))),
    h('span'),
    key('0', () => press('0')),
    h('button', { class: 'pin-key plain', type: 'button', 'aria-label': 'Padam digit', onclick: erase }, icon('backspace')));

  drawDots();
  return {
    element: h('div', { class: 'pin-pad' }, dots, message, keys),
    onKeydown(event) {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        erase();
      }
    },
    clear() {
      digits = '';
      drawDots();
    },
    shake() {
      dots.classList.remove('shake');
      void dots.offsetWidth;
      dots.classList.add('shake');
    },
    setMessage(text, isError = true) {
      message.textContent = text;
      message.classList.toggle('error', isError);
    },
    setDisabled(value) {
      disabled = value;
      keys.querySelectorAll('button').forEach((button) => { button.disabled = value; });
    }
  };
}

/** Semak PIN dan kira cubaan salah. Masa menunggu dibaca dengan secondsLeft(). */
async function attemptPin(pin) {
  const record = loadRecord();
  if (!record) return true;
  if (Date.now() < (record.until || 0)) return false;
  if (await verifyPin(pin, record)) {
    saveRecord({ ...record, fails: 0, until: 0 });
    return true;
  }
  const fails = (record.fails || 0) + 1;
  const wait = lockoutSeconds(fails);
  saveRecord({ ...record, fails, until: wait ? Date.now() + wait * 1000 : 0 });
  return false;
}

function secondsLeft() {
  const record = loadRecord();
  return record ? Math.ceil(((record.until || 0) - Date.now()) / 1000) : 0;
}

function startCountdown(pad, onDone) {
  pad.setDisabled(true);
  const tick = () => {
    const left = secondsLeft();
    if (left <= 0) {
      clearInterval(timer);
      pad.setDisabled(false);
      pad.setMessage('');
      onDone();
      return;
    }
    pad.setMessage('Terlalu banyak cubaan. Cuba lagi dalam ' + left + ' saat.');
  };
  const timer = setInterval(tick, 1000);
  tick();
}

/* Skrin kunci */
function showLockScreen() {
  const pad = pinPad({
    onComplete: async (pin) => {
      const ok = await attemptPin(pin);
      if (ok) {
        unlock();
        return;
      }
      pad.clear();
      pad.shake();
      if (secondsLeft() > 0) {
        startCountdown(pad, () => {});
      } else {
        pad.setMessage('PIN salah');
      }
    }
  });

  lockDialog = h('dialog', { class: 'lock', 'aria-label': 'App dikunci' },
    h('div', { class: 'lock-inner' },
      h('p', { class: 'lock-brand' }, 'Simpan', h('span', {}, 'Idea')),
      h('h2', {}, 'Masukkan PIN'),
      pad.element,
      h('button', { class: 'button plain', type: 'button', onclick: forgotPin }, 'Lupa PIN?')));
  lockDialog.addEventListener('keydown', (event) => pad.onKeydown(event));
  // Skrin kunci tidak boleh ditutup kecuali dengan PIN yang betul.
  lockDialog.addEventListener('cancel', (event) => event.preventDefault());
  lockDialog.addEventListener('close', () => {
    if (locked && lockDialog) lockDialog.showModal();
  });
  document.body.append(lockDialog);
  lockDialog.showModal();
  if (secondsLeft() > 0) startCountdown(pad, () => {});
}

export function lockNow() {
  if (locked || !isPinEnabled()) return;
  locked = true;
  onLock();
  showLockScreen();
}

function unlock() {
  locked = false;
  lastActive = Date.now();
  parkToast();
  const dialog = lockDialog;
  lockDialog = null;
  dialog.close();
  dialog.remove();
  onChange();
}

async function forgotPin() {
  const queued = (await SimpanStore.listQueued()).length;
  const yes = await askConfirm({
    title: 'Buang PIN dan set semula peranti ini?',
    text: 'Data di Google Drive dan Sheets kekal selamat. Peranti ini akan dikosongkan, dan anda perlu masukkan URL Web App dan kunci rahsia sekali lagi.' +
      (queued ? ' ' + queued + ' perubahan yang belum dihantar akan hilang.' : ''),
    confirmLabel: 'Set semula'
  });
  if (!yes) return;
  await SimpanStore.clearAll();
  // Tetapan sambungan mesti dibuang sekali, jika tidak PIN boleh dipintas dengan butang ini.
  localStorage.clear();
  location.hash = 'settings';
  location.reload();
}

/* Auto kunci */
export function setupAutoLock() {
  const markActive = () => { lastActive = Date.now(); };
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, markActive, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (hiddenAt !== null) {
      if (Date.now() - hiddenAt >= lockMinutes() * 60000) lockNow();
      hiddenAt = null;
      lastActive = Date.now();
    }
  });

  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    // Menonton video tidak melibatkan sentuhan, jadi jangan kunci di tengah tontonan.
    if (document.querySelector('.stage iframe')) return;
    if (Date.now() - lastActive >= lockMinutes() * 60000) lockNow();
  }, IDLE_CHECK_MS);
}

/* Tetapan */
function askPin(title, note) {
  return new Promise((resolve) => {
    let result = null;
    let dialog;
    const pad = pinPad({
      onComplete: (pin) => {
        result = pin;
        dialog.close();
      }
    });
    dialog = openModal({
      title,
      body: [note && h('p', { class: 'form-note' }, note), pad.element],
      onClose: () => resolve(result),
      actions: [h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal')]
    });
    dialog.classList.add('pin-modal');
    dialog.addEventListener('keydown', (event) => pad.onKeydown(event));
  });
}

async function chooseNewPin() {
  const first = await askPin('Cipta PIN ' + PIN_LENGTH + ' digit',
    'PIN ini untuk peranti ini sahaja, dan tidak perlu sama dengan kata laluan induk kelas.');
  if (!first) return null;
  if (isWeakPin(first)) {
    toast('PIN ini senang diteka. Pilih nombor lain.', true);
    return null;
  }
  const second = await askPin('Ulang PIN');
  if (!second) return null;
  if (first !== second) {
    toast('Kedua-dua PIN tidak sama', true);
    return null;
  }
  return first;
}

async function confirmCurrentPin(title) {
  const wait = secondsLeft();
  if (wait > 0) {
    toast('Terlalu banyak cubaan. Cuba lagi dalam ' + wait + ' saat.', true);
    return false;
  }
  const pin = await askPin(title);
  if (!pin) return false;
  if (await attemptPin(pin)) return true;
  toast('PIN salah', true);
  return false;
}

export function renderLockSettings() {
  const section = h('section', { id: 'lock-section' });

  function draw() {
    const enabled = isPinEnabled();
    const timeout = h('select', {
      class: 'input',
      onchange: (event) => localStorage.setItem(TIMEOUT_KEY, event.target.value)
    }, TIMEOUT_CHOICES.map((minutes) => h('option', {
      value: String(minutes), selected: minutes === lockMinutes()
    }, 'Selepas ' + minutes + ' minit')));

    section.replaceChildren(
      h('h2', {}, 'Kunci app'),
      h('p', { class: 'field-hint section-hint' }, enabled
        ? 'App dikunci setiap kali dibuka, dan selepas tidak digunakan.'
        : 'Minta PIN setiap kali app dibuka di peranti ini.'),
      enabled && field('Kunci sendiri', timeout),
      h('div', { class: 'button-row' }, enabled
        ? [
          h('button', { class: 'button', type: 'button', onclick: lockNow }, icon('lock'), 'Kunci sekarang'),
          h('button', {
            class: 'button',
            type: 'button',
            onclick: async () => {
              if (!await confirmCurrentPin('Masukkan PIN semasa')) return;
              const pin = await chooseNewPin();
              if (!pin) return;
              saveRecord(await createPinRecord(pin));
              toast('PIN ditukar');
            }
          }, 'Tukar PIN'),
          h('button', {
            class: 'button plain',
            type: 'button',
            onclick: async () => {
              if (!await confirmCurrentPin('Masukkan PIN untuk matikan')) return;
              localStorage.removeItem(PIN_KEY);
              draw();
              onChange();
              toast('PIN dimatikan');
            }
          }, 'Matikan PIN')
        ]
        : h('button', {
          class: 'button primary',
          type: 'button',
          onclick: async () => {
            const pin = await chooseNewPin();
            if (!pin) return;
            saveRecord(await createPinRecord(pin));
            draw();
            onChange();
            toast('PIN dihidupkan');
          }
        }, icon('lock'), 'Hidupkan PIN')));
  }
  draw();
  return section;
}
