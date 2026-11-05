// Panel Tanya AI. Boleh dibuka dari mana-mana halaman, atau dari satu rekod termasuk gambarnya.
// Kunci API disimpan di backend sahaja, dan tidak pernah dibaca semula oleh app.
import { addItems, callBackend, firstColumnId, isConfigured, newId, newItem, state, writeRecord } from '../lib/data.js';
import { buildAiContext } from '../lib/ai-context.js';
import { copyText, field, h, icon, openSheet, toast } from '../lib/dom.js';
import { splitTitle } from './manage.js';

const MODEL_KEY = 'simpanidea.ai-model';
const CONSOLE_URL = 'https://console.anthropic.com/settings/keys';
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5, paling pintar' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5, seimbang' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5, paling murah' }
];
const GENERAL_SUGGESTIONS = ['Apa patut saya buat dahulu hari ini?', 'Ringkaskan Inbox saya', 'Kelas mana yang saya belum habis?'];
const IMAGE_SUGGESTIONS = ['Huraikan screenshot ini', 'Apa isi penting dalam gambar ini?', 'Cadangkan soalan berkaitan', 'Jadikan langkah-langkah yang boleh saya buat'];
const ITEM_SUGGESTIONS = ['Huraikan item ini', 'Apa langkah seterusnya?', 'Cadangkan soalan berkaitan'];

let messages = [];
let focus = null;
let useData = true;
let busy = false;
let sheet = null;
let chatBox = null;
let composeBox = null;
let aiConfigured = null;

export function clearAiChat() {
  messages = [];
  focus = null;
}

export function currentModel() {
  try {
    const saved = localStorage.getItem(MODEL_KEY);
    if (MODELS.some((model) => model.id === saved)) return saved;
  } catch {
    // Guna model lalai kalau storan tidak dapat dibaca.
  }
  return MODELS[0].id;
}

const modelLabel = (id) => (MODELS.find((model) => model.id === id) || { label: id }).label.split(',')[0];

/* Paparan jawapan: bentuk Markdown biasa ditukar kepada elemen, bukan HTML mentah. */
function inline(text) {
  const parts = [];
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    parts.push(token.startsWith('**') ? h('strong', {}, token.slice(2, -2)) : h('code', {}, token.slice(1, -1)));
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderMarkdown(text) {
  const blocks = [];
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)/);
    const numbered = line.match(/^\d+[.)]\s+(.*)/);
    if (bullet || numbered) {
      const tag = bullet ? 'ul' : 'ol';
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = h(tag);
        blocks.push(list);
      }
      list.append(h('li', {}, inline((bullet || numbered)[1])));
      continue;
    }
    list = null;
    if (!line) continue;
    const heading = line.match(/^#{1,4}\s+(.*)/);
    blocks.push(h('p', {}, heading ? h('strong', {}, inline(heading[1])) : inline(line)));
  }
  return blocks;
}

/* Simpan jawapan */
async function saveAnswer(kind, text) {
  const { title, text: body } = splitTitle('', text);
  if (kind === 'note') {
    await addItems([newItem({ type: 'note', title, text: body })]);
    toast('Disimpan sebagai nota');
  } else if (kind === 'task') {
    await writeRecord('Tugasan', { id: newId(), tajuk: title, nota: body, siap: '', tarikh_akhir: '', gambar: '' });
    toast('Disimpan sebagai tugasan');
  } else {
    const columnId = firstColumnId();
    if (!columnId) {
      toast('Papan belum ada lajur', true);
      return;
    }
    await writeRecord('Kad', { id: newId(), tajuk: title, nota: body, gambar: '', lajur_id: columnId, kedudukan: Date.now() });
    toast('Disimpan sebagai kad');
  }
}

function tool(label, onclick) {
  return h('button', { class: 'ai-tool', type: 'button', onclick }, label);
}

function messageElement(message, index) {
  if (message.role === 'user') return h('div', { class: 'ai-message user' }, message.text);
  if (message.error) {
    return h('div', { class: 'ai-message error' }, message.error,
      h('div', { class: 'ai-tools' }, tool('Cuba lagi', () => {
        messages.splice(index, 1);
        ask();
      })));
  }
  return h('div', { class: 'ai-message assistant' },
    renderMarkdown(message.text),
    message.truncated && h('p', {}, h('em', {}, 'Jawapan terpotong kerana terlalu panjang. Minta AI sambung.')),
    h('div', { class: 'ai-tools' },
      tool('Salin', () => copyText(message.text, 'Jawapan disalin')),
      tool('Jadi nota', () => saveAnswer('note', message.text)),
      tool('Jadi tugasan', () => saveAnswer('task', message.text)),
      tool('Jadi kad', () => saveAnswer('card', message.text)),
      message.usage && h('span', { class: 'ai-usage' },
        modelLabel(message.model) + ' · ' + (message.usage.input + message.usage.output).toLocaleString('ms-MY') + ' token')));
}

