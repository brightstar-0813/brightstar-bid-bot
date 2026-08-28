/**
 * Application autofill orchestrator.
 * Injects content/autofill.js into all frames, fills from the active person,
 * then answers leftover questions from extras + the Q&A bank, then OpenAI.
 * Multi-step Apply clicks Next/Continue but never auto-submits unless
 * autoSubmit is explicitly enabled for a supported in-site flow.
 */

import { getApplicantInfoForAutofill, applyLearnedApplicantField, mergeAutofillExtras, getActivePerson, personToAtsCredentials, DEFAULT_ATS_PASSWORD } from "./profiles.js";
import { applyCompleteness } from "./person-profile-form.js";
import { outputDirFromPerson } from "./resume-profile.js";
import { buildWorkHistory, buildEducationHistory, hasFormHistory } from "./history.js";
import { findQaMatch, saveQa, recordQaUsage, normalizeQuestion, questionSimilarity } from "./qa-store.js";
import {
  isJunkAutofillAnswer,
  isJunkQuestionLabel,
  isSensitiveProfileQuestion,
  normalizeChoiceAnswerValue
} from "./autofill-junk.js";
import { formatAutofillSummary } from "./autofill-summary.js";
import { getEnv } from "./env.js";
import { DEFAULT_OPENAI_MODEL } from "./openai.js";
import { normalizeJobLink } from "./sheets.js";
import { NATIVE_HOST_NAME } from "./csv-source.js";
import {
  generateHumanizedApplicationAnswers,
  generateConstrainedChoiceAnswers,
  generateFormInventoryAnswers,
  shouldBankAnswer,
  isCertificationQuestion,
  answerCertificationQuestion,
  parseCertificationList,
  certificationsFromText,
  bankAnswerFitsQuestion
} from "./ai-answers.js";
import {
  applySiteFromUrl,
  applySiteLabel,
  getAdapter,
  isEmployerAtsSite,
  resolveEffectiveAutoSubmit,
  stepBudgetForSite,
  hostnameFromUrl
} from "./ats/adapters.js";
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
const AUTOFILL_SCRIPT_BUILD = "2026-08-29.panel01";
const APPLY_SETTLE_MS = 2200;
const LAST_APPLY_TAB_KEY = "last_apply_tab_id";

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

function toStoredJobDir(absPath, appsDir = "") {
  const n = String(absPath || "").replace(/\\/g, "/");
  if (!n) return "";
  const apps = String(appsDir || "").trim() || "Applications";
  const marker = `/${apps}/`;
  const lower = n.toLowerCase();
  const i = lower.lastIndexOf(marker.toLowerCase());
  if (i >= 0) return `${apps}/${n.slice(i + marker.length)}`;
  // Legacy / alternate Applications-* folders
  const m = n.match(/\/((?:Resume Applications|Applications-[^/]+))\/(.+)$/i);
  if (m) return `${m[1]}/${m[2]}`;
  const segment = folderSegment(n);
  return segment ? `${apps}/${segment}` : n;
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

async function resolveAppsOutputDir() {
  try {
    const data = await chrome.storage.local.get(["output_dir", "batch_output_dir"]);
    const stored = String(data.output_dir || data.batch_output_dir || "").trim();
    if (stored) return stored;
  } catch {
    // ignore
  }
  try {
    const person = await getActivePerson();
    return outputDirFromPerson(person);
  } catch {
    return "Applications";
  }
}

async function listJobFoldersFromDownloads() {
  if (!chrome.downloads?.search) return [];
  const appsDir = await resolveAppsOutputDir();
  const escaped = appsDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const folderAlt = `(?:${escaped}|Resume Applications|Applications-[^\\\\/]+)`;
  let results = [];
  try {
    results = await chrome.downloads.search({
      filenameRegex: `${folderAlt}[\\\\/]\\d+\\s+-\\s+`,
      limit: 1000,
      orderBy: ["-startTime"]
    });
  } catch {
    results = [];
  }
  const byRow = new Map();
  const pathRe = new RegExp(
    `(?:${escaped}|Resume Applications|Applications-[^/]+)\\/(\\d+)\\s+-\\s+[^/]+`,
    "i"
  );
  for (const row of results || []) {
    const path = String(row?.filename || "").replace(/\\/g, "/");
    const match = path.match(pathRe);
    if (!match) continue;
    const csvRow = Number(match[1]);
    const folder = match[0].replace(/\\/g, "/");
    const parts = folder.split("/");
    const name = parts.pop() || "";
    const appsName = parts.pop() || appsDir;
    const jobDir = `${appsName}/${name}`;
    const isActiveApps = appsName.toLowerCase() === appsDir.toLowerCase();
    const prev = byRow.get(csvRow);
    if (prev && !isActiveApps) {
      const prevIsActive = String(prev.jobDir || "").toLowerCase().startsWith(`${appsDir.toLowerCase()}/`);
      if (prevIsActive) continue;
    }
    const next = prev && String(prev.jobDir) === jobDir
      ? prev
      : {
          csvRow,
          jobDir,
          name,
          hasResume: false,
          hasCover: false,
          resumeName: "",
          coverName: ""
        };
    const fileName = path.split("/").pop() || "";
    if (isResumeDownload(path)) {
      next.hasResume = true;
      next.resumeName = next.resumeName || fileName;
    }
    if (isCoverLetterDownload(path)) {
      next.hasCover = true;
      next.coverName = next.coverName || fileName;
    }
    byRow.set(csvRow, next);
  }
  return [...byRow.values()];
}

export async function listJobFoldersFromDisk() {
  try {
    const appsDir = await resolveAppsOutputDir();
    const res = await sendNativeMessage({ type: "list_job_folders", outputDir: appsDir });
    if (res?.ok && Array.isArray(res.folders)) {
      return res.folders.map((f) => ({
        csvRow: Number(f.csvRow),
        jobDir: toStoredJobDir(f.folder || f.name, appsDir),
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
    const appsDir = await resolveAppsOutputDir();
    const found = await sendNativeMessage({
      type: "read_job_docs",
      csvRow: hasCsvRow(csvRow) ? Number(csvRow) : "",
      jobDir: String(jobDir || "").trim(),
      outputDir: appsDir
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
  // Prefer the tab we last opened/used for apply (side panel / popup focus steals "active").
  try {
    const stored = await chrome.storage.local.get(LAST_APPLY_TAB_KEY);
    const rememberedId = Number(stored[LAST_APPLY_TAB_KEY]);
    if (Number.isFinite(rememberedId) && rememberedId > 0) {
      const remembered = await chrome.tabs.get(rememberedId).catch(() => null);
      if (remembered?.id != null && /^https?:\/\//i.test(remembered.url || "")) {
        return remembered;
      }
    }
  } catch {
    /* ignore */
  }

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
  const applyLike =
    httpTabs.find((t) => t.active && looksLikeApplicationUrl(t.url)) ||
    httpTabs.find((t) => looksLikeApplicationUrl(t.url));
  if (applyLike) return applyLike;
  return httpTabs.find((t) => t.active) || httpTabs[0] || null;
}

async function rememberApplyTab(tabId) {
  const id = Number(tabId);
  if (!Number.isFinite(id) || id <= 0) return;
  try {
    await chrome.storage.local.set({ [LAST_APPLY_TAB_KEY]: id });
  } catch {
    /* ignore */
  }
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
    fillableCount: 0,
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
    merged.fillableCount += Number(r.fillableCount || 0);
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

function isUrlOnApplySite(url, site) {
  return site !== "generic" && applySiteFromUrl(url) === site;
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
  if (!best || best.score < 0.78) return null;

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

async function notifyAutofillToast(tabId, payload = {}) {
  const text = payload.text || formatAutofillSummary(payload);
  const variant = payload.variant || (Number(payload.unmatchedAfterSecondPass ?? payload.unmatched ?? 0) > 0 ? "warn" : "ok");
  await sendMessageToAllFrames(tabId, {
    type: "autofill_show_toast",
    text,
    variant,
    ...payload
  }).catch(() => {});
}

const panelAbortByTab = new Map();

/** Known ATS hosts and apply URL paths — show the in-page panel even before fields render. */
const ATS_HOST_RE =
  /(?:greenhouse|lever|indeed|myworkdayjobs|icims|taleo|successfactors|bamboohr|ashbyhq|smartrecruiters|jobvite|ultipro|dice|jobgether|braintrust|usebraintrust)\./i;
const APPLY_PATH_RE = /\/(apply|application|job_app|careers\/apply)/i;

export function looksLikeApplyUrl(url = "") {
  const href = String(url || "").trim();
  if (!href) return false;
  try {
    const u = new URL(href);
    if (ATS_HOST_RE.test(u.hostname)) return true;
    if (APPLY_PATH_RE.test(u.pathname)) return true;
  } catch {
    /* ignore */
  }
  return /\/apply\//i.test(href);
}

export function shouldOfferAutofillPanel(probe = {}, url = "") {
  if (looksLikeApplyUrl(url)) return true;
  if (probe?.isApplicationForm) return true;
  if (Number(probe?.fillableCount || 0) >= 1) return true;
  if (probe?.hasFormFields) return true;
  return false;
}

async function ensureAutofillPanelScript(tabId) {
  const ping = async () => {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: "autofill_panel_ping" });
      return Boolean(pong?.ok);
    } catch {
      return false;
    }
  };
  if (await ping()) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/autofill-panel.js"]
    });
  } catch {
    /* ignore */
  }
  await sleep(200);
}

export async function ensureAutofillPanelOnTab(tabId) {
  if (!tabId) return;
  await ensureAutofillPanelScript(tabId);
}

export async function resolveAssistTab(tabId = null) {
  if (tabId != null) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.id) return tab;
  }
  return getCurrentApplicationTab();
}

/** Show the Jobright-style in-page autofill sidebar on a tab. */
export async function showAutofillPanelOnTab(tabId, { expand = true } = {}) {
  if (!tabId) return false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await ensureAutofillPanelScript(tabId);
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: "autofill_panel_ping" });
      if (pong?.ok) {
        await chrome.tabs.sendMessage(tabId, { type: "autofill_panel_show", expand });
        return true;
      }
    } catch {
      /* retry after inject settles */
    }
    await sleep(180);
  }
  return false;
}

