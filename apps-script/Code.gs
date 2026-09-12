/**
 * One-time setup for Google Sheets append + duplicate check:
 *
 * 1. Open your spreadsheet (one workbook for all profiles)
 * 2. Extensions → Apps Script
 * 3. Paste this code and Save
 * 4. Deploy → New deployment → Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the Web App URL into the extension's "Web App URL" field
 *    (redeploy after updates so listLinks / markApplied / sheetName / JD column are live)
 *
 * POST body (text/plain JSON):
 *   action: "append" (default) | "listLinks" | "markApplied"
 *   spreadsheetId, optional sheetName (tab per profile; created if missing)
 *   and for append: jobNo, applicationDate, jobTitle, companyName, jobLink, salary, status, jdText
 *
 * Sheet columns: A No | B Date | C Title | D Company | E Link | F Salary | G JD | H Status
 * Resume build → Status "Ready". Apply click → Status "Applied M/D/YYYY h:mm AM/PM" on that row.
 * Dedup: same job link (normalized) is treated as duplicate within that tab.
 */
function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!data.spreadsheetId) {
      throw new Error("spreadsheetId is required.");
    }

    const ss = SpreadsheetApp.openById(String(data.spreadsheetId));
    const sheet = resolveSheet_(ss, data.sheetName);
    const action = String(data.action || "append").toLowerCase();

    if (action === "listlinks" || action === "list_links") {
      const links = collectJobLinks_(sheet);
      const companies = collectCompanies_(sheet);
      const companyRows = collectCompanyLinkPairs_(sheet);
      const linkStatuses = collectLinkStatusPairs_(sheet);
      const appliedLinks = linkStatuses
        .filter(function (row) {
          return statusLooksApplied_(row.status);
        })
        .map(function (row) {
          return row.link;
        });
      return json_({
        ok: true,
        sheetName: sheet.getName(),
        links: links,
        companies: companies,
        companyRows: companyRows,
        linkStatuses: linkStatuses,
        appliedLinks: appliedLinks,
        count: links.length,
        companyCount: companies.length,
        appliedCount: appliedLinks.length
      });
    }

    const jobLink = String(data.jobLink || "").trim();
    const companyName = String(data.companyName || "").trim();

    if (action === "markapplied" || action === "mark_applied" || action === "applied") {
      ensureSheetLayout_(sheet);
      const appliedOn = String(data.applicationDate || "").trim();
      const status =
        String(data.status || "").trim() || (appliedOn ? "Applied " + appliedOn : "Applied");
      const row = findRowByLink_(sheet, jobLink);
      if (row > 0) {
        sheet.getRange(row, statusColumnForRow_(sheet, row)).setValue(status);
        return json_({
          ok: true,
          updated: true,
          appended: false,
          row: row,
          sheetName: sheet.getName()
        });
      }
      sheet.appendRow(buildDataRow_(data, status));
      return json_({
        ok: true,
        updated: false,
        appended: true,
        sheetName: sheet.getName()
      });
    }

    if (jobLink && linkExists_(sheet, jobLink)) {
      return json_({ ok: true, duplicate: true, reason: "link", sheetName: sheet.getName() });
    }

    ensureSheetLayout_(sheet);
    sheet.appendRow(buildDataRow_(data, data.status || "Ready"));

    return json_({ ok: true, duplicate: false, sheetName: sheet.getName() });
  } catch (err) {
    return json_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

function doGet() {
  return ContentService.createTextOutput(
    "Brightstar Bid bot sheet append + duplicate-check endpoint is running."
  );
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** Pick an existing tab by name, or create it with the standard header row. */
function resolveSheet_(ss, sheetName) {
  var name = String(sheetName || "")
    .trim()
    .replace(/[:\\\/\?\*\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length > 100) name = name.slice(0, 100).trim();
  if (!name) {
    var sheets = ss.getSheets();
    return sheets && sheets.length ? sheets[0] : ss.insertSheet("Sheet1");
  }
  var existing = ss.getSheetByName(name);
  if (existing) return existing;
  var created = ss.insertSheet(name);
  created.getRange(1, 1, 1, 8).setValues([
    ["No", "Date", "Title", "Company", "Link", "Salary", "JD", "Status"]
  ]);
  return created;
}

/** One data row matching A–H: No | Date | Title | Company | Link | Salary | JD | Status */
function buildDataRow_(data, status) {
  return [
    data.jobNo || "",
    data.applicationDate || "",
    data.jobTitle || "",
    String(data.companyName || "").trim(),
    String(data.jobLink || "").trim(),
    data.salary || "",
    truncateJd_(data.jdText || data.jd || data.jobDescription || ""),
    status || "Ready"
  ];
}

/** Sheets cells cap at 50k chars; keep headroom for safety. */
function truncateJd_(text) {
  var s = String(text || "").trim();
  var max = 45000;
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function normalizeLink_(url) {
  var raw = String(url || "").trim();
  if (!raw) return "";
  try {
    var u = raw;
    // Strip common tracking query params without needing full URL parser quirks
    u = u.replace(/[?#].*$/, function (m) {
      if (m.charAt(0) === "#") return "";
      var q = m.slice(1);
      var keep = q.split("&").filter(function (part) {
        var key = part.split("=")[0].toLowerCase();
        return (
          key &&
          key.indexOf("utm_") !== 0 &&
          key !== "fbclid" &&
          key !== "gclid" &&
          key !== "ref" &&
          key !== "source"
        );
      });
      return keep.length ? "?" + keep.join("&") : "";
    });
    u = u.replace(/\/+$/, "");
    return u.toLowerCase();
  } catch (err) {
    return raw.toLowerCase();
  }
}

function headerRow_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 8);
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
}

function rowLooksLikeHeader_(row) {
  var joined = (row || [])
    .map(function (h) {
      return String(h || "").trim().toLowerCase();
    })
    .join(" ");
  if (!joined) return false;
  if (/https?:\/\//i.test(joined)) return false;
  return /\b(link|title|company|compay|status|date|salary|jd)\b/.test(joined);
}

function cellLooksLikeUrl_(value) {
  var s = String(value || "").trim();
  return /^https?:\/\//i.test(s) || /hyperlink\s*\(/i.test(s);
}

function linkColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["link", "job link", "job url", "url", "jd link"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 4; // column E
}

function statusColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["status", "applied", "state"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 7; // column H (last)
}

function findNamedColumnIndex_(headerRow, names) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function jdColumnIndex_(headerRow) {
  var idx = findNamedColumnIndex_(headerRow, ["jd", "job description", "description", "job desc"]);
  return idx >= 0 ? idx : 6; // column G
}

function swapColumns_(sheet, colA, colB) {
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var aVals = sheet.getRange(1, colA, lastRow, colA).getValues();
  var bVals = sheet.getRange(1, colB, lastRow, colB).getValues();
  sheet.getRange(1, colA, lastRow, colA).setValues(bVals);
  sheet.getRange(1, colB, lastRow, colB).setValues(aVals);
}

/**
 * Keep Status as the last column. Insert or reorder JD before it on older tabs.
 * Classic 7-col tabs (… Salary | Status) get JD inserted before Status.
 * Mistaken … Status | JD tabs are swapped to … JD | Status.
 */
function ensureSheetLayout_(sheet) {
  var headers = headerRow_(sheet);
  if (!rowLooksLikeHeader_(headers)) return;

  var statusIdx = findNamedColumnIndex_(headers, ["status", "applied", "state"]);
  var jdIdx = findNamedColumnIndex_(headers, ["jd", "job description", "description", "job desc"]);

  if (statusIdx >= 0 && jdIdx >= 0) {
    if (statusIdx < jdIdx) swapColumns_(sheet, statusIdx + 1, jdIdx + 1);
    return;
  }

  if (statusIdx >= 0 && jdIdx < 0) {
    // Insert blank column before Status so Status stays last.
    sheet.insertColumns(statusIdx + 1);
    sheet.getRange(1, statusIdx + 1).setValue("JD");
    return;
  }

  if (statusIdx < 0) {
    if (!String(headers[7] || "").trim()) sheet.getRange(1, 8).setValue("Status");
  }
  if (jdIdx < 0) {
    if (!String(headers[6] || "").trim()) sheet.getRange(1, 7).setValue("JD");
  }
}

function statusColumnForRow_(sheet, row) {
  var headers = headerRow_(sheet);
  if (rowLooksLikeHeader_(headers)) return statusColumnIndex_(headers) + 1;
  var width = Math.max(sheet.getLastColumn(), 8);
  var values = sheet.getRange(row, 1, 1, width).getValues()[0] || [];
  var last = 0;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i] || "").trim()) last = i + 1;
  }
  return Math.max(8, last + 1);
}

function companyColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  // Include common typo "compay" (seen on some bid-tracking sheets).
  var names = ["company", "compay", "company name", "employer", "organization", "org"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 3; // column D
}

function normalizeCompanyName_(name) {
  var s = String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(incorporated|inc|llc|corp|corporation|company|co|ltd|limited|plc|gmbh|ag|pvt|private)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

function collectCompanies_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];
  var hasHeader = rowLooksLikeHeader_(values[0]);
  var start = hasHeader ? 1 : 0;
  var col = hasHeader ? companyColumnIndex_(values[0]) : 3;
  var out = [];
  var seen = {};
  for (var r = start; r < values.length; r++) {
    var raw = String((values[r] || [])[col] || "").trim();
    var n = normalizeCompanyName_(raw);
    if (!n || seen[n]) continue;
    seen[n] = true;
    out.push(raw);
  }
  return out;
}

function statusLooksApplied_(status) {
  return /^\s*applied\b/i.test(String(status || "").trim());
}

/** Link + Status pairs for generate vs apply duplicate gates. */
function collectLinkStatusPairs_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];
  var hasHeader = rowLooksLikeHeader_(values[0]);
  var start = hasHeader ? 1 : 0;
  var linkCol = hasHeader ? linkColumnIndex_(values[0]) : 4;
  var statusCol = hasHeader ? statusColumnIndex_(values[0]) : 6;
  var out = [];
  for (var r = start; r < values.length; r++) {
    var row = values[r] || [];
    var link = String(row[linkCol] || "").trim();
    if (!link) {
      for (var c = 0; c < row.length; c++) {
        var cell = String(row[c] || "").trim();
        if (cellLooksLikeUrl_(cell)) {
          link = cell;
          break;
        }
      }
    }
    if (!link) continue;
    out.push({
      link: link,
      status: String(row[statusCol] || "").trim()
    });
  }
  return out;
}

