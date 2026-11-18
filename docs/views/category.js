// Kategori screenshot, contohnya Movie atau Bisnes. Pengguna mencipta kategori sendiri dengan menaip namanya.
import { state } from '../lib/data.js';
import { field, h } from '../lib/dom.js';

const MAX_LENGTH = 40;
export const NO_CATEGORY = '__tiada__';

/** Kategori yang sedang dipilih di halaman Screenshot. Kosong bermakna Semua. */
export const categoryFilter = { value: '' };

const tidy = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
const sameName = (a, b) => tidy(a).toLowerCase() === tidy(b).toLowerCase();

/** Kategori yang sudah digunakan, ikut abjad. Ejaan pertama yang dijumpai dikekalkan. */
export function categoriesOf(items) {
  const names = new Map();
  for (const item of items) {
    const name = tidy(item.kategori);
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'ms', { sensitivity: 'base' }));
}

export const imageCategories = () => categoriesOf(state.items.filter((item) => item.type === 'image'));

export function inCategory(item, chosen) {
  if (!chosen) return true;
  if (chosen === NO_CATEGORY) return !tidy(item.kategori);
  return sameName(item.kategori, chosen);
}

/** Kotak kategori dengan butang pantas untuk kategori sedia ada. */
export function categoryPicker(value = '') {
  const known = imageCategories();
  const input = h('input', {
    class: 'input',
    type: 'text',
    maxlength: MAX_LENGTH,
    value: tidy(value),
    placeholder: known.length ? 'Pilih di bawah, atau taip kategori baru' : 'Contoh: Movie, Bisnes',
    autocomplete: 'off',
    oninput: () => sync()
  });
  const picks = known.map((name) => h('button', {
    class: 'tab-inline',
    type: 'button',
    onclick: () => {
      input.value = sameName(input.value, name) ? '' : name;
      sync();
    }
  }, name));
  function sync() {
    picks.forEach((pick, index) => pick.setAttribute('aria-pressed', String(sameName(input.value, known[index]))));
  }
  sync();
  return {
    element: [
      field('Kategori (pilihan)', input),
      picks.length > 0 && h('div', { class: 'tabs-inline category-picks' }, picks)
    ].filter(Boolean),
    // Ejaan kategori sedia ada digunakan, supaya "movie" dan "Movie" tidak menjadi dua kategori.
    value: () => known.find((name) => sameName(name, input.value)) || tidy(input.value)
  };
}