async function emitAutofillProgress(tabId, event = {}) {
  if (!tabId) return;
  await ensureAutofillPanelScript(tabId).catch(() => {});
  try {
    await chrome.tabs.sendMessage(tabId, { type: "autofill_progress", ...event });
  } catch {
    /* panel not mounted */
  }
}

function reportAutofillProgress(tabId, onProgress, event = {}) {
  if (typeof onProgress === "function") {
    try {
      onProgress(event);
    } catch {
      /* ignore */
    }
  }
  emitAutofillProgress(tabId, event).catch(() => {});
}

function mergeScanFrameResults(frameResults = []) {
  let best = { ok: false, fields: [], fillableCount: 0, stepLabel: "", isApplicationForm: false };
  for (const row of frameResults) {
    const count = Array.isArray(row.fields) ? row.fields.length : 0;
    const bestCount = Array.isArray(best.fields) ? best.fields.length : 0;
    if (row.ok && count >= bestCount) best = row;
    else if (!best.ok && row.isApplicationForm) best = { ...row, fields: row.fields || [] };
  }
  return best;
}

function collectScanFieldsFromFrames(frameResults = []) {
  const seen = new Set();
  const out = [];
  for (const row of frameResults) {
    for (const field of row?.fields || []) {
      const key = `${field.id || ""}|${field.label || ""}|${field.type || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(field);
    }
  }
  return out;
}

/**
 * Persist scraped question/answer pairs from a form scan into the per-person Q&A bank.
 * Skips profile-mapped fields (contact, EEO, etc.) and JD-specific essays.
 */
export async function bankScrapedQaFromFields(fields = [], { profileId = "", site = "" } = {}) {
  let banked = 0;
  for (const field of fields) {
    const label = String(field?.label || "").trim();
    let answer = String(field?.currentValue || "").trim();
    if (!label || !answer || answer === "checked") continue;
    if (field.profileKey || field.type === "file") continue;
    if (isJunkQuestionLabel(label) || isSensitiveProfileQuestion(label)) continue;
    if (isJunkAutofillAnswer(answer, { questionLabel: label })) continue;

    const fieldType = field.type || "text";
    const choiceLike = ["select", "radio", "checkbox", "choice"].includes(fieldType);
    if (choiceLike) answer = normalizeChoiceAnswerValue(answer) || answer;

    const q = { label, fieldType, multiline: fieldType === "textarea" };
    if (!shouldBankAnswer(q, answer, fieldType)) continue;
    if (!bankAnswerFitsQuestion(label, answer)) continue;

    const saved = await saveQa({
      profileId: profileId || "",
      question: label,
      answer,
      fieldType,
      source: "scraped",
      site: site || "",
      silent: true
    }).catch(() => null);
    if (saved) banked += 1;
  }
  if (banked > 0) {
    try {
      await chrome.storage.local.set({ qa_bank_version: Date.now() });
    } catch {
      /* ignore */
    }
  }
  return { banked };
}

export async function scanFieldsOnTab(tabId) {
  await ensureAutofillScript(tabId);
  const { applicantInfo, extras } = await getApplicantInfoForAutofill();
  const frameResults = await sendMessageToAllFrames(tabId, {
    type: "scan_application_fields",
    applicantInfo,
    extras
  });
  const scan = mergeScanFrameResults(frameResults);
  const person = await getActivePerson();
  const { complete, missing } = applyCompleteness(person || {});
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const site = tab?.url ? hostnameFromUrl(tab.url) : "";
  const scrapedFields = collectScanFieldsFromFrames(frameResults);
  bankScrapedQaFromFields(scrapedFields, { profileId: person?.id || "", site }).catch(() => {});
  const stored = await chrome.storage.local.get(["last_job_title", "last_job_company"]);
  return {
    ...scan,
    profileIncomplete: !complete,
    profileMissing: missing,
    jobTitle: stored.last_job_title || "",
    jobCompany: stored.last_job_company || ""
  };
}

export async function probeApplicationFormOnTab(tabId) {
  await ensureAutofillScript(tabId);
  const frames = await sendMessageToAllFrames(tabId, { type: "probe_application_form" }, { attempts: 1 });
  const best = frames.reduce(
    (a, b) => (Number(b.fillableCount || 0) > Number(a.fillableCount || 0) ? b : a),
    { isApplicationForm: false, fillableCount: 0 }
  );
  return best;
}

export function cancelJobrightStyleAutofill(tabId) {
  const ctrl = panelAbortByTab.get(tabId);
  if (ctrl) ctrl.cancelled = true;
  emitAutofillProgress(tabId, { phase: "cancelled", statusText: "Cancelled.", progressPct: 0 }).catch(
    () => {}
  );
}

/**
 * Jobright-style autofill: scan inventory, fill all steps, auto Next + Submit when allowed.
 */
export async function startJobrightStyleAutofill(
  tabId = null,
  { autoSubmit = true, applyHint = {} } = {}
) {
  const tab = tabId
    ? await chrome.tabs.get(tabId).catch(() => null)
    : await getCurrentApplicationTab();
  if (!tab?.id) {
    throw new Error("No application tab found. Open the job application page first.");
  }
  if (!/^https?:\/\//i.test(tab.url || "")) {
    throw new Error("Cannot autofill this page. Open an http(s) application form.");
  }

  const ctrl = { cancelled: false };
  panelAbortByTab.set(tab.id, ctrl);

  try {
    await ensureAutofillPanelScript(tab.id);
    reportAutofillProgress(tab.id, null, {
      phase: "start",
      progressPct: 0,
      statusText: "Scanning page…"
    });

    const scan = await scanFieldsOnTab(tab.id);
    const totalFields = Math.max(1, scan.fields?.length || 0);
    reportAutofillProgress(tab.id, null, {
      phase: "scan",
      fields: scan.fields || [],
      stepLabel: scan.stepLabel || "",
      progressPct: 0,
      statusText: scan.fields?.length
        ? `${scan.fields.length} field${scan.fields.length === 1 ? "" : "s"} detected`
        : "Scan complete"
    });

    if (ctrl.cancelled) {
      return { ok: false, status: "cancelled", detail: "Cancelled." };
    }

    const result = await startMultiStepApplyOnTab(tab.id, {
      autoSubmit,
      assistMode: false,
      applyHint,
      shouldAbort: () => ctrl.cancelled,
      onProgress: (event) => {
        reportAutofillProgress(tab.id, null, {
          ...event,
          progressPct:
            event.progressPct ??
            (event.filledCount != null
              ? Math.min(99, Math.round((Number(event.filledCount) / totalFields) * 100))
              : undefined)
        });
      }
    });

    if (ctrl.cancelled || result.status === "cancelled") {
      reportAutofillProgress(tab.id, null, {
        phase: "cancelled",
        statusText: "Cancelled.",
        progressPct: 0
      });
      return { ...result, ok: false, status: "cancelled", detail: "Cancelled." };
    }

    await scanFieldsOnTab(tab.id).catch(() => {});

    reportAutofillProgress(tab.id, null, {
      phase: "done",
      progressPct: 100,
      statusText: result.detail || formatAutofillSummary(result)
    });
    return result;
  } finally {
    panelAbortByTab.delete(tab?.id);
  }
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
    if (isJunkQuestionLabel(q.label)) continue;

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
      match = await findQaMatch(profileId, q.label, { fieldType: q.fieldType || "" });
    } catch {
      match = null;
    }
    let bankAnswer = String(match?.record?.answer || "").trim();
    if (choice) bankAnswer = normalizeChoiceAnswerValue(bankAnswer) || bankAnswer;
    const essayLike = Boolean(q.multiline) || q.fieldType === "textarea";
    const bankOk =
      bankAnswer &&
      !isJunkAutofillAnswer(bankAnswer, { questionLabel: q.label }) &&
      bankAnswerFitsQuestion(q.label, bankAnswer) &&
      (!essayLike || essayBankMatchIsSpecific(q.label, match.record.question));
    if (bankOk) {
      const answerOut = choice ? normalizeChoiceAnswerValue(bankAnswer) || bankAnswer : bankAnswer;
      resolved.push({ id: q.id, answer: answerOut, source: "bank" });
      recordQaUsage(match.record.id).catch(() => {});
      bankHits += 1;
      continue;
    }

    const extra = matchExtraAnswer(q.label, extras, choice ? q.options || [] : []);
    if (
      extra?.answer &&
      !isJunkAutofillAnswer(extra.answer, { questionLabel: q.label }) &&
      bankAnswerFitsQuestion(q.label, extra.answer)
    ) {
      const extraOut = choice
        ? normalizeChoiceAnswerValue(extra.answer) || extra.answer
        : extra.answer;
      resolved.push({ id: q.id, answer: extraOut, source: "extra" });
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
  let workdayWizard = null;
  for (const f of frameResults) {
    if (f?.workdayWizard && !workdayWizard) workdayWizard = f.workdayWizard;
    if (!f?.action?.type) continue;
    const cand = {
      frameId: f.frameId,
      action: f.action,
      signature: f.signature || "",
      href: f.href || "",
      isApplicationForm: Boolean(f.isApplicationForm),
      workdayWizard: f.workdayWizard || null,
      fillableCount: Number(f.fillableCount || 0)
    };
    if (!best) {
      best = cand;
      continue;
    }
    const br = rank[best.action.type] ?? 9;
    const cr = rank[cand.action.type] ?? 9;
    // Prefer advancing (next/review) over submit, but once a form is open prefer Submit over leftover Apply.
    if (best.action.type === "entry" && cand.action.type === "submit") {
      best = cand;
      continue;
    }
    if (cand.action.type === "entry" && best.action.type === "submit") {
      continue;
    }
    // Workday Review: prefer Submit even if another frame still shows Next.
    if (
      cand.workdayWizard?.isReview &&
      cand.action.type === "submit" &&
      best.action.type !== "submit"
    ) {
      best = cand;
      continue;
    }
    if (cr < br) best = cand;
    else if (cr === br && cand.isApplicationForm && !best.isApplicationForm) best = cand;
  }
  if (best?.workdayWizard) workdayWizard = best.workdayWizard;
  return {
    best,
    anyForm: frameResults.some((f) => f?.isApplicationForm),
    blockedReason: frameResults.find((f) => f?.blockedReason)?.blockedReason || "",
    validationReason: frameResults.find((f) => f?.validationReason)?.validationReason || "",
    jobUnavailable: frameResults.find((f) => f?.jobUnavailable)?.jobUnavailable || "",
    site: best?.action?.site || frameResults.find((f) => f?.site)?.site || "",
    applySuccess: frameResults.some((f) => f?.applySuccess),
    applySuccessText:
      frameResults.find((f) => f?.applySuccess && f?.applySuccessText)?.applySuccessText || "",
    emailVerification: frameResults.some((f) => f?.emailVerification),
    emailVerificationText:
      frameResults.find((f) => f?.emailVerification && f?.emailVerificationText)
        ?.emailVerificationText || "",
    applyUrls: [...new Set(frameResults.flatMap((f) => f?.applyUrls || []).filter(Boolean))],
    signature: best?.signature || frameResults[0]?.signature || "",
    href: best?.href || frameResults[0]?.href || "",
    workdayWizard,
    fillableCount: Number(
      best?.fillableCount ??
        frameResults.find((f) => f?.fillableCount != null)?.fillableCount ??
        0
    )
  };
}

async function getApplyActionFromTab(tabId) {
  await ensureAutofillScript(tabId);
  const frames = await sendMessageToAllFrames(tabId, { type: "get_apply_action" }, { attempts: 1 });
  return pickBestApplyAction(frames);
}

/** Probe a loaded tab for inactive / removed job postings before autofill. */
async function probeTabJobUnavailable(tabId) {
  const id = Number(tabId);
  if (!Number.isFinite(id) || id <= 0) return null;
  await ensureAutofillScript(id).catch(() => {});
  const probe = await getApplyActionFromTab(id).catch(() => null);
  if (!probe?.jobUnavailable) return null;
  return {
    status: "unavailable",
    detail: probe.jobUnavailable || "inactive job",
    tabId: id,
    filled: 0,
    uploaded: 0
  };
}

/**
 * Open a job URL in a background tab and check whether the posting is gone.
 * Caller should close tabId when done.
 */
export async function probeJobLinkInactive(url) {
  const href = String(url || "").trim();
  if (!href) return { unavailable: false, detail: "", tabId: null, created: false };
  const tab = await chrome.tabs.create({ url: href, active: false });
  try {
    await waitForTabComplete(tab.id, 35000);
  } catch {
    /* probe anyway */
  }
  await sleep(APPLY_SETTLE_MS);
  const unavailable = await probeTabJobUnavailable(tab.id);
  if (unavailable) {
    return {
      unavailable: true,
      detail: unavailable.detail || "inactive job",
      tabId: tab.id,
      created: true
    };
  }
  return { unavailable: false, detail: "", tabId: tab.id, created: true };
}

async function waitForApplySuccess(tabId, site, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(450);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.id) return { ok: false, tabId, reason: "tab_gone" };
    if (site === "indeed" && !isUrlOnApplySite(tab.url || "", "indeed")) {
      return { ok: false, tabId, reason: "external_redirect", url: tab.url || "" };
    }
    const probe = await getApplyActionFromTab(tabId).catch(() => null);
    if (probe?.applySuccess) {
      return {
        ok: true,
        tabId,
        text:
          probe.applySuccessText ||
          (site === "indeed" ? "Application submitted" : "Your application is on its way")
      };
    }
    if (probe?.emailVerification) {
      return {
        ok: false,
        tabId,
        reason: "email_verification",
        text: probe.emailVerificationText || "Security code required"
      };
    }
  }
  return { ok: false, tabId, reason: "timeout" };
}

/**
 * Greenhouse email OTP: read code from an open Outlook web tab, fill, resubmit.
 */
async function completeGreenhouseEmailVerification(tabId) {
  await setApplyStatus("Apply: Greenhouse — waiting for security code (Outlook tab)…");
  const mail = await scrapeOutlookGreenhouseSecurityCode({
    timeoutMs: 90_000
  }).catch((err) => ({
    ok: false,
    code: "",
    error: String(err?.message || err)
  }));

  if (!mail?.ok || !mail.code) {
    return {
      ok: false,
      detail:
        mail?.error ||
        "No Greenhouse security code found. Keep outlook.live.com open and signed in with the verification email visible."
    };
  }
  await setApplyStatus(`Apply: Greenhouse — entering security code ${mail.code}…`);
  await ensureAutofillScript(tabId);
  const fillRes = await sendMessageToTab(
    tabId,
    { type: "fill_greenhouse_security_code", code: mail.code },
    { attempts: 2 }
  ).catch((err) => ({ ok: false, error: String(err?.message || err) }));
  if (!fillRes?.ok) {
    return {
      ok: false,
      detail: fillRes?.error || "Could not fill the Greenhouse security code field."
    };
  }
  await sleep(600);
  const clickRes = await sendMessageToTab(
    tabId,
    { type: "click_apply_action", preferredType: "submit", autoSubmit: true },
    { attempts: 2 }
  ).catch((err) => ({ ok: false, error: String(err?.message || err) }));
  if (!(clickRes?.clicked || clickRes?.submitted || fillRes?.submitted)) {
    // fill handler may already have clicked submit
    if (!fillRes?.submitted) {
      return {
        ok: false,
        detail:
          clickRes?.error ||
          clickRes?.validationReason ||
          "Security code filled but Submit could not be clicked."
      };
    }
  }
  const confirmed = await waitForApplySuccess(tabId, "greenhouse", 25000);
  if (confirmed.ok) {
    return { ok: true, detail: confirmed.text || "Your application has been received" };
  }
  if (confirmed.reason === "email_verification") {
    return {
      ok: false,
      detail: "Security code was entered but Greenhouse still asks for verification."
    };
  }
  return {
    ok: false,
    detail: "Security code submitted but Greenhouse success screen was not detected."
  };
}

/**
 * Read Greenhouse OTP from an already-open Outlook web tab.
 */
async function scrapeOutlookGreenhouseSecurityCode({ timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const outlookRe = /(^|\.)outlook\.(live|office|office365)\.com$/i;

  const findOutlookTabs = async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.filter((t) => {
      try {
        return outlookRe.test(new URL(t.url || "").hostname);
      } catch {
        return false;
      }
    });
  };

  const extractInTab = async (tabId) => {
    try {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const text = String(document.body?.innerText || document.body?.textContent || "");
          if (!/security\s*code/i.test(text) && !/greenhouse/i.test(text)) {
            return { ok: false, reason: "no_greenhouse_mail_visible" };
          }
          const cleaned = text
            .replace(/\r/g, "")
            .split(/\n+/)
            .map((l) => l.trim())
            .filter(Boolean);
          const isCode = (token) =>
            /^[A-Za-z0-9]{6,12}$/.test(token) &&
            /[A-Za-z]/.test(token) &&
            /\d/.test(token) &&
            !/^(security|verification|greenhouse|application|resubmit)$/i.test(token);
          for (let i = 0; i < cleaned.length; i += 1) {
            const line = cleaned[i];
            if (/copy\s+and\s+paste\s+this\s+code|security\s*code/i.test(line)) {
              for (let j = i; j < Math.min(i + 6, cleaned.length); j += 1) {
                if (isCode(cleaned[j])) return { ok: true, code: cleaned[j] };
              }
            }
            if (isCode(line)) return { ok: true, code: line };
          }
          const m = text.match(/\b([A-Za-z0-9]{8})\b/);
          if (m && isCode(m[1])) return { ok: true, code: m[1] };
          return { ok: false, reason: "code_not_found" };
        }
      });
      return result || { ok: false };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  };

  let lastError = "Outlook web tab not found. Open outlook.live.com signed in.";
  while (Date.now() < deadline) {
    const tabs = await findOutlookTabs();
    for (const tab of tabs) {
      if (!tab?.id) continue;
      const hit = await extractInTab(tab.id);
      if (hit?.ok && hit.code) {
        return { ok: true, code: hit.code, source: "outlook_tab" };
      }
      if (hit?.error) lastError = hit.error;
      else if (hit?.reason) lastError = hit.reason;
    }
    await sleep(2500);
  }
  return { ok: false, code: "", error: lastError };
}

function looksLikeApplicationUrl(url) {
  return /\b(apply|application|job-applications|easy-apply|jobapp|gh_jid)\b/i.test(String(url || ""));
}

function isDiceJobDetailUrl(url) {
  return /dice\.com\/job-detail\//i.test(String(url || ""));
}

function isDiceWizardUrl(url) {
  return /dice\.com\/job-applications\//i.test(String(url || ""));
}

/**
 * Dice often opens a duplicate /job-detail/ tab with "Continue Application" while
 * the real wizard (/job-applications/.../wizard) is already on Review + Submit.
 * Adopting that tab looks like progress, then the batch dies with "could not advance".
 */
function shouldAdoptNewApplyTab(originUrl, newUrl, newProbe) {
  if (newProbe?.applySuccess) return true;

  const origin = String(originUrl || "");
  const next = String(newUrl || "");
  if (applySiteFromUrl(origin) === "indeed" && !isUrlOnApplySite(next, "indeed")) {
    return false;
  }

  // Jobgether APPLY opens Workday / Greenhouse (or similar) — always follow.
  if (applySiteFromUrl(origin) === "jobgether") {
    const dest = applySiteFromUrl(next);
    if (isEmployerAtsSite(dest) || dest === "generic") {
      if (isEmployerAtsSite(dest)) return true;
      // Same-origin Jobgether deep link — keep looking; off-site unknown hosts still adopt if apply UI.
      try {
        const o = new URL(origin);
        const n = new URL(next);
        if (o.hostname !== n.hostname && /^https?:$/i.test(n.protocol)) {
          return true;
        }
      } catch {
        /* fall through */
      }
    }
  }

  // Never leave an in-progress Dice wizard for a job-detail listing.
  if (isDiceWizardUrl(origin) && isDiceJobDetailUrl(next)) return false;
  if (isDiceJobDetailUrl(next) && !newProbe?.anyForm) return false;

  const actionType = newProbe?.best?.action?.type || "";
  if (newProbe?.anyForm && actionType && actionType !== "entry") return true;
  if (isDiceWizardUrl(next)) return true;
  if (looksLikeApplicationUrl(next) && (newProbe?.anyForm || Boolean(actionType))) return true;
  // Workday / Greenhouse listing + Start Application modal (entry only).
  if (isEmployerAtsSite(applySiteFromUrl(next)) && (actionType === "entry" || newProbe?.anyForm)) {
    return true;
  }
  return false;
}

async function maybeCloseSpuriousDiceDetailTab(originUrl, tab) {
  if (!tab?.id) return;
  const originId = diceJobIdFromUrl(originUrl);
  const newId = diceJobIdFromUrl(tab.url || "");
  if (
    originId &&
    newId &&
    originId === newId &&
    isDiceWizardUrl(originUrl) &&
    isDiceJobDetailUrl(tab.url || "")
  ) {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function waitForApplyAdvance(tabId, prevSig, prevUrl, timeoutMs = 15000) {
  const start = Date.now();
  const knownTabIds = new Set((await chrome.tabs.query({})).map((t) => t.id));
  const originUrl = String(prevUrl || (await chrome.tabs.get(tabId).catch(() => null))?.url || "");

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
    if (successProbe?.emailVerification) {
      return {
        advanced: true,
        tabId,
        reason: "email_verification",
        emailVerification: true,
        emailVerificationText: successProbe.emailVerificationText || ""
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
      if (!(fresh?.id && /^https?:\/\//i.test(fresh.url || ""))) continue;

      const newProbe = await getApplyActionFromTab(fresh.id).catch(() => null);
      if (!shouldAdoptNewApplyTab(originUrl, fresh.url || "", newProbe)) {
        if (
          applySiteFromUrl(originUrl) === "indeed" &&
          !isUrlOnApplySite(fresh.url || "", "indeed")
        ) {
          knownTabIds.add(fresh.id);
          await chrome.tabs.update(tabId, { active: true }).catch(() => {});
          return {
            advanced: false,
            tabId,
            reason: "external_redirect",
            externalUrl: fresh.url || ""
          };
        }
        // Mark seen so we don't keep re-probing; close same-job detail noise.
        knownTabIds.add(fresh.id);
        await maybeCloseSpuriousDiceDetailTab(originUrl, fresh);
        // Keep focus on the wizard / original apply tab.
        await chrome.tabs.update(tabId, { active: true }).catch(() => {});
        continue;
      }

      await chrome.tabs.update(fresh.id, { active: true }).catch(() => {});
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

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.id) return { advanced: false, tabId, reason: "tab_gone" };
    if (
      applySiteFromUrl(originUrl) === "indeed" &&
      !isUrlOnApplySite(tab.url || "", "indeed")
    ) {
      return {
        advanced: false,
        tabId,
        reason: "external_redirect",
        externalUrl: tab.url || ""
      };
    }

    if (tab.url && prevUrl && tab.url !== prevUrl) {
      // Wizard → job-detail in the SAME tab is not useful progress.
      if (isDiceWizardUrl(prevUrl) && isDiceJobDetailUrl(tab.url)) {
        const wizard = diceWizardUrl(diceJobIdFromUrl(prevUrl) || diceJobIdFromUrl(tab.url));
        if (wizard) {
          await chrome.tabs.update(tabId, { url: wizard }).catch(() => {});
          await waitForTabComplete(tabId, 20000).catch(() => {});
          await sleep(500);
        }
        continue;
      }
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

/**
 * Apply bank + AI answers for unmatched text/choice questions already collected on the page.
 */
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
 * Collect leftover unmatched questions still empty on the page (second-pass inventory).
 */
async function collectRemainingUnmatchedFromTab(tabId, applicantInfo = {}) {
  const frameResults = await sendMessageToAllFrames(tabId, {
    type: "collect_unmatched_fields",
    applicantInfo
  }).catch(() => []);
  return mergeAutofillFrameResults(
    (frameResults || []).map((r) => ({
      ...r,
      filledCount: 0,
      filled: [],
      uploadedCount: 0,
      uploaded: [],
      uploadSkipped: []
    }))
  );
}

/**
 * One inventory AI pass for mixed leftovers (choices + free text) still unanswered.
 */
async function fillInventoryPlannerPass(tabId, inventory, extras, profileId, site, applicantInfo = {}) {
  const fields = [
    ...(Array.isArray(inventory?.unmatchedChoiceQuestions)
      ? inventory.unmatchedChoiceQuestions.map((q) => ({
          ...q,
          type: q.fieldType || "choice",
          options: q.options || []
        }))
      : []),
    ...(Array.isArray(inventory?.unmatchedQuestions)
      ? inventory.unmatchedQuestions.map((q) => ({
          ...q,
          type: q.fieldType || "text"
        }))
      : [])
  ];
  if (!fields.length) return { extraFilled: 0, bankHits: 0, aiHits: 0 };

  // Prefer bank/extras first via the normal path.
  const first = await fillUnmatchedAnswers(tabId, inventory, extras, profileId, site, applicantInfo);

  const still = await collectRemainingUnmatchedFromTab(tabId, applicantInfo);
  const leftoverFields = [
    ...(still.unmatchedChoiceQuestions || []).map((q) => ({
      ...q,
      type: q.fieldType || "choice",
      options: q.options || []
    })),
    ...(still.unmatchedQuestions || []).map((q) => ({
      ...q,
      type: q.fieldType || "text"
    }))
  ];
  if (!leftoverFields.length) return first;

  const { apiKey, model } = await getOpenAiSettings();
  if (!apiKey) return first;

  const info = await withResumeCertifications(applicantInfo);
  const ctx = await getAutofillAiContext();
  let aiHits = 0;
  let extraFilled = 0;
  try {
    const planned = await generateFormInventoryAnswers({
      apiKey,
      model,
      fields: leftoverFields,
      applicantInfo: {
        ...info,
        certifications: parseCertificationList(info.certifications).length
          ? info.certifications
          : ctx.certifications
      },
      jobMeta: ctx.jobMeta,
      resumeText: ctx.resumeText
    });
    const byFrame = new Map();
    for (const row of planned.answers || []) {
      const field = leftoverFields.find((f) => f.id === row.id);
      if (!field) continue;
      const fid = field.frameId;
      if (!byFrame.has(fid)) byFrame.set(fid, { choice: [], text: [] });
      const bucket = byFrame.get(fid);
      if (row.kind === "choice") bucket.choice.push(row);
      else bucket.text.push(row);
      aiHits += 1;
      if (field.label && shouldBankAnswer(field, row.answer, field.fieldType || "text")) {
        saveQa({
          profileId: profileId || "",
          question: field.label,
          answer: row.answer,
          fieldType: field.fieldType || (row.kind === "choice" ? "select" : "text"),
          source: "ai",
          site
        }).catch(() => {});
      }
    }
    for (const [frameId, packs] of byFrame) {
      if (packs.choice.length) {
        const cRes = await sendMessageToTab(
          tabId,
          { type: "autofill_choice_answers", answers: packs.choice },
          { attempts: 2, frameId }
        ).catch(() => null);
        extraFilled += Number(cRes?.filledCount || 0);
      }
      if (packs.text.length) {
        const tRes = await sendMessageToTab(
          tabId,
          { type: "autofill_ai_answers", answers: packs.text },
          { attempts: 2, frameId }
        ).catch(() => null);
        extraFilled += Number(tRes?.filledCount || 0);
      }
    }
  } catch (err) {
    await setApplyStatus(`Inventory AI skipped: ${String(err?.message || err)}`).catch(() => {});
  }

  return {
    extraFilled: first.extraFilled + extraFilled,
    bankHits: first.bankHits,
    aiHits: first.aiHits + aiHits
  };
}

/**
 * Second pass: re-collect empty unmatched / required fields and fill again.
 */
async function runSecondFillPass(tabId, extras, profileId, site, applicantInfo = {}) {
  const inventory = await collectRemainingUnmatchedFromTab(tabId, applicantInfo);
  const unmatchedCount =
    (inventory.unmatchedQuestions?.length || 0) + (inventory.unmatchedChoiceQuestions?.length || 0);
  if (!unmatchedCount) {
    return {
      extraFilled: 0,
      bankHits: 0,
      aiHits: 0,
      unmatchedAfter: 0,
      secondPass: true
    };
  }
  const leftover = await fillInventoryPlannerPass(
    tabId,
    inventory,
    extras,
    profileId,
    site,
    applicantInfo
  );
  const after = await collectRemainingUnmatchedFromTab(tabId, applicantInfo);
  return {
    ...leftover,
    unmatchedAfter:
      (after.unmatchedQuestions?.length || 0) + (after.unmatchedChoiceQuestions?.length || 0),
    secondPass: true
  };
}

async function probeValidationOnTab(tabId) {
  const frames = await sendMessageToAllFrames(tabId, { type: "probe_application_form" }).catch(
    () => []
  );
  for (const f of frames || []) {
    if (f?.validationReason) return String(f.validationReason);
    if (f?.blockedReason) return String(f.blockedReason);
  }
  return "";
}

/**
 * Before Submit: if required fields are still empty, refill once; still broken → needs_review reason.
 */
async function ensureRequiredFieldsBeforeSubmit(
  tabId,
  extras,
  profileId,
  site,
  applicantInfo,
  metrics
) {
  let validationReason = await probeValidationOnTab(tabId);
  if (!validationReason) return { ok: true, metrics };

  const pass = await runSecondFillPass(tabId, extras, profileId, site, applicantInfo);
  metrics.extraFilled = Number(metrics.extraFilled || 0) + Number(pass.extraFilled || 0);
  metrics.bankHits = Number(metrics.bankHits || 0) + Number(pass.bankHits || 0);
  metrics.aiHits = Number(metrics.aiHits || 0) + Number(pass.aiHits || 0);
  metrics.secondPassFilled =
    Number(metrics.secondPassFilled || 0) + Number(pass.extraFilled || 0);
  metrics.unmatchedAfterSecondPass = pass.unmatchedAfter;

  validationReason = await probeValidationOnTab(tabId);
  if (!validationReason) return { ok: true, metrics };
  return { ok: false, metrics, validationReason };
}

/**
 * Fill the current (or given) application tab from the active person.
 */
export async function startAutofillOnTab(tabId = null, applyHint = {}) {
  const { person, applicantInfo, extras, credentials } = await getApplicantInfoForAutofill();
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

  await rememberApplyTab(tab.id);

  if (tab.status === "loading") {
    try {
      await waitForTabComplete(tab.id, 25000);
    } catch {
      /* fill whatever is present */
    }
    await sleep(APPLY_SETTLE_MS);
  }

  const atsCreds = credentials || personToAtsCredentials(person);
  await ensureAutofillScript(tab.id);
  const frameResults = await sendMessageToAllFrames(tab.id, {
    type: "autofill_application",
    applicantInfo,
    credentials: {
      email: atsCreds.email || applicantInfo.email || "",
      username: atsCreds.username || atsCreds.email || applicantInfo.email || "",
      password: atsCreds.password || DEFAULT_ATS_PASSWORD
    },
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
  const unmatchedAfterFirst =
    (result.unmatchedQuestions?.length || 0) + (result.unmatchedChoiceQuestions?.length || 0);
  const second = await runSecondFillPass(tab.id, extras, person.id || "", site, applicantInfo);
  const filledTotal = result.filledCount + leftover.extraFilled + second.extraFilled;
  const controlCount = Number(result.fillableCount || 0) || Math.max(filledTotal, 1);

  const summaryPayload = {
    ok: Boolean(result.ok) || filledTotal > 0,
    tabId: tab.id,
    tabUrl: tab.url || "",
    filled: filledTotal,
    filledCount: filledTotal,
    fields: result.filled,
    uploaded: result.uploadedCount,
    uploadedCount: result.uploadedCount,
    uploadSkipped: result.uploadSkipped,
    bankHits: leftover.bankHits + second.bankHits,
    extraFilled: leftover.extraFilled + second.extraFilled,
    aiHits: (leftover.aiHits || 0) + (second.aiHits || 0),
    unmatchedQuestions: result.unmatchedQuestions,
    unmatchedChoiceQuestions: result.unmatchedChoiceQuestions,
    unmatchedAfterFirst,
    unmatchedAfterSecondPass: second.unmatchedAfter,
    unmatched: second.unmatchedAfter,
    secondPassFilled: second.extraFilled,
    fillRate:
      controlCount > 0 ? Math.round((Math.min(filledTotal, controlCount) / controlCount) * 100) : 0,
    uploadFolder: docs?.jobDir || docs?.folderName || "",
    uploadResumeName: docs?.resume?.fileName || "",
    uploadCoverName: docs?.coverLetter?.fileName || "",
    uploadCsvRow: hasCsvRow(csvRow) ? Number(csvRow) : ""
  };
  summaryPayload.statusText = formatAutofillSummary(summaryPayload);
  await notifyAutofillToast(tab.id, summaryPayload);
  await scanFieldsOnTab(tab.id).catch(() => {});
  return summaryPayload;
}

/**
 * Multi-step apply: fill → click Next/Continue → wait → refill.
 * Stops before Submit unless autoSubmit is true on a supported in-site flow.
 * Assist mode (popup Autofill/Auto Apply / Ctrl+Shift+U) never auto-submits —
 * even on Greenhouse/Ashby/Lever — so redirects cannot flip submit on.
 */
export async function startMultiStepApplyOnTab(
  tabId = null,
  { maxSteps = 12, applyHint = {}, autoSubmit = false, assistMode = false, onProgress = null, shouldAbort = null } = {}
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

  await rememberApplyTab(tab.id);

  const unavailableAtStart = await probeTabJobUnavailable(tab.id);
  if (unavailableAtStart) {
    return {
      ok: true,
      steps: 0,
      filled: 0,
      filledCount: 0,
      uploaded: 0,
      uploadedCount: 0,
      bankHits: 0,
      extraFilled: 0,
      aiHits: 0,
      unmatchedAfterFirst: 0,
      unmatchedAfterSecondPass: 0,
      secondPassFilled: 0,
      fillRate: 0,
      status: unavailableAtStart.status,
      detail: unavailableAtStart.detail,
      tabId: tab.id,
      tabUrl: tab.url || "",
      autoSubmit: Boolean(autoSubmit),
      assistMode: Boolean(assistMode),
      site: applySiteFromUrl(tab.url || "")
    };
  }

  let currentTabId = tab.id;
  const initialSite = applySiteFromUrl(tab.url || "");
  let liveSite = initialSite;
  let stepBudget = stepBudgetForSite(initialSite, maxSteps);
  // Assist mode stops before Submit unless caller passes autoSubmit with assistMode false.
  let effectiveAutoSubmit = assistMode
    ? false
    : resolveEffectiveAutoSubmit(initialSite, autoSubmit);
  let siteLabel = applySiteLabel(initialSite);
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
    unmatchedAfterFirst: 0,
    unmatchedAfterSecondPass: 0,
    secondPassFilled: 0,
    fillRate: 0,
    status: "",
    detail: "",
    tabId: currentTabId,
    tabUrl: tab.url || "",
    autoSubmit: effectiveAutoSubmit,
    assistMode: Boolean(assistMode),
    site: initialSite
  };

  const { person, applicantInfo, extras } = await getApplicantInfoForAutofill();
  const metricsPersonId = person?.id || "";
  const metricsSiteHost = () => hostnameFromUrl(summary.tabUrl || "");

  let noAdvance = 0;
  let workdayStepHint = "";
  let greenhouseSubmitAt = 0;

  function syncLiveSiteFromUrl(url) {
    const detected = applySiteFromUrl(url || "");
    if (!detected || detected === liveSite) return;
    // Upgrade Jobgether / generic → employer ATS after APPLY redirect.
    if (
      isEmployerAtsSite(detected) &&
      (liveSite === "jobgether" || liveSite === "generic" || liveSite === detected)
    ) {
      liveSite = detected;
      siteLabel = applySiteLabel(detected);
      summary.site = detected;
      if (
        !assistMode &&
        (Boolean(autoSubmit) ||
          initialSite === "jobgether" ||
          getAdapter(detected)?.alwaysAutoSubmit ||
          getAdapter(initialSite)?.alwaysAutoSubmit)
      ) {
        effectiveAutoSubmit = resolveEffectiveAutoSubmit(detected, true);
        summary.autoSubmit = effectiveAutoSubmit;
      }
      stepBudget = Math.max(stepBudget, stepBudgetForSite(detected, stepBudget));
    }
  }

  for (let step = 0; step < stepBudget; step += 1) {
    if (typeof shouldAbort === "function" && shouldAbort()) {
      summary.status = "cancelled";
      summary.detail = "Autofill cancelled.";
      reportAutofillProgress(currentTabId, onProgress, {
        phase: "cancelled",
        statusText: "Cancelled.",
        progressPct: 0
      });
      return summary;
    }
    const currentTab = await chrome.tabs.get(currentTabId).catch(() => null);
    syncLiveSiteFromUrl(currentTab?.url || "");
    if (
      initialSite === "indeed" &&
      !isUrlOnApplySite(currentTab?.url || "", "indeed")
    ) {
      summary.status = "skipped";
      summary.detail =
        "Indeed redirected to an external ATS. Automatic filling and submission stopped.";
      summary.tabId = currentTabId;
      summary.tabUrl = currentTab?.url || summary.tabUrl;
      return summary;
    }
    const stepLabel = workdayStepHint
      ? `${siteLabel} · ${workdayStepHint}`
      : siteLabel;
    await setApplyStatus(`Apply: ${stepLabel} (${step + 1}/${stepBudget}) — checking page...`);
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

    if (probe.blockedReason) {
      summary.status = "needs_review";
      summary.detail = probe.blockedReason;
      summary.tabId = currentTabId;
      return summary;
    }

    if (probe.applySuccess) {
      summary.status = "submitted";
      summary.detail = probe.applySuccessText || "Your application is on its way";
      summary.tabId = currentTabId;
      return summary;
    }
    if (probe.emailVerification && effectiveAutoSubmit && liveSite === "greenhouse") {
      const otp = await completeGreenhouseEmailVerification(currentTabId, {
        afterEpochMs: greenhouseSubmitAt || Date.now() - 120_000
      });
      if (otp.ok) {
        summary.status = "submitted";
        summary.detail = otp.detail || "Your application has been received";
        summary.tabId = currentTabId;
        return summary;
      }
      summary.status = "needs_review";
      summary.detail = otp.detail || "Greenhouse security code verification failed.";
      summary.tabId = currentTabId;
      return summary;
    }
    if (probe.blockedReason) {
      summary.status = "needs_review";
      summary.detail = probe.blockedReason;
      summary.tabId = currentTabId;
      return summary;
    }

    if (probe.workdayWizard) {
      workdayStepHint = probe.workdayWizard.current || workdayStepHint;
      // Cap the loop to what this employer actually shows (+ room for account/auth).
      const detected = Number(probe.workdayWizard.stepCount || 0);
      if (detected > 0) {
        const adaptive = Math.min(22, Math.max(detected + 5, 8));
        if (adaptive < stepBudget) stepBudget = adaptive;
      }
    }

    if (!probe.anyForm && (!probe.best || probe.best.action.type === "entry")) {
      const live = await chrome.tabs.get(currentTabId).catch(() => null);
      const prevUrl = live?.url || "";
      const prevSig = probe.signature || "";
      let alreadyOpen = false;
      let followExternal = initialSite === "jobgether" || liveSite === "jobgether";
      let followUrl = "";

      if (probe.best?.action?.type === "entry") {
        const entryClick = await sendMessageToTab(
          currentTabId,
          { type: "click_apply_action", preferredType: "entry", autoSubmit: false },
          { attempts: 2, frameId: probe.best.frameId }
        ).catch(() => null);
        followExternal = followExternal || Boolean(entryClick?.followExternal);
        followUrl = String(entryClick?.externalUrl || "").trim();
        if (entryClick?.externalRedirect && !followExternal) {
          summary.status = "skipped";
          summary.detail =
            "Indeed uses an external ATS for this job. Automatic application was not started.";
          summary.tabId = currentTabId;
          return summary;
        }
      } else {
        const entry = await sendMessageToTab(
          currentTabId,
          { type: "click_easy_apply_entry" },
          { attempts: 2 }
        ).catch(() => null);
        alreadyOpen = Boolean(entry?.alreadyOpen);
        followExternal = followExternal || Boolean(entry?.followExternal);
        followUrl = String(entry?.externalUrl || "").trim();
        if (entry?.externalRedirect && !followExternal) {
          summary.status = "skipped";
          summary.detail =
            "Indeed uses an external ATS for this job. Automatic application was not started.";
          summary.tabId = currentTabId;
          return summary;
        }
        if (!entry?.clicked && !alreadyOpen && probe.applyUrls?.length) {
          const nextUrl =
            probe.applyUrls
              .map((url) => String(url || "").trim())
              .find((url) => {
                if (!url) return false;
                if (initialSite === "indeed") return isUrlOnApplySite(url, "indeed");
                if (initialSite === "jobgether" || liveSite === "jobgether") {
                  return isEmployerAtsSite(applySiteFromUrl(url));
                }
                return true;
              }) ||
            (initialSite === "jobgether" || liveSite === "jobgether"
              ? ""
              : probe.applyUrls.map((u) => String(u || "").trim()).find(Boolean)) ||
            "";
          if (initialSite === "indeed" && !nextUrl) {
            summary.status = "skipped";
            summary.detail =
              "Indeed uses an external ATS for this job. Automatic application was not started.";
            summary.tabId = currentTabId;
            return summary;
          }
          if (nextUrl) {
            followUrl = nextUrl;
            await chrome.tabs.update(currentTabId, { url: nextUrl });
            await waitForTabComplete(currentTabId, 30000).catch(() => {});
            syncLiveSiteFromUrl(nextUrl);
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
        if (followExternal) {
          await setApplyStatus(
            `Apply: Jobgether — waiting for Workday / Greenhouse…`
          );
        }
        const advanced = await waitForApplyAdvance(
          currentTabId,
          prevSig,
          prevUrl,
          followExternal ? 20000 : 12000
        );
        // Jobgether intentionally follows off-site ATS — adopt that tab instead of skipping.
        if (advanced.reason === "external_redirect" && !followExternal) {
          summary.status = "skipped";
          summary.detail =
            "Indeed redirected to an external ATS. Automatic application was stopped.";
          summary.tabId = advanced.tabId || currentTabId;
          return summary;
        }
        if (
          followExternal &&
          !advanced.advanced &&
          followUrl &&
          isEmployerAtsSite(applySiteFromUrl(followUrl))
        ) {
          await chrome.tabs.update(currentTabId, { url: followUrl });
          await waitForTabComplete(currentTabId, 30000).catch(() => {});
          syncLiveSiteFromUrl(followUrl);
        } else {
          currentTabId = advanced.tabId || currentTabId;
        }
        await rememberApplyTab(currentTabId);
        const afterUrl = (await chrome.tabs.get(currentTabId).catch(() => null))?.url || "";
        syncLiveSiteFromUrl(afterUrl);
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

    const fillStepLabel = workdayStepHint
      ? `${siteLabel} · ${workdayStepHint}`
      : siteLabel;
    reportAutofillProgress(currentTabId, onProgress, {
      phase: "step",
      step: step + 1,
      stepLabel: workdayStepHint || fillStepLabel,
      statusText: `Step ${step + 1}/${stepBudget} — filling…`
    });
    await setApplyStatus(`Apply: ${fillStepLabel} (${step + 1}/${stepBudget}) — filling form...`);
    const fillRes = await startAutofillOnTab(currentTabId, applyHint);
    summary.filled += Number(fillRes?.filledCount || 0);
    summary.filledCount = summary.filled;
    summary.uploaded += Number(fillRes?.uploadedCount || 0);
    summary.uploadedCount = summary.uploaded;
    summary.bankHits += Number(fillRes?.bankHits || 0);
    summary.extraFilled += Number(fillRes?.extraFilled || 0);
    summary.aiHits += Number(fillRes?.aiHits || 0);
    summary.unmatchedAfterFirst += Number(fillRes?.unmatchedAfterFirst || 0);
    summary.unmatchedAfterSecondPass = Number(
      fillRes?.unmatchedAfterSecondPass ?? summary.unmatchedAfterSecondPass ?? 0
    );
    summary.secondPassFilled += Number(fillRes?.secondPassFilled || 0);
    if (Number(fillRes?.fillRate || 0) > 0) {
      summary.fillRate = Math.max(Number(summary.fillRate || 0), Number(fillRes.fillRate));
    }
    summary.uploadResumeName = fillRes?.uploadResumeName || summary.uploadResumeName || "";
    summary.uploadCoverName = fillRes?.uploadCoverName || summary.uploadCoverName || "";
    summary.uploadFolder = fillRes?.uploadFolder || summary.uploadFolder || "";
    summary.steps = step + 1;
    summary.tabId = currentTabId;
    summary.tabUrl = (await chrome.tabs.get(currentTabId).catch(() => null))?.url || summary.tabUrl;

    reportAutofillProgress(currentTabId, onProgress, {
      phase: "filled",
      step: step + 1,
      filledCount: summary.filled,
      bankHits: summary.bankHits,
      aiHits: summary.aiHits,
      statusText: formatAutofillSummary({
        filledCount: fillRes?.filledCount,
        bankHits: fillRes?.bankHits,
        aiHits: fillRes?.aiHits,
        unmatchedAfterSecondPass: fillRes?.unmatchedAfterSecondPass
      })
    });

    probe = await getApplyActionFromTab(currentTabId).catch(() => ({ best: null, anyForm: false }));
    if (probe.workdayWizard?.current) {
      workdayStepHint = probe.workdayWizard.current;
    }

    if (probe.applySuccess) {
      summary.status = "submitted";
      summary.detail = probe.applySuccessText || "Your application is on its way";
      summary.tabId = currentTabId;
      return summary;
    }

    // Workday Review (including short wizards) paints Submit after fill — wait briefly.
    if (
      (!probe.best || (probe.workdayWizard?.isReview && probe.best.action?.type !== "submit")) &&
      probe.anyForm
    ) {
      for (let retry = 0; retry < 8 && !(probe.best?.action?.type === "submit"); retry += 1) {
        await sleep(450 + retry * 100);
        probe = await getApplyActionFromTab(currentTabId).catch(() => probe);
        if (probe.workdayWizard?.current) workdayStepHint = probe.workdayWizard.current;
        if (probe.applySuccess) {
          summary.status = "submitted";
          summary.detail = probe.applySuccessText || "Your application is on its way";
          summary.tabId = currentTabId;
          return summary;
        }
        if (probe.best && !probe.workdayWizard?.isReview) break;
      }
    }

    // Dice review step paints sticky footer Submit slightly after fill completes.
    if (!probe.best && probe.anyForm) {
      for (let retry = 0; retry < 8 && !probe.best; retry += 1) {
        await sleep(450 + retry * 100);
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
      if (effectiveAutoSubmit) {
        const gate = await ensureRequiredFieldsBeforeSubmit(
          currentTabId,
          extras,
          metricsPersonId,
          metricsSiteHost() || liveSite,
          applicantInfo,
          summary
        );
        if (!gate.ok) {
          summary.status = "needs_review";
          summary.detail =
            gate.validationReason ||
            probe.blockedReason ||
            probe.validationReason ||
            "A required answer needs review.";
          summary.tabId = currentTabId;
          return summary;
        }
        probe = await getApplyActionFromTab(currentTabId).catch(() => probe);
        if (probe.blockedReason) {
          summary.status = "needs_review";
          summary.detail = probe.blockedReason;
          summary.tabId = currentTabId;
          return summary;
        }
        await setApplyStatus(`Apply: submitting (${probe.best.action.text || "Submit"})...`);
        const live = await chrome.tabs.get(currentTabId).catch(() => null);
        const prevUrl = live?.url || "";
        const prevSig = probe.signature || "";
        const clickRes = await sendMessageToTab(
          currentTabId,
          { type: "click_apply_action", preferredType: "submit", autoSubmit: true },
          { attempts: 2, frameId: probe.best.frameId }
        ).catch((err) => ({ ok: false, error: String(err?.message || err) }));

        if (clickRes?.externalRedirect) {
          summary.status = "skipped";
          summary.detail =
            "Submission would leave Indeed for an external ATS, so it was not clicked.";
          summary.tabId = currentTabId;
          return summary;
        }
        if (clickRes?.clicked || clickRes?.submitted) {
          greenhouseSubmitAt = Date.now();
          const confirmed = await waitForApplySuccess(currentTabId, liveSite, 20000);
          if (confirmed.ok) {
            summary.status = "submitted";
            summary.detail = confirmed.text || "Your application is on its way";
            summary.tabId = currentTabId;
            return summary;
          }
          if (confirmed.reason === "email_verification" && liveSite === "greenhouse") {
            const otp = await completeGreenhouseEmailVerification(currentTabId, {
              afterEpochMs: greenhouseSubmitAt
            });
            if (otp.ok) {
              summary.status = "submitted";
              summary.detail = otp.detail || "Your application has been received";
              summary.tabId = currentTabId;
              return summary;
            }
            summary.status = "needs_review";
            summary.detail = otp.detail || "Greenhouse security code verification failed.";
            summary.tabId = currentTabId;
            return summary;
          }
          if (confirmed.reason === "external_redirect") {
            summary.status = "skipped";
            summary.detail =
              "Indeed redirected to an external ATS after the click. Submission was not confirmed.";
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
          if (advanced?.emailVerification && liveSite === "greenhouse") {
            const otp = await completeGreenhouseEmailVerification(currentTabId, {
              afterEpochMs: greenhouseSubmitAt
            });
            if (otp.ok) {
              summary.status = "submitted";
              summary.detail = otp.detail || "Your application has been received";
              summary.tabId = currentTabId;
              return summary;
            }
            summary.status = "needs_review";
            summary.detail = otp.detail || "Greenhouse security code verification failed.";
            summary.tabId = currentTabId;
            return summary;
          }
          if (advanced?.reason === "external_redirect") {
            summary.status = "skipped";
            summary.detail =
              "Indeed redirected to an external ATS after the click. Submission was not confirmed.";
            summary.tabId = advanced.tabId || currentTabId;
            return summary;
          }
          summary.status = "needs_review";
          summary.detail =
            `Submit was clicked but the ${siteLabel} success screen was not detected. Confirm in the tab, then click Start.`;
          summary.tabId = currentTabId;
          return summary;
        }
        summary.status = "needs_review";
        summary.detail =
          clickRes?.error ||
          clickRes?.validationReason ||
          clickRes?.blockedReason ||
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

    // Empty optional Workday pages (no fields): advance quickly instead of over-filling.
    if (
      liveSite === "workday" &&
      actionType === "next" &&
      Number(probe.fillableCount || 0) === 0 &&
      Number(fillRes?.filledCount || 0) === 0
    ) {
      await setApplyStatus(
        `Apply: ${siteLabel}${workdayStepHint ? ` · ${workdayStepHint}` : ""} — empty step, continuing…`
      );
    }

    await setApplyStatus(`Apply: clicking ${probe.best.action.text || actionType}...`);
    reportAutofillProgress(currentTabId, onProgress, {
      phase: "advance",
      action: probe.best.action.type,
      statusText: `Clicking ${probe.best.action.text || actionType}…`
    });
    const clickRes = await sendMessageToTab(
      currentTabId,
      { type: "click_apply_action", preferredType: actionType, autoSubmit: false },
      { attempts: 2, frameId: probe.best.frameId }
    ).catch((err) => ({ ok: false, error: String(err?.message || err) }));

    if (clickRes?.isSubmit) {
      if (effectiveAutoSubmit) {
        await setApplyStatus("Apply: submitting...");
        const submitRes = await sendMessageToTab(
          currentTabId,
          { type: "click_apply_action", preferredType: "submit", autoSubmit: true },
          { attempts: 2, frameId: probe.best.frameId }
        ).catch((err) => ({ ok: false, error: String(err?.message || err) }));
        if (submitRes?.externalRedirect) {
          summary.status = "skipped";
          summary.detail =
            "Submission would leave Indeed for an external ATS, so it was not clicked.";
          summary.tabId = currentTabId;
          return summary;
        }
        if (submitRes?.clicked || submitRes?.submitted) {
          greenhouseSubmitAt = Date.now();
          const confirmed = await waitForApplySuccess(currentTabId, liveSite, 20000);
          if (confirmed.ok) {
            summary.status = "submitted";
            summary.detail = confirmed.text || "Your application is on its way";
            summary.tabId = currentTabId;
            return summary;
          }
          if (confirmed.reason === "email_verification" && liveSite === "greenhouse") {
            const otp = await completeGreenhouseEmailVerification(currentTabId, {
              afterEpochMs: greenhouseSubmitAt
            });
            if (otp.ok) {
              summary.status = "submitted";
              summary.detail = otp.detail || "Your application has been received";
              summary.tabId = currentTabId;
              return summary;
            }
            summary.status = "needs_review";
            summary.detail = otp.detail || "Greenhouse security code verification failed.";
            summary.tabId = currentTabId;
            return summary;
          }
          if (confirmed.reason === "external_redirect") {
            summary.status = "skipped";
            summary.detail =
              "Indeed redirected to an external ATS after the click. Submission was not confirmed.";
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
          if (advanced?.emailVerification && liveSite === "greenhouse") {
            const otp = await completeGreenhouseEmailVerification(currentTabId, {
              afterEpochMs: greenhouseSubmitAt
            });
            if (otp.ok) {
              summary.status = "submitted";
              summary.detail = otp.detail || "Your application has been received";
              summary.tabId = currentTabId;
              return summary;
            }
            summary.status = "needs_review";
            summary.detail = otp.detail || "Greenhouse security code verification failed.";
            summary.tabId = currentTabId;
            return summary;
          }
          if (advanced?.reason === "external_redirect") {
            summary.status = "skipped";
            summary.detail =
              "Indeed redirected to an external ATS after the click. Submission was not confirmed.";
            summary.tabId = advanced.tabId || currentTabId;
            return summary;
          }
          summary.status = "needs_review";
          summary.detail =
            `Submit was clicked but the ${siteLabel} success screen was not detected. Confirm in the tab, then click Start.`;
          return summary;
        }
        summary.status = "needs_review";
        summary.detail =
          submitRes?.error ||
          submitRes?.validationReason ||
          submitRes?.blockedReason ||
          "Reached Submit but could not click it (a required field or CAPTCHA likely needs your input).";
        return summary;
      }
      summary.status = "ready_for_review";
      summary.detail = "Reached the final Submit step. Stopped so you can review and submit.";
      return summary;
    }

    const advanced = await waitForApplyAdvance(currentTabId, prevSig, prevUrl, 15000);
    if (advanced.reason === "external_redirect") {
      summary.status = "skipped";
      summary.detail =
        "Indeed redirected to an external ATS. Automatic application was stopped.";
      summary.tabId = advanced.tabId || currentTabId;
      return summary;
    }
    currentTabId = advanced.tabId;
    await rememberApplyTab(currentTabId);
    summary.tabId = currentTabId;

    if (advanced.applySuccess) {
      summary.status = "submitted";
      summary.detail = advanced.applySuccessText || "Your application is on its way";
      return summary;
    }
    if (advanced.emailVerification && effectiveAutoSubmit && liveSite === "greenhouse") {
      greenhouseSubmitAt = greenhouseSubmitAt || Date.now();
      const otp = await completeGreenhouseEmailVerification(currentTabId, {
        afterEpochMs: greenhouseSubmitAt
      });
      if (otp.ok) {
        summary.status = "submitted";
        summary.detail = otp.detail || "Your application has been received";
        summary.tabId = currentTabId;
        return summary;
      }
      summary.status = "needs_review";
      summary.detail = otp.detail || "Greenhouse security code verification failed.";
      summary.tabId = currentTabId;
      return summary;
    }

    if (advanced.advanced) {
      noAdvance = 0;
      const thirdPass = await runSecondFillPass(
        currentTabId,
        extras,
        metricsPersonId,
        metricsSiteHost() || liveSite,
        applicantInfo
      );
      summary.filled += Number(thirdPass.extraFilled || 0);
      summary.filledCount = summary.filled;
      summary.bankHits += Number(thirdPass.bankHits || 0);
      summary.extraFilled += Number(thirdPass.extraFilled || 0);
      summary.aiHits += Number(thirdPass.aiHits || 0);
      summary.unmatchedAfterSecondPass = Number(thirdPass.unmatchedAfter ?? summary.unmatchedAfterSecondPass);
      summary.secondPassFilled += Number(thirdPass.extraFilled || 0);
      await notifyAutofillToast(currentTabId, {
        filledCount: summary.filled,
        bankHits: summary.bankHits,
        aiHits: summary.aiHits,
        unmatchedAfterSecondPass: summary.unmatchedAfterSecondPass,
        text: `Step ${step + 1}/${stepBudget} — ${formatAutofillSummary(summary)}`
      });
    } else {
      noAdvance += 1;
      if (noAdvance >= 2) {
        // Still on the wizard with Submit visible — try final submit once before pausing.
        if (effectiveAutoSubmit) {
          const lastProbe = await getApplyActionFromTab(currentTabId).catch(() => null);
          if (lastProbe?.best?.action?.type === "submit") {
            const gate = await ensureRequiredFieldsBeforeSubmit(
              currentTabId,
              extras,
              metricsPersonId,
              metricsSiteHost() || liveSite,
              applicantInfo,
              summary
            );
            if (!gate.ok) {
              summary.status = "needs_review";
              summary.detail =
                gate.validationReason ||
                lastProbe.blockedReason ||
                lastProbe.validationReason ||
                "A required answer needs review.";
              return summary;
            }
            if (lastProbe.blockedReason) {
              summary.status = "needs_review";
              summary.detail = lastProbe.blockedReason;
              return summary;
            }
            await setApplyStatus(
              `Apply: retrying Submit (${lastProbe.best.action.text || "Submit"})...`
            );
            const submitRes = await sendMessageToTab(
              currentTabId,
              { type: "click_apply_action", preferredType: "submit", autoSubmit: true },
              { attempts: 2, frameId: lastProbe.best.frameId }
            ).catch((err) => ({ ok: false, error: String(err?.message || err) }));
            if (submitRes?.clicked || submitRes?.submitted) {
              greenhouseSubmitAt = Date.now();
              const confirmed = await waitForApplySuccess(currentTabId, liveSite, 20000);
              if (confirmed.ok) {
                summary.status = "submitted";
                summary.detail = confirmed.text || "Your application is on its way";
                summary.tabId = currentTabId;
                return summary;
              }
              if (confirmed.reason === "email_verification" && liveSite === "greenhouse") {
                const otp = await completeGreenhouseEmailVerification(currentTabId, {
                  afterEpochMs: greenhouseSubmitAt
                });
                if (otp.ok) {
                  summary.status = "submitted";
                  summary.detail = otp.detail || "Your application has been received";
                  summary.tabId = currentTabId;
                  return summary;
                }
                summary.status = "needs_review";
                summary.detail = otp.detail || "Greenhouse security code verification failed.";
                summary.tabId = currentTabId;
                return summary;
              }
              if (confirmed.reason === "external_redirect") {
                summary.status = "skipped";
                summary.detail =
                  "Indeed redirected to an external ATS after the click. Submission was not confirmed.";
                summary.tabId = currentTabId;
                return summary;
              }
            }
          }
        }
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
  { multiStep = true, csvRow, jobDir, jdLink, autoSubmit = false, openOnly = false } = {}
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
    await rememberApplyTab(tab.id);
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    if (!existing.isWizard && jobId && /dice\.com/i.test(tab.url || href)) {
      await chrome.tabs.update(tab.id, { url: diceWizardUrl(jobId) });
      await waitForTabComplete(tab.id, 35000).catch(() => {});
    }
  } else {
    const startUrl = jobId && /dice\.com/i.test(href) ? diceWizardUrl(jobId) : href;
    tab = await chrome.tabs.create({ url: startUrl, active: true });
    await rememberApplyTab(tab.id);
    try {
      await waitForTabComplete(tab.id, 35000);
    } catch {
      /* fill anyway */
    }
  }
  await sleep(APPLY_SETTLE_MS);
  let unavailable = await probeTabJobUnavailable(tab.id);
  if (unavailable) return unavailable;

  const live = await chrome.tabs.get(tab.id).catch(() => null);
  if (jobId && /dice\.com/i.test(live?.url || href)) {
    let probe = await getApplyActionFromTab(tab.id).catch(() => null);
    if (!probe?.anyForm && !probe?.best?.action) {
      await chrome.tabs.update(tab.id, { url: href });
      await waitForTabComplete(tab.id, 35000).catch(() => {});
      await sleep(APPLY_SETTLE_MS);
      unavailable = await probeTabJobUnavailable(tab.id);
      if (unavailable) return unavailable;
    }
  }
  if (openOnly) {
    return {
      status: "opened",
      tabId: tab.id,
      detail: "Job link opened.",
      openedOnly: true
    };
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
