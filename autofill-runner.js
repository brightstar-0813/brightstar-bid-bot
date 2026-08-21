/**
 * Application autofill orchestrator.
 * Injects content/autofill.js into all frames, fills from the active person,
 * then answers leftover questions from extras + the Q&A bank, then OpenAI.
 * Multi-step Apply clicks Next/Continue but never auto-submits unless
 * autoSubmit is explicitly enabled (Dice interleaved batch only).
 */

import { getApplicantInfoForAutofill, applyLearnedApplicantField, mergeAutofillExtras, getActivePerson } from "./profiles.js";
import { buildWorkHistory, buildEducationHistory, hasFormHistory } from "./history.js";
import { findQaMatch, saveQa, recordQaUsage, normalizeQuestion, questionSimilarity } from "./qa-store.js";
import { getEnv } from "./env.js";
import { DEFAULT_OPENAI_MODEL } from "./openai.js";
import { normalizeJobLink } from "./sheets.js";
import { NATIVE_HOST_NAME } from "./csv-source.js";
import {
  generateHumanizedApplicationAnswers,
  generateConstrainedChoiceAnswers,
  shouldBankAnswer,
  isCertificationQuestion,
  answerCertificationQuestion,
  parseCertificationList,
  certificationsFromText,
  bankAnswerFitsQuestion
} from "./ai-answers.js";
import {
  docsHaveFile,
  getJobDocs,
  jobDirMatchesCsvRow,
  jobDocsId,
  putJobDocs
} from "./job-docs-db.js";

const LAST_DOCS_KEY = "last_generated_docs";
const JOB_DOCS_KEY = "job_generated_docs";
const MAX_JOB_DOCS = 40;
const AUTOFILL_SCRIPT_BUILD = "2026-08-19.03";
const APPLY_SETTLE_MS = 2200;

let lastFocusedNormalWindowId = null;

