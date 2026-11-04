// Logik PIN: hanya hash disimpan, dan cubaan salah dilambatkan.
export const PIN_LENGTH = 6;
const ITERATIONS = 200000;
const FREE_ATTEMPTS = 5;
const FIRST_WAIT_SECONDS = 30;
const MAX_WAIT_SECONDS = 900;

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

async function hashPin(pin, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return toBase64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256));
}

export const isValidPin = (pin) => new RegExp('^\\d{' + PIN_LENGTH + '}$').test(String(pin));

/** PIN yang semua digit sama atau berturutan senang diteka. */
export function isWeakPin(pin) {
  const digits = String(pin).split('').map(Number);
  const steps = digits.slice(1).map((digit, index) => digit - digits[index]);
  return steps.every((step) => step === 0) || steps.every((step) => step === 1) || steps.every((step) => step === -1);
}

export async function createPinRecord(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    v: 1,
    salt: toBase64(salt),
    iterations: ITERATIONS,
    hash: await hashPin(pin, salt, ITERATIONS),
    fails: 0,
    until: 0
  };
}

export async function verifyPin(pin, record) {
  return (await hashPin(pin, fromBase64(record.salt), record.iterations)) === record.hash;
}

/** Berapa saat perlu menunggu selepas sekian kali salah. */
export function lockoutSeconds(fails) {
  if (fails < FREE_ATTEMPTS) return 0;
  return Math.min(FIRST_WAIT_SECONDS * 2 ** (fails - FREE_ATTEMPTS), MAX_WAIT_SECONDS);
}