function drawChat() {
  if (!chatBox) return;
  const children = [];
  if (!messages.length) {
    const hasImage = focus && focus.imageIds.length;
    const suggestions = focus ? (hasImage ? IMAGE_SUGGESTIONS : ITEM_SUGGESTIONS) : GENERAL_SUGGESTIONS;
    children.push(h('div', { class: 'ai-intro' },
      h('h3', {}, focus ? 'Tanya tentang item ini' : 'Tanya apa saja'),
      h('p', {}, focus
        ? (hasImage ? 'AI boleh lihat gambar ini dan menjawab berdasarkannya.' : 'AI akan menjawab berdasarkan item ini.')
        : 'Soalan umum, atau tentang simpanan anda.'),
      h('div', { class: 'ai-suggestions' }, suggestions.map((text) => h('button', {
        class: 'ai-suggestion',
        type: 'button',
        onclick: () => ask(text)
      }, text)))));
  } else {
    messages.forEach((message, index) => children.push(messageElement(message, index)));
  }
  if (busy) children.push(h('div', { class: 'ai-thinking', role: 'status', 'aria-label': 'AI sedang menjawab' }, h('span'), h('span'), h('span')));
  chatBox.replaceChildren(...children);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function drawCompose() {
  if (!composeBox) return;
  const input = h('textarea', {
    class: 'input',
    rows: 1,
    placeholder: 'Tanya apa saja',
    'aria-label': 'Soalan',
    onkeydown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    },
    oninput: () => {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 2 + 'px';
    }
  });
  const send = () => {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    input.style.height = 'auto';
    ask(text);
    input.focus();
  };
  composeBox.replaceChildren(
    focus && h('div', { class: 'ai-focus' },
      icon(focus.imageIds.length ? 'image' : 'note'),
      h('span', { class: 'ai-focus-label' }, focus.label || 'Item dipilih'),
      h('button', {
        class: 'icon-button',
        type: 'button',
        'aria-label': 'Jangan guna item ini',
        onclick: () => {
          focus = null;
          drawCompose();
          drawChat();
        }
      }, icon('close'))),
    h('div', { class: 'ai-input-row' },
      input,
      h('button', { class: 'button primary ai-send', type: 'button', 'aria-label': 'Hantar', onclick: send }, icon('send'))),
    h('div', { class: 'ai-options' },
      h('label', {},
        h('input', {
          type: 'checkbox',
          checked: useData,
          onchange: (event) => { useData = event.target.checked; }
        }),
        'Guna simpanan saya'),
      h('select', {
        'aria-label': 'Model AI',
        onchange: (event) => {
          try {
            localStorage.setItem(MODEL_KEY, event.target.value);
          } catch {
            // Pilihan cuma tidak diingat untuk lain kali.
          }
        }
      }, MODELS.map((model) => h('option', { value: model.id, selected: model.id === currentModel() }, model.label)))));
  if (sheet) input.focus();
}

async function ask(text) {
  if (busy) return;
  if (text) messages.push({ role: 'user', text });
  busy = true;
  drawChat();
  const history = messages
    .filter((message) => !message.error)
    .map((message) => ({ role: message.role, text: message.text }));
  const viewName = document.getElementById('view-title').textContent;
  let reply;
  try {
    const result = await callBackend({
      action: 'aiChat',
      model: currentModel(),
      messages: history,
      context: useData ? buildAiContext(state.raw, { today: new Date().toISOString().slice(0, 10), view: viewName }) : '',
      focus: focus ? focus.text : '',
      imageIds: focus ? focus.imageIds : []
    });
    if (result.ok) {
      reply = { role: 'assistant', text: result.text, truncated: result.truncated, usage: result.usage, model: result.model };
    } else if (result.code === 'no_key') {
      aiConfigured = false;
      reply = { role: 'assistant', error: result.error };
    } else if (result.code === 'bad_request' && /Tindakan/.test(result.error)) {
      reply = { role: 'assistant', error: 'Backend Google perlu dikemas kini dahulu. Lihat amaran di bahagian atas app.' };
    } else {
      reply = { role: 'assistant', error: result.error };
    }
  } catch {
    reply = { role: 'assistant', error: 'Tidak dapat sampai ke Google. Semak internet, atau soalan mungkin mengambil masa terlalu lama.' };
  }
  messages.push(reply);
  busy = false;
  drawChat();
}

