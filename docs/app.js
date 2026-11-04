const MAX_IMAGE_EDGE = 2000;
const IMAGE_QUALITY = 0.8;
const KEEP_AS_IS = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SETTINGS_KEY = 'simpanidea.settings';
const IMAGE_CONCURRENCY = 3;

const VIEWS = {
  inbox: { title: 'Inbox', icon: 'inbox', filter: (item) => item.status !== 'dilihat' },
  all: { title: 'Semua', icon: 'all', filter: () => true },
  image: { title: 'Screenshot', icon: 'image', filter: (item) => item.type === 'image' },
  link: { title: 'Link', icon: 'link', filter: (item) => item.type === 'link' },
  note: { title: 'Nota', icon: 'note', filter: (item) => item.type === 'note' },
  classes: { title: 'Kelas', icon: 'class' },
  settings: { title: 'Tetapan', icon: 'settings' }
};
const TYPE_LABEL = { image: 'Screenshot', link: 'Link', note: 'Nota' };
const TYPE_ICON = { image: 'image', link: 'link', note: 'note' };
const EMPTY_TEXT = {
  inbox: ['Inbox kau bersih', 'Tekan Share → SimpanIdea kat phone, atau tampal dengan Ctrl+V di sini.'],
  all: ['Belum ada apa-apa', 'Screenshot, link dan nota yang kau simpan akan muncul di sini.'],
  image: ['Belum ada screenshot', 'Screenshot yang dikongsi dari phone akan muncul di sini.'],
  link: ['Belum ada link', 'Kongsi link dari Chrome atau YouTube, atau tekan Tambah.'],
  note: ['Belum ada nota', 'Tekan Tambah untuk tulis idea kau.']
};

const $ = (id) => document.getElementById(id);
const state = {
  view: 'inbox',
  query: '',
  items: [],
  queue: [],
  sending: false,
  refreshing: false,
  lastSync: null,
  syncError: '',
  needsBackendUpdate: false,
  checks: { worker: null, installed: null, backend: null }
};
let installPrompt = null;
let toastTimer = null;

/* Pembantu DOM. Semua teks melalui textContent supaya kandungan dikongsi tidak jadi HTML. */
function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') element.className = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) element.setAttribute(key, value === true ? '' : value);
  }
  element.append(...children.filter((child) => child != null && child !== false));
  return element;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

function toast(message, isError = false) {
  const element = $('toast');
  element.textContent = message;
  element.classList.toggle('error', isError);
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, isError ? 6000 : 3500);
}

/* Tetapan */
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

const isConfigured = () => {
  const { url, secret } = loadSettings();
  return Boolean(url && secret);
};

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

/* Backend */
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

async function refreshItems() {
  if (!isConfigured() || state.refreshing) return;
  state.refreshing = true;
  renderChrome();
  try {
    const result = await callBackend({ action: 'listItems' });
    if (result.ok) {
      state.items = result.items;
      state.lastSync = new Date();
      state.syncError = '';
      state.needsBackendUpdate = false;
      state.checks.backend = { state: 'ok', label: 'Sambungan ke Google: berjaya' };
      await SimpanStore.replaceItems(result.items);
    } else if (result.code === 'bad_request') {
      // Web App masih versi lama yang cuma tahu menyimpan.
      state.needsBackendUpdate = true;
      state.syncError = 'Backend perlu dikemas kini';
      state.checks.backend = { state: 'fail', label: 'Sambungan ke Google: backend versi lama' };
    } else {
      state.syncError = result.error;
      state.checks.backend = { state: 'fail', label: 'Sambungan ke Google: ' + result.error };
    }
  } catch (err) {
    state.syncError = 'Tak dapat sampai ke Google';
    state.checks.backend = { state: 'fail', label: 'Sambungan ke Google: gagal (' + err.message + ')' };
  } finally {
    state.refreshing = false;
    render();
  }
}

/* Gambar */
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

