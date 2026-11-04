// Tonton: video YouTube, TikTok dan Facebook yang disimpan dimainkan terus dalam app.
import { addItems, callBackend, itemFromText, isConfigured, patchItem, state } from '../lib/data.js';
import { domainOf, emptyState, formatDate, h, icon, toast } from '../lib/dom.js';
import { parseVideo, PLATFORM_LABEL } from '../lib/video.js';

const RESOLVED_KEY = 'simpanidea.resolved';
let platformFilter = 'semua';
let currentId = null;
let stage = null;
let list = null;

function resolvedCache() {
  try {
    return JSON.parse(localStorage.getItem(RESOLVED_KEY)) || {};
  } catch {
    return {};
  }
}

function remember(shortUrl, fullUrl) {
  try {
    localStorage.setItem(RESOLVED_KEY, JSON.stringify({ ...resolvedCache(), [shortUrl]: fullUrl }));
  } catch {
    // Tanpa cache, link pendek cuma diselesaikan semula lain kali.
  }
}

function videoEntries() {
  const queued = state.queue.filter((entry) => !entry.kind && entry.type === 'link');
  const seen = new Set(state.items.map((item) => item.id));
  return [...state.items.filter((item) => item.ruang !== 'lampiran'), ...queued.filter((entry) => !seen.has(entry.id))]
    .filter((entry) => entry.type === 'link')
    .map((entry) => ({ entry, video: parseVideo(entry.url) }))
    .filter(({ video }) => video)
    .sort((a, b) => String(b.entry.createdAt).localeCompare(String(a.entry.createdAt)));
}

function titleOf(entry) {
  if (entry.title) return entry.title;
  const video = parseVideo(entry.url);
  return video ? 'Video ' + PLATFORM_LABEL[video.platform] : domainOf(entry.url) || entry.url;
}

/** Dapatkan pemain untuk video, menyelesaikan link pendek melalui backend kalau perlu. */
async function playerFor(entry, video) {
  if (!video.needsResolve) return video;
  const cached = resolvedCache()[entry.url];
  if (cached) {
    const known = parseVideo(cached);
    if (known && known.embedUrl) return known;
  }
  try {
    const result = await callBackend({ action: 'resolveUrl', url: entry.url });
    const full = result.ok ? parseVideo(result.url) : null;
    if (full && full.embedUrl) {
      remember(entry.url, result.url);
      return full;
    }
  } catch {
    // Teruskan ke pilihan terakhir di bawah.
  }
  return video.fallback || null;
}

function drawStage(entry, video, player, loading) {
  if (!stage) return;
  const openLabel = 'Buka di ' + PLATFORM_LABEL[video.platform];
  const openLink = h('a', { class: 'button', href: entry.url, target: '_blank', rel: 'noopener noreferrer' }, icon('open'), openLabel);
  let screen;
  if (loading) {
    screen = h('div', { class: 'stage-screen' }, 'Memuatkan video');
  } else if (player) {
    screen = h('div', { class: 'stage-screen' + (player.vertical ? ' vertical' : '') },
      h('iframe', {
        src: player.embedUrl,
        title: titleOf(entry),
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
        sandbox: 'allow-scripts allow-same-origin allow-popups allow-presentation'
      }));
  } else {
    screen = h('div', { class: 'stage-screen' }, 'Video ini tak dapat dimainkan di sini. Buka dalam app asal.');
  }
  stage.replaceChildren(screen,
    h('div', { class: 'stage-info' },
      h('h2', { class: 'stage-title' }, titleOf(entry)),
      openLink,
      !loading && h('p', { class: 'stage-hint' }, 'Kalau video tak keluar, pemiliknya mungkin menghalang tontonan di luar ' + PLATFORM_LABEL[video.platform] + '.')));
}

async function play(entry, video) {
  currentId = entry.id;
  drawStage(entry, video, null, true);
  drawList();
  if (stage) window.scrollTo({ top: 0 });
  const player = await playerFor(entry, video);
  if (currentId !== entry.id) return;
  drawStage(entry, video, player, false);
  const saved = state.items.find((item) => item.id === entry.id);
  if (saved && saved.status !== 'dilihat') patchItem(entry.id, { status: 'dilihat' });
}

function videoRow({ entry, video }) {
  const unwatched = entry.status !== 'dilihat';
  return h('article', { class: 'row' + (entry.id === currentId ? ' playing' : '') },
    h('button', {
      class: 'row-main',
      type: 'button',
      'aria-label': 'Tonton ' + titleOf(entry),
      onclick: () => play(entry, video)
    },
    h('span', { class: 'video-thumb ' + video.platform },
      PLATFORM_LABEL[video.platform],
      video.thumbnail && h('img', { src: video.thumbnail, alt: '', loading: 'lazy', onerror: (event) => event.target.remove() }),
      h('span', { class: 'video-play' }, icon('play'))),
    h('span', { class: 'row-text' },
      h('span', { class: 'row-title' }, titleOf(entry)),
      h('span', { class: 'row-sub' }, PLATFORM_LABEL[video.platform] + ' · ' + formatDate(entry.createdAt))),
    unwatched && h('span', { class: 'unread', title: 'Belum ditonton' })));
}

function drawList() {
  if (!list) return;
  const all = videoEntries();
  const counts = { semua: all.length };
  for (const { video } of all) counts[video.platform] = (counts[video.platform] || 0) + 1;
  const shown = platformFilter === 'semua' ? all : all.filter(({ video }) => video.platform === platformFilter);
  const tabs = ['semua', 'youtube', 'tiktok', 'facebook'].filter((key) => key === 'semua' || counts[key]);

  list.replaceChildren(
    all.length > 0 && tabs.length > 2
      ? h('div', { class: 'tabs-inline' }, tabs.map((key) => h('button', {
        class: 'tab-inline',
        type: 'button',
        'aria-pressed': String(platformFilter === key),
        onclick: () => {
          platformFilter = key;
          drawList();
        }
      }, key === 'semua' ? 'Semua' : PLATFORM_LABEL[key], h('span', { class: 'count' }, String(counts[key] || 0)))))
      : document.createTextNode(''),
    shown.length
      ? h('div', { class: 'rows' }, shown.map(videoRow))
      : emptyState('Belum ada video', 'Tampal link di atas, atau kongsi video dari YouTube, TikTok atau Facebook ke SimpanIdea.'));
}

export function updateWatch() {
  drawList();
}

export function renderWatch() {
  const input = h('input', {
    class: 'input', type: 'url', inputmode: 'url', placeholder: 'Tampal link video', 'aria-label': 'Link video', required: true
  });
  const form = h('form', {
    class: 'watch-add',
    onsubmit: (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!parseVideo(value)) {
        toast('Hanya link video YouTube, TikTok dan Facebook', true);
        return;
      }
      input.value = '';
      input.blur();
      const entry = itemFromText(value);
      addItems([entry]).then(() => {
        if (!isConfigured()) return;
        play(entry, parseVideo(entry.url));
      });
    }
  }, input, h('button', { class: 'button', type: 'submit' }, 'Tambah'));

  stage = h('div', { class: 'stage' }, h('div', { class: 'stage-screen' }, icon('play'), 'Pilih video untuk mula menonton'));
  list = h('div', {});
  const page = h('div', { class: 'watch' }, stage, h('aside', { class: 'watch-side', 'aria-label': 'Senarai video' }, form, list));
  drawList();

  const target = state.watchTarget;
  state.watchTarget = null;
  const startWith = videoEntries().find(({ entry }) => entry.id === target);
  if (startWith) setTimeout(() => play(startWith.entry, startWith.video), 0);
  else currentId = null;
  return page;
}
