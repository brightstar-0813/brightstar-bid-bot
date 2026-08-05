export function extractSpreadsheetId(urlOrId) {
  const raw = String(urlOrId || "").trim();
  if (!raw) return "";

  const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) return fromUrl[1];

  if (/^[a-zA-Z0-9-_]+$/.test(raw)) return raw;
  return "";
}

export function formatApplicationDate(date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Tab-separated row matching sheet columns A–E:
 * No | Date | Title | Company | Link
 * Paste into the first cell of an empty row in Google Sheets.
 */
export function buildSheetRowTsv({
  jobNo = "",
  jobTitle,
  companyName,
  jdLink,
  includeDate = true
}) {
  const cells = [
    jobNo !== "" && jobNo != null ? String(jobNo) : "",
    includeDate ? formatApplicationDate() : "",
    jobTitle || "",
    companyName || "",
    jdLink || ""
  ];
  return cells.join("\t");
}

/**
 * Appends one row via the deployed Apps Script web app.
 * Uses text/plain body to avoid CORS preflight issues with Google Apps Script.
 */
export async function appendJobToSpreadsheet({
  spreadsheetUrl,
  webAppUrl,
  jobNo,
  jobTitle,
  companyName,
  jdLink
}) {
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
  if (!spreadsheetId) {
    throw new Error("Invalid Google Spreadsheet link.");
  }

  const endpoint = String(webAppUrl || "").trim();
  if (!endpoint || !/^https:\/\/script\.google\.com\//i.test(endpoint)) {
    throw new Error(
      "Paste the Apps Script Web App URL (Deploy → Web app). Spreadsheet share link alone cannot be written to from Chrome."
    );
  }

  const payload = {
    spreadsheetId,
    jobNo: jobNo !== "" && jobNo != null ? String(jobNo) : "",
    applicationDate: formatApplicationDate(),
    jobTitle: jobTitle || "",
    companyName: companyName || "",
    jobLink: jdLink || ""
  };

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
    throw new Error(parsed?.error || `Sheet append failed (HTTP ${response.status}).`);
  }
  if (parsed && parsed.ok === false) {
    throw new Error(parsed.error || "Sheet append failed.");
  }

  return { spreadsheetId, ...payload };
}
