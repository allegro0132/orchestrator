function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('arco-vibe', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction(mode, work) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', mode);
    const request = work(tx.objectStore('sessions'));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('storage'));
    };
  });
}
let writes = Promise.resolve();
export const saveVibe = (session) => {
  const copy = structuredClone(session);
  return (writes = writes
    .catch(() => {})
    .then(() => transaction('readwrite', (store) => store.put(copy))));
};
export const listVibes = async () => {
  await writes.catch(() => {});
  return (await transaction('readonly', (store) => store.getAll())).sort((a, b) =>
    b.created.localeCompare(a.created),
  );
};
export const deleteVibe = (id) =>
  (writes = writes
    .catch(() => {})
    .then(() => transaction('readwrite', (store) => store.delete(id))));