function fromBase64(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

const imageUrls = new Map();
const imageWaiting = [];
const imagePromises = new Map();
let imagesLoading = 0;

function pumpImages() {
  while (imagesLoading < IMAGE_CONCURRENCY && imageWaiting.length) {
    const job = imageWaiting.shift();
    imagesLoading += 1;
    job().finally(() => {
      imagesLoading -= 1;
      pumpImages();
    });
  }
}

// Gambar disimpan dalam peranti selepas dimuat, jadi Drive hanya dipanggil sekali.
function imageUrlFor(id) {
  if (imageUrls.has(id)) return Promise.resolve(imageUrls.get(id));
  if (imagePromises.has(id)) return imagePromises.get(id);
  const promise = (async () => {
    let blob = await SimpanStore.getImage(id);
    if (!blob) {
      blob = await new Promise((resolve, reject) => {
        imageWaiting.push(async () => {
          try {
            const result = await callBackend({ action: 'getImage', id });
            if (!result.ok) throw new Error(result.error);
            resolve(fromBase64(result.dataBase64, result.mimeType));
          } catch (err) {
            reject(err);
          }
        });
        pumpImages();
      });
      await SimpanStore.putImage(id, blob);
    }
    const url = URL.createObjectURL(blob);
    imageUrls.set(id, url);
    return url;
  })();
  imagePromises.set(id, promise);
  promise.catch(() => {}).finally(() => imagePromises.delete(id));
  return promise;
}

const imageObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    imageObserver.unobserve(entry.target);
    fillImage(entry.target);
  }
}, { rootMargin: '300px' });

async function fillImage(holder) {
  try {
    const url = await imageUrlFor(holder.dataset.id);
    holder.classList.remove('placeholder');
    holder.replaceChildren(h('img', { src: url, alt: '' }));
  } catch {
    // Kekalkan ikon kalau gambar gagal dimuat; kad masih boleh dibuka.
  }
}

/* Barisan hantar */
async function toPayload(item) {
  const payload = { id: item.id, type: item.type, title: item.title, url: item.url, text: item.text };
  let image = null;
  if (item.type === 'image') {
    image = await compressImage(item.blob);
    payload.mimeType = image.type;
    payload.dataBase64 = await toBase64(image);
  }
  return { payload, image };
}

async function loadQueue() {
  state.queue = await SimpanStore.listQueued();
}

