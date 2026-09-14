/**
 * One-time setup for Google Sheets append + duplicate check:
 *
 * 1. Open your spreadsheet (one workbook for all profiles)
 * 2. Extensions → Apps Script
 * 3. Paste this code and Save
 * 4. Deploy → New deployment → Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the Web App URL into the extension / WorkSphere "Web App URL" field
 *    (redeploy after updates so listRows / listLinks / markApplied / sheetName are live)
 *
 * POST body (text/plain JSON):
 *   action: "append" (default) | "listRows" | "listLinks" | "markApplied"
 *   spreadsheetId, optional sheetName (tab per profile; created if missing)
 *   and for append: jobNo, applicationDate, jobTitle, companyName, jobLink, salary, status
 *
 * Sheet columns: A No | B Date | C Title | D Company | E Link | F Salary | G Status
 * Resume build → Status "Ready". Apply click → Status "Applied M/D/YYYY h:mm AM/PM" on that row.
 * Dedup: same job link (normalized) is treated as duplicate within that tab.
 *
 * WorkSphere "Sync from sheet" calls listRows. Older scripts without listRows treated
 * that request as append and wrote blank Ready rows — do not fall through unknown actions.
 */
function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!data.spreadsheetId) {
      throw new Error("spreadsheetId is required.");
    }

    const ss = SpreadsheetApp.openById(String(data.spreadsheetId));
    const sheet = resolveSheet_(ss, data.sheetName);
    const action = String(data.action || "append").toLowerCase().replace(/_/g, "");

    if (action === "listlinks") {
      ensureSheetLayout_(sheet);
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

    if (action === "listrows") {
      const pruned = ensureSheetLayout_(sheet);
      const rows = collectJobRows_(sheet);
      return json_({
        ok: true,
        sheetName: sheet.getName(),
        rows: rows,
        count: rows.length,
        prunedBlankRows: pruned
      });
    }

    const jobLink = String(data.jobLink || "").trim();
    const companyName = String(data.companyName || "").trim();
    const jobTitle = String(data.jobTitle || "").trim();

    if (action === "markapplied" || action === "applied") {
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
      if (!rowHasJobIdentity_(jobTitle, companyName, jobLink)) {
        throw new Error("Cannot mark Applied: job not on sheet and title/company/link missing.");
      }
      sheet.appendRow(buildDataRow_(data, status));
      return json_({
        ok: true,
        updated: false,
        appended: true,
        sheetName: sheet.getName()
      });
    }

    if (action && action !== "append") {
      throw new Error(
        'Unknown action "' +
          String(data.action || "") +
          '". Supported: append, listRows, listLinks, markApplied.'
      );
    }

    if (!rowHasJobIdentity_(jobTitle, companyName, jobLink)) {
      throw new Error("Refusing to append an empty row (need title, company, or link).");
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
  created.getRange(1, 1, 1, 7).setValues([
    ["No", "Date", "Title", "Company", "Link", "Salary", "Status"]
  ]);
  return created;
}

/** One data row matching A–G: No | Date | Title | Company | Link | Salary | Status */
function buildDataRow_(data, status) {
  return [
    data.jobNo || "",
    data.applicationDate || "",
    data.jobTitle || "",
    String(data.companyName || "").trim(),
    String(data.jobLink || "").trim(),
    data.salary || "",
    status || "Ready"
  ];
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
  var lastCol = Math.max(sheet.getLastColumn(), 7);
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
  return /\b(link|title|company|compay|status|date|salary)\b/.test(joined);
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
  return 6; // column G
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

function titleColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["title", "job title", "role", "position"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 2; // column C
}

function salaryColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["salary", "comp", "compensation", "pay"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 5; // column F
}

function dateColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["date", "created date", "application date", "created"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 1; // column B
}

function jobNoColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["no", "job no", "jobno", "#", "number"];
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return 0; // column A
}

function rowHasJobIdentity_(title, company, link) {
  if (String(link || "").trim()) return true;
  if (String(title || "").trim()) return true;
  if (String(company || "").trim()) return true;
  return false;
}

function ensureStatusHeader_(sheet) {
  var headers = headerRow_(sheet);
  if (!rowLooksLikeHeader_(headers)) return;
  var idx = statusColumnIndex_(headers);
  if (!String(headers[idx] || "").trim()) {
    sheet.getRange(1, idx + 1).setValue("Status");
  }
}

/** Remove a previously added JD column so Status stays last and append stays 7 cells. */
function dropJdColumnIfPresent_(sheet) {
  var headers = headerRow_(sheet);
  if (!rowLooksLikeHeader_(headers)) return;
  var jdIdx = findNamedColumnIndex_(headers, ["jd", "job description", "description", "job desc"]);
  if (jdIdx >= 0) sheet.deleteColumn(jdIdx + 1);
}

/** Drop columns past Status (orphaned Ready cells after JD removal / bad writes). */
function trimColumnsPastStatus_(sheet) {
  var headers = headerRow_(sheet);
  var statusCol = rowLooksLikeHeader_(headers) ? statusColumnIndex_(headers) + 1 : 7;
  var lastCol = sheet.getLastColumn();
  if (lastCol > statusCol) {
    sheet.deleteColumns(statusCol + 1, lastCol - statusCol);
  }
}

/**
 * Delete rows that only have Status (e.g. lone "Ready") with no title/company/link.
 * Walk bottom-up so deletes do not shift unvisited indices.
 * @return {number} rows removed
 */
function pruneBlankReadyRows_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return 0;
  var hasHeader = rowLooksLikeHeader_(values[0]);
  var start = hasHeader ? 1 : 0;
  var header = hasHeader ? values[0] : [];
  var titleCol = hasHeader ? titleColumnIndex_(header) : 2;
  var companyCol = hasHeader ? companyColumnIndex_(header) : 3;
  var linkCol = hasHeader ? linkColumnIndex_(header) : 4;
  var removed = 0;
  for (var r = values.length - 1; r >= start; r--) {
    var row = values[r] || [];
    var title = String(row[titleCol] || "").trim();
    var company = String(row[companyCol] || "").trim();
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
    if (rowHasJobIdentity_(title, company, link)) continue;
    // Entirely empty rows also count — clear the Ready-only placeholders.
    var any = false;
    for (var i = 0; i < row.length; i++) {
      if (String(row[i] || "").trim()) {
        any = true;
        break;
      }
    }
    if (!any) continue;
    sheet.deleteRow(r + 1);
    removed += 1;
  }
  return removed;
}

