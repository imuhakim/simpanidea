// Jalankan apps-script/Code.gs dalam Node dengan tiruan perkhidmatan Google,
// supaya backend sebenar boleh diuji tanpa akaun Google.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createHarness() {
  const state = {
    properties: {}, files: [], folders: [], sheets: {}, logs: [], locks: 0, ids: 0,
    redirects: {}, fetched: [], requests: [], anthropic: null
  };
  const nextId = (prefix) => `${prefix}-${++state.ids}`;

  function makeFolder(name, parent) {
    const folder = {
      name,
      parent,
      getId: () => folder.id,
      getUrl: () => `https://drive.google.com/drive/folders/${folder.id}`,
      getFoldersByName(wanted) {
        const found = state.folders.filter((f) => f.parent === folder && f.name === wanted);
        return { hasNext: () => found.length > 0, next: () => found.shift() };
      },
      createFolder: (childName) => makeFolder(childName, folder),
      createFile(blob) {
        const file = {
          id: nextId('file'),
          blob,
          folder,
          trashed: false,
          getId: () => file.id,
          getName: () => blob.name,
          getUrl: () => `https://drive.google.com/file/d/${file.id}/view`,
          setTrashed: (value) => { file.trashed = value; }
        };
        state.files.push(file);
        return file;
      }
    };
    folder.id = nextId('folder');
    state.folders.push(folder);
    return folder;
  }

  const root = makeFolder('My Drive', null);

  function makeSheet(name) {
    const sheet = {
      name,
      rows: [],
      setName(newName) {
        delete state.sheets[sheet.name];
        sheet.name = newName;
        state.sheets[newName] = sheet;
      },
      setFrozenRows() {},
      getLastRow: () => sheet.rows.length,
      getLastColumn: () => (sheet.rows[0] ? sheet.rows[0].length : 0),
      getMaxRows: () => 1000,
      deleteRow: (row) => { sheet.rows.splice(row - 1, 1); },
      appendRow(row) {
        if (state.failNextAppend) {
          state.failNextAppend = false;
          throw new Error('Sheet sibuk');
        }
        sheet.rows.push(row.slice());
      },
      getRange(row, column, rows, columns) {
        return {
          setNumberFormat() {},
          setValues(values) {
            values.forEach((value, i) => {
              const target = sheet.rows[row - 1 + i] || (sheet.rows[row - 1 + i] = []);
              value.forEach((cell, j) => { target[column - 1 + j] = cell; });
            });
          },
          getValue: () => sheet.rows[row - 1][column - 1],
          getValues: () => sheet.rows.slice(row - 1, row - 1 + rows).map((r) => {
            const out = [];
            for (let c = 0; c < columns; c++) out.push(r[column - 1 + c] === undefined ? '' : r[column - 1 + c]);
            return out;
          }),
          setValue: (value) => { sheet.rows[row - 1][column - 1] = value; },
          createTextFinder(text) {
            const finder = {
              matchEntireCell: () => finder,
              findNext() {
                for (let r = row; r < row + (rows || 1); r++) {
                  if (String(sheet.rows[r - 1][column - 1]) === text) return { getRow: () => r };
                }
                return null;
              }
            };
            return finder;
          }
        };
      }
    };
    state.sheets[name] = sheet;
    return sheet;
  }

  const spreadsheet = {
    getId: () => 'spreadsheet-1',
    getSheets: () => Object.values(state.sheets),
    getSheetByName: (name) => state.sheets[name] || null,
    insertSheet: (name) => makeSheet(name)
  };

  const context = vm.createContext({
    Logger: { log: (message) => state.logs.push(String(message)) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key in state.properties ? state.properties[key] : null),
        setProperty: (key, value) => { state.properties[key] = value; },
        deleteProperty: (key) => { delete state.properties[key]; }
      })
    },
    DriveApp: {
      getRootFolder: () => root,
      getFolderById: (id) => state.folders.find((f) => f.id === id),
      getFileById(id) {
        const file = state.files.find((f) => f.id === id);
        return {
          moveTo() {},
          setTrashed: (value) => { file.trashed = value; },
          getBlob: () => ({
            getContentType: () => file.blob.mimeType,
            getBytes: () => file.blob.bytes
          })
        };
      }
    },
    SpreadsheetApp: {
      create() {
        makeSheet('Sheet1');
        return spreadsheet;
      },
      openById: () => spreadsheet
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { state.locks += 1; },
        releaseLock: () => { state.locks -= 1; }
      })
    },
    UrlFetchApp: {
      fetch(url, options = {}) {
        state.fetched.push(url);
        if (url.startsWith('https://api.anthropic.com/')) {
          state.requests.push({ url, options, body: options.payload ? JSON.parse(options.payload) : null });
          const reply = state.anthropic
            ? state.anthropic(url, options)
            : { code: 200, body: { stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Jawapan tiruan' }], usage: { input_tokens: 10, output_tokens: 5 } } };
          return { getResponseCode: () => reply.code, getContentText: () => JSON.stringify(reply.body), getHeaders: () => ({}) };
        }
        const location = state.redirects[url];
        return {
          getResponseCode: () => (location ? 302 : 200),
          getHeaders: () => (location ? { Location: location } : {})
        };
      }
    },
    Utilities: {
      getUuid: () => require('node:crypto').randomUUID(),
      base64Decode: (text) => Array.from(Buffer.from(text, 'base64')),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name }),
      formatDate: (date, zone, format) => (format === 'yyyy-MM' ? '2026-11' : '20261104-120000')
    },
    Session: { getScriptTimeZone: () => 'Asia/Kuala_Lumpur' },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        return { text, setMimeType() { return this; } };
      }
    }
  });

  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.runInContext(source, context, { filename: 'Code.gs' });

  return {
    state,
    setup: () => context.setup(),
    rotateSecret: () => context.rotateSecret(),
    post(contents) {
      return JSON.parse(context.doPost({ postData: { contents } }).text);
    },
    get: () => JSON.parse(context.doGet().text)
  };
}

module.exports = { createHarness };
