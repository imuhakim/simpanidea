// Bayaran Touch 'n Go: import penyata, padanan dengan resit, dan senarai yang belum ada resit.
import { callBackend, compressImage, isConfigured, refresh, state, toBase64, writeRecord } from '../lib/data.js';
import { h, icon, openModal, openSheet, toast } from '../lib/dom.js';
import { autoMatches, linkedReceipt, matchCandidates, paymentForReceipt, sameAmount } from '../lib/payments.js';
import { currentModel } from './ai.js';
import { openReceipt } from './receipts.js';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const PREVIEW_ROWS = 50;
const MAX_CANDIDATE_BUTTONS = 3;
const REFRESH_POLL_MS = 200;
const TNG = "Touch 'n Go";

const money = (amount, currency) => (currency || 'RM') + ' ' + Number(amount).toFixed(2);
const whenOf = (record) => [record.tarikh, record.masa].filter(Boolean).join(', ');
const newestFirst = (a, b) => (b.tarikh + b.masa).localeCompare(a.tarikh + a.masa);
const payments = () => state.tables.Bayaran;
const receipts = () => state.raw.Resit;

/* Padanan */
function linkPayment(paymentId, receiptId, padanan = 'manual') {
  return writeRecord('Bayaran', { id: paymentId, resit_id: receiptId, padanan });
}

const unlinkPayment = (paymentId) => writeRecord('Bayaran', { id: paymentId, resit_id: '', padanan: 'tolak' });

/** Dipanggil selepas import, imbasan dan simpan resit. */
export async function applyAutoMatch() {
  const matches = autoMatches(payments(), receipts());
  for (const { paymentId, receiptId } of matches) await linkPayment(paymentId, receiptId, 'auto');
  return matches.length;
}

export const isPaidByTng = (receiptId) => Boolean(paymentForReceipt(receiptId, payments()));

/* Import */
async function readStatementFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('Fail terlalu besar. Hadnya 15 MB.');
  if (file.type.startsWith('image/')) return { file: await toBase64(await compressImage(file)) };
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const raw = new TextDecoder('latin1').decode(await file.arrayBuffer());
    if (raw.includes('/Encrypt')) {
      throw new Error('PDF ini berkata laluan. Buka PDF itu, simpan salinan tanpa kata laluan, kemudian cuba lagi.');
    }
    return { file: await toBase64(file) };
  }
  if (/\.(csv|txt)$/i.test(file.name) || file.type.startsWith('text/')) return { text: await file.text() };
  throw new Error('Format tidak disokong. Gunakan PDF, CSV atau gambar.');
}

async function readStatement(file, dialog, status) {
  status.textContent = 'AI sedang membaca penyata. Ini mungkin mengambil masa sehingga seminit.';
  status.hidden = false;
  try {
    const content = await readStatementFile(file);
    const result = await callBackend({ action: 'readStatement', model: currentModel(), ...content });
    if (!result.ok) {
      if (result.code === 'no_key') throw new Error('Masukkan kunci API di Tetapan untuk membaca penyata.');
      throw new Error(/Tindakan/.test(result.error) ? 'Backend Google perlu dikemas kini dahulu.' : result.error);
    }
    if (!result.data.adakah_penyata) throw new Error('Fail ini nampak bukan penyata transaksi.');
    if (!result.data.transaksi.length) throw new Error('Tiada bayaran keluar yang dapat dibaca dalam fail ini.');
    dialog.close();
    openPreview(result.data);
  } catch (err) {
    status.textContent = err instanceof TypeError
      ? 'Tidak dapat sampai ke Google. Semak internet, atau cuba penyata yang lebih pendek.'
      : err.message;
  }
}

export function openStatementImport() {
  if (!isConfigured()) {
    toast('Sambungkan ke Google dahulu di Tetapan', true);
    return;
  }
  let dialog;
  const status = h('p', { class: 'form-note', hidden: true, role: 'status' });
  const input = h('input', {
    class: 'visually-hidden',
    type: 'file',
    accept: '.pdf,.csv,.txt,application/pdf,text/csv,image/*',
    onchange: (event) => {
      const [file] = event.target.files;
      event.target.value = '';
      if (file) readStatement(file, dialog, status);
    }
  });
  dialog = openModal({
    title: "Import penyata Touch 'n Go",
    body: [
      h('p', { class: 'form-note' }, "Dalam app Touch 'n Go, buka Transaction History dan tekan Email. Kemudian pilih fail yang diterima."),
      h('p', { class: 'field-hint section-hint' }, 'Fail dihantar kepada AI melalui kunci API anda untuk dibaca, dan dicaj kepada akaun API anda. Fail itu tidak disimpan, hanya senarai bayaran.'),
      status
    ],
    actions: [
      h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal'),
      h('label', { class: 'button primary' }, icon('upload'), 'Pilih fail', input)
    ]
  });
}

