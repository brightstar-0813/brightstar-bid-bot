/**
 * One-time setup for Google Sheets append (from the extension README):
 *
 * 1. Open your spreadsheet
 * 2. Extensions → Apps Script
 * 3. Paste this code and Save
 * 4. Deploy → New deployment → Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Copy the Web App URL into the extension's "Web App URL" field
 *
 * After generation, the extension POSTs:
 *   spreadsheetId, jobNo, applicationDate, jobTitle, companyName, jobLink
 *
 * Row order matches your sheet headers:
 *   A No | B Date | C Title | D Company | E Link
 */
function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!data.spreadsheetId) {
      throw new Error("spreadsheetId is required.");
    }

    const ss = SpreadsheetApp.openById(String(data.spreadsheetId));
    const sheet = ss.getSheets()[0];

    sheet.appendRow([
      data.jobNo || "",
      data.applicationDate || "",
      data.jobTitle || "",
      data.companyName || "",
      data.jobLink || ""
    ]);

    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(
      ContentService.MimeType.JSON
    );
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput(
    "Brightstar Bid bot sheet append endpoint is running."
  );
}
