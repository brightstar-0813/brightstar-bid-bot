export function extractSpreadsheetId(urlOrId) {
  const raw = String(urlOrId || "").trim();
  if (!raw) return "";

  const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) return fromUrl[1];

  if (/^[a-zA-Z0-9-_]+$/.test(raw)) return raw;
  return "";
}

/**
 * Google Sheets tab names cannot include \ / ? * [ ] and max out at 100 chars.
 */
export function sanitizeSheetTabName(name) {
  let s = String(name || "")
    .trim()
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > 100) s = s.slice(0, 100).trim();
  return s;
}

/** Default tab label for a person when no custom sheetTabName is saved. */
export function defaultSheetTabNameForPerson(person = {}) {
  return (
    sanitizeSheetTabName(person?.sheetTabName || person?.label || person?.name || person?.id || "") ||
    "Profile"
  );
}

export function formatApplicationDate(date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

/** Local apply timestamp for Status, e.g. 8/16/2026 2:32 AM */
export function formatApplicationDateTime(date = new Date()) {
  const hours24 = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${formatApplicationDate(date)} ${hours12}:${minutes} ${ampm}`;
}

/** Status cell after Apply: Applied plus local date and time. */
export function formatAppliedStatus(date = new Date()) {
  return `Applied ${formatApplicationDateTime(date)}`;
}

/**
 * Normalize employer names so "Google LLC" and "Google, Inc." match.
 */
export function normalizeCompanyName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(incorporated|inc|llc|corp|corporation|company|co|ltd|limited|plc|gmbh|ag|pvt|private)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize job URLs so sheet vs CSV links still match when tracking
 * params / trailing slashes differ.
 */
export function normalizeJobLink(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (
        k.startsWith("utm_") ||
        k === "fbclid" ||
        k === "gclid" ||
        k === "ref" ||
        k === "source"
      ) {
        u.searchParams.delete(key);
      }
    }
    u.hostname = u.hostname.toLowerCase();
    let path = u.pathname.replace(/\/+$/, "");
    if (!path) path = "/";
    const search = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${path}${search ? `?${search}` : ""}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * Tab-separated row matching sheet columns A–H:
 * No | Date | Title | Company | Link | Salary | JD | Status
 * Paste into the first cell of an empty row in Google Sheets.
 */
export function truncateSheetJd(text, max = 45000) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function buildSheetRowTsv({
  jobNo = "",
  jobTitle,
  companyName,
  jdLink,
  salary = "",
  status = "",
  jdText = "",
  includeDate = true
}) {
  const cells = [
    jobNo !== "" && jobNo != null ? String(jobNo) : "",
    includeDate ? formatApplicationDate() : "",
    jobTitle || "",
    companyName || "",
    jdLink || "",
    salary || "",
    truncateSheetJd(jdText),
    status || ""
  ];
  return cells.join("\t");
}

async function postSheetWebApp(webAppUrl, payload) {
  const endpoint = String(webAppUrl || "").trim();
  if (!endpoint || !/^https:\/\/script\.google\.com\//i.test(endpoint)) {
    throw new Error(
      "Paste the Apps Script Web App URL (Deploy → Web app). Spreadsheet share link alone cannot be written to from Chrome."
    );
  }

  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "follow",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    throw new Error(parsed?.error || `Sheet request failed (HTTP ${response.status}).`);
  }
  if (parsed && parsed.ok === false) {
    throw new Error(parsed.error || "Sheet request failed.");
  }

  return parsed || { ok: true };
}

/**
 * Appends one row via the deployed Apps Script web app.
 * Uses text/plain body to avoid CORS preflight issues with Google Apps Script.
 * Returns { duplicate: true } if the job link is already on the sheet.
 */
export async function appendJobToSpreadsheet({
  spreadsheetUrl,
  webAppUrl,
  sheetName = "",
  jobNo,
  jobTitle,
  companyName,
  jdLink,
  salary,
  jdText = "",
  status = "Ready"
}) {
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
  if (!spreadsheetId) {
    throw new Error("Invalid Google Spreadsheet link.");
  }

  const payload = {
    action: "append",
    spreadsheetId,
    sheetName: sanitizeSheetTabName(sheetName),
    jobNo: jobNo !== "" && jobNo != null ? String(jobNo) : "",
    applicationDate: formatApplicationDate(),
    jobTitle: jobTitle || "",
    companyName: companyName || "",
    jobLink: jdLink || "",
    salary: salary || "",
    jdText: truncateSheetJd(jdText),
    status: status || "Ready"
  };

  const parsed = await postSheetWebApp(webAppUrl, payload);
  return { spreadsheetId, duplicate: Boolean(parsed?.duplicate), ...payload };
}

/**
 * Set Status to "Applied M/D/YYYY h:mm AM/PM" on the existing row (matched by job link).
 * Column B stays the resume-build date. If the job is not on the sheet yet, appends a row.
 */
export async function markJobAppliedOnSpreadsheet({
  spreadsheetUrl,
  webAppUrl,
  sheetName = "",
  jobNo,
  jobTitle,
  companyName,
  jdLink,
  salary,
  jdText = "",
  status
}) {
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
  if (!spreadsheetId) {
    throw new Error("Invalid Google Spreadsheet link.");
  }

  const appliedDate = formatApplicationDateTime();
  const statusValue = String(status || "").trim() || formatAppliedStatus();
  const payload = {
    action: "markApplied",
    spreadsheetId,
    sheetName: sanitizeSheetTabName(sheetName),
    jobNo: jobNo !== "" && jobNo != null ? String(jobNo) : "",
    applicationDate: formatApplicationDate(),
    jobTitle: jobTitle || "",
    companyName: companyName || "",
    jobLink: jdLink || "",
    salary: salary || "",
    jdText: truncateSheetJd(jdText),
    status: statusValue
  };

  const parsed = await postSheetWebApp(webAppUrl, payload);
  return {
    spreadsheetId,
    updated: Boolean(parsed?.updated),
    appended: Boolean(parsed?.appended),
    appliedDate,
    ...payload
  };
}

/**
 * Fetch job links + companies already on the sheet (for link and company dedupe).
 * @returns {Promise<{ links: string[], companies: string[] }>}
 */
export async function fetchExistingSheetDedupKeys({ spreadsheetUrl, webAppUrl, sheetName = "" }) {
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
  if (!spreadsheetId) {
    throw new Error("Invalid Google Spreadsheet link.");
  }

  const parsed = await postSheetWebApp(webAppUrl, {
    action: "listLinks",
    spreadsheetId,
    sheetName: sanitizeSheetTabName(sheetName)
  });

  const links = Array.isArray(parsed?.links) ? parsed.links : [];
  const companies = Array.isArray(parsed?.companies) ? parsed.companies : [];
  const companyRows = Array.isArray(parsed?.companyRows) ? parsed.companyRows : [];
  const linkStatuses = Array.isArray(parsed?.linkStatuses) ? parsed.linkStatuses : [];
  const appliedLinks = Array.isArray(parsed?.appliedLinks)
    ? parsed.appliedLinks
    : linkStatuses
        .filter((row) => /^\s*applied\b/i.test(String(row?.status || "")))
        .map((row) => row?.link)
        .filter(Boolean);
  return {
    links: links.map((l) => String(l || "").trim()).filter(Boolean),
    companies: companies.map((c) => String(c || "").trim()).filter(Boolean),
    companyRows: companyRows
      .map((row) => ({
        company: String(row?.company || "").trim(),
        link: String(row?.link || "").trim()
      }))
      .filter((row) => row.company),
    linkStatuses: linkStatuses
      .map((row) => ({
        link: String(row?.link || "").trim(),
        status: String(row?.status || "").trim()
      }))
      .filter((row) => row.link),
    appliedLinks: appliedLinks.map((l) => String(l || "").trim()).filter(Boolean),
    sheetName: String(parsed?.sheetName || sheetName || "").trim()
  };
}

/**
 * Fetch all job links already recorded on the sheet (column Link / E).
 * @returns {Promise<string[]>}
 */
export async function fetchExistingJobLinks({ spreadsheetUrl, webAppUrl, sheetName = "" }) {
  const { links } = await fetchExistingSheetDedupKeys({ spreadsheetUrl, webAppUrl, sheetName });
  return links;
}

/**
 * @param {string[]} links
 * @returns {Set<string>}
 */
export function buildKnownLinkSet(links) {
  const set = new Set();
  for (const link of links || []) {
    const n = normalizeJobLink(link);
    if (n) set.add(n);
  }
  return set;
}

/**
 * @param {string[]} companies
 * @returns {Set<string>}
 */
export function buildKnownCompanySet(companies) {
  const set = new Set();
  for (const name of companies || []) {
    const n = normalizeCompanyName(name);
    if (n) set.add(n);
  }
  return set;
}

/**
 * Split jobs into fresh vs already-on-sheet (by normalized JD link).
 * Jobs without a link are treated as fresh (cannot match).
 */
export function partitionJobsBySheetLinks(jobs, knownLinkSet) {
  const list = Array.isArray(jobs) ? jobs : [];
  const known = knownLinkSet instanceof Set ? knownLinkSet : buildKnownLinkSet(knownLinkSet);
  const fresh = [];
  const duplicates = [];
  for (const job of list) {
    const n = normalizeJobLink(job?.jdLink || job?.url || "");
    if (n && known.has(n)) duplicates.push(job);
    else fresh.push(job);
  }
  return { fresh, duplicates };
}
