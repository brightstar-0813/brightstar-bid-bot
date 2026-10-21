import { parseIndeedPostedAt } from "./indeed.js";

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Display / sheet No used when post date is missing. */
function displayNo(job) {
  return positiveNumber(job?.sheetJobNo ?? job?.jobNo ?? job?.csvRow) || 0;
}

/**
 * Display priority (lower first):
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

/**
 * Search queue:
 * 1. Done (not applied) — ready to apply
 * 2. Done + Applied
 * 3. Pending (and running)
 * 4. Skipped / error
 * Newest posted jobs first within each group.
 */
export function sortQueueForDisplay(jobs, now = Date.now()) {
  return [...(Array.isArray(jobs) ? jobs : [])].sort((a, b) => {
    const ga = queueStatusSortKey(a);
    const gb = queueStatusSortKey(b);
    if (ga !== gb) return ga - gb;
    return compareLatestOrder(a, b, now);
  });
}
