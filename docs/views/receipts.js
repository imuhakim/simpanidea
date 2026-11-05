// Resit: gambar di sebelah kiri, data yang diekstrak AI di sebelah kanan, dan semuanya boleh dibetulkan.
import { addItems, callBackend, findRecord, imageItem, isConfigured, newId, processQueue, render, state, writeRecord } from '../lib/data.js';
import { emptyState, field, formatDate, h, icon, openModal, openSheet, toast } from '../lib/dom.js';
import { imageHolder, imageUrlFor, openImage, photoButtons } from '../lib/images.js';
import { askAiButton, currentModel } from './ai.js';
import { manageButtons } from './manage.js';
import { voiceButton } from './voice.js';
import { applyAutoMatch, isPaidByTng, paymentSummary, receiptPaymentBlock, statementButton } from './payments.js';

const CATEGORIES = ['Makanan', 'Runcit', 'Minyak', 'Pengangkutan', 'Utiliti', 'Perubatan', 'Pakaian', 'Kerja', 'Lain-lain'];
const UPLOAD_WAIT_MS = 90000;
const UPLOAD_POLL_MS = 500;
const MAX_ITEMS_JSON = 4800;
const STATUS_TEXT = {
  gagal: 'Imbasan gagal',
  bukan: 'Gambar ini nampak bukan resit',
  '': 'Belum diimbas'
};

const scanning = new Set();

function parseItems(value) {
  try {
    const list = JSON.parse(value || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function formatAmount(amount, currency) {
  const number = Number(amount);
  if (amount === '' || amount == null || !Number.isFinite(number)) return '';
  return (currency || 'RM') + ' ' + number.toFixed(2);
}

const monthKey = (receipt) => String(receipt.tarikh || receipt.dicipta || '').slice(0, 7);

function monthLabel(key) {
  const date = new Date(key + '-01T00:00:00');
  if (Number.isNaN(date.getTime())) return 'Tiada tarikh';
  return date.toLocaleDateString('ms-MY', { month: 'long', year: 'numeric' });
}

function monthTotal(receipts) {
  const totals = new Map();
  for (const receipt of receipts) {
    const amount = Number(receipt.jumlah);
    if (receipt.jumlah === '' || receipt.jumlah == null || !Number.isFinite(amount)) continue;
    const currency = receipt.mata_wang || 'RM';
    totals.set(currency, (totals.get(currency) || 0) + amount);
  }
  return [...totals].map(([currency, total]) => formatAmount(total, currency)).join(' + ');
}

function statusLabel(receipt) {
  if (scanning.has(receipt.id)) return 'AI sedang mengimbas';
  return STATUS_TEXT[receipt.status_imbas] ?? '';
}

/* Imbasan */
async function waitForUpload(imageId) {
  const deadline = Date.now() + UPLOAD_WAIT_MS;
  processQueue();
  while (Date.now() < deadline) {
    if (!await SimpanStore.getQueued(imageId)) return true;
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_POLL_MS));
  }
  return false;
}

export async function scanReceipt(id) {
  const receipt = findRecord('Resit', id);
  if (!receipt || !receipt.gambar || scanning.has(id)) return;
  if (!isConfigured()) {
    toast('Sambungkan ke Google dahulu di Tetapan', true);
    return;
  }
  scanning.add(id);
  render();
  try {
    if (!await waitForUpload(receipt.gambar)) throw new Error('Gambar belum sampai ke Google. Cuba imbas semula nanti.');
    const result = await callBackend({ action: 'scanReceipt', imageId: receipt.gambar, model: currentModel() });
    if (result.ok) {
      const { data } = result;
      if (!data.adakah_resit) {
        await writeRecord('Resit', { id, status_imbas: 'bukan' });
        toast('Gambar ini nampak bukan resit', true);
        return;
      }
      await writeRecord('Resit', {
        id,
        peniaga: data.peniaga,
        tarikh: data.tarikh,
        masa: data.masa,
        jumlah: data.jumlah,
        mata_wang: data.mata_wang,
        cukai: data.cukai,
        kategori: data.kategori,
        no_resit: data.no_resit,
        barangan: JSON.stringify(data.barangan),
        status_imbas: 'siap'
      });
      await applyAutoMatch();
      toast('Resit diimbas. Semak data sebelum bergantung padanya.');
    } else if (result.code === 'no_key') {
      await writeRecord('Resit', { id, status_imbas: '' });
      toast('Masukkan kunci API di Tetapan untuk imbas resit', true);
    } else {
      await writeRecord('Resit', { id, status_imbas: 'gagal' });
      toast(/Tindakan/.test(result.error) ? 'Backend Google perlu dikemas kini dahulu' : result.error, true);
    }
  } catch (err) {
    await writeRecord('Resit', { id, status_imbas: 'gagal' });
    toast(err instanceof TypeError ? 'Tidak dapat sampai ke Google' : err.message, true);
  } finally {
    scanning.delete(id);
    render();
  }
}

async function addReceiptFiles(files) {
  try {
    for (const file of files) {
      const image = await imageItem(file, { ruang: 'lampiran', title: '' });
      const id = newId();
      await addItems([image]);
      await writeRecord('Resit', { id, gambar: image.id, status_imbas: '', barangan: '[]', nota: '' });
      scanReceipt(id);
    }
  } catch (err) {
    toast(err.message, true);
  }
}

/** Dipanggil oleh butang Tambah di bahagian atas. */
export function openReceiptAdd() {
  let dialog;
  dialog = openModal({
    title: 'Tambah resit',
    body: [
      h('p', { class: 'form-note' }, 'AI akan baca resit dan isikan datanya untuk anda.'),
      h('div', { class: 'button-row' }, photoButtons((files) => {
        dialog.close();
        addReceiptFiles(files);
      }))
    ],
    actions: [h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal')]
  });
}

/* Senarai */
function receiptRow(receipt) {
  const label = statusLabel(receipt);
  const busy = scanning.has(receipt.id);
  const details = [receipt.kategori, receipt.tarikh, isPaidByTng(receipt.id) && "Touch 'n Go"].filter(Boolean).join(' · ');
  return h('article', { class: 'row receipt-row' + (busy ? ' scanning' : '') },
    h('button', { class: 'row-main', type: 'button', onclick: () => openReceipt(receipt.id) },
      receipt.gambar ? imageHolder(receipt.gambar, 'thumb') : h('span', { class: 'thumb' }, icon('receipt')),
      h('span', { class: 'row-text' },
        h('span', { class: 'row-title' }, receipt.peniaga || 'Resit'),
        h('span', { class: 'row-sub' + (label ? ' row-state' + (receipt.status_imbas === 'gagal' ? ' failed' : '') : '') }, label || details),
        h('span', { class: 'row-when' }, (receipt.gambar ? 'Dimuat naik ' : 'Dicatat ') + formatDate(receipt.dicipta))),
      h('span', { class: 'receipt-amount' }, formatAmount(receipt.jumlah, receipt.mata_wang))));
}

export function renderReceipts() {
  const receipts = [...state.tables.Resit].sort((a, b) =>
    String(b.tarikh || b.dicipta).localeCompare(String(a.tarikh || a.dicipta)));
  const months = new Map();
  for (const receipt of receipts) {
    const key = monthKey(receipt);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(receipt);
  }
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('p', { class: 'page-note' }, 'Ambil gambar resit, atau tekan Cakap untuk mencatat perbelanjaan. AI isikan kategori, tarikh dan jumlah.'),
      h('div', { class: 'button-row' }, photoButtons(addReceiptFiles), voiceButton(), statementButton())),
    paymentSummary(),
    !receipts.length && emptyState('Belum ada resit', 'Ambil gambar resit pertama anda. Imbasan perlukan kunci API di Tetapan.'),
    [...months].map(([key, list]) => [
      h('h2', { class: 'section-label' }, monthLabel(key),
        h('span', { class: 'count' }, String(list.length)),
        h('span', { class: 'section-total' }, monthTotal(list))),
      h('div', { class: 'rows' }, list.map(receiptRow))
    ]));
}

