/**
 * Application autofill orchestrator.
 * Injects content/autofill.js into all frames, fills from the active person,
 * then answers leftover questions from extras + the Q&A bank, then OpenAI.
 * Multi-step Apply clicks Next/Continue but never auto-submits.
 */

import { getApplicantInfoForAutofill, applyLearnedApplicantField, mergeAutofillExtras, getActivePerson } from "./profiles.js";
import { buildWorkHistory, buildEducationHistory, hasFormHistory } from "./history.js";
import { findQaMatch, saveQa, recordQaUsage, normalizeQuestion, questionSimilarity } from "./qa-store.js";
import { getEnv } from "./env.js";
import { DEFAULT_OPENAI_MODEL } from "./openai.js";
import { normalizeJobLink } from "./sheets.js";
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

const LAST_DOCS_KEY = "last_generated_docs";
const JOB_DOCS_KEY = "job_generated_docs";
const MAX_JOB_DOCS = 40;
const AUTOFILL_SCRIPT_BUILD = "2026-08-16.13";
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

function jobDocsId({ csvRow, jobDir } = {}) {
  if (csvRow != null && String(csvRow).trim() !== "" && !Number.isNaN(Number(csvRow))) {
    return `row:${Number(csvRow)}`;
  }
  const dir = String(jobDir || "").trim();
  return dir ? `dir:${dir}` : "";
}

async function readJobDocsMap() {
  const data = await chrome.storage.local.get(JOB_DOCS_KEY);
  return data[JOB_DOCS_KEY] && typeof data[JOB_DOCS_KEY] === "object" ? data[JOB_DOCS_KEY] : {};
}

async function persistJobGeneratedDocs(partial = {}) {
  const csvRow = partial.csvRow != null && String(partial.csvRow).trim() !== "" ? Number(partial.csvRow) : null;
  const jobDir = String(partial.jobDir || partial.folderName || "").trim();
  const id = jobDocsId({ csvRow, jobDir });
  if (!id) return null;
  const map = await readJobDocsMap();
  const prev = map[id] || {};
  map[id] = {
    ...prev,
    csvRow: csvRow != null && !Number.isNaN(csvRow) ? csvRow : prev.csvRow,
    jobDir: jobDir || prev.jobDir || "",
    jdLink: String(partial.jdLink || prev.jdLink || "").trim(),
    resume: docsHaveFile(partial, "resume") ? partial.resume : prev.resume || null,
    coverLetter: docsHaveFile(partial, "coverLetter") ? partial.coverLetter : prev.coverLetter || null,
    savedAt: Date.now()
  };
  const ranked = Object.entries(map).sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0));
  const pruned = Object.fromEntries(ranked.slice(0, MAX_JOB_DOCS));
  try {
    await chrome.storage.local.set({ [JOB_DOCS_KEY]: pruned });
  } catch {
    /* quota */
  }
  return map[id];
}

function docsHaveFile(docs, kind) {
  return Boolean(docs?.[kind]?.base64);
}

function pickJobDocsFromMap(map, { csvRow, jobDir, jdLink } = {}) {
  const id = jobDocsId({ csvRow, jobDir });
  if (id && map[id]) return map[id];
  const rows = Object.values(map);
  if (jobDir) {
    const byDir = rows.find((row) => String(row?.jobDir || "") === String(jobDir));
    if (byDir) return byDir;
  }
  if (csvRow != null && String(csvRow).trim() !== "") {
    const byRow = rows.find((row) => Number(row?.csvRow) === Number(csvRow));
    if (byRow) return byRow;
  }
  const want = normalizeJobLink(jdLink || "");
  if (want) {
    const byLink = rows.find((row) => normalizeJobLink(row?.jdLink || "") === want);
    if (byLink) return byLink;
  }
  return null;
}

async function lookupSavedJobFolder({ csvRow, jobDir, jdLink } = {}) {
  if (jobDir) return { csvRow, jobDir, jdLink };
  const data = await chrome.storage.local.get(["job_queue", "apply_history"]);
  const queue = Array.isArray(data.job_queue) ? data.job_queue : [];
  const hist = data.apply_history && typeof data.apply_history === "object" ? data.apply_history : {};
  if (csvRow != null && String(csvRow).trim() !== "") {
    const job = queue.find((j) => Number(j.csvRow) === Number(csvRow));
    if (job?.jobDir) {
      return { csvRow: job.csvRow, jobDir: job.jobDir, jdLink: job.jdLink || jdLink };
    }
    const remembered = hist[String(csvRow)];
    if (remembered?.jobDir) {
      return { csvRow, jobDir: remembered.jobDir, jdLink: remembered.jdLink || jdLink };
    }
  }
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
  return `${String(jobDir || "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\//g, "[\\\\/]")}.*`;
}

