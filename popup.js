import {
  DEFAULT_PROFILE_ID,
  getResumeProfiles,
  getBuiltinPreset,
  getActivePerson,
  setActivePersonId,
  savePersonProfile,
  addCustomProfile,
  deleteCustomProfile,
  BUILTIN_PROFILES,
  COVER_LETTER_PROFILE_ID,
  GENERIC_SENIOR_PROMPT,
  GENERIC_COVER_LETTER_PROMPT,
  normalizeRequiredExperienceInput,
  parseRequiredExperienceFromPrompt,
  resolveExperienceRulesForPerson,
  setPersonSheetConfig
} from "./profiles.js";
import {
  requiredExperienceToText
} from "./experience-rules.js";
import { getAllTemplates, DEFAULT_TEMPLATE_ID } from "./templates/index.js";
import { extractSpreadsheetId, buildSheetRowTsv, formatApplicationDate, formatApplicationDateTime } from "./sheets.js";
import { notifySlackBatchComplete, isSlackWebhookUrl } from "./slack.js";
import {
  parseJobsCsv,
  filterJobsByChannel,
  isLinkedInJob,
  isDiceJob,
  isIndeedJob,
  normalizeChannelFilter
} from "./csv.js";
import { extractMasterResumeFromFile, MASTER_RESUME_ACCEPT } from "./master-resume-file.js";
import {
  extractProfileFromResumeText,
  parseEmployersFromResume,
  resumeFilePrefixFromName,
  outputDirFromPerson,
  namesLikelyDifferent
} from "./resume-profile.js";
import {
  saveCsvFileHandle,
  clearCsvFileHandle,
  readPinnedCsvText
} from "./file-handle-db.js";
import { getCsvSourceSettings, fingerprintText, saveCsvSourceSettings } from "./csv-source.js";
import {
  getQaCount,
  exportQa,
  importQa,
  parseQaBankPayload,
  loadBundledQaBank
} from "./qa-store.js";

const DEFAULT_OUTPUT_DIR = "Applications";
const QUEUE_KEY = "job_queue";
const ALL_US_JOBS_KEY = "all_us_jobs";
const JOB_CHANNEL_FILTER_KEY = "job_channel_filter";
const BATCH_STATE_KEY = "batch_state";
const DEFAULT_CHANNEL_FILTER = "dice";
const MANUAL_PANEL_OPEN_KEY = "manual_panel_open";
const DETACHED_WINDOW_KEY = "detached_window_id";
const PREVIEW_WINDOW_KEY = "template_preview_window_id";
const INDEED_CAPTURE_STATE_KEY = "indeed_capture_state";
const INDEED_CAPTURE_SETTINGS_KEY = "indeed_capture_settings";

/** "popup" (closes on focus loss), "panel" (docked), or "window" (detached). */
const UI_CONTEXT = new URLSearchParams(location.search).get("ctx") || "popup";
document.body.classList.add(`ctx-${UI_CONTEXT}`);

/** Cached so the dock button can call sidePanel.open() inside the user gesture. */
let currentWindowId = null;

const APPS_SCRIPT_SOURCE = `/**
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
 * Resume build → Status "Ready". Apply click → Status "Applied M/D/YYYY h:mm AM/PM" on that row.
 * Dedup: same job link OR same company (normalized) is treated as duplicate.
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
      const companies = collectCompanies_(sheet);
      return json_({
        ok: true,
        links: links,
        companies: companies,
        count: links.length,
        companyCount: companies.length
      });
    }

    const jobLink = String(data.jobLink || "").trim();
    const companyName = String(data.companyName || "").trim();

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
        companyName,
        jobLink,
        data.salary || "",
        status
      ]);
      return json_({ ok: true, updated: false, appended: true });
    }

    if (jobLink && linkExists_(sheet, jobLink)) {
      return json_({ ok: true, duplicate: true, reason: "link" });
    }
    if (companyName && companyExists_(sheet, companyName)) {
      return json_({ ok: true, duplicate: true, reason: "company" });
    }

    sheet.appendRow([
      data.jobNo || "",
      data.applicationDate || "",
      data.jobTitle || "",
      companyName,
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
    u = u.replace(/\\/+$/, "");
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
  if (/https?:\\/\\//i.test(joined)) return false;
  return /\\b(link|title|company|status|date|salary)\\b/.test(joined);
}

function cellLooksLikeUrl_(value) {
  var s = String(value || "").trim();
  return /^https?:\\/\\//i.test(s) || /hyperlink\\s*\\(/i.test(s);
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

function companyColumnIndex_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });
  var names = ["company", "company name", "employer", "organization", "org"];
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
`;

const statusEl = document.getElementById("status");
const profileSelectEl = document.getElementById("profileSelect");
const presetSelectEl = document.getElementById("presetSelect");
const templateSelectEl = document.getElementById("templateSelect");
const deleteProfileBtn = document.getElementById("deleteProfile");
const togglePersonPanelBtn = document.getElementById("togglePersonPanel");
const personPanelBody = document.getElementById("personPanelBody");
const personLabelEl = document.getElementById("personLabel");
const personNameEl = document.getElementById("personName");
const personEmailEl = document.getElementById("personEmail");
const personPhoneEl = document.getElementById("personPhone");
const personLinkedinEl = document.getElementById("personLinkedin");
const personLocationEl = document.getElementById("personLocation");
const personAddressEl = document.getElementById("personAddress");
const personZipEl = document.getElementById("personZip");
const personGenderEl = document.getElementById("personGender");
const personEthnicityEl = document.getElementById("personEthnicity");
const personDisabilityEl = document.getElementById("personDisability");
const personVeteranEl = document.getElementById("personVeteran");
const personCitizenshipEl = document.getElementById("personCitizenship");
const personWorkAuthorizedEl = document.getElementById("personWorkAuthorized");
const personSponsorshipEl = document.getElementById("personSponsorship");
const personHispanicLatinoEl = document.getElementById("personHispanicLatino");
const personAutofillExtrasEl = document.getElementById("personAutofillExtras");
const personResumePrefixEl = document.getElementById("personResumePrefix");
const personSignatureTitleEl = document.getElementById("personSignatureTitle");
const personMasterResumeEl = document.getElementById("personMasterResume");
const personRequiredExperienceEl = document.getElementById("personRequiredExperience");
const detectRequiredExperienceBtn = document.getElementById("detectRequiredExperience");
const personResumePromptEl = document.getElementById("personResumePrompt");
const personCoverPromptEl = document.getElementById("personCoverPrompt");
const personResumeFileEl = document.getElementById("personResumeFile");
const replaceResumeFromFileBtn = document.getElementById("replaceResumeFromFile");
const masterResumeFileHintEl = document.getElementById("masterResumeFileHint");
const personImportNoticeEl = document.getElementById("personImportNotice");
const clearMasterResumeBtn = document.getElementById("clearMasterResume");
const loadPresetBtn = document.getElementById("loadPreset");
const savePersonBtn = document.getElementById("savePerson");
const savePersonAsNewBtn = document.getElementById("savePersonAsNew");
const personSaveStatusEl = document.getElementById("personSaveStatus");
const personSaveHintEl = document.getElementById("personSaveHint");

const csvFileEl = document.getElementById("csvFile");
const csvSummaryEl = document.getElementById("csvSummary");
const csvRefreshBtn = document.getElementById("csvRefresh");
const csvPinFileBtn = document.getElementById("csvPinFile");
const toggleCsvSourcePanelBtn = document.getElementById("toggleCsvSourcePanel");
const csvSourcePanelBody = document.getElementById("csvSourcePanelBody");
const csvPollMinutesEl = document.getElementById("csvPollMinutes");
const csvUrlEnabledEl = document.getElementById("csvUrlEnabled");
const csvUrlEl = document.getElementById("csvUrl");
const csvPinEnabledEl = document.getElementById("csvPinEnabled");
const csvNativeEnabledEl = document.getElementById("csvNativeEnabled");
const csvNativePathEl = document.getElementById("csvNativePath");
const csvPinHintEl = document.getElementById("csvPinHint");
const csvSourceStatusEl = document.getElementById("csvSourceStatus");
const csvExtensionIdHintEl = document.getElementById("csvExtensionIdHint");
const csvSourceSaveBtn = document.getElementById("csvSourceSave");
const csvClearPinBtn = document.getElementById("csvClearPin");
const queueListEl = document.getElementById("queueList");
const batchStartBtn = document.getElementById("batchStart");
const batchPauseBtn = document.getElementById("batchPause");
const batchSkipBtn = document.getElementById("batchSkip");
const forceSaveChatgptBtn = document.getElementById("forceSaveChatgpt");
const batchStopBtn = document.getElementById("batchStop");
const clearJobsBtn = document.getElementById("clearJobs");
const retryErrorsBtn = document.getElementById("retryErrors");
const filterDiceBtn = document.getElementById("filterDice");
const filterLinkedInBtn = document.getElementById("filterLinkedIn");
const filterIndeedBtn = document.getElementById("filterIndeed");
const filterEtcBtn = document.getElementById("filterEtc");
const filterAllBtn = document.getElementById("filterAll");
const diceInterleaveHintEl = document.getElementById("diceInterleaveHint");
const indeedSearchUrlEl = document.getElementById("indeedSearchUrl");
const indeedSearchQueryEl = document.getElementById("indeedSearchQuery");
const indeedMaxPagesEl = document.getElementById("indeedMaxPages");
const indeedCaptureStartBtn = document.getElementById("indeedCaptureStart");
const indeedCaptureStopBtn = document.getElementById("indeedCaptureStop");
const indeedCaptureStateEl = document.getElementById("indeedCaptureState");
const indeedCaptureStatusEl = document.getElementById("indeedCaptureStatus");

const toggleManualPanelBtn = document.getElementById("toggleManualPanel");
const manualPanelBody = document.getElementById("manualPanelBody");
const jobTitleEl = document.getElementById("jobTitle");
const companyNameEl = document.getElementById("companyName");
const jdLinkEl = document.getElementById("jdLink");
const jdTextEl = document.getElementById("jdText");
const outputDirEl = document.getElementById("outputDir");
const spreadsheetUrlEl = document.getElementById("spreadsheetUrl");
const sheetsWebAppUrlEl = document.getElementById("sheetsWebAppUrl");
const copyAppsScriptBtn = document.getElementById("copyAppsScript");
const slackWebhookUrlEl = document.getElementById("slackWebhookUrl");
const testSlackBtn = document.getElementById("testSlack");
const chatgptJobGapSecEl = document.getElementById("chatgptJobGapSec");
const chatgptHardPauseHitsEl = document.getElementById("chatgptHardPauseHits");
const CHATGPT_PACING_KEY = "chatgpt_pacing";
const DEFAULT_CHATGPT_GAP_SEC = 45;
const DEFAULT_CHATGPT_HARD_PAUSE = 3;
const copySheetRowBtn = document.getElementById("copySheetRow");
const keepOpenBtn = document.getElementById("keepOpen");
const previewTemplateBtn = document.getElementById("previewTemplate");
const pasteJdBtn = document.getElementById("pasteJd");
const runOneOffBtn = document.getElementById("runOneOff");
const autofillPageBtn = document.getElementById("autofillPage");
const autoApplyPageBtn = document.getElementById("autoApplyPage");
const resetBtn = document.getElementById("reset");
const qaBankNoteEl = document.getElementById("qaBankNote");
const qaLearnToggleEl = document.getElementById("qaLearnToggle");
const qaOpenEditorBtn = document.getElementById("qaOpenEditorBtn");
const qaImportBundledBtn = document.getElementById("qaImportBundledBtn");
const qaImportBtn = document.getElementById("qaImportBtn");
const qaExportBtn = document.getElementById("qaExportBtn");
const qaImportInput = document.getElementById("qaImportInput");

let profilesCache = [];
let templatesCache = [];
let queueCache = [];
let lastStatusText = "";
let lastQueueFollowRow = null;
let allUsJobsCache = [];
let channelFilter = DEFAULT_CHANNEL_FILTER;
let batchState = "idle";
let editingPersonId = null;

if (personResumeFileEl) {
  personResumeFileEl.setAttribute("accept", MASTER_RESUME_ACCEPT);
}

