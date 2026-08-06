import { DEFAULT_LISTS, DEFAULT_SETTINGS, List, Settings, Task, VoiceNote } from "./types";

const DB_NAME = "suush";
const DB_VERSION = 1;
const STORES = ["tasks", "lists", "notes", "meta"] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === "meta" ? "key" : "id" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

const all = <T>(store: StoreName) => tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
const put = <T>(store: StoreName, value: T) => tx(store, "readwrite", (s) => s.put(value));
const del = (store: StoreName, id: string) => tx(store, "readwrite", (s) => s.delete(id));

export const getTasks = () => all<Task>("tasks");
export const saveTask = (t: Task) => put("tasks", t);
export const deleteTask = (id: string) => del("tasks", id);

export const getLists = async (): Promise<List[]> => {
  const lists = await all<List>("lists");
  if (lists.length === 0) {
    await Promise.all(DEFAULT_LISTS.map((l) => put("lists", l)));
    return [...DEFAULT_LISTS];
  }
  return lists.sort((a, b) => a.order - b.order);
};
export const saveList = (l: List) => put("lists", l);
export const deleteList = (id: string) => del("lists", id);

export const getNotes = () => all<VoiceNote>("notes");
export const saveNote = (n: VoiceNote) => put("notes", n);
export const deleteNote = (id: string) => del("notes", id);

export async function getSettings(): Promise<Settings> {
  const row = await tx<{ key: string; value: Settings } | undefined>("meta", "readonly", (s) =>
    s.get("settings"),
  );
  return { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
}

export const saveSettings = (value: Settings) => put("meta", { key: "settings", value });

export async function exportAll() {
  const [tasks, lists, notes, settings] = await Promise.all([
    getTasks(),
    getLists(),
    getNotes(),
    getSettings(),
  ]);
  // The code hash is device-local; leaving it out keeps backups portable.
  const { codeHash: _codeHash, apiKey: _apiKey, ...safeSettings } = settings;
  return { version: 1, exportedAt: Date.now(), tasks, lists, notes, settings: safeSettings };
}

export async function importAll(data: {
  tasks?: Task[];
  lists?: List[];
  notes?: VoiceNote[];
  settings?: Partial<Settings>;
}) {
  const current = await getSettings();
  await Promise.all([
    ...(data.lists ?? []).map((l) => put("lists", l)),
    ...(data.tasks ?? []).map((t) => put("tasks", t)),
    ...(data.notes ?? []).map((n) => put("notes", n)),
  ]);
  if (data.settings) {
    // Never let an import overwrite this device's lock code or key.
    await saveSettings({ ...current, ...data.settings, codeHash: current.codeHash, apiKey: current.apiKey });
  }
}

export async function wipeAll() {
  const db = await open();
  await Promise.all(
    STORES.map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const req = db.transaction(name, "readwrite").objectStore(name).clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        }),
    ),
  );
}
