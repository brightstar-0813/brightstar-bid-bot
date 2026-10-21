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
 * running → done+applied → done → pending → error/failed → skipped
 */
export function queueStatusSortKey(job) {
  const s = String(job?.status || "pending").toLowerCase();
  if (s === "running") return 0;
  if (s === "done" && job?.applied) return 1;
  if (s === "done") return 2;
  if (s === "error" || s === "failed") return 4;
  if (s === "skipped") return 5;
  return 3; // pending and unknown
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
 * Search queue: Done+Applied, then Done (ready to apply), then pending for
 * batch, then skipped/error. Newest posted jobs first within each status group.
 * Running stays at the very top so live batch work stays visible.
 */
export function sortQueueForDisplay(jobs, now = Date.now()) {
  return [...(Array.isArray(jobs) ? jobs : [])].sort((a, b) => {
    const ga = queueStatusSortKey(a);
    const gb = queueStatusSortKey(b);
    if (ga !== gb) return ga - gb;
    return compareLatestOrder(a, b, now);
  });
}
