import { isConfigured, loadLocalData, processQueue, recordsIn, refresh, render, setItemTitle, setRenderer, state } from './lib/data.js';
import { askText, h, icon, saveOpenSheets, toast } from './lib/dom.js';
import { openComposer } from './views/compose.js';
import { LIBRARY_VIEWS, hideAllInfo } from './views/library.js';
import { renderSearch } from './views/search.js';
import { renderTasks } from './views/tasks.js';
import { renderBoard } from './views/board.js';
import { renderClasses } from './views/classes.js';
import { renderWatch, updateWatch } from './views/watch.js';
import { setInstallPrompt, renderSettings, updateSettings } from './views/settings.js';
import { isLocked, isPinEnabled, lockNow, setLockHandlers, setupAutoLock } from './views/lock.js';
import { lockVault } from './views/classes.js';
import { renderArchive, renderTrash } from './views/archive.js';
import { openReceiptAdd, renderReceipts } from './views/receipts.js';
import { clearAiChat, openAi } from './views/ai.js';
import { greetingFor, userName } from './lib/profile.js';
import { askNameIfNeeded } from './views/profile.js';

const VIEWS = {
  ...LIBRARY_VIEWS,
  tasks: { title: 'Tugasan', icon: 'tasks', render: renderTasks },
  board: { title: 'Papan', icon: 'board', render: renderBoard },
  classes: { title: 'Kelas', icon: 'class', render: renderClasses },
  watch: { title: 'Tonton', icon: 'watch', render: renderWatch },
  receipts: { title: 'Resit', icon: 'receipt', render: renderReceipts },
  archive: { title: 'Arkib', icon: 'archive', render: renderArchive },
  trash: { title: 'Sampah', icon: 'trash', render: renderTrash },
  settings: { title: 'Tetapan', icon: 'settings', render: renderSettings }
};
const NAV_GROUPS = [
  { label: 'Simpanan', views: ['inbox', 'all', 'image', 'link', 'note', 'info', 'receipts'] },
  { label: 'Kerja', views: ['tasks', 'board'] },
  { label: 'Belajar', views: ['classes', 'watch'] },
  { label: 'Lain-lain', views: ['archive', 'trash', 'settings'] }
];
const TAB_VIEWS = ['inbox', 'note', 'image', 'link', 'watch'];
const PHONE_WIDTH = '(max-width: 760px)';
const startView = () => (window.matchMedia(PHONE_WIDTH).matches ? 'image' : 'inbox');

const $ = (id) => document.getElementById(id);

function countFor(key) {
  if (key === 'inbox') {
    const filter = LIBRARY_VIEWS.inbox.filter;
    return state.items.filter(filter).length + state.queue.filter((entry) => !entry.kind && filter(entry)).length;
  }
  if (key === 'tasks') return state.tables.Tugasan.filter((task) => task.siap !== 'ya').length;
  if (key === 'classes') return state.tables.Kelas.filter((kelas) => kelas.status === 'tengah').length;
  return 0;
}

function renderNav() {
  const link = (key, className) => {
    const view = VIEWS[key];
    const count = countFor(key);
    return h('a', {
      class: className,
      href: '#' + key,
      'data-tone': key,
      'aria-current': state.view === key ? 'page' : false
    },
    className === 'tab' ? [h('span', { class: 'tab-icon' }, icon(view.icon)), view.title] : [
      h('span', { class: 'nav-icon' }, icon(view.icon)),
      h('span', { class: 'nav-label' }, view.title),
      count ? h('span', { class: 'nav-count' + (key === 'inbox' ? ' signal' : '') }, String(count)) : null
    ]);
  };
  $('nav').replaceChildren(...NAV_GROUPS.flatMap((group) => [
    h('p', { class: 'nav-group' }, group.label),
    ...group.views.map((key) => link(key, 'nav-link'))
  ]));
  $('tabs').replaceChildren(...TAB_VIEWS.map((key) => link(key, 'tab')));
}

