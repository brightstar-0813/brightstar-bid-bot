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
 *    (redeploy after updates so listLinks / duplicate guard are live)
 *
 * POST body (text/plain JSON):
 *   action: "append" (default) | "listLinks"
 *   spreadsheetId, and for append: jobNo, applicationDate, jobTitle, companyName, jobLink
 *
 * Sheet columns: A No | B Date | C Title | D Company | E Link
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
    if (jobLink && linkExists_(sheet, jobLink)) {
      return json_({ ok: true, duplicate: true });
    }

    sheet.appendRow([
      data.jobNo || "",
      data.applicationDate || "",
      data.jobTitle || "",
      data.companyName || "",
      jobLink
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

function collectJobLinks_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) return [];
  var linkCol = linkColumnIndex_(values[0]);
  var links = [];
  for (var r = 1; r < values.length; r++) {
    var v = String((values[r] && values[r][linkCol]) || "").trim();
    if (v) links.push(v);
  }
  return links;
}

function linkExists_(sheet, jobLink) {
  var target = normalizeLink_(jobLink);
  if (!target) return false;
  var links = collectJobLinks_(sheet);
  for (var i = 0; i < links.length; i++) {
    if (normalizeLink_(links[i]) === target) return true;
  }
  return false;
}