async function processQueue() {
  if (state.sending || !isConfigured()) return;
  await loadQueue();
  if (!state.queue.length) return;
  state.sending = true;
  let sentCount = 0;
  try {
    for (const item of [...state.queue]) {
      await SimpanStore.enqueue({ ...item, status: 'sending', error: '' });
      await loadQueue();
      render();
      try {
        const { payload, image } = await toPayload(item);
        const result = await callBackend({ action: 'saveItem', item: payload });
        if (result.ok) {
          if (image) await SimpanStore.putImage(item.id, image);
          await SimpanStore.removeQueued(item.id);
          sentCount += 1;
        } else {
          await SimpanStore.enqueue({ ...item, status: 'failed', error: result.error });
          if (result.code === 'unauthorized' || result.code === 'not_setup') break;
        }
      } catch (err) {
        // TypeError bermakna fetch gagal: internet terputus, atau Web App bukan "Anyone".
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
    state.sending = false;
    await loadQueue();
    render();
  }
  if (sentCount) {
    toast(sentCount === 1 ? 'Disimpan ke Google' : sentCount + ' item disimpan ke Google');
    await refreshItems();
  }
}

async function addToQueue(items) {
  await Promise.all(items.map((item) => SimpanStore.enqueue(item)));
  await loadQueue();
  render();
  if (!isConfigured()) toast('Disimpan dalam peranti. Lengkapkan Tetapan untuk hantar ke Google.');
  processQueue();
}

function newItem(fields) {
  return {
    id: crypto.randomUUID(),
    title: '',
    url: '',
    text: '',
    createdAt: new Date().toISOString(),
    status: 'pending',
    error: '',
    ...fields
  };
}

function itemFromText(raw) {
  const text = raw.trim();
  if (!text) return null;
  const match = text.match(/https?:\/\/\S+/i);
  if (match) return newItem({ type: 'link', url: match[0], text: text === match[0] ? '' : text });
  return newItem({ type: 'note', text });
}

const itemsFromFiles = (files) => [...files]
  .filter((file) => file.type.startsWith('image/'))
  .map((file) => newItem({ type: 'image', blob: file, title: file.name }));

/* Paparan */
function displayTitle(item) {
  if (item.title) return item.type === 'image' ? item.title.replace(/\.[a-z0-9]{2,5}$/i, '') : item.title;
  if (item.type === 'link') return domainOf(item.url) || item.url;
  if (item.type === 'note') return item.text.split('\n')[0];
  return 'Screenshot';
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const isWebUrl = (value) => /^https?:\/\//i.test(value || '');

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString('ms-MY', { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return 'Hari ini, ' + time;
  if (date.toDateString() === yesterday.toDateString()) return 'Semalam, ' + time;
  return date.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

function matchesQuery(item) {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  return [item.title, item.url, item.text].some((field) => (field || '').toLowerCase().includes(query));
}

const newestFirst = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));

function mediaFor(item, isQueued) {
  if (item.type === 'image') {
    const holder = h('span', { class: 'card-media placeholder', 'data-id': item.id }, icon('image'));
    if (isQueued) {
      holder.classList.remove('placeholder');
      holder.replaceChildren(h('img', { src: queuedImageUrl(item), alt: '' }));
    } else {
      imageObserver.observe(holder);
    }
    return holder;
  }
  if (item.type === 'link') {
    const domain = domainOf(item.url);
    return h('span', { class: 'card-media link-tile' },
      h('span', { class: 'link-letter' }, (domain[0] || '#').toUpperCase()),
      h('span', { class: 'link-domain' }, domain || item.url));
  }
  return h('span', { class: 'card-media note-tile' }, item.text || item.title);
}

function queuedImageUrl(item) {
  if (!imageUrls.has(item.id)) imageUrls.set(item.id, URL.createObjectURL(item.blob));
  return imageUrls.get(item.id);
}

function cardBody(item, showNewDot) {
  const repeatsNote = item.type === 'note' && !item.title;
  return h('span', { class: 'card-body' },
    !repeatsNote && h('span', { class: 'card-title' }, displayTitle(item)),
    h('span', { class: 'card-meta' },
      icon(TYPE_ICON[item.type] || 'note'),
      h('span', {}, formatDate(item.createdAt)),
      showNewDot && h('span', { class: 'new-dot', title: 'Belum dilihat' })));
}

function itemCard(item) {
  return h('article', { class: 'card' },
    h('button', {
      class: 'card-open',
      type: 'button',
      'aria-label': 'Buka ' + displayTitle(item),
      onclick: () => openDetail(item.id)
    }, mediaFor(item, false), cardBody(item, state.view !== 'inbox' && item.status !== 'dilihat')));
}

function queueCard(item) {
  const failed = item.status === 'failed';
  const label = { sending: 'Sedang dihantar', failed: 'Gagal: ' + item.error }[item.status] ||
    item.error || 'Menunggu dihantar';
  return h('article', { class: 'card' },
    mediaFor(item, true),
    cardBody(item, false),
    h('div', { class: 'queue-state' },
      h('span', { class: 'queue-text' + (failed ? ' failed' : '') }, label),
      item.status !== 'sending' && h('button', {
        class: 'ghost-button small', type: 'button', onclick: processQueue
      }, 'Cuba lagi'),
      item.status !== 'sending' && h('button', {
        class: 'danger-button small',
        type: 'button',
        'aria-label': 'Buang ' + displayTitle(item),
        onclick: async () => {
          await SimpanStore.removeQueued(item.id);
          await loadQueue();
          render();
        }
      }, 'Buang')));
}

function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty' },
    h('span', { class: 'empty-icon' }, icon(iconName)),
    h('h2', {}, title),
    h('p', {}, text),
    action);
}

function renderGrid() {
  const view = VIEWS[state.view];
  const queued = state.queue.filter(view.filter).filter(matchesQuery);
  const items = state.items.filter(view.filter).filter(matchesQuery).sort(newestFirst);

  if (!queued.length && !items.length) {
    if (state.query.trim()) {
      return emptyState('search', 'Tiada hasil', 'Tiada item sepadan dengan "' + state.query.trim() + '".');
    }
    if (!isConfigured()) {
      return emptyState('settings', 'Sambungkan ke Google dulu',
        'Masukkan URL Web App dan kunci rahsia supaya data kau boleh disimpan.',
        h('a', { class: 'primary-button', href: '#settings' }, 'Buka Tetapan'));
    }
    const [title, text] = EMPTY_TEXT[state.view];
    return emptyState(view.icon, title, text);
  }
  return h('div', { class: 'grid' }, ...queued.map(queueCard), ...items.map(itemCard));
}

function renderClasses() {
  return emptyState('class', 'Halaman Kelas belum dibina',
    'Link, password dan status kelas online akan ada di sini selepas ujian Share di phone lepas.');
}

function checkRow(key, fallback) {
  const check = state.checks[key];
  return h('li', { class: 'check ' + (check ? check.state : ''), id: 'check-' + key }, check ? check.label : fallback);
}

function renderChecks() {
  const list = $('checks');
  if (!list) return;
  list.replaceChildren(
    checkRow('worker', 'Service worker: menyemak'),
    checkRow('installed', 'Dipasang sebagai app: belum'),
    checkRow('backend', 'Sambungan ke Google: belum diisi'));
  const install = $('install');
  if (install) install.hidden = !installPrompt;
}

function renderSettings() {
  const settings = loadSettings();
  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const url = form.elements.url.value.trim();
      const secret = form.elements.secret.value.trim();
      if (!isAllowedBackend(url)) {
        toast('URL mesti bermula dengan https://script.google.com/', true);
        return;
      }
      saveSettings({ url, secret });
      state.checks.backend = { state: '', label: 'Sambungan ke Google: sedang diuji' };
      renderChecks();
      await refreshItems();
      renderChecks();
      if (state.checks.backend.state === 'ok') {
        toast('Sambungan berjaya');
        processQueue();
      } else {
        toast('Tetapan disimpan, tapi sambungan gagal', true);
      }
    }
  },
    h('label', { class: 'field-label', for: 'backend-url' }, 'URL Web App'),
    h('input', {
      id: 'backend-url', name: 'url', type: 'url', inputmode: 'url', autocomplete: 'off',
      spellcheck: 'false', required: true, placeholder: 'https://script.google.com/macros/s/.../exec',
      value: settings.url || ''
    }),
    h('label', { class: 'field-label', for: 'secret' }, 'Kunci rahsia'),
    h('input', {
      id: 'secret', name: 'secret', type: 'password', autocomplete: 'off',
      spellcheck: 'false', required: true, value: settings.secret || ''
    }),
    h('button', { class: 'primary-button', type: 'submit' }, 'Simpan dan uji'));

  const page = h('div', { class: 'settings' },
    h('section', { class: 'settings-card' }, h('h2', {}, 'Sambungan Google'), form),
    h('section', { class: 'settings-card' },
      h('h2', {}, 'Semakan'),
      h('ul', { class: 'checks', id: 'checks' }),
      h('button', {
        class: 'primary-button',
        id: 'install',
        type: 'button',
        hidden: !installPrompt,
        onclick: async () => {
          if (!installPrompt) return;
          installPrompt.prompt();
          await installPrompt.userChoice;
          installPrompt = null;
          renderChecks();
        }
      }, 'Pasang app')));
  return page;
}