function syncStatus() {
  const waiting = state.queue.length;
  const failed = state.queue.filter((entry) => entry.status === 'failed').length;
  if (!isConfigured()) return h('a', { href: '#settings' }, 'Belum disambung ke Google');
  if (failed) return h('a', { href: '#settings' }, failed + ' perubahan gagal dihantar');
  if (state.syncError) return h('a', { href: '#settings' }, state.syncError);
  if (state.sending) return 'Menghantar ' + waiting + ' perubahan';
  if (waiting) return waiting + ' perubahan menunggu';
  if (state.refreshing) return 'Menyegerakkan';
  if (state.lastSync) {
    return 'Disegerakkan ' + state.lastSync.toLocaleTimeString('ms-MY', { hour: 'numeric', minute: '2-digit' });
  }
  return '';
}

function viewSummary(key) {
  const counted = (total, label) => (total ? total + ' ' + label : '');
  if (key === 'inbox') return countFor('inbox') ? countFor('inbox') + ' menunggu dilihat' : 'Semua sudah dilihat';
  if (key === 'tasks') return countFor('tasks') ? countFor('tasks') + ' belum siap' : 'Tiada yang tertunggak';
  if (key === 'board') return counted(state.tables.Kad.length, 'kad') || 'Susun kerja anda';
  if (key === 'classes') return counted(state.tables.Kelas.length, 'kelas') || 'Link, akaun dan password';
  if (key === 'watch') return 'YouTube, TikTok dan Facebook';
  if (key === 'receipts') return counted(state.tables.Resit.length, 'resit') || 'AI baca dan isikan data';
  if (key === 'settings') return 'Sambungan, AI dan kunci app';
  if (key === 'archive') return counted(recordsIn('arkib').length, 'rekod') || 'Simpan untuk rujukan';
  if (key === 'trash') return counted(recordsIn('sampah').length, 'rekod') || 'Boleh dipulihkan dalam 30 hari';
  const filter = LIBRARY_VIEWS[key] && LIBRARY_VIEWS[key].filter;
  return filter ? counted(state.items.filter(filter).length, 'item') : '';
}

let shownIcon = '';

function renderChrome() {
  renderNav();
  const searching = Boolean(state.query.trim());
  const tone = searching ? 'all' : state.view;
  const iconName = searching ? 'search' : VIEWS[state.view].icon;
  document.body.dataset.tone = tone;
  document.body.dataset.icon = iconName;
  if (shownIcon !== iconName) {
    shownIcon = iconName;
    // Elemen baru supaya animasi ikon berulang setiap kali bertukar halaman.
    $('view-icon').replaceWith(h('span', { id: 'view-icon', class: 'view-icon' }, icon(iconName)));
  }
  $('view-title').textContent = searching ? 'Carian' : VIEWS[state.view].title;
  $('view-sub').textContent = searching ? 'Merentas semua fungsi' : viewSummary(state.view);
  $('sync-status').replaceChildren(syncStatus());
  $('refresh').classList.toggle('spinning', state.refreshing || state.sending);
  $('lock-now').hidden = !isPinEnabled();

  const banner = $('banner');
  banner.hidden = !state.needsBackendUpdate;
  if (state.needsBackendUpdate) {
    banner.textContent = 'Backend Google masih versi lama, jadi arkib, sampah dan AI belum berfungsi. ' +
      'Tampal Code.gs dan appsscript.json baru dalam Apps Script, jalankan setup, kemudian Deploy → Manage deployments → Edit → New version.';
  }
}

let renderDeferred = false;

function isTyping() {
  const active = document.activeElement;
  // Medan kosong boleh dilukis semula tanpa kehilangan apa-apa; fokusnya dipulihkan selepas itu.
  return active && $('main').contains(active) && active.matches('input, textarea, select') && Boolean(active.value);
}

