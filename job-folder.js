/** Shared job save folder naming and matching (row + date based; legacy row-prefix still supported). */

export function formatJobFolderDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getMonth() + 1}-${now.getDate()}`;
  }
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

export function sanitizeFolderToken(value, fallback = "untitled") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 72)
    .trim();
  return cleaned || fallback;
}

export function isLegacyRowPrefixedFolder(name) {
  return /^\d+\s+-/.test(String(name || "").trim());
}

export function isDatePrefixedFolder(name) {
  return /^\d{1,2}-\d{1,2}_/.test(String(name || "").trim());
}

/** e.g. 16_9-21_Socium-Senior Salesforce Developer */
export function isRowDatePrefixedFolder(name) {
  return /^\d+_\d{1,2}-\d{1,2}_/.test(String(name || "").trim());
}

/** Normalized sheet row, or "" when the job has none (one-off / profile apply). */
export function normalizeCsvRow(csvRow) {
  if (csvRow == null) return "";
  const raw = String(csvRow).trim();
  if (!raw) return "";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : "";
}

export function folderSegment(jobDir) {
  const parts = String(jobDir || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/** Sheet row a folder name carries (new or legacy prefix), or "" when it carries none. */
export function csvRowFromFolderName(jobDir) {
  const segment = folderSegment(jobDir);
  const rowDate = segment.match(/^(\d+)_\d{1,2}-\d{1,2}_/);
  if (rowDate) return Number(rowDate[1]);
  const legacy = segment.match(/^(\d+)\s+-/);
  if (legacy) return Number(legacy[1]);
  return "";
}

/**
 * e.g. 16_9-21_Socium-Senior Salesforce Developer
 * The sheet row leads so the job is identifiable at a glance; jobs with no row
 * (manual one-off, profile apply) keep the plain date form.
 */
export function buildJobFolderName(jobMeta = {}) {
  const companyPart = sanitizeFolderToken(jobMeta.companyName || jobMeta.company, "Company");
  const titlePart = sanitizeFolderToken(jobMeta.jobTitle || jobMeta.title, "Job");
  const when = jobMeta.savedAt || jobMeta.createdAt || jobMeta.appliedAt || Date.now();
  const datePart = formatJobFolderDate(when);
  const row = normalizeCsvRow(jobMeta.csvRow != null ? jobMeta.csvRow : jobMeta.jobNo);
  const prefix = row === "" ? datePart : `${row}_${datePart}`;
  return `${prefix}_${companyPart}-${titlePart}`.slice(0, 120);
}

export function jobDirMatchesCsvRow(jobDir, csvRow) {
  const wanted = normalizeCsvRow(csvRow);
  if (wanted === "") return true;
  const segment = folderSegment(jobDir);
  if (!segment) return false;
  const found = csvRowFromFolderName(segment);
  // Plain date-based folders (saved before the row prefix) embed no row at all.
  if (found === "") return true;
  return found === wanted;
}

export function folderFitsJob(jobDir, job = {}) {
  const name = folderSegment(jobDir).toLowerCase();
  if (!name) return false;
  const company = sanitizeFolderToken(job.company || job.companyName || "", "").toLowerCase();
  const title = sanitizeFolderToken(job.title || job.jobTitle || "", "").toLowerCase();
  if (company) {
    const token = company.slice(0, 28);
    if (token && !name.includes(token)) return false;
  }
  if (title) {
    const token = title.slice(0, 36);
    if (token && !name.includes(token)) return false;
  }
  return Boolean(
    company ||
      title ||
      isLegacyRowPrefixedFolder(name) ||
      isRowDatePrefixedFolder(name) ||
      isDatePrefixedFolder(name)
  );
}