function renderNav() {
  const count = (filter) => state.items.filter(filter).length + state.queue.filter(filter).length;
  const link = (key, extra) => {
    const view = VIEWS[key];
    return h('a', {
      class: 'nav-link',
      href: '#' + key,
      'data-view': key,
      'aria-current': state.view === key ? 'page' : false
    }, icon(view.icon), h('span', { class: 'nav-label' }, view.title), extra);
  };
  const countBadge = (key, highlight) => {
    const total = count(VIEWS[key].filter);
    if (!total) return null;
    return h('span', { class: 'nav-count' + (highlight ? ' has-new' : '') }, String(total));
  };
  $('nav').replaceChildren(
    link('inbox', countBadge('inbox', true)),
    link('all', countBadge('all')),
    h('p', { class: 'nav-section' }, 'Jenis'),
    link('image', countBadge('image')),
    link('link', countBadge('link')),
    link('note', countBadge('note')),
    h('p', { class: 'nav-section' }, 'Belajar'),
    link('classes', h('span', { class: 'nav-tag' }, 'Akan datang')));

  document.querySelector('.side-footer .nav-link')
    .setAttribute('aria-current', state.view === 'settings' ? 'page' : 'false');
}

function syncText() {
  if (!isConfigured()) return 'Belum disambung ke Google';
  if (state.syncError) return state.syncError;
  if (state.sending) return 'Menghantar ' + state.queue.length + ' item...';
  if (state.refreshing) return 'Mengemas kini...';
  if (state.queue.length) return state.queue.length + ' item menunggu';
  if (state.lastSync) {
    return 'Dikemas kini ' + state.lastSync.toLocaleTimeString('ms-MY', { hour: 'numeric', minute: '2-digit' });
  }
  return '';
}