function setStatus(message) {
  const text = String(message || "").trim();
  lastStatusText = text;
  statusEl.textContent = text || "Ready";
  statusEl.classList.remove("is-idle", "is-ok", "is-warn", "is-err");
  if (!text) {
    statusEl.classList.add("is-idle");
    return;
  }
  const lower = text.toLowerCase();
  if (/\b(fail|failed|error|could not|required|denied)\b/.test(lower)) {
    statusEl.classList.add("is-err");
  } else if (/\b(skip|skipped|pause|paused|unchanged|idle)\b/.test(lower)) {
    statusEl.classList.add("is-warn");
  } else if (/\b(saved|done|complete|loaded|started|sent|ok|ready|pinned|refreshed|imported|filled|applied)\b/.test(lower)) {
    statusEl.classList.add("is-ok");
  }
}

function syncActivePersonChip() {
  const chip = document.getElementById("activePersonChip");
  if (!chip) return;
  const selected = profilesCache.find((p) => p.id === profileSelectEl.value);
  if (!selected) {
    chip.hidden = true;
    chip.textContent = "";
    return;
  }
  chip.hidden = false;
  chip.textContent = selected.label;
  chip.classList.toggle("is-builtin", Boolean(selected.builtin));
  chip.title = selected.builtin ? `${selected.label} (built-in preset)` : selected.label;
}

function syncBatchPill() {
  const el = document.getElementById("batchStatePill");
  if (!el) return;
  el.textContent = batchState || "idle";
  el.dataset.state = batchState || "idle";
}

function setPersonImportNotice(message, { ok = true } = {}) {
  if (!personImportNoticeEl) return;
  if (!message) {
    personImportNoticeEl.hidden = true;
    personImportNoticeEl.textContent = "";
    personImportNoticeEl.className = "person-import-notice";
    return;
  }
  personImportNoticeEl.hidden = false;
  personImportNoticeEl.textContent = message;
  personImportNoticeEl.className = `person-import-notice ${ok ? "ok" : "err"}`;
  try {
    personImportNoticeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch {
    // ignore
  }
}

function clearPersonContactFields() {
  personLabelEl.value = "";
  personNameEl.value = "";
  personEmailEl.value = "";
  personPhoneEl.value = "";
  personLinkedinEl.value = "";
  personLocationEl.value = "";
  personAddressEl.value = "";
  personZipEl.value = "";
  personResumePrefixEl.value = "";
  personSignatureTitleEl.value = "";
  personRequiredExperienceEl.value = "";
}

function clearPersonEeoFields() {
  setSelectValue(personGenderEl, "");
  setSelectValue(personEthnicityEl, "");
  setSelectValue(personDisabilityEl, "");
  setSelectValue(personVeteranEl, "");
  setSelectValue(personCitizenshipEl, "");
  setSelectValue(personWorkAuthorizedEl, "");
  setSelectValue(personSponsorshipEl, "");
  setSelectValue(personHispanicLatinoEl, "");
  personAutofillExtrasEl.value = "";
}

function promptNeedsPersonTemplate(prompt) {
  const p = String(prompt || "");
  if (!p.trim()) return true;
  if (!p.includes("{MASTER_RESUME}") || !p.includes("{NAME}") || !p.includes("{JD}")) return true;
  if (/sandeep\s+mahankali|d.?mario\s+lewis/i.test(p)) return true;
  return false;
}

function applyExtractedProfileToForm(parsed, resumeText, { resetEeo = true } = {}) {
  clearPersonContactFields();
  if (resetEeo) clearPersonEeoFields();
  personMasterResumeEl.value = resumeText;

  if (parsed.name) {
    personNameEl.value = parsed.name;
    personLabelEl.value = parsed.name;
    personResumePrefixEl.value = resumeFilePrefixFromName(parsed.name);
  }
  if (parsed.email) personEmailEl.value = parsed.email;
  if (parsed.phone) personPhoneEl.value = parsed.phone;
  if (parsed.linkedin) personLinkedinEl.value = parsed.linkedin;
  if (parsed.location) personLocationEl.value = parsed.location;
  if (parsed.address) personAddressEl.value = parsed.address;
  if (parsed.zip) personZipEl.value = parsed.zip;
  if (parsed.headline) personSignatureTitleEl.value = parsed.headline;
  if (parsed.employers?.length) {
    personRequiredExperienceEl.value = requiredExperienceToText(parsed.employers);
  }
  if (resetEeo || promptNeedsPersonTemplate(personResumePromptEl.value)) {
    personResumePromptEl.value = GENERIC_SENIOR_PROMPT;
  }
  const cover = String(personCoverPromptEl.value || "");
  if (resetEeo || !cover.trim() || !cover.includes("{JD}") || /sandeep\s+mahankali|matthew\s+dale|d.?mario\s+lewis/i.test(cover)) {
    personCoverPromptEl.value = GENERIC_COVER_LETTER_PROMPT;
  }
}

async function importPersonFromResumeText(text, { sourceLabel = "resume" } = {}) {
  const resumeText = String(text || "").trim();
  if (resumeText.length < 40) {
    throw new Error("Not enough text to build a person. Upload a text-based PDF / DOCX, or paste the resume.");
  }
  const parsed = extractProfileFromResumeText(resumeText);
  const current = profilesCache.find((p) => p.id === editingPersonId);
  const asNew =
    isEditingBuiltin() ||
    Boolean(parsed.name && current?.name && namesLikelyDifferent(current.name, parsed.name));
  applyExtractedProfileToForm(parsed, resumeText, { resetEeo: asNew });

  personPanelBody.hidden = false;
  togglePersonPanelBtn.setAttribute("aria-expanded", "true");
  syncSaveButtonLabels();

  const filled = parsed.filled.length ? parsed.filled.join(", ") : "master resume text only";
  let notice = `Used only values found in ${sourceLabel}: ${filled}. Other fields left blank.`;
  if (!parsed.name) {
    notice += " Add a display name from the resume, then Save person.";
    setPersonImportNotice(notice, { ok: true });
    setPersonSaveStatus(notice, { ok: true });
    setStatus(`Resume imported — name not found in file. Detected: ${filled}.`);
    return parsed;
  }

  setPersonImportNotice(`${notice} Saving as Active person…`, { ok: true });
  setStatus(`Imported ${parsed.name} from ${sourceLabel}. Saving…`);
  const saved = await savePerson({
    asNew,
    successMessage: `Ready to bid as ${parsed.name}. Filled from file: ${filled}. Nothing else was invented.`
  });
  if (saved) {
    setPersonImportNotice(
      `Ready to bid as ${saved.label || parsed.name}. From file: ${filled}. Blank fields were not in the upload.`,
      { ok: true }
    );
  } else {
    setPersonImportNotice(
      `${notice} Review the fields and click Save person.`,
      { ok: false }
    );
  }
  return parsed;
}

function setPersonSaveStatus(message, { ok = true } = {}) {
  if (!personSaveStatusEl) return;
  if (!message) {
    personSaveStatusEl.hidden = true;
    personSaveStatusEl.textContent = "";
    personSaveStatusEl.className = "person-save-status";
    return;
  }
  personSaveStatusEl.hidden = false;
  personSaveStatusEl.textContent = message;
  personSaveStatusEl.className = `person-save-status ${ok ? "ok" : "err"}`;
  try {
    personSaveStatusEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch {
    // ignore
  }
}

function isEditingBuiltin() {
  return BUILTIN_PROFILES.some((b) => b.id === editingPersonId && b.kind !== "coverLetter");
}

function syncSaveButtonLabels() {
  if (!savePersonBtn || !savePersonAsNewBtn) return;
  if (isEditingBuiltin()) {
    savePersonBtn.textContent = "Save as my person";
    savePersonAsNewBtn.textContent = "Duplicate as new";
    if (personSaveHintEl) {
      personSaveHintEl.textContent =
        "Built-in preset is read-only. Save as my person keeps your tailor prompt; each CSV job fills {JD} automatically.";
    }
  } else if (editingPersonId) {
    savePersonBtn.textContent = "Save changes";
    savePersonAsNewBtn.textContent = "Duplicate as new";
    if (personSaveHintEl) {
      personSaveHintEl.textContent =
        "Save your tailor prompt here. Job descriptions come from the CSV per row — do not paste JDs into this box.";
    }
  } else {
    savePersonBtn.textContent = "Save person";
    savePersonAsNewBtn.textContent = "Duplicate as new";
    if (personSaveHintEl) {
      personSaveHintEl.textContent =
        "Paste the resume tailor prompt once (include {JD} as a placeholder). CSV supplies each job’s JD automatically.";
    }
  }
}

function populateTemplateSelect(selectedId) {
  templateSelectEl.innerHTML = "";
  for (const template of templatesCache) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    option.title = template.description
      ? `${template.label} — ${template.description}`
      : template.label;
    templateSelectEl.appendChild(option);
  }
  const validIds = new Set(templatesCache.map((t) => t.id));
  templateSelectEl.value = validIds.has(selectedId) ? selectedId : DEFAULT_TEMPLATE_ID;
}

function populatePresetSelect() {
  presetSelectEl.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "— Built-in presets —";
  presetSelectEl.appendChild(blank);
  for (const p of BUILTIN_PROFILES) {
    if (p.kind === "coverLetter" || p.id === COVER_LETTER_PROFILE_ID) continue;
    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = p.label;
    presetSelectEl.appendChild(option);
  }
}

function syncDeleteButton() {
  const selected = profilesCache.find((p) => p.id === profileSelectEl.value);
  const canDelete = Boolean(selected && !selected.builtin);
  deleteProfileBtn.hidden = !canDelete;
}

function populateProfileSelect(selectedId) {
  profileSelectEl.innerHTML = "";
  for (const profile of profilesCache) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.builtin ? profile.label : `${profile.label} (custom)`;
    profileSelectEl.appendChild(option);
  }
  const validIds = new Set(profilesCache.map((p) => p.id));
  profileSelectEl.value = validIds.has(selectedId) ? selectedId : DEFAULT_PROFILE_ID;
  syncDeleteButton();
  syncActivePersonChip();
}

function extrasToText(extras) {
  if (!extras || typeof extras !== "object") return "";
  return Object.entries(extras)
    .filter(([k, v]) => String(k).trim() && String(v).trim())
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");
}

function textToExtras(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([^=:]+)\s*[=:]\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key && value) out[key] = value;
  }
  return out;
}

function setSelectValue(el, value) {
  if (!el) return;
  const v = String(value || "");
  el.value = v;
  if (el.value !== v && v) {
    // Match by option text when value attribute differs.
    for (const opt of el.options) {
      if (opt.value === v || opt.textContent.trim() === v) {
        el.value = opt.value;
        break;
      }
    }
  }
}

function fillPersonForm(person) {
  editingPersonId = person?.id || null;
  personLabelEl.value = person?.label || "";
  personNameEl.value = person?.name || person?.label || "";
  personEmailEl.value = person?.email || "";
  personPhoneEl.value = person?.phone || "";
  personLinkedinEl.value = person?.linkedin || "";
  personLocationEl.value = person?.location || "";
  personAddressEl.value = person?.address || "";
  personZipEl.value = person?.zip || "";
  setSelectValue(personGenderEl, person?.gender);
  setSelectValue(personEthnicityEl, person?.ethnicity);
  setSelectValue(personDisabilityEl, person?.disability);
  setSelectValue(personVeteranEl, person?.veteran);
  setSelectValue(personCitizenshipEl, person?.citizenship);
  setSelectValue(personWorkAuthorizedEl, person?.workAuthorized);
  setSelectValue(personSponsorshipEl, person?.sponsorship);
  setSelectValue(personHispanicLatinoEl, person?.hispanicLatino);
  personAutofillExtrasEl.value = extrasToText(person?.autofillExtras);
  personResumePrefixEl.value = person?.resumeFilePrefix || "";
  personSignatureTitleEl.value = person?.signatureTitle || "";
  personMasterResumeEl.value = person?.masterResume || "";
  personRequiredExperienceEl.value = requiredExperienceToText(person?.requiredExperience || []);
  personResumePromptEl.value = person?.promptTemplate || "";
  personCoverPromptEl.value = person?.coverLetterPrompt || "";
  masterResumeFileHintEl.textContent = person?.masterResume
    ? `Master resume loaded (${person.masterResume.length} chars).`
    : "";
  syncSaveButtonLabels();
  setPersonSaveStatus("");
}

