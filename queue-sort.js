function statusGroup(job) {
  const s = String(job?.status || "pending").toLowerCase();
  if (s === "done") return [0];
  if (s === "running") return [1, 0];
  if (s === "pending") return [1, 1];
  if (s === "error" || s === "failed") return [2];
  if (s === "skipped") return [3];
  return [1, 2];
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Latest-first tie-break: sheetRow desc when both have it, else csvRow desc. */
export function compareLatestOrder(a, b) {
  const sa = positiveNumber(a?.sheetRow);
  const sb = positiveNumber(b?.sheetRow);
  if (sa != null && sb != null && sa !== sb) return sb - sa;
  const ca = Number(a?.csvRow || 0);
  const cb = Number(b?.csvRow || 0);
  return cb - ca;
}

/** Display order for batch stream: done → pending (running first) → error → skipped, then latest-first. */
export function queueStatusSortKey(job) {
  const latest = positiveNumber(job?.sheetRow);
  const csvRow = Number(job?.csvRow || 0);
  // Key used only when sheetRow is missing on peers; compareLatestOrder handles mixed pairs.
  const latestKey = latest != null ? -latest : -(Number.isFinite(csvRow) ? csvRow : 0);
  return [...statusGroup(job), latestKey];
}

export function sortQueueForDisplay(jobs) {
  return [...(Array.isArray(jobs) ? jobs : [])].sort((a, b) => {
    const ga = statusGroup(a);
    const gb = statusGroup(b);
    for (let i = 0; i < Math.max(ga.length, gb.length); i++) {
      const diff = (ga[i] ?? 0) - (gb[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return compareLatestOrder(a, b);
  });
}
