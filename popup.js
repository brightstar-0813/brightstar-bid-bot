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
  COVER_LETTER_PROFILE_ID
} from "./profiles.js";
import { getAllTemplates, DEFAULT_TEMPLATE_ID } from "./templates/index.js";
import { extractSpreadsheetId, buildSheetRowTsv } from "./sheets.js";
import { parseJobsCsv, filterJobsByChannel, isLinkedInJob } from "./csv.js";
import { extractMasterResumeFromFile, MASTER_RESUME_ACCEPT } from "./master-resume-file.js";

const DEFAULT_OUTPUT_DIR = "Resume Applications";
const QUEUE_KEY = "job_queue";
const ALL_US_JOBS_KEY = "all_us_jobs";
const JOB_CHANNEL_FILTER_KEY = "job_channel_filter";
const BATCH_STATE_KEY = "batch_state";
const DEFAULT_CHANNEL_FILTER = "general";

const APPS_SCRIPT_SOURCE = `/**
 * Brightstar Bid bot — paste into Extensions → Apps Script on your spreadsheet,
 * then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
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
      data.jobLink || "",
      data.jobTitle || "",
      data.companyName || "",
      data.applicationDate || ""
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
const personResumePromptEl = document.getElementById("personResumePrompt");
const personCoverPromptEl = document.getElementById("personCoverPrompt");
const masterResumeFileEl = document.getElementById("masterResumeFile");
const masterResumeFileHintEl = document.getElementById("masterResumeFileHint");
const clearMasterResumeBtn = document.getElementById("clearMasterResume");
const loadPresetBtn = document.getElementById("loadPreset");
const savePersonBtn = document.getElementById("savePerson");
const savePersonAsNewBtn = document.getElementById("savePersonAsNew");
const personSaveStatusEl = document.getElementById("personSaveStatus");
const personSaveHintEl = document.getElementById("personSaveHint");

const csvFileEl = document.getElementById("csvFile");
const csvSummaryEl = document.getElementById("csvSummary");
const queueListEl = document.getElementById("queueList");
const batchStartBtn = document.getElementById("batchStart");
const batchPauseBtn = document.getElementById("batchPause");
const batchSkipBtn = document.getElementById("batchSkip");
const forceSaveChatgptBtn = document.getElementById("forceSaveChatgpt");
const batchStopBtn = document.getElementById("batchStop");
const clearJobsBtn = document.getElementById("clearJobs");
const filterGeneralBtn = document.getElementById("filterGeneral");
const filterLinkedInBtn = document.getElementById("filterLinkedIn");
const filterAllBtn = document.getElementById("filterAll");

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
const copySheetRowBtn = document.getElementById("copySheetRow");
const pasteJdBtn = document.getElementById("pasteJd");
const runOneOffBtn = document.getElementById("runOneOff");
const autofillPageBtn = document.getElementById("autofillPage");
const resetBtn = document.getElementById("reset");

let profilesCache = [];
let templatesCache = [];
let queueCache = [];
let allUsJobsCache = [];
let channelFilter = DEFAULT_CHANNEL_FILTER;
let batchState = "idle";
let editingPersonId = null;

if (masterResumeFileEl) {
  masterResumeFileEl.setAttribute("accept", MASTER_RESUME_ACCEPT);
}

function setStatus(message) {
  statusEl.textContent = message;
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
    option.title = template.description || "";
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
  personResumePromptEl.value = person?.promptTemplate || "";
  personCoverPromptEl.value = person?.coverLetterPrompt || "";
  if (person?.templateId) {
    templateSelectEl.value = person.templateId;
  }
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
    promptTemplate: personResumePromptEl.value,
    coverLetterPrompt: personCoverPromptEl.value,
    templateId: templateSelectEl.value || DEFAULT_TEMPLATE_ID
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

async function loadActivePersonIntoForm() {
  const person = await getActivePerson();
  fillPersonForm(person);
  if (person?.templateId) {
    await chrome.storage.local.set({ selected_template_id: person.templateId });
    templateSelectEl.value = person.templateId;
  }
  syncSaveButtonLabels();
}

async function persistJobFields() {
  await chrome.storage.local.set({
    last_job_title: jobTitleEl.value,
    last_company_name: companyNameEl.value,
    last_jd_link: jdLinkEl.value,
    last_jd_text: jdTextEl.value,
    output_dir: outputDirEl.value.trim() || DEFAULT_OUTPUT_DIR,
    spreadsheet_url: spreadsheetUrlEl.value.trim(),
    sheets_web_app_url: sheetsWebAppUrlEl.value.trim()
  });
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
    "generation_status",
    "generation_running",
    QUEUE_KEY,
    ALL_US_JOBS_KEY,
    JOB_CHANNEL_FILTER_KEY,
    BATCH_STATE_KEY
  ]);

  await refreshProfiles(data.active_person_id || data.selected_profile_id || DEFAULT_PROFILE_ID);
  await refreshTemplates(data.selected_template_id || DEFAULT_TEMPLATE_ID);
  await loadActivePersonIntoForm();

  jobTitleEl.value = data.last_job_title || "";
  companyNameEl.value = data.last_company_name || "";
  jdLinkEl.value = data.last_jd_link || "";
  jdTextEl.value = data.last_jd_text || "";
  outputDirEl.value = data.output_dir || DEFAULT_OUTPUT_DIR;
  spreadsheetUrlEl.value = data.spreadsheet_url || "";
  sheetsWebAppUrlEl.value = data.sheets_web_app_url || "";
  setStatus(data.generation_status || "");

  channelFilter = data[JOB_CHANNEL_FILTER_KEY] || DEFAULT_CHANNEL_FILTER;
  allUsJobsCache = Array.isArray(data[ALL_US_JOBS_KEY])
    ? data[ALL_US_JOBS_KEY].map((j) => ({
        ...j,
        isLinkedIn: typeof j.isLinkedIn === "boolean" ? j.isLinkedIn : isLinkedInJob(j)
      }))
    : [];
  queueCache = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
  batchState = data[BATCH_STATE_KEY] || "idle";

  // Re-apply filter if we have the full US list; otherwise keep existing queue.
  if (allUsJobsCache.length) {
    await applyChannelFilter(channelFilter, { persist: false });
  } else {
    syncChannelFilterButtons();
    renderQueue();
    updateCsvSummaryFromQueue();
  }

  setBusy(Boolean(data.generation_running) || batchState === "running");

  // Open person editor when the active profile is still a built-in (setup not finished).
  const active = profilesCache.find((p) => p.id === profileSelectEl.value);
  if (active?.builtin) {
    personPanelBody.hidden = false;
    togglePersonPanelBtn.setAttribute("aria-expanded", "true");
    syncSaveButtonLabels();
    setPersonSaveStatus(
      "Paste your resume tailor prompt once (put {JD} as a placeholder — each CSV job fills it automatically). Then Save as my person.",
      { ok: true }
    );
  }
}

function updateCsvSummaryFromQueue() {
  if (!allUsJobsCache.length && !queueCache.length) {
    csvSummaryEl.textContent = "No CSV loaded.";
    return;
  }
  const liTotal = allUsJobsCache.filter((j) => j.isLinkedIn || isLinkedInJob(j)).length;
  const genTotal = allUsJobsCache.length - liTotal;
  const done = queueCache.filter((j) => j.status === "done").length;
  const pending = queueCache.filter((j) => j.status === "pending").length;
  const errors = queueCache.filter((j) => j.status === "error" || j.status === "failed").length;
  const filterLabel =
    channelFilter === "linkedin" ? "LI only" : channelFilter === "all" ? "All" : "General only";
  csvSummaryEl.textContent = `${queueCache.length} in queue (${filterLabel}) · US total ${allUsJobsCache.length} (General ${genTotal} / LI ${liTotal}) · ${done} done · ${pending} pending · ${errors} error · batch: ${batchState}`;
}

function syncChannelFilterButtons() {
  const map = {
    general: filterGeneralBtn,
    linkedin: filterLinkedInBtn,
    all: filterAllBtn
  };
  for (const [key, btn] of Object.entries(map)) {
    if (!btn) continue;
    btn.classList.toggle("active", key === channelFilter);
  }
}

function mergeStatusFromQueue(jobs, previousQueue) {
  const prevByRow = new Map((previousQueue || []).map((j) => [Number(j.csvRow), j]));
  return jobs.map((j) => {
    const prev = prevByRow.get(Number(j.csvRow));
    if (!prev) return { ...j, status: j.status || "pending" };
    return {
      ...j,
      status: prev.status || "pending",
      attempts: prev.attempts || 0,
      jobDir: prev.jobDir,
      error: prev.error
    };
  });
}

async function applyChannelFilter(nextFilter, { persist = true } = {}) {
  channelFilter = nextFilter || DEFAULT_CHANNEL_FILTER;
  syncChannelFilterButtons();
  const filtered = filterJobsByChannel(allUsJobsCache, channelFilter);
  queueCache = mergeStatusFromQueue(filtered, queueCache);
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
    channelFilter === "general"
      ? `Showing General (non-LinkedIn) jobs — ${queueCache.length} in queue.`
      : channelFilter === "linkedin"
        ? `Showing LinkedIn jobs — ${queueCache.length} in queue.`
        : `Showing all US jobs — ${queueCache.length} in queue.`
  );
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

function renderQueue() {
  queueListEl.innerHTML = "";
  if (!queueCache.length) return;

  for (const job of queueCache) {
    const item = document.createElement("div");
    item.className = "queue-item";
    item.dataset.csvRow = String(job.csvRow);

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
    const badge = document.createElement("span");
    badge.className = badgeClass(job.status);
    badge.textContent = job.status || "pending";
    meta.appendChild(title);
    meta.appendChild(sub);
    meta.appendChild(badge);
    if (job.isLinkedIn || isLinkedInJob(job)) {
      const liBadge = document.createElement("span");
      liBadge.className = "badge badge-li";
      liBadge.textContent = "LI";
      meta.appendChild(liBadge);
    }
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
    revealBtn.disabled = !job.jobDir && job.status !== "done";
    revealBtn.addEventListener("click", () => revealJobFiles(job));

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", () => applyAssist(job));

    actions.appendChild(openBtn);
    actions.appendChild(revealBtn);
    actions.appendChild(applyBtn);

    item.appendChild(rowEl);
    item.appendChild(meta);
    item.appendChild(actions);
    queueListEl.appendChild(item);
  }
}

async function persistQueue() {
  await chrome.storage.local.set({ [QUEUE_KEY]: queueCache });
  updateCsvSummaryFromQueue();
  renderQueue();
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
    setStatus(
      `Loaded ${result.totalRows} rows → ${result.usJobs.length} US (General ${result.generalCount} / LI ${result.linkedInCount}). Filter: ${channelFilter}.`
    );

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
    jobDir: job.jobDir || ""
  });
  if (!res?.ok) {
    setStatus(res?.error || "Could not reveal files. Generate this job first.");
    return;
  }
  setStatus(`Revealed files for row ${job.csvRow}.`);
}

async function applyAssist(job) {
  await openJob(job);
  if (job.jobDir || job.status === "done") {
    await revealJobFiles(job);
  }
  const res = await chrome.runtime.sendMessage({ type: "autofill_active_tab" });
  if (!res?.ok) {
    setStatus(
      `Opened job${job.jobDir ? " + files" : ""}. Autofill: ${res?.error || "focus the application tab and click Autofill this page."}`
    );
    return;
  }
  setStatus(`Apply assist: opened job, revealed files, autofilled ${res.filled || 0} field(s).`);
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

async function savePerson({ asNew = false } = {}) {
  // Keep the editor open so the user can see success/error next to the button.
  personPanelBody.hidden = false;
  togglePersonPanelBtn.setAttribute("aria-expanded", "true");

  const person = readPersonForm({ asNew });

  if (!person.label?.trim() && !person.name?.trim()) {
    setPersonSaveStatus("Enter a display name (or full name) before saving.", { ok: false });
    personLabelEl.focus();
    setStatus("Display name required to save person.");
    return;
  }
  if (!person.promptTemplate?.trim()) {
    setPersonSaveStatus(
      "Paste your resume tailor prompt (ChatGPT instructions). Do not paste job descriptions here — those come from the CSV.",
      { ok: false }
    );
    personResumePromptEl.focus();
    setStatus("Resume tailor prompt is required.");
    return;
  }
  if (!person.promptTemplate.includes("{JD}")) {
    setPersonSaveStatus(
      "Add the {JD} placeholder in your tailor prompt. The extension replaces it with each CSV job’s description automatically.",
      { ok: false }
    );
    personResumePromptEl.focus();
    setStatus("Add {JD} placeholder for auto CSV job descriptions.");
    return;
  }
  if (!person.masterResume?.trim() && person.promptTemplate.includes("{MASTER_RESUME}")) {
    setPersonSaveStatus(
      "Your prompt uses {MASTER_RESUME}. Paste resume text or upload .txt / .pdf / .docx first.",
      { ok: false }
    );
    personMasterResumeEl.focus();
    setStatus("Master resume required for {MASTER_RESUME}.");
    return;
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
      active_person_id: saved.id
    });
    await refreshProfiles(saved.id);
    fillPersonForm({ ...saved, builtin: false });

    let msg;
    if (asNew || created) {
      msg = fromBuiltin
        ? `Saved as your person “${saved.label}” (custom). It is now the Active person.`
        : `Created “${saved.label}” and set it as Active person.`;
    } else {
      msg = `Saved changes for “${saved.label}”. Ready to run CSV batch.`;
    }
    setPersonSaveStatus(msg, { ok: true });
    setStatus(msg);
  } catch (err) {
    const message = String(err.message || err);
    setPersonSaveStatus(message, { ok: false });
    setStatus(message);
  } finally {
    savePersonBtn.disabled = false;
    savePersonAsNewBtn.disabled = false;
    syncSaveButtonLabels();
  }
}

async function onMasterResumeFile(file) {
  if (!file) return;
  masterResumeFileHintEl.textContent = `Reading ${file.name}…`;
  try {
    const { text, fileName } = await extractMasterResumeFromFile(file);
    personMasterResumeEl.value = text;
    masterResumeFileHintEl.textContent = `Loaded ${fileName} (${text.length} chars). Save person to keep it.`;
    setStatus(`Master resume loaded from ${fileName}.`);
  } catch (err) {
    masterResumeFileHintEl.textContent = String(err.message || err);
    setStatus(String(err.message || err));
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
  fillPersonForm({ ...preset, id: editingPersonId && !String(editingPersonId).startsWith("matthew") && !BUILTIN_PROFILES.some((b) => b.id === editingPersonId) ? editingPersonId : preset.id });
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
  await setActivePersonId(profileId);
  await loadActivePersonIntoForm();
  const person = await getActivePerson();
  await chrome.storage.local.set({
    resume_file_prefix: person.resumeFilePrefix || "Resume",
    selected_template_id: person.templateId || DEFAULT_TEMPLATE_ID
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
  const tsv = buildSheetRowTsv({ jobTitle, companyName, jdLink, includeDate: true });
  try {
    await navigator.clipboard.writeText(tsv);
    setStatus("Sheet row copied.");
  } catch {
    setStatus("Clipboard write failed.");
  }
}

function setBusy(busy) {
  batchStartBtn.disabled = busy && batchState === "running";
  runOneOffBtn.disabled = busy;
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
      templateId: person.templateId || templateSelectEl.value || DEFAULT_TEMPLATE_ID,
      resumeFilePrefix: person.resumeFilePrefix || "Resume",
      profileId: person.id
    }
  });

  if (!res?.ok) {
    setStatus(res?.error || "One-off failed to start.");
    setBusy(false);
  }
}

async function autofillThisPage() {
  const res = await chrome.runtime.sendMessage({ type: "autofill_active_tab" });
  if (!res?.ok) {
    setStatus(res?.error || "Autofill failed. Focus the application tab first.");
    return;
  }
  setStatus(`Autofilled ${res.filled || 0} field(s) on the active page.`);
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
  onProfileChange().catch((e) => setStatus(String(e.message || e)));
});

templateSelectEl.addEventListener("change", () => {
  chrome.storage.local.set({ selected_template_id: templateSelectEl.value }).catch(() => {});
});

togglePersonPanelBtn.addEventListener("click", () => {
  const open = personPanelBody.hidden;
  personPanelBody.hidden = !open;
  togglePersonPanelBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) syncSaveButtonLabels();
});

toggleManualPanelBtn.addEventListener("click", () => {
  const open = manualPanelBody.hidden;
  manualPanelBody.hidden = !open;
  toggleManualPanelBtn.setAttribute("aria-expanded", open ? "true" : "false");
});

loadPresetBtn.addEventListener("click", () => loadPresetIntoEditor().catch((e) => setStatus(String(e.message || e))));
savePersonBtn.addEventListener("click", () => savePerson({ asNew: false }));
savePersonAsNewBtn.addEventListener("click", () => savePerson({ asNew: true }));
deleteProfileBtn.addEventListener("click", () => removeSelectedProfile());
clearMasterResumeBtn.addEventListener("click", () => {
  personMasterResumeEl.value = "";
  masterResumeFileEl.value = "";
  masterResumeFileHintEl.textContent = "";
});
masterResumeFileEl.addEventListener("change", () => {
  const file = masterResumeFileEl.files?.[0];
  onMasterResumeFile(file).catch((e) => setStatus(String(e.message || e)));
});

csvFileEl.addEventListener("change", () => {
  const file = csvFileEl.files?.[0];
  onCsvSelected(file).catch((e) => setStatus(String(e.message || e)));
});

filterGeneralBtn?.addEventListener("click", () => {
  applyChannelFilter("general").catch((e) => setStatus(String(e.message || e)));
});
filterLinkedInBtn?.addEventListener("click", () => {
  applyChannelFilter("linkedin").catch((e) => setStatus(String(e.message || e)));
});
filterAllBtn?.addEventListener("click", () => {
  applyChannelFilter("all").catch((e) => setStatus(String(e.message || e)));
});

batchStartBtn.addEventListener("click", () => sendBatch("batch_start"));
batchPauseBtn.addEventListener("click", () => sendBatch("batch_pause"));
batchSkipBtn.addEventListener("click", () => sendBatch("batch_skip"));
batchStopBtn.addEventListener("click", () => sendBatch("batch_stop"));
clearJobsBtn?.addEventListener("click", () => {
  clearJobsList({ confirmPrompt: true }).catch((e) => setStatus(String(e.message || e)));
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
runOneOffBtn.addEventListener("click", runOneOff);
autofillPageBtn.addEventListener("click", autofillThisPage);
resetBtn.addEventListener("click", resetWorkflow);

for (const el of [jobTitleEl, companyNameEl, jdLinkEl, jdTextEl, outputDirEl, spreadsheetUrlEl, sheetsWebAppUrlEl]) {
  el.addEventListener("change", () => {
    persistJobFields().catch(() => {});
  });
}

loadSettings().catch((err) => setStatus(`Init failed: ${String(err.message || err)}`));

setInterval(async () => {
  const data = await chrome.storage.local.get([
    "generation_status",
    "generation_running",
    QUEUE_KEY,
    BATCH_STATE_KEY
  ]);
  if (typeof data.generation_status === "string") {
    setStatus(data.generation_status);
  }
  if (Array.isArray(data[QUEUE_KEY])) {
    queueCache = data[QUEUE_KEY];
    renderQueue();
    updateCsvSummaryFromQueue();
  }
  batchState = data[BATCH_STATE_KEY] || "idle";
  setBusy(Boolean(data.generation_running) || batchState === "running");
}, 1200);

// silence unused import warning path for extractSpreadsheetId when sheets hidden
void extractSpreadsheetId;
