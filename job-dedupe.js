/**
 * Same job reached through different listing sites (Himalayas, Jobgether, SkipTheDrive, direct ATS)
 * has different jdLinks, so link dedupe misses it. FormativGroup 2026-11-16: one Greenhouse job came in
 * as rows 75 (applied), 132, 137 and 145; the bot started a second application from row 132.
 *
 * Pure helpers — no chrome.* — so tests can import them.
 */

const COMPANY_SUFFIX_RE =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|group|plc|gmbh|lp|llp)\b\.?/g;

export function normalizeCompanyName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(COMPANY_SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeJobTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\((remote|contract|ongoing|full[- ]time|part[- ]time|hybrid|us|usa)[^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when two titles name the same role: equal after normalizing, or the shorter (>= 4 words)
 * is the leading part of the longer ("senior salesforce certified developer" vs
 * "senior salesforce certified developer government cloud").
 */
export function titlesMatch(a, b) {
  const x = normalizeJobTitle(a);
  const y = normalizeJobTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.split(" ").length < 4) return false;
  return long.startsWith(`${short} `);
}

/** Same employer + matching title → treat as the same job. */
export function isSameJobByCompanyTitle(a = {}, b = {}) {
  const ca = normalizeCompanyName(a.company ?? a.companyName);
  const cb = normalizeCompanyName(b.company ?? b.companyName);
  if (!ca || !cb || ca !== cb) return false;
  return titlesMatch(a.title ?? a.jobTitle, b.title ?? b.jobTitle);
}

/**
 * First already-applied row (other than excludeCsvRow) that is the same job as `job`.
 * @param {{company?:string,companyName?:string,title?:string,jobTitle?:string}} job
 * @param {Array<object>} queue
 * @param {{ excludeCsvRow?: number|string, belongs?: (j:object)=>boolean }} [opts]
 */
export function findAppliedSameJob(job, queue, { excludeCsvRow, belongs } = {}) {
  for (const j of Array.isArray(queue) ? queue : []) {
    if (!j || !j.applied) continue;
    if (excludeCsvRow != null && Number(j.csvRow) === Number(excludeCsvRow)) continue;
    if (belongs && !belongs(j)) continue;
    if (isSameJobByCompanyTitle(job, j)) return j;
  }
  return null;
}