/** Normalize layout before read/write. Returns blank rows pruned. */
function ensureSheetLayout_(sheet) {
  ensureStatusHeader_(sheet);
  dropJdColumnIfPresent_(sheet);
  trimColumnsPastStatus_(sheet);
  return pruneBlankReadyRows_(sheet);
}

/** Always write Status to the Status column (G), never "after last filled cell". */
function statusColumnForRow_(sheet, row) {
  var headers = headerRow_(sheet);
  if (rowLooksLikeHeader_(headers)) return statusColumnIndex_(headers) + 1;
  return 7;
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

/** Full job rows for WorkSphere Sync from sheet (skips blank Ready placeholders). */
function collectJobRows_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];
  var hasHeader = rowLooksLikeHeader_(values[0]);
  var start = hasHeader ? 1 : 0;
  var header = hasHeader ? values[0] : [];
  var jobNoCol = hasHeader ? jobNoColumnIndex_(header) : 0;
  var dateCol = hasHeader ? dateColumnIndex_(header) : 1;
  var titleCol = hasHeader ? titleColumnIndex_(header) : 2;
  var companyCol = hasHeader ? companyColumnIndex_(header) : 3;
  var linkCol = hasHeader ? linkColumnIndex_(header) : 4;
  var salaryCol = hasHeader ? salaryColumnIndex_(header) : 5;
  var statusCol = hasHeader ? statusColumnIndex_(header) : 6;
  var out = [];
  for (var r = start; r < values.length; r++) {
    var row = values[r] || [];
    var title = String(row[titleCol] || "").trim();
    var company = String(row[companyCol] || "").trim();
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
    if (!rowHasJobIdentity_(title, company, link)) continue;
    if (!company && /^(ready|saved|new|applied)$/i.test(title)) continue;
    out.push({
      row: r + 1,
      jobNo: String(row[jobNoCol] || "").trim(),
      date: String(row[dateCol] || "").trim(),
      title: title,
      company: company,
      link: link,
      salary: String(row[salaryCol] || "").trim(),
      status: String(row[statusCol] || "").trim()
    });
  }
  return out;
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
