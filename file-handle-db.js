/**
 * Persist a FileSystemFileHandle for CSV auto-refresh (File System Access API).
 * Handles cannot live in chrome.storage — IndexedDB is required.
 */

const DB_NAME = "brightstar-csv-source";
const STORE = "handles";
const KEY = "jobs-csv";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

export async function saveCsvFileHandle(handle) {
  if (!handle) throw new Error("No file handle to save.");
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to store file handle"));
    });
  } finally {
    db.close();
  }
}

export async function loadCsvFileHandle() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("Failed to load file handle"));
    });
  } finally {
    db.close();
  }
}

export async function clearCsvFileHandle() {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to clear file handle"));
    });
  } finally {
    db.close();
  }
}

/**
 * Ensure we can read the handle (may require a recent user gesture the first time).
 * @returns {"granted"|"denied"|"prompt"|null}
 */
export async function ensureHandlePermission(handle, { interactive = false } = {}) {
  if (!handle?.queryPermission) return null;
  const opts = { mode: "read" };
  let state = await handle.queryPermission(opts);
  if (state === "granted") return state;
  if (interactive && handle.requestPermission) {
    state = await handle.requestPermission(opts);
  }
  return state;
}

/** Read pinned CSV text if permission allows. */
export async function readPinnedCsvText({ interactive = false } = {}) {
  const handle = await loadCsvFileHandle();
  if (!handle) return { ok: false, reason: "no_handle" };
  const perm = await ensureHandlePermission(handle, { interactive });
  if (perm && perm !== "granted") {
    return { ok: false, reason: "permission", permission: perm, fileName: handle.name || "" };
  }
  try {
    const file = await handle.getFile();
    const text = await file.text();
    return {
      ok: true,
      text,
      fileName: file.name || handle.name || "jobs.csv",
      lastModified: file.lastModified || 0
    };
  } catch (err) {
    return { ok: false, reason: "read_error", error: String(err?.message || err) };
  }
}
