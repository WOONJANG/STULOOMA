const DB = 'stulooma-local-v1';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function readLocal<T>(key: string): Promise<T | undefined> {
  const db = await database();
  try { return await new Promise<T | undefined>((resolve, reject) => { const r = db.transaction('data').objectStore('data').get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  finally { db.close(); }
}
export async function writeLocal(key: string, value: unknown): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('data', 'readwrite'); tx.objectStore('data').put(value, key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
  finally { db.close(); }
}
