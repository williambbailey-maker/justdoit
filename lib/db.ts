import {
  DEFAULT_LISTS,
  DEFAULT_SETTINGS,
  DONE_LIST_ID,
  List,
  TODAY_LIST_ID,
  TOMORROW_LIST_ID,
  SETTINGS_VERSION,
  Settings,
  Block,
  Task,
  VoiceNote,
} from "./types";

// Deliberately unchanged through the rename to swoosh — renaming the store
// would orphan every task and list already saved on the device.
const DB_NAME = "suush";
const DB_VERSION = 2;
const STORES = ["tasks", "lists", "notes", "blocks", "meta"] as const;
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

export const getTasks = async (): Promise<Task[]> => {
  const tasks = await all<Task>("tasks");
  // todayOn predates the Tomorrow view; fold it into plannedOn on read so
  // existing tags keep working without a write migration.
  return tasks.map((t) => (t.todayOn && !t.plannedOn ? { ...t, plannedOn: t.todayOn } : t));
};
export const saveTask = (t: Task) => put("tasks", t);
export const deleteTask = (id: string) => del("tasks", id);

/** System lists that shipped once and have since been withdrawn. Their rows
 *  linger in IndexedDB, so they are swept on read rather than left as dead
 *  tabs in the rail. */
const RETIRED_LIST_IDS = ["rundown"];

export const getLists = async (): Promise<List[]> => {
  let lists = await all<List>("lists");

  const retired = lists.filter((l) => RETIRED_LIST_IDS.includes(l.id));
  if (retired.length) {
    await Promise.all(retired.map((l) => del("lists", l.id)));
    lists = lists.filter((l) => !RETIRED_LIST_IDS.includes(l.id));
  }
  if (lists.length === 0) {
    await Promise.all(DEFAULT_LISTS.map((l) => put("lists", l)));
    return [...DEFAULT_LISTS].sort((a, b) => a.order - b.order);
  }
  // Devices set up before the system buckets existed won't have them yet.
  for (const id of [TODAY_LIST_ID, TOMORROW_LIST_ID, DONE_LIST_ID]) {
    if (lists.some((l) => l.id === id)) continue;
    const missing = DEFAULT_LISTS.find((l) => l.id === id)!;
    await put("lists", missing);
    lists.push(missing);
  }
  return lists.sort((a, b) => a.order - b.order);
};
export const saveList = (l: List) => put("lists", l);
export const deleteList = (id: string) => del("lists", id);

export const getBlocks = () => all<Block>("blocks");
export const saveBlock = (b: Block) => put("blocks", b);
export const deleteBlock = (id: string) => del("blocks", id);

/** Used when a task is deleted, so its scheduled slots go with it. */
export async function deleteBlocksForTask(taskId: string) {
  const blocks = await getBlocks();
  await Promise.all(blocks.filter((b) => b.taskId === taskId).map((b) => del("blocks", b.id)));
}

export const getNotes = () => all<VoiceNote>("notes");
export const saveNote = (n: VoiceNote) => put("notes", n);
export const deleteNote = (id: string) => del("notes", id);

export async function getSettings(): Promise<Settings> {
  const row = await tx<{ key: string; value: Settings } | undefined>("meta", "readonly", (s) =>
    s.get("settings"),
  );
  const stored = { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
  // Read the version off the raw row: the defaults spread would otherwise
  // stamp the current version onto an old object and skip the migration.
  const storedVersion = row === undefined ? SETTINGS_VERSION : (row.value?.v ?? 1);

  // Settings saved before the current version need bringing forward, or the
  // defaults below would never reach a device that already has a settings row.
  //   v2: shortened the launch animation from 4s to 2s.
  //   v3: dark is the default theme, not "match my device".
  if (storedVersion < SETTINGS_VERSION) {
    const migrated = { ...stored, v: SETTINGS_VERSION };
    if (storedVersion < 2) migrated.splashSeconds = 2;
    if (storedVersion < 3) migrated.theme = "dark";
    await saveSettings(migrated);
    return migrated;
  }
  return stored;
}

export const saveSettings = (value: Settings) => put("meta", { key: "settings", value });

export async function exportAll() {
  const [tasks, lists, notes, blocks, settings] = await Promise.all([
    getTasks(),
    getLists(),
    getNotes(),
    getBlocks(),
    getSettings(),
  ]);
  // The code hash is device-local; leaving it out keeps backups portable.
  const { codeHash: _codeHash, apiKey: _apiKey, ...safeSettings } = settings;
  return { version: 2, exportedAt: Date.now(), tasks, lists, notes, blocks, settings: safeSettings };
}

export async function importAll(data: {
  tasks?: Task[];
  lists?: List[];
  notes?: VoiceNote[];
  blocks?: Block[];
  settings?: Partial<Settings>;
}) {
  const current = await getSettings();
  await Promise.all([
    ...(data.lists ?? []).map((l) => put("lists", l)),
    ...(data.tasks ?? []).map((t) => put("tasks", t)),
    ...(data.notes ?? []).map((n) => put("notes", n)),
    ...(data.blocks ?? []).map((b) => put("blocks", b)),
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
