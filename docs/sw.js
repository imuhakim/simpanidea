importScripts('store.js');

const CACHE_NAME = 'simpanidea-v5';
const APP_FILES = [
  './', 'index.html', 'app.js', 'store.js', 'style.css',
  'lib/data.js', 'lib/dom.js', 'lib/images.js', 'lib/pin.js', 'lib/vault.js', 'lib/video.js',
  'views/board.js', 'views/classes.js', 'views/compose.js', 'views/library.js', 'views/lock.js',
  'views/search.js', 'views/settings.js', 'views/tasks.js', 'views/watch.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png'
];
const scopeUrl = (path) => new URL(path, self.registration.scope);
const SHARE_PATH = scopeUrl('share').pathname;
const APP_PATHS = new Set(APP_FILES.map((file) => scopeUrl(file).pathname));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.method === 'POST' && url.pathname === SHARE_PATH) {
    event.respondWith(receiveShare(event.request));
  } else if (event.request.method === 'GET' && APP_PATHS.has(url.pathname)) {
    event.respondWith(networkThenCache(event.request, url.pathname));
  }
});

// Disimpan ikut laluan sahaja, jadi ?shared=1 dan seumpamanya tidak menambah salinan.
async function networkThenCache(request, cacheKey) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(cacheKey, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw err;
  }
}

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const items = itemsFromForm(form);
    await Promise.all(items.map((item) => SimpanStore.enqueue(item)));
    return Response.redirect(scopeUrl('./?shared=' + items.length).href, 303);
  } catch (err) {
    return Response.redirect(scopeUrl('./?share_error=1').href, 303);
  }
}

function itemsFromForm(form) {
  const title = String(form.get('title') || '').trim();
  const text = String(form.get('text') || '').trim();
  const sharedUrl = String(form.get('url') || '').trim();
  const url = sharedUrl || firstUrlIn(text);
  const createdAt = new Date().toISOString();
  const base = { createdAt, status: 'pending', error: '', ruang: '', gambar: '' };

  const images = form.getAll('file')
    .filter((file) => file instanceof File && file.size > 0 && file.type.startsWith('image/'));

  if (images.length) {
    return images.map((file) => ({
      ...base,
      id: crypto.randomUUID(),
      type: 'image',
      blob: file,
      title: title || file.name || '',
      url,
      text
    }));
  }
  if (url) {
    // Banyak app Android letak link dalam "text", kadangkala bersama ayat lain.
    const note = text === url ? '' : text;
    return [{ ...base, id: crypto.randomUUID(), type: 'link', title, url, text: note }];
  }
  if (text || title) {
    return [{ ...base, id: crypto.randomUUID(), type: 'note', title, url: '', text }];
  }
  return [];
}

function firstUrlIn(text) {
  const match = text.match(/https?:\/\/\S+/i);
  return match ? match[0] : '';
}
