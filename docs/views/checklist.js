// Penyunting nota, sama ada teks biasa atau checklist. Dikongsi oleh borang Tambah dan butiran nota.
import { checklistText, parseChecklist, rowsFromText, textFromRows } from '../lib/checklist.js';
import { h, icon } from '../lib/dom.js';

function checklistEditor(initialRows) {
  const list = h('div', { class: 'check-rows' });

  function focusEnd(input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function removeRow(row) {
    const previous = row.previousElementSibling || row.nextElementSibling;
    if (!previous) {
      row.querySelector('.check-input').value = '';
      row.querySelector('.check-box').checked = false;
      return;
    }
    row.remove();
    focusEnd(previous.querySelector('.check-input'));
  }

  function addRow({ text = '', done = false } = {}, after = null, focus = false) {
    const input = h('input', {
      class: 'input check-input',
      type: 'text',
      value: text,
      placeholder: 'Perkara',
      'aria-label': 'Perkara',
      onkeydown: (event) => {
        if (event.isComposing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          addRow({}, row, true);
        } else if (event.key === 'Backspace' && !input.value) {
          event.preventDefault();
          removeRow(row);
        }
      },
      // Senarai yang ditampal terus dipecahkan kepada satu perkara setiap baris.
      onpaste: (event) => {
        const lines = rowsFromText(event.clipboardData.getData('text'));
        if (lines.length < 2) return;
        event.preventDefault();
        input.value = (input.value + ' ' + lines[0].text).trim();
        lines.slice(1).reduce((last, line) => addRow(line, last), row);
      }
    });
    const row = h('div', { class: 'check-row' },
      h('input', { class: 'check-box', type: 'checkbox', checked: done, 'aria-label': 'Tanda siap' }),
      input,
      h('button', {
        class: 'icon-button check-remove',
        type: 'button',
        'aria-label': 'Buang perkara',
        onclick: () => removeRow(row)
      }, icon('close')));
    if (after) after.after(row);
    else list.append(row);
    if (focus) input.focus();
    return row;
  }

  (initialRows.length ? initialRows : [{}]).forEach((data) => addRow(data));

  return {
    element: h('div', {}, list,
      h('button', {
        class: 'button plain check-add',
        type: 'button',
        onclick: () => addRow({}, list.lastElementChild, true)
      }, icon('plus'), 'Tambah perkara')),
    rows: () => [...list.children].map((row) => ({
      text: row.querySelector('.check-input').value,
      done: row.querySelector('.check-box').checked
    })),
    focus: () => focusEnd(list.lastElementChild.querySelector('.check-input'))
  };
}

/**
 * Mod nota mengikut isinya, kecuali kalau diberi mode. showModes false untuk link dan screenshot,
 * yang hanya perlukan catatan biasa.
 */
export function noteEditor({ text = '', mode = '', label = 'Catatan', placeholder = 'Catatan', rows = 5, showModes = true } = {}) {
  const textarea = h('textarea', { class: 'input', rows, value: parseChecklist(text) ? textFromRows(parseChecklist(text)) : text, placeholder, 'aria-label': label });
  let current = mode || (parseChecklist(text) ? 'checklist' : 'note');
  let checklist = current === 'checklist' ? checklistEditor(rowsFromText(text)) : null;
  const body = h('div', {});
  const heading = h('span', { class: 'field-label' }, label);
  const modeButtons = {
    note: h('button', { class: 'tab-inline', type: 'button', onclick: () => switchTo('note') }, 'Nota biasa'),
    checklist: h('button', { class: 'tab-inline', type: 'button', onclick: () => switchTo('checklist') }, 'Checklist')
  };

  function draw() {
    modeButtons.note.setAttribute('aria-pressed', String(current === 'note'));
    modeButtons.checklist.setAttribute('aria-pressed', String(current === 'checklist'));
    heading.hidden = current === 'checklist';
    body.replaceChildren(current === 'checklist' ? checklist.element : textarea);
  }

  function switchTo(next) {
    if (next === current) return;
    if (next === 'checklist') checklist = checklistEditor(rowsFromText(textarea.value));
    else textarea.value = textFromRows(checklist.rows());
    current = next;
    draw();
    focus();
  }

  function focus() {
    if (current === 'checklist') checklist.focus();
    else textarea.focus();
  }

  draw();
  return {
    element: h('div', { class: 'field' },
      showModes && h('div', { class: 'tabs-inline', role: 'group', 'aria-label': 'Bentuk nota' }, modeButtons.note, modeButtons.checklist),
      heading,
      body),
    value: () => (current === 'checklist' ? checklistText(checklist.rows()) : textarea.value),
    mode: () => current,
    focus
  };
}
