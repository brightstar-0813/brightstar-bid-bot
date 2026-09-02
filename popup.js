import {
  DEFAULT_PROFILE_ID,
  DEFAULT_ATS_PASSWORD,
  getResumeProfiles,
  getActivePerson,
  getActivePersonId,
  setActivePersonId,
  savePersonProfile,
  addCustomProfile,
  deleteCustomProfile,
  getTrackPromptTemplate,
  getTrackCoverLetterTemplate,
  resolveRoleTrackForPerson,
  resolvePromptTemplateForTrack,
  resolveCoverLetterTemplateForTrack,
  normalizeRequiredExperienceInput,
  parseRequiredExperienceFromPrompt,
  resolveExperienceRulesForPerson,
  setPersonSheetConfig
} from "./profiles.js";
import {
  getSessionRoleTrack,
  setSessionRoleTrack,
  getRoleTrack,
  isTrackDefaultPrompt,
  isTrackDefaultCoverLetter,
  normalizeRoleTrackId,
  SESSION_ROLE_TRACK_KEY
} from "./role-tracks.js";
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
  isJobrightJob,
  isWorkdayJob,
  isGreenhouseJob,
  isAshbyJob,
  isLeverJob,
  normalizeChannelFilter
} from "./csv.js";
import { extractMasterResumeFromFile, MASTER_RESUME_ACCEPT } from "./master-resume-file.js";
import {
  AI_PROVIDER_KEY,
  AI_PROVIDERS,
  aiProviderLabel,
  normalizeAiProvider
} from "./ai-provider.js";
import {
  extractProfileFromResumeText,
  parseEmployersFromResume,
  resumeFilePrefixFromName,
  outputDirFromPerson,
  namesLikelyDifferent
} from "./resume-profile.js";
import {
  mergeExtractedProfileIntoPerson,
  isEditingBuiltin as isBuiltinPersonId
} from "./person-profile-form.js";
import { createInlineProfileEditor } from "./inline-profile-editor.js";
import {
  saveCsvFileHandle,
  clearCsvFileHandle,
  readPinnedCsvText
} from "./file-handle-db.js";
import {
  getCsvSourceSettings,
  fingerprintText,
  jobIdentity,
  saveCsvSourceSettings
} from "./csv-source.js";
import {
  getQaCount,
  exportQa,
  importQa,
  parseQaBankPayload,
  loadBundledQaBank
} from "./qa-store.js";
import { formatAutofillSummary } from "./autofill-summary.js";
import { mountThemeSwatches } from "./theme.js";
import { confirmDialog } from "./ui-dialog.js";

const DEFAULT_OUTPUT_DIR = "Applications";
const QUEUE_KEY = "job_queue";
const ALL_US_JOBS_KEY = "all_us_jobs";
const JOB_CHANNEL_FILTER_KEY = "job_channel_filter";
const REMOVED_JOB_IDENTITIES_KEY = "removed_job_identities";
const BATCH_STATE_KEY = "batch_state";
const DEFAULT_CHANNEL_FILTER = "dice";
const MANUAL_PANEL_OPEN_KEY = "manual_panel_open";
const PROFILE_EDITOR_PANEL_OPEN_KEY = "profile_editor_panel_open";
const PREVIEW_WINDOW_KEY = "template_preview_window_id";
const INDEED_CAPTURE_STATE_KEY = "indeed_capture_state"; // legacy; cleared on reset
const INDEED_GRAB_STATUS_KEY = "indeed_grab_status";

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
 * Dedup: same job link (normalized) is treated as duplicate.
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
const templateSelectEl = document.getElementById("templateSelect");
const deleteProfileBtn = document.getElementById("deleteProfile");
const personResumeFileEl = document.getElementById("personResumeFile");
const personImportNoticeEl = document.getElementById("personImportNotice");
const toggleProfileEditorPanelBtn = document.getElementById("toggleProfileEditorPanel");
const profileEditorPanelBody = document.getElementById("profileEditorPanelBody");
const inlineProfileEditorEl = document.getElementById("inlineProfileEditor");
const activeRoleTrackBtns = Array.from(
  document.querySelectorAll("#personSection .role-track-btn")
);

let inlineProfileEditor = null;
if (inlineProfileEditorEl && profileEditorPanelBody) {
  inlineProfileEditor = createInlineProfileEditor({
    panelEl: inlineProfileEditorEl,
    panelBodyEl: profileEditorPanelBody,
    toggleBtn: toggleProfileEditorPanelBtn,
    setStatus,
    setPanelOpen: (open) => {
      chrome.storage.local.set({ [PROFILE_EDITOR_PANEL_OPEN_KEY]: open }).catch(() => {});
    },
    onSaved: async (saved) => {
      if (!saved?.id) return;
      await refreshProfiles(saved.id);
      await syncPersonContext(saved);
    },
    onClose: async () => {
      const id = await getActivePersonId().catch(() => profileSelectEl?.value);
      await refreshProfiles(id);
      const person = profilesCache.find((p) => p.id === id) || (await getActivePerson());
      if (person) await syncPersonContext(person);
    }
  });
}

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
const filterJobrightBtn = document.getElementById("filterJobright");
const filterWorkdayBtn = document.getElementById("filterWorkday");
const filterGreenhouseBtn = document.getElementById("filterGreenhouse");
const filterAshbyBtn = document.getElementById("filterAshby");
const filterLeverBtn = document.getElementById("filterLever");
const filterEtcBtn = document.getElementById("filterEtc");
const filterAllBtn = document.getElementById("filterAll");
const diceInterleaveHintEl = document.getElementById("diceInterleaveHint");
const indeedGrabApplyBtn = document.getElementById("indeedGrabApply");
const indeedGrabOnlyBtn = document.getElementById("indeedGrabOnly");
const indeedGrabStateEl = document.getElementById("indeedGrabState");
const indeedGrabStatusEl = document.getElementById("indeedGrabStatus");
const toggleIntegrationsPanelBtn = document.getElementById("toggleIntegrationsPanel");
const integrationsPanelBody = document.getElementById("integrationsPanelBody");
const jobsSectionEl = document.getElementById("jobsSection");

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
const aiProviderChatgptBtn = document.getElementById("aiProviderChatgpt");
const aiProviderClaudeBtn = document.getElementById("aiProviderClaude");
const aiProviderStateEl = document.getElementById("aiProviderState");
let aiProviderCache = AI_PROVIDERS.CHATGPT;
const DEFAULT_CHATGPT_GAP_SEC = 45;
const DEFAULT_CHATGPT_HARD_PAUSE = 3;
const copySheetRowBtn = document.getElementById("copySheetRow");
const keepOpenBtn = document.getElementById("keepOpen");
const openAsWindowBtn = document.getElementById("openAsWindow");
const previewTemplateBtn = document.getElementById("previewTemplate");
const pasteJdBtn = document.getElementById("pasteJd");
const runOneOffBtn = document.getElementById("runOneOff");
const autofillPageBtn = document.getElementById("autofillPage");
const autoApplyPageBtn = document.getElementById("autoApplyPage");
const resetBtn = document.getElementById("reset");
const qaBankNoteEl = document.getElementById("qaBankNote");
const qaLearnToggleEl = document.getElementById("qaLearnToggle");
const allowSubmitToggleEl = document.getElementById("allowSubmitToggle");
const autofillEnabledToggleEl = document.getElementById("autofillEnabledToggle");
const qaOpenEditorBtn = document.getElementById("qaOpenEditorBtn");
const qaImportBundledBtn = document.getElementById("qaImportBundledBtn");
const qaImportBtn = document.getElementById("qaImportBtn");
const qaExportBtn = document.getElementById("qaExportBtn");
const qaImportInput = document.getElementById("qaImportInput");
const themeSwatchesEl = document.getElementById("themeSwatches");

