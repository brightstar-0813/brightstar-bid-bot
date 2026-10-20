function statusGroup(job) {
  const s = String(job?.status || "pending").toLowerCase();
  if (s === "running") return [0];
  if (s === "done") return [1];
  if (s === "pending") return [2];
  if (s === "error" || s === "failed") return [3];
  if (s === "skipped") return [4];
  return [2];
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Display / sheet No used for latest ordering when sheetRow is missing. */
function displayNo(job) {
  return positiveNumber(job?.sheetJobNo ?? job?.jobNo ?? job?.csvRow) || 0;
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

/** @deprecated kept for tests / callers that inspect status keys */
export function queueStatusSortKey(job) {
  return [...statusGroup(job), -displayNo(job)];
}

/**
 * Search queue order: running first, then latest jobs on top (sheet row / No),
 * then remaining status as a light tie-break.
 */
export function sortQueueForDisplay(jobs) {
  return [...(Array.isArray(jobs) ? jobs : [])].sort((a, b) => {
    const aRun = String(a?.status || "") === "running";
    const bRun = String(b?.status || "") === "running";
    if (aRun !== bRun) return aRun ? -1 : 1;
    const latest = compareLatestOrder(a, b);
    if (latest !== 0) return latest;
    const ga = statusGroup(a);
    const gb = statusGroup(b);
    for (let i = 0; i < Math.max(ga.length, gb.length); i++) {
      const diff = (ga[i] ?? 0) - (gb[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}
