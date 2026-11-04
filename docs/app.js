const MAX_IMAGE_EDGE = 2000;
const IMAGE_QUALITY = 0.8;
const KEEP_AS_IS = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SETTINGS_KEY = 'simpanidea.settings';

const $ = (id) => document.getElementById(id);
let sending = false;
let installPrompt = null;

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Kunci rahsia hanya boleh dihantar ke Apps Script, atau pelayan ujian tempatan.
function isAllowedBackend(value) {
  try {
    const url = new URL(value, location.href);
    if (url.protocol === 'https:' && url.hostname === 'script.google.com') return true;
    return location.hostname === 'localhost' && url.origin === location.origin;
  } catch {
    return false;
  }
}

function notify(message, isError = false) {
  const notice = $('notice');
  notice.textContent = message;
  notice.classList.toggle('error', isError);
  notice.hidden = !message;
}

function setCheck(id, state, label) {
  const element = $(id);
  element.classList.remove('ok', 'fail');
  if (state) element.classList.add(state);
  if (label) element.textContent = label;
}

async function callBackend(body) {
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

async function testBackend() {
  const { url, secret } = loadSettings();
  if (!url || !secret) {
    setCheck('check-backend', null, 'Sambungan ke Google: belum diisi');
    return false;
  }
  try {
    const result = await callBackend({ action: 'ping' });
    if (result.ok) {
      setCheck('check-backend', 'ok', 'Sambungan ke Google: berjaya');
      return true;
    }
    setCheck('check-backend', 'fail', 'Sambungan ke Google: ' + result.error);
  } catch (err) {
    setCheck('check-backend', 'fail', 'Sambungan ke Google: gagal (' + err.message + ')');
  }
  return false;
}

async function compressImage(blob) {
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

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function toPayload(item) {
  const payload = {
    id: item.id,
    type: item.type,
    title: item.title,
    url: item.url,
    text: item.text
  };
  if (item.type === 'image') {
    const image = await compressImage(item.blob);
    payload.mimeType = image.type;
    payload.dataBase64 = await toBase64(image);
  }
  return payload;
}

async function processQueue() {
  const { url, secret } = loadSettings();
  if (sending || !url || !secret) return;
  sending = true;
  $('send-now').disabled = true;
  let sentCount = 0;
  try {
    for (const item of await SimpanStore.listQueued()) {
      await SimpanStore.enqueue({ ...item, status: 'sending', error: '' });
      await render();
      try {
        const result = await callBackend({ action: 'saveItem', item: await toPayload(item) });
        if (result.ok) {
          await SimpanStore.markSent(item, result.driveUrl);
          sentCount += 1;
        } else {
          await SimpanStore.enqueue({ ...item, status: 'failed', error: result.error });
          if (result.code === 'unauthorized' || result.code === 'not_setup') break;
        }
      } catch (err) {
        // Masalah rangkaian: simpan item dan cuba lagi kemudian.
        // Fetch juga gagal begini kalau Web App bukan "Anyone", jadi jangan salahkan internet saja.
        const offline = err instanceof TypeError;
        await SimpanStore.enqueue({
          ...item,
          status: offline ? 'pending' : 'failed',
          error: offline ? 'Belum sampai, akan cuba lagi' : err.message
        });
        if (offline) break;
      }
    }
  } finally {
    sending = false;
    $('send-now').disabled = false;
    await render();
  }
  if (sentCount) notify(sentCount + ' item masuk ke Google Drive dan Sheets.');
}

function describe(item) {
  return item.title || item.url || item.text || 'Item';
}

const TYPE_LABEL = { image: 'Gambar', link: 'Link', note: 'Nota' };
const STATUS_LABEL = { pending: 'Menunggu', sending: 'Sedang dihantar', failed: 'Gagal' };

function itemRow(item, meta, metaClass) {
  const row = document.createElement('li');
  const body = document.createElement('div');
  body.className = 'item-body';
  const title = document.createElement('span');
  title.className = 'item-title';
  title.textContent = describe(item);
  const info = document.createElement('span');
  info.className = 'item-meta ' + (metaClass || '');
  info.textContent = meta;
  body.append(title, info);
  row.append(body);
  return row;
}

async function render() {
  const queued = await SimpanStore.listQueued();
  $('queue').replaceChildren(...queued.map((item) => {
    const status = STATUS_LABEL[item.status] || 'Menunggu';
    const meta = TYPE_LABEL[item.type] + ' · ' + status + (item.error ? ': ' + item.error : '');
    const row = itemRow(item, meta, item.status);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Buang';
    remove.setAttribute('aria-label', 'Buang ' + describe(item));
    remove.addEventListener('click', async () => {
      await SimpanStore.removeQueued(item.id);
      await render();
    });
    row.append(remove);
    return row;
  }));
  $('queue-empty').hidden = queued.length > 0;

  const sent = await SimpanStore.listSent();
  $('sent').replaceChildren(...sent.map((item) => {
    const row = itemRow(item, TYPE_LABEL[item.type] + ' · ' + new Date(item.createdAt).toLocaleString('ms-MY'));
    if (item.driveUrl && item.driveUrl.startsWith('https://')) {
      const link = document.createElement('a');
      link.href = item.driveUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Buka';
      row.append(link);
    }
    return row;
  }));
  $('sent-empty').hidden = sent.length > 0;
}

function handleShareResult() {
  const params = new URLSearchParams(location.search);
  if (params.has('share_error')) {
    notify('Item yang dikongsi tidak dapat dibaca.', true);
  } else if (params.has('shared')) {
    const count = Number(params.get('shared'));
    notify(count ? count + ' item diterima. Sedang dihantar...' : 'Tiada gambar atau link dalam item yang dikongsi.', !count);
  }
  if (location.search) history.replaceState(null, '', location.pathname);
}

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setCheck('check-sw', 'fail', 'Service worker: browser tak sokong');
    return;
  }
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    setCheck('check-sw', 'ok', 'Service worker: aktif');
  } catch (err) {
    setCheck('check-sw', 'fail', 'Service worker: gagal (' + err.message + ')');
  }
}

