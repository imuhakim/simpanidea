// Padanan bayaran Touch 'n Go dengan resit. Tiada DOM di sini supaya mudah diuji.
const AMOUNT_TOLERANCE = 0.005;
const NEAR_DAYS = 3;

function dayNumber(date) {
  const time = Date.parse(String(date) + 'T00:00:00Z');
  return Number.isNaN(time) ? null : time / 86400000;
}

export function dayGap(a, b) {
  const first = dayNumber(a);
  const second = dayNumber(b);
  return first === null || second === null ? null : Math.abs(first - second);
}

const currencyOf = (record) => String(record.mata_wang || 'RM').toUpperCase();

export function sameAmount(payment, receipt) {
  if (receipt.jumlah === '' || receipt.jumlah == null || currencyOf(payment) !== currencyOf(receipt)) return false;
  const difference = Math.abs(Number(payment.jumlah) - Number(receipt.jumlah));
  return Number.isFinite(difference) && difference < AMOUNT_TOLERANCE;
}

/** Resit dalam Sampah atau yang sudah dibuang kekal tidak dikira sebagai padanan. */
export function linkedReceipt(payment, receipts) {
  if (!payment.resit_id) return null;
  return receipts.find((receipt) => receipt.id === payment.resit_id && receipt.keadaan !== 'sampah') || null;
}

export const paymentForReceipt = (receiptId, payments) =>
  payments.find((payment) => payment.resit_id === receiptId) || null;

/** Resit yang belum dipadankan dan sama jumlahnya, bermula dengan tarikh yang paling hampir. */
export function matchCandidates(payment, receipts, payments) {
  const taken = new Set(payments.filter((other) => other.id !== payment.id).map((other) => other.resit_id).filter(Boolean));
  return receipts
    .filter((receipt) => receipt.keadaan !== 'sampah' && !taken.has(receipt.id) && sameAmount(payment, receipt))
    .map((receipt) => ({ receipt, gap: dayGap(payment.tarikh, receipt.tarikh) }))
    .filter(({ gap }) => gap !== null && gap <= NEAR_DAYS)
    .sort((a, b) => a.gap - b.gap)
    .map(({ receipt }) => receipt);
}

/**
 * Padanan automatik hanya bila tiada keraguan: jumlah sama, tarikh sama, dan satu lawan satu.
 * Bayaran yang padanannya pernah dibuang oleh pengguna tidak disentuh.
 */
export function autoMatches(payments, receipts) {
  const proposals = [];
  for (const payment of payments) {
    if (payment.padanan === 'tolak' || linkedReceipt(payment, receipts)) continue;
    const exact = matchCandidates(payment, receipts, payments)
      .filter((receipt) => dayGap(payment.tarikh, receipt.tarikh) === 0);
    if (exact.length === 1) proposals.push({ paymentId: payment.id, receiptId: exact[0].id });
    else if (exact.length > 1) exact.forEach((receipt) => proposals.push({ paymentId: payment.id, receiptId: receipt.id, ambiguous: true }));
  }
  const claims = new Map();
  for (const { receiptId } of proposals) claims.set(receiptId, (claims.get(receiptId) || 0) + 1);
  return proposals
    .filter(({ receiptId, ambiguous }) => !ambiguous && claims.get(receiptId) === 1)
    .map(({ paymentId, receiptId }) => ({ paymentId, receiptId }));
}