function readPersonForm({ asNew = false } = {}) {
  return {
    id: asNew ? null : editingPersonId,
    label: personLabelEl.value.trim(),
    name: personNameEl.value.trim() || personLabelEl.value.trim(),
    email: personEmailEl.value.trim(),
    phone: personPhoneEl.value.trim(),
    linkedin: personLinkedinEl.value.trim(),
    location: personLocationEl.value.trim(),
    address: personAddressEl.value.trim(),
    zip: personZipEl.value.trim(),
    gender: personGenderEl.value.trim(),
    ethnicity: personEthnicityEl.value.trim(),
    disability: personDisabilityEl.value.trim(),
    veteran: personVeteranEl.value.trim(),
    citizenship: personCitizenshipEl.value.trim(),
    workAuthorized: personWorkAuthorizedEl.value.trim(),
    sponsorship: personSponsorshipEl.value.trim(),
    hispanicLatino: personHispanicLatinoEl.value.trim(),
    autofillExtras: textToExtras(personAutofillExtrasEl.value),
    resumeFilePrefix: personResumePrefixEl.value.trim() || "Resume",
    signatureTitle: personSignatureTitleEl.value.trim(),
    masterResume: personMasterResumeEl.value,
    requiredExperience: normalizeRequiredExperienceInput(personRequiredExperienceEl.value),
    promptTemplate: personResumePromptEl.value,
    coverLetterPrompt: personCoverPromptEl.value,
    templateId: templateSelectEl.value || DEFAULT_TEMPLATE_ID,
    spreadsheetUrl: spreadsheetUrlEl?.value?.trim() || "",
    sheetsWebAppUrl: sheetsWebAppUrlEl?.value?.trim() || ""
  };
}

async function refreshProfiles(selectedId) {
  profilesCache = await getResumeProfiles();
  const preferred =
    selectedId ||
    (await chrome.storage.local.get("active_person_id")).active_person_id ||
    (await chrome.storage.local.get("selected_profile_id")).selected_profile_id ||
    DEFAULT_PROFILE_ID;
  populateProfileSelect(preferred);
  populatePresetSelect();
}

async function refreshTemplates(selectedId) {
  templatesCache = getAllTemplates();
  const preferred =
    selectedId ||
    (await chrome.storage.local.get("selected_template_id")).selected_template_id ||
    DEFAULT_TEMPLATE_ID;
  populateTemplateSelect(preferred);
}

async function syncOutputDirFromPerson(person) {
  const next = outputDirFromPerson(person);
  if (outputDirEl) outputDirEl.value = next;
  await chrome.storage.local.set({ output_dir: next, batch_output_dir: next });
  return next;
}

/** Load this person's Google Sheet URLs into the UI + global keys used by the batch worker. */
async function syncSheetConfigFromPerson(person) {
  const spreadsheetUrl = String(person?.spreadsheetUrl || "").trim();
  const sheetsWebAppUrl = String(person?.sheetsWebAppUrl || "").trim();
  if (spreadsheetUrlEl) spreadsheetUrlEl.value = spreadsheetUrl;
  if (sheetsWebAppUrlEl) sheetsWebAppUrlEl.value = sheetsWebAppUrl;
  await chrome.storage.local.set({
    spreadsheet_url: spreadsheetUrl,
    sheets_web_app_url: sheetsWebAppUrl
  });
  if (person?.id) {
    await setPersonSheetConfig(person.id, { spreadsheetUrl, sheetsWebAppUrl });
  }
}

async function persistActivePersonSheetFromUi() {
  const person = await getActivePerson().catch(() => null);
  const spreadsheetUrl = spreadsheetUrlEl?.value?.trim() || "";
  const sheetsWebAppUrl = sheetsWebAppUrlEl?.value?.trim() || "";
  await chrome.storage.local.set({
    spreadsheet_url: spreadsheetUrl,
    sheets_web_app_url: sheetsWebAppUrl
  });
  if (person?.id) {
    await setPersonSheetConfig(person.id, { spreadsheetUrl, sheetsWebAppUrl });
  }
}

async function loadActivePersonIntoForm() {
  const person = await getActivePerson();
  fillPersonForm(person);
  syncSaveButtonLabels();
  syncActivePersonChip();
  await syncOutputDirFromPerson(person);
  await syncSheetConfigFromPerson(person);
}

async function persistJobFields() {
  await chrome.storage.local.set({
    last_job_title: jobTitleEl.value,
    last_company_name: companyNameEl.value,
    last_jd_link: jdLinkEl.value,
    last_jd_text: jdTextEl.value,
    output_dir: outputDirEl.value.trim() || DEFAULT_OUTPUT_DIR,
    slack_webhook_url: slackWebhookUrlEl.value.trim()
  });
  await persistActivePersonSheetFromUi();
  await persistChatGptPacing();
}

