// Keadaan app, sambungan ke backend dan barisan perubahan.
// Semua perubahan dipaparkan serta-merta, dan dihantar ke Google di belakang tabir.
import { toast } from './dom.js';

const SETTINGS_KEY = 'simpanidea.settings';
const MAX_IMAGE_EDGE = 2000;
const IMAGE_QUALITY = 0.8;
const KEEP_AS_IS = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EMPTY_TABLES = () => ({ Item: [], Tugasan: [], Kad: [], Lajur: [], Kelas: [], Tetapan: [], Resit: [], Bayaran: [] });
const DATED_TABLES = new Set(['Tugasan', 'Kad', 'Kelas', 'Resit']);
// Item ditulis dengan nama lajur Sheet, tapi dibaca dalam app dengan nama yang lebih mudah.
const ITEM_FIELD_TO_COLUMN = { title: 'tajuk', text: 'nota', status: 'status', ruang: 'ruang', gambar: 'gambar' };
const REQUIRED_BACKEND_VERSION = 5;
const TRASH_DAYS = 30;
export const TRASH_LIFETIME_DAYS = TRASH_DAYS;
let purgedThisSession = false;

export const state = {
  view: 'inbox',
  query: '',
  // raw ialah salinan penuh Sheet. tables dan items hanya mengandungi rekod aktif,
  // jadi rekod dalam arkib dan sampah tidak muncul di halaman biasa.
  raw: EMPTY_TABLES(),
  tables: EMPTY_TABLES(),
  items: [],
  queue: [],
  sending: false,
  refreshing: false,
  dragging: false,
  lastSync: null,
  syncError: '',
  needsBackendUpdate: false,
  checks: { worker: null, installed: null, backend: null }
};

let renderer = () => {};
export const setRenderer = (fn) => { renderer = fn; };
export const render = () => renderer();

/* Tetapan */
export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export const isConfigured = () => {
  const { url, secret } = loadSettings();
  return Boolean(url && secret);
};

// Kunci rahsia hanya boleh dihantar ke Apps Script, atau pelayan ujian tempatan.
export function isAllowedBackend(value) {
  try {
    const url = new URL(value, location.href);
    if (url.protocol === 'https:' && url.hostname === 'script.google.com') return true;
    return location.hostname === 'localhost' && url.origin === location.origin;
  } catch {
    return false;
  }
}

export async function callBackend(body) {
  const { url, secret } = loadSettings();
  // text/plain mengelakkan preflight CORS yang Apps Script tidak sokong.
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, secret }),
    redirect: 'follow'
  });
  if (!response.ok) throw new Error('Pelayan jawab ' + response.status);
  return response.json();
}

/* Rekod */
export const idList = (value) => String(value || '').split(',').filter(Boolean);
export const newId = () => crypto.randomUUID();

export function itemFromRow(row) {
  return {
    id: row.id,
    createdAt: row.dicipta,
    type: row.jenis,
    title: row.tajuk,
    url: row.url,
    text: row.nota,
    driveUrl: row.drive_url,
    status: row.status,
    ruang: row.ruang || '',
    gambar: row.gambar || '',
    keadaan: row.keadaan || '',
    dibuangPada: row.dibuang_pada || ''
  };
}

export const findRecord = (table, id) => (state.raw[table] || []).find((row) => row.id === id) || null;

export function findItem(id) {
  const row = findRecord('Item', id);
  return row ? itemFromRow(row) : null;
}

/** Semua rekod dalam arkib atau sampah, kecuali gambar lampiran yang mengikut induknya. */
export function recordsIn(keadaan) {
  const rows = [];
  for (const table of ['Item', 'Tugasan', 'Kad', 'Kelas', 'Resit']) {
    for (const record of state.raw[table] || []) {
      if (record.keadaan === keadaan && record.ruang !== 'lampiran') rows.push({ table, record });
    }
  }
  return rows;
}

function applyOperation(tables, entry) {
  const rows = tables[entry.table] || (tables[entry.table] = []);
  const index = rows.findIndex((row) => row.id === entry.recordId);
  if (entry.op === 'delete') {
    if (index !== -1) rows.splice(index, 1);
  } else if (index !== -1) {
    rows[index] = { ...rows[index], ...entry.record };
  } else if (entry.table !== 'Item') {
    rows.push({ dicipta: entry.createdAt, ...entry.record });
  }
}

const isOperation = (entry) => entry.kind === 'op';

function syncDerived() {
  const active = {};
  for (const [table, rows] of Object.entries(state.raw)) {
    active[table] = rows.filter((row) => !row.keadaan);
  }
  state.tables = { ...EMPTY_TABLES(), ...active };
  state.items = state.tables.Item.map(itemFromRow);
}