function renderChrome() {
  renderNav();
  $('view-title').textContent = VIEWS[state.view].title;
  const status = $('sync-status');
  status.textContent = syncText();
  status.classList.toggle('bad', Boolean(state.syncError));
  $('refresh').classList.toggle('spinning', state.refreshing || state.sending);

  const banner = $('banner');
  banner.hidden = !state.needsBackendUpdate;
  if (state.needsBackendUpdate) {
    banner.textContent = 'Backend Google masih versi lama, jadi senarai item tak dapat dimuat. ' +
      'Tampal Code.gs baru dalam Apps Script, kemudian Deploy → Manage deployments → Edit → New version.';
  }
}

function renderMain() {
  // Halaman Tetapan tidak dilukis semula di sini supaya apa yang sedang ditaip tidak hilang.
  if (state.view === 'settings') {
    renderChecks();
    return;
  }
  const main = $('main');
  const scroll = window.scrollY;
  main.replaceChildren(state.view === 'classes' ? renderClasses() : renderGrid());
  window.scrollTo(0, scroll);
}

function render() {
  renderChrome();
  renderMain();
}

function route() {
  const key = location.hash.slice(1);
  state.view = VIEWS[key] ? key : 'inbox';
  closeMenu();
  renderChrome();
  if (state.view === 'settings') {
    $('main').replaceChildren(renderSettings());
    renderChecks();
  } else {
    renderMain();
  }
  window.scrollTo(0, 0);
}

/* Panel butiran */
function openDetail(id) {
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item) return;
  const panel = $('detail');
  const isNew = item.status !== 'dilihat';

  const actions = [
    h('button', {
      class: 'primary-button',
      type: 'button',
      onclick: () => setItemStatus(item, isNew ? 'dilihat' : 'baru')
    }, icon(isNew ? 'check' : 'undo'), isNew ? 'Tanda dah tengok' : 'Pulangkan ke Inbox')
  ];
  if (isWebUrl(item.url)) {
    actions.push(
      h('a', { class: 'ghost-button', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, icon('open'), 'Buka link'),
      h('button', {
        class: 'ghost-button',
        type: 'button',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(item.url);
            toast('Link disalin');
          } catch {
            toast('Tak dapat salin link', true);
          }
        }
      }, icon('copy'), 'Salin'));
  }
  if (isWebUrl(item.driveUrl)) {
    actions.push(h('a', { class: 'ghost-button', href: item.driveUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('open'), 'Buka di Drive'));
  }

  let imageArea = null;
  if (item.type === 'image') {
    imageArea = h('div', { class: 'panel-image-empty' }, icon('image'));
    imageUrlFor(item.id)
      .then((url) => imageArea.replaceWith(h('img', { class: 'panel-image', src: url, alt: displayTitle(item) })))
      .catch(() => { imageArea.textContent = 'Gambar tak dapat dimuat.'; });
  }
  const noteRepeatsTitle = item.type === 'note' && !item.title;

  panel.replaceChildren(
    h('div', { class: 'panel-head' },
      h('span', { class: 'panel-kind' }, icon(TYPE_ICON[item.type] || 'note'), TYPE_LABEL[item.type] || 'Item'),
      h('button', { class: 'icon-button', type: 'button', 'aria-label': 'Tutup', onclick: () => panel.close() }, icon('close'))),
    h('div', { class: 'panel-body' },
      imageArea,
      h('h2', { class: 'panel-title', id: 'detail-title' }, displayTitle(item)),
      h('p', { class: 'panel-date' }, formatDate(item.createdAt)),
      isWebUrl(item.url) && h('a', { class: 'panel-url', href: item.url, target: '_blank', rel: 'noopener noreferrer' }, item.url),
      item.text && !(noteRepeatsTitle && !item.text.includes('\n')) && h('p', { class: 'panel-note' }, item.text)),
    h('div', { class: 'panel-actions' }, ...actions));
  if (!panel.open) panel.showModal();
}

async function setItemStatus(item, status) {
  const previous = item.status;
  item.status = status;
  $('detail').close();
  render();
  toast(status === 'dilihat' ? 'Dialih keluar dari Inbox' : 'Dipulangkan ke Inbox');
  try {
    const result = await callBackend({ action: 'setStatus', id: item.id, status });
    if (!result.ok) throw new Error(result.error);
    await SimpanStore.putItem(item);
  } catch (err) {
    item.status = previous;
    render();
    toast('Tak dapat kemas kini: ' + err.message, true);
  }
}

