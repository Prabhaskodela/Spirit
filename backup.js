// SpiritHUB's backup on this device: every workspace you open is copied into this browser's storage
// (IndexedDB) with its messages, file details, files and Memories photos, and kept up to date while
// SpiritHUB is open. Files an admin moves off Supabase to free up space still open from this copy.
const DB_NAME = "spirithub-hub-backup";
let opened = null;

const settle = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function db() {
  opened ||= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("This browser can't keep a backup"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of ["messages", "files", "memories"]) database.createObjectStore(name, { keyPath: "id" }).createIndex("workspace", "workspace_id");
      database.createObjectStore("blobs", { keyPath: "path" }).createIndex("workspace", "workspace_id");
      database.createObjectStore("sync", { keyPath: "workspace_id" });
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        opened = null;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error);
  });
  opened.catch(() => { opened = null; }); // try again next time, for example after a private window's refusal
  return opened;
}

async function write(store, work) {
  const transaction = (await db()).transaction(store, "readwrite");
  work(transaction.objectStore(store));
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error("This device is out of space for the backup"));
  });
}

const read = async (store, work) => settle(work((await db()).transaction(store).objectStore(store)));

export const saveRows = (store, rows) => (rows.length ? write(store, (target) => rows.forEach((row) => target.put(row))) : Promise.resolve());
export const removeRows = (store, keys) => (keys.length ? write(store, (target) => keys.forEach((key) => target.delete(key))) : Promise.resolve());
export const rowsOf = (store, workspaceId) => read(store, (source) => source.index("workspace").getAll(workspaceId));
export const keysOf = (store, workspaceId) => read(store, (source) => source.index("workspace").getAllKeys(workspaceId));

export async function fileBlob(path) {
  return (await read("blobs", (source) => source.get(path)))?.blob || null;
}

export const saveBlob = (workspaceId, path, blob) => saveRows("blobs", [{ path, workspace_id: workspaceId, size: blob.size, blob }]);

export const syncRecord = (workspaceId) => read("sync", (source) => source.get(workspaceId));
export const saveSyncRecord = (record) => saveRows("sync", [record]);

// Removes one workspace's backup, after leaving or deleting it.
export async function forgetWorkspace(workspaceId) {
  for (const store of ["messages", "files", "memories", "blobs"]) await removeRows(store, await keysOf(store, workspaceId));
  await removeRows("sync", [workspaceId]);
}

// Deletes everything this browser saved, for example when signing out of a shared computer.
export async function forget() {
  const database = await opened?.catch(() => null);
  database?.close();
  opened = null;
  if (!globalThis.indexedDB) return;
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error || new Error("This device's backup could not be deleted"));
    request.onblocked = () => reject(new Error("Close other Spirited Workspace tabs before deleting this device's backup"));
  });
}