function paymentLine(payment) {
  return h('div', { class: 'payment-line' },
    h('span', { class: 'row-text' },
      h('span', { class: 'row-title' }, payment.keterangan || payment.jenis || 'Bayaran'),
      h('span', { class: 'row-sub' }, [whenOf(payment), payment.jenis].filter(Boolean).join(' · '))),
    h('span', { class: 'receipt-amount' }, money(payment.jumlah, payment.mata_wang)));
}

async function waitForRefresh() {
  while (state.refreshing) await new Promise((resolve) => setTimeout(resolve, REFRESH_POLL_MS));
}

function openPreview(data) {
  const rows = [...data.transaksi].sort(newestFirst);
  let dialog;
  const save = h('button', {
    class: 'button primary',
    type: 'button',
    onclick: async () => {
      save.disabled = true;
      try {
        const result = await callBackend({ action: 'savePayments', records: data.transaksi });
        if (!result.ok) throw new Error(result.error);
        await waitForRefresh();
        await refresh();
        const matched = await applyAutoMatch();
        dialog.close();
        toast(result.added + ' bayaran baharu, ' + result.skipped + ' sudah ada, ' + matched + ' dipadankan');
        openPayments();
      } catch (err) {
        save.disabled = false;
        toast(err instanceof TypeError ? 'Tidak dapat sampai ke Google' : err.message, true);
      }
    }
  }, 'Simpan ' + rows.length + ' bayaran');
  dialog = openModal({
    title: 'Semak bayaran',
    body: [
      h('p', { class: 'form-note' }, 'Dibaca oleh AI. Tambah nilai dan wang masuk tidak disenaraikan. Semak beberapa baris dengan penyata sebelum menyimpan.'),
      data.tidak_dibaca > 0 && h('p', { class: 'form-note' }, data.tidak_dibaca + ' baris tidak dapat dibaca dan tidak akan disimpan.'),
      h('div', { class: 'payment-preview' }, rows.slice(0, PREVIEW_ROWS).map(paymentLine)),
      rows.length > PREVIEW_ROWS && h('p', { class: 'field-hint' }, 'Dan ' + (rows.length - PREVIEW_ROWS) + ' lagi.')
    ],
    actions: [h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal'), save]
  });
}

/* Senarai bayaran */
function openReceiptPicker(payment, onPick) {
  const taken = new Set(payments().map((other) => other.resit_id).filter(Boolean));
  const open = receipts()
    .filter((receipt) => receipt.keadaan !== 'sampah' && !taken.has(receipt.id))
    .sort((a, b) => String(b.tarikh || b.dicipta).localeCompare(String(a.tarikh || a.dicipta)));
  if (!open.length) {
    toast('Tiada resit yang belum dipadankan', true);
    return;
  }
  let dialog;
  dialog = openModal({
    title: 'Pilih resit',
    body: [
      h('div', { class: 'payment-preview' }, paymentLine(payment)),
      h('div', { class: 'move-choices' }, open.map((receipt) => h('button', {
        class: 'move-choice',
        type: 'button',
        onclick: () => {
          dialog.close();
          onPick(receipt.id);
        }
      }, icon('receipt'), [receipt.peniaga || 'Resit', receipt.tarikh, receipt.jumlah !== '' && receipt.jumlah != null && money(receipt.jumlah, receipt.mata_wang)].filter(Boolean).join(' · '))))
    ],
    actions: [h('button', { class: 'button', type: 'button', onclick: () => dialog.close() }, 'Batal')]
  });
}

export function openPayments() {
  let dialog;
  let showIgnored = false;
  const list = h('div', {});

  const act = async (work, message) => {
    await work();
    draw();
    if (message) toast(message);
  };

  function linkedRow(payment, receipt) {
    return h('article', { class: 'payment-row' }, paymentLine(payment),
      h('div', { class: 'payment-actions' },
        h('button', {
          class: 'button',
          type: 'button',
          onclick: () => {
            dialog.close();
            openReceipt(receipt.id);
          }
        }, icon('receipt'), receipt.peniaga || 'Lihat resit'),
        h('button', {
          class: 'button plain',
          type: 'button',
          onclick: () => act(() => unlinkPayment(payment.id), 'Padanan dibuang')
        }, 'Buang padanan')));
  }

  function openRow(payment) {
    const candidates = matchCandidates(payment, receipts(), payments()).slice(0, MAX_CANDIDATE_BUTTONS);
    return h('article', { class: 'payment-row' }, paymentLine(payment),
      h('div', { class: 'payment-actions' },
        candidates.map((receipt) => h('button', {
          class: 'button',
          type: 'button',
          onclick: () => act(() => linkPayment(payment.id, receipt.id), 'Dipadankan dengan resit')
        }, icon('check'), 'Padankan: ' + [receipt.peniaga || 'Resit', receipt.tarikh].filter(Boolean).join(', '))),
        h('button', {
          class: 'button plain',
          type: 'button',
          onclick: () => openReceiptPicker(payment, (receiptId) => act(() => linkPayment(payment.id, receiptId), 'Dipadankan dengan resit'))
        }, 'Pilih resit'),
        h('button', {
          class: 'button plain',
          type: 'button',
          onclick: () => act(() => writeRecord('Bayaran', { id: payment.id, keadaan: 'abai' }), 'Diabaikan')
        }, 'Abaikan')));
  }

  function ignoredRow(payment) {
    return h('article', { class: 'payment-row' }, paymentLine(payment),
      h('div', { class: 'payment-actions' },
        h('button', {
          class: 'button plain',
          type: 'button',
          onclick: () => act(() => writeRecord('Bayaran', { id: payment.id, keadaan: '' }))
        }, icon('undo'), 'Pulihkan')));
  }

  function draw() {
    const all = [...payments()].sort(newestFirst);
    const linked = all.filter((payment) => linkedReceipt(payment, receipts()));
    const open = all.filter((payment) => !linkedReceipt(payment, receipts()));
    const ignored = state.raw.Bayaran.filter((payment) => payment.keadaan === 'abai').sort(newestFirst);
    list.replaceChildren(...[
      !all.length && !ignored.length && h('p', { class: 'form-note' }, 'Belum ada bayaran. Tekan Import penyata untuk bermula.'),
      open.length > 0 && h('h3', { class: 'section-label' }, 'Belum ada resit', h('span', { class: 'count' }, String(open.length))),
      ...open.map(openRow),
      linked.length > 0 && h('h3', { class: 'section-label' }, 'Sudah ada resit', h('span', { class: 'count' }, String(linked.length))),
      ...linked.map((payment) => linkedRow(payment, linkedReceipt(payment, receipts()))),
      ignored.length > 0 && h('button', {
        class: 'button plain',
        type: 'button',
        onclick: () => {
          showIgnored = !showIgnored;
          draw();
        }
      }, (showIgnored ? 'Sorok' : 'Tunjuk') + ' yang diabaikan (' + ignored.length + ')'),
      ...(showIgnored ? ignored.map(ignoredRow) : [])
    ].filter(Boolean));
  }

  draw();
  dialog = openSheet({
    title: 'Bayaran ' + TNG,
    kicker: 'Dipadankan ikut jumlah dan tarikh',
    body: list,
    actions: [
      h('button', {
        class: 'button',
        type: 'button',
        onclick: () => {
          dialog.close();
          openStatementImport();
        }
      }, icon('upload'), 'Import penyata')
    ]
  });
  dialog.classList.add('payments-sheet');
}

/* Halaman dan panel Resit */
export function paymentSummary() {
  const all = payments();
  if (!all.length) return null;
  const open = all.filter((payment) => !linkedReceipt(payment, receipts())).length;
  return h('button', { class: 'payment-summary', type: 'button', onclick: openPayments },
    h('span', { class: 'nav-icon' }, icon('receipt')),
    h('span', { class: 'row-text' },
      h('span', { class: 'row-title' }, 'Bayaran ' + TNG),
      h('span', { class: 'row-sub' }, all.length + ' bayaran · ' + (open ? open + ' belum ada resit' : 'semua ada resit'))),
    icon('open'));
}

export const statementButton = () =>
  h('button', { class: 'button', type: 'button', onclick: openStatementImport }, icon('upload'), 'Import penyata');

/** Maklumat bayaran dalam panel resit. */
export function receiptPaymentBlock(receiptId) {
  const block = h('div', { class: 'payment-block' });

  function draw() {
    const receipt = receipts().find((record) => record.id === receiptId);
    if (!receipt) return;
    const payment = paymentForReceipt(receiptId, payments());
    if (payment) {
      block.replaceChildren(...[
        h('p', { class: 'payment-paid' }, icon('check'), 'Dibayar dengan ' + TNG),
        h('p', { class: 'field-hint' }, [whenOf(payment), money(payment.jumlah, payment.mata_wang), payment.rujukan && 'Rujukan ' + payment.rujukan].filter(Boolean).join(' · ')),
        !sameAmount(payment, receipt) && h('p', { class: 'field-hint payment-warning' }, 'Jumlah bayaran berbeza dengan jumlah resit.'),
        h('button', {
          class: 'button plain',
          type: 'button',
          onclick: async () => {
            await unlinkPayment(payment.id);
            draw();
          }
        }, 'Buang padanan')
      ].filter(Boolean));
      return;
    }
    const matches = payments()
      .filter((other) => !linkedReceipt(other, receipts()) && matchCandidates(other, [receipt], payments()).length);
    block.replaceChildren(...matches.slice(0, MAX_CANDIDATE_BUTTONS).map((other) => h('button', {
      class: 'button',
      type: 'button',
      onclick: async () => {
        await linkPayment(other.id, receiptId);
        draw();
      }
    }, icon('check'), 'Padankan bayaran ' + TNG + ': ' + [other.tarikh, money(other.jumlah, other.mata_wang)].join(', '))));
  }

  draw();
  return block;
}