function clampPacingNumber(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

async function persistChatGptPacing() {
  const jobGapSeconds = clampPacingNumber(
    chatgptJobGapSecEl?.value,
    15,
    180,
    DEFAULT_CHATGPT_GAP_SEC
  );
  const hardPauseAfterHits = clampPacingNumber(
    chatgptHardPauseHitsEl?.value,
    2,
    10,
    DEFAULT_CHATGPT_HARD_PAUSE
  );
  if (chatgptJobGapSecEl) chatgptJobGapSecEl.value = String(jobGapSeconds);
  if (chatgptHardPauseHitsEl) chatgptHardPauseHitsEl.value = String(hardPauseAfterHits);
  await chrome.storage.local.set({
    [CHATGPT_PACING_KEY]: { jobGapSeconds, hardPauseAfterHits }
  });
}

function renderIndeedCaptureState(state) {
  const current = state && typeof state === "object" ? state : {};
  const status = String(current.status || "idle");
  const captured = Number(current.qualified ?? current.capturedCount ?? current.jobs?.length ?? 0);
  const scanned = Number(current.scanned ?? current.scannedCount ?? current.captured ?? 0);
  const duplicates = Number(current.duplicates || 0);
  const external = Number(current.external || 0);
  const blocked = Number(current.blocked || 0);
  const page = Number(current.page || 0);
  const maxPages = Number(current.maxPages || 0);
  if (indeedCaptureStateEl) {
    indeedCaptureStateEl.textContent = status;
    indeedCaptureStateEl.dataset.state = status;
  }
  if (indeedCaptureStatusEl) {
    const pageText = page ? ` · page ${page}${maxPages ? `/${maxPages}` : ""}` : "";
    const detail = current.message || current.blockReason || "";
    indeedCaptureStatusEl.textContent =
      `${status} · ${captured} qualified · ${scanned} scanned · ${duplicates} duplicate · ${external} external · ${blocked} blocked${pageText}` +
      (detail ? ` · ${detail}` : "");
  }
  const busy = status === "running" || status === "stopping";
  if (indeedCaptureStartBtn) indeedCaptureStartBtn.disabled = busy;
  if (indeedCaptureStopBtn) indeedCaptureStopBtn.disabled = !busy;
}

function normalizeIndeedSearchUrl(rawUrl, query) {
  const raw = String(rawUrl || "").trim();
  const url = new URL(raw || "https://www.indeed.com/jobs");
  if (!/(^|\.)indeed\.com$/i.test(url.hostname)) {
    throw new Error("Indeed search URL must use indeed.com.");
  }
  if (query) url.searchParams.set("q", query);
  return url.toString();
}

async function startIndeedCapture() {
  const query = String(indeedSearchQueryEl?.value || "Salesforce").trim() || "Salesforce";
  const maxPages = Math.min(25, Math.max(1, Number(indeedMaxPagesEl?.value || 5)));
  const searchUrl = normalizeIndeedSearchUrl(indeedSearchUrlEl?.value, query);
  const settings = { searchUrl, query, maxPages };
  const state = {
    status: "running",
    searchUrl,
    query,
    maxPages,
    page: 1,
    scanned: 0,
    captured: 0,
    qualified: 0,
    duplicates: 0,
    external: 0,
    blocked: 0,
    startedAt: Date.now(),
    message: "Opening Indeed search"
  };
  await chrome.storage.local.set({
    [INDEED_CAPTURE_SETTINGS_KEY]: settings,
    [INDEED_CAPTURE_STATE_KEY]: state
  });
  if (indeedSearchUrlEl) indeedSearchUrlEl.value = searchUrl;
  if (indeedMaxPagesEl) indeedMaxPagesEl.value = String(maxPages);
  renderIndeedCaptureState(state);

  chrome.runtime
    .sendMessage({ type: "indeed_capture_start", ...settings })
    .then((result) => {
      if (!result?.ok) {
        setStatus(`Indeed capture failed: ${String(result?.error || "Unknown error")}`);
        return;
      }
      if (result.started) {
        setStatus(`Indeed capture started — scanning up to ${maxPages} page(s).`);
        return;
      }
      setStatus(
        result.stopped
          ? `Indeed capture stopped — ${Number(result.qualified || 0)} Salesforce job(s) kept.`
          : `Indeed capture complete — ${Number(result.qualified || 0)} Salesforce job(s) kept.`
      );
    })
    .catch((error) => setStatus(`Indeed capture failed: ${String(error?.message || error)}`));
  setStatus(`Indeed capture started — scanning up to ${maxPages} page(s).`);
}

async function stopIndeedCapture() {
  const result = await chrome.runtime.sendMessage({ type: "indeed_capture_stop" });
  if (!result?.ok) throw new Error(result?.error || "Could not stop Indeed capture.");
  renderIndeedCaptureState(result.state);
  setStatus(result.state?.message || "Stopping Indeed capture…");
}

async function loadSettings() {
  const data = await chrome.storage.local.get([
    "selected_profile_id",
    "active_person_id",
    "selected_template_id",
    "last_job_title",
    "last_company_name",
    "last_jd_link",
    "last_jd_text",
    "output_dir",
    "spreadsheet_url",
    "sheets_web_app_url",
    "slack_webhook_url",
    CHATGPT_PACING_KEY,
    MANUAL_PANEL_OPEN_KEY,
    "generation_status",
    "generation_running",
    QUEUE_KEY,
    ALL_US_JOBS_KEY,
    JOB_CHANNEL_FILTER_KEY,
    BATCH_STATE_KEY,
    INDEED_CAPTURE_STATE_KEY,
    INDEED_CAPTURE_SETTINGS_KEY,
    "qa_learn_enabled"
  ]);

  await refreshProfiles(data.active_person_id || data.selected_profile_id || DEFAULT_PROFILE_ID);
  await refreshTemplates(data.selected_template_id || DEFAULT_TEMPLATE_ID);
  await loadActivePersonIntoForm();

  jobTitleEl.value = data.last_job_title || "";
  companyNameEl.value = data.last_company_name || "";
  jdLinkEl.value = data.last_jd_link || "";
  jdTextEl.value = data.last_jd_text || "";
  // Output folder + Google Sheet follow the active person (synced in loadActivePersonIntoForm).
  if (!String(outputDirEl.value || "").trim()) {
    outputDirEl.value = data.output_dir || DEFAULT_OUTPUT_DIR;
  }
  if (!String(spreadsheetUrlEl.value || "").trim() && data.spreadsheet_url) {
    spreadsheetUrlEl.value = data.spreadsheet_url;
  }
  if (!String(sheetsWebAppUrlEl.value || "").trim() && data.sheets_web_app_url) {
    sheetsWebAppUrlEl.value = data.sheets_web_app_url;
  }
  slackWebhookUrlEl.value = data.slack_webhook_url || "";
  const pacing = data[CHATGPT_PACING_KEY] || {};
  if (chatgptJobGapSecEl) {
    chatgptJobGapSecEl.value = String(
      clampPacingNumber(pacing.jobGapSeconds, 15, 180, DEFAULT_CHATGPT_GAP_SEC)
    );
  }
  if (chatgptHardPauseHitsEl) {
    chatgptHardPauseHitsEl.value = String(
      clampPacingNumber(pacing.hardPauseAfterHits, 2, 10, DEFAULT_CHATGPT_HARD_PAUSE)
    );
  }
  setManualPanelOpen(Boolean(data[MANUAL_PANEL_OPEN_KEY]), { persist: false });
  setStatus(data.generation_status || "");

  channelFilter = normalizeChannelFilter(data[JOB_CHANNEL_FILTER_KEY] || DEFAULT_CHANNEL_FILTER);
  allUsJobsCache = Array.isArray(data[ALL_US_JOBS_KEY])
    ? data[ALL_US_JOBS_KEY].map((j) => ({
        ...j,
        isLinkedIn: typeof j.isLinkedIn === "boolean" ? j.isLinkedIn : isLinkedInJob(j),
        isDice: typeof j.isDice === "boolean" ? j.isDice : isDiceJob(j),
        isIndeed: typeof j.isIndeed === "boolean" ? j.isIndeed : isIndeedJob(j)
      }))
    : [];
  queueCache = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
  batchState = data[BATCH_STATE_KEY] || "idle";
  const indeedSettings = data[INDEED_CAPTURE_SETTINGS_KEY] || {};
  if (indeedSearchUrlEl) indeedSearchUrlEl.value = indeedSettings.searchUrl || "";
  if (indeedSearchQueryEl) indeedSearchQueryEl.value = indeedSettings.query || "Salesforce";
  if (indeedMaxPagesEl) indeedMaxPagesEl.value = String(indeedSettings.maxPages || 5);
  renderIndeedCaptureState(data[INDEED_CAPTURE_STATE_KEY]);

  // Re-apply filter if we have the full US list; otherwise keep existing queue.
  if (allUsJobsCache.length) {
    await applyChannelFilter(channelFilter, { persist: false });
  } else {
    syncChannelFilterButtons();
    renderQueue();
    updateCsvSummaryFromQueue();
  }

  setBusy(Boolean(data.generation_running) || batchState === "running");

  await loadCsvSourceForm().catch(() => {});
  if (qaLearnToggleEl) qaLearnToggleEl.checked = data.qa_learn_enabled !== false;
  await refreshQaBank().catch(() => {});
  await hydrateJobDirsInUi().catch(() => {});
}

async function hydrateJobDirsInUi() {
  const res = await chrome.runtime.sendMessage({ type: "hydrate_job_dirs" }).catch(() => null);
  if (!res?.ok) return;
  if (Array.isArray(res.allUsJobs)) {
    allUsJobsCache = res.allUsJobs.map((j) => ({
      ...j,
      isLinkedIn: typeof j.isLinkedIn === "boolean" ? j.isLinkedIn : isLinkedInJob(j),
      isDice: typeof j.isDice === "boolean" ? j.isDice : isDiceJob(j),
      isIndeed: typeof j.isIndeed === "boolean" ? j.isIndeed : isIndeedJob(j)
    }));
  }
  if (Array.isArray(res.queue)) queueCache = res.queue;
  else if (allUsJobsCache.length) {
    await applyChannelFilter(channelFilter, { persist: false });
    return;
  }
  renderQueue();
  updateCsvSummaryFromQueue();
}

function updateCsvSummaryFromQueue() {
  if (!csvSummaryEl) return;
  if (!allUsJobsCache.length && !queueCache.length) {
    csvSummaryEl.classList.add("is-idle");
    csvSummaryEl.innerHTML = `<span class="summary-idle">No CSV loaded</span>`;
    return;
  }
  const liTotal = allUsJobsCache.filter((j) => j.isLinkedIn || isLinkedInJob(j)).length;
  const diceTotal = allUsJobsCache.filter((j) => j.isDice || isDiceJob(j)).length;
  const indeedTotal = allUsJobsCache.filter((j) => j.isIndeed || isIndeedJob(j)).length;
  const etcTotal = allUsJobsCache.filter(
    (j) =>
      !(j.isDice || isDiceJob(j)) &&
      !(j.isLinkedIn || isLinkedInJob(j)) &&
      !(j.isIndeed || isIndeedJob(j))
  ).length;
  const done = queueCache.filter((j) => j.status === "done").length;
  const pending = queueCache.filter((j) => j.status === "pending").length;
  const errors = queueCache.filter((j) => j.status === "error" || j.status === "failed").length;
  const skipped = queueCache.filter((j) => j.status === "skipped").length;
  const filterLabel =
    channelFilter === "linkedin"
      ? "LI only"
      : channelFilter === "indeed"
        ? "Indeed only"
      : channelFilter === "dice"
        ? "Dice only"
        : channelFilter === "etc"
          ? "Etc only"
          : channelFilter === "all"
            ? "All"
            : "Dice only";
  csvSummaryEl.classList.remove("is-idle");
  csvSummaryEl.innerHTML = `
    <div class="stat-grid">
      <span class="stat"><em>${queueCache.length}</em> queue</span>
      <span class="stat"><em>${done}</em> done</span>
      <span class="stat"><em>${pending}</em> pending</span>
      <span class="stat"><em>${skipped}</em> skipped</span>
      <span class="stat${errors ? " is-bad" : ""}"><em>${errors}</em> error</span>
    </div>
    <p class="summary-meta">${filterLabel} · US ${allUsJobsCache.length} · Dice ${diceTotal} · LI ${liTotal} · Indeed ${indeedTotal} · Etc ${etcTotal} · batch ${batchState}</p>
  `;
  syncBatchPill();
}

function syncChannelFilterButtons() {
  const map = {
    dice: filterDiceBtn,
    linkedin: filterLinkedInBtn,
    indeed: filterIndeedBtn,
    etc: filterEtcBtn,
    all: filterAllBtn
  };
  for (const [key, btn] of Object.entries(map)) {
    if (!btn) continue;
    btn.classList.toggle("active", key === channelFilter);
  }
  if (diceInterleaveHintEl) {
    // Always visible — auto-apply is per Dice job, not only when Dice filter is selected.
    diceInterleaveHintEl.hidden = false;
  }
}

function mergeStatusFromQueue(jobs, previousQueue, profileId = "") {
  const prevByRow = new Map((previousQueue || []).map((j) => [Number(j.csvRow), j]));
  const pid = String(profileId || "").trim();
  return jobs.map((j) => {
    const prev = prevByRow.get(Number(j.csvRow));
    if (!prev) {
      return { ...j, status: j.status || "pending", ...(pid ? { profileId: j.profileId || pid } : {}) };
    }
    return {
      ...j,
      status: prev.status || "pending",
      attempts: prev.attempts || 0,
      jobDir: prev.jobDir || j.jobDir,
      hasFiles: Boolean(prev.hasFiles || j.hasFiles || prev.jobDir || j.jobDir),
      resumeName: prev.resumeName || j.resumeName || "",
      coverName: prev.coverName || j.coverName || "",
      applied: Boolean(prev.applied || j.applied),
      appliedDate: prev.appliedDate || j.appliedDate || "",
      applyAttempted: Boolean(prev.applyAttempted || j.applyAttempted),
      applyAttempts: Number(prev.applyAttempts || j.applyAttempts || 0),
      inactive: Boolean(prev.inactive || j.inactive),
      profileId: prev.profileId || j.profileId || pid || "",
      error: prev.error
    };
  });
}

async function applyChannelFilter(nextFilter, { persist = true } = {}) {
  channelFilter = normalizeChannelFilter(nextFilter || DEFAULT_CHANNEL_FILTER);
  syncChannelFilterButtons();
  const filtered = filterJobsByChannel(allUsJobsCache, channelFilter);
  const person = await getActivePerson().catch(() => null);
  queueCache = mergeStatusFromQueue(filtered, queueCache, person?.id || "");
  if (persist) {
    await chrome.storage.local.set({
      [JOB_CHANNEL_FILTER_KEY]: channelFilter,
      [QUEUE_KEY]: queueCache,
      [ALL_US_JOBS_KEY]: allUsJobsCache
    });
  }
  updateCsvSummaryFromQueue();
  renderQueue();
  setStatus(
    channelFilter === "dice"
      ? `Showing Dice jobs — ${queueCache.length} in queue. Start builds then auto-applies each job.`
      : channelFilter === "linkedin"
        ? `Showing LinkedIn jobs — ${queueCache.length} in queue.`
        : channelFilter === "indeed"
          ? `Showing Indeed jobs — ${queueCache.length} in queue.`
        : channelFilter === "etc"
          ? `Showing Etc (not Dice, LI, or Indeed) — ${queueCache.length} in queue.`
          : `Showing all US jobs — ${queueCache.length} in queue.`
  );
}

function folderLabelFromJobDir(jobDir) {
  const parts = String(jobDir || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function appliedDocsTitle(job) {
  const lines = [];
  lines.push(job.appliedDate ? `Applied ${job.appliedDate}` : "Applied");
  const folder = folderLabelFromJobDir(job.jobDir);
  if (folder) lines.push(folder);
  if (job.resumeName) lines.push(`Resume: ${job.resumeName}`);
  if (job.coverName) lines.push(`Cover letter: ${job.coverName}`);
  if (!job.resumeName && !job.coverName && (job.jobDir || job.hasFiles)) {
    lines.push("Resume and cover letter are in this job folder.");
  }
  lines.push("Marked on the Google Sheet.");
  return lines.join("\n");
}

function badgeClass(status) {
  const s = String(status || "pending");
  if (s === "done") return "badge badge-done";
  if (s === "running") return "badge badge-running";
  if (s === "skipped") return "badge badge-skipped";
  if (s === "error") return "badge badge-error";
  if (s === "failed") return "badge badge-failed";
  if (s === "paused") return "badge badge-paused";
  return "badge badge-pending";
}

/** CSV row the batch is actively generating or Dice-applying (status line or running badge). */
function resolveCurrentWorkCsvRow() {
  const running = queueCache.find((j) => j.status === "running");
  if (running?.csvRow != null && running.csvRow !== "") return Number(running.csvRow);
  const m = String(lastStatusText || "").match(/\brow\s+(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

/** Keep the queue list scrolled to the job currently being worked. */
function followQueueToCurrentWork({ force = false } = {}) {
  if (!queueListEl) return;
  const row = resolveCurrentWorkCsvRow();
  if (row == null || !Number.isFinite(row)) {
    lastQueueFollowRow = null;
    return;
  }
  const el = queueListEl.querySelector(`.queue-item[data-csv-row="${row}"]`);
  if (!el) return;
  const busy = batchState === "running" || document.body.classList.contains("is-busy");
  if (!busy && !force) return;
  const rowChanged = lastQueueFollowRow !== row;
  lastQueueFollowRow = row;
  // Re-render rebuilds the list (scroll resets); nearest is a no-op when already visible.
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: "nearest", behavior: rowChanged ? "smooth" : "auto" });
  });
}

function renderQueue() {
  queueListEl.innerHTML = "";
  if (!queueCache.length) {
    const empty = document.createElement("div");
    empty.className = "queue-empty";
    empty.innerHTML = "<p>Queue is empty</p><span>Upload a jobs CSV to start a batch</span>";
    queueListEl.appendChild(empty);
    lastQueueFollowRow = null;
    return;
  }

  const currentRow = resolveCurrentWorkCsvRow();

  for (const job of queueCache) {
    const item = document.createElement("div");
    item.className = "queue-item";
    item.dataset.csvRow = String(job.csvRow);
    if (currentRow != null && Number(job.csvRow) === currentRow) {
      item.classList.add("is-current");
    }

    const rowEl = document.createElement("div");
    rowEl.className = "csv-row";
    rowEl.textContent = String(job.csvRow);

    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = job.title || "Untitled";
    title.title = job.title || "";
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = `${job.company || ""}${job.location ? " · " + job.location : ""}`;
    const badges = document.createElement("div");
    badges.className = "queue-badges";
    const badge = document.createElement("span");
    badge.className = badgeClass(job.status);
    badge.textContent = job.status || "pending";
    badges.appendChild(badge);
    if (job.isLinkedIn || isLinkedInJob(job)) {
      const liBadge = document.createElement("span");
      liBadge.className = "badge badge-li";
      liBadge.textContent = "LI";
      badges.appendChild(liBadge);
    }
    if (job.isDice || isDiceJob(job)) {
      const diceBadge = document.createElement("span");
      diceBadge.className = "badge badge-dice";
      diceBadge.textContent = "Dice";
      badges.appendChild(diceBadge);
    }
    if (job.isIndeed || isIndeedJob(job)) {
      const indeedBadge = document.createElement("span");
      indeedBadge.className = "badge badge-indeed";
      indeedBadge.textContent = "Indeed";
      badges.appendChild(indeedBadge);
    }
    if (job.applied) {
      const appliedBadge = document.createElement("span");
      appliedBadge.className = "badge badge-applied";
      appliedBadge.textContent = "Applied";
      appliedBadge.title = appliedDocsTitle(job);
      badges.appendChild(appliedBadge);
    } else if (job.inactive) {
      const inactiveBadge = document.createElement("span");
      inactiveBadge.className = "badge badge-inactive";
      inactiveBadge.textContent = "Inactive";
      inactiveBadge.title = "Job no longer available on Dice";
      badges.appendChild(inactiveBadge);
    }
    meta.appendChild(title);
    meta.appendChild(sub);
    meta.appendChild(badges);
    if (job.error) {
      const err = document.createElement("div");
      err.className = "sub";
      err.textContent = job.error;
      err.title = job.error;
      meta.appendChild(err);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "secondary";
    openBtn.textContent = "Open";
    openBtn.disabled = !job.jdLink;
    openBtn.addEventListener("click", () => openJob(job));

    const revealBtn = document.createElement("button");
    revealBtn.type = "button";
    revealBtn.className = "secondary";
    revealBtn.textContent = "Files";
    revealBtn.disabled = !job.jobDir && job.status !== "done" && !job.hasFiles;
    revealBtn.title = job.jobDir
      ? [
          `Open ${job.jobDir}`,
          job.resumeName ? `Resume: ${job.resumeName}` : "",
          job.coverName ? `Cover letter: ${job.coverName}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      : job.status === "done" || job.hasFiles
        ? "Reveal generated resume and cover letter"
        : "Generate this job first to create files";
    revealBtn.addEventListener("click", () => revealJobFiles(job));

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = job.applied ? "secondary" : "primary";
    applyBtn.textContent = job.applied ? "Applied" : "Apply";
    applyBtn.title = job.applied
      ? `${appliedDocsTitle(job)}\nClick to apply again.`
      : "Open this job, upload its resume and cover letter, autofill, and mark Applied on the Google Sheet";
    applyBtn.addEventListener("click", () => applyAssist(job));

    actions.appendChild(openBtn);
    actions.appendChild(revealBtn);
    actions.appendChild(applyBtn);

    if (job.status === "error" || job.status === "failed") {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "secondary";
      retryBtn.textContent = "Retry";
      retryBtn.title = "Reset this job and run it again";
      retryBtn.addEventListener("click", () => retryOneJob(job));
      actions.appendChild(retryBtn);
    }

    item.appendChild(rowEl);
    item.appendChild(meta);
    item.appendChild(actions);
    queueListEl.appendChild(item);
  }

  followQueueToCurrentWork();
}

async function persistQueue() {
  await chrome.storage.local.set({ [QUEUE_KEY]: queueCache });
  updateCsvSummaryFromQueue();
  renderQueue();
}

async function loadCsvSourceForm() {
  const res = await chrome.runtime.sendMessage({ type: "csv_source_get" }).catch(() => null);
  const settings = res?.settings || (await getCsvSourceSettings());
  if (csvPollMinutesEl) csvPollMinutesEl.value = String(settings.pollMinutes || 30);
  if (csvUrlEnabledEl) csvUrlEnabledEl.checked = Boolean(settings.urlEnabled);
  if (csvUrlEl) csvUrlEl.value = settings.url || "";
  if (csvPinEnabledEl) csvPinEnabledEl.checked = Boolean(settings.pinEnabled);
  if (csvNativeEnabledEl) csvNativeEnabledEl.checked = Boolean(settings.nativeEnabled);
  if (csvPinHintEl) {
    csvPinHintEl.textContent = settings.pinFileName
      ? `Pinned: ${settings.pinFileName}${settings.pinEnabled ? " (polling on)" : " (polling off)"}`
      : "No local CSV pinned.";
  }
  if (csvSourceStatusEl) {
    const when = settings.lastIngestAt
      ? new Date(settings.lastIngestAt).toLocaleString()
      : "";
    csvSourceStatusEl.textContent = settings.lastStatus
      ? `${settings.lastStatus}${when ? ` · ${when}` : ""}`
      : "Auto-source idle.";
  }
  if (csvExtensionIdHintEl) {
    const id = res?.extensionId || chrome.runtime.id;
    csvExtensionIdHintEl.textContent = `Extension ID (for native-host install): ${id}`;
  }
}

function setCsvSourcePanelOpen(open) {
  if (!csvSourcePanelBody || !toggleCsvSourcePanelBtn) return;
  csvSourcePanelBody.hidden = !open;
  toggleCsvSourcePanelBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

async function saveCsvSourceForm() {
  const res = await chrome.runtime.sendMessage({
    type: "csv_source_save",
    settings: {
      pollMinutes: Number(csvPollMinutesEl?.value || 30),
      url: csvUrlEl?.value || "",
      urlEnabled: Boolean(csvUrlEnabledEl?.checked),
      pinEnabled: Boolean(csvPinEnabledEl?.checked),
      pinFileName: (await getCsvSourceSettings()).pinFileName || "",
      nativeEnabled: Boolean(csvNativeEnabledEl?.checked)
    },
    nativePath: csvNativePathEl?.value || ""
  });
  if (!res?.ok) throw new Error(res?.error || "Save source settings failed.");
  await loadCsvSourceForm();
  setStatus(
    res.alarm?.scheduled
      ? `CSV auto-source saved — polling every ${res.alarm.minutes} min.`
      : "CSV auto-source saved (polling off)."
  );
}

async function pinLocalCsvFile() {
  if (!window.showOpenFilePicker) {
    throw new Error("File System Access API not supported in this Chrome build.");
  }
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [
      {
        description: "Jobs CSV",
        accept: { "text/csv": [".csv"], "text/plain": [".csv", ".txt"] }
      }
    ]
  });
  await saveCsvFileHandle(handle);
  const file = await handle.getFile();
  const text = await file.text();
  await chrome.runtime.sendMessage({
    type: "csv_source_save",
    settings: {
      pollMinutes: Number(csvPollMinutesEl?.value || 30),
      url: csvUrlEl?.value || "",
      urlEnabled: Boolean(csvUrlEnabledEl?.checked),
      pinEnabled: true,
      pinFileName: file.name || handle.name || "jobs.csv",
      nativeEnabled: Boolean(csvNativeEnabledEl?.checked)
    },
    nativePath: csvNativePathEl?.value || ""
  });
  if (csvPinEnabledEl) csvPinEnabledEl.checked = true;
  const ingest = await chrome.runtime.sendMessage({
    type: "ingest_csv_text",
    text,
    fileName: file.name,
    source: "pinned",
    autoStart: true,
    force: true
  });
  await reloadQueueFromStorage();
  await loadCsvSourceForm();
  if (!ingest?.ok) throw new Error(ingest?.error || "Ingest failed after pin.");
  setStatus(
    ingest.unchangedFile
      ? `Pinned ${file.name} (unchanged).`
      : `Pinned ${file.name} — +${ingest.added || 0} new · ${ingest.pending || 0} pending.`
  );
}

async function clearPinnedCsv() {
  await clearCsvFileHandle();
  await chrome.runtime.sendMessage({
    type: "csv_source_save",
    settings: {
      pollMinutes: Number(csvPollMinutesEl?.value || 30),
      url: csvUrlEl?.value || "",
      urlEnabled: Boolean(csvUrlEnabledEl?.checked),
      pinEnabled: false,
      pinFileName: "",
      nativeEnabled: Boolean(csvNativeEnabledEl?.checked)
    },
    nativePath: csvNativePathEl?.value || ""
  });
  if (csvPinEnabledEl) csvPinEnabledEl.checked = false;
  await loadCsvSourceForm();
  setStatus("Cleared pinned CSV.");
}

async function reloadQueueFromStorage() {
  const data = await chrome.storage.local.get([QUEUE_KEY, ALL_US_JOBS_KEY, BATCH_STATE_KEY]);
  queueCache = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
  allUsJobsCache = Array.isArray(data[ALL_US_JOBS_KEY]) ? data[ALL_US_JOBS_KEY] : [];
  batchState = data[BATCH_STATE_KEY] || "idle";
  renderQueue();
  updateCsvSummaryFromQueue();
}

async function refreshCsvFromSources() {
  setStatus("Refreshing CSV from configured sources…");

  // Prefer interactive pin read in the UI (can re-prompt permission).
  try {
    const pinned = await readPinnedCsvText({ interactive: true });
    if (pinned.ok && pinned.text) {
      const ingest = await chrome.runtime.sendMessage({
        type: "ingest_csv_text",
        text: pinned.text,
        fileName: pinned.fileName || "jobs.csv",
        source: "pinned",
        autoStart: true,
        force: false
      });
      await reloadQueueFromStorage();
      await loadCsvSourceForm();
      if (ingest?.ok) {
        setStatus(
          ingest.unchangedFile
            ? "Pinned CSV unchanged."
            : `Refreshed pinned CSV — +${ingest.added || 0} new · ${ingest.pending || 0} pending${ingest.started ? " · batch started" : ""}.`
        );
        return;
      }
    }
  } catch {
    // fall through to background poll (URL / native)
  }

  const res = await chrome.runtime.sendMessage({ type: "csv_source_refresh", force: false });
  await reloadQueueFromStorage();
  await loadCsvSourceForm();
  if (!res?.ok && res?.error) {
    setStatus(`Refresh failed: ${res.error}`);
    return;
  }
  if (res?.result) {
    const r = res.result;
    setStatus(
      r.unchangedFile
        ? `CSV unchanged (${res.via || "source"}).`
        : `Refreshed via ${res.via || "source"} — +${r.added || 0} new · ${r.pending || 0} pending${r.started ? " · batch started" : ""}.`
    );
    return;
  }
  if (res?.unchanged) {
    setStatus("No CSV changes detected.");
    return;
  }
  if (res?.errors?.length) {
    setStatus(`Refresh: ${res.errors.join(" · ")}. Pin a file, set a URL, or Choose File.`);
    return;
  }
  setStatus("Refresh finished. Configure Auto-source settings if nothing changed.");
}

async function onCsvSelected(file) {
  if (!file) return;
  setStatus("Parsing CSV…");
  try {
    const text = await file.text();
    const result = parseJobsCsv(text);
    allUsJobsCache = result.usJobs.map((j) => ({ ...j, status: "pending" }));
    // Fresh upload: do not carry over done/error from a previous CSV.
    queueCache = [];
    await chrome.storage.local.set({
      batch_state: "idle",
      csv_file_name: file.name,
      csv_total_rows: result.totalRows,
      csv_dropped_non_us: result.droppedNonUs,
      [ALL_US_JOBS_KEY]: allUsJobsCache,
      [JOB_CHANNEL_FILTER_KEY]: channelFilter || DEFAULT_CHANNEL_FILTER,
      [QUEUE_KEY]: []
    });
    batchState = "idle";
    await applyChannelFilter(channelFilter || DEFAULT_CHANNEL_FILTER);

    let dedupeNote = "";
    try {
      await persistJobFields();
      setStatus("Checking Google Sheet for jobs already bid…");
      const dedupe = await chrome.runtime.sendMessage({
        type: "dedupe_queue_against_sheet",
        notifySlack: true
      });
      const data = await chrome.storage.local.get(QUEUE_KEY);
      queueCache = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : queueCache;
      renderQueue();
      updateCsvSummaryFromQueue();
      await hydrateJobDirsInUi().catch(() => {});
      if (dedupe?.checked && dedupe.skipped > 0) {
        dedupeNote = ` Skipped ${dedupe.skipped} duplicate(s) already on the sheet.`;
      } else if (dedupe?.checked === false && dedupe?.error) {
        dedupeNote = ` (Sheet check failed: ${dedupe.error})`;
      } else if (dedupe?.checked === false && dedupe?.reason) {
        dedupeNote = ` (${dedupe.reason})`;
      }
    } catch (dupErr) {
      dedupeNote = ` (Sheet check failed: ${String(dupErr?.message || dupErr)})`;
    }

    setStatus(
      `Loaded ${result.totalRows} rows → ${result.usJobs.length} US (Dice ${result.diceCount || 0} / LI ${result.linkedInCount} / Indeed ${result.indeedCount || 0} / Etc ${result.etcCount ?? result.generalCount ?? 0}). Filter: ${channelFilter}.${dedupeNote}`
    );

    try {
      const fp = await fingerprintText(text);
      await saveCsvSourceSettings({
        lastFingerprint: fp,
        lastIngestAt: Date.now(),
        lastSource: "upload",
        lastStatus: `Manual upload: ${file.name}`
      });
    } catch {
      // best-effort fingerprint for later refresh skip
    }

    // File generation is fully automatic after upload — Start is only needed to resume.
    if (queueCache.some((j) => j.status === "pending" || j.status === "error" || j.status === "failed")) {
      await autoStartBatchAfterCsv();
    }
  } catch (err) {
    setStatus(`CSV parse failed: ${String(err.message || err)}`);
  }
}

async function autoStartBatchAfterCsv() {
  const person = await getActivePerson();
  if (!person.promptTemplate?.includes("{JD}")) {
    setStatus(
      `CSV loaded (${queueCache.length} in queue). Add {JD} to the tailor prompt, Save person, then click Start.`
    );
    return;
  }
  if (!person.masterResume?.trim() && person.promptTemplate.includes("{MASTER_RESUME}")) {
    setStatus(
      `CSV loaded (${queueCache.length} in queue). Upload/paste master resume, Save person, then click Start.`
    );
    return;
  }
  setStatus(`CSV loaded — starting file generation for ${queueCache.length} job(s)…`);
  await sendBatch("batch_start");
}

async function openJob(job) {
  if (!job?.jdLink) {
    setStatus("No JD link for this job.");
    return;
  }
  await chrome.runtime.sendMessage({ type: "open_job_url", url: job.jdLink });
}

async function revealJobFiles(job) {
  const res = await chrome.runtime.sendMessage({
    type: "reveal_job_files",
    csvRow: job.csvRow,
    jobDir: job.jobDir || "",
    jdLink: job.jdLink || ""
  });
  if (!res?.ok) {
    setStatus(res?.error || "Could not reveal files. Generate this job first.");
    return;
  }
  setStatus(`Revealed files for row ${job.csvRow}.`);
}

async function applyAssist(job) {
  if (!job?.jdLink) {
    setStatus("No JD link for this job.");
    return;
  }
  setStatus("Marking Applied on the Google Sheet…");
  const res = await chrome.runtime.sendMessage({
    type: "apply_job_url",
    url: job.jdLink,
    job: {
      csvRow: job.csvRow,
      jobDir: job.jobDir || "",
      jobTitle: job.title || job.jobTitle || "",
      title: job.title || "",
      companyName: job.company || job.companyName || "",
      company: job.company || "",
      jdLink: job.jdLink,
      jdText: job.jdText || "",
      salary: job.salary || ""
    }
  });
  if (res?.applied) {
    job.applied = true;
    job.appliedDate = res.appliedDate || formatApplicationDateTime();
    if (res.jobDir) job.jobDir = res.jobDir;
    if (res.resumeName) job.resumeName = res.resumeName;
    if (res.coverName) job.coverName = res.coverName;
    await persistQueue();
  }
  if (!res?.ok) {
    setStatus(
      `Opened job link. Autofill: ${res?.error || "focus the application tab and click Auto Apply."}`
    );
    return;
  }
  setStatus(res.status || "Apply started — sheet marked, filling the form in the job tab.");
}

async function sendBatch(type) {
  const outputDir = (outputDirEl.value || "").trim() || DEFAULT_OUTPUT_DIR;
  await chrome.storage.local.set({ output_dir: outputDir });
  const res = await chrome.runtime.sendMessage({ type, outputDir });
  if (!res?.ok) {
    setStatus(res?.error || `Batch ${type} failed.`);
    return;
  }
  if (type === "batch_start" || type === "batch_resume") {
    setStatus(
      `${res.status || "Batch started."} Tip: leave ChatGPT visible/focused — closing this popup helps auto-Send.`
    );
    return;
  }
  setStatus(res.status || `Batch ${type} ok.`);
}

async function retryOneJob(job) {
  if (!job || job.csvRow == null) return;
  const outputDir = (outputDirEl.value || "").trim() || DEFAULT_OUTPUT_DIR;
  setStatus(`Retrying row ${job.csvRow}…`);
  try {
    const res = await chrome.runtime.sendMessage({
      type: "retry_job",
      csvRow: job.csvRow,
      outputDir
    });
    if (!res?.ok) {
      setStatus(res?.error || `Retry row ${job.csvRow} failed.`);
      return;
    }
    // Optimistic UI update
    queueCache = queueCache.map((j) =>
      Number(j.csvRow) === Number(job.csvRow)
        ? { ...j, status: "pending", attempts: 0, error: "" }
        : j
    );
    renderQueue();
    updateCsvSummaryFromQueue();
    setStatus(res.status || `Row ${job.csvRow} queued for retry.`);
    await loadSettings().catch(() => {});
  } catch (err) {
    setStatus(`Retry failed: ${String(err?.message || err)}`);
  }
}

async function retryErrorJobs() {
  const errors = queueCache.filter((j) => j.status === "error" || j.status === "failed");
  if (!errors.length) {
    setStatus("No error jobs to retry.");
    return;
  }
  const outputDir = (outputDirEl.value || "").trim() || DEFAULT_OUTPUT_DIR;
  setStatus(`Retrying ${errors.length} error job(s)…`);
  try {
    const res = await chrome.runtime.sendMessage({
      type: "retry_error_jobs",
      outputDir
    });
    if (!res?.ok) {
      setStatus(res?.error || "Retry errors failed.");
      return;
    }
    queueCache = queueCache.map((j) =>
      j.status === "error" || j.status === "failed"
        ? { ...j, status: "pending", attempts: 0, error: "" }
        : j
    );
    renderQueue();
    updateCsvSummaryFromQueue();
    setStatus(res.status || `Queued ${errors.length} error job(s) for retry.`);
    await loadSettings().catch(() => {});
  } catch (err) {
    setStatus(`Retry errors failed: ${String(err?.message || err)}`);
  }
}

async function savePerson({ asNew = false, successMessage = "" } = {}) {
  // Keep the editor open so the user can see success/error next to the button.
  personPanelBody.hidden = false;
  togglePersonPanelBtn.setAttribute("aria-expanded", "true");

  const person = readPersonForm({ asNew });

  if (!person.label?.trim() && !person.name?.trim()) {
    setPersonSaveStatus("Enter a display name (or full name) before saving.", { ok: false });
    personLabelEl.focus();
    setStatus("Display name required to save person.");
    return null;
  }
  if (!person.promptTemplate?.trim()) {
    setPersonSaveStatus(
      "Paste your resume tailor prompt (ChatGPT instructions). Do not paste job descriptions here — those come from the CSV.",
      { ok: false }
    );
    personResumePromptEl.focus();
    setStatus("Resume tailor prompt is required.");
    return null;
  }
  if (!person.promptTemplate.includes("{JD}")) {
    setPersonSaveStatus(
      "Add the {JD} placeholder in your tailor prompt. The extension replaces it with each CSV job’s description automatically.",
      { ok: false }
    );
    personResumePromptEl.focus();
    setStatus("Add {JD} placeholder for auto CSV job descriptions.");
    return null;
  }
  if (!person.masterResume?.trim() && person.promptTemplate.includes("{MASTER_RESUME}")) {
    setPersonSaveStatus(
      "Your prompt uses {MASTER_RESUME}. Paste resume text or upload .txt / .pdf / .docx first.",
      { ok: false }
    );
    personMasterResumeEl.focus();
    setStatus("Master resume required for {MASTER_RESUME}.");
    return null;
  }

  // Auto-fill required employers from FIXED COMPANY HISTORY when the field is blank.
  if (!person.requiredExperience?.length) {
    const detected = parseRequiredExperienceFromPrompt(person.promptTemplate);
    if (detected.length) {
      person.requiredExperience = detected;
      personRequiredExperienceEl.value = requiredExperienceToText(detected);
    }
  }
  if ((person.requiredExperience || []).length < 1 && !person.masterResume?.trim()) {
    setPersonSaveStatus(
      "List required experience employers (one per line), or upload a master resume so they can be detected.",
      { ok: false }
    );
    personRequiredExperienceEl.focus();
    setStatus("Required experience employers needed.");
    return null;
  }

  savePersonBtn.disabled = true;
  savePersonAsNewBtn.disabled = true;
  setPersonSaveStatus("Saving…");
  try {
    let saved;
    let created = false;
    let fromBuiltin = false;

    if (asNew) {
      saved = await addCustomProfile({
        label: person.label || person.name,
        name: person.name || person.label,
        email: person.email,
        phone: person.phone,
        linkedin: person.linkedin,
        location: person.location,
        address: person.address,
        zip: person.zip,
        gender: person.gender,
        ethnicity: person.ethnicity,
        disability: person.disability,
        veteran: person.veteran,
        citizenship: person.citizenship,
        workAuthorized: person.workAuthorized,
        sponsorship: person.sponsorship,
        hispanicLatino: person.hispanicLatino,
        autofillExtras: person.autofillExtras,
        masterResume: person.masterResume,
        requiredExperience: person.requiredExperience,
        promptTemplate: person.promptTemplate,
        coverLetterPrompt: person.coverLetterPrompt,
        resumeFilePrefix: person.resumeFilePrefix,
        templateId: person.templateId,
        signatureTitle: person.signatureTitle
      });
      await setActivePersonId(saved.id);
      created = true;
    } else {
      const result = await savePersonProfile(person);
      // Support both new { profile, created } shape and legacy bare profile
      saved = result?.profile || result;
      created = Boolean(result?.created);
      fromBuiltin = Boolean(result?.fromBuiltin);
    }

    await chrome.storage.local.set({
      selected_template_id: person.templateId,
      resume_file_prefix: person.resumeFilePrefix || saved.resumeFilePrefix,
      selected_profile_id: saved.id,
      active_person_id: saved.id,
      experience_validation_rules: resolveExperienceRulesForPerson({
        ...saved,
        requiredExperience: person.requiredExperience || saved.requiredExperience
      }),
      experience_validation_person: saved.name || saved.label || ""
    });
    await syncOutputDirFromPerson(saved);
    await refreshProfiles(saved.id);
    fillPersonForm({ ...saved, builtin: false });

    let msg = successMessage;
    if (!msg) {
      if (asNew || created) {
        msg = fromBuiltin
          ? `Saved as your person “${saved.label}” (custom). It is now the Active person.`
          : `Created “${saved.label}” and set it as Active person.`;
      } else {
        msg = `Saved changes for “${saved.label}”. Ready to run CSV batch.`;
      }
    }
    setPersonSaveStatus(msg, { ok: true });
    setStatus(msg);
    return saved;
  } catch (err) {
    const message = String(err.message || err);
    setPersonSaveStatus(message, { ok: false });
    setStatus(message);
    return null;
  } finally {
    savePersonBtn.disabled = false;
    savePersonAsNewBtn.disabled = false;
    syncSaveButtonLabels();
  }
}

async function onMasterResumeFile(file) {
  if (!file) return;
  masterResumeFileHintEl.textContent = `Reading ${file.name}…`;
  setPersonImportNotice(`Reading ${file.name}…`);
  try {
    const { text, fileName } = await extractMasterResumeFromFile(file);
    await importPersonFromResumeText(text, { sourceLabel: fileName });
    masterResumeFileHintEl.textContent = `Loaded ${fileName} (${text.length} chars) and applied to this person.`;
    if (personResumeFileEl) personResumeFileEl.value = "";
  } catch (err) {
    const message = String(err.message || err);
    masterResumeFileHintEl.textContent = message;
    setPersonImportNotice(message, { ok: false });
    setStatus(message);
  }
}

async function loadPresetIntoEditor() {
  const id = presetSelectEl.value;
  if (!id) {
    setStatus("Pick a built-in preset first.");
    return;
  }
  const preset = getBuiltinPreset(id);
  if (!preset) {
    setStatus("Preset not found.");
    return;
  }
  fillPersonForm({
    ...preset,
    id:
      editingPersonId && !BUILTIN_PROFILES.some((b) => b.id === editingPersonId)
        ? editingPersonId
        : preset.id
  });
  personPanelBody.hidden = false;
  togglePersonPanelBtn.setAttribute("aria-expanded", "true");
  setStatus(`Loaded preset "${preset.label}" into editor. Add/upload master resume text, then Save person.`);
}

async function removeSelectedProfile() {
  const profileId = profileSelectEl.value;
  const selected = profilesCache.find((p) => p.id === profileId);
  if (!selected || selected.builtin) {
    setStatus("Built-in profiles cannot be deleted.");
    return;
  }
  if (!window.confirm(`Delete person "${selected.label}"?`)) return;
  try {
    await deleteCustomProfile(profileId);
    await refreshProfiles(DEFAULT_PROFILE_ID);
    await loadActivePersonIntoForm();
    setStatus(`Deleted: ${selected.label}`);
  } catch (err) {
    setStatus(String(err.message || err));
  }
}

async function onProfileChange() {
  const profileId = profileSelectEl.value;
  syncDeleteButton();
  syncActivePersonChip();
  await setActivePersonId(profileId);
  await loadActivePersonIntoForm();
  const person = await getActivePerson();
  const rules = resolveExperienceRulesForPerson(person);
  await chrome.storage.local.set({
    resume_file_prefix: person.resumeFilePrefix || "Resume",
    experience_validation_rules: rules,
    experience_validation_person: person.name || person.label || ""
  });
}

async function readClipboardText() {
  return (await navigator.clipboard.readText()).trim();
}

async function pasteJdFromClipboard() {
  try {
    const jd = await readClipboardText();
    if (!jd) {
      setStatus("Clipboard is empty.");
      return;
    }
    jdTextEl.value = jd;
    await persistJobFields();
    setStatus("JD pasted from clipboard.");
  } catch {
    setStatus("Clipboard read failed. Paste JD into the text field manually.");
  }
}

async function copyAppsScript() {
  try {
    await navigator.clipboard.writeText(APPS_SCRIPT_SOURCE);
    setStatus("Apps Script copied.");
  } catch {
    setStatus("Could not copy. Open apps-script/Code.gs instead.");
  }
}

async function copySheetRow() {
  const jobTitle = (jobTitleEl.value || "").trim();
  const companyName = (companyNameEl.value || "").trim();
  const jdLink = (jdLinkEl.value || "").trim();
  if (!jobTitle && !companyName && !jdLink) {
    setStatus("Fill job title, company, and/or JD link before copying.");
    return;
  }
  const tsv = buildSheetRowTsv({
    jobNo: "",
    jobTitle,
    companyName,
    jdLink,
    includeDate: true
  });
  try {
    await navigator.clipboard.writeText(tsv);
    setStatus("Sheet row copied (No | Date | Title | Company | Link).");
  } catch {
    setStatus("Clipboard write failed.");
  }
}

async function testSlackWebhook() {
  const webhookUrl = slackWebhookUrlEl.value.trim();
  if (!webhookUrl) {
    setStatus("Paste a Slack Incoming Webhook URL first.");
    return;
  }
  if (!isSlackWebhookUrl(webhookUrl)) {
    setStatus("URL must look like https://hooks.slack.com/services/...");
    return;
  }
  await persistJobFields();
  setStatus("Sending Slack test…");
  try {
    const person = await getActivePerson();
    await notifySlackBatchComplete({
      webhookUrl,
      done: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      personLabel: person?.label || person?.name || "(test)",
      outputDir: outputDirEl.value.trim() || DEFAULT_OUTPUT_DIR,
      isTest: true
    });
    setStatus("Slack test sent — check your channel.");
  } catch (err) {
    setStatus(`Slack test failed: ${String(err?.message || err)}`);
  }
}

async function openTemplatePreview() {
  const templateId = templateSelectEl.value || DEFAULT_TEMPLATE_ID;
  const url = chrome.runtime.getURL(`preview.html?template=${encodeURIComponent(templateId)}`);
  const stored = (await chrome.storage.local.get(PREVIEW_WINDOW_KEY))[PREVIEW_WINDOW_KEY];
  if (stored != null) {
    try {
      await chrome.windows.update(stored, { focused: true, drawAttention: true });
      await chrome.runtime.sendMessage({ type: "template_preview_show", templateId }).catch(() => {});
      const template = templatesCache.find((t) => t.id === templateId);
      setStatus(`Previewing ${template?.label || "resume style"}…`);
      return;
    } catch {
      // Window was closed.
    }
  }
  const created = await chrome.windows.create({
    url,
    type: "popup",
    width: 980,
    height: 1040
  });
  await chrome.storage.local.set({ [PREVIEW_WINDOW_KEY]: created.id });
  const template = templatesCache.find((t) => t.id === templateId);
  setStatus(`Opened preview for ${template?.label || "resume style"}.`);
}

async function openDetachedWindow() {
  const stored = (await chrome.storage.local.get(DETACHED_WINDOW_KEY))[DETACHED_WINDOW_KEY];
  if (stored != null) {
    try {
      await chrome.windows.update(stored, { focused: true, drawAttention: true });
      window.close();
      return;
    } catch {
      // Remembered window was closed — fall through and make a new one.
    }
  }
  const created = await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?ctx=window"),
    type: "popup",
    width: 560,
    height: 780
  });
  await chrome.storage.local.set({ [DETACHED_WINDOW_KEY]: created.id });
  window.close();
}

function dockOutOfPopup() {
  const detach = () =>
    openDetachedWindow().catch((err) =>
      setStatus(`Could not keep the bot open: ${String(err?.message || err)}`)
    );

  if (currentWindowId == null || typeof chrome.sidePanel?.open !== "function") {
    detach();
    return;
  }

  // sidePanel.open() only works inside the click gesture, so it must not be
  // preceded by an await.
  Promise.resolve(chrome.sidePanel.open({ windowId: currentWindowId }))
    .then(() => window.close())
    .catch(detach);
}

function setBusy(busy) {
  batchStartBtn.disabled = busy && batchState === "running";
  runOneOffBtn.disabled = busy;
  document.body.classList.toggle("is-busy", Boolean(busy));
  syncBatchPill();
}

async function runOneOff() {
  const jobTitle = (jobTitleEl.value || "").trim();
  const companyName = (companyNameEl.value || "").trim();
  const jd = (jdTextEl.value || "").trim();
  const jdLink = (jdLinkEl.value || "").trim();
  const outputDir = (outputDirEl.value || "").trim() || DEFAULT_OUTPUT_DIR;

  if (!jobTitle) {
    setStatus("Enter a job title first.");
    return;
  }
  if (!companyName) {
    setStatus("Enter a company name first.");
    return;
  }
  if (!jd) {
    setStatus("Paste a job description first.");
    return;
  }

  const person = await getActivePerson();
  if (!person.promptTemplate?.includes("{JD}")) {
    setStatus("Active person needs a tailor prompt with {JD} (auto-filled from each CSV job). Open the person editor.");
    return;
  }
  if (!person.masterResume?.trim() && person.promptTemplate.includes("{MASTER_RESUME}")) {
    setStatus("Upload or paste a master resume (text/PDF/DOCX) — not JSON.");
    return;
  }

  await persistJobFields();
  setBusy(true);
  setStatus("Starting one-off generation (auto — no JSON paste)…");

  const res = await chrome.runtime.sendMessage({
    type: "run_one_off",
    jobMeta: {
      jobTitle,
      companyName,
      jdLink,
      jdText: jd,
      outputDir,
      spreadsheetUrl: spreadsheetUrlEl.value.trim(),
      sheetsWebAppUrl: sheetsWebAppUrlEl.value.trim(),
      templateId: templateSelectEl.value || person.templateId || DEFAULT_TEMPLATE_ID,
      resumeFilePrefix: person.resumeFilePrefix || "Resume",
      profileId: person.id,
      bidSource: "one-off"
    }
  });

  if (!res?.ok) {
    setStatus(res?.error || "One-off failed to start.");
    setBusy(false);
    return;
  }

  setManualPanelOpen(false);
}

async function refreshQaBank() {
  if (!qaBankNoteEl) return;
  try {
    const profileId = profileSelectEl?.value || "";
    const [profileCount, sharedCount] = await Promise.all([
      getQaCount(profileId),
      getQaCount("")
    ]);
    const parts = [];
    if (profileCount) parts.push(`${profileCount} this person`);
    if (sharedCount) parts.push(`${sharedCount} shared`);
    qaBankNoteEl.textContent = parts.length ? parts.join(" · ") : "0 saved";
  } catch {
    qaBankNoteEl.textContent = "Q&A";
  }
}

function activePersonLabel() {
  return profilesCache.find((p) => p.id === profileSelectEl.value)?.label || "active person";
}

async function openQaEditor() {
  const url = new URL(chrome.runtime.getURL("qa-editor.html"));
  const profileId = profileSelectEl?.value || "";
  if (profileId) url.searchParams.set("profileId", profileId);
  const href = url.toString();
  try {
    const win = await chrome.windows.create({
      url: href,
      type: "popup",
      width: 980,
      height: 860,
      focused: true
    });
    if (win?.id != null) await chrome.windows.update(win.id, { focused: true });
    setStatus("Opened Q&A editor.");
  } catch {
    await chrome.tabs.create({ url: href, active: true });
    setStatus("Opened Q&A editor in a tab.");
  }
}

function downloadQaJson(rows, suffix) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `qa-bank-${suffix || "export"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportActiveQaBank() {
  const profileId = profileSelectEl?.value || "";
  const rows = await exportQa(profileId);
  downloadQaJson(rows, profileId || "shared");
  setStatus(`Exported ${rows.length} Q&A ${rows.length === 1 ? "entry" : "entries"} for ${activePersonLabel()}.`);
}

async function importQaRecords(records, sourceLabel) {
  const list = parseQaBankPayload(records);
  const profileId = profileSelectEl?.value || "";
  const target = activePersonLabel();
  const ok = window.confirm(
    `Import ${list.length} answer${list.length === 1 ? "" : "s"} from ${sourceLabel} into ${target}?\n\n` +
      "Leftover form questions will reuse these answers before calling OpenAI. " +
      "Identity answers in the file (name, phone, LinkedIn) will apply to this person."
  );
  if (!ok) return;
  const count = await importQa(list, { remapProfileId: profileId });
  await refreshQaBank();
  setStatus(`Imported ${count} Q&A ${count === 1 ? "entry" : "entries"} into ${target}.`);
}

async function importQaFromFile(file) {
  if (!file) return;
  const parsed = JSON.parse(await file.text());
  await importQaRecords(parsed, file.name || "JSON file");
}

async function importBundledQaBank() {
  const records = await loadBundledQaBank();
  await importQaRecords(records, "the bundled Steven Avon bank");
}

async function autofillThisPage() {
  setStatus("Autofilling the current page…");
  const res = await chrome.runtime.sendMessage({ type: "autofill_active_tab" });
  if (!res?.ok) {
    setStatus(res?.error || "Autofill failed. Focus the application tab first.");
    return;
  }
  const filled = res.filled || res.filledCount || 0;
  const uploaded = res.uploaded || res.uploadedCount || 0;
  setStatus(
    `Autofilled ${filled} field(s)` +
      (uploaded ? `, uploaded ${uploaded} file(s)` : "") +
      " on the active page."
  );
}

async function autoApplyThisPage() {
  setStatus("Auto Apply: filling and advancing steps (stops before Submit)…");
  const res = await chrome.runtime.sendMessage({ type: "autofill_multi_step" });
  if (!res?.ok) {
    setStatus(res?.error || "Auto Apply failed. Focus the application tab first.");
    return;
  }
  setStatus(res.status || res.detail || `Auto Apply filled ${res.filled || 0} field(s). Review and submit.`);
}

async function clearJobsList({ confirmPrompt = true } = {}) {
  if (confirmPrompt) {
    const n = queueCache.length || allUsJobsCache.length;
    const ok = window.confirm(
      n
        ? `Clear all ${n} job(s) from the list? This cannot be undone.`
        : "Clear the job list and CSV state?"
    );
    if (!ok) return false;
  }

  try {
    // Stop any running batch first so it doesn't re-write queue items.
    await chrome.runtime.sendMessage({ type: "batch_stop" }).catch(() => {});
    await chrome.runtime.sendMessage({ type: "clear_job_queue" }).catch(() => {});
  } catch {
    // continue with local clear
  }

  queueCache = [];
  allUsJobsCache = [];
  batchState = "idle";
  if (csvFileEl) csvFileEl.value = "";

  await chrome.storage.local.set({
    [QUEUE_KEY]: [],
    [ALL_US_JOBS_KEY]: [],
    [BATCH_STATE_KEY]: "idle",
    csv_file_name: "",
    csv_total_rows: 0,
    csv_dropped_non_us: 0,
    generation_running: false,
    generation_status: "Job list cleared."
  });

  renderQueue();
  updateCsvSummaryFromQueue();
  setBusy(false);
  setStatus("Job list cleared. Upload a CSV to start again.");
  return true;
}

async function resetWorkflow() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "reset_generation_state" });
    if (!res?.ok) throw new Error(res?.error || "Failed to reset.");
    batchState = "idle";
    await clearJobsList({ confirmPrompt: false });
    setStatus("Reset complete. Job list cleared — ready for a new CSV.");
    setBusy(false);
  } catch (err) {
    setStatus(`Reset failed: ${String(err.message || err)}`);
  }
}

// Events
profileSelectEl.addEventListener("change", () => {
  syncActivePersonChip();
  onProfileChange().catch((e) => setStatus(String(e.message || e)));
  refreshQaBank().catch(() => {});
});

templateSelectEl.addEventListener("change", () => {
  const templateId = templateSelectEl.value;
  chrome.storage.local.set({ selected_template_id: templateId }).catch(() => {});
  chrome.runtime.sendMessage({ type: "template_preview_show", templateId }).catch(() => {});
});

function setManualPanelOpen(open, { persist = true } = {}) {
  const isOpen = Boolean(open);
  manualPanelBody.hidden = !isOpen;
  toggleManualPanelBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  toggleManualPanelBtn.textContent = isOpen ? "Hide one-off job form" : "Expand one-off job form";
  if (persist) {
    chrome.storage.local.set({ [MANUAL_PANEL_OPEN_KEY]: isOpen }).catch(() => {});
  }
}

togglePersonPanelBtn.addEventListener("click", () => {
  const open = personPanelBody.hidden;
  personPanelBody.hidden = !open;
  togglePersonPanelBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) syncSaveButtonLabels();
});

toggleManualPanelBtn.addEventListener("click", () => {
  setManualPanelOpen(manualPanelBody.hidden);
});

loadPresetBtn.addEventListener("click", () => loadPresetIntoEditor().catch((e) => setStatus(String(e.message || e))));
savePersonBtn.addEventListener("click", () => savePerson({ asNew: false }));
savePersonAsNewBtn.addEventListener("click", () => savePerson({ asNew: true }));
deleteProfileBtn.addEventListener("click", () => removeSelectedProfile());

detectRequiredExperienceBtn?.addEventListener("click", () => {
  const fromPrompt = parseRequiredExperienceFromPrompt(personResumePromptEl.value);
  const fromResume = parseEmployersFromResume(personMasterResumeEl.value);
  const detected = fromPrompt.length ? fromPrompt : fromResume;
  if (!detected.length) {
    setPersonSaveStatus(
      "No employers found. Upload a resume, or type companies manually (one per line).",
      { ok: false }
    );
    return;
  }
  personRequiredExperienceEl.value = requiredExperienceToText(detected);
  setPersonSaveStatus(
    `Detected ${detected.length} employer entr${detected.length === 1 ? "y" : "ies"} from the ${fromPrompt.length ? "prompt" : "resume"}.`,
    { ok: true }
  );
});

clearMasterResumeBtn.addEventListener("click", () => {
  personMasterResumeEl.value = "";
  if (personResumeFileEl) personResumeFileEl.value = "";
  if (masterResumeFileHintEl) masterResumeFileHintEl.textContent = "";
});
replaceResumeFromFileBtn?.addEventListener("click", () => {
  personResumeFileEl?.click();
});
personResumeFileEl?.addEventListener("change", () => {
  const file = personResumeFileEl.files?.[0];
  onMasterResumeFile(file).catch((e) => setStatus(String(e.message || e)));
});
personMasterResumeEl?.addEventListener("paste", () => {
  window.setTimeout(() => {
    const text = String(personMasterResumeEl.value || "").trim();
    if (text.length < 80) return;
    importPersonFromResumeText(text, { sourceLabel: "pasted resume" }).catch((e) => {
      setPersonImportNotice(String(e.message || e), { ok: false });
      setStatus(String(e.message || e));
    });
  }, 0);
});

csvFileEl.addEventListener("change", () => {
  const file = csvFileEl.files?.[0];
  onCsvSelected(file).catch((e) => setStatus(String(e.message || e)));
});

csvRefreshBtn?.addEventListener("click", () => {
  refreshCsvFromSources().catch((e) => setStatus(String(e.message || e)));
});
csvPinFileBtn?.addEventListener("click", () => {
  pinLocalCsvFile().catch((e) => setStatus(String(e.message || e)));
});
toggleCsvSourcePanelBtn?.addEventListener("click", () => {
  setCsvSourcePanelOpen(Boolean(csvSourcePanelBody?.hidden));
});
csvSourceSaveBtn?.addEventListener("click", () => {
  saveCsvSourceForm().catch((e) => setStatus(String(e.message || e)));
});
csvClearPinBtn?.addEventListener("click", () => {
  clearPinnedCsv().catch((e) => setStatus(String(e.message || e)));
});

filterDiceBtn?.addEventListener("click", () => {
  applyChannelFilter("dice").catch((e) => setStatus(String(e.message || e)));
});
filterLinkedInBtn?.addEventListener("click", () => {
  applyChannelFilter("linkedin").catch((e) => setStatus(String(e.message || e)));
});
filterIndeedBtn?.addEventListener("click", () => {
  applyChannelFilter("indeed").catch((e) => setStatus(String(e.message || e)));
});
filterEtcBtn?.addEventListener("click", () => {
  applyChannelFilter("etc").catch((e) => setStatus(String(e.message || e)));
});
filterAllBtn?.addEventListener("click", () => {
  applyChannelFilter("all").catch((e) => setStatus(String(e.message || e)));
});
indeedCaptureStartBtn?.addEventListener("click", () => {
  startIndeedCapture().catch((e) => setStatus(`Indeed capture failed: ${String(e.message || e)}`));
});
indeedCaptureStopBtn?.addEventListener("click", () => {
  stopIndeedCapture().catch((e) => setStatus(`Indeed stop failed: ${String(e.message || e)}`));
});

batchStartBtn.addEventListener("click", () => sendBatch("batch_start"));
batchPauseBtn.addEventListener("click", () => sendBatch("batch_pause"));
batchSkipBtn.addEventListener("click", () => sendBatch("batch_skip"));
batchStopBtn.addEventListener("click", () => sendBatch("batch_stop"));
clearJobsBtn?.addEventListener("click", () => {
  clearJobsList({ confirmPrompt: true }).catch((e) => setStatus(String(e.message || e)));
});
retryErrorsBtn?.addEventListener("click", () => {
  retryErrorJobs().catch((e) => setStatus(String(e.message || e)));
});
forceSaveChatgptBtn.addEventListener("click", async () => {
  setStatus("Reading resume JSON from ChatGPT…");
  try {
    const res = await chrome.runtime.sendMessage({ type: "force_save_chatgpt_resume" });
    if (!res?.ok) {
      setStatus(res?.error || "Force-save failed.");
      return;
    }
    setStatus(res.status || "Force-save started.");
    await loadSettings();
  } catch (err) {
    setStatus(`Force-save failed: ${String(err?.message || err)}`);
  }
});

pasteJdBtn.addEventListener("click", pasteJdFromClipboard);
copyAppsScriptBtn.addEventListener("click", copyAppsScript);
copySheetRowBtn.addEventListener("click", copySheetRow);
keepOpenBtn.addEventListener("click", dockOutOfPopup);
previewTemplateBtn?.addEventListener("click", () => {
  openTemplatePreview().catch((e) => setStatus(String(e.message || e)));
});
testSlackBtn.addEventListener("click", testSlackWebhook);
runOneOffBtn.addEventListener("click", runOneOff);
autofillPageBtn.addEventListener("click", autofillThisPage);
autoApplyPageBtn.addEventListener("click", autoApplyThisPage);
resetBtn.addEventListener("click", resetWorkflow);
qaOpenEditorBtn?.addEventListener("click", () => {
  openQaEditor().catch((e) => setStatus(String(e.message || e)));
});
qaImportBundledBtn?.addEventListener("click", () => {
  importBundledQaBank().catch((e) => setStatus(`Bundled import failed: ${String(e.message || e)}`));
});
qaImportBtn?.addEventListener("click", () => qaImportInput?.click());
qaImportInput?.addEventListener("change", () => {
  const file = qaImportInput.files?.[0];
  importQaFromFile(file)
    .catch((e) => setStatus(`Import failed: ${String(e.message || e)}`))
    .finally(() => {
      if (qaImportInput) qaImportInput.value = "";
    });
});
qaExportBtn?.addEventListener("click", () => {
  exportActiveQaBank().catch((e) => setStatus(String(e.message || e)));
});
qaLearnToggleEl?.addEventListener("change", () => {
  chrome.storage.local.set({ qa_learn_enabled: Boolean(qaLearnToggleEl.checked) }).catch(() => {});
});

for (const el of [
  jobTitleEl,
  companyNameEl,
  jdLinkEl,
  jdTextEl,
  outputDirEl,
  spreadsheetUrlEl,
  sheetsWebAppUrlEl,
  slackWebhookUrlEl,
  chatgptJobGapSecEl,
  chatgptHardPauseHitsEl
].filter(Boolean)) {
  el.addEventListener("change", () => {
    persistJobFields().catch(() => {});
  });
}

if (UI_CONTEXT === "popup") {
  chrome.windows
    .getCurrent()
    .then((win) => {
      currentWindowId = win?.id ?? null;
    })
    .catch(() => {});
} else {
  keepOpenBtn.hidden = true;
}

loadSettings().catch((err) => setStatus(`Init failed: ${String(err.message || err)}`));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.qa_bank_version) refreshQaBank().catch(() => {});
  if (changes.qa_learn_enabled && qaLearnToggleEl && changes.qa_learn_enabled.newValue !== undefined) {
    qaLearnToggleEl.checked = changes.qa_learn_enabled.newValue !== false;
  }
  if (changes.selected_template_id && templateSelectEl) {
    const next = changes.selected_template_id.newValue;
    if (next && templateSelectEl.value !== next) {
      templateSelectEl.value = next;
    }
  }
  if (changes[INDEED_CAPTURE_STATE_KEY]) {
    renderIndeedCaptureState(changes[INDEED_CAPTURE_STATE_KEY].newValue);
  }
});

