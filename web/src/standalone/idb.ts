// A tiny key-value store on IndexedDB (localStorage holds only ~5 MB, too little for a long
// listening history with its songs).
const DB = 'tunes-data';
const STORE = 'kv';

let db: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then((d) => new Promise<T>((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error);
  }));
}

export const idbGet = <T>(key: string): Promise<T | undefined> => run<T | undefined>('readonly', (s) => s.get(key));
export const idbSet = (key: string, value: unknown): Promise<void> => run<void>('readwrite', (s) => s.put(value, key)).then(() => undefined);
