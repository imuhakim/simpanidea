// Barisan hantar dalam IndexedDB. Dikongsi antara halaman dan service worker,
// supaya item yang dikongsi tidak hilang kalau tiada internet.
const SimpanStore = (() => {
  const DB_NAME = 'simpanidea';
  const DB_VERSION = 1;
  const QUEUE = 'queue';
  const SENT = 'sent';
  const SENT_LIMIT = 20;

  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(QUEUE, { keyPath: 'id' });
        request.result.createObjectStore(SENT, { keyPath: 'id' });
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

  const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt);

  return {
    enqueue: (item) => run(QUEUE, 'readwrite', (store) => store.put(item)),
    removeQueued: (id) => run(QUEUE, 'readwrite', (store) => store.delete(id)),
    async listQueued() {
      const items = await run(QUEUE, 'readonly', (store) => store.getAll());
      return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async markSent(item, driveUrl) {
      await run(SENT, 'readwrite', (store) => store.put({
        id: item.id,
        type: item.type,
        title: item.title || item.url || item.text || '',
        driveUrl: driveUrl || '',
        createdAt: item.createdAt
      }));
      await run(QUEUE, 'readwrite', (store) => store.delete(item.id));
      const sent = await run(SENT, 'readonly', (store) => store.getAll());
      const excess = sent.sort(byNewest).slice(SENT_LIMIT);
      for (const old of excess) {
        await run(SENT, 'readwrite', (store) => store.delete(old.id));
      }
    },
    async listSent() {
      const items = await run(SENT, 'readonly', (store) => store.getAll());
      return items.sort(byNewest);
    }
  };
})();