function isResumeDownload(filename) {
  const name = String(filename || "").replace(/\\/g, "/").split("/").pop() || "";
  return /resume\.pdf$/i.test(name) && !/cover/i.test(name);
}

function isCoverLetterDownload(filename) {
  const name = String(filename || "").replace(/\\/g, "/").split("/").pop() || "";
  return /cover[\s_-]*letter\.pdf$/i.test(name);
}

function filePathToUrl(absPath) {
  let p = String(absPath || "").trim().replace(/\\/g, "/");
  if (!p) return "";
  if (/^[a-zA-Z]:/.test(p)) p = `/${p}`;
  if (!p.startsWith("/")) p = `/${p}`;
  return `file://${encodeURI(p)}`;
}

async function readLocalPdfDoc(absPath, fallbackName) {
  const url = filePathToUrl(absPath);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 80) return null;
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const fileName = String(absPath).replace(/\\/g, "/").split("/").pop() || fallbackName;
    return {
      fileName,
      mimeType: "application/pdf",
      base64: btoa(binary)
    };
  } catch {
    return null;
  }
}

async function loadDocsFromDownloads(jobDir) {
  const prefix = String(jobDir || "").trim();
  if (!prefix || !chrome.downloads?.search) return null;
  let results = [];
  try {
    results = await chrome.downloads.search({
      filenameRegex: downloadPrefixRegex(prefix),
      limit: 40,
      orderBy: ["-startTime"]
    });
  } catch {
    results = [];
  }
  if (!results?.length) {
    const segment = prefix.split("/").pop();
    if (segment) {
      results = await chrome.downloads.search({
        query: [segment],
        limit: 40,
        orderBy: ["-startTime"]
      }).catch(() => []);
    }
  }
  const items = (results || []).filter((row) => row?.filename && row.state === "complete");
  const resumeItem = items.find((row) => isResumeDownload(row.filename));
  const coverItem = items.find((row) => isCoverLetterDownload(row.filename));
  const resume = resumeItem ? await readLocalPdfDoc(resumeItem.filename, "Resume.pdf") : null;
  const coverLetter = coverItem ? await readLocalPdfDoc(coverItem.filename, "Cover_Letter.pdf") : null;
  if (!resume && !coverLetter) return null;
  return { resume, coverLetter, folderName: prefix, via: "downloads" };
}

/**
 * Resume + cover letter PDFs for this job folder, not the last batch job.
 */
