/**
 * CSV auto-source helpers: job identity, fingerprinting, merge on refresh.
 */

export const CSV_SOURCE_KEY = "csv_source_settings";
export const CSV_SOURCE_ALARM = "csv-source-poll";
export const NATIVE_HOST_NAME = "com.brightstar.bidbot.csvwatch";

export const DEFAULT_CSV_SOURCE = {
  pollMinutes: 30,
  url: "",
  urlEnabled: false,
  pinEnabled: false,
  pinFileName: "",
  nativeEnabled: false,
  lastFingerprint: "",
  lastIngestAt: 0,
  lastSource: "",
  lastStatus: ""
};

/** Normalize a job URL for duplicate detection. */
export function normalizeJobKeyLink(link) {
  const raw = String(link || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    // Drop common tracking params
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((k) =>
      u.searchParams.delete(k)
    );
    let href = u.href.replace(/\/+$/, "").toLowerCase();
    return href;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
}

/** Stable identity for a job across CSV refreshes. Prefer link; else title+company. */
export function jobIdentity(job) {
  const link = normalizeJobKeyLink(job?.jdLink || job?.url || "");
  if (link) return `url:${link}`;
  const title = String(job?.title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const company = String(job?.company || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `tc:${company}||${title}`;
}

/** Fast fingerprint so we skip unchanged CSV bodies. */
export async function fingerprintText(text) {
  const data = new TextEncoder().encode(String(text || ""));
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback (rare)
  let h = 2166136261;
  for (let i = 0; i < data.length; i += 1) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return `fnv_${(h >>> 0).toString(16)}_${data.length}`;
}

/**
 * Merge a freshly parsed US job list into prior state.
 * Keeps statuses for jobs already seen (by identity); new jobs start pending.
 *
 * @returns {{
 *   allUsJobs: object[],
 *   added: number,
 *   updated: number,
 *   unchanged: number,
 *   newIdentities: string[]
 * }}
 */
export function mergeParsedJobs(previousAllUs, previousQueue, usJobs) {
  const prevJobs = Array.isArray(previousAllUs) ? previousAllUs : [];
  const prevQueue = Array.isArray(previousQueue) ? previousQueue : [];

  const statusById = new Map();
  for (const j of [...prevQueue, ...prevJobs]) {
    const id = jobIdentity(j);
    if (!id) continue;
    const prev = statusById.get(id);
    // Prefer richer status records (done/running over bare pending)
    if (!prev || rankStatus(j.status) >= rankStatus(prev.status)) {
      statusById.set(id, {
        status: j.status || "pending",
        attempts: j.attempts || 0,
        jobDir: j.jobDir,
        error: j.error || ""
      });
    }
  }

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  const newIdentities = [];

  const allUsJobs = (usJobs || []).map((j) => {
    const id = jobIdentity(j);
    const prev = statusById.get(id);
    if (!prev) {
      added += 1;
      newIdentities.push(id);
      return { ...j, status: "pending", attempts: 0, error: "" };
    }
    const status = prev.status || "pending";
    if (status === "pending" || status === "error" || status === "failed") updated += 1;
    else unchanged += 1;
    return {
      ...j,
      status,
      attempts: prev.attempts || 0,
      jobDir: prev.jobDir,
      error: prev.error || ""
    };
  });

  return { allUsJobs, added, updated, unchanged, newIdentities };
}

function rankStatus(status) {
  const s = String(status || "pending");
  if (s === "done") return 5;
  if (s === "running") return 4;
  if (s === "failed" || s === "error") return 3;
  if (s === "skipped") return 2;
  if (s === "paused") return 1;
  return 0;
}

export async function getCsvSourceSettings() {
  const data = await chrome.storage.local.get(CSV_SOURCE_KEY);
  return { ...DEFAULT_CSV_SOURCE, ...(data[CSV_SOURCE_KEY] || {}) };
}

export async function saveCsvSourceSettings(patch) {
  const prev = await getCsvSourceSettings();
  const next = { ...prev, ...patch };
  await chrome.storage.local.set({ [CSV_SOURCE_KEY]: next });
  return next;
}

export function clampPollMinutes(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_CSV_SOURCE.pollMinutes;
  return Math.max(5, Math.min(720, Math.round(v)));
}