function drawMain() {
  const main = $('main');
  const searching = Boolean(state.query.trim());
  const view = searching ? renderSearch : VIEWS[state.view].render;
  main.classList.toggle('board-main', !searching && state.view === 'board');

  const scroller = main.querySelector('.board');
  const boardLeft = scroller ? scroller.scrollLeft : 0;
  const columnTops = [...main.querySelectorAll('.column-cards')].map((list) => list.scrollTop);
  const pageTop = window.scrollY;
  const focusKey = main.contains(document.activeElement) ? document.activeElement.dataset.keepFocus : null;

  // Sapaan hanya di halaman pembuka, supaya halaman lain kekal padat.
  const name = userName();
  const greeting = !searching && name && state.view === startView()
    ? h('p', { class: 'greeting' }, greetingFor(name, new Date().getHours()))
    : null;
  main.replaceChildren(...[greeting, view()].filter(Boolean));

  if (focusKey) main.querySelector(`[data-keep-focus="${CSS.escape(focusKey)}"]`)?.focus();

  const newScroller = main.querySelector('.board');
  if (newScroller) {
    newScroller.scrollLeft = boardLeft;
    main.querySelectorAll('.column-cards').forEach((list, index) => { list.scrollTop = columnTops[index] || 0; });
  }
  window.scrollTo(0, pageTop);
}

function renderMain() {
  // Jangan ganggu pengguna yang sedang menaip atau mengalih kad; lukis semula kemudian.
  if (state.dragging || isTyping()) {
    renderDeferred = true;
    return;
  }
  const searching = Boolean(state.query.trim());
  // Tonton dan Tetapan mengemas kini sebahagian sahaja supaya video dan borang tidak hilang.
  if (!searching && state.view === 'watch' && $('main').querySelector('.watch')) {
    updateWatch();
  } else if (!searching && state.view === 'settings' && $('main').querySelector('.settings')) {
    updateSettings();
  } else {
    drawMain();
  }
}

function renderAll() {
  renderChrome();
  renderMain();
}

function route() {
  const key = location.hash.slice(1);
  state.view = VIEWS[key] ? key : startView();
  hideAllInfo();
  closeMenu();
  document.querySelectorAll('dialog[open]:not(.lock)').forEach((dialog) => dialog.close());
  renderChrome();
  renderDeferred = false;
  $('main').replaceChildren();
  drawMain();
  window.scrollTo(0, 0);
  playEntrance();
}

let entranceTimer = null;

/** Item masuk berperingkat hanya bila bertukar halaman, bukan setiap kali data dikemas kini. */
function playEntrance() {
  const main = $('main');
  main.classList.remove('animate');
  void main.offsetWidth;
  main.classList.add('animate');
  clearTimeout(entranceTimer);
  entranceTimer = setTimeout(() => main.classList.remove('animate'), 700);
}

function openMenu() {
  $('sidebar').classList.add('open');
  $('scrim').hidden = false;
}

function closeMenu() {
  $('sidebar').classList.remove('open');
  $('scrim').hidden = true;
}

let sharedIds = [];

function handleShareResult() {
  const params = new URLSearchParams(location.search);
  if (params.has('share_error')) {
    toast('Item yang dikongsi tidak dapat dibaca', true);
  } else if (params.has('shared')) {
    const count = Number(params.get('shared'));
    sharedIds = String(params.get('ids') || '').split(',').filter(Boolean);
    if (!count) toast('Tiada gambar atau link dalam item yang dikongsi', true);
    else if (!sharedIds.length) toast(count === 1 ? 'Item diterima' : count + ' item diterima');
  }
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
}

/** Item yang dikongsi sudah selamat dalam barisan. Tajuk hanya ditanya selepas app dibuka kuncinya. */
async function askSharedTitle() {
  if (!sharedIds.length || isLocked()) return;
  const ids = sharedIds;
  sharedIds = [];
  const entries = await Promise.all(ids.map((id) => SimpanStore.getQueued(id)));
  // Nama fail seperti Screenshot_2026.png bukan tajuk yang berguna untuk dicadangkan.
  const existing = entries.map((entry) => (entry && entry.title) || '').find((title) => title && !/\.[a-z0-9]{2,5}$/i.test(title));
  const title = await askText({
    title: ids.length === 1 ? 'Item diterima. Beri tajuk?' : ids.length + ' item diterima. Beri tajuk?',
    label: 'Tajuk',
    value: existing || '',
    confirmLabel: 'Simpan',
    cancelLabel: 'Langkau'
  });
  if (title) await Promise.all(ids.map((id) => setItemTitle(id, title)));
}

async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    state.checks.worker = { state: 'fail', label: 'Browser ini tidak sokong service worker' };
    return;
  }
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    state.checks.worker = { state: 'ok', label: 'Service worker aktif' };
  } catch (err) {
    state.checks.worker = { state: 'fail', label: 'Service worker gagal (' + err.message + ')' };
  }
}

