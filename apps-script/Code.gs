/**
 * One-time setup for Google Sheets append + duplicate check:
 *
 * 1. Open your spreadsheet
 * 2. Extensions → Apps Script
 * 3. Paste this code and Save
 * 4. Deploy → New deployment → Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the Web App URL into the extension's "Web App URL" field
 *    (redeploy after updates so listLinks / markApplied are live)
 *
 * POST body (text/plain JSON):
 *   action: "append" (default) | "listLinks" | "markApplied"
 *   spreadsheetId, and for append: jobNo, applicationDate, jobTitle, companyName, jobLink, salary, status
 *
 * Sheet columns: A No | B Date | C Title | D Company | E Link | F Salary | G Status
 * Resume build → Status "Ready". Apply click → Status "Applied M/D/YYYY" on that row.
 */
function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!data.spreadsheetId) {
      throw new Error("spreadsheetId is required.");
    }

    const ss = SpreadsheetApp.openById(String(data.spreadsheetId));
    const sheet = ss.getSheets()[0];
    const action = String(data.action || "append").toLowerCase();

    if (action === "listlinks" || action === "list_links") {
      const links = collectJobLinks_(sheet);
      return json_({ ok: true, links: links, count: links.length });
    }

    const jobLink = String(data.jobLink || "").trim();

    if (action === "markapplied" || action === "mark_applied" || action === "applied") {
      ensureStatusHeader_(sheet);
      const appliedOn = String(data.applicationDate || "").trim();
      const status =
        String(data.status || "").trim() || (appliedOn ? "Applied " + appliedOn : "Applied");
      const row = findRowByLink_(sheet, jobLink);
      if (row > 0) {
        sheet.getRange(row, statusColumnForRow_(sheet, row)).setValue(status);
        return json_({ ok: true, updated: true, appended: false, row: row });
      }
      sheet.appendRow([
        data.jobNo || "",
        data.applicationDate || "",
        data.jobTitle || "",
        data.companyName || "",
        jobLink,
        data.salary || "",
        status
      ]);
      return json_({ ok: true, updated: false, appended: true });
    }

    if (jobLink && linkExists_(sheet, jobLink)) {
      return json_({ ok: true, duplicate: true });
    }

    sheet.appendRow([
      data.jobNo || "",
      data.applicationDate || "",
      data.jobTitle || "",
      data.companyName || "",
      jobLink,
      data.salary || "",
      data.status || "Ready"
    ]);

    return json_({ ok: true, duplicate: false });
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
  return /\b(link|title|company|status|date|salary)\b/.test(joined);
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

function ensureStatusHeader_(sheet) {
  var headers = headerRow_(sheet);
  if (!rowLooksLikeHeader_(headers)) return;
  var idx = statusColumnIndex_(headers);
  if (!String(headers[idx] || "").trim()) {
    sheet.getRange(1, idx + 1).setValue("Status");
  }
}

function statusColumnForRow_(sheet, row) {
  var headers = headerRow_(sheet);
  if (rowLooksLikeHeader_(headers)) return statusColumnIndex_(headers) + 1;
  var width = Math.max(sheet.getLastColumn(), 7);
  var values = sheet.getRange(row, 1, 1, width).getValues()[0] || [];
  var last = 0;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i] || "").trim()) last = i + 1;
  }
  return Math.max(7, last + 1);
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