setInterval(async () => {
  const data = await chrome.storage.local.get([
    "generation_status",
    "generation_running",
    QUEUE_KEY,
    ALL_US_JOBS_KEY,
    BATCH_STATE_KEY,
    INDEED_CAPTURE_STATE_KEY,
    "csv_source_settings"
  ]);
  batchState = data[BATCH_STATE_KEY] || "idle";
  renderIndeedCaptureState(data[INDEED_CAPTURE_STATE_KEY]);
  setBusy(Boolean(data.generation_running) || batchState === "running");
  if (typeof data.generation_status === "string") {
    setStatus(data.generation_status);
  }
  if (Array.isArray(data[ALL_US_JOBS_KEY])) {
    allUsJobsCache = data[ALL_US_JOBS_KEY];
  }
  if (Array.isArray(data[QUEUE_KEY])) {
    const prevByRow = new Map(queueCache.map((j) => [Number(j.csvRow), j]));
    queueCache = data[QUEUE_KEY].map((j) => {
      const prev = prevByRow.get(Number(j.csvRow));
      return {
        ...j,
        applied: Boolean(j.applied || prev?.applied),
        appliedDate: j.appliedDate || prev?.appliedDate || "",
        resumeName: j.resumeName || prev?.resumeName || "",
        coverName: j.coverName || prev?.coverName || ""
      };
    });
    renderQueue();
    updateCsvSummaryFromQueue();
  } else {
    followQueueToCurrentWork();
  }
  if (data.csv_source_settings && csvSourceStatusEl) {
    const s = data.csv_source_settings;
    const when = s.lastIngestAt ? new Date(s.lastIngestAt).toLocaleString() : "";
    if (s.lastStatus) {
      csvSourceStatusEl.textContent = `${s.lastStatus}${when ? ` · ${when}` : ""}`;
    }
  }
}, 1200);

// silence unused import warning path for extractSpreadsheetId when sheets hidden
void extractSpreadsheetId;
