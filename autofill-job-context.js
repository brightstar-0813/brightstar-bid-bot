/**
 * Job context (title / company / JD) for autofill AI answers.
 *
 * The stored `last_*` keys are written when a job is opened through some paths but not all
 * (batch Generate + Apply only records `last_apply_csv_row` / `active_apply_job`). When they
 * still describe the previous job, AI answers — including a pasted cover letter — get written
 * for the wrong employer. The active queue row wins whenever its link differs from `last_jd_link`.
 */

function normLink(link) {
  return String(link || "")
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

function findActiveRow(data = {}) {
  const queue = Array.isArray(data.job_queue) ? data.job_queue : [];
  const active = data.active_apply_job && typeof data.active_apply_job === "object" ? data.active_apply_job : {};
  const rowRaw = active.csvRow != null && String(active.csvRow).trim() !== "" ? active.csvRow : data.last_apply_csv_row;
  const csvRow = rowRaw != null && String(rowRaw).trim() !== "" ? Number(rowRaw) : NaN;
  if (Number.isFinite(csvRow)) {
    const byRow = queue.find((j) => Number(j.csvRow) === csvRow);
    if (byRow) return byRow;
  }
  const link = normLink(active.jdLink || data.last_apply_jd_link);
  if (!link) return null;
  return queue.find((j) => normLink(j.jdLink || j.url) === link) || null;
}

/**
 * @param {object} data chrome.storage.local values: last_job_title, last_company_name, last_job_company,
 *   last_jd_text, last_jd_link, last_apply_jd_link, last_apply_csv_row, job_queue, active_apply_job
 * @returns {{ jobTitle: string, companyName: string, jdText: string, jdLink: string }}
 */
export function pickAutofillJobMeta(data = {}) {
  let jobTitle = String(data.last_job_title || "").trim();
  let companyName = String(data.last_company_name || data.last_job_company || "").trim();
  let jdText = String(data.last_jd_text || "").trim();
  let jdLink = String(data.last_jd_link || data.last_apply_jd_link || "").trim();

  const row = findActiveRow(data);
  if (row) {
    const rowLink = String(row.jdLink || row.url || "").trim();
    const stale = Boolean(rowLink) && normLink(rowLink) !== normLink(data.last_jd_link);
    const pick = (stored, fromRow) => (stale ? fromRow || "" : stored || fromRow || "");
    jobTitle = pick(jobTitle, String(row.jobTitle || row.title || "").trim());
    companyName = pick(companyName, String(row.companyName || row.company || "").trim());
    jdText = pick(jdText, String(row.jdText || "").trim());
    jdLink = pick(jdLink, rowLink);
  }
  return { jobTitle, companyName, jdText, jdLink };
}
