// Storan peranti dalam IndexedDB, dikongsi antara halaman dan service worker.
// queue: item yang belum sampai ke Google. items: salinan Sheet. images: gambar yang dah dimuat.
const SimpanStore = (() => {
  const DB_NAME = 'simpanidea';
  const DB_VERSION = 2;
  const QUEUE = 'queue';
  const ITEMS = 'items';
  const IMAGES = 'images';

  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES);
        if (db.objectStoreNames.contains('sent')) db.deleteObjectStore('sent');
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
    enqueue: (item) => run(QUEUE, 'readwrite', (store) => store.put(item)),
    removeQueued: (id) => run(QUEUE, 'readwrite', (store) => store.delete(id)),
    async listQueued() {
      const items = await run(QUEUE, 'readonly', (store) => store.getAll());
      return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    listItems: () => run(ITEMS, 'readonly', (store) => store.getAll()),
    putItem: (item) => run(ITEMS, 'readwrite', (store) => store.put(item)),
    replaceItems: (items) => run(ITEMS, 'readwrite', (store) => {
      store.clear();
      items.forEach((item) => store.put(item));
    }),
    getImage: (id) => run(IMAGES, 'readonly', (store) => store.get(id)),
    putImage: (id, blob) => run(IMAGES, 'readwrite', (store) => store.put(blob, id))
  };
})();