/* Panel */
function itemsEditor(initial) {
  const list = h('div', { class: 'receipt-items' });

  function addRow(item = {}) {
    const name = h('input', { class: 'input', type: 'text', value: item.nama || '', placeholder: 'Barang', 'aria-label': 'Nama barang' });
    const quantity = h('input', { class: 'input', type: 'number', step: 'any', inputmode: 'decimal', value: item.kuantiti ?? '', placeholder: 'Qty', 'aria-label': 'Kuantiti' });
    const price = h('input', { class: 'input', type: 'number', step: 'any', inputmode: 'decimal', value: item.harga ?? '', placeholder: 'Harga', 'aria-label': 'Harga' });
    const row = h('div', { class: 'receipt-item' }, name, quantity, price,
      h('button', {
        class: 'icon-button',
        type: 'button',
        'aria-label': 'Buang barang',
        onclick: () => row.remove()
      }, icon('close')));
    list.append(row);
  }
  initial.forEach(addRow);

  return {
    element: h('div', {}, list, h('button', { class: 'button plain', type: 'button', onclick: () => addRow() }, icon('plus'), 'Tambah barang')),
    value() {
      const rows = [...list.children].map((row) => {
        const [name, quantity, price] = row.querySelectorAll('input');
        return {
          nama: name.value.trim(),
          kuantiti: quantity.value === '' ? null : Number(quantity.value),
          harga: price.value === '' ? null : Number(price.value)
        };
      }).filter((item) => item.nama || item.harga !== null);
      while (rows.length && JSON.stringify(rows).length > MAX_ITEMS_JSON) rows.pop();
      return JSON.stringify(rows);
    }
  };
}

