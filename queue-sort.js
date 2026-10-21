function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Display / sheet No used for latest ordering when sheetRow is missing. */
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

/**
 * Latest-first: newer spreadsheet rows first; else higher sheet/display No;
 * else higher csvRow.
 */
export function compareLatestOrder(a, b) {
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
 * batch, then skipped/error. Latest jobs first within each status group.
 * Running stays at the very top so live batch work stays visible.
 */
export function sortQueueForDisplay(jobs) {
  return [...(Array.isArray(jobs) ? jobs : [])].sort((a, b) => {
    const ga = queueStatusSortKey(a);
    const gb = queueStatusSortKey(b);
    if (ga !== gb) return ga - gb;
    return compareLatestOrder(a, b);
  });
}