try {
  chrome.windows.getLastFocused({ windowTypes: ["normal"] }).then((win) => {
    if (win?.id != null) lastFocusedNormalWindowId = win.id;
  }).catch(() => {});
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    chrome.windows.get(windowId).then((win) => {
      if (win?.type === "normal") lastFocusedNormalWindowId = windowId;
    }).catch(() => {});
  });
} catch {
  /* windows API may be unavailable in some contexts */
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function setApplyStatus(status) {
  try {
    await chrome.storage.local.set({ generation_status: status });
  } catch {
    /* ignore */
  }
}

export async function setLastGeneratedDocs(partial = {}) {
  const prev = await getLastGeneratedDocs();
  const next = {
    resume: partial.resume !== undefined ? partial.resume : prev?.resume || null,
    coverLetter: partial.coverLetter !== undefined ? partial.coverLetter : prev?.coverLetter || null,
    folderName: partial.folderName || partial.jobDir || prev?.folderName || "",
    csvRow: partial.csvRow != null ? partial.csvRow : prev?.csvRow,
    jdLink: partial.jdLink || prev?.jdLink || "",
    savedAt: Date.now()
  };
  try {
    await chrome.storage.local.set({ [LAST_DOCS_KEY]: next });
  } catch {
    /* quota — skip PDF cache */
  }
  await persistJobGeneratedDocs({
    csvRow: next.csvRow,
    jobDir: next.folderName,
    folderName: next.folderName,
    jdLink: next.jdLink,
    resume: partial.resume !== undefined ? partial.resume : undefined,
    coverLetter: partial.coverLetter !== undefined ? partial.coverLetter : undefined
  }).catch(() => {});
  return next;
}

export async function getLastGeneratedDocs() {
  const data = await chrome.storage.local.get(LAST_DOCS_KEY);
  const docs = data[LAST_DOCS_KEY];
  return docs && typeof docs === "object" ? docs : null;
}

function hasCsvRow(csvRow) {
  return csvRow != null && String(csvRow).trim() !== "" && !Number.isNaN(Number(csvRow));
}

function folderSegment(jobDir) {
  const parts = String(jobDir || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function toStoredJobDir(absPath) {
  const n = String(absPath || "").replace(/\\/g, "/");
  if (!n) return "";
  const marker = "/Resume Applications/";
  const lower = n.toLowerCase();
  const i = lower.lastIndexOf(marker.toLowerCase());
  if (i >= 0) return `Resume Applications/${n.slice(i + marker.length)}`;
  const segment = folderSegment(n);
  return segment ? `Resume Applications/${segment}` : n;
}

function folderFitsJob(jobDir, job = {}) {
  const csvRow = job.csvRow;
  if (!jobDirMatchesCsvRow(jobDir, csvRow)) return false;
  const company = String(job.company || job.companyName || "").trim().toLowerCase();
  if (!company) return true;
  const name = folderSegment(jobDir).toLowerCase();
  const token = company.replace(/[<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim();
  return !token || name.includes(token.slice(0, 24));
}

async function listJobFoldersFromDownloads() {
  if (!chrome.downloads?.search) return [];
  let results = [];
  try {
    results = await chrome.downloads.search({
      filenameRegex: "Resume Applications[\\\\/]\\d+\\s+-\\s+",
      limit: 1000,
      orderBy: ["-startTime"]
    });
  } catch {
    results = [];
  }
  const byRow = new Map();
  for (const row of results || []) {
    const path = String(row?.filename || "").replace(/\\/g, "/");
    const match = path.match(/Resume Applications\/(\d+)\s+-\s+[^/]+/i);
    if (!match) continue;
    const csvRow = Number(match[1]);
    const folder = match[0].replace(/\//g, "/");
    const name = folder.split("/").pop();
    const prev = byRow.get(csvRow) || {
      csvRow,
      jobDir: `Resume Applications/${name}`,
      name,
      hasResume: false,
      hasCover: false,
      resumeName: "",
      coverName: ""
    };
    const fileName = path.split("/").pop() || "";
    if (isResumeDownload(path)) {
      prev.hasResume = true;
      prev.resumeName = prev.resumeName || fileName;
    }
    if (isCoverLetterDownload(path)) {
      prev.hasCover = true;
      prev.coverName = prev.coverName || fileName;
    }
    byRow.set(csvRow, prev);
  }
  return [...byRow.values()];
}

export async function listJobFoldersFromDisk() {
  try {
    const res = await sendNativeMessage({ type: "list_job_folders" });
    if (res?.ok && Array.isArray(res.folders)) {
      return res.folders.map((f) => ({
        csvRow: Number(f.csvRow),
        jobDir: toStoredJobDir(f.folder || f.name),
        absPath: f.folder || "",
        name: f.name || folderSegment(f.folder),
        hasResume: Boolean(f.hasResume),
        hasCover: Boolean(f.hasCover),
        resumeName: f.resumeName || "",
        coverName: f.coverName || ""
      }));
    }
  } catch {
    /* native host missing — fall through */
  }
  return listJobFoldersFromDownloads();
}

export async function locateJobFolder({ csvRow, jobDir, jdLink, company, title, companyName, jobTitle } = {}) {
  const located = await lookupSavedJobFolder({ csvRow, jobDir, jdLink });
  if (located.jobDir && jobDirMatchesCsvRow(located.jobDir, csvRow)) return located;
  if (!hasCsvRow(csvRow)) return located;
  const n = Number(csvRow);
  const folders = await listJobFoldersFromDisk();
  const job = {
    csvRow: n,
    company: company || companyName || "",
    companyName: companyName || company || "",
    title: title || jobTitle || "",
    jobTitle: jobTitle || title || ""
  };
  const hit =
    folders.find((f) => Number(f.csvRow) === n && folderFitsJob(f.jobDir, job)) ||
    folders.find((f) => Number(f.csvRow) === n);
  if (!hit) return located;
  return { ...located, csvRow: n, jobDir: hit.jobDir };
}

export async function hydrateJobsWithFolders(jobs = []) {
  const list = Array.isArray(jobs) ? jobs : [];
  if (!list.length) return list;
  const folders = await listJobFoldersFromDisk();
  if (!folders.length) return list;
  const byRow = new Map(folders.map((f) => [Number(f.csvRow), f]));
  return list.map((job) => {
    const n = Number(job.csvRow);
    const existing = String(job.jobDir || "").trim();
    const hit = byRow.get(n);
    if (existing && jobDirMatchesCsvRow(existing, n)) {
      return {
        ...job,
        hasFiles: true,
        resumeName: job.resumeName || hit?.resumeName || "",
        coverName: job.coverName || hit?.coverName || ""
      };
    }
    if (!hit?.jobDir) return job;
    return {
      ...job,
      jobDir: hit.jobDir,
      hasFiles: Boolean(hit.hasResume || hit.hasCover || hit.jobDir),
      resumeName: job.resumeName || hit.resumeName || "",
      coverName: job.coverName || hit.coverName || ""
    };
  });
}

function downloadPathInJobFolder(absPath, jobDir, csvRow) {
  const norm = String(absPath || "").replace(/\\/g, "/").toLowerCase();
  if (!norm) return false;
  const segment = folderSegment(jobDir).toLowerCase();
  if (segment && (norm.includes(`/${segment}/`) || norm.endsWith(`/${segment}`))) {
    return !hasCsvRow(csvRow) || jobDirMatchesCsvRow(jobDir, csvRow);
  }
  if (hasCsvRow(csvRow)) {
    return new RegExp(`/${Number(csvRow)}\\s+-\\s+[^/]+/`).test(norm);
  }
  return false;
}

async function readJobDocsMap() {
  const data = await chrome.storage.local.get(JOB_DOCS_KEY);
  return data[JOB_DOCS_KEY] && typeof data[JOB_DOCS_KEY] === "object" ? data[JOB_DOCS_KEY] : {};
}

async function persistJobGeneratedDocs(partial = {}) {
  const csvRow = hasCsvRow(partial.csvRow) ? Number(partial.csvRow) : null;
  const jobDir = String(partial.jobDir || partial.folderName || "").trim();
  const id = jobDocsId({ csvRow, jobDir });
  if (!id) return null;

  const stored = await putJobDocs(partial).catch(() => null);

  const map = await readJobDocsMap();
  const prev = map[id] || {};
  map[id] = {
    ...prev,
    csvRow: csvRow != null ? csvRow : prev.csvRow,
    jobDir: jobDir || prev.jobDir || "",
    jdLink: String(partial.jdLink || prev.jdLink || "").trim(),
    resume: docsHaveFile(partial, "resume") ? partial.resume : prev.resume || null,
    coverLetter: docsHaveFile(partial, "coverLetter") ? partial.coverLetter : prev.coverLetter || null,
    savedAt: Date.now()
  };
  const ranked = Object.entries(map).sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0));
  const pruned = Object.fromEntries(
    ranked.slice(0, MAX_JOB_DOCS).map(([key, row]) => [
      key,
      {
        csvRow: row?.csvRow,
        jobDir: row?.jobDir || "",
        jdLink: row?.jdLink || "",
        resumeName: row?.resume?.fileName || row?.resumeName || "",
        coverName: row?.coverLetter?.fileName || row?.coverName || "",
        savedAt: row?.savedAt || Date.now()
      }
    ])
  );
  try {
    await chrome.storage.local.set({ [JOB_DOCS_KEY]: pruned });
  } catch {
    /* quota — IndexedDB still holds the PDFs */
  }
  return stored || map[id];
}

function pickJobDocsFromMap(map, { csvRow, jobDir, jdLink } = {}) {
  const rows = Object.values(map);
  if (hasCsvRow(csvRow)) {
    const n = Number(csvRow);
    const id = jobDocsId({ csvRow: n, jobDir });
    if (id && map[id] && (jobDirMatchesCsvRow(map[id].jobDir, n) || !map[id].jobDir)) {
      return map[id];
    }
    const byRow = rows.find((row) => Number(row?.csvRow) === n);
    if (byRow) return byRow;
    const byFolder = rows.find((row) => jobDirMatchesCsvRow(row?.jobDir, n));
    if (byFolder) return byFolder;
    return null;
  }
  if (jobDir) {
    const byDir = rows.find((row) => String(row?.jobDir || "") === String(jobDir));
    if (byDir) return byDir;
  }
  const want = normalizeJobLink(jdLink || "");
  if (want) {
    const byLink = rows.find((row) => normalizeJobLink(row?.jdLink || "") === want);
    if (byLink) return byLink;
  }
  return null;
}

async function lookupSavedJobFolder({ csvRow, jobDir, jdLink } = {}) {
  const data = await chrome.storage.local.get(["job_queue", "apply_history"]);
  const queue = Array.isArray(data.job_queue) ? data.job_queue : [];
  const hist = data.apply_history && typeof data.apply_history === "object" ? data.apply_history : {};

  if (hasCsvRow(csvRow)) {
    const n = Number(csvRow);
    const job = queue.find((j) => Number(j.csvRow) === n);
    const remembered = hist[String(n)];
    const fromQueue = String(job?.jobDir || "").trim();
    const fromHist = String(remembered?.jobDir || "").trim();
    const passed = String(jobDir || "").trim();
    const chosen =
      (fromQueue && jobDirMatchesCsvRow(fromQueue, n) && fromQueue) ||
      (fromHist && jobDirMatchesCsvRow(fromHist, n) && fromHist) ||
      (passed && jobDirMatchesCsvRow(passed, n) && passed) ||
      "";
    if (!chosen) {
      const folders = await listJobFoldersFromDisk();
      const hit = folders.find((f) => Number(f.csvRow) === n);
      if (hit?.jobDir) {
        return {
          csvRow: n,
          jobDir: hit.jobDir,
          jdLink: job?.jdLink || remembered?.jdLink || jdLink
        };
      }
    }
    return {
      csvRow: n,
      jobDir: chosen,
      jdLink: job?.jdLink || remembered?.jdLink || jdLink
    };
  }

  if (jobDir) return { csvRow, jobDir, jdLink };

  const want = normalizeJobLink(jdLink || "");
  if (want) {
    const job = queue.find((j) => normalizeJobLink(j?.jdLink || "") === want);
    if (job?.jobDir) {
      return { csvRow: job.csvRow, jobDir: job.jobDir, jdLink: job.jdLink || jdLink };
    }
    const remembered = Object.values(hist).find(
      (row) => normalizeJobLink(row?.jdLink || "") === want && row?.jobDir
    );
    if (remembered?.jobDir) {
      return { csvRow: remembered.csvRow, jobDir: remembered.jobDir, jdLink: remembered.jdLink || jdLink };
    }
  }
  return { csvRow, jobDir: "", jdLink };
}

function downloadPrefixRegex(jobDir) {
  const segment = folderSegment(jobDir);
  const target = segment || String(jobDir || "");
  return `${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\//g, "[\\\\/]")}.*`;
}

function isResumeDownload(filename) {
  const name = String(filename || "").replace(/\\/g, "/").split("/").pop() || "";
  return /resume\.pdf$/i.test(name) && !/cover/i.test(name);
}

function isCoverLetterDownload(filename) {
  const name = String(filename || "").replace(/\\/g, "/").split("/").pop() || "";
  return /cover[\s_-]*letter\.pdf$/i.test(name);
}

function sendNativeMessage(payload, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.sendNativeMessage) {
      reject(new Error("Native messaging is not available."));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Native host timed out."));
    }, timeoutMs);
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const err = chrome.runtime.lastError?.message;
      if (err) {
        reject(new Error(err));
        return;
      }
      resolve(response);
    });
  });
}

function nativeFileToDoc(res, fallbackName) {
  if (!res || res.ok === false || !res.base64) return null;
  return {
    fileName: res.fileName || fallbackName,
    mimeType: res.mimeType || "application/pdf",
    base64: res.base64
  };
}

async function readPdfViaNative(absPath, fallbackName) {
  const path = String(absPath || "").trim();
  if (!path) return null;
  try {
    const res = await sendNativeMessage({ type: "read_file", path });
    return nativeFileToDoc(res, fallbackName);
  } catch {
    return null;
  }
}

