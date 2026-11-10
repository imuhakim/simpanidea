// Papan kanban. Kad dialih dengan tetikus, atau tekan lama di skrin sentuh.
import { deleteRecord, findRecord, idList, newId, render, state, writeRecord } from '../lib/data.js';
import { askConfirm, askText, field, formatDate, h, icon, openModal, openSheet, toast } from '../lib/dom.js';
import { attachmentEditor, imageHolder } from '../lib/images.js';
import { manageButtons, trashRecord } from './manage.js';
import { askAiButton } from './ai.js';

const LONG_PRESS_MS = 220;
const MOUSE_THRESHOLD = 4;
const TOUCH_SLOP = 8;
const EDGE = 56;
const POSITION_STEP = 1024;

const position = (record) => Number(record.kedudukan) || 0;
const byPosition = (a, b) => position(a) - position(b);
const sortedColumns = () => [...state.tables.Lajur].sort(byPosition);
const cardsIn = (columnId) => state.tables.Kad.filter((card) => card.lajur_id === columnId).sort(byPosition);

function positionBetween(before, after) {
  if (before != null && after != null) return (before + after) / 2;
  if (before != null) return before + POSITION_STEP;
  if (after != null) return after - POSITION_STEP;
  return POSITION_STEP;
}

let suppressClick = false;

function enableDrag(element, card) {
  element.addEventListener('contextmenu', (event) => {
    if (state.dragging || event.pointerType === 'touch') event.preventDefault();
  });
  element.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    const startX = down.clientX;
    const startY = down.clientY;
    const isMouse = down.pointerType === 'mouse';
    let drag = null;
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
    const begin = () => {
      drag = startDrag(element, card, startX, startY);
      if (!isMouse && navigator.vibrate) navigator.vibrate(8);
    };
    const onMove = (event) => {
      const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (!drag) {
        if (isMouse && distance > MOUSE_THRESHOLD) begin();
        else if (!isMouse && distance > TOUCH_SLOP) cleanup();
        return;
      }
      event.preventDefault();
      drag.move(event.clientX, event.clientY);
    };
    const onUp = () => {
      cleanup();
      if (drag) drag.drop();
    };
    const onCancel = () => {
      cleanup();
      if (drag) drag.cancel();
    };
    const onKey = (event) => {
      if (event.key === 'Escape' && drag) onCancel();
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    if (!isMouse) timer = setTimeout(begin, LONG_PRESS_MS);
  });
}

function startDrag(element, card, startX, startY) {
  const rect = element.getBoundingClientRect();
  const offsetX = startX - rect.left;
  const offsetY = startY - rect.top;
  const board = element.closest('.board');
  const ghost = element.cloneNode(true);
  ghost.classList.add('card-ghost');
  ghost.style.width = rect.width + 'px';
  document.body.append(ghost);
  element.classList.add('placeholder');
  document.body.classList.add('is-dragging');
  state.dragging = true;

  let pointerX = startX;
  let pointerY = startY;
  let frame = 0;

  function placeGhost() {
    ghost.style.transform = `translate(${pointerX - offsetX}px, ${pointerY - offsetY}px) rotate(2.5deg) scale(1.03)`;
  }

  function placeCard() {
    const under = document.elementFromPoint(pointerX, pointerY);
    const column = under && under.closest('.board-column');
    if (!column || !column.dataset.column) return;
    board.querySelectorAll('.board-column.over').forEach((other) => {
      if (other !== column) other.classList.remove('over');
    });
    column.classList.add('over');
    const list = column.querySelector('.column-cards');
    const siblings = [...list.querySelectorAll('.card')].filter((other) => other !== element);
    const next = siblings.find((other) => {
      const box = other.getBoundingClientRect();
      return pointerY < box.top + box.height / 2;
    });
    if (next) {
      if (element.nextElementSibling !== next) list.insertBefore(element, next);
    } else if (list.lastElementChild !== element) {
      list.append(element);
    }
  }

  function autoScroll() {
    const box = board.getBoundingClientRect();
    if (pointerX < box.left + EDGE) board.scrollLeft -= 10;
    else if (pointerX > box.right - EDGE) board.scrollLeft += 10;
    const under = document.elementFromPoint(pointerX, pointerY);
    const list = under && under.closest('.board-column')?.querySelector('.column-cards');
    if (list) {
      const listBox = list.getBoundingClientRect();
      if (pointerY < listBox.top + 32) list.scrollTop -= 8;
      else if (pointerY > listBox.bottom - 32) list.scrollTop += 8;
    }
    placeCard();
    frame = requestAnimationFrame(autoScroll);
  }

  function finish() {
    cancelAnimationFrame(frame);
    board.querySelectorAll('.board-column.over').forEach((column) => column.classList.remove('over'));
    ghost.remove();
    element.classList.remove('placeholder');
    document.body.classList.remove('is-dragging');
    state.dragging = false;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 60);
  }

  placeGhost();
  frame = requestAnimationFrame(autoScroll);

  return {
    move(x, y) {
      pointerX = x;
      pointerY = y;
      placeGhost();
    },
    drop() {
      const column = element.closest('.board-column');
      const previous = element.previousElementSibling;
      const following = element.nextElementSibling;
      finish();
      const columnId = column.dataset.column;
      const before = previous ? Number(previous.dataset.position) : null;
      const after = following ? Number(following.dataset.position) : null;
      const unchanged = columnId === card.lajur_id &&
        (before == null || before < position(card)) &&
        (after == null || position(card) < after);
      if (unchanged) {
        render();
        return;
      }
      writeRecord('Kad', { id: card.id, lajur_id: columnId, kedudukan: positionBetween(before, after) });
    },
    cancel() {
      finish();
      render();
    }
  };
}

