// Nama pengguna: disimpan dalam Sheet supaya sama di semua peranti, dengan salinan dalam peranti.
import { state, writeRecord } from './data.js';

const NAME_ID = 'nama-pengguna';
const NAME_KEY = 'simpanidea.nama';
const SKIP_KEY = 'simpanidea.nama-langkau';
const MAX_NAME_LENGTH = 40;

export const cleanName = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);

export function greetingFor(name, hour) {
  let part = 'malam';
  if (hour >= 5 && hour < 12) part = 'pagi';
  else if (hour >= 12 && hour < 14) part = 'tengah hari';
  else if (hour >= 14 && hour < 19) part = 'petang';
  return 'Selamat ' + part + ', ' + name;
}

function readLocal(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nama masih tersimpan dalam Sheet.
  }
}

export function userName() {
  const row = state.tables.Tetapan.find((candidate) => candidate.id === NAME_ID);
  return cleanName(row ? row.nilai : readLocal(NAME_KEY));
}

export function saveUserName(value) {
  const name = cleanName(value);
  writeLocal(NAME_KEY, name);
  return writeRecord('Tetapan', { id: NAME_ID, nilai: name });
}

export const nameSkipped = () => Boolean(readLocal(SKIP_KEY));
export const skipName = () => writeLocal(SKIP_KEY, '1');
