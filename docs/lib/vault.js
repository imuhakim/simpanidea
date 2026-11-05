// Penyulitan password kelas. Password disulitkan dalam peranti sebelum dihantar,
// jadi Google Sheets hanya menyimpan teks yang tidak boleh dibaca tanpa kata laluan induk.
const ITERATIONS = 600000;
const CHECK_TEXT = 'simpanidea-vault-check';

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']);
}

export async function encrypt(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return 'v1.' + toBase64(iv) + '.' + toBase64(data);
}

export async function decrypt(key, sealed) {
  const [version, iv, data] = String(sealed).split('.');
  if (version !== 'v1' || !iv || !data) throw new Error('Data password tidak dikenali.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(data));
  return new TextDecoder().decode(plain);
}

/** Cipta peti baru. Rekod yang dipulangkan selamat disimpan dalam Sheet. */
export async function createVault(passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const record = { v: 1, salt: toBase64(salt), iterations: ITERATIONS, check: await encrypt(key, CHECK_TEXT) };
  return { key, record };
}

/** Pulangkan kunci kalau kata laluan betul, dan null kalau salah. */
export async function unlockVault(passphrase, record) {
  const key = await deriveKey(passphrase, fromBase64(record.salt));
  try {
    return (await decrypt(key, record.check)) === CHECK_TEXT ? key : null;
  } catch {
    return null;
  }
}
