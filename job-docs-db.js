/**
 * Per-job resume + cover letter PDFs in IndexedDB.
 * chrome.storage.local cannot hold many base64 PDFs (quota / pruning), and
 * fetch(file://) is blocked in the extension — this is the durable cache.
 */

const DB_NAME = "brightstar_job_docs";
const DB_VERSION = 1;
const STORE = "docs";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("byCsvRow", "csvRow", { unique: false });
        store.createIndex("byJobDir", "jobDir", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open job-docs database."));
  });
  return dbPromise;
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function jobDocsId({ csvRow, jobDir } = {}) {
  if (csvRow != null && String(csvRow).trim() !== "" && !Number.isNaN(Number(csvRow))) {
    return `row:${Number(csvRow)}`;
  }
  const dir = String(jobDir || "").trim();
  return dir ? `dir:${dir}` : "";
}

export function docsHaveFile(docs, kind) {
  return Boolean(docs?.[kind]?.base64);
}

export async function putJobDocs(partial = {}) {
  const csvRow =
    partial.csvRow != null && String(partial.csvRow).trim() !== "" && !Number.isNaN(Number(partial.csvRow))
      ? Number(partial.csvRow)
      : null;
  const jobDir = String(partial.jobDir || partial.folderName || "").trim();
  const id = jobDocsId({ csvRow, jobDir });
  if (!id) return null;

  const db = await openDb();
  const prev = (await reqToPromise(db.transaction(STORE, "readonly").objectStore(STORE).get(id))) || {};
  const next = {
    id,
    csvRow: csvRow != null ? csvRow : prev.csvRow ?? null,
    jobDir: jobDir || prev.jobDir || "",
    folderName: jobDir || prev.folderName || prev.jobDir || "",
    jdLink: String(partial.jdLink || prev.jdLink || "").trim(),
    resume: docsHaveFile(partial, "resume") ? partial.resume : prev.resume || null,
    coverLetter: docsHaveFile(partial, "coverLetter") ? partial.coverLetter : prev.coverLetter || null,
    savedAt: Date.now()
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(next);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to store job PDFs."));
  });
  return next;
}

export async function getJobDocsById(id) {
  const key = String(id || "").trim();
  if (!key) return null;
  const db = await openDb();
  const row = await reqToPromise(db.transaction(STORE, "readonly").objectStore(STORE).get(key));
  return row && typeof row === "object" ? row : null;
}

function sameJobDir(a, b) {
  const left = String(a || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const right = String(b || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return Boolean(left && right && left === right);
}

function folderSegment(jobDir) {
  const parts = String(jobDir || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/** Folder names are `{csvRow} - {Company} - {Title}`. */
export function jobDirMatchesCsvRow(jobDir, csvRow) {
  if (csvRow == null || String(csvRow).trim() === "" || Number.isNaN(Number(csvRow))) return true;
  const segment = folderSegment(jobDir);
  if (!segment) return false;
  return new RegExp(`^${Number(csvRow)}\\s+-\\s+`).test(segment);
}

export async function getJobDocs({ csvRow, jobDir, jdLink } = {}) {
  const db = await openDb();
  const id = jobDocsId({ csvRow, jobDir });
  if (id) {
    const exact = await getJobDocsById(id);
    if (exact && (csvRow == null || jobDirMatchesCsvRow(exact.jobDir || exact.folderName, csvRow))) {
      return exact;
    }
  }

  const all = await reqToPromise(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
  const rows = Array.isArray(all) ? all : [];

  if (csvRow != null && String(csvRow).trim() !== "" && !Number.isNaN(Number(csvRow))) {
    const n = Number(csvRow);
    const byRow = rows.find((row) => Number(row?.csvRow) === n);
    if (byRow) return byRow;
    const byFolder = rows.find((row) => jobDirMatchesCsvRow(row?.jobDir || row?.folderName, n));
    if (byFolder) return byFolder;
    return null;
  }

  if (jobDir) {
    const byDir = rows.find(
      (row) => sameJobDir(row?.jobDir, jobDir) || sameJobDir(row?.folderName, jobDir)
    );
    if (byDir) return byDir;
  }

  const want = String(jdLink || "").trim().toLowerCase();
  if (want) {
    const byLink = rows.find((row) => String(row?.jdLink || "").trim().toLowerCase() === want);
    if (byLink) return byLink;
  }
  return null;
}