export async function resolveUploadDocs({ csvRow, jobDir, jdLink } = {}) {
  const located = await lookupSavedJobFolder({ csvRow, jobDir, jdLink });
  const map = await readJobDocsMap();
  let docs = pickJobDocsFromMap(map, located);
  const last = await getLastGeneratedDocs();
  const lastMatches =
    last &&
    located.jobDir &&
    String(last.folderName || "") === String(located.jobDir);

  if (!docsHaveFile(docs, "resume") || !docsHaveFile(docs, "coverLetter")) {
    const fromDisk = located.jobDir ? await loadDocsFromDownloads(located.jobDir) : null;
    if (fromDisk) {
      docs = {
        ...(docs || {}),
        resume: docsHaveFile(docs, "resume") ? docs.resume : fromDisk.resume,
        coverLetter: docsHaveFile(docs, "coverLetter") ? docs.coverLetter : fromDisk.coverLetter,
        jobDir: located.jobDir,
        csvRow: located.csvRow,
        jdLink: located.jdLink,
        folderName: located.jobDir
      };
      await persistJobGeneratedDocs(docs).catch(() => {});
    }
  }

  if (!docsHaveFile(docs, "resume") && lastMatches && docsHaveFile(last, "resume")) {
    docs = { ...(docs || {}), resume: last.resume, folderName: located.jobDir };
  }
  if (!docsHaveFile(docs, "coverLetter") && lastMatches && docsHaveFile(last, "coverLetter")) {
    docs = { ...(docs || {}), coverLetter: last.coverLetter, folderName: located.jobDir };
  }

  if (!located.jobDir && !docsHaveFile(docs, "resume") && !docsHaveFile(docs, "coverLetter")) {
    return last;
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
    const infos = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => true
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

async function waitForApplyAdvance(tabId, prevSig, prevUrl, timeoutMs = 15000) {
  const start = Date.now();
  const knownTabIds = new Set((await chrome.tabs.query({})).map((t) => t.id));

  while (Date.now() - start < timeoutMs) {
    await sleep(400);

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
      return { advanced: true, tabId, reason: "url_change" };
    }

    try {
      await ensureAutofillScript(tabId);
      const all = await getApplyActionFromTab(tabId);
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
  const docs = await resolveUploadDocs({
    csvRow: applyHint.csvRow ?? stored.last_apply_csv_row,
    jobDir: applyHint.jobDir || stored.last_apply_job_dir || "",
    jdLink:
      applyHint.jdLink ||
      stored.last_apply_jd_link ||
      stored.last_jd_link ||
      tab?.url ||
      ""
  });
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
    uploadCoverName: docs?.coverLetter?.fileName || ""
  };
}

/**
 * Multi-step apply: fill → click Next/Continue → wait → refill.
 * Stops before Submit so the user can review.
 */
export async function startMultiStepApplyOnTab(tabId = null, { maxSteps = 12 } = {}) {
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
    tabUrl: tab.url || ""
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
      summary.detail = probe.jobUnavailable;
      summary.tabId = currentTabId;
      return summary;
    }

    if (!probe.anyForm && (!probe.best || probe.best.action.type === "entry")) {
      const live = await chrome.tabs.get(currentTabId).catch(() => null);
      const prevUrl = live?.url || "";
      const prevSig = probe.signature || "";

      if (probe.best?.action?.type === "entry") {
        await sendMessageToTab(
          currentTabId,
          { type: "click_apply_action", preferredType: "entry" },
          { attempts: 2, frameId: probe.best.frameId }
        ).catch(() => null);
      } else {
        const entry = await sendMessageToTab(
          currentTabId,
          { type: "click_easy_apply_entry" },
          { attempts: 2 }
        ).catch(() => null);
        if (!entry?.clicked && probe.applyUrls?.length) {
          const nextUrl = String(probe.applyUrls[0] || "").trim();
          if (nextUrl) {
            await chrome.tabs.update(currentTabId, { url: nextUrl });
            await waitForTabComplete(currentTabId, 30000).catch(() => {});
          }
        } else if (!entry?.clicked && probe.blockedReason) {
          summary.status = "needs_review";
          summary.detail = probe.blockedReason;
          summary.tabId = currentTabId;
          return summary;
        }
      }

      const advanced = await waitForApplyAdvance(currentTabId, prevSig, prevUrl, 12000);
      currentTabId = advanced.tabId;
      probe = await getApplyActionFromTab(currentTabId).catch(() => probe);

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
    const fillRes = await startAutofillOnTab(currentTabId);
    summary.filled += Number(fillRes?.filledCount || 0);
    summary.filledCount = summary.filled;
    summary.uploaded += Number(fillRes?.uploadedCount || 0);
    summary.uploadedCount = summary.uploaded;
    summary.bankHits += Number(fillRes?.bankHits || 0);
    summary.extraFilled += Number(fillRes?.extraFilled || 0);
    summary.aiHits += Number(fillRes?.aiHits || 0);
    summary.steps = step + 1;
    summary.tabId = currentTabId;
    summary.tabUrl = (await chrome.tabs.get(currentTabId).catch(() => null))?.url || summary.tabUrl;

    probe = await getApplyActionFromTab(currentTabId).catch(() => ({ best: null, anyForm: false }));

    if (!probe.best) {
      summary.status = probe.anyForm ? "ready_for_review" : "needs_review";
      summary.detail = probe.anyForm
        ? "Filled the form. No Next/Submit button detected — please review and submit."
        : "No application form or action button found on this page.";
      return summary;
    }

    if (probe.best.action.type === "submit") {
      summary.status = "ready_for_review";
      summary.detail = `Reached Submit (${probe.best.action.text || "Submit"}). Stopped so you can review.`;
      return summary;
    }

    const live = await chrome.tabs.get(currentTabId).catch(() => null);
    const prevUrl = live?.url || "";
    const prevSig = probe.signature || "";
    const actionType = probe.best.action.type;

    await setApplyStatus(`Apply: clicking ${probe.best.action.text || actionType}...`);
    const clickRes = await sendMessageToTab(
      currentTabId,
      { type: "click_apply_action", preferredType: actionType },
      { attempts: 2, frameId: probe.best.frameId }
    ).catch((err) => ({ ok: false, error: String(err?.message || err) }));

    if (clickRes?.isSubmit) {
      summary.status = "ready_for_review";
      summary.detail = "Reached the final Submit step. Stopped so you can review and submit.";
      return summary;
    }

    const advanced = await waitForApplyAdvance(currentTabId, prevSig, prevUrl, 15000);
    currentTabId = advanced.tabId;
    summary.tabId = currentTabId;

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

export async function openJobAndApply(url, { multiStep = true, csvRow, jobDir, jdLink } = {}) {
  const href = String(url || "").trim();
  if (!href) throw new Error("Missing job URL.");
  await setActiveApplyJob({
    csvRow,
    jobDir,
    jdLink: jdLink || href
  });
  const tab = await chrome.tabs.create({ url: href, active: true });
  try {
    await waitForTabComplete(tab.id, 35000);
  } catch {
    /* fill anyway */
  }
  await sleep(APPLY_SETTLE_MS);
  if (multiStep) return startMultiStepApplyOnTab(tab.id);
  return startAutofillOnTab(tab.id);
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