function cardElement(card) {
  const [firstImage, ...moreImages] = idList(card.gambar);
  const element = h('article', {
    class: 'card',
    tabindex: '0',
    role: 'button',
    'data-position': String(position(card)),
    onclick: () => {
      if (!suppressClick) openCard(card.id);
    },
    onkeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCard(card.id);
      }
    }
  },
  firstImage && imageHolder(firstImage, 'card-image'),
  h('span', { class: 'card-title' }, card.tajuk),
  h('span', { class: 'card-meta' },
    card.nota && h('span', {}, icon('note')),
    moreImages.length > 0 && h('span', {}, icon('clip'), String(moreImages.length + 1)),
    h('span', {}, formatDate(card.dicipta))));
  enableDrag(element, card);
  return element;
}

const COLUMN_COLOURS = ['#2563eb', '#d97706', '#15803d', '#7c3aed', '#db2777', '#0f766e'];

function columnElement(column, index) {
  const cards = cardsIn(column.id);
  const input = h('input', {
    class: 'input', type: 'text', placeholder: 'Tambah kad', 'aria-label': 'Tambah kad ke ' + column.tajuk,
    'data-keep-focus': 'kad-' + column.id
  });
  const element = h('section', { class: 'board-column', 'data-column': column.id, 'aria-label': column.tajuk },
    h('header', { class: 'column-head' },
      h('h2', { class: 'column-title' }, column.tajuk),
      h('span', { class: 'column-count' }, String(cards.length)),
      h('button', {
        class: 'icon-button', type: 'button', 'aria-label': 'Urus lajur ' + column.tajuk, onclick: () => manageColumn(column.id)
      }, icon('more'))),
    h('div', { class: 'column-cards' }, cards.map(cardElement)),
    h('form', {
      class: 'card-add',
      onsubmit: (event) => {
        event.preventDefault();
        const tajuk = input.value.trim();
        if (!tajuk) return;
        input.value = '';
        const last = cardsIn(column.id).at(-1);
        writeRecord('Kad', {
          id: newId(),
          tajuk,
          nota: '',
          gambar: '',
          lajur_id: column.id,
          kedudukan: positionBetween(last ? position(last) : null, null)
        });
      }
    }, input));
  element.style.setProperty('--column', COLUMN_COLOURS[index % COLUMN_COLOURS.length]);
  return element;
}

async function addColumn() {
  const tajuk = await askText({ title: 'Lajur baru', label: 'Tajuk lajur', confirmLabel: 'Tambah' });
  if (!tajuk) return;
  const last = sortedColumns().at(-1);
  writeRecord('Lajur', { id: 'lajur-' + newId(), tajuk, kedudukan: positionBetween(last ? position(last) : null, null) });
}