let profilesCache = [];
let templatesCache = [];
let queueCache = [];
let lastStatusText = "";
let lastQueueFollowRow = null;
let queueListScrollTop = 0;
let queueScrollProgrammatic = false;
let allUsJobsCache = [];
let channelFilter = DEFAULT_CHANNEL_FILTER;
let batchState = "idle";
let editingPersonId = null;
let autofillEnabledCache = true;

const AUTOFILL_ENABLED_KEY = "autofill_enabled";

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

function setActiveRoleTrackUi(track) {
  const active = normalizeRoleTrackId(track);
  for (const btn of activeRoleTrackBtns) {
    const isActive = btn.dataset.track === active;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}

async function syncActiveTrackUi({ savedTrack } = {}) {
  if (!activeRoleTrackBtns.length) return;
  const sessionTrack = await getSessionRoleTrack();
  const activeTrack = sessionTrack || savedTrack || readActiveRoleTrack();
  setActiveRoleTrackUi(activeTrack);
}

function applyTrackTemplatesToForm(_roleTrack, _person) {
  /* Prompts live in profile editor — session track only in popup. */
}

async function applyActiveRoleTrackChange({ track: nextTrack } = {}) {
  const track = normalizeRoleTrackId(nextTrack ?? readActiveRoleTrack());
  const person = profilesCache.find((p) => p.id === profileSelectEl.value) || (await getActivePerson());
  const savedTrack = resolveRoleTrackForPerson(person);

  setActiveRoleTrackUi(track);
  await setSessionRoleTrack(track);
  await syncActiveTrackUi({ savedTrack });
  const label = getRoleTrack(track).label;
  setStatus(track === savedTrack ? `Track: ${label}` : `Track: ${label} (session only)`);
}

async function resetActiveTrackForPerson(person) {
  const savedTrack = resolveRoleTrackForPerson(person);
  await setSessionRoleTrack(savedTrack);
  setActiveRoleTrackUi(savedTrack);
  await syncActiveTrackUi({ savedTrack });
}

function syncAutofillUi(enabled = autofillEnabledCache) {
  autofillEnabledCache = Boolean(enabled);
  if (autofillEnabledToggleEl) autofillEnabledToggleEl.checked = autofillEnabledCache;
  if (autofillPageBtn) autofillPageBtn.disabled = !autofillEnabledCache;
  if (autoApplyPageBtn) autoApplyPageBtn.disabled = !autofillEnabledCache;
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

function ensurePromptsOnPerson(person, { resetEeo = false } = {}) {
  const next = { ...person };
  const track = next.roleTrack || readActiveRoleTrack();
  if (
    resetEeo ||
    !String(next.promptTemplate || "").trim() ||
    !next.promptTemplate.includes("{JD}") ||
    isTrackDefaultPrompt(next.promptTemplate)
  ) {
    next.promptTemplate = getTrackPromptTemplate(track, next);
  }
  const cover = String(next.coverLetterPrompt || "");
  if (
    resetEeo ||
    !cover.trim() ||
    !cover.includes("{JD}") ||
    isTrackDefaultCoverLetter(cover)
  ) {
    next.coverLetterPrompt = resolveCoverLetterTemplateForTrack(next, track);
  }
  if (!next.templateId) next.templateId = templateSelectEl?.value || DEFAULT_TEMPLATE_ID;
  return next;
}

async function persistImportedPerson(merged, { asNew = false } = {}) {
  const person = ensurePromptsOnPerson(merged, { resetEeo: asNew });
  if (asNew) {
    const saved = await addCustomProfile({
      label: person.label || person.name,
      name: person.name || person.label,
      email: person.email,
      phone: person.phone,
      linkedin: person.linkedin,
      portfolio: person.portfolio,
      password: person.password,
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
      resumeFilePrefix: person.resumeFilePrefix || resumeFilePrefixFromName(person.name),
      templateId: person.templateId,
      signatureTitle: person.signatureTitle,
      roleTrack: person.roleTrack || readActiveRoleTrack()
    });
    await setActivePersonId(saved.id);
    return saved;
  }
  const result = await savePersonProfile({ ...person, id: person.id || profileSelectEl.value });
  return result?.profile || result;
}

async function importPersonFromResumeText(text, { sourceLabel = "resume" } = {}) {
  const resumeText = String(text || "").trim();
  if (resumeText.length < 40) {
    throw new Error("Not enough text to build a person. Upload a text-based PDF / DOCX, or paste the resume.");
  }
  const parsed = extractProfileFromResumeText(resumeText);
  const profileId = profileSelectEl.value;
  const current = profilesCache.find((p) => p.id === profileId) || (await getActivePerson());
  const asNew =
    isBuiltinPersonId(profileId) ||
    Boolean(parsed.name && current?.name && namesLikelyDifferent(current.name, parsed.name));
  const merged = mergeExtractedProfileIntoPerson(current, parsed, resumeText, { resetEeo: asNew });
  if (parsed.name && !merged.resumeFilePrefix) {
    merged.resumeFilePrefix = resumeFilePrefixFromName(parsed.name);
  }
  merged.roleTrack = merged.roleTrack || readActiveRoleTrack();

  const filled = parsed.filled.length ? parsed.filled.join(", ") : "master resume text only";
  if (!parsed.name) {
    const notice = `Imported ${sourceLabel} text. Expand Edit or add profile to add a display name and save.`;
    setPersonImportNotice(notice, { ok: true });
    setStatus(`Resume imported — name not found. Detected: ${filled}.`);
    await openProfileEditorFromPopup({ tab: "resume" });
    return parsed;
  }

  setPersonImportNotice(`Saving ${parsed.name} from ${sourceLabel}…`, { ok: true });
  setStatus(`Imported ${parsed.name} from ${sourceLabel}. Saving…`);
  try {
    const saved = await persistImportedPerson({ ...merged, id: asNew ? null : current?.id }, { asNew });
    await refreshProfiles(saved.id);
    await syncPersonContext(saved);
    setPersonImportNotice(
      `Ready to bid as ${saved.label || parsed.name}. From file: ${filled}.`,
      { ok: true }
    );
    return parsed;
  } catch (err) {
    setPersonImportNotice(String(err.message || err), { ok: false });
    await openProfileEditorFromPopup({ tab: "resume" });
    throw err;
  }
}

async function openProfileEditorFromPopup({ tab = "apply", presetId = "", profileId = "" } = {}) {
  const id =
    String(profileId || "").trim() ||
    profileSelectEl?.value ||
    (await getActivePersonId().catch(() => "")) ||
    "";
  if (!inlineProfileEditor) {
    setStatus("Profile editor panel is unavailable.");
    return;
  }
  await inlineProfileEditor.open({ profileId: id, tab, presetId });
  setStatus("Editing profile.");
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

async function refreshProfiles(selectedId) {
  profilesCache = await getResumeProfiles();
  const preferred =
    selectedId ||
    (await chrome.storage.local.get("active_person_id")).active_person_id ||
    (await chrome.storage.local.get("selected_profile_id")).selected_profile_id ||
    DEFAULT_PROFILE_ID;
  populateProfileSelect(preferred);
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

async function syncPersonContext(person) {
  syncActivePersonChip();
  await syncOutputDirFromPerson(person);
  await syncSheetConfigFromPerson(person);
  const rules = resolveExperienceRulesForPerson(person);
  await chrome.storage.local.set({
    resume_file_prefix: person.resumeFilePrefix || "Resume",
    experience_validation_rules: rules,
    experience_validation_person: person.name || person.label || ""
  });
}

async function loadActivePersonIntoForm() {
  const person = await getActivePerson();
  editingPersonId = person?.id || null;
  await syncPersonContext(person);
  await resetActiveTrackForPerson(person);
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

const ENGINE_CHIP_ICONS = {
  chatgpt:
    '<path d="M21 12a8.5 8.5 0 0 1-8.5 8.5H7l-4 3V12A8.5 8.5 0 1 1 21 12Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  claude:
    '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/>'
};

function renderAiProvider(provider) {
  aiProviderCache = normalizeAiProvider(provider);
  const label = aiProviderLabel(aiProviderCache);
  if (aiProviderStateEl) {
    aiProviderStateEl.dataset.state = aiProviderCache;
    aiProviderStateEl.title = `Active AI engine: ${label}`;
    aiProviderStateEl.setAttribute("aria-label", `Active AI engine: ${label}`);
    const icon = ENGINE_CHIP_ICONS[aiProviderCache] || ENGINE_CHIP_ICONS.chatgpt;
    aiProviderStateEl.innerHTML = `<svg class="engine-chip-icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span class="engine-chip-label">${label}</span>`;
  }
  for (const btn of [aiProviderChatgptBtn, aiProviderClaudeBtn]) {
    if (!btn) continue;
    const active = btn.dataset.provider === aiProviderCache;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

async function setAiProvider(provider) {
  const next = normalizeAiProvider(provider);
  renderAiProvider(next);
  await chrome.storage.local.set({ [AI_PROVIDER_KEY]: next });
  setStatus(`AI engine: ${aiProviderLabel(next)}. Stay logged in on that site.`);
}

function renderIndeedGrabState(state) {
  const current = state && typeof state === "object" ? state : {};
  const status = String(current.status || "idle");
  if (indeedGrabStateEl) {
    indeedGrabStateEl.textContent = status;
    indeedGrabStateEl.dataset.state = status;
  }
  if (indeedGrabStatusEl) {
    indeedGrabStatusEl.textContent =
      current.message ||
      (status === "idle"
        ? "Select a job on Indeed, then grab it."
        : status);
  }
  const busy = status === "running";
  if (indeedGrabApplyBtn) indeedGrabApplyBtn.disabled = busy;
  if (indeedGrabOnlyBtn) indeedGrabOnlyBtn.disabled = busy;
}

async function runIndeedGrab({ autoApply = true } = {}) {
  renderIndeedGrabState({
    status: "running",
    message: autoApply
      ? "Grabbing selected job → resume → auto-apply…"
      : "Grabbing selected job into the queue…"
  });
  setStatus(
    autoApply
      ? "Indeed: grab & auto-apply started…"
      : "Indeed: grabbing selected job into the queue…"
  );
  const result = await chrome.runtime.sendMessage({
    type: autoApply ? "indeed_grab_and_apply" : "indeed_grab_only"
  });
  if (!result?.ok) {
    const message = result?.error || "Indeed grab failed.";
    renderIndeedGrabState({ status: "error", message });
    throw new Error(message);
  }
  renderIndeedGrabState({
    status: "running",
    message: "Started — watch the status bar for progress."
  });
  jobsSectionEl?.scrollIntoView({ behavior: "smooth", block: "start" });
  await applyChannelFilter("indeed").catch(() => {});
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
    AI_PROVIDER_KEY,
    MANUAL_PANEL_OPEN_KEY,
    PROFILE_EDITOR_PANEL_OPEN_KEY,
    "generation_status",
    "generation_running",
    QUEUE_KEY,
    ALL_US_JOBS_KEY,
    JOB_CHANNEL_FILTER_KEY,
    BATCH_STATE_KEY,
    INDEED_GRAB_STATUS_KEY,
    "qa_learn_enabled"
  ]);

  await refreshProfiles(data.active_person_id || data.selected_profile_id || DEFAULT_PROFILE_ID);
  await refreshTemplates(data.selected_template_id || DEFAULT_TEMPLATE_ID);
  await loadActivePersonIntoForm();
  await syncActiveTrackUi({ savedTrack: resolveRoleTrackForPerson(await getActivePerson()) });

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
  renderAiProvider(data[AI_PROVIDER_KEY]);
  setManualPanelOpen(Boolean(data[MANUAL_PANEL_OPEN_KEY]), { persist: false });
  if (inlineProfileEditor && Boolean(data[PROFILE_EDITOR_PANEL_OPEN_KEY])) {
    inlineProfileEditor
      .open({ profileId: data.active_person_id || data.selected_profile_id || DEFAULT_PROFILE_ID })
      .catch(() => inlineProfileEditor.setPanelOpen(false, { persist: true }));
  } else {
    inlineProfileEditor?.setPanelOpen(false, { persist: false });
  }
  setStatus(data.generation_status || "");

  channelFilter = normalizeChannelFilter(data[JOB_CHANNEL_FILTER_KEY] || DEFAULT_CHANNEL_FILTER);
  if (channelFilter === "indeed") channelFilter = DEFAULT_CHANNEL_FILTER;
  allUsJobsCache = Array.isArray(data[ALL_US_JOBS_KEY])
    ? data[ALL_US_JOBS_KEY].map((j) => ({
        ...j,
        isLinkedIn: isLinkedInJob(j),
        isDice: isDiceJob(j),
        isIndeed: isIndeedJob(j),
        isJobright: isJobrightJob(j),
        isWorkday: isWorkdayJob(j),
        isGreenhouse: isGreenhouseJob(j),
        isAshby: isAshbyJob(j),
        isLever: isLeverJob(j)
      }))
    : [];
  queueCache = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
  batchState = data[BATCH_STATE_KEY] || "idle";
  renderIndeedGrabState(data[INDEED_GRAB_STATUS_KEY]);

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
  if (allowSubmitToggleEl) allowSubmitToggleEl.checked = Boolean(data.allowSubmitOnAssist);
  syncAutofillUi(data[AUTOFILL_ENABLED_KEY] !== false);
  await refreshQaBank().catch(() => {});
  await hydrateJobDirsInUi().catch(() => {});
}

async function hydrateJobDirsInUi() {
  const res = await chrome.runtime.sendMessage({ type: "hydrate_job_dirs" }).catch(() => null);
  if (!res?.ok) return;
  if (Array.isArray(res.allUsJobs)) {
    allUsJobsCache = res.allUsJobs.map((j) => ({
      ...j,
      isLinkedIn: isLinkedInJob(j),
      isDice: isDiceJob(j),
      isIndeed: isIndeedJob(j),
      isJobright: isJobrightJob(j),
      isWorkday: isWorkdayJob(j),
      isGreenhouse: isGreenhouseJob(j),
      isAshby: isAshbyJob(j),
      isLever: isLeverJob(j)
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
  const liTotal = allUsJobsCache.filter((j) => isLinkedInJob(j)).length;
  const diceTotal = allUsJobsCache.filter((j) => isDiceJob(j)).length;
  const jobrightTotal = allUsJobsCache.filter((j) => isJobrightJob(j)).length;
  const workdayTotal = allUsJobsCache.filter((j) => isWorkdayJob(j)).length;
  const greenhouseTotal = allUsJobsCache.filter((j) => isGreenhouseJob(j)).length;
  const ashbyTotal = allUsJobsCache.filter((j) => isAshbyJob(j)).length;
  const leverTotal = allUsJobsCache.filter((j) => isLeverJob(j)).length;
  const etcTotal = allUsJobsCache.filter(
    (j) =>
      !isDiceJob(j) &&
      !isLinkedInJob(j) &&
      !isIndeedJob(j) &&
      !isJobrightJob(j) &&
      !isWorkdayJob(j) &&
      !isGreenhouseJob(j) &&
      !isAshbyJob(j) &&
      !isLeverJob(j)
  ).length;
  const done = queueCache.filter((j) => j.status === "done").length;
  const pending = queueCache.filter((j) => j.status === "pending").length;
  const errors = queueCache.filter((j) => j.status === "error" || j.status === "failed").length;
  const skipped = queueCache.filter((j) => j.status === "skipped").length;
  const filterLabel =
    channelFilter === "linkedin"
      ? "LI only"
      : channelFilter === "jobright"
        ? "Jobright only"
      : channelFilter === "workday"
        ? "Workday only"
      : channelFilter === "greenhouse"
        ? "Greenhouse only"
      : channelFilter === "ashby"
        ? "Ashby only"
      : channelFilter === "lever"
        ? "Lever only"
      : channelFilter === "indeed"
        ? "Indeed only"
      : channelFilter === "dice"
        ? "Dice only"
        : channelFilter === "etc"
          ? "Other only"
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
    <p class="summary-meta">Showing ${queueCache.length} of ${allUsJobsCache.length} US jobs (${filterLabel}) · Dice ${diceTotal} · LI ${liTotal} · Jobright ${jobrightTotal} · Workday ${workdayTotal} · GH ${greenhouseTotal} · Ashby ${ashbyTotal} · Lever ${leverTotal} · Etc ${etcTotal} · batch ${batchState}</p>
  `;
  syncBatchPill();
}

function syncChannelFilterButtons() {
  const map = {
    dice: filterDiceBtn,
    linkedin: filterLinkedInBtn,
    jobright: filterJobrightBtn,
    workday: filterWorkdayBtn,
    greenhouse: filterGreenhouseBtn,
    ashby: filterAshbyBtn,
    lever: filterLeverBtn,
    indeed: filterIndeedBtn,
    etc: filterEtcBtn,
    all: filterAllBtn
  };
  for (const [key, btn] of Object.entries(map)) {
    if (!btn) continue;
    btn.classList.toggle("active", key === channelFilter);
  }
  if (diceInterleaveHintEl) {
    diceInterleaveHintEl.hidden = false;
    diceInterleaveHintEl.textContent =
      channelFilter === "all"
        ? "All: build resume + cover letter only — no auto-apply. Pick Dice, Workday, Greenhouse, Ashby, or Lever to auto-apply after each build."
        : "Dice / Workday / Greenhouse / Ashby / Lever / Jobgether→ATS: build → autofill → Submit → next. Other external ATS links are never auto-submitted.";
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
      atsScore: prev.atsScore ?? j.atsScore ?? null,
      atsGrade: prev.atsGrade || j.atsGrade || "",
      atsEvaluation: prev.atsEvaluation || j.atsEvaluation || null,
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
  let mode = normalizeChannelFilter(nextFilter || DEFAULT_CHANNEL_FILTER);
  // Indeed filter is hidden in the UI — migrate any saved selection.
  if (mode === "indeed") mode = DEFAULT_CHANNEL_FILTER;
  channelFilter = mode;
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
        : channelFilter === "jobright"
          ? `Showing Jobright jobs — ${queueCache.length} in queue.`
        : channelFilter === "workday"
          ? `Showing Workday jobs — ${queueCache.length} in queue. Start builds then auto-applies each job.`
        : channelFilter === "greenhouse"
          ? `Showing Greenhouse jobs — ${queueCache.length} in queue. Start builds then auto-applies each job.`
        : channelFilter === "ashby"
          ? `Showing Ashby jobs — ${queueCache.length} in queue. Start builds then auto-applies each job.`
        : channelFilter === "lever"
          ? `Showing Lever jobs — ${queueCache.length} in queue. Start builds then auto-applies each job.`
        : channelFilter === "etc"
          ? `Showing other boards — ${queueCache.length} in queue.`
          : `Showing all US jobs — ${queueCache.length} in queue. Start builds files only (no auto-apply).`
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

/** Display order for batch stream: done → pending (running first) → error → skipped. */
function queueStatusSortKey(job) {
  const s = String(job?.status || "pending").toLowerCase();
  if (s === "done") return [0, Number(job.csvRow || 0)];
  if (s === "running") return [1, 0, Number(job.csvRow || 0)];
  if (s === "pending") return [1, 1, Number(job.csvRow || 0)];
  if (s === "error" || s === "failed") return [2, Number(job.csvRow || 0)];
  if (s === "skipped") return [3, Number(job.csvRow || 0)];
  return [1, 2, Number(job.csvRow || 0)];
}

function sortQueueForDisplay(jobs) {
  return [...jobs].sort((a, b) => {
    const ka = queueStatusSortKey(a);
    const kb = queueStatusSortKey(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const diff = (ka[i] ?? 0) - (kb[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

const ACTION_ICON_PATHS = {
  files: '<path d="M3 7h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 7V5a2 2 0 0 1 2-2h5l2 2h5"/>',
  apply: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  remove: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 15H6L5 6"/><path d="M10 11v5m4-5v5"/>',
  retry: '<path d="M20 7v5h-5"/><path d="M19 12a8 8 0 1 0 1 5"/>',
  start: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>',
  skip: '<path d="M5 5v14l9-7z"/><path d="M17 5v14"/>',
  stop: '<path d="M7 7h10v10H7z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  window:
    '<path d="M3 5h18v14H3z"/><path d="M3 9h18"/><path d="M8 14h3"/><path d="M14 14h2"/>',
  panel: '<path d="M4 4h16v16H4z"/><path d="M14 4v16"/>',
  editor:
    '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  bundled:
    '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.27 6.96 8.73 5.05 8.73-5.05M12 22.08V12"/>',
  import: '<path d="M12 3v12"/><path d="m7 10 5-5 5 5"/><path d="M5 21h14"/>',
  export: '<path d="M12 3v12"/><path d="m7 14 5 5 5-5"/><path d="M5 21h14"/>'
};

function setIconButton(button, icon, label) {
  button.classList.add("icon-button");
  button.setAttribute("aria-label", label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ACTION_ICON_PATHS[icon] || ""}</svg>`;
}

function atsScoreTitle(job) {
  const evaluation = job?.atsEvaluation || {};
  const components = evaluation.components || {};
  const lines = [`ATS match: ${job.atsScore}/100${job.atsGrade ? ` · ${job.atsGrade}` : ""}`];
  const labels = {
    keywordMatch: "Keywords",
    titleAlignment: "Title",
    salesforceProducts: "Salesforce products",
    experienceEvidence: "Experience",
    atsStructure: "Structure"
  };
  for (const [key, label] of Object.entries(labels)) {
    const item = components[key];
    if (item && Number(item.max) > 0) lines.push(`${label}: ${item.score}/${item.max}`);
  }
  if (evaluation.missingProducts?.length) {
    lines.push(`Missing products: ${evaluation.missingProducts.join(", ")}`);
  }
  if (evaluation.missingKeywords?.length) {
    lines.push(`Missing keywords: ${evaluation.missingKeywords.slice(0, 8).join(", ")}`);
  }
  return lines.join("\n");
}

/** CSV row the batch is actively generating or Dice-applying (status line or running badge). */
function resolveCurrentWorkCsvRow() {
  const running = queueCache.find((j) => j.status === "running");
  if (running?.csvRow != null && running.csvRow !== "") return Number(running.csvRow);
  const m = String(lastStatusText || "").match(/\brow\s+(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

/** Batch is actively generating/applying — queue list scroll stays user-controlled. */
function isBatchQueueScrollingLocked() {
  return (
    batchState === "running" ||
    batchState === "paused" ||
    document.body.classList.contains("is-busy")
  );
}

function restoreQueueListScroll() {
  if (!queueListEl) return;
  queueScrollProgrammatic = true;
  const max = Math.max(0, queueListEl.scrollHeight - queueListEl.clientHeight);
  queueListEl.scrollTop = Math.min(queueListScrollTop, max);
  requestAnimationFrame(() => {
    queueScrollProgrammatic = false;
  });
}

/** Scroll only inside the queue list — never move the outer app-body scroll. */
function scrollQueueItemIntoView(container, item, { smooth = false, padding = 4 } = {}) {
  if (!container || !item) return;
  const containerRect = container.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const above = itemRect.top < containerRect.top + padding;
  const below = itemRect.bottom > containerRect.bottom - padding;
  if (!above && !below) return;

  let next = container.scrollTop;
  if (above) {
    next += itemRect.top - containerRect.top - padding;
  } else if (below) {
    next += itemRect.bottom - containerRect.bottom + padding;
  }
  next = Math.max(0, Math.min(next, container.scrollHeight - container.clientHeight));

  if (smooth && typeof container.scrollTo === "function") {
    queueScrollProgrammatic = true;
    container.scrollTo({ top: next, behavior: "smooth" });
    requestAnimationFrame(() => {
      queueScrollProgrammatic = false;
    });
  } else {
    queueScrollProgrammatic = true;
    container.scrollTop = next;
    requestAnimationFrame(() => {
      queueScrollProgrammatic = false;
    });
  }
}

/** Keep the queue list scrolled to the job currently being worked (idle review only). */
function followQueueToCurrentWork({ force = false } = {}) {
  if (!queueListEl) return;
  if (isBatchQueueScrollingLocked() && !force) return;
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
  // Re-render rebuilds the list (scroll resets); keep follow inside .queue-list only.
  requestAnimationFrame(() => {
    scrollQueueItemIntoView(queueListEl, el, { smooth: rowChanged });
  });
}

function renderQueue() {
  if (queueListEl) queueListScrollTop = queueListEl.scrollTop;
  queueListEl.innerHTML = "";
  if (!queueCache.length) {
    const empty = document.createElement("div");
    empty.className = "queue-empty";
    empty.innerHTML =
      "<p>Queue is empty</p><span>Upload a CSV, then review before Start</span>";
    queueListEl.appendChild(empty);
    lastQueueFollowRow = null;
    queueListScrollTop = 0;
    return;
  }

  const currentRow = resolveCurrentWorkCsvRow();

  for (const job of sortQueueForDisplay(queueCache)) {
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
    let atsScoreEl = null;
    if (job.atsScore != null && Number.isFinite(Number(job.atsScore))) {
      const score = Math.max(0, Math.min(100, Math.round(Number(job.atsScore))));
      const grade = String(job.atsGrade || "").trim();
      const tier =
        score >= 85 ? "is-excellent" : score >= 70 ? "is-good" : score >= 55 ? "is-fair" : "is-low";
      atsScoreEl = document.createElement("div");
      atsScoreEl.className = `ats-score ${tier}`;
      atsScoreEl.style.setProperty("--ats", String(score));
      atsScoreEl.title = atsScoreTitle(job);
      atsScoreEl.setAttribute(
        "aria-label",
        `ATS match ${score} out of 100${grade ? `, ${grade}` : ""}`
      );
      atsScoreEl.innerHTML =
        `<span class="ats-score-kicker">ATS</span>` +
        `<span class="ats-score-value">${score}</span>` +
        (grade ? `<span class="ats-score-grade">${grade}</span>` : `<span class="ats-score-grade ats-score-grade-empty"></span>`) +
        `<span class="ats-score-meter" aria-hidden="true"><span class="ats-score-fill"></span></span>`;
    }
    if (isLinkedInJob(job)) {
      const liBadge = document.createElement("span");
      liBadge.className = "badge badge-li";
      liBadge.textContent = "LI";
      badges.appendChild(liBadge);
    }
    if (isDiceJob(job)) {
      const diceBadge = document.createElement("span");
      diceBadge.className = "badge badge-dice";
      diceBadge.textContent = "Dice";
      badges.appendChild(diceBadge);
    }
    if (isIndeedJob(job)) {
      const indeedBadge = document.createElement("span");
      indeedBadge.className = "badge badge-indeed";
      indeedBadge.textContent = "Indeed";
      badges.appendChild(indeedBadge);
    }
    if (isJobrightJob(job)) {
      const jrBadge = document.createElement("span");
      jrBadge.className = "badge badge-jobright";
      jrBadge.textContent = "Jobright";
      badges.appendChild(jrBadge);
    }
    if (isWorkdayJob(job)) {
      const wdBadge = document.createElement("span");
      wdBadge.className = "badge badge-workday";
      wdBadge.textContent = "Workday";
      badges.appendChild(wdBadge);
    }
    if (isGreenhouseJob(job)) {
      const ghBadge = document.createElement("span");
      ghBadge.className = "badge badge-greenhouse";
      ghBadge.textContent = "Greenhouse";
      badges.appendChild(ghBadge);
    }
    if (isAshbyJob(job)) {
      const ashbyBadge = document.createElement("span");
      ashbyBadge.className = "badge badge-ashby";
      ashbyBadge.textContent = "Ashby";
      badges.appendChild(ashbyBadge);
    }
    if (isLeverJob(job)) {
      const leverBadge = document.createElement("span");
      leverBadge.className = "badge badge-lever";
      leverBadge.textContent = "Lever";
      badges.appendChild(leverBadge);
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
    if (atsScoreEl) meta.appendChild(atsScoreEl);
    if (job.error) {
      const err = document.createElement("div");
      err.className = "sub";
      err.textContent = job.error;
      err.title = job.error;
      meta.appendChild(err);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    const revealBtn = document.createElement("button");
    revealBtn.type = "button";
    revealBtn.className = "secondary";
    setIconButton(revealBtn, "files", "Open generated files");
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

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "secondary danger";
    setIconButton(removeBtn, "remove", "Remove unsuitable job");
    removeBtn.title = "Remove this unsuitable job from the batch and future CSV refreshes";
    removeBtn.disabled =
      batchState === "running" || job.status === "running" || job.status === "done" || job.applied;
    removeBtn.addEventListener("click", () => removeJobFromBatch(job));

    actions.appendChild(revealBtn);
    actions.appendChild(removeBtn);

    if (job.status === "error" || job.status === "failed") {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "secondary";
      setIconButton(retryBtn, "retry", "Retry job");
      retryBtn.title = "Reset this job and run it again";
      retryBtn.addEventListener("click", () => retryOneJob(job));
      actions.appendChild(retryBtn);
    }

    const applyWrap = document.createElement("div");
    applyWrap.className = "apply-action";
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    const inactiveJob = Boolean(job.inactive) || /^inactive job$/i.test(String(job.error || "").trim());
    const filesReady = Boolean(job.jobDir || job.hasFiles) || job.status === "done";
    // Sheet status Ready (built, not Applied) often lands as skipped-duplicate with no local
    // jobDir on this CSV row — still allow Apply so missed apps can be finished.
    const sheetReadyContinue =
      !job.applied &&
      job.status === "skipped" &&
      Boolean(String(job.jdLink || "").trim());
    const canApply = !inactiveJob && (filesReady || sheetReadyContinue);
    applyBtn.className = job.applied ? "secondary" : canApply ? "primary" : "secondary";
    applyBtn.disabled = !canApply;
    setIconButton(
      applyBtn,
      "apply",
      inactiveJob
        ? "Inactive job"
        : !canApply
          ? "Build files first"
          : job.applied
            ? "Apply again"
            : sheetReadyContinue && !filesReady
              ? "Continue apply (auto apply)"
              : "Apply to job"
    );
    applyBtn.title = inactiveJob
      ? "This job posting is no longer available."
      : !canApply
        ? "Resume and cover letter are not ready yet — wait until status is Done, or run Start to build files."
        : job.applied
          ? `${appliedDocsTitle(job)}\nClick to apply again.`
          : sheetReadyContinue && !filesReady
            ? "Sheet shows Ready (not Applied). Runs hosted auto-apply: open job, autofill, and submit when allowed."
            : "Open this job, upload its resume and cover letter, autofill, and mark Applied on the Google Sheet";
    if (canApply) {
      applyBtn.addEventListener("click", () => applyAssist(job));
    }
    applyWrap.appendChild(applyBtn);

    const controls = document.createElement("div");
    controls.className = "queue-controls";
    controls.appendChild(actions);
    controls.appendChild(applyWrap);

    item.appendChild(rowEl);
    item.appendChild(meta);
    item.appendChild(controls);
    queueListEl.appendChild(item);
  }

  if (isBatchQueueScrollingLocked()) {
    restoreQueueListScroll();
    return;
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
    autoStart: false,
    force: true
  });
  await reloadQueueFromStorage();
  await loadCsvSourceForm();
  if (!ingest?.ok) throw new Error(ingest?.error || "Ingest failed after pin.");
  setStatus(
    ingest.unchangedFile
      ? `Pinned ${file.name} (unchanged).`
      : `Pinned ${file.name} — +${ingest.added || 0} new · ${ingest.pending || 0} pending. Review jobs, then click Start.`
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
        autoStart: false,
        force: false
      });
      await reloadQueueFromStorage();
      await loadCsvSourceForm();
      if (ingest?.ok) {
        setStatus(
          ingest.unchangedFile
            ? "Pinned CSV unchanged."
            : `Refreshed pinned CSV — +${ingest.added || 0} new · ${ingest.pending || 0} pending. Review jobs, then click Start.`
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
        : `Refreshed via ${res.via || "source"} — +${r.added || 0} new · ${r.pending || 0} pending. Review jobs, then click Start.`
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
    const removedData = await chrome.storage.local.get(REMOVED_JOB_IDENTITIES_KEY);
    const removedIdentities = new Set(
      Array.isArray(removedData[REMOVED_JOB_IDENTITIES_KEY])
        ? removedData[REMOVED_JOB_IDENTITIES_KEY].map(String)
        : []
    );
    allUsJobsCache = result.usJobs
      .filter((job) => !removedIdentities.has(jobIdentity(job)))
      .map((j) => ({ ...j, status: "pending" }));
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
      `Loaded ${result.totalRows} rows → ${allUsJobsCache.length} reviewable US jobs (Dice ${result.diceCount || 0} / LI ${result.linkedInCount} / Jobright ${result.jobrightCount || 0} / Workday ${result.workdayCount || 0} / GH ${result.greenhouseCount || 0} / Ashby ${result.ashbyCount || 0} / Lever ${result.leverCount || 0} / Etc ${result.etcCount ?? result.generalCount ?? 0}).` +
        (result.droppedNonUs
          ? ` Dropped ${result.droppedNonUs} non-US.`
          : "") +
        ` Filters use the job URL (Dice / Greenhouse / …). Review and remove unsuitable jobs, then click Start.${dedupeNote}`
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

  } catch (err) {
    setStatus(`CSV parse failed: ${String(err.message || err)}`);
  }
}

async function removeJobFromBatch(job) {
  const label = `${job?.company || "Unknown company"} — ${job?.title || "Untitled"}`;
  if (
    !(await confirmDialog({
      title: "Remove job?",
      message: label,
      confirmText: "Remove",
      danger: true
    }))
  )
    return;
  const result = await chrome.runtime.sendMessage({
    type: "remove_queue_job",
    csvRow: job.csvRow
  });
  if (!result?.ok) {
    setStatus(`Could not remove row ${job.csvRow}: ${result?.error || "Unknown error"}`);
    return;
  }
  queueCache = Array.isArray(result.queue) ? result.queue : queueCache;
  allUsJobsCache = Array.isArray(result.allJobs) ? result.allJobs : allUsJobsCache;
  renderQueue();
  updateCsvSummaryFromQueue();
  setStatus(`Removed row ${job.csvRow}: ${label}.`);
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

  setStatus("Starting apply…");
  const res = await chrome.runtime.sendMessage({
    type: "apply_job_url",
    url: job.jdLink,
    autoSubmit: Boolean(allowSubmitToggleEl?.checked),
    job: {
      csvRow: job.csvRow,
      jobDir: job.jobDir || "",
      jobTitle: job.title || job.jobTitle || "",
      title: job.title || "",
      companyName: job.company || job.companyName || "",
      company: job.company || "",
      jdLink: job.jdLink,
      jdText: job.jdText || "",
      salary: job.salary || "",
      status: job.status || "",
      error: job.error || "",
      applied: Boolean(job.applied)
    }
  });

  if (res?.applied) {
    job.applied = true;
    job.appliedDate = res.appliedDate || formatApplicationDateTime();
    if (res.jobDir) job.jobDir = res.jobDir;
    if (res.resumeName) job.resumeName = res.resumeName;
    if (res.coverName) job.coverName = res.coverName;
    const csvRow = Number(job.csvRow);
    queueCache = queueCache.map((j) =>
      Number(j.csvRow) === csvRow
        ? {
            ...j,
            applied: true,
            appliedDate: job.appliedDate,
            jobDir: job.jobDir || j.jobDir,
            resumeName: job.resumeName || j.resumeName,
            coverName: job.coverName || j.coverName
          }
        : j
    );
    await persistQueue();
  }

  if (!res?.ok) {
    setStatus(res?.error || res?.status || "Apply failed.");
    return;
  }
  if (res?.hostedAutoApply) {
    await loadSettings().catch(() => {});
    setStatus(res.status || "Auto apply running — watch the status bar.");
    return;
  }
  if (res?.autofillSkipped || res?.openedOnly) {
    setStatus(res.status || "Marked Applied and opened job link.");
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
      `${res.status || "Batch started."} Tip: leave ${aiProviderLabel(aiProviderCache)} visible/focused — closing this popup helps auto-Send.`
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

async function onMasterResumeFile(file) {
  if (!file) return;
  setPersonImportNotice(`Reading ${file.name}…`);
  try {
    const { text, fileName } = await extractMasterResumeFromFile(file);
    await importPersonFromResumeText(text, { sourceLabel: fileName });
    if (personResumeFileEl) personResumeFileEl.value = "";
  } catch (err) {
    const message = String(err.message || err);
    setPersonImportNotice(message, { ok: false });
    setStatus(message);
  }
}

async function removeSelectedProfile() {
  const profileId = profileSelectEl.value;
  const selected = profilesCache.find((p) => p.id === profileId);
  if (!selected || selected.builtin) {
    setStatus("Built-in profiles cannot be deleted.");
    return;
  }
  if (
    !(await confirmDialog({
      title: "Delete person?",
      message: `"${selected.label}" will be removed permanently.`,
      confirmText: "Delete",
      danger: true
    }))
  )
    return;
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
  const res = await chrome.runtime.sendMessage({ type: "open_app_window" });
  if (!res?.ok) {
    throw new Error(res?.error || "Could not open window app.");
  }
  if (UI_CONTEXT === "popup" || UI_CONTEXT === "panel") {
    window.close();
  }
}

function dockOutOfPopup() {
  const fail = (err) =>
    setStatus(`Could not switch to side panel: ${String(err?.message || err)}`);

  if (UI_CONTEXT === "window") {
    chrome.windows
      .getCurrent()
      .then((win) =>
        chrome.runtime.sendMessage({
          type: "dock_to_side_panel",
          sourceWindowId: win?.id ?? null
        })
      )
      .then((res) => {
        if (!res?.ok) throw new Error(res?.error || "Could not open side panel.");
        window.close();
      })
      .catch(fail);
    return;
  }

  if (currentWindowId == null || typeof chrome.sidePanel?.open !== "function") {
    chrome.runtime
      .sendMessage({ type: "dock_to_side_panel" })
      .then((res) => {
        if (!res?.ok) throw new Error(res?.error || "Could not open side panel.");
        window.close();
      })
      .catch(fail);
    return;
  }

  // sidePanel.open() only works inside the click gesture from the toolbar popup.
  Promise.resolve(chrome.sidePanel.open({ windowId: currentWindowId }))
    .then(() => window.close())
    .catch(() => {
      chrome.runtime
        .sendMessage({ type: "dock_to_side_panel" })
        .then((res) => {
          if (!res?.ok) throw new Error(res?.error || "Could not open side panel.");
          window.close();
        })
        .catch(fail);
    });
}

async function openAsWindowApp() {
  try {
    await openDetachedWindow();
  } catch (err) {
    setStatus(`Could not open window app: ${String(err?.message || err)}`);
  }
}

function setIntegrationsPanelOpen(open) {
  if (!integrationsPanelBody || !toggleIntegrationsPanelBtn) return;
  integrationsPanelBody.hidden = !open;
  toggleIntegrationsPanelBtn.setAttribute("aria-expanded", open ? "true" : "false");
  toggleIntegrationsPanelBtn.textContent = open
    ? "Hide sheet, pacing & Slack"
    : "Show sheet, pacing & Slack";
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
  const ok = await confirmDialog({
    title: "Import Q&A bank?",
    message: `Import ${list.length} answer${list.length === 1 ? "" : "s"} from ${sourceLabel} into ${target}.`,
    confirmText: "Import"
  });
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
  if (!autofillEnabledCache) {
    setStatus("Autofill is off. Turn it on in Apply assist.");
    return;
  }
  autofillPageBtn.disabled = true;
  autoApplyPageBtn.disabled = true;
  try {
    setStatus("Opening panel and autofilling the application tab…");
    const res = await chrome.runtime.sendMessage({ type: "autofill_active_tab" });
    if (!res?.ok) {
      setStatus(res?.error || "Autofill failed. Click the application tab, then try again.");
      return;
    }
    setStatus(res.statusText || formatAutofillSummary(res) || "Autofill complete — check the panel on the application page.");
  } finally {
    autofillPageBtn.disabled = false;
    autoApplyPageBtn.disabled = false;
  }
}

async function autoApplyThisPage() {
  if (!autofillEnabledCache) {
    setStatus("Autofill is off. Turn it on in Apply assist.");
    return;
  }
  const allowSubmit = Boolean(allowSubmitToggleEl?.checked);
  autofillPageBtn.disabled = true;
  autoApplyPageBtn.disabled = true;
  try {
    setStatus(
      allowSubmit
        ? "Auto Apply: filling and advancing (Submit enabled on supported ATS)…"
        : "Auto Apply: filling and advancing — stops before Submit…"
    );
    const res = await chrome.runtime.sendMessage({
      type: "autofill_multi_step",
      allowSubmitOnAssist: allowSubmit
    });
    if (!res?.ok) {
      setStatus(res?.error || "Auto Apply failed. Focus the application tab first.");
      return;
    }
    setStatus(res.status || res.detail || res.statusText || formatAutofillSummary(res) || "Auto Apply finished.");
  } finally {
    autofillPageBtn.disabled = false;
    autoApplyPageBtn.disabled = false;
  }
}

async function clearJobsList({ confirmPrompt = true } = {}) {
  if (confirmPrompt) {
    const n = queueCache.length || allUsJobsCache.length;
    const ok = await confirmDialog({
      title: "Clear job list?",
      message: n ? `Remove all ${n} job(s). This cannot be undone.` : "Clear the job list and CSV state?",
      confirmText: "Clear",
      danger: true
    });
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
    [REMOVED_JOB_IDENTITIES_KEY]: [],
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
  const n = queueCache.length || allUsJobsCache.length;
  const ok = await confirmDialog({
    title: "Reset workflow?",
    message: n
      ? `Reset batch state and clear all ${n} job(s) from the queue.`
      : "Reset batch state and clear the job queue.",
    confirmText: "Reset",
    danger: true
  });
  if (!ok) return;
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
queueListEl?.addEventListener(
  "scroll",
  () => {
    if (queueScrollProgrammatic || !queueListEl) return;
    queueListScrollTop = queueListEl.scrollTop;
  },
  { passive: true }
);

profileSelectEl.addEventListener("change", () => {
  syncActivePersonChip();
  onProfileChange().catch((e) => setStatus(String(e.message || e)));
  refreshQaBank().catch(() => {});
  if (inlineProfileEditor?.isOpen?.()) {
    inlineProfileEditor
      .open({ profileId: profileSelectEl.value })
      .catch((e) => setStatus(String(e.message || e)));
  }
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

function readActiveRoleTrack() {
  const activeBtn = activeRoleTrackBtns.find((btn) => btn.classList.contains("is-active"));
  return normalizeRoleTrackId(activeBtn?.dataset?.track || "sf");
}

toggleManualPanelBtn.addEventListener("click", () => {
  setManualPanelOpen(manualPanelBody.hidden);
});

deleteProfileBtn.addEventListener("click", () => removeSelectedProfile());

activeRoleTrackBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const track = normalizeRoleTrackId(btn.dataset.track);
    if (track === readActiveRoleTrack()) return;
    setActiveRoleTrackUi(track);
    applyActiveRoleTrackChange({ track }).catch((e) =>
      setStatus(String(e.message || e))
    );
  });
});

personResumeFileEl?.addEventListener("change", () => {
  const file = personResumeFileEl.files?.[0];
  onMasterResumeFile(file).catch((e) => setStatus(String(e.message || e)));
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
filterJobrightBtn?.addEventListener("click", () => {
  applyChannelFilter("jobright").catch((e) => setStatus(String(e.message || e)));
});
filterWorkdayBtn?.addEventListener("click", () => {
  applyChannelFilter("workday").catch((e) => setStatus(String(e.message || e)));
});
filterGreenhouseBtn?.addEventListener("click", () => {
  applyChannelFilter("greenhouse").catch((e) => setStatus(String(e.message || e)));
});
filterAshbyBtn?.addEventListener("click", () => {
  applyChannelFilter("ashby").catch((e) => setStatus(String(e.message || e)));
});
filterLeverBtn?.addEventListener("click", () => {
  applyChannelFilter("lever").catch((e) => setStatus(String(e.message || e)));
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
indeedGrabApplyBtn?.addEventListener("click", () => {
  runIndeedGrab({ autoApply: true }).catch((e) => setStatus(`Indeed grab failed: ${String(e.message || e)}`));
});
indeedGrabOnlyBtn?.addEventListener("click", () => {
  runIndeedGrab({ autoApply: false }).catch((e) => setStatus(`Indeed grab failed: ${String(e.message || e)}`));
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
keepOpenBtn?.addEventListener("click", dockOutOfPopup);
openAsWindowBtn?.addEventListener("click", () => {
  openAsWindowApp().catch((e) => setStatus(String(e.message || e)));
});
toggleIntegrationsPanelBtn?.addEventListener("click", () => {
  const open = integrationsPanelBody?.hidden !== false;
  setIntegrationsPanelOpen(open);
});
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
allowSubmitToggleEl?.addEventListener("change", () => {
  chrome.storage.local.set({ allowSubmitOnAssist: Boolean(allowSubmitToggleEl.checked) }).catch(() => {});
});
autofillEnabledToggleEl?.addEventListener("change", () => {
  const enabled = Boolean(autofillEnabledToggleEl.checked);
  syncAutofillUi(enabled);
  chrome.storage.local.set({ [AUTOFILL_ENABLED_KEY]: enabled }).catch(() => {});
  setStatus(enabled ? "Autofill enabled." : "Autofill disabled — manual apply off; Dice batch auto-apply still runs.");
});
aiProviderChatgptBtn?.addEventListener("click", () => {
  setAiProvider(AI_PROVIDERS.CHATGPT).catch((e) => setStatus(String(e.message || e)));
});
aiProviderClaudeBtn?.addEventListener("click", () => {
  setAiProvider(AI_PROVIDERS.CLAUDE).catch((e) => setStatus(String(e.message || e)));
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
} else if (UI_CONTEXT === "panel") {
  if (keepOpenBtn) keepOpenBtn.hidden = true;
  if (openAsWindowBtn) openAsWindowBtn.hidden = false;
} else if (UI_CONTEXT === "window") {
  if (keepOpenBtn) {
    keepOpenBtn.hidden = false;
    keepOpenBtn.title = "Dock to Chrome side panel";
    keepOpenBtn.setAttribute("aria-label", "Dock to Chrome side panel");
  }
  if (openAsWindowBtn) openAsWindowBtn.hidden = true;
}

function initThemePicker() {
  mountThemeSwatches(themeSwatchesEl, {
    onSelect: (theme) => setStatus(`Theme: ${theme.label}`)
  });
}

if (openAsWindowBtn) setIconButton(openAsWindowBtn, "window", "Open as window app");
if (keepOpenBtn) {
  const panelLabel =
    UI_CONTEXT === "window" ? "Dock to Chrome side panel" : "Keep open in side panel";
  setIconButton(keepOpenBtn, "panel", panelLabel);
}

if (batchStartBtn) setIconButton(batchStartBtn, "start", "Start");
if (batchPauseBtn) setIconButton(batchPauseBtn, "pause", "Pause");
if (batchSkipBtn) setIconButton(batchSkipBtn, "skip", "Skip");
if (batchStopBtn) setIconButton(batchStopBtn, "stop", "Stop");
if (forceSaveChatgptBtn) setIconButton(forceSaveChatgptBtn, "save", "Save JSON");
if (retryErrorsBtn) setIconButton(retryErrorsBtn, "retry", "Retry errors");
if (clearJobsBtn) setIconButton(clearJobsBtn, "remove", "Clear queue");
if (resetBtn) setIconButton(resetBtn, "reset", "Reset");

if (qaOpenEditorBtn) setIconButton(qaOpenEditorBtn, "editor", "Open editor");
if (qaImportBundledBtn) setIconButton(qaImportBundledBtn, "bundled", "Load bundled bank");
if (qaImportBtn) setIconButton(qaImportBtn, "import", "Import JSON");
if (qaExportBtn) setIconButton(qaExportBtn, "export", "Export JSON");

initThemePicker();
loadSettings().catch((err) => setStatus(`Init failed: ${String(err.message || err)}`));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.allowSubmitOnAssist && allowSubmitToggleEl && changes.allowSubmitOnAssist.newValue !== undefined) {
    allowSubmitToggleEl.checked = Boolean(changes.allowSubmitOnAssist.newValue);
  }
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
  if (changes[INDEED_GRAB_STATUS_KEY]) {
    renderIndeedGrabState(changes[INDEED_GRAB_STATUS_KEY].newValue);
  }
  if (changes[AI_PROVIDER_KEY] && changes[AI_PROVIDER_KEY].newValue !== undefined) {
    renderAiProvider(changes[AI_PROVIDER_KEY].newValue);
  }
  if (changes[SESSION_ROLE_TRACK_KEY]) {
    syncActiveTrackUi().catch(() => {});
  }
});

setInterval(async () => {
  const data = await chrome.storage.local.get([
    "generation_status",
    "generation_running",
    QUEUE_KEY,
    ALL_US_JOBS_KEY,
    BATCH_STATE_KEY,
    INDEED_GRAB_STATUS_KEY,
    "csv_source_settings"
  ]);
  batchState = data[BATCH_STATE_KEY] || "idle";
  renderIndeedGrabState(data[INDEED_GRAB_STATUS_KEY]);
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
        coverName: j.coverName || prev?.coverName || "",
        atsScore: j.atsScore ?? prev?.atsScore ?? null,
        atsGrade: j.atsGrade || prev?.atsGrade || "",
        atsEvaluation: j.atsEvaluation || prev?.atsEvaluation || null
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
