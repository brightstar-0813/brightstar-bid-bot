import { parseIndeedPostedAt } from "./indeed.js";

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Display / sheet No used when post date is missing. */
function displayNo(job) {
  return positiveNumber(job?.sheetJobNo ?? job?.jobNo ?? job?.csvRow) || 0;
}

function hasDisplayOrder(job) {
  return positiveNumber(job?.displayOrder) != null;
}

/**
 * Display priority (lower first) — used only for the initial arrange:
 * done (not applied) → done+applied → pending/running → skipped/error
 */
export function queueStatusSortKey(job) {
  const s = String(job?.status || "pending").toLowerCase();
  if (s === "done" && !job?.applied) return 0;
  if (s === "done" && job?.applied) return 1;
  if (s === "error" || s === "failed" || s === "skipped") return 3;
  return 2; // pending, running, unknown
}

/** Epoch ms when the job was posted on the board (not when we generated files). */
export function jobPostedAt(job, now = Date.now()) {
  return (
    parseIndeedPostedAt(job?.postedAt, now) ||
    parseIndeedPostedAt(job?.datePosted, now) ||
    parseIndeedPostedAt(job?.postedText, now) ||
    parseIndeedPostedAt(job?.date_posted, now) ||
    null
  );
}

function jobFirstSeenAt(job, now = Date.now()) {
  return (
    parseIndeedPostedAt(job?.firstSeenAt, now) ||
    parseIndeedPostedAt(job?.first_seen_at, now) ||
    null
  );
}

/**
 * Latest-first by board post date, then first-seen, then sheet/CSV order.
 * Sheet row / job No are generation/append order — only used when post date is unknown.
 */
export function compareLatestOrder(a, b, now = Date.now()) {
  const pa = jobPostedAt(a, now);
  const pb = jobPostedAt(b, now);
  if (pa != null && pb != null && pa !== pb) return pb - pa;

  const fa = jobFirstSeenAt(a, now);
  const fb = jobFirstSeenAt(b, now);
  if (fa != null && fb != null && fa !== fb) return fb - fa;

  const sa = positiveNumber(a?.sheetRow);
  const sb = positiveNumber(b?.sheetRow);
  if (sa != null && sb != null && sa !== sb) return sb - sa;
  const na = displayNo(a);
  const nb = displayNo(b);
  if (na !== nb) return nb - na;
  return Number(b?.csvRow || 0) - Number(a?.csvRow || 0);
}

/** One-time rule sort (status tiers + newest posted). Does not stamp displayOrder. */
export function sortQueueByRules(jobs, now = Date.now()) {
  return [...(Array.isArray(jobs) ? jobs : [])].sort((a, b) => {
    const ga = queueStatusSortKey(a);
    const gb = queueStatusSortKey(b);
    if (ga !== gb) return ga - gb;
    return compareLatestOrder(a, b, now);
  });
}

/**
 * Stamp a frozen displayOrder once. Existing orders never change when badges/status
 * update. New jobs (no displayOrder yet) are rule-sorted and appended after the max.
 *
 * @returns {{ jobs: object[], changed: boolean }}
 */
export function ensureQueueDisplayOrder(jobs, now = Date.now()) {
  const list = Array.isArray(jobs) ? jobs : [];
  if (!list.length) return { jobs: [], changed: false };

  const missing = list.filter((j) => !hasDisplayOrder(j));
  if (!missing.length) {
    return {
      jobs: [...list].sort((a, b) => Number(a.displayOrder) - Number(b.displayOrder)),
      changed: false
    };
  }

  if (missing.length === list.length) {
    const sorted = sortQueueByRules(list, now).map((j, i) => ({
      ...j,
      displayOrder: i + 1
    }));
    return { jobs: sorted, changed: true };
  }

  const maxOrder = Math.max(0, ...list.filter(hasDisplayOrder).map((j) => Number(j.displayOrder)));
  const newcomers = sortQueueByRules(missing, now).map((j, i) => ({
    ...j,
    displayOrder: maxOrder + 1 + i
  }));
  const byRow = new Map();
  for (const j of list) {
    if (hasDisplayOrder(j)) byRow.set(Number(j.csvRow), { ...j });
  }
  for (const j of newcomers) byRow.set(Number(j.csvRow), j);
  const jobsOut = [...byRow.values()].sort(
    (a, b) => Number(a.displayOrder) - Number(b.displayOrder)
  );
  return { jobs: jobsOut, changed: true };
}

/**
 * Stable queue order: freeze after first arrange so badge changes do not reshuffle.
 */
export function sortQueueForDisplay(jobs, now = Date.now()) {
  return ensureQueueDisplayOrder(jobs, now).jobs;
}