function setupInstall() {
  const installed = window.matchMedia('(display-mode: standalone)').matches;
  setCheck('check-installed', installed ? 'ok' : null,
    installed ? 'Dipasang sebagai app: ya' : 'Dipasang sebagai app: belum');

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    $('install').hidden = false;
  });
  $('install').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('install').hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    setCheck('check-installed', 'ok', 'Dipasang sebagai app: ya');
  });
}

function setupForms() {
  const settings = loadSettings();
  $('backend-url').value = settings.url || '';
  $('secret').value = settings.secret || '';

  $('settings').addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = $('backend-url').value.trim();
    const secret = $('secret').value.trim();
    if (!isAllowedBackend(url)) {
      notify('URL mesti bermula dengan https://script.google.com/', true);
      return;
    }
    saveSettings({ url, secret });
    notify('');
    if (await testBackend()) {
      notify('Tetapan disimpan dan sambungan berjaya.');
      await processQueue();
    } else {
      notify('Tetapan disimpan, tapi sambungan gagal.', true);
    }
  });

  $('picker').addEventListener('change', async (event) => {
    const now = new Date().toISOString();
    for (const file of event.target.files) {
      await SimpanStore.enqueue({
        id: crypto.randomUUID(),
        type: 'image',
        blob: file,
        title: file.name,
        url: '',
        text: '',
        createdAt: now,
        status: 'pending',
        error: ''
      });
    }
    event.target.value = '';
    await render();
    await processQueue();
  });

  $('send-now').addEventListener('click', processQueue);
  window.addEventListener('online', processQueue);
}

async function start() {
  handleShareResult();
  setupInstall();
  setupForms();
  await render();
  await setupServiceWorker();
  await testBackend();
  await processQueue();
}

start();
