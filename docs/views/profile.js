// Soalan nama semasa kali pertama dibuka, dan tempat menukarnya di Tetapan.
import { field, h, openModal, toast } from '../lib/dom.js';
import { cleanName, nameSkipped, saveUserName, skipName, userName } from '../lib/profile.js';
import { isLocked } from './lock.js';

let asking = false;

export function askNameIfNeeded() {
  if (asking || isLocked() || userName() || nameSkipped()) return;
  asking = true;
  let dialog;
  const input = h('input', { class: 'input', type: 'text', maxlength: 40, autocomplete: 'given-name', 'aria-label': 'Nama anda', placeholder: 'Nama anda' });
  const form = h('form', {
    id: 'name-form',
    onsubmit: async (event) => {
      event.preventDefault();
      const name = cleanName(input.value);
      if (!name) {
        input.focus();
        return;
      }
      dialog.close();
      await saveUserName(name);
      toast('Selamat berkenalan, ' + name);
    }
  }, input);
  dialog = openModal({
    title: 'Siapa nama anda?',
    body: [
      h('p', { class: 'form-note' }, 'SimpanIdea akan menyapa anda dengan nama ini. Anda boleh menukarnya di Tetapan.'),
      form
    ],
    onClose: () => { asking = false; },
    actions: [
      h('button', {
        class: 'button',
        type: 'button',
        onclick: () => {
          skipName();
          dialog.close();
        }
      }, 'Langkau'),
      h('button', { class: 'button primary', type: 'submit', form: 'name-form' }, 'Teruskan')
    ]
  });
  input.focus();
}

export function renderNameSettings() {
  const input = h('input', { class: 'input', type: 'text', maxlength: 40, autocomplete: 'given-name', value: userName() });
  return h('section', {},
    h('h2', {}, 'Nama anda'),
    h('form', {
      onsubmit: async (event) => {
        event.preventDefault();
        await saveUserName(input.value);
        input.value = userName();
        toast('Nama disimpan');
      }
    },
    field('Nama', input, 'Digunakan untuk sapaan, dan diberitahu kepada Tanya AI.'),
    h('button', { class: 'button primary', type: 'submit' }, 'Simpan nama')));
}
