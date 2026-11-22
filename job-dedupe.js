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
 * Requisition ids named by the link or the JD ("…/Salesforce-Business-Analyst_R2618936",
 * "Req ID: 398253", "job requisition id JR11186"). Upper-case, no dashes.
 * Ids that are only digits need 5+ digits so years / zip codes never count.
 */
export function extractRequisitionIds({ jdLink = "", jdText = "" } = {}) {
  const out = new Set();
  const add = (raw) => {
    const id = String(raw || "").toUpperCase().replace(/[-\s]/g, "");
    if (!id) return;
    if (/^\d+$/.test(id) ? id.length < 5 : !/^[A-Z]{1,4}\d{4,}$/.test(id)) return;
    out.add(id);
  };
  let path = "";
  try {
    path = decodeURIComponent(new URL(String(jdLink || "").trim()).pathname);
  } catch {
    path = "";
  }
  // Workday-style slug suffix: …/Job-Title_R2618936 (optionally -1 for reposts).
  const wd = path.match(/_([A-Z]{1,4}-?\d{4,})(?:-\d+)?\/?$/i);
  if (wd) add(wd[1]);
  const text = String(jdText || "");
  const re = /\b(?:job\s+)?req(?:uisition)?(?:\s*(?:id|#|no\.?|number))?\s*[:#]?\s*([A-Z]{0,4}-?\d{4,})\b/gi;
  let m;
  while ((m = re.exec(text))) add(m[1]);
  return [...out];
}

function companyNamedInText(company, text) {
  const c = normalizeCompanyName(company);
  if (!c || c.length < 4) return false;
  const hay = ` ${String(text || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")} `;
  return hay.includes(` ${c} `);
}

/**
 * Same employer, allowing an old / parent name: equal normalized names, or one row's company
 * named in the other row's JD ("Allscripts" listing whose JD says "Veradigm").
 */
export function isSameEmployer(a = {}, b = {}) {
  const ca = normalizeCompanyName(a.company ?? a.companyName);
  const cb = normalizeCompanyName(b.company ?? b.companyName);
  if (ca && cb && ca === cb) return true;
  return (
    companyNamedInText(a.company ?? a.companyName, b.jdText) ||
    companyNamedInText(b.company ?? b.companyName, a.jdText)
  );
}

/**
 * Row (other than excludeCsvRow) that already covers `job`, for the pre-generate check:
 * - same requisition id at the same employer, or
 * - same employer (incl. old/parent name) + matching title,
 * where the other row is Applied, or (when includeBuilt) already built (status done).
 * @returns {{ row: object, reason: string } | null}
 */
export function findCoveringJob(job, queue, { excludeCsvRow, belongs, includeBuilt = false } = {}) {
  const ids = extractRequisitionIds(job);
  for (const j of Array.isArray(queue) ? queue : []) {
    if (!j) continue;
    if (excludeCsvRow != null && Number(j.csvRow) === Number(excludeCsvRow)) continue;
    const built = includeBuilt && String(j.status || "") === "done";
    if (!j.applied && !built) continue;
    if (belongs && !belongs(j)) continue;
    const state = j.applied ? "applied" : "built";
    if (ids.length && isSameEmployer(job, j)) {
      const other = extractRequisitionIds(j);
      const hit = ids.find((id) => other.includes(id));
      if (hit) return { row: j, reason: `same requisition ${hit} as ${state} row ${j.csvRow}` };
    }
    if (titlesMatch(job.title ?? job.jobTitle, j.title ?? j.jobTitle) && isSameEmployer(job, j)) {
      return { row: j, reason: `same employer and title as ${state} row ${j.csvRow}` };
    }
  }
  return null;
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