async function loadDocsFromNativeHost({ csvRow, jobDir } = {}) {
  try {
    const found = await sendNativeMessage({
      type: "read_job_docs",
      csvRow: hasCsvRow(csvRow) ? Number(csvRow) : "",
      jobDir: String(jobDir || "").trim()
    });
    if (!found?.ok) return null;
    const resume =
      nativeFileToDoc(found.resume, found.resumeName || "Resume.pdf") ||
      (found.resumePath ? await readPdfViaNative(found.resumePath, found.resumeName || "Resume.pdf") : null);
    const coverLetter =
      nativeFileToDoc(found.coverLetter, found.coverName || "Cover_Letter.pdf") ||
      (found.coverPath ? await readPdfViaNative(found.coverPath, found.coverName || "Cover_Letter.pdf") : null);
    if (!resume && !coverLetter) return null;
    return {
      resume,
      coverLetter,
      folderName: found.folder || jobDir || "",
      jobDir: found.folder || jobDir || "",
      csvRow: hasCsvRow(csvRow) ? Number(csvRow) : found.csvRow,
      via: "native"
    };
  } catch {
    return null;
  }
}

async function findDownloadItemsForJob({ csvRow, jobDir } = {}) {
  if (!chrome.downloads?.search) return [];
  const prefix = String(jobDir || "").trim();
  let results = [];
  if (prefix) {
    try {
      results = await chrome.downloads.search({
        filenameRegex: downloadPrefixRegex(prefix),
        limit: 40,
        orderBy: ["-startTime"]
      });
    } catch {
      results = [];
    }
  }
  if (!results?.length && hasCsvRow(csvRow)) {
    try {
      results = await chrome.downloads.search({
        filenameRegex: `${Number(csvRow)}\\s+-\\s+.*`,
        limit: 40,
        orderBy: ["-startTime"]
      });
    } catch {
      results = [];
    }
  }
  return (results || []).filter((row) => {
    if (!row?.filename || row.state !== "complete") return false;
    return downloadPathInJobFolder(row.filename, prefix, csvRow);
  });
}

async function loadDocsFromDownloads({ csvRow, jobDir } = {}) {
  const items = await findDownloadItemsForJob({ csvRow, jobDir });
  const resumeItem = items.find((row) => isResumeDownload(row.filename));
  const coverItem = items.find((row) => isCoverLetterDownload(row.filename));
  const resume = resumeItem ? await readPdfViaNative(resumeItem.filename, "Resume.pdf") : null;
  const coverLetter = coverItem ? await readPdfViaNative(coverItem.filename, "Cover_Letter.pdf") : null;
  if (!resume && !coverLetter) return null;
  return {
    resume,
    coverLetter,
    folderName: jobDir || "",
    jobDir: jobDir || "",
    csvRow: hasCsvRow(csvRow) ? Number(csvRow) : undefined,
    via: "downloads"
  };
}

function lastDocsMatchJob(last, { csvRow, jobDir } = {}) {
  if (!last) return false;
  if (hasCsvRow(csvRow)) {
    if (Number(last.csvRow) === Number(csvRow)) return true;
    return jobDirMatchesCsvRow(last.folderName || last.jobDir, csvRow);
  }
  if (jobDir) {
    return String(last.folderName || last.jobDir || "") === String(jobDir);
  }
  return false;
}

/**
 * Resume + cover letter PDFs for this CSV row / job folder — never another row.
 */
export async function resolveUploadDocs({ csvRow, jobDir, jdLink } = {}) {
  const located = await lookupSavedJobFolder({ csvRow, jobDir, jdLink });
  let docs = await getJobDocs(located).catch(() => null);
  if (!docsHaveFile(docs, "resume") || !docsHaveFile(docs, "coverLetter")) {
    const map = await readJobDocsMap();
    const fromMap = pickJobDocsFromMap(map, located);
    if (fromMap) {
      docs = {
        ...(docs || {}),
        ...fromMap,
        resume: docsHaveFile(docs, "resume") ? docs.resume : fromMap.resume,
        coverLetter: docsHaveFile(docs, "coverLetter") ? docs.coverLetter : fromMap.coverLetter
      };
    }
  }

  if (!docsHaveFile(docs, "resume") || !docsHaveFile(docs, "coverLetter")) {
    const fromNative = await loadDocsFromNativeHost(located);
    const fromDisk = fromNative || (await loadDocsFromDownloads(located));
    if (fromDisk) {
      docs = {
        ...(docs || {}),
        resume: docsHaveFile(docs, "resume") ? docs.resume : fromDisk.resume,
        coverLetter: docsHaveFile(docs, "coverLetter") ? docs.coverLetter : fromDisk.coverLetter,
        jobDir: fromDisk.jobDir || located.jobDir,
        csvRow: located.csvRow,
        jdLink: located.jdLink,
        folderName: fromDisk.folderName || located.jobDir
      };
      await persistJobGeneratedDocs(docs).catch(() => {});
    }
  }

  const last = await getLastGeneratedDocs();
  if (lastDocsMatchJob(last, located)) {
    if (!docsHaveFile(docs, "resume") && docsHaveFile(last, "resume")) {
      docs = { ...(docs || {}), resume: last.resume, folderName: located.jobDir, csvRow: located.csvRow };
    }
    if (!docsHaveFile(docs, "coverLetter") && docsHaveFile(last, "coverLetter")) {
      docs = { ...(docs || {}), coverLetter: last.coverLetter, folderName: located.jobDir, csvRow: located.csvRow };
    }
  }

  return docs;
}

export async function setActiveApplyJob({ csvRow, jobDir, jdLink } = {}) {
  await chrome.storage.local.set({
    last_apply_csv_row: csvRow != null && String(csvRow).trim() !== "" ? Number(csvRow) : "",
    last_apply_job_dir: String(jobDir || "").trim(),
    last_apply_jd_link: String(jdLink || "").trim()
  });
}

export async function getStoredResumeJson() {
  const data = await chrome.storage.local.get("last_resume_json");
  const resume = data.last_resume_json;
  return resume && typeof resume === "object" ? resume : null;
}

export function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const isReady = (tab) => {
      const url = String(tab?.url || "");
      return tab?.status === "complete" && /^https?:\/\//i.test(url);
    };
    const timer = setTimeout(done, timeoutMs);
    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete" && isReady(tab)) done();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (isReady(tab)) done();
      })
      .catch(() => {});
  });
}

export async function getCurrentApplicationTab() {
  const normalWindows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal"]
  });

  const tracked =
    (lastFocusedNormalWindowId != null &&
      normalWindows.find((w) => w.id === lastFocusedNormalWindowId)) ||
    null;
  const activeInTracked = tracked?.tabs?.find((t) => t.active) || null;
  if (activeInTracked?.id != null && /^https?:\/\//i.test(activeInTracked.url || "")) {
    return activeInTracked;
  }

  const focusedNormal =
    normalWindows.find((w) => w.focused) ||
    normalWindows.find((w) => w.tabs?.some((t) => t.active)) ||
    null;
  const activeInFocused = focusedNormal?.tabs?.find((t) => t.active) || null;
  if (activeInFocused?.id != null && /^https?:\/\//i.test(activeInFocused.url || "")) {
    return activeInFocused;
  }

  for (const win of normalWindows) {
    const active = win.tabs?.find((t) => t.active);
    if (active?.id != null && /^https?:\/\//i.test(active.url || "")) return active;
  }

  const httpTabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  return httpTabs.find((t) => t.active) || httpTabs[0] || null;
}

async function ensureAutofillScript(tabId) {
  const ping = async () => {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: "autofill_ping" });
      return pong?.build === AUTOFILL_SCRIPT_BUILD;
    } catch {
      return false;
    }
  };
  if (await ping()) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content/autofill.js"]
    });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/autofill.js"]
    }).catch(() => {});
  }
  await sleep(250);
  if (await ping()) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/autofill.js"]
  }).catch(() => {});
}

async function sendMessageToTab(tabId, message, { attempts = 3, retryDelayMs = 200, frameId } = {}) {
  let lastErr = null;
  const opts = frameId != null ? { frameId } : {};
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message, opts);
    } catch (err) {
      lastErr = err;
      await sleep(retryDelayMs * (i + 1));
    }
  }
  throw lastErr || new Error("Failed to send message to tab.");
}