/** Buang kekal satu rekod bersama gambar lampirannya. */
export function hardDelete(table, record) {
  idList(record.gambar).forEach((id) => deleteRecord('Item', id));
  return deleteRecord(table, record.id);
}

function purgeOldTrash() {
  if (purgedThisSession) return;
  purgedThisSession = true;
  const cutoff = Date.now() - TRASH_DAYS * 86400000;
  for (const { table, record } of recordsIn('sampah')) {
    const removedAt = new Date(record.dibuang_pada).getTime();
    if (removedAt && removedAt < cutoff) hardDelete(table, record);
  }
}

export async function loadLocalData() {
  const cached = await SimpanStore.getTables();
  state.raw = { ...EMPTY_TABLES(), ...(cached || {}) };
  await loadQueue();
  syncDerived();
}

export async function loadQueue() {
  state.queue = await SimpanStore.listQueued();
}

export async function refresh() {
  if (!isConfigured() || state.refreshing) return;
  state.refreshing = true;
  render();
  try {
    const result = await callBackend({ action: 'listAll' });
    if (result.ok) {
      await SimpanStore.putTables(result.tables);
      await loadQueue();
      // Perubahan yang belum sampai ke Google mesti kekal kelihatan.
      const tables = { ...EMPTY_TABLES(), ...result.tables };
      state.queue.filter(isOperation).forEach((entry) => applyOperation(tables, entry));
      state.raw = tables;
      syncDerived();
      state.lastSync = new Date();
      state.syncError = '';
      // Backend lama masih boleh dibaca, tapi tidak dapat menyimpan arkib dan sampah.
      state.needsBackendUpdate = (result.version || 0) < REQUIRED_BACKEND_VERSION;
      state.checks.backend = { state: 'ok', label: 'Sambungan ke Google berjaya' };
      if (!state.needsBackendUpdate) purgeOldTrash();
    } else if (result.code === 'bad_request') {
      state.needsBackendUpdate = true;
      state.syncError = 'Backend perlu dikemas kini';
      state.checks.backend = { state: 'fail', label: 'Backend Google masih versi lama' };
    } else {
      state.syncError = result.error;
      state.checks.backend = { state: 'fail', label: result.error };
    }
  } catch (err) {
    state.syncError = 'Tidak dapat sampai ke Google';
    state.checks.backend = { state: 'fail', label: 'Tidak dapat sampai ke Google (' + err.message + ')' };
  } finally {
    state.refreshing = false;
    render();
  }
}

/** Simpan atau kemas kini satu rekod. Hanya medan yang diberi akan berubah. */
export async function writeRecord(table, input) {
  const id = 'op-' + table + '-' + input.id;
  const existing = await SimpanStore.getQueued(id);
  // Rekod baru membawa masa ia dibuat, walaupun ia lambat sampai ke Google.
  const isNew = DATED_TABLES.has(table) && !existing && !findRecord(table, input.id);
  const record = isNew ? { dicipta: new Date().toISOString(), ...input } : input;
  const entry = {
    id,
    kind: 'op',
    op: 'save',
    table,
    recordId: record.id,
    record: existing && existing.op === 'save' ? { ...existing.record, ...record } : record,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    stamp: newId(),
    status: 'pending',
    error: ''
  };
  await SimpanStore.enqueue(entry);
  applyOperation(state.raw, { ...entry, record });
  syncDerived();
  await loadQueue();
  render();
  processQueue();
}

export async function deleteRecord(table, recordId) {
  const id = 'op-' + table + '-' + recordId;
  // Rekod Item yang belum pernah sampai ke Google cuma perlu dibuang dari barisan.
  if (table === 'Item' && await SimpanStore.getQueued(recordId)) {
    await SimpanStore.removeQueued(recordId);
    await SimpanStore.removeQueued(id);
    await SimpanStore.removeImage(recordId);
  } else {
    await SimpanStore.enqueue({
      id,
      kind: 'op',
      op: 'delete',
      table,
      recordId,
      createdAt: new Date().toISOString(),
      stamp: newId(),
      status: 'pending',
      error: ''
    });
  }
  applyOperation(state.raw, { table, recordId, op: 'delete' });
  syncDerived();
  await loadQueue();
  render();
  processQueue();
}

export function patchItem(id, fields) {
  const record = { id };
  for (const [field, value] of Object.entries(fields)) record[ITEM_FIELD_TO_COLUMN[field]] = value;
  return writeRecord('Item', record);
}

