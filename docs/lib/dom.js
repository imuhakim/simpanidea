// Pembantu DOM. Semua teks melalui textContent supaya kandungan dikongsi tidak jadi HTML.
const PROPERTIES = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'required', 'multiple']);

export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') element.className = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (PROPERTIES.has(key)) element[key] = value;
    else if (value !== false && value != null) element.setAttribute(key, value === true ? '' : value);
  }
  element.append(...children.flat().filter((child) => child != null && child !== false));
  return element;
}

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

let toastTimer = null;
export function toast(message, isError = false) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.classList.toggle('error', isError);
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, isError ? 6000 : 3000);
}

function showDialog(className, children, labelledBy, onClose) {
  const dialog = h('dialog', { class: className, 'aria-labelledby': labelledBy }, children);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (onClose) onClose();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

let sheetCount = 0;
/** Panel sisi untuk melihat dan mengubah satu rekod. */
export function openSheet({ title, kicker, body, actions, onClose }) {
  const titleId = 'sheet-title-' + (++sheetCount);
  let dialog;
  dialog = showDialog('sheet', [
    h('header', { class: 'sheet-head' },
      h('div', { class: 'sheet-heading' },
        kicker && h('p', { class: 'sheet-kicker' }, kicker),
        h('h2', { id: titleId }, title)),
      h('button', {
        class: 'icon-button', type: 'button', 'aria-label': 'Tutup', onclick: () => dialog.close()
      }, icon('close'))),
    h('div', { class: 'sheet-body' }, body),
    actions && actions.length ? h('footer', { class: 'sheet-foot' }, actions) : null
  ], titleId, onClose);
  return dialog;
}

/** Dialog kecil di tengah skrin. */
export function openModal({ title, body, actions, onClose }) {
  const titleId = 'sheet-title-' + (++sheetCount);
  return showDialog('modal', [
    h('h2', { id: titleId }, title),
    h('div', { class: 'modal-body' }, body),
    actions && actions.length ? h('footer', { class: 'modal-foot' }, actions) : null
  ], titleId, onClose);
}

export function askConfirm({ title, text, confirmLabel, danger = true }) {
  return new Promise((resolve) => {
    let answer = false;
    let dialog;
    dialog = openModal({
      title,
      body: h('p', {}, text),
      onClose: () => resolve(answer),
      actions: [
        h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal'),
        h('button', {
          class: danger ? 'button danger' : 'button primary',
          type: 'button',
          onclick: () => { answer = true; dialog.close(); }
        }, confirmLabel)
      ]
    });
  });
}

export function askText({ title, label, value = '', confirmLabel = 'Simpan' }) {
  return new Promise((resolve) => {
    let answer = null;
    let dialog;
    const input = h('input', { class: 'input', type: 'text', value, 'aria-label': label });
    const form = h('form', {
      id: 'ask-text-form',
      onsubmit: (event) => {
        event.preventDefault();
        answer = input.value.trim();
        dialog.close();
      }
    }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input));
    dialog = openModal({
      title,
      body: form,
      onClose: () => resolve(answer),
      actions: [
        h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal'),
        h('button', { class: 'button primary', type: 'submit', form: 'ask-text-form' }, confirmLabel)
      ]
    });
    input.select();
  });
}

export function showLightbox(url, alt) {
  let dialog;
  dialog = showDialog('lightbox', [
    h('button', {
      class: 'icon-button lightbox-close', type: 'button', 'aria-label': 'Tutup', onclick: () => dialog.close()
    }, icon('close')),
    h('img', { src: url, alt: alt || '' })
  ]);
}

export function field(label, control, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint && h('span', { class: 'field-hint' }, hint));
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('h2', {}, title), h('p', {}, text), action);
}

export async function copyText(text, doneMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(doneMessage);
  } catch {
    toast('Tak dapat salin', true);
  }
}

export function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString('ms-MY', { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return time;
  if (date.toDateString() === yesterday.toDateString()) return 'Semalam';
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString('ms-MY', sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatRelative(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  const days = Math.floor((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (days <= 0) return 'hari ini';
  if (days === 1) return 'semalam';
  if (days < 30) return days + ' hari lepas';
  return formatDate(value);
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export const isWebUrl = (value) => /^https?:\/\//i.test(value || '');

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