async function listTabFrameIds(tabId) {
  try {
    // Inject the real file rather than a `func` probe: enumerating frames this
    // way also guarantees the autofill script is present in each one.
    const infos = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content/autofill.js"]
    });
    const ids = (infos || [])
      .map((row) => row.frameId)
      .filter((id) => typeof id === "number");
    if (ids.length) return ids;
  } catch {
    /* fall through */
  }
  return [0];
}

async function sendMessageToAllFrames(tabId, message, { attempts = 2 } = {}) {
  await ensureAutofillScript(tabId);
  const frameIds = await listTabFrameIds(tabId);
  const results = [];
  for (const frameId of frameIds) {
    try {
      const res = await sendMessageToTab(tabId, message, { attempts, frameId });
      if (res != null) results.push({ frameId, ...(typeof res === "object" ? res : { ok: true }) });
    } catch {
      /* cross-origin or missing script */
    }
  }
  return results;
}

function mergeAutofillFrameResults(frameResults = []) {
  const merged = {
    ok: false,
    filledCount: 0,
    filled: [],
    credentialFilledCount: 0,
    credentialFilled: [],
    uploadedCount: 0,
    uploaded: [],
    uploadSkipped: [],
    unmatchedQuestions: [],
    unmatchedChoiceQuestions: [],
    frameResults
  };

  for (const r of frameResults) {
    if (!r || r.ok === false) continue;
    merged.ok = true;
    merged.filledCount += Number(r.filledCount || 0);
    if (Array.isArray(r.filled)) merged.filled.push(...r.filled);
    merged.credentialFilledCount += Number(r.credentialFilledCount || 0);
    if (Array.isArray(r.credentialFilled)) {
      for (const c of r.credentialFilled) {
        if (!merged.credentialFilled.includes(c)) merged.credentialFilled.push(c);
      }
    }
    merged.uploadedCount += Number(r.uploadedCount || 0);
    if (Array.isArray(r.uploaded)) merged.uploaded.push(...r.uploaded);
    if (Array.isArray(r.uploadSkipped)) merged.uploadSkipped.push(...r.uploadSkipped);
    if (Array.isArray(r.unmatchedQuestions)) {
      for (const q of r.unmatchedQuestions) {
        merged.unmatchedQuestions.push({ ...q, frameId: r.frameId });
      }
    }
    if (Array.isArray(r.unmatchedChoiceQuestions)) {
      for (const q of r.unmatchedChoiceQuestions) {
        merged.unmatchedChoiceQuestions.push({ ...q, frameId: r.frameId });
      }
    }
  }

  return merged;
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

function matchExtraAnswer(questionLabel, extras = {}, options = []) {
  const qNorm = normalizeQuestion(questionLabel);
  if (!qNorm) return null;
  let best = null;
  for (const [key, value] of Object.entries(extras || {})) {
    const v = String(value || "").trim();
    if (!v) continue;
    const kNorm = normalizeQuestion(key);
    if (!kNorm) continue;
    let score = questionSimilarity(qNorm, kNorm);
    if (qNorm.includes(kNorm) || kNorm.includes(qNorm)) score = Math.max(score, 0.86);
    if (!best || score > best.score) best = { answer: v, score, key };
  }
  if (!best || best.score < 0.55) return null;

  if (Array.isArray(options) && options.length) {
    const want = normalizeQuestion(best.answer);
    const hit = options.find((opt) => {
      const o = normalizeQuestion(opt);
      return o === want || o.includes(want) || want.includes(o);
    });
    if (hit) return { ...best, answer: hit };
  }
  return best;
}

function isJunkAutofillAnswer(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return true;
  return /format paragraph|heading dropdown|we want to hear from you/.test(t);
}

/** Shared Braintrust wrapper text should not make two client essays look like the same question. */
function clientPromptBody(label) {
  return normalizeQuestion(label)
    .replace(/please answer this question from the client/g, " ")
    .replace(/\brequired\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function essayBankMatchIsSpecific(questionLabel, recordQuestion) {
  const a = clientPromptBody(questionLabel);
  const b = clientPromptBody(recordQuestion || "");
  if (!a || !b) return false;
  if (isCertificationQuestion(a) !== isCertificationQuestion(b)) return false;
  if (a === b) return true;
  return questionSimilarity(a, b) >= (isCertificationQuestion(a) ? 0.9 : 0.78);
}

async function loadAutofillCertifications(applicantInfo = {}) {
  const chunks = [applicantInfo.certifications];
  try {
    const resume = await getStoredResumeJson();
    chunks.push(resume?.certifications);
  } catch {
    /* ignore */
  }
  try {
    const person = await getActivePerson();
    chunks.push(person?.autofillExtras?.certifications);
    chunks.push(person?.masterResume);
    chunks.push(person?.promptTemplate);
  } catch {
    /* ignore */
  }
  const seen = new Set();
  const out = [];
  for (const chunk of chunks) {
    const list =
      typeof chunk === "string" && chunk.length > 400
        ? certificationsFromText(chunk)
        : parseCertificationList(chunk);
    for (const row of list) {
      const key = row.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

async function withResumeCertifications(applicantInfo = {}) {
  const certifications = await loadAutofillCertifications(applicantInfo);
  return { ...applicantInfo, certifications };
}

async function resolveQuestionAnswers(
  questions,
  extras,
  profileId,
  site,
  { choice = false, applicantInfo = {} } = {}
) {
  const list = (questions || []).filter((q) => q?.id && q?.label);
  const resolved = [];
  let bankHits = 0;
  let extraHits = 0;
  const certs = parseCertificationList(applicantInfo.certifications);

  for (const q of list) {
    const certAnswer =
      !choice && isCertificationQuestion(q.label)
        ? answerCertificationQuestion(q.label, certs)
        : "";
    if (certAnswer) {
      resolved.push({ id: q.id, answer: certAnswer, source: "profile" });
      saveQa({
        profileId: profileId || "",
        question: q.label,
        answer: certAnswer,
        fieldType: q.fieldType || "textarea",
        source: "profile",
        site
      }).catch(() => {});
      extraHits += 1;
      continue;
    }

    let match = null;
    try {
      match = await findQaMatch(profileId, q.label);
    } catch {
      match = null;
    }
    const bankAnswer = String(match?.record?.answer || "").trim();
    const essayLike = Boolean(q.multiline) || q.fieldType === "textarea";
    const bankOk =
      bankAnswer &&
      !isJunkAutofillAnswer(bankAnswer) &&
      bankAnswerFitsQuestion(q.label, bankAnswer) &&
      (!essayLike || essayBankMatchIsSpecific(q.label, match.record.question));
    if (bankOk) {
      resolved.push({ id: q.id, answer: bankAnswer, source: "bank" });
      recordQaUsage(match.record.id).catch(() => {});
      bankHits += 1;
      continue;
    }

    const extra = matchExtraAnswer(q.label, extras, choice ? q.options || [] : []);
    if (
      extra?.answer &&
      !isJunkAutofillAnswer(extra.answer) &&
      bankAnswerFitsQuestion(q.label, extra.answer)
    ) {
      resolved.push({ id: q.id, answer: extra.answer, source: "extra" });
      extraHits += 1;
      saveQa({
        profileId: profileId || "",
        question: q.label,
        answer: extra.answer,
        fieldType: q.fieldType || (choice ? "select" : "text"),
        source: "extra",
        site
      }).catch(() => {});
    }
  }

  resolved.bankHits = bankHits;
  resolved.extraHits = extraHits;
  return resolved;
}

async function loadFormHistory(applicantInfo = {}) {
  const resume = (await getStoredResumeJson()) || {};
  return {
    workHistory: buildWorkHistory(resume),
    educationHistory: buildEducationHistory(resume, applicantInfo)
  };
}

function pickBestApplyAction(frameResults = []) {
  const rank = { next: 1, review: 2, entry: 3, submit: 4 };
  let best = null;
  for (const f of frameResults) {
    if (!f?.action?.type) continue;
    const cand = {
      frameId: f.frameId,
      action: f.action,
      signature: f.signature || "",
      href: f.href || "",
      isApplicationForm: Boolean(f.isApplicationForm)
    };
    if (!best) {
      best = cand;
      continue;
    }
    const br = rank[best.action.type] ?? 9;
    const cr = rank[cand.action.type] ?? 9;
    if (cr < br) best = cand;
    else if (cr === br && cand.isApplicationForm && !best.isApplicationForm) best = cand;
  }
  return {
    best,
    anyForm: frameResults.some((f) => f?.isApplicationForm),
    blockedReason: frameResults.find((f) => f?.blockedReason)?.blockedReason || "",
    jobUnavailable: frameResults.find((f) => f?.jobUnavailable)?.jobUnavailable || "",
    applySuccess: frameResults.some((f) => f?.applySuccess),
    applySuccessText:
      frameResults.find((f) => f?.applySuccess && f?.applySuccessText)?.applySuccessText || "",
    applyUrls: [...new Set(frameResults.flatMap((f) => f?.applyUrls || []).filter(Boolean))],
    signature: best?.signature || frameResults[0]?.signature || "",
    href: best?.href || frameResults[0]?.href || ""
  };
}

async function getApplyActionFromTab(tabId) {
  await ensureAutofillScript(tabId);
  const frames = await sendMessageToAllFrames(tabId, { type: "get_apply_action" }, { attempts: 1 });
  return pickBestApplyAction(frames);
}

async function waitForDiceApplySuccess(tabId, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(450);
    const probe = await getApplyActionFromTab(tabId).catch(() => null);
    if (probe?.applySuccess) {
      return {
        ok: true,
        tabId,
        text: probe.applySuccessText || "Your application is on its way"
      };
    }
    // Also treat URL/DOM advance into a success-looking page via probe after navigation.
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.id) return { ok: false, tabId, reason: "tab_gone" };
  }
  return { ok: false, tabId, reason: "timeout" };
}

async function waitForApplyAdvance(tabId, prevSig, prevUrl, timeoutMs = 15000) {
  const start = Date.now();
  const knownTabIds = new Set((await chrome.tabs.query({})).map((t) => t.id));

  while (Date.now() - start < timeoutMs) {
    await sleep(400);

    const successProbe = await getApplyActionFromTab(tabId).catch(() => null);
    if (successProbe?.applySuccess) {
      return {
        advanced: true,
        tabId,
        reason: "apply_success",
        applySuccess: true,
        applySuccessText: successProbe.applySuccessText || ""
      };
    }

    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id == null || knownTabIds.has(t.id) || t.id === tabId) continue;
      const url = t.url || "";
      if (url && !/^https?:\/\//i.test(url)) continue;
      try {
        await waitForTabComplete(t.id, 20000);
      } catch {
        /* continue */
      }
      const fresh = await chrome.tabs.get(t.id).catch(() => null);
      if (fresh?.id && /^https?:\/\//i.test(fresh.url || "")) {
        await chrome.tabs.update(fresh.id, { active: true }).catch(() => {});
        const newProbe = await getApplyActionFromTab(fresh.id).catch(() => null);
        if (newProbe?.applySuccess) {
          return {
            advanced: true,
            tabId: fresh.id,
            reason: "apply_success",
            applySuccess: true,
            applySuccessText: newProbe.applySuccessText || ""
          };
        }
        return { advanced: true, tabId: fresh.id, reason: "new_tab" };
      }
    }

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.id) return { advanced: false, tabId, reason: "tab_gone" };

    if (tab.url && prevUrl && tab.url !== prevUrl) {
      if (tab.status === "loading") {
        try {
          await waitForTabComplete(tabId, 20000);
        } catch {
          /* ignore */
        }
      }
      await sleep(500);
      const afterNav = await getApplyActionFromTab(tabId).catch(() => null);
      if (afterNav?.applySuccess) {
        return {
          advanced: true,
          tabId,
          reason: "apply_success",
          applySuccess: true,
          applySuccessText: afterNav.applySuccessText || ""
        };
      }
      return { advanced: true, tabId, reason: "url_change" };
    }

    try {
      await ensureAutofillScript(tabId);
      const all = await getApplyActionFromTab(tabId);
      if (all.applySuccess) {
        return {
          advanced: true,
          tabId,
          reason: "apply_success",
          applySuccess: true,
          applySuccessText: all.applySuccessText || ""
        };
      }
      if (all.signature && prevSig && all.signature !== prevSig) {
        await sleep(300);
        return { advanced: true, tabId, reason: "dom_change" };
      }
    } catch {
      /* mid-navigation */
    }
  }
  return { advanced: false, tabId, reason: "timeout" };
}

async function getOpenAiSettings() {
  const apiKey = await getEnv("OPENAI_API_KEY");
  const model = (await getEnv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)) || DEFAULT_OPENAI_MODEL;
  return { apiKey, model };
}

async function getAutofillAiContext() {
  const data = await chrome.storage.local.get([
    "last_job_title",
    "last_company_name",
    "last_jd_text",
    "last_jd_link"
  ]);
  const person = await getActivePerson();
  const resume = (await getStoredResumeJson()) || {};
  const certifications = await loadAutofillCertifications({
    certifications: resume.certifications
  });
  return {
    jobMeta: {
      jobTitle: data.last_job_title || "",
      companyName: data.last_company_name || "",
      jdText: data.last_jd_text || "",
      jdLink: data.last_jd_link || ""
    },
    resumeText: String(person?.masterResume || "").trim(),
    certifications
  };
}

async function enrichAnswersWithAi(questions, answers, {
  choice = false,
  profileId = "",
  site = "",
  applicantInfo = {},
  jobMeta = null
} = {}) {
  const answered = new Set(answers.map((a) => a.id));
  const stillNeed = questions.filter((q) => {
    if (!q?.id || answered.has(q.id)) return false;
    return choice ? Array.isArray(q.options) && q.options.length : true;
  });
  const { apiKey, model } = await getOpenAiSettings();
  if (!apiKey || !stillNeed.length) return { aiHits: 0 };

  const ctx = await getAutofillAiContext();
  const meta = {
    ...ctx.jobMeta,
    ...(jobMeta && typeof jobMeta === "object" ? jobMeta : {})
  };
  const info = {
    ...applicantInfo,
    certifications: parseCertificationList(applicantInfo.certifications).length
      ? applicantInfo.certifications
      : ctx.certifications
  };
  let aiHits = 0;
  try {
    const aiResult = choice
      ? await generateConstrainedChoiceAnswers({
          apiKey,
          model,
          questions: stillNeed,
          applicantInfo: info,
          jobMeta: meta,
          resumeText: ctx.resumeText
        })
      : await generateHumanizedApplicationAnswers({
          apiKey,
          model,
          questions: stillNeed,
          applicantInfo: info,
          jobMeta: meta,
          resumeText: ctx.resumeText
        });
    for (const row of aiResult.answers || []) {
      if (!row?.id || !row?.answer) continue;
      const q = stillNeed.find((item) => item.id === row.id);
      if (q?.label && !bankAnswerFitsQuestion(q.label, row.answer)) continue;
      answers.push({ id: row.id, answer: row.answer, source: "ai" });
      aiHits += 1;
      if (!q?.label) continue;
      if (
        (choice || shouldBankAnswer(q, row.answer, q.fieldType || "text")) &&
        bankAnswerFitsQuestion(q.label, row.answer)
      ) {
        saveQa({
          profileId: profileId || "",
          question: q.label,
          answer: row.answer,
          fieldType: q.fieldType || (choice ? "select" : "text"),
          source: "ai",
          site
        }).catch(() => {});
      }
    }
  } catch (err) {
    await setApplyStatus(`OpenAI answers skipped: ${String(err?.message || err)}`).catch(() => {});
  }
  return { aiHits };
}

async function fillUnmatchedAnswers(tabId, result, extras, profileId, site, applicantInfo = {}) {
  let extraFilled = 0;
  let bankHits = 0;
  let aiHits = 0;
  const info = await withResumeCertifications(applicantInfo);
  const unmatched = Array.isArray(result?.unmatchedQuestions) ? result.unmatchedQuestions : [];
  const unmatchedChoice = Array.isArray(result?.unmatchedChoiceQuestions)
    ? result.unmatchedChoiceQuestions
    : [];

  if (unmatchedChoice.length) {
    const byFrame = new Map();
    for (const q of unmatchedChoice) {
      const fid = q.frameId;
      if (!byFrame.has(fid)) byFrame.set(fid, []);
      byFrame.get(fid).push(q);
    }
    for (const [frameId, questions] of byFrame) {
      const answers = await resolveQuestionAnswers(questions, extras, profileId, site, {
        choice: true,
        applicantInfo: info
      });
      bankHits += Number(answers.bankHits || 0);
      const ai = await enrichAnswersWithAi(questions, answers, {
        choice: true,
        profileId,
        site,
        applicantInfo: info
      });
      aiHits += Number(ai.aiHits || 0);
      if (!answers.length) continue;
      const cRes = await sendMessageToTab(
        tabId,
        { type: "autofill_choice_answers", answers },
        { attempts: 2, frameId }
      ).catch(() => null);
      extraFilled += Number(cRes?.filledCount || 0);
    }
  }

  if (unmatched.length) {
    const byFrame = new Map();
    for (const q of unmatched) {
      const fid = q.frameId;
      if (!byFrame.has(fid)) byFrame.set(fid, []);
      byFrame.get(fid).push(q);
    }
    for (const [frameId, questions] of byFrame) {
      const answers = await resolveQuestionAnswers(questions, extras, profileId, site, {
        choice: false,
        applicantInfo: info
      });
      bankHits += Number(answers.bankHits || 0);
      const ai = await enrichAnswersWithAi(questions, answers, {
        choice: false,
        profileId,
        site,
        applicantInfo: info
      });
      aiHits += Number(ai.aiHits || 0);
      if (!answers.length) continue;
      const tRes = await sendMessageToTab(
        tabId,
        { type: "autofill_ai_answers", answers },
        { attempts: 2, frameId }
      ).catch(() => null);
      extraFilled += Number(tRes?.filledCount || 0);
    }
  }

  return { extraFilled, bankHits, aiHits };
}

/**
 * Fill the current (or given) application tab from the active person.
 */
export async function startAutofillOnTab(tabId = null, applyHint = {}) {
  const { person, applicantInfo, extras } = await getApplicantInfoForAutofill();
  const hasAnyValue = Object.values(applicantInfo).some((v) => String(v || "").trim());
  const tab = tabId
    ? await chrome.tabs.get(tabId).catch(() => null)
    : await getCurrentApplicationTab();
  const stored = await chrome.storage.local.get([
    "last_apply_csv_row",
    "last_apply_job_dir",
    "last_apply_jd_link",
    "last_jd_link"
  ]);
  const csvRow = applyHint.csvRow ?? stored.last_apply_csv_row;
  const sameRow =
    !hasCsvRow(csvRow) ||
    !hasCsvRow(stored.last_apply_csv_row) ||
    Number(stored.last_apply_csv_row) === Number(csvRow);
  const jobDir = applyHint.jobDir || (sameRow ? stored.last_apply_job_dir : "") || "";
  const jdLink =
    applyHint.jdLink ||
    (sameRow ? stored.last_apply_jd_link : "") ||
    stored.last_jd_link ||
    tab?.url ||
    "";
  const docs = await resolveUploadDocs({ csvRow, jobDir, jdLink });
  if (hasCsvRow(csvRow)) {
    await setApplyStatus(
      docsHaveFile(docs, "resume") || docsHaveFile(docs, "coverLetter")
        ? `Apply row ${Number(csvRow)}: uploading ${[docs?.resume?.fileName, docs?.coverLetter?.fileName].filter(Boolean).join(" + ")}`
        : `Apply row ${Number(csvRow)}: no matching resume/cover letter found. Generate this row first.`
    );
  }
  const hasUploadDocs = Boolean(docs?.resume?.base64 || docs?.coverLetter?.base64);
  let history = { workHistory: [], educationHistory: [] };
  try {
    history = await loadFormHistory(applicantInfo);
  } catch {
    history = { workHistory: [], educationHistory: [] };
  }
  const hasHistory = hasFormHistory(history.workHistory, history.educationHistory);

  if (!hasAnyValue && !hasUploadDocs && !hasHistory) {
    throw new Error(
      "Active person has no contact fields. Edit person and save name/email/phone/address."
    );
  }

  if (!tab?.id) {
    throw new Error("No active application tab. Focus the job form tab first.");
  }
  if (!/^https?:\/\//i.test(tab.url || "")) {
    throw new Error("Cannot autofill Chrome system pages. Focus the job application tab.");
  }

  if (tab.status === "loading") {
    try {
      await waitForTabComplete(tab.id, 25000);
    } catch {
      /* fill whatever is present */
    }
    await sleep(APPLY_SETTLE_MS);
  }

  await ensureAutofillScript(tab.id);
  const frameResults = await sendMessageToAllFrames(tab.id, {
    type: "autofill_application",
    applicantInfo,
    credentials: { email: applicantInfo.email || "" },
    workHistory: history.workHistory,
    educationHistory: history.educationHistory,
    uploadFiles: {
      resume: docs?.resume || null,
      coverLetter: docs?.coverLetter || null
    }
  });
  const result = mergeAutofillFrameResults(frameResults);
  const site = hostnameFromUrl(tab.url || "");
  const leftover = await fillUnmatchedAnswers(
    tab.id,
    result,
    extras,
    person.id || "",
    site,
    applicantInfo
  );

  return {
    ok: Boolean(result.ok) || result.filledCount > 0 || leftover.extraFilled > 0,
    tabId: tab.id,
    tabUrl: tab.url || "",
    filled: result.filledCount + leftover.extraFilled,
    filledCount: result.filledCount + leftover.extraFilled,
    fields: result.filled,
    uploaded: result.uploadedCount,
    uploadedCount: result.uploadedCount,
    uploadSkipped: result.uploadSkipped,
    bankHits: leftover.bankHits,
    extraFilled: leftover.extraFilled,
    aiHits: leftover.aiHits || 0,
    unmatchedQuestions: result.unmatchedQuestions,
    unmatchedChoiceQuestions: result.unmatchedChoiceQuestions,
    uploadFolder: docs?.jobDir || docs?.folderName || "",
    uploadResumeName: docs?.resume?.fileName || "",
    uploadCoverName: docs?.coverLetter?.fileName || "",
    uploadCsvRow: hasCsvRow(csvRow) ? Number(csvRow) : ""
  };
}

/**
 * Multi-step apply: fill → click Next/Continue → wait → refill.
 * Stops before Submit unless autoSubmit is true (Dice interleaved batch).
 */
export async function startMultiStepApplyOnTab(
  tabId = null,
  { maxSteps = 12, applyHint = {}, autoSubmit = false } = {}
) {
  const tab = tabId
    ? await chrome.tabs.get(tabId).catch(() => null)
    : await getCurrentApplicationTab();
  if (!tab?.id) {
    throw new Error("No application tab found. Open the job application page first.");
  }
  if (!/^https?:\/\//i.test(tab.url || "")) {
    throw new Error("The current tab is not a web page. Open the application form, then click Apply.");
  }

  let currentTabId = tab.id;
  const summary = {
    ok: true,
    steps: 0,
    filled: 0,
    filledCount: 0,
    uploaded: 0,
    uploadedCount: 0,
    bankHits: 0,
    extraFilled: 0,
    aiHits: 0,
    status: "",
    detail: "",
    tabId: currentTabId,
    tabUrl: tab.url || "",
    autoSubmit: Boolean(autoSubmit)
  };

  let noAdvance = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    await setApplyStatus(`Apply: step ${step + 1}/${maxSteps} — checking page...`);
    await ensureAutofillScript(currentTabId);

    let probe = await getApplyActionFromTab(currentTabId).catch(() => ({
      best: null,
      anyForm: false,
      blockedReason: "",
      jobUnavailable: "",
      applyUrls: [],
      signature: "",
      href: ""
    }));

    if (probe.jobUnavailable) {
      summary.status = "unavailable";
      summary.detail = probe.jobUnavailable || "inactive job";
      summary.tabId = currentTabId;
      return summary;
    }

    if (probe.applySuccess) {
      summary.status = "submitted";
      summary.detail = probe.applySuccessText || "Your application is on its way";
      summary.tabId = currentTabId;
      return summary;
    }

    if (!probe.anyForm && (!probe.best || probe.best.action.type === "entry")) {
      const live = await chrome.tabs.get(currentTabId).catch(() => null);
      const prevUrl = live?.url || "";
      const prevSig = probe.signature || "";
      let alreadyOpen = false;

      if (probe.best?.action?.type === "entry") {
        await sendMessageToTab(
          currentTabId,
          { type: "click_apply_action", preferredType: "entry", autoSubmit: false },
          { attempts: 2, frameId: probe.best.frameId }
        ).catch(() => null);
      } else {
        const entry = await sendMessageToTab(
          currentTabId,
          { type: "click_easy_apply_entry" },
          { attempts: 2 }
        ).catch(() => null);
        alreadyOpen = Boolean(entry?.alreadyOpen);
        if (!entry?.clicked && !alreadyOpen && probe.applyUrls?.length) {
          const nextUrl = String(probe.applyUrls[0] || "").trim();
          if (nextUrl) {
            await chrome.tabs.update(currentTabId, { url: nextUrl });
            await waitForTabComplete(currentTabId, 30000).catch(() => {});
          }
        } else if (!entry?.clicked && !alreadyOpen && probe.blockedReason) {
          summary.status = "needs_review";
          summary.detail = probe.blockedReason;
          summary.tabId = currentTabId;
          return summary;
        }
      }

      if (alreadyOpen) {
        probe = await getApplyActionFromTab(currentTabId).catch(() => probe);
        if (probe.applySuccess) {
          summary.status = "submitted";
          summary.detail = probe.applySuccessText || "Your application is on its way";
          summary.tabId = currentTabId;
          return summary;
        }
      }
      if (!alreadyOpen || (!probe.anyForm && !(probe.best && probe.best.action.type !== "entry"))) {
        const advanced = await waitForApplyAdvance(currentTabId, prevSig, prevUrl, 12000);
        currentTabId = advanced.tabId;
        if (advanced.applySuccess) {
          summary.status = "submitted";
          summary.detail = advanced.applySuccessText || "Your application is on its way";
          summary.tabId = currentTabId;
          return summary;
        }
        probe = await getApplyActionFromTab(currentTabId).catch(() => probe);
      }

      if (probe.applySuccess) {
        summary.status = "submitted";
        summary.detail = probe.applySuccessText || "Your application is on its way";
        summary.tabId = currentTabId;
        return summary;
      }

      if (!probe.anyForm && !(probe.best && probe.best.action.type !== "entry")) {
        summary.status = "needs_review";
        summary.detail =
          probe.blockedReason ||
          "No application form found on this page. Open the apply form, then click Autofill this page.";
        summary.tabId = currentTabId;
        return summary;
      }
    }

    await setApplyStatus(`Apply: step ${step + 1}/${maxSteps} — filling form...`);
    const fillRes = await startAutofillOnTab(currentTabId, applyHint);
    summary.filled += Number(fillRes?.filledCount || 0);
    summary.filledCount = summary.filled;
    summary.uploaded += Number(fillRes?.uploadedCount || 0);
    summary.uploadedCount = summary.uploaded;
    summary.bankHits += Number(fillRes?.bankHits || 0);
    summary.extraFilled += Number(fillRes?.extraFilled || 0);
    summary.aiHits += Number(fillRes?.aiHits || 0);
    summary.uploadResumeName = fillRes?.uploadResumeName || summary.uploadResumeName || "";
    summary.uploadCoverName = fillRes?.uploadCoverName || summary.uploadCoverName || "";
    summary.uploadFolder = fillRes?.uploadFolder || summary.uploadFolder || "";
    summary.steps = step + 1;
    summary.tabId = currentTabId;
    summary.tabUrl = (await chrome.tabs.get(currentTabId).catch(() => null))?.url || summary.tabUrl;

    probe = await getApplyActionFromTab(currentTabId).catch(() => ({ best: null, anyForm: false }));

    if (probe.applySuccess) {
      summary.status = "submitted";
      summary.detail = probe.applySuccessText || "Your application is on its way";
      summary.tabId = currentTabId;
      return summary;
    }

    // Dice review step paints sticky footer Submit slightly after fill completes.
    if (!probe.best && probe.anyForm) {
      for (let retry = 0; retry < 4 && !probe.best; retry += 1) {
        await sleep(500);
        probe = await getApplyActionFromTab(currentTabId).catch(() => probe);
        if (probe.applySuccess) {
          summary.status = "submitted";
          summary.detail = probe.applySuccessText || "Your application is on its way";
          summary.tabId = currentTabId;
          return summary;
        }
      }
    }

    if (!probe.best) {
      summary.status = probe.anyForm ? "ready_for_review" : "needs_review";
      const files = [fillRes?.uploadResumeName, fillRes?.uploadCoverName].filter(Boolean).join(" + ");
      summary.detail = probe.anyForm
        ? (summary.uploaded
            ? `Uploaded ${files || `${summary.uploaded} file(s)`}. No Next/Submit button detected — please review and submit.`
            : "Filled the form. No Next/Submit button detected — please review and submit.")
        : "No application form or action button found on this page.";
      return summary;
    }

    if (probe.best.action.type === "submit") {
      if (autoSubmit) {
        await setApplyStatus(`Apply: submitting (${probe.best.action.text || "Submit"})...`);
        const live = await chrome.tabs.get(currentTabId).catch(() => null);
        const prevUrl = live?.url || "";
        const prevSig = probe.signature || "";
        const clickRes = await sendMessageToTab(
          currentTabId,
          { type: "click_apply_action", preferredType: "submit", autoSubmit: true },
          { attempts: 2, frameId: probe.best.frameId }
        ).catch((err) => ({ ok: false, error: String(err?.message || err) }));

        if (clickRes?.clicked || clickRes?.submitted) {
          const confirmed = await waitForDiceApplySuccess(currentTabId, 20000);
          if (confirmed.ok) {
            summary.status = "submitted";
            summary.detail = confirmed.text || "Your application is on its way";
            summary.tabId = currentTabId;
            return summary;
          }
          const advanced = await waitForApplyAdvance(currentTabId, prevSig, prevUrl, 8000).catch(() => null);
          if (advanced?.applySuccess) {
            summary.status = "submitted";
            summary.detail = advanced.applySuccessText || "Your application is on its way";
            summary.tabId = advanced.tabId || currentTabId;
            return summary;
          }
          summary.status = "needs_review";
          summary.detail =
            "Submit was clicked but the Dice success screen was not detected. Confirm in the tab, then click Start.";
          summary.tabId = currentTabId;
          return summary;
        }
        summary.status = "needs_review";
        summary.detail =
          clickRes?.error ||
          "Reached Submit but could not click it (a required field or CAPTCHA likely needs your input).";
        summary.tabId = currentTabId;
        return summary;
      }
      summary.status = "ready_for_review";
      const files = [fillRes?.uploadResumeName, fillRes?.uploadCoverName].filter(Boolean).join(" + ");
      summary.detail = files
        ? `Uploaded ${files}. Reached Submit (${probe.best.action.text || "Submit"}). Stopped so you can review.`
        : `Reached Submit (${probe.best.action.text || "Submit"}). Stopped so you can review.`;
      return summary;
    }

    const live = await chrome.tabs.get(currentTabId).catch(() => null);
    const prevUrl = live?.url || "";
    const prevSig = probe.signature || "";
    const actionType = probe.best.action.type;

    await setApplyStatus(`Apply: clicking ${probe.best.action.text || actionType}...`);
    const clickRes = await sendMessageToTab(
      currentTabId,
      { type: "click_apply_action", preferredType: actionType, autoSubmit: false },
      { attempts: 2, frameId: probe.best.frameId }
    ).catch((err) => ({ ok: false, error: String(err?.message || err) }));

    if (clickRes?.isSubmit) {
      if (autoSubmit) {
        await setApplyStatus("Apply: submitting...");
        const submitRes = await sendMessageToTab(
          currentTabId,
          { type: "click_apply_action", preferredType: "submit", autoSubmit: true },
          { attempts: 2, frameId: probe.best.frameId }
        ).catch((err) => ({ ok: false, error: String(err?.message || err) }));
        if (submitRes?.clicked || submitRes?.submitted) {
          const confirmed = await waitForDiceApplySuccess(currentTabId, 20000);
          if (confirmed.ok) {
            summary.status = "submitted";
            summary.detail = confirmed.text || "Your application is on its way";
            summary.tabId = currentTabId;
            return summary;
          }
          const advanced = await waitForApplyAdvance(currentTabId, prevSig, prevUrl, 8000).catch(() => null);
          if (advanced?.applySuccess) {
            summary.status = "submitted";
            summary.detail = advanced.applySuccessText || "Your application is on its way";
            summary.tabId = advanced.tabId || currentTabId;
            return summary;
          }
          summary.status = "needs_review";
          summary.detail =
            "Submit was clicked but the Dice success screen was not detected. Confirm in the tab, then click Start.";
          return summary;
        }
        summary.status = "needs_review";
        summary.detail =
          submitRes?.error ||
          "Reached Submit but could not click it (a required field or CAPTCHA likely needs your input).";
        return summary;
      }
      summary.status = "ready_for_review";
      summary.detail = "Reached the final Submit step. Stopped so you can review and submit.";
      return summary;
    }

    const advanced = await waitForApplyAdvance(currentTabId, prevSig, prevUrl, 15000);
    currentTabId = advanced.tabId;
    summary.tabId = currentTabId;

    if (advanced.applySuccess) {
      summary.status = "submitted";
      summary.detail = advanced.applySuccessText || "Your application is on its way";
      return summary;
    }

    if (advanced.advanced) {
      noAdvance = 0;
    } else {
      noAdvance += 1;
      if (noAdvance >= 2) {
        summary.status = "needs_review";
        summary.detail =
          "Could not advance past this step (a required field or CAPTCHA likely needs your input).";
        return summary;
      }
    }
  }

  summary.status = "ready_for_review";
  summary.detail = "Reached the step limit; please review the remaining steps.";
  return summary;
}