/* Gambar */
export async function compressImage(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    if (KEEP_AS_IS.has(blob.type)) return blob;
    throw new Error('Gambar tidak boleh dibaca.');
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const compressed = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', IMAGE_QUALITY));
  if (!compressed || !KEEP_AS_IS.has(compressed.type)) {
    if (KEEP_AS_IS.has(blob.type)) return blob;
    throw new Error('Format gambar tidak disokong.');
  }
  return compressed.size < blob.size || !KEEP_AS_IS.has(blob.type) ? compressed : blob;
}

export function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/* Item baru */
export function newItem(fields) {
  return {
    id: newId(),
    title: '',
    url: '',
    text: '',
    ruang: '',
    gambar: '',
    createdAt: new Date().toISOString(),
    status: 'pending',
    error: '',
    ...fields
  };
}

export function itemFromText(raw, fields = {}) {
  const text = raw.trim();
  const match = text.match(/https?:\/\/\S+/i);
  if (match) return newItem({ type: 'link', url: match[0], text: text === match[0] ? '' : text, ...fields });
  return newItem({ type: 'note', text, ...fields });
}

/** Gambar dikecilkan dan disimpan dalam peranti dahulu, supaya terus boleh dilihat. */
export async function imageItem(file, fields = {}) {
  const blob = await compressImage(file);
  const item = newItem({ type: 'image', blob, ready: true, title: file.name || '', ...fields });
  await SimpanStore.putImage(item.id, blob);
  return item;
}

export async function addItems(items) {
  await Promise.all(items.map((item) => SimpanStore.enqueue(item)));
  await loadQueue();
  render();
  if (!isConfigured()) toast('Disimpan dalam peranti. Lengkapkan Tetapan untuk hantar ke Google.');
  processQueue();
}

/* Barisan hantar */
async function itemPayload(entry) {
  const payload = {
    id: entry.id, type: entry.type, title: entry.title, url: entry.url,
    text: entry.text, ruang: entry.ruang || '', gambar: entry.gambar || '', createdAt: entry.createdAt
  };
  let image = null;
  if (entry.type === 'image') {
    image = entry.ready ? entry.blob : await compressImage(entry.blob);
    payload.mimeType = image.type;
    payload.dataBase64 = await toBase64(image);
  }
  return { payload, image };
}

async function sendEntry(entry) {
  if (!isOperation(entry)) {
    const { payload, image } = await itemPayload(entry);
    const result = await callBackend({ action: 'saveItem', item: payload });
    if (result.ok && image) await SimpanStore.putImage(entry.id, image);
    return result;
  }
  if (entry.op === 'delete') {
    return callBackend({ action: 'deleteRecord', table: entry.table, id: entry.recordId });
  }
  return callBackend({ action: 'saveRecord', table: entry.table, record: { id: entry.recordId, ...entry.record } });
}

export async function processQueue() {
  if (state.sending || !isConfigured()) return;
  await loadQueue();
  if (!state.queue.length) return;
  state.sending = true;
  let savedItems = 0;
  let anySent = false;
  try {
    for (const { id } of [...state.queue]) {
      const entry = await SimpanStore.getQueued(id);
      if (!entry) continue;
      await SimpanStore.enqueue({ ...entry, status: 'sending', error: '' });
      await loadQueue();
      render();
      try {
        const result = await sendEntry(entry);
        // Rekod mungkin diubah lagi semasa dihantar; versi baru itu mesti terus menunggu.
        const latest = await SimpanStore.getQueued(id);
        const changed = latest && latest.stamp !== entry.stamp;
        if (result.ok) {
          anySent = true;
          if (!isOperation(entry)) savedItems += entry.ruang === 'lampiran' ? 0 : 1;
          if (changed) await SimpanStore.enqueue({ ...latest, status: 'pending', error: '' });
          else await SimpanStore.removeQueued(id);
        } else {
          await SimpanStore.enqueue({ ...(latest || entry), status: 'failed', error: result.error });
          if (result.code === 'unauthorized' || result.code === 'not_setup') break;
        }
      } catch (err) {
        // TypeError bermakna fetch gagal: internet terputus, atau Web App bukan "Anyone".
        const offline = err instanceof TypeError;
        const latest = await SimpanStore.getQueued(id);
        await SimpanStore.enqueue({
          ...(latest || entry),
          status: offline ? 'pending' : 'failed',
          error: offline ? 'Belum sampai, akan cuba lagi' : err.message
        });
        if (offline) break;
      }
    }
  } finally {
    state.sending = false;
    await loadQueue();
    render();
  }
  if (savedItems) toast(savedItems === 1 ? 'Disimpan ke Google' : savedItems + ' item disimpan ke Google');
  if (anySent) {
    await refresh();
    await processQueue();
  }
}

export function firstColumnId() {
  const [first] = [...state.tables.Lajur].sort((a, b) => Number(a.kedudukan) - Number(b.kedudukan));
  return first ? first.id : null;
}