function setupInstall() {
  const markInstalled = () => {
    state.checks.installed = { state: 'ok', label: 'Dipasang sebagai app' };
    render();
  };
  if (window.matchMedia('(display-mode: standalone)').matches) markInstalled();
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    setInstallPrompt(event);
    render();
  });
  window.addEventListener('appinstalled', markInstalled);
}

// Gambar dan link yang ditampal atau diseret masuk melalui borang Tambah, supaya boleh diberi tajuk dahulu.
function composeImageFiles(files) {
  const images = [...files].filter((file) => file.type.startsWith('image/'));
  if (images.length) openComposer({ kind: 'image', files: images });
  return images.length;
}

function setupCapture() {
  document.addEventListener('paste', async (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (document.querySelector('dialog[open]')) return;
    if (event.clipboardData.files.length) {
      event.preventDefault();
      composeImageFiles(event.clipboardData.files);
      return;
    }
    const text = event.clipboardData.getData('text').trim();
    if (!text) return;
    event.preventDefault();
    openComposer({ text, kind: /^https?:\/\/\S+$/i.test(text) ? 'link' : '' });
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
    if (isLocked()) return;
    if (!composeImageFiles(event.dataTransfer.files)) toast('Hanya gambar boleh diseret masuk', true);
  });
}

async function start() {
  setRenderer(renderAll);
  // Kunci dahulu sebelum apa-apa data dilukis. Barisan hantar tetap berjalan di belakang skrin kunci,
  // supaya screenshot yang dikongsi terus sampai ke Google tanpa perlu memasukkan PIN.
  setLockHandlers({
    onLock: () => {
      lockVault();
      clearAiChat();
      hideAllInfo();
      render();
    },
    onChange: async () => {
      renderChrome();
      await askSharedTitle();
      askNameIfNeeded();
    }
  });
  lockNow();
  setupAutoLock();
  $('lock-now').addEventListener('click', lockNow);
  handleShareResult();
  setupInstall();
  setupCapture();

  $('ai-open').addEventListener('click', () => openAi());
  $('open-menu').addEventListener('click', openMenu);
  $('close-menu').addEventListener('click', closeMenu);
  $('scrim').addEventListener('click', closeMenu);
  $('add').addEventListener('click', () => {
    if (state.view === 'receipts') openReceiptAdd();
    else openComposer({ ruang: state.view === 'info' ? 'info' : '', kind: ['note', 'link', 'image'].includes(state.view) ? state.view : '' });
  });
  $('refresh').addEventListener('click', async () => {
    await processQueue();
    await refresh();
  });
  $('search').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderChrome();
    $('main').classList.remove('board-main');
    $('main').replaceChildren();
    drawMain();
  });
  // Lukisan yang ditangguhkan semasa menaip dibuat sebaik fokus keluar dari medan.
  $('main').addEventListener('focusout', () => {
    setTimeout(() => {
      if (renderDeferred && !isTyping() && !state.dragging) {
        renderDeferred = false;
        renderMain();
      }
    }, 0);
  });
  // Menghalang skrol ketika kad sedang dialih di skrin sentuh.
  document.addEventListener('touchmove', (event) => {
    if (state.dragging) event.preventDefault();
  }, { passive: false });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => {
    state.syncError = '';
    processQueue();
    refresh();
  });
  document.addEventListener('visibilitychange', () => {
    // Isi Info Penting disorok semula sebaik app ditinggalkan.
    if (document.visibilityState === 'hidden') {
      saveOpenSheets();
      hideAllInfo();
      render();
    }
    if (document.visibilityState === 'visible') {
      processQueue();
      refresh();
    }
  });

  // Paparkan salinan dalam peranti dahulu supaya app terus terbuka walaupun Google perlahan.
  await loadLocalData();
  route();
  askSharedTitle();

  await setupServiceWorker();
  render();
  await refresh();
  // Selepas segerak, supaya nama yang sudah ada dari peranti lain tidak ditanya semula.
  askNameIfNeeded();
  await processQueue();
}

start();
