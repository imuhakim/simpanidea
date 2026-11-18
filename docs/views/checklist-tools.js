// Gabung beberapa checklist menjadi satu (boleh disusun oleh AI), atau pindahkan perkaranya ke papan Kanban.
import { callBackend, findItem, newId, patchItem, state, writeRecord } from '../lib/data.js';
import { checklistSummary, checklistText, mergeRows, parseChecklist, rowsFromAiText } from '../lib/checklist.js';
import { field, h, openModal, toast } from '../lib/dom.js';
import { currentModel } from './ai.js';
import { lastPosition, positionBetween, sortedColumns } from './board.js';
import { restoreRecord } from './manage.js';

// Sama dengan had nota dan tajuk di backend.
const MAX_TEXT_LENGTH = 5000;
const MAX_TITLE_LENGTH = 500;

const AI_PROMPT = 'Susun checklist di bawah menjadi satu checklist yang kemas.\n' +
  '- Satukan perkara yang sama maksud walaupun ditulis berbeza.\n' +
  '- Letakkan perkara yang berkaitan bersebelahan.\n' +
  '- Kekalkan bahasa dan perkataan asal setiap perkara sebanyak mungkin.\n' +
  '- Jangan tambah perkara baru, dan jangan buang perkara yang berbeza.\n' +
  '- Kekalkan [x] bagi perkara yang sudah siap.\n' +
  'Jawab dengan senarai sahaja, satu perkara setiap baris dalam bentuk "[ ] perkara" atau "[x] perkara", tanpa tajuk atau ayat lain.\n\n';

const archive = (id) => writeRecord('Item', { id, keadaan: 'arkib', dibuang_pada: '' });
const checklistTitle = (item, rows) => item.title || rows[0].text;