function manageColumn(id) {
  const column = state.tables.Lajur.find((candidate) => candidate.id === id);
  if (!column) return;
  const columns = sortedColumns();
  const index = columns.findIndex((candidate) => candidate.id === id);
  const input = h('input', { class: 'input', type: 'text', value: column.tajuk });
  let dialog;

  const moveTo = (target) => {
    const other = columns[target];
    writeRecord('Lajur', { id: column.id, kedudukan: position(other) });
    writeRecord('Lajur', { id: other.id, kedudukan: position(column) });
    dialog.close();
  };

  dialog = openModal({
    title: 'Urus lajur',
    body: [
      field('Tajuk', input),
      h('div', { class: 'button-row' },
        h('button', { class: 'button', type: 'button', disabled: index === 0, onclick: () => moveTo(index - 1) }, 'Alih ke kiri'),
        h('button', { class: 'button', type: 'button', disabled: index === columns.length - 1, onclick: () => moveTo(index + 1) }, 'Alih ke kanan'))
    ],
    actions: [
      h('button', {
        class: 'button danger',
        type: 'button',
        onclick: async () => {
          if (columns.length === 1) {
            toast('Papan perlukan sekurang-kurangnya satu lajur', true);
            return;
          }
          const cards = cardsIn(id);
          const yes = await askConfirm({
            title: 'Padam lajur "' + column.tajuk + '"?',
            text: cards.length ? cards.length + ' kad di dalamnya akan dialih ke Sampah.' : 'Lajur ini kosong.',
            confirmLabel: 'Padam'
          });
          if (!yes) return;
          cards.forEach((card) => trashRecord('Kad', card.id));
          deleteRecord('Lajur', id);
          dialog.close();
        }
      }, 'Padam'),
      h('button', {
        class: 'button primary',
        type: 'button',
        onclick: () => {
          const tajuk = input.value.trim();
          if (tajuk && tajuk !== column.tajuk) writeRecord('Lajur', { id, tajuk });
          dialog.close();
        }
      }, 'Simpan')
    ]
  });
}

export function renderBoard() {
  return h('div', { class: 'board' },
    sortedColumns().map(columnElement),
    h('div', { class: 'column-new' },
      h('button', { class: 'button plain', type: 'button', onclick: addColumn }, icon('plus'), 'Tambah lajur')));
}

export function openCard(id) {
  const card = findRecord('Kad', id);
  if (!card) return;
  const titleInput = h('input', { class: 'input', type: 'text', value: card.tajuk });
  const noteInput = h('textarea', { class: 'input', rows: 6, value: card.nota || '', placeholder: 'Butiran' });
  const columnSelect = h('select', { class: 'input' }, sortedColumns().map((column) =>
    h('option', { value: column.id, selected: column.id === card.lajur_id }, column.tajuk)));
  const attachments = attachmentEditor(card.gambar);
  let handled = false;
  let dialog;
  const current = () => ({ tajuk: titleInput.value.trim() || card.tajuk, nota: noteInput.value, gambar: attachments.value(), lajur_id: columnSelect.value });
  let baseline = JSON.stringify(current());
  function persist() {
    if (handled) return;
    attachments.commit();
    const next = current();
    if (JSON.stringify(next) === baseline) return;
    const before = JSON.parse(baseline);
    baseline = JSON.stringify(next);
    const record = { id: card.id, tajuk: next.tajuk, nota: next.nota, gambar: next.gambar };
    if (next.lajur_id !== before.lajur_id) {
      const last = cardsIn(next.lajur_id).filter((other) => other.id !== card.id).at(-1);
      record.lajur_id = next.lajur_id;
      record.kedudukan = positionBetween(last ? position(last) : null, null);
    }
    writeRecord('Kad', record);
  }

  dialog = openSheet({
    title: card.tajuk,
    kicker: 'Dibuat ' + formatDate(card.dicipta),
    autosave: persist,
    body: [
      h('div', { class: 'sheet-actions' }, askAiButton(() => ({
        label: titleInput.value,
        text: 'Kad papan: ' + titleInput.value + '\nButiran: ' + noteInput.value,
        imageIds: idList(attachments.value())
      }))),
      field('Tajuk', titleInput),
      field('Lajur', columnSelect),
      field('Butiran', noteInput),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Gambar'), attachments.element)
    ],
    actions: [
      ...manageButtons({
        table: 'Kad',
        id: card.id,
        read: () => ({ title: titleInput.value.trim(), text: noteInput.value, gambar: attachments.value() }),
        done: () => {
          handled = true;
          attachments.commit();
          dialog.close();
        }
      }),
      h('span', { class: 'foot-spacer' }),
      h('button', {
        class: 'button primary',
        type: 'button',
        onclick: () => {
          if (!titleInput.value.trim()) {
            toast('Kad perlukan tajuk', true);
            return;
          }
          dialog.close();
        }
      }, 'Simpan')
    ]
  });
}
