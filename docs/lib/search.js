// Carian pintar: setiap perkataan dicari berasingan, separuh perkataan dan salah eja kecil masih jumpa,
// dan imbuhan Melayu dibuang supaya "simpan" menjumpai "menyimpan" dan "simpanan".

/** Huruf kecil, tanpa tanda aksen, dan hanya huruf serta nombor. */
export function normalise(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const tokenize = (text) => normalise(text).split(' ').filter(Boolean);

const VOWEL = /^[aeiou]/;
const SUFFIXES = ['kannya', 'annya', 'nya', 'kan', 'lah', 'kah', 'an', 'i'];

/** Buang awalan meN-, peN-, ber-, ter-, di-, ke-, se- dengan peluluhan biasa (menyimpan -> simpan). */
function stripPrefix(word) {
  const rules = [
    [/^(meny|peny)(?=[aeiou])/, 's'],
    [/^(meng|peng)(?=[aeiou])/, 'k'],
    [/^(meng|peng)/, ''],
    [/^(mem|pem)(?=[aeiou])/, 'p'],
    [/^(mem|pem)(?=[bpf])/, ''],
    [/^(men|pen)(?=[aeiou])/, 't'],
    [/^(men|pen)(?=[cdjz])/, ''],
    [/^(ber|ter|per)/, ''],
    [/^(me|pe)(?=[lrmnwy])/, ''],
    [/^(di|ke|se)/, '']
  ];
  const forms = [];
  for (const [pattern, replacement] of rules) {
    if (!pattern.test(word)) continue;
    const root = word.replace(pattern, replacement);
    if (root.length >= 3) forms.push(root);
    // Perkataan seperti "mengira" boleh jadi kira atau ngira; cuba juga tanpa ganti huruf.
    if (replacement && VOWEL.test(word.replace(pattern, ''))) {
      const bare = word.replace(pattern, '');
      if (bare.length >= 3) forms.push(bare);
    }
  }
  return forms;
}

function stripSuffix(word) {
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0, -suffix.length);
  }
  return null;
}

const rootCache = new Map();
/** Semua bentuk dasar yang mungkin bagi satu perkataan, termasuk perkataan itu sendiri. */
export function roots(word) {
  if (rootCache.has(word)) return rootCache.get(word);
  const forms = new Set([word]);
  if (word.length >= 5) {
    for (const base of [word, stripSuffix(word)].filter(Boolean)) {
      forms.add(base);
      for (const root of stripPrefix(base)) {
        forms.add(root);
        const shorter = stripSuffix(root);
        if (shorter) forms.add(shorter);
      }
    }
  }
  const list = [...forms];
  if (rootCache.size > 5000) rootCache.clear();
  rootCache.set(word, list);
  return list;
}

/** Jarak suntingan, berhenti awal kalau sudah melebihi had. */
function withinDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      best = Math.min(best, current[j]);
    }
    if (best > limit) return false;
    previous = current;
  }
  return previous[b.length] <= limit;
}

const typoLimit = (word) => (word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0);

/** Seberapa baik satu perkataan carian sepadan dengan satu perkataan dalam teks. 0 bermakna tidak sepadan. */
export function wordScore(query, token) {
  if (query === token) return 3;
  if (token.startsWith(query)) return query.length >= 3 ? 2.2 : 1.5;
  if (query.length >= 3) {
    const tokenRoots = roots(token);
    if (roots(query).some((root) => tokenRoots.includes(root))) return 2.5;
  }
  if (query.length >= 4 && token.includes(query)) return 1.5;
  const limit = typoLimit(query);
  if (limit && token.length >= 3) {
    if (withinDistance(query, token, limit)) return 1;
    // Salah eja di hujung perkataan yang belum habis ditaip.
    if (token.length > query.length && withinDistance(query, token.slice(0, query.length), 1)) return 0.8;
  }
  return 0;
}

const tokenCache = new Map();
function cachedTokens(text) {
  let tokens = tokenCache.get(text);
  if (!tokens) {
    tokens = [...new Set(tokenize(text))];
    if (tokenCache.size > 20000) tokenCache.clear();
    tokenCache.set(text, tokens);
  }
  return tokens;
}

/**
 * Nilai satu rekod. fields ialah [{ text, weight }], contohnya tajuk dengan berat 3 dan isi dengan berat 1.
 * Setiap perkataan carian mesti dijumpai di mana-mana medan, kalau tidak rekod ini tidak sepadan (null).
 * Dipulangkan bersama perkataan dalam teks yang sepadan, untuk diserlahkan.
 */
export function scoreRecord(query, fields) {
  const words = tokenize(query);
  if (!words.length) return null;
  const phrase = normalise(query);
  const hits = new Set();
  let score = 0;
  for (const word of words) {
    let best = 0;
    for (const { text, weight = 1 } of fields) {
      if (!text) continue;
      for (const token of cachedTokens(text)) {
        const value = wordScore(word, token);
        if (!value) continue;
        hits.add(token);
        best = Math.max(best, value * weight);
      }
    }
    if (!best) return null;
    score += best;
  }
  // Frasa penuh yang muncul berturut-turut diberi markah tambahan.
  if (words.length > 1) {
    for (const { text, weight = 1 } of fields) {
      if (text && normalise(text).includes(phrase)) score += 4 * weight;
    }
  }
  return { score, hits };
}

/** Pecahkan teks kepada bahagian biasa dan bahagian yang sepadan, untuk diserlahkan. */
export function markSegments(text, hits) {
  const source = String(text || '');
  if (!hits || !hits.size) return [{ text: source, hit: false }];
  const segments = [];
  const pattern = /[\p{L}\p{N}]+/gu;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    if (!hits.has(normalise(match[0]))) continue;
    if (match.index > last) segments.push({ text: source.slice(last, match.index), hit: false });
    segments.push({ text: match[0], hit: true });
    last = match.index + match[0].length;
  }
  if (last < source.length) segments.push({ text: source.slice(last), hit: false });
  return segments;
}

/** Petikan pendek di sekitar perkataan pertama yang sepadan dalam teks panjang. */
export function snippet(text, hits, length = 110) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (source.length <= length) return source;
  let start = 0;
  for (const match of source.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (hits && hits.has(normalise(match[0]))) {
      start = match.index;
      break;
    }
  }
  const from = Math.max(0, Math.min(start - 30, source.length - length));
  const cut = source.slice(from, from + length);
  return (from > 0 ? '…' : '') + cut + (from + length < source.length ? '…' : '');
}

/** Rekod yang lebih baru diberi kelebihan kecil, supaya ia naik bila markahnya hampir sama. */
export function recencyBonus(isoDate, now = Date.now()) {
  const time = new Date(isoDate || 0).getTime();
  if (!time) return 0;
  const days = Math.max(0, (now - time) / 86400000);
  return 1 / (1 + days / 30);
}