function otherChecklists(exceptId) {
  return state.items
    .filter((item) => item.id !== exceptId && item.type === 'note' && item.ruang === '' && parseChecklist(item.text))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function organiseWithAi(rows) {
  let result;
  try {
    result = await callBackend({ action: 'aiChat', model: currentModel(), messages: [{ role: 'user', text: AI_PROMPT + checklistText(rows) }] });
  } catch {
    throw new Error('Tidak dapat sampai ke Google. Semak internet dan cuba lagi.');
  }
  if (!result.ok) throw new Error(result.code === 'no_key' ? 'Masukkan kunci API Claude dalam Tetapan dahulu.' : result.error);
  const tidy = rowsFromAiText(result.text);
  if (result.truncated || !tidy.length) throw new Error('AI tidak memulangkan checklist yang lengkap. Cuba lagi, atau gabung tanpa AI.');
  return tidy;
}

function checkRow(label, sub, checked = false) {
  const box = h('input', { class: 'check-box', type: 'checkbox', checked });
  return {
    box,
    element: h('label', { class: 'pick-row' }, box,
      h('span', { class: 'row-text' },
        h('span', { class: 'row-title' }, label),
        sub && h('span', { class: 'row-sub' }, sub)))
  };
}

/** text ialah isi terkini checklist yang sedang dibuka, kerana perubahan terakhir mungkin belum sampai ke state. */
export function openMergeChecklists(targetId, text) {
  const target = findItem(targetId);
  const targetRows = parseChecklist(text);
  if (!target || !targetRows) return;
  const others = otherChecklists(targetId).map((item) => {
    const rows = parseChecklist(item.text);
    return { item, rows, ...checkRow(checklistTitle(item, rows), checklistSummary(rows)) };
  });
  const ai = checkRow('Susun dengan AI', 'Satukan perkara yang sama maksud dan kumpulkan yang berkaitan.');
  const button = h('button', { class: 'button primary', type: 'button', onclick: run });
  const error = h('p', { class: 'field-hint failed', hidden: true });

  function update() {
    const picked = others.filter((other) => other.box.checked).length;
    button.textContent = picked ? 'Gabung ' + (picked + 1) + ' checklist' : 'Susun checklist ini';
    button.disabled = !picked && !ai.box.checked;
  }
  [...others.map((other) => other.box), ai.box].forEach((box) => box.addEventListener('change', update));
  update();

  async function run() {
    const picked = others.filter((other) => other.box.checked);
    button.disabled = true;
    error.hidden = true;
    if (ai.box.checked) button.textContent = 'AI sedang menyusun…';
    try {
      let rows = mergeRows([targetRows, ...picked.map((other) => other.rows)]);
      if (ai.box.checked) rows = await organiseWithAi(rows);
      const merged = checklistText(rows);
      if (merged.length > MAX_TEXT_LENGTH) throw new Error('Checklist gabungan terlalu panjang. Pilih kurang checklist.');
      patchItem(targetId, { text: merged });
      picked.forEach((other) => archive(other.item.id));
      dialog.close();
      toast(picked.length ? (picked.length + 1) + ' checklist digabungkan. Yang lain dialih ke Arkib.' : 'Checklist sudah disusun', false, {
        label: 'Batal',
        onClick: () => {
          patchItem(targetId, { text });
          picked.forEach((other) => restoreRecord('Item', other.item.id));
        }
      });
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      update();
    }
  }

  const dialog = openModal({
    title: 'Gabung checklist',
    body: [
      h('p', {}, others.length
        ? 'Pilih checklist untuk dimasukkan ke dalam "' + checklistTitle(target, targetRows) + '". Checklist yang dipilih akan dialih ke Arkib.'
        : 'Tiada checklist lain untuk digabungkan. AI masih boleh menyusun checklist ini.'),
      others.length > 0 && h('div', { class: 'pick-list' }, others.map((other) => other.element)),
      h('div', { class: 'pick-list' }, ai.element),
      error
    ],
    actions: [
      h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal'),
      button
    ]
  });
}

export function openChecklistToBoard(itemId, text) {
  const item = findItem(itemId);
  const rows = parseChecklist(text);
  if (!item || !rows) return;
  const columns = sortedColumns();
  if (!columns.length) {
    toast('Cipta lajur di Papan dahulu.', true);
    return;
  }
  const open = rows.filter((row) => !row.done);
  const done = rows.filter((row) => row.done);
  const lastColumn = columns.at(-1);
  const select = h('select', { class: 'input' }, columns.map((column) => h('option', { value: column.id }, column.tajuk)));
  const doneOption = done.length > 0 && checkRow(
    'Masukkan juga ' + done.length + ' perkara yang sudah siap',
    columns.length > 1 ? 'Ia masuk ke lajur "' + lastColumn.tajuk + '".' : '');
  const archiveOption = checkRow('Arkibkan checklist ini selepas dipindah', 'Boleh dipulihkan dari Arkib.', true);
  const button = h('button', { class: 'button primary', type: 'button', onclick: run });

  function chosen() {
    const extra = doneOption && doneOption.box.checked ? done : [];
    return { open, extra };
  }
  function update() {
    const { extra } = chosen();
    const count = open.length + extra.length;
    button.textContent = 'Pindah ' + count + ' perkara';
    button.disabled = !count;
  }
  if (doneOption) doneOption.box.addEventListener('change', update);
  update();

  function addCards(list, columnId) {
    let position = lastPosition(columnId);
    for (const row of list) {
      position = positionBetween(position, null);
      writeRecord('Kad', { id: newId(), tajuk: row.text.slice(0, MAX_TITLE_LENGTH), nota: '', gambar: '', lajur_id: columnId, kedudukan: position });
    }
  }

  function run() {
    const { extra } = chosen();
    const column = columns.find((other) => other.id === select.value) || columns[0];
    addCards(open, column.id);
    addCards(extra, lastColumn.id);
    if (archiveOption.box.checked) archive(itemId);
    dialog.close();
    const count = open.length + extra.length;
    toast(count + ' kad ditambah ke Papan', false, { label: 'Buka Papan', onClick: () => { location.hash = '#board'; } });
  }

  const dialog = openModal({
    title: 'Pindah ke Kanban',
    body: [
      h('p', {}, open.length
        ? 'Setiap perkara yang belum siap menjadi satu kad di papan Kanban.'
        : 'Semua perkara dalam checklist ini sudah siap.'),
      field('Masukkan ke lajur', select),
      h('div', { class: 'pick-list' }, doneOption && doneOption.element, archiveOption.element)
    ],
    actions: [
      h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal'),
      button
    ]
  });
}
