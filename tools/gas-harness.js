// Jalankan apps-script/Code.gs dalam Node dengan tiruan perkhidmatan Google,
// supaya backend sebenar boleh diuji tanpa akaun Google.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createHarness() {
  const state = { properties: {}, files: [], folders: [], rows: [], logs: [], locks: 0, ids: 0 };
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
        if (state.failNextFile) {
          state.failNextFile = false;
          throw new Error('Drive penuh');
        }
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

  const sheet = {
    name: 'Sheet1',
    setName(name) { sheet.name = name; },
    setFrozenRows() {},
    getLastRow: () => state.rows.length,
    appendRow(row) {
      if (state.failNextAppend) {
        state.failNextAppend = false;
        throw new Error('Sheet sibuk');
      }
      state.rows.push(row.slice());
    },
    getRange(row, column, rows, columns) {
      return {
        setValues(values) {
          values.forEach((value, i) => { state.rows[row - 1 + i] = value.slice(); });
        },
        getValue: () => state.rows[row - 1][column - 1],
        getValues: () => state.rows.slice(row - 1, row - 1 + rows).map((r) => r.slice(column - 1, column - 1 + columns)),
        setValue: (value) => { state.rows[row - 1][column - 1] = value; },
        createTextFinder(text) {
          const finder = {
            matchEntireCell: () => finder,
            findNext() {
              for (let r = row; r < row + (rows || 1); r++) {
                if (String(state.rows[r - 1][column - 1]) === text) return { getRow: () => r };
              }
              return null;
            }
          };
          return finder;
        }
      };
    }
  };

  const spreadsheet = {
    getId: () => 'spreadsheet-1',
    getSheets: () => [sheet],
    getSheetByName: (name) => (sheet.name === name ? sheet : null)
  };

  const context = vm.createContext({
    Logger: { log: (message) => state.logs.push(String(message)) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key in state.properties ? state.properties[key] : null),
        setProperty: (key, value) => { state.properties[key] = value; }
      })
    },
    DriveApp: {
      getRootFolder: () => root,
      getFolderById: (id) => state.folders.find((f) => f.id === id),
      getFileById(id) {
        const file = state.files.find((f) => f.id === id);
        return {
          moveTo() {},
          getBlob: () => ({
            getContentType: () => file.blob.mimeType,
            getBytes: () => file.blob.bytes
          })
        };
      }
    },
    SpreadsheetApp: { create: () => spreadsheet, openById: () => spreadsheet },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { state.locks += 1; },
        releaseLock: () => { state.locks -= 1; }
      })
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
