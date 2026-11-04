// Storan peranti dalam IndexedDB, dikongsi antara halaman dan service worker.
// queue: perubahan yang belum sampai ke Google. tables: salinan Sheet. images: gambar yang dah dimuat.
const SimpanStore = (() => {
  const DB_NAME = 'simpanidea';
  const DB_VERSION = 3;
  const QUEUE = 'queue';
  const TABLES = 'tables';
  const IMAGES = 'images';

  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(TABLES)) db.createObjectStore(TABLES);
        if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES);
        for (const old of ['sent', 'items']) {
          if (db.objectStoreNames.contains(old)) db.deleteObjectStore(old);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function run(storeName, mode, action) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = action(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(request && request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  return {
    enqueue: (entry) => run(QUEUE, 'readwrite', (store) => store.put(entry)),
    getQueued: (id) => run(QUEUE, 'readonly', (store) => store.get(id)),
    removeQueued: (id) => run(QUEUE, 'readwrite', (store) => store.delete(id)),
    async listQueued() {
      const entries = await run(QUEUE, 'readonly', (store) => store.getAll());
      return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    getTables: () => run(TABLES, 'readonly', (store) => store.get('all')),
    putTables: (tables) => run(TABLES, 'readwrite', (store) => store.put(tables, 'all')),
    getImage: (id) => run(IMAGES, 'readonly', (store) => store.get(id)),
    putImage: (id, blob) => run(IMAGES, 'readwrite', (store) => store.put(blob, id)),
    removeImage: (id) => run(IMAGES, 'readwrite', (store) => store.delete(id)),
    async clearAll() {
      for (const name of [QUEUE, TABLES, IMAGES]) await run(name, 'readwrite', (store) => store.clear());
    }
  };
})();