function diceJobIdFromUrl(url) {
  const match = String(url || "").match(
    /dice\.com\/(?:job-detail|job-applications)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : "";
}

function diceWizardUrl(jobId) {
  return jobId ? `https://www.dice.com/job-applications/${jobId}/wizard` : "";
}

async function findExistingDiceApplyTab(jdLink) {
  const id = diceJobIdFromUrl(jdLink);
  if (!id) return null;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: ["https://www.dice.com/*", "https://*.dice.com/*"] });
  } catch {
    tabs = await chrome.tabs.query({});
  }
  const wizard = tabs.find((t) => (t.url || "").includes(`/job-applications/${id}`));
  if (wizard) return { tab: wizard, isWizard: true };
  const detail = tabs.find((t) => (t.url || "").includes(`/job-detail/${id}`));
  if (detail) return { tab: detail, isWizard: false };
  return null;
}

function looksLikeApplicationUrl(url) {
  return /\b(apply|application|job-applications|easy-apply|jobapp|gh_jid)\b/i.test(String(url || ""));
}

async function findExistingApplyTab(jdLink) {
  const href = String(jdLink || "").trim();
  if (!href) return null;

  const dice = await findExistingDiceApplyTab(href);
  if (dice) return dice;

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return null;
  }
  const http = tabs.filter((t) => /^https?:/i.test(t.url || ""));
  const target = normalizeJobLink(href);
  const exact = target
    ? http.find((t) => normalizeJobLink(t.url) === target)
    : null;
  if (exact) return { tab: exact, isWizard: looksLikeApplicationUrl(exact.url) };

  try {
    const want = new URL(href);
    const sameJob = http.find((t) => {
      try {
        const have = new URL(t.url);
        if (have.origin !== want.origin) return false;
        const a = have.pathname.replace(/\/+$/, "");
        const b = want.pathname.replace(/\/+$/, "");
        return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
      } catch {
        return false;
      }
    });
    if (sameJob) return { tab: sameJob, isWizard: looksLikeApplicationUrl(sameJob.url) };
  } catch {
    /* ignore */
  }
  return null;
}

