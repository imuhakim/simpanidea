// Mengenal link YouTube, TikTok dan Facebook, dan menukarnya kepada alamat pemain.
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);
const TIKTOK_SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);
const FACEBOOK_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com']);

export const PLATFORM_LABEL = { youtube: 'YouTube', tiktok: 'TikTok', facebook: 'Facebook' };

function parseUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function youtubeVideo(id, vertical) {
  if (!/^[\w-]{6,20}$/.test(id || '')) return null;
  return {
    platform: 'youtube',
    vertical,
    embedUrl: 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&playsinline=1',
    thumbnail: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'
  };
}

function parseYoutube(url, host) {
  if (host === 'youtu.be') return youtubeVideo(url.pathname.split('/')[1], false);
  if (!YOUTUBE_HOSTS.has(host)) return null;
  const [, first, second] = url.pathname.split('/');
  if (first === 'watch') return youtubeVideo(url.searchParams.get('v'), false);
  if (first === 'shorts') return youtubeVideo(second, true);
  if (first === 'live' || first === 'embed') return youtubeVideo(second, false);
  return null;
}

function parseTiktok(url, host) {
  if (TIKTOK_SHORT_HOSTS.has(host)) return { platform: 'tiktok', vertical: true, needsResolve: true };
  if (!TIKTOK_HOSTS.has(host)) return null;
  const match = url.pathname.match(/\/(?:video|v)\/(\d{5,})/);
  if (match) {
    return { platform: 'tiktok', vertical: true, embedUrl: 'https://www.tiktok.com/embed/v2/' + match[1] };
  }
  if (/^\/(t|vm)\//.test(url.pathname)) return { platform: 'tiktok', vertical: true, needsResolve: true };
  return null;
}

function facebookPlayer(url, vertical) {
  url.hash = '';
  return {
    platform: 'facebook',
    vertical,
    embedUrl: 'https://www.facebook.com/plugins/video.php?show_text=false&href=' + encodeURIComponent(url.href)
  };
}

function parseFacebook(url, host) {
  if (host === 'fb.watch') return { platform: 'facebook', vertical: false, needsResolve: true };
  if (!FACEBOOK_HOSTS.has(host)) return null;
  const path = url.pathname;
  if (/^\/share\/[vr]\//.test(path)) {
    return { platform: 'facebook', vertical: /^\/share\/r\//.test(path), needsResolve: true, fallback: facebookPlayer(url, /^\/share\/r\//.test(path)) };
  }
  if (/^\/reels?\//.test(path)) return facebookPlayer(url, true);
  if (path.startsWith('/watch') || /\/videos\//.test(path)) return facebookPlayer(url, false);
  return null;
}

/** Pulangkan maklumat video, atau null kalau link ini bukan video yang disokong. */
export function parseVideo(value) {
  const url = parseUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  return parseYoutube(url, host) || parseTiktok(url, host) || parseFacebook(url, host);
}