/** Company + link pairs so apply-time dedupe can ignore this job's own Ready row. */
function collectCompanyLinkPairs_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];
  var hasHeader = rowLooksLikeHeader_(values[0]);
  var start = hasHeader ? 1 : 0;
  var companyCol = hasHeader ? companyColumnIndex_(values[0]) : 3;
  var linkCol = hasHeader ? linkColumnIndex_(values[0]) : 4;
  var out = [];
  for (var r = start; r < values.length; r++) {
    var row = values[r] || [];
    var company = String(row[companyCol] || "").trim();
    if (!normalizeCompanyName_(company)) continue;
    var link = String(row[linkCol] || "").trim();
    if (!link) {
      for (var c = 0; c < row.length; c++) {
        var cell = String(row[c] || "").trim();
        if (cellLooksLikeUrl_(cell)) {
          link = cell;
          break;
        }
      }
    }
    out.push({ company: company, link: link });
  }
  return out;
}

function companyExists_(sheet, companyName) {
  var target = normalizeCompanyName_(companyName);
  if (!target) return false;
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return false;
  var hasHeader = rowLooksLikeHeader_(values[0]);
  var start = hasHeader ? 1 : 0;
  var col = hasHeader ? companyColumnIndex_(values[0]) : 3;
  for (var r = start; r < values.length; r++) {
    var n = normalizeCompanyName_((values[r] || [])[col]);
    if (n && n === target) return true;
  }
  return false;
}

function collectJobLinks_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];
  var start = rowLooksLikeHeader_(values[0]) ? 1 : 0;
  var links = [];
  for (var r = start; r < values.length; r++) {
    var row = values[r] || [];
    for (var c = 0; c < row.length; c++) {
      var v = String(row[c] || "").trim();
      if (cellLooksLikeUrl_(v)) links.push(v);
    }
  }
  return links;
}

function findRowByLink_(sheet, jobLink) {
  var target = normalizeLink_(jobLink);
  if (!target) return -1;
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return -1;
  var start = rowLooksLikeHeader_(values[0]) ? 1 : 0;
  for (var r = start; r < values.length; r++) {
    var row = values[r] || [];
    for (var c = 0; c < row.length; c++) {
      var cell = String(row[c] || "").trim();
      if (!cell) continue;
      var n = normalizeLink_(cell);
      if (n === target) return r + 1;
      if (target.length >= 12 && (n.indexOf(target) >= 0 || cell.toLowerCase().indexOf(target) >= 0)) {
        return r + 1;
      }
    }
  }
  return -1;
}

function linkExists_(sheet, jobLink) {
  return findRowByLink_(sheet, jobLink) > 0;
}