export async function openJobAndApply(
  url,
  { multiStep = true, csvRow, jobDir, jdLink, autoSubmit = false } = {}
) {
  const href = String(url || "").trim();
  if (!href) throw new Error("Missing job URL.");
  const applyHint = {
    csvRow,
    jobDir,
    jdLink: jdLink || href
  };
  await setActiveApplyJob(applyHint);
  const jobId = diceJobIdFromUrl(href);
  const existing = await findExistingApplyTab(href);
  let tab = existing?.tab || null;
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    if (!existing.isWizard && jobId && /dice\.com/i.test(tab.url || href)) {
      await chrome.tabs.update(tab.id, { url: diceWizardUrl(jobId) });
      await waitForTabComplete(tab.id, 35000).catch(() => {});
    }
  } else {
    const startUrl = jobId && /dice\.com/i.test(href) ? diceWizardUrl(jobId) : href;
    tab = await chrome.tabs.create({ url: startUrl, active: true });
    try {
      await waitForTabComplete(tab.id, 35000);
    } catch {
      /* fill anyway */
    }
  }
  await sleep(APPLY_SETTLE_MS);
  const live = await chrome.tabs.get(tab.id).catch(() => null);
  if (jobId && /dice\.com/i.test(live?.url || href)) {
    await ensureAutofillScript(tab.id).catch(() => {});
    let probe = await getApplyActionFromTab(tab.id).catch(() => null);
    if (probe?.jobUnavailable) {
      return {
        status: "unavailable",
        detail: probe.jobUnavailable || "inactive job",
        tabId: tab.id,
        filled: 0,
        uploaded: 0
      };
    }
    if (!probe?.anyForm && !probe?.best?.action) {
      await chrome.tabs.update(tab.id, { url: href });
      await waitForTabComplete(tab.id, 35000).catch(() => {});
      await sleep(APPLY_SETTLE_MS);
      probe = await getApplyActionFromTab(tab.id).catch(() => null);
      if (probe?.jobUnavailable) {
        return {
          status: "unavailable",
          detail: probe.jobUnavailable || "inactive job",
          tabId: tab.id,
          filled: 0,
          uploaded: 0
        };
      }
    }
  }
  if (multiStep) {
    return startMultiStepApplyOnTab(tab.id, { applyHint, autoSubmit: Boolean(autoSubmit) });
  }
  return startAutofillOnTab(tab.id, applyHint);
}

