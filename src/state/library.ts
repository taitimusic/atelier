/** 楽器ライブラリ（IndexedDB）。音色データは端末内にのみ保存する。 */
import { sanitize, type Instrument } from "../engine/instrument";

const DB = "atelier-v2";
const STORE = "instruments";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => res(r.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error ?? new Error("保存が中断されました"));
  });
}

export async function listInstruments(): Promise<Instrument[]> {
  try {
    const all = await tx("readonly", (s) => s.getAll() as IDBRequest<unknown[]>);
    const out: Instrument[] = [];
    for (const raw of all) {
      try {
        out.push(sanitize(raw));
      } catch {
        /* 壊れた項目は無視 */
      }
    }
    return out.sort((a, b) => (b.meta.updatedAt ?? b.meta.createdAt).localeCompare(a.meta.updatedAt ?? a.meta.createdAt));
  } catch {
    return [];
  }
}

export async function putInstrument(inst: Instrument): Promise<void> {
  const rec = { ...inst, meta: { ...inst.meta, updatedAt: new Date().toISOString() } };
  await tx("readwrite", (s) => s.put(JSON.parse(JSON.stringify(rec))));
}

export async function deleteInstrument(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}
