/** Shared job save folder naming and matching (date-based; legacy row-prefix still supported). */

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

/** e.g. 9-15_Socium-Senior Salesforce Developer */
export function buildJobFolderName(jobMeta = {}) {
  const companyPart = sanitizeFolderToken(jobMeta.companyName || jobMeta.company, "Company");
  const titlePart = sanitizeFolderToken(jobMeta.jobTitle || jobMeta.title, "Job");
  const when = jobMeta.savedAt || jobMeta.createdAt || jobMeta.appliedAt || Date.now();
  const datePart = formatJobFolderDate(when);
  return `${datePart}_${companyPart}-${titlePart}`.slice(0, 120);
}

export function folderSegment(jobDir) {
  const parts = String(jobDir || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

export function jobDirMatchesCsvRow(jobDir, csvRow) {
  if (csvRow == null || String(csvRow).trim() === "" || Number.isNaN(Number(csvRow))) return true;
  const segment = folderSegment(jobDir);
  if (!segment) return false;
  if (isLegacyRowPrefixedFolder(segment)) {
    return new RegExp(`^${Number(csvRow)}\\s+-\\s+`).test(segment);
  }
  // Date-based folders don't embed csvRow in the folder name.
  return true;
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
  return Boolean(company || title || isLegacyRowPrefixedFolder(name) || isDatePrefixedFolder(name));
}