/* Kunci API */
function keyForm(onSaved) {
  const input = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-...' });
  const submit = h('button', { class: 'button primary', type: 'submit' }, 'Simpan kunci');
  return h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const key = input.value.trim();
      if (!key) return;
      submit.disabled = true;
      submit.textContent = 'Sedang menyemak';
      try {
        const result = await callBackend({ action: 'saveAiKey', key });
        if (result.ok) {
          input.value = '';
          aiConfigured = true;
          toast('Kunci API disimpan');
          onSaved();
          return;
        }
        toast(/Tindakan/.test(result.error) ? 'Backend Google perlu dikemas kini dahulu' : result.error, true);
      } catch {
        toast('Tidak dapat sampai ke Google', true);
      }
      submit.disabled = false;
      submit.textContent = 'Simpan kunci';
    }
  }, field('Kunci API Anthropic', input, 'Disimpan dalam Google Apps Script anda, dan tidak disimpan dalam peranti ini.'), submit);
}

function setupSteps() {
  return h('ol', {},
    h('li', {}, 'Buka ', h('a', { href: CONSOLE_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Anthropic Console'), ', dan log masuk.'),
    h('li', {}, 'Tambah kredit, kerana API dibayar berasingan daripada langganan Claude.'),
    h('li', {}, 'Cipta API key, dan tampal di bawah.'));
}

async function loadStatus() {
  if (aiConfigured !== null || !isConfigured()) return aiConfigured;
  try {
    const result = await callBackend({ action: 'aiStatus' });
    aiConfigured = result.ok ? result.configured : null;
  } catch {
    aiConfigured = null;
  }
  return aiConfigured;
}

export function renderAiSettings() {
  const section = h('section', { id: 'ai-section' });
  function draw() {
    section.replaceChildren(h('h2', {}, 'Tanya AI'));
    if (aiConfigured === true) {
      section.append(
        h('p', { class: 'field-hint section-hint' }, 'Kunci API Anthropic tersimpan di Google Apps Script anda. Setiap soalan dicaj kepada akaun API anda.'),
        h('div', { class: 'button-row' },
          h('button', { class: 'button', type: 'button', onclick: () => openAi() }, icon('sparkle'), 'Buka Tanya AI'),
          h('button', {
            class: 'button plain',
            type: 'button',
            onclick: async () => {
              try {
                const result = await callBackend({ action: 'removeAiKey' });
                if (!result.ok) throw new Error(result.error);
                aiConfigured = false;
                draw();
                toast('Kunci API dibuang');
              } catch (err) {
                toast('Tidak dapat buang kunci: ' + err.message, true);
              }
            }
          }, 'Buang kunci')));
    } else {
      section.append(h('div', { class: 'ai-setup-inline' }, setupSteps(), keyForm(draw)));
    }
  }
  draw();
  loadStatus().then(draw);
  return section;
}

export function askAiButton(getFocus) {
  return h('button', {
    class: 'button ai-button',
    type: 'button',
    onclick: () => openAi({ focus: getFocus() })
  }, icon('sparkle'), 'Tanya AI');
}

function drawPanelBody(body) {
  if (!isConfigured()) {
    body.replaceChildren(h('div', { class: 'ai-setup' },
      h('p', {}, 'Sambungkan app ke Google dahulu di Tetapan.'),
      h('a', { class: 'button primary', href: '#settings' }, 'Buka Tetapan')));
    return;
  }
  if (aiConfigured === false) {
    body.replaceChildren(h('div', { class: 'ai-setup' },
      h('p', {}, 'Masukkan kunci API Anthropic anda untuk mula bertanya.'),
      setupSteps(),
      keyForm(() => drawPanelBody(body))));
    return;
  }
  chatBox = h('div', { class: 'ai-chat', 'aria-live': 'polite' });
  composeBox = h('div', { class: 'ai-compose' });
  body.replaceChildren(chatBox, composeBox);
  drawChat();
  drawCompose();
}

/** Buka panel. Kalau item lain dipilih, perbualan bermula semula supaya jawapan tidak bercampur. */
export async function openAi({ focus: newFocus } = {}) {
  if (newFocus) {
    if (!focus || focus.text !== newFocus.text) messages = [];
    focus = { label: newFocus.label, text: newFocus.text, imageIds: newFocus.imageIds || [] };
  }
  if (sheet) sheet.close();
  const body = h('div', { class: 'ai-panel-body' });
  sheet = openSheet({
    title: 'Tanya AI',
    kicker: 'Claude',
    body,
    onClose: () => {
      sheet = null;
      chatBox = null;
      composeBox = null;
    },
    actions: [
      h('button', {
        class: 'button plain',
        type: 'button',
        onclick: () => {
          messages = [];
          focus = null;
          drawChat();
          drawCompose();
        }
      }, 'Perbualan baru')
    ]
  });
  sheet.classList.add('ai-sheet');

  await loadStatus();
  if (sheet) drawPanelBody(body);
}
