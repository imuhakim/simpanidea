// Senarai tugasan, dikumpul ikut tarikh.
import { deleteRecord, idList, newId, state, writeRecord } from '../lib/data.js';
import { askConfirm, emptyState, field, h, icon, openSheet, toast } from '../lib/dom.js';
import { attachmentEditor, deleteAttachments } from '../lib/images.js';

let showDone = false;

function localDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function dueLabel(value) {
  if (!value) return '';
  const today = localDate();
  if (value === today) return 'Hari ini';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (value === localDate(tomorrow)) return 'Esok';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' });
}

function taskRow(task) {
  const done = task.siap === 'ya';
  const late = !done && task.tarikh_akhir && task.tarikh_akhir < localDate();
  const images = idList(task.gambar).length;
  return h('article', { class: 'task' + (done ? ' done' : '') },
    h('input', {
      class: 'task-check',
      type: 'checkbox',
      checked: done,
      'aria-label': (done ? 'Tanda belum siap: ' : 'Tanda siap: ') + task.tajuk,
      onchange: (event) => {
        // Lepaskan fokus supaya senarai boleh disusun semula serta-merta.
        event.target.blur();
        writeRecord('Tugasan', { id: task.id, siap: event.target.checked ? 'ya' : '' });
      }
    }),
    h('button', { class: 'task-main', type: 'button', onclick: () => openTask(task.id) },
      h('span', { class: 'task-title' }, task.tajuk),
      (task.tarikh_akhir || task.nota || images > 0) && h('span', { class: 'task-meta' },
        task.tarikh_akhir && h('span', { class: late ? 'late' : '' }, dueLabel(task.tarikh_akhir)),
        task.nota && h('span', {}, icon('note')),
        images > 0 && h('span', {}, icon('clip'), String(images)))));
}

function group(label, tasks, className = '') {
  if (!tasks.length) return null;
  return [
    h('h2', { class: 'section-label ' + className }, label, h('span', { class: 'count' }, String(tasks.length))),
    h('div', {}, tasks.map(taskRow))
  ];
}

export function renderTasks() {
  const today = localDate();
  const byDue = (a, b) => String(a.tarikh_akhir).localeCompare(String(b.tarikh_akhir));
  const newest = (a, b) => String(b.dicipta).localeCompare(String(a.dicipta));
  const open = state.tables.Tugasan.filter((task) => task.siap !== 'ya');
  const done = state.tables.Tugasan.filter((task) => task.siap === 'ya').sort(newest);

  const titleInput = h('input', {
    class: 'input', type: 'text', placeholder: 'Tugasan baru', 'aria-label': 'Tugasan baru', required: true,
    'data-keep-focus': 'tugasan-baru'
  });
  const dateInput = h('input', { class: 'input', type: 'date', 'aria-label': 'Tarikh akhir' });
  const form = h('form', {
    class: 'quick-add',
    onsubmit: (event) => {
      event.preventDefault();
      const tajuk = titleInput.value.trim();
      if (!tajuk) return;
      const tarikh = dateInput.value;
      titleInput.value = '';
      dateInput.value = '';
      writeRecord('Tugasan', { id: newId(), tajuk, tarikh_akhir: tarikh, siap: '', nota: '', gambar: '' });
      titleInput.focus();
    }
  }, titleInput, dateInput, h('button', { class: 'button', type: 'submit' }, 'Tambah'));

  return h('div', { class: 'page' }, form,
    !open.length && !done.length && emptyState('Tiada tugasan', 'Tulis tugasan pertama kau di atas.'),
    !open.length && done.length > 0 && emptyState('Semua dah siap', 'Tiada tugasan tertunggak.'),
    group('Lewat', open.filter((task) => task.tarikh_akhir && task.tarikh_akhir < today).sort(byDue), 'signal'),
    group('Hari ini', open.filter((task) => task.tarikh_akhir === today).sort(newest)),
    group('Akan datang', open.filter((task) => task.tarikh_akhir > today).sort(byDue)),
    group('Tiada tarikh', open.filter((task) => !task.tarikh_akhir).sort(newest)),
    done.length > 0 && h('button', {
      class: 'button plain',
      type: 'button',
      onclick: (event) => {
        showDone = !showDone;
        event.target.closest('.page').querySelector('.done-list').hidden = !showDone;
        event.target.closest('button').textContent = (showDone ? 'Sorok' : 'Tunjuk') + ' yang dah siap (' + done.length + ')';
      }
    }, (showDone ? 'Sorok' : 'Tunjuk') + ' yang dah siap (' + done.length + ')'),
    h('div', { class: 'done-list', hidden: !showDone }, done.map(taskRow)));
}

export function openTask(id) {
  const task = state.tables.Tugasan.find((candidate) => candidate.id === id);
  if (!task) return;
  const titleInput = h('input', { class: 'input', type: 'text', value: task.tajuk });
  const noteInput = h('textarea', { class: 'input', rows: 5, value: task.nota || '', placeholder: 'Butiran' });
  const dateInput = h('input', { class: 'input', type: 'date', value: task.tarikh_akhir || '' });
  const attachments = attachmentEditor(task.gambar);
  let saved = false;
  let dialog;

  dialog = openSheet({
    title: task.tajuk,
    kicker: 'Tugasan',
    onClose: () => { if (!saved) attachments.discard(); },
    body: [
      field('Tugasan', titleInput),
      field('Tarikh akhir', dateInput),
      field('Butiran', noteInput),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Gambar'), attachments.element)
    ],
    actions: [
      h('button', {
        class: 'button plain',
        type: 'button',
        onclick: async () => {
          if (!await askConfirm({ title: 'Padam tugasan ini?', text: task.tajuk, confirmLabel: 'Padam' })) return;
          saved = true;
          deleteAttachments(task.gambar);
          deleteRecord('Tugasan', task.id);
          dialog.close();
        }
      }, 'Padam'),
      h('span', { class: 'foot-spacer' }),
      h('button', {
        class: 'button primary',
        type: 'button',
        onclick: () => {
          const tajuk = titleInput.value.trim();
          if (!tajuk) {
            toast('Tugasan perlukan tajuk', true);
            return;
          }
          saved = true;
          attachments.commit();
          writeRecord('Tugasan', {
            id: task.id,
            tajuk,
            nota: noteInput.value,
            tarikh_akhir: dateInput.value,
            gambar: attachments.value()
          });
          dialog.close();
        }
      }, 'Simpan')
    ]
  });
}