export function openReceipt(id) {
  const receipt = findRecord('Resit', id);
  if (!receipt) return;
  const merchant = h('input', { class: 'input', type: 'text', value: receipt.peniaga || '', placeholder: 'Nama kedai' });
  const date = h('input', { class: 'input', type: 'date', value: receipt.tarikh || '' });
  const time = h('input', { class: 'input', type: 'time', value: receipt.masa || '' });
  const total = h('input', { class: 'input', type: 'number', step: 'any', inputmode: 'decimal', value: receipt.jumlah ?? '' });
  const currency = h('input', { class: 'input', type: 'text', value: receipt.mata_wang || 'RM', 'aria-label': 'Mata wang' });
  const tax = h('input', { class: 'input', type: 'number', step: 'any', inputmode: 'decimal', value: receipt.cukai ?? '' });
  const number = h('input', { class: 'input', type: 'text', value: receipt.no_resit || '' });
  const categoryOptions = CATEGORIES.includes(receipt.kategori) || !receipt.kategori ? CATEGORIES : [receipt.kategori, ...CATEGORIES];
  const category = h('select', { class: 'input' },
    h('option', { value: '', selected: !receipt.kategori }, 'Pilih kategori'),
    categoryOptions.map((name) => h('option', { value: name, selected: name === receipt.kategori }, name)));
  const note = h('textarea', { class: 'input', rows: 3, value: receipt.nota || '', placeholder: 'Catatan anda' });
  const items = itemsEditor(parseItems(receipt.barangan));

  const frame = h('button', { class: 'sheet-image', type: 'button', 'aria-label': 'Besarkan resit', onclick: () => openImage(receipt.gambar, 'Resit') });
  if (receipt.gambar) {
    imageUrlFor(receipt.gambar)
      .then((url) => frame.append(h('img', { src: url, alt: 'Gambar resit' })))
      .catch(() => { frame.textContent = 'Gambar tidak dapat dimuat.'; });
  }

  let dialog;
  const done = () => dialog.close();
  const busy = scanning.has(id);
  const notice = statusLabel(receipt);

  dialog = openSheet({
    title: receipt.peniaga || 'Resit',
    kicker: (receipt.gambar ? 'Dimuat naik ' : 'Dicatat ') + formatDate(receipt.dicipta),
    body: h('div', { class: 'receipt-split' + (receipt.gambar ? '' : ' no-image') },
      receipt.gambar && h('div', { class: 'receipt-image' }, frame),
      h('div', { class: 'receipt-data' },
        notice && h('p', { class: 'form-note' }, notice),
        receipt.status_imbas === 'siap' && h('p', { class: 'form-note' }, 'Diisi oleh AI. Semak sebelum bergantung padanya.'),
        h('div', { class: 'sheet-actions' },
          receipt.gambar && h('button', {
            class: 'button',
            type: 'button',
            disabled: busy,
            onclick: () => {
              dialog.close();
              scanReceipt(id);
            }
          }, icon('sync'), receipt.status_imbas === 'siap' ? 'Imbas semula' : 'Imbas dengan AI'),
          askAiButton(() => ({
            label: merchant.value || 'Resit',
            text: 'Resit dari: ' + merchant.value + '\nTarikh: ' + date.value + '\nJumlah: ' + formatAmount(total.value, currency.value) + '\nCatatan: ' + note.value,
            imageIds: receipt.gambar ? [receipt.gambar] : []
          }))),
        receiptPaymentBlock(id),
        field('Peniaga', merchant),
        h('div', { class: 'receipt-grid' }, field('Tarikh resit', date), field('Masa resit', time)),
        h('div', { class: 'receipt-grid' }, field('Jumlah', total), field('Mata wang', currency)),
        h('div', { class: 'receipt-grid' }, field('Cukai', tax), field('Kategori', category)),
        field('No. resit', number),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Barangan'), items.element),
        field('Catatan', note))),
    actions: [
      ...manageButtons({ table: 'Resit', id, done }),
      h('span', { class: 'foot-spacer' }),
      h('button', {
        class: 'button primary',
        type: 'button',
        onclick: () => {
          writeRecord('Resit', {
            id,
            peniaga: merchant.value.trim(),
            tarikh: date.value,
            masa: time.value,
            jumlah: total.value,
            mata_wang: currency.value.trim(),
            cukai: tax.value,
            kategori: category.value,
            no_resit: number.value.trim(),
            barangan: items.value(),
            nota: note.value
          }).then(applyAutoMatch);
          dialog.close();
        }
      }, 'Simpan')
    ]
  });
  dialog.classList.add('receipt-sheet');
}