/* Menu telefon */
function openMenu() {
  $('sidebar').classList.add('open');
  $('scrim').hidden = false;
}

function closeMenu() {
  $('sidebar').classList.remove('open');
  $('scrim').hidden = true;
}

/* Persediaan */
function handleShareResult() {
  const params = new URLSearchParams(location.search);
  if (params.has('share_error')) {
    toast('Item yang dikongsi tidak dapat dibaca', true);
  } else if (params.has('shared')) {
    const count = Number(params.get('shared'));
    if (count) toast(count === 1 ? 'Item diterima' : count + ' item diterima');
    else toast('Tiada gambar atau link dalam item yang dikongsi', true);
  }
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
}

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    state.checks.worker = { state: 'fail', label: 'Service worker: browser tak sokong' };
    return;
  }
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    state.checks.worker = { state: 'ok', label: 'Service worker: aktif' };
  } catch (err) {
    state.checks.worker = { state: 'fail', label: 'Service worker: gagal (' + err.message + ')' };
  }
}

function setupInstall() {
  const markInstalled = () => {
    state.checks.installed = { state: 'ok', label: 'Dipasang sebagai app: ya' };
    renderChecks();
  };
  if (window.matchMedia('(display-mode: standalone)').matches) markInstalled();
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    renderChecks();
  });
  window.addEventListener('appinstalled', markInstalled);
}

function setupComposer() {
  const composer = $('composer');
  const open = (text = '') => {
    $('composer-text').value = text;
    composer.showModal();
    $('composer-text').focus();
  };
  $('add-side').addEventListener('click', () => { closeMenu(); open(); });
  $('add-top').addEventListener('click', () => open());
  composer.querySelector('[data-close]').addEventListener('click', () => composer.close());

  $('composer-form').addEventListener('submit', (event) => {
    const item = itemFromText($('composer-text').value);
    if (!item) {
      event.preventDefault();
      toast('Tulis sesuatu atau pilih gambar dulu', true);
      return;
    }
    addToQueue([item]);
  });
  $('picker').addEventListener('change', (event) => {
    const items = itemsFromFiles(event.target.files);
    event.target.value = '';
    composer.close();
    if (items.length) addToQueue(items);
  });

  for (const dialog of [composer, $('detail')]) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
  return open;
}

function setupCapture(openComposer) {
  document.addEventListener('paste', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    const images = itemsFromFiles(event.clipboardData.files);
    if (images.length) {
      event.preventDefault();
      addToQueue(images);
      return;
    }
    const text = event.clipboardData.getData('text').trim();
    if (!text) return;
    event.preventDefault();
    if (/^https?:\/\/\S+$/i.test(text)) addToQueue([itemFromText(text)]);
    else openComposer(text);
  });

  const hasFiles = (event) => event.dataTransfer && [...event.dataTransfer.types].includes('Files');
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    $('drop-overlay').hidden = false;
  });
  window.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) $('drop-overlay').hidden = true;
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    $('drop-overlay').hidden = true;
    const items = itemsFromFiles(event.dataTransfer.files);
    if (items.length) addToQueue(items);
    else toast('Hanya gambar boleh diseret masuk', true);
  });
}

async function start() {
  handleShareResult();
  setupInstall();
  setupCapture(setupComposer());

  $('open-menu').addEventListener('click', openMenu);
  $('close-menu').addEventListener('click', closeMenu);
  $('scrim').addEventListener('click', closeMenu);
  $('refresh').addEventListener('click', async () => {
    await processQueue();
    await refreshItems();
  });
  $('search').addEventListener('input', (event) => {
    state.query = event.target.value;
    if (state.view === 'settings' || state.view === 'classes') location.hash = 'all';
    else renderMain();
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => {
    state.syncError = '';
    processQueue();
    refreshItems();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      processQueue();
      refreshItems();
    }
  });

  // Paparkan salinan dalam peranti dulu supaya app terus terbuka walaupun Google perlahan.
  state.items = await SimpanStore.listItems();
  await loadQueue();
  route();

  await setupServiceWorker();
  renderChecks();
  await refreshItems();
  await processQueue();
}

start();