/** Close a tab opened for apply (Dice wizard / external ATS). Ignores missing tabs. */
export async function closeApplyTab(tabId) {
  const id = Number(tabId);
  if (!Number.isFinite(id) || id <= 0) return false;
  try {
    await chrome.tabs.remove(id);
    return true;
  } catch {
    return false;
  }
}

export async function handleProfileLearnCapture(message) {
  const key = String(message.key || "").trim();
  const value = String(message.value || "").trim();
  if (!key || !value) return { ok: false };
  const result = await applyLearnedApplicantField(key, value);
  return { ok: true, learned: Boolean(result) };
}

export async function handleQaLearnCapture(message) {
  const question = String(message.question || "").trim();
  const answer = String(message.answer || "").trim();
  if (!question || !answer) return { ok: false };
  const { person } = await getApplicantInfoForAutofill();
  await saveQa({
    profileId: person?.id || "",
    question,
    answer,
    fieldType: message.fieldType || "text",
    source: "user",
    site: message.site || ""
  });
  await mergeAutofillExtras({ [normalizeQuestion(question).slice(0, 48) || question]: answer }).catch(
    () => null
  );
  return { ok: true };
}

/** Used by the content-script Easy Apply path when leftover questions need answers. */
export async function answerQuestionsFromBank(
  questions = [],
  { choice = false, site = "", jobMeta = null } = {}
) {
  const { person, extras, applicantInfo } = await getApplicantInfoForAutofill();
  const info = await withResumeCertifications(applicantInfo);
  const answers = await resolveQuestionAnswers(
    questions,
    extras,
    person?.id || "",
    site,
    { choice, applicantInfo: info }
  );
  await enrichAnswersWithAi(questions, answers, {
    choice,
    profileId: person?.id || "",
    site,
    applicantInfo: info,
    jobMeta
  });
  return answers;
}
