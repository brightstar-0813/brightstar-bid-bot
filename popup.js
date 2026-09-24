import {
  DEFAULT_PROFILE_ID,
  DEFAULT_ATS_PASSWORD,
  getResumeProfiles,
  getActivePerson,
  getActivePersonId,
  setActivePersonId,
  savePersonProfile,
  addCustomProfile,
  getTrackPromptTemplate,
  getTrackCoverLetterTemplate,
  resolveRoleTrackForPerson,
  resolvePromptTemplateForTrack,
  resolveCoverLetterTemplateForTrack,
  normalizeRequiredExperienceInput,
  parseRequiredExperienceFromPrompt,
  resolveExperienceRulesForPerson,
  setPersonSheetConfig,
  syncActivePersonOutputContext,
  applyUsApplicantDefaults,
  promptHasFixedCompanyHistory,
  resolveSheetTabNameForPerson
} from "./profiles.js";
import {
  getSessionRoleTrack,
  setSessionRoleTrack,
  getRoleTrack,
  isTrackDefaultPrompt,
  isTrackDefaultCoverLetter,
  normalizeRoleTrackId,
  isRoleTrackLockedForPerson,
  applyRoleTrackToggleState,
  SESSION_ROLE_TRACK_KEY
} from "./role-tracks.js";
import {
  requiredExperienceToText
} from "./experience-rules.js";
import { describeAtsGaps } from "./ats-score.js";
import { getAllTemplates, DEFAULT_TEMPLATE_ID } from "./templates/index.js";
import { resolvePastedResume, isStyledExportResume } from "./resume-text.js";
import {
  extractSpreadsheetId,
  formatApplicationDate,
  formatApplicationDateTime
} from "./sheets.js";
import { notifySlackBatchComplete, isSlackWebhookUrl } from "./slack.js";
import { showToast } from "./ui-toast.js";
import { initEmailBidUi } from "./email-bid-ui.js";
import {
  parseJobsCsv,
  filterJobsByChannel,
  isLinkedInJob,
  isDiceJob,
  isIndeedJob,
  isJobrightJob,
  isWorkdayJob,
  isBuiltinJob,
  isHimalayasJob,
  isGreenhouseJob,
  normalizeChannelFilter
} from "./csv.js";
import { extractMasterResumeFromFile, MASTER_RESUME_ACCEPT } from "./master-resume-file.js";
import {
  AI_PROVIDER_KEY,
  AI_PROVIDERS,
  DELETE_AI_CHAT_HISTORY_KEY,
  aiProviderLabel,
  normalizeAiProvider
} from "./ai-provider.js";
import {
  STRONG_HUMANIZE_MODE_KEY,
  STRONG_HUMANIZE_MODES,
  normalizeStrongHumanizeMode,
  setStrongHumanizeMode,
  strongHumanizeModeLabel
} from "./prompts/humanize-resume.js";
import {
  SF_PROMPT_VERSION_KEY,
  SF_PROMPT_VERSIONS,
  normalizeSfPromptVersion,
  setSfPromptVersion,
  sfPromptVersionLabel
} from "./prompts/sf-test.js";
import {
  extractProfileFromResumeText,
  parseEmployersFromResume,
  resumeFilePrefixFromName,
  outputDirFromPerson,
  namesLikelyDifferent,
  normalizeDownloadsRelativeDir,
  isGenericApplicationsDir,
  resolveOutputDirForPerson
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
import { OPENAI_QA_ASSIST_KEY } from "./openai.js";
import { mountThemeSwatches } from "./theme.js";
import { confirmDialog, jobDetailsDialog } from "./ui-dialog.js";

const DEFAULT_OUTPUT_DIR = "Applications";
const QUEUE_KEY = "job_queue";
const ALL_US_JOBS_KEY = "all_us_jobs";
const JOB_CHANNEL_FILTER_KEY = "job_channel_filter";
const REMOVED_JOB_IDENTITIES_KEY = "removed_job_identities";
const BATCH_STATE_KEY = "batch_state";
const DEFAULT_CHANNEL_FILTER = "dice";
const MANUAL_PANEL_OPEN_KEY = "manual_panel_open";
const PROFILE_EDITOR_PANEL_OPEN_KEY = "profile_editor_panel_open";
const ALLOW_BATCH_KEY = "allow_batch_process";
/** @deprecated Migrated into ALLOW_BATCH_KEY; still read for older installs. */
const LEGACY_BID_MARKET_KEY = "bid_market";
const ALLOW_BATCH = { YES: "yes", NO: "no" };
const DEFAULT_ALLOW_BATCH = ALLOW_BATCH.YES;
const PREVIEW_WINDOW_KEY = "template_preview_window_id";
const INDEED_CAPTURE_STATE_KEY = "indeed_capture_state"; // legacy; cleared on reset
const INDEED_GRAB_STATUS_KEY = "indeed_grab_status";

/** "popup" (closes on focus loss), "panel" (docked), or "window" (detached). */
const UI_CONTEXT = new URLSearchParams(location.search).get("ctx") || "popup";
document.body.classList.add(`ctx-${UI_CONTEXT}`);

/** Cached so the dock button can call sidePanel.open() inside the user gesture. */
let currentWindowId = null;


const statusEl = document.getElementById("status");
const profileSelectEl = document.getElementById("profileSelect");
const templateSelectEl = document.getElementById("templateSelect");
const addProfileBtn = document.getElementById("addProfile");
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
      await resetActiveTrackForPerson(saved);
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
const queueNowWorkingEl = document.getElementById("queueNowWorking");
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
const filterBuiltinBtn = document.getElementById("filterBuiltin");
const filterHimalayasBtn = document.getElementById("filterHimalayas");
const filterGreenhouseBtn = document.getElementById("filterGreenhouse");
const filterEtcBtn = document.getElementById("filterEtc");
const filterAllBtn = document.getElementById("filterAll");
const indeedGrabApplyBtn = document.getElementById("indeedGrabApply");
const indeedGrabOnlyBtn = document.getElementById("indeedGrabOnly");
const indeedGrabStateEl = document.getElementById("indeedGrabState");
const indeedGrabStatusEl = document.getElementById("indeedGrabStatus");
const toggleSheetPanelBtn = document.getElementById("toggleSheetPanel");
const sheetPanelBody = document.getElementById("sheetPanelBody");
const togglePacingSlackPanelBtn = document.getElementById("togglePacingSlackPanel");
const pacingSlackPanelBody = document.getElementById("pacingSlackPanelBody");
const personSheetSectionTitleEl = document.getElementById("personSheetSectionTitle");
const personSheetSectionHintEl = document.getElementById("personSheetSectionHint");
const jobsSectionEl = document.getElementById("jobsSection");
const indeedSectionEl = document.getElementById("indeedSection");
const manualSectionEl = document.getElementById("manualSection");
const applySectionEl = document.getElementById("applySection");
const jobsStepNumEl = document.getElementById("jobsStepNum");
const manualStepNumEl = document.getElementById("manualStepNum");
const applyStepNumEl = document.getElementById("applyStepNum");
const manualSectionTitleEl = document.getElementById("manualSectionTitle");
const allowBatchYesBtn = document.getElementById("allowBatchYes");
const allowBatchNoBtn = document.getElementById("allowBatchNo");
let allowBatchCache = DEFAULT_ALLOW_BATCH;
const toggleManualPanelBtn = document.getElementById("toggleManualPanel");
const manualPanelBody = document.getElementById("manualPanelBody");
const jobTitleEl = document.getElementById("jobTitle");
const companyNameEl = document.getElementById("companyName");
const jdLinkEl = document.getElementById("jdLink");
const jdTextEl = document.getElementById("jdText");
const outputDirEl = document.getElementById("outputDir");
const spreadsheetUrlEl = document.getElementById("spreadsheetUrl");
const sheetsWebAppUrlEl = document.getElementById("sheetsWebAppUrl");
const sheetTabNameEl = document.getElementById("sheetTabName");
const outputRoutePreviewEl = document.getElementById("outputRoutePreview");
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
const humanizeOffBtn = document.getElementById("humanizeOff");
const humanizeAutoBtn = document.getElementById("humanizeAuto");
const humanizeOnBtn = document.getElementById("humanizeOn");
let humanizeModeCache = STRONG_HUMANIZE_MODES.AUTO;
const sfPromptVersionEl = document.getElementById("sfPromptVersion");
let sfPromptVersionCache = SF_PROMPT_VERSIONS.V1;
const DEFAULT_CHATGPT_GAP_SEC = 45;
const DEFAULT_CHATGPT_HARD_PAUSE = 3;
const keepOpenBtn = document.getElementById("keepOpen");
const openAsWindowBtn = document.getElementById("openAsWindow");
const previewTemplateBtn = document.getElementById("previewTemplate");
const styleExportPasteEl = document.getElementById("styleExportPaste");
const styleExportClearBtn = document.getElementById("styleExportClear");
const styleExportPdfBtn = document.getElementById("styleExportPdf");
const fillFromOpenTabBtn = document.getElementById("fillFromOpenTab");
const clearOneOffFieldsBtn = document.getElementById("clearOneOffFields");
const runOneOffBtn = document.getElementById("runOneOff");
const logProfileApplyBtn = document.getElementById("logProfileApply");
const emailBidPrepareBtn = document.getElementById("emailBidPrepare");
const regenerateOneOffBtn = document.getElementById("regenerateOneOff");
const confirmOneOffBtn = document.getElementById("confirmOneOff");
const discardOneOffBtn = document.getElementById("discardOneOff");
const openOneOffPreviewBtn = document.getElementById("openOneOffPreview");
const oneOffIdleActionsEl = document.getElementById("oneOffIdleActions");
const oneOffDraftActionsEl = document.getElementById("oneOffDraftActions");
const oneOffAdditionalPromptFieldEl = document.getElementById("oneOffAdditionalPromptField");
const oneOffExtraPromptEl = document.getElementById("oneOffExtraPrompt");
const oneOffAtsBlock = document.getElementById("oneOffAtsBlock");
const oneOffAtsScoreEl = document.getElementById("oneOffAtsScore");
const oneOffViewGapsBtn = document.getElementById("oneOffViewGaps");
const oneOffAtsGapsEl = document.getElementById("oneOffAtsGaps");
const LAST_ONE_OFF_ATS_KEY = "last_one_off_ats";
const ONE_OFF_DRAFT_KEY = "one_off_draft";
let lastOneOffAtsCache = null;
let oneOffDraftCache = null;
let emailBidUi = null;
const autofillPageBtn = document.getElementById("autofillPage");
const autoApplyPageBtn = document.getElementById("autoApplyPage");
const customQaPageBtn = document.getElementById("customQaPage");
const customQaAskPanelEl = document.getElementById("customQaAskPanel");
const customQaQuestionEl = document.getElementById("customQaQuestion");
const customQaAnswerEl = document.getElementById("customQaAnswer");
const customQaMetaEl = document.getElementById("customQaMeta");
const customQaGenerateBtn = document.getElementById("customQaGenerate");
const customQaScanPageBtn = document.getElementById("customQaScanPage");
const customQaCopyBtn = document.getElementById("customQaCopy");
const customQaSaveBtn = document.getElementById("customQaSave");
const customQaStrongModelEl = document.getElementById("customQaStrongModel");
const customQaStrongWrapEl = document.getElementById("customQaStrongWrap");
const resetBtn = document.getElementById("reset");
const qaBankNoteEl = document.getElementById("qaBankNote");
const qaLearnToggleEl = document.getElementById("qaLearnToggle");
const allowSubmitToggleEl = document.getElementById("allowSubmitToggle");
const openaiQaToggleEl = document.getElementById("openaiQaToggle");
const deleteAiChatToggleEl = document.getElementById("deleteAiChatToggle");
const cleanLeftoverAiChatsBtn = document.getElementById("cleanLeftoverAiChatsBtn");
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
/** csvRow keys with Gaps panel open — survive queue re-renders. */
const openAtsGapsRows = new Set();
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
    renderCurrentWorkIndicator();
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
  renderCurrentWorkIndicator();
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
  chip.title = selected.label;
}

function syncBatchPill() {
  const el = document.getElementById("batchStatePill");
  if (!el) return;
  el.textContent = batchState || "idle";
  el.dataset.state = batchState || "idle";
}

function setActiveRoleTrackUi(track, { locked = false } = {}) {
  applyRoleTrackToggleState(activeRoleTrackBtns, {
    track,
    locked
  });
}

async function syncActiveTrackUi({ savedTrack, person } = {}) {
  if (!activeRoleTrackBtns.length) return;
  const activePerson =
    person ||
    profilesCache.find((p) => p.id === profileSelectEl.value) ||
    (await getActivePerson().catch(() => null));
  const locked = isRoleTrackLockedForPerson(activePerson);
  const personTrack = savedTrack || resolveRoleTrackForPerson(activePerson);
  if (locked) {
    setActiveRoleTrackUi(personTrack, { locked: true });
    return;
  }
  const sessionTrack = await getSessionRoleTrack();
  const activeTrack = sessionTrack || personTrack || readActiveRoleTrack();
  setActiveRoleTrackUi(activeTrack, { locked: false });
}

function applyTrackTemplatesToForm(_roleTrack, _person) {
  /* Prompts live in profile editor — session track only in popup. */
}

async function applyActiveRoleTrackChange({ track: nextTrack } = {}) {
  const person = profilesCache.find((p) => p.id === profileSelectEl.value) || (await getActivePerson());
  const savedTrack = resolveRoleTrackForPerson(person);
  if (isRoleTrackLockedForPerson(person)) {
    await setSessionRoleTrack(savedTrack);
    setActiveRoleTrackUi(savedTrack, { locked: true });
    setStatus(`Track: ${getRoleTrack(savedTrack).label} (set for profile)`);
    return;
  }

  const track = normalizeRoleTrackId(nextTrack ?? readActiveRoleTrack());
  setActiveRoleTrackUi(track, { locked: false });
  await setSessionRoleTrack(track);
  await syncActiveTrackUi({ savedTrack, person });
  const label = getRoleTrack(track).label;
  setStatus(track === savedTrack ? `Track: ${label}` : `Track: ${label} (session only)`);
}

async function resetActiveTrackForPerson(person) {
  const savedTrack = resolveRoleTrackForPerson(person);
  await setSessionRoleTrack(savedTrack);
  setActiveRoleTrackUi(savedTrack, { locked: isRoleTrackLockedForPerson(person) });
  await syncActiveTrackUi({ savedTrack, person });
}

function syncAutofillUi(enabled = autofillEnabledCache) {
  autofillEnabledCache = Boolean(enabled);
  if (autofillEnabledToggleEl) autofillEnabledToggleEl.checked = autofillEnabledCache;
  if (autofillPageBtn) autofillPageBtn.disabled = !autofillEnabledCache;
  if (autoApplyPageBtn) autoApplyPageBtn.disabled = !autofillEnabledCache;
  if (customQaPageBtn) customQaPageBtn.disabled = !autofillEnabledCache;
  syncCustomQaAskControls();
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

function ensurePromptsOnPerson(person, { resetEeo = false, resetPrompts = false } = {}) {
  let next = { ...person };
  const track = next.roleTrack || readActiveRoleTrack();
  const prompt = String(next.promptTemplate || "").trim();
  const hasRichPrompt =
    Boolean(prompt) &&
    prompt.includes("{JD}") &&
    (promptHasFixedCompanyHistory(prompt) || !isTrackDefaultPrompt(prompt));

  // Save-as-mine uses resetEeo only — keep FIXED COMPANY HISTORY / custom rich prompts.
  if (resetPrompts || !hasRichPrompt) {
    if (resetPrompts || !prompt || !prompt.includes("{JD}") || isTrackDefaultPrompt(prompt)) {
      next.promptTemplate = getTrackPromptTemplate(track, next);
    }
  }

  const cover = String(next.coverLetterPrompt || "");
  const hasRichCover =
    Boolean(cover.trim()) && cover.includes("{JD}") && !isTrackDefaultCoverLetter(cover);
  if (resetPrompts || !hasRichCover) {
    if (resetPrompts || !cover.trim() || !cover.includes("{JD}") || isTrackDefaultCoverLetter(cover)) {
      next.coverLetterPrompt = resolveCoverLetterTemplateForTrack(next, track);
    }
  }
  if (!next.templateId) next.templateId = templateSelectEl?.value || DEFAULT_TEMPLATE_ID;
  if (resetEeo) {
    next = {
      ...next,
      gender: "",
      ethnicity: "",
      disability: "",
      veteran: "",
      citizenship: "",
      workAuthorized: "",
      sponsorship: "",
      hispanicLatino: "",
      autofillExtras: {}
    };
    next = applyUsApplicantDefaults(next);
  }
  return next;
}

async function persistImportedPerson(merged, { asNew = false } = {}) {
  // asNew from builtin/name-mismatch: reset EEO only — keep rich prompts when present.
  const person = ensurePromptsOnPerson(merged, { resetEeo: asNew, resetPrompts: false });
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
    option.title = template.label;
    templateSelectEl.appendChild(option);
  }
  const validIds = new Set(templatesCache.map((t) => t.id));
  templateSelectEl.value = validIds.has(selectedId) ? selectedId : DEFAULT_TEMPLATE_ID;
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
  const { outputDir } = await syncActivePersonOutputContext(person);
  if (outputDirEl) outputDirEl.value = outputDir;
  return outputDir;
}

/** Resolve Output folder for batch/one-off from sheet tab / person folder. */
async function resolveUiOutputDir() {
  const person = await getActivePerson().catch(() => null);
  const personDir = person ? resolveOutputDirForPerson(person) : "";
  let outputDir = normalizeDownloadsRelativeDir(
    (outputDirEl?.value || "").trim(),
    personDir || DEFAULT_OUTPUT_DIR
  );
  if (isGenericApplicationsDir(outputDir) && personDir) {
    outputDir = personDir;
  }
  if (outputDirEl) outputDirEl.value = outputDir;
  updateOutputRoutePreview(outputDir);
  return { outputDir, person };
}

/** Load shared workbook URLs + active profile sheet tab (also the save folder). */
async function syncSheetConfigFromPerson(person) {
  const data = await chrome.storage.local.get(["spreadsheet_url", "sheets_web_app_url"]);
  const spreadsheetUrl = String(
    data.spreadsheet_url || person?.spreadsheetUrl || ""
  ).trim();
  const sheetsWebAppUrl = String(
    data.sheets_web_app_url || person?.sheetsWebAppUrl || ""
  ).trim();
  const sheetTabName = resolveSheetTabNameForPerson(person || {});
  const resolved = resolveOutputDirForPerson({
    ...person,
    sheetTabName,
    outputDir: sheetTabName
  });
  if (spreadsheetUrlEl) spreadsheetUrlEl.value = spreadsheetUrl;
  if (sheetsWebAppUrlEl) sheetsWebAppUrlEl.value = sheetsWebAppUrl;
  if (sheetTabNameEl) sheetTabNameEl.value = sheetTabName;
  if (outputDirEl) outputDirEl.value = resolved;
  updatePersonSheetSectionLabels(person);
  updateOutputRoutePreview(resolved);
  await chrome.storage.local.set({
    spreadsheet_url: spreadsheetUrl,
    sheets_web_app_url: sheetsWebAppUrl,
    output_dir: resolved,
    batch_output_dir: resolved
  });
  if (person?.id) {
    await setPersonSheetConfig(person.id, { sheetTabName, outputDir: sheetTabName });
  }
}

function updateOutputRoutePreview(resolved) {
  if (!outputRoutePreviewEl) return;
  const path = String(resolved || outputDirEl?.value || "").trim() || "…";
  outputRoutePreviewEl.textContent = `Resolved: Downloads / ${path}`;
}

function updatePersonSheetSectionLabels(person) {
  const label = String(person?.label || person?.name || "").trim();
  if (personSheetSectionTitleEl) {
    personSheetSectionTitleEl.textContent = label ? `This profile · ${label}` : "This profile";
  }
  if (personSheetSectionHintEl) {
    personSheetSectionHintEl.hidden = false;
    personSheetSectionHintEl.textContent = label
      ? `Sheet tab for ${label} is also the Downloads folder.`
      : "Sheet tab name is also the save folder under Downloads.";
  }
}

async function persistActivePersonSheetFromUi() {
  const person = await getActivePerson().catch(() => null);
  const spreadsheetUrl = spreadsheetUrlEl?.value?.trim() || "";
  const sheetsWebAppUrl = sheetsWebAppUrlEl?.value?.trim() || "";
  const sheetTabName = resolveSheetTabNameForPerson({
    ...(person || {}),
    sheetTabName: sheetTabNameEl?.value || person?.sheetTabName || ""
  });
  const resolved = resolveOutputDirForPerson({
    ...person,
    sheetTabName,
    outputDir: sheetTabName
  });
  if (sheetTabNameEl) sheetTabNameEl.value = sheetTabName;
  if (outputDirEl) outputDirEl.value = resolved;
  updateOutputRoutePreview(resolved);
  await chrome.storage.local.set({
    spreadsheet_url: spreadsheetUrl,
    sheets_web_app_url: sheetsWebAppUrl,
    output_dir: resolved,
    batch_output_dir: resolved
  });
  if (person?.id) {
    await setPersonSheetConfig(person.id, { sheetTabName, outputDir: sheetTabName });
  }
}

async function syncPersonContext(person) {
  syncActivePersonChip();
  const { outputDir, resumeFilePrefix } = await syncActivePersonOutputContext(person);
  if (outputDirEl) outputDirEl.value = outputDir;
  await syncSheetConfigFromPerson(person);
  const rules = resolveExperienceRulesForPerson(person);
  await chrome.storage.local.set({
    resume_file_prefix: resumeFilePrefix,
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
  const person = await getActivePerson().catch(() => null);
  const sheetTabName = resolveSheetTabNameForPerson({
    ...(person || {}),
    sheetTabName: sheetTabNameEl?.value || person?.sheetTabName || ""
  });
  const personDir = person
    ? resolveOutputDirForPerson({ ...person, sheetTabName, outputDir: sheetTabName })
    : "";
  let outputDir = normalizeDownloadsRelativeDir(
    (outputDirEl?.value || "").trim(),
    personDir || DEFAULT_OUTPUT_DIR
  );
  if (isGenericApplicationsDir(outputDir) && personDir) {
    outputDir = personDir;
  }
  if (outputDirEl) outputDirEl.value = outputDir;
  updateOutputRoutePreview(outputDir);
  await chrome.storage.local.set({
    last_job_title: jobTitleEl.value,
    last_company_name: companyNameEl.value,
    last_jd_link: jdLinkEl.value,
    last_jd_text: jdTextEl.value,
    last_one_off_extra_prompt: oneOffExtraPromptEl?.value || "",
    output_dir: outputDir,
    batch_output_dir: outputDir,
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
  setStatus(`AI engine: ${aiProviderLabel(next)}.`);
}

function renderHumanizeMode(mode) {
  humanizeModeCache = normalizeStrongHumanizeMode(mode);
  for (const btn of [humanizeOffBtn, humanizeAutoBtn, humanizeOnBtn]) {
    if (!btn) continue;
    const active = btn.dataset.humanize === humanizeModeCache;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

async function setHumanizeMode(mode) {
  const next = normalizeStrongHumanizeMode(mode);
  await setStrongHumanizeMode(next);
  renderHumanizeMode(next);
  setStatus(`Strong humanize: ${strongHumanizeModeLabel(next)}.`);
}

function renderSfPromptVersion(version) {
  sfPromptVersionCache = normalizeSfPromptVersion(version);
  if (sfPromptVersionEl) sfPromptVersionEl.value = sfPromptVersionCache;
}

async function setSfPromptVersionUi(version) {
  const next = normalizeSfPromptVersion(version);
  await setSfPromptVersion(next);
  renderSfPromptVersion(next);
  setStatus(`SF prompt: ${sfPromptVersionLabel(next)}.`);
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
    message: "Started."
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
    "last_one_off_extra_prompt",
    LAST_ONE_OFF_ATS_KEY,
    ONE_OFF_DRAFT_KEY,
    "output_dir",
    "spreadsheet_url",
    "sheets_web_app_url",
    "slack_webhook_url",
    CHATGPT_PACING_KEY,
    AI_PROVIDER_KEY,
    STRONG_HUMANIZE_MODE_KEY,
    SF_PROMPT_VERSION_KEY,
    MANUAL_PANEL_OPEN_KEY,
    PROFILE_EDITOR_PANEL_OPEN_KEY,
    ALLOW_BATCH_KEY,
    LEGACY_BID_MARKET_KEY,
    "generation_status",
    "generation_running",
    QUEUE_KEY,
    ALL_US_JOBS_KEY,
    JOB_CHANNEL_FILTER_KEY,
    BATCH_STATE_KEY,
    INDEED_GRAB_STATUS_KEY,
    "qa_learn_enabled",
    "allowSubmitOnAssist",
    AUTOFILL_ENABLED_KEY,
    OPENAI_QA_ASSIST_KEY,
    DELETE_AI_CHAT_HISTORY_KEY
  ]);

  await refreshProfiles(data.active_person_id || data.selected_profile_id || DEFAULT_PROFILE_ID);
  await refreshTemplates(data.selected_template_id || DEFAULT_TEMPLATE_ID);
  await loadActivePersonIntoForm();
  await syncActiveTrackUi({ savedTrack: resolveRoleTrackForPerson(await getActivePerson()) });

  jobTitleEl.value = data.last_job_title || "";
  companyNameEl.value = data.last_company_name || "";
  jdLinkEl.value = data.last_jd_link || "";
  jdTextEl.value = data.last_jd_text || "";
  if (oneOffExtraPromptEl) {
    oneOffExtraPromptEl.value = data.last_one_off_extra_prompt || "";
  }
  renderOneOffAts(data[LAST_ONE_OFF_ATS_KEY] || null);
  renderOneOffDraft(data[ONE_OFF_DRAFT_KEY] || null);
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
  renderHumanizeMode(data[STRONG_HUMANIZE_MODE_KEY]);
  renderSfPromptVersion(data[SF_PROMPT_VERSION_KEY]);
  const allowBatch = resolveAllowBatch(data);
  renderAllowBatch(allowBatch, { expandManual: false });
  setManualPanelOpen(
    Boolean(data[MANUAL_PANEL_OPEN_KEY]) || !isAllowBatchEnabled(allowBatch),
    { persist: false }
  );
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
        isBuiltin: isBuiltinJob(j),
        isHimalayas: isHimalayasJob(j),
        isGreenhouse: isGreenhouseJob(j)
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
  if (openaiQaToggleEl) openaiQaToggleEl.checked = data[OPENAI_QA_ASSIST_KEY] !== false;
  if (deleteAiChatToggleEl) deleteAiChatToggleEl.checked = data[DELETE_AI_CHAT_HISTORY_KEY] !== false;
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
      isBuiltin: isBuiltinJob(j),
      isHimalayas: isHimalayasJob(j),
      isGreenhouse: isGreenhouseJob(j)
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
  const builtinTotal = allUsJobsCache.filter((j) => isBuiltinJob(j)).length;
  const himalayasTotal = allUsJobsCache.filter((j) => isHimalayasJob(j)).length;
  const greenhouseTotal = allUsJobsCache.filter((j) => isGreenhouseJob(j)).length;
  const etcTotal = allUsJobsCache.filter(
    (j) =>
      !isDiceJob(j) &&
      !isLinkedInJob(j) &&
      !isIndeedJob(j) &&
      !isJobrightJob(j) &&
      !isWorkdayJob(j) &&
      !isBuiltinJob(j) &&
      !isHimalayasJob(j) &&
      !isGreenhouseJob(j)
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
      : channelFilter === "builtin"
        ? "Builtin only"
      : channelFilter === "himalayas"
        ? "Himalayas only"
      : channelFilter === "greenhouse"
        ? "Greenhouse only"
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
    <p class="summary-meta">Showing ${queueCache.length} of ${allUsJobsCache.length} US jobs (${filterLabel}) · Builtin ${builtinTotal} · Himalayas ${himalayasTotal} · GH ${greenhouseTotal} · Dice ${diceTotal} · LI ${liTotal} · Jobright ${jobrightTotal} · Workday ${workdayTotal} · Etc ${etcTotal} · batch ${batchState}</p>
  `;
  syncBatchPill();
}

function syncChannelFilterButtons() {
  const map = {
    dice: filterDiceBtn,
    linkedin: filterLinkedInBtn,
    jobright: filterJobrightBtn,
    workday: filterWorkdayBtn,
    builtin: filterBuiltinBtn,
    himalayas: filterHimalayasBtn,
    greenhouse: filterGreenhouseBtn,
    indeed: filterIndeedBtn,
    etc: filterEtcBtn,
    all: filterAllBtn
  };
  for (const [key, btn] of Object.entries(map)) {
    if (!btn) continue;
    btn.classList.toggle("active", key === channelFilter);
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
      ? `Dice · ${queueCache.length}`
      : channelFilter === "linkedin"
        ? `LinkedIn · ${queueCache.length}`
        : channelFilter === "jobright"
          ? `Jobright · ${queueCache.length}`
        : channelFilter === "workday"
          ? `Workday · ${queueCache.length}`
        : channelFilter === "builtin"
          ? `Builtin · ${queueCache.length}`
        : channelFilter === "himalayas"
          ? `Himalayas · ${queueCache.length}`
        : channelFilter === "greenhouse"
          ? `Greenhouse · ${queueCache.length}`
        : channelFilter === "etc"
          ? `Other · ${queueCache.length}`
          : `All · ${queueCache.length}`
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
  export: '<path d="M12 3v12"/><path d="m7 14 5 5 5-5"/><path d="M5 21h14"/>',
  scrape:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
  draft:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/>',
  sheet:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h3"/><path d="M13 13h3"/><path d="M8 17h3"/><path d="M13 17h3"/>',
  profileApply:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
  autofill:
    '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  qa: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/>',
  search:
    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  connect:
    '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7.1-7.1l-1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7.1 7.1l1-1"/>',
  disconnect:
    '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7.1-7.1l-1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7.1 7.1l1-1"/><path d="m4 4 16 16"/>',
  mail: '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>'
};

function setIconButton(button, icon, label) {
  button.classList.add("icon-button");
  button.setAttribute("aria-label", label);
  if (label) button.title = label;
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ACTION_ICON_PATHS[icon] || ""}</svg>`;
}

function atsScoreTitle(job) {
  const detail = describeAtsGaps(job?.atsEvaluation || {});
  const lines = [`ATS ${job.atsScore}/100${job.atsGrade ? ` · ${job.atsGrade}` : ""}`];
  if (detail.summary) lines.push(detail.summary);
  for (const f of (detail.findings || []).slice(0, 3)) {
    if (f.kind === "score") continue;
    lines.push(`${f.title}: ${f.body}`);
  }
  return lines.join("\n");
}

function atsGapsHtml(evaluation = {}, { rebuild = false, csvRow = null } = {}) {
  const detail = describeAtsGaps(evaluation);
  const parts = [];

  if (detail.summary) {
    parts.push(`<p class="ats-gap-summary">${escapeHtml(detail.summary)}</p>`);
  }

  const techBlocks = [];
  if (detail.missingProducts?.length) {
    techBlocks.push(
      `<div class="ats-gap-tech-block">` +
        `<h4>Skills &amp; tech to add</h4>` +
        `<ul class="ats-gap-tech-list">${detail.missingProducts
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>` +
        `<p class="ats-gap-tech-hint">Add under a real skills category, then prove in ≥2 recent-role bullets.</p>` +
        `</div>`
    );
  }
  if (detail.skillsOnlyProducts?.length) {
    techBlocks.push(
      `<div class="ats-gap-tech-block is-prove">` +
        `<h4>Already listed — prove in bullets</h4>` +
        `<ul class="ats-gap-tech-list">${detail.skillsOnlyProducts
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>` +
        `<p class="ats-gap-tech-hint">Name each in a concrete story for the two most recent roles.</p>` +
        `</div>`
    );
  }
  if (detail.weaveTech?.length) {
    techBlocks.push(
      `<div class="ats-gap-tech-block is-weave">` +
        `<h4>JD tech language to weave</h4>` +
        `<ul class="ats-gap-tech-list">${detail.weaveTech
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>` +
        `<p class="ats-gap-tech-hint">Use in profile / bullets — not a keyword dump row.</p>` +
        `</div>`
    );
  }
  if (techBlocks.length) {
    parts.push(`<div class="ats-gap-tech">${techBlocks.join("")}</div>`);
  }

  const findings = Array.isArray(detail.findings) ? detail.findings : [];
  const narrative = findings.filter(
    (f) => f.kind === "score" || f.kind === "headline" || f.kind === "recent-roles" || f.kind === "proof" || f.kind === "structure" || f.kind === "weak-areas" || f.kind === "ok" || f.kind === "fallback"
  );
  if (narrative.length) {
    parts.push(
      `<div class="ats-gap-findings">${narrative
        .map(
          (f) =>
            `<article class="ats-gap-finding" data-kind="${escapeHtml(f.kind || "")}">` +
            `<h4>${escapeHtml(f.title || "Finding")}</h4>` +
            `<p>${escapeHtml(f.body || "")}</p>` +
            `</article>`
        )
        .join("")}</div>`
    );
  } else if (!techBlocks.length && detail.tips.length) {
    parts.push(
      `<div class="one-off-ats-gap-group one-off-ats-improve"><strong>What to fix</strong><ul>${detail.tips
        .map((tip) => `<li>${escapeHtml(tip)}</li>`)
        .join("")}</ul></div>`
    );
  }

  const weak = (detail.breakdown || []).filter((b) => b.weak);
  if (weak.length) {
    parts.push(
      `<details class="ats-gap-score-details"><summary>Score detail</summary><ul>${weak
        .map((row) => {
          const match =
            row.total != null && row.matched != null
              ? ` <span class="ats-gap-meta">(${row.matched}/${row.total})</span>`
              : "";
          return `<li class="is-weak"><span>${escapeHtml(row.label)}</span> <strong>${row.score}/${row.max}</strong>${match}</li>`;
        })
        .join("")}</ul></details>`
    );
  }

  const needsRebuild =
    rebuild &&
    detail.rebuildPrompt &&
    (!(Number.isFinite(Number(detail.score)) && Number(detail.score) >= 90) ||
      (detail.findings || []).some((f) => f.kind !== "score" && f.kind !== "ok"));

  if (needsRebuild) {
    const rowAttr =
      csvRow != null && Number.isFinite(Number(csvRow))
        ? ` data-csv-row="${Number(csvRow)}"`
        : ' data-one-off="1"';
    parts.push(
      `<div class="ats-gap-rebuild">` +
        `<button type="button" class="primary compact ats-rebuild-btn"${rowAttr}>Rebuild for gaps</button>` +
        `<p class="ats-gap-rebuild-note">Uses Gaps as an additional prompt (plus Additional prompt if filled).</p>` +
        `</div>`
    );
  }

  if (!parts.length) {
    return `<p class="one-off-ats-gap-empty">No ATS gap details recorded yet.</p>`;
  }
  return parts.join("");
}

function mergeAdditionalPrompt(existing, gapsBlock) {
  const base = String(existing || "").trim();
  const gaps = String(gapsBlock || "").trim();
  if (!gaps) return base;
  if (!base) return gaps;
  if (base.includes("REBUILD FOR ATS GAPS")) {
    return `${base.replace(/REBUILD FOR ATS GAPS[\s\S]*?(?=\n---|$)/, "").trim()}\n\n${gaps}`.trim();
  }
  return `${base}\n\n${gaps}`.trim();
}

async function rebuildFromGaps({ evaluation, csvRow = null, oneOff = false } = {}) {
  const detail = describeAtsGaps(evaluation || {});
  const gapsPrompt = String(detail.rebuildPrompt || "").trim();
  if (!gapsPrompt) {
    setStatus("No Gaps rebuild prompt available.");
    return;
  }

  if (oneOff) {
    const merged = mergeAdditionalPrompt(oneOffExtraPromptEl?.value || "", gapsPrompt);
    if (oneOffExtraPromptEl) oneOffExtraPromptEl.value = merged;
    await persistJobFields().catch(() => {});
    setStatus("Rebuilding draft from Gaps…");
    await runOneOffDraft({ regenerate: true, forceRebuild: true });
    return;
  }

  if (csvRow == null || !Number.isFinite(Number(csvRow))) {
    setStatus("Missing queue row for rebuild.");
    return;
  }
  const row = Number(csvRow);
  const job = queueCache.find((j) => Number(j.csvRow) === row);
  if (!job) {
    setStatus(`Row ${row} not in queue.`);
    return;
  }
  const merged = mergeAdditionalPrompt(job.additionalPrompt || "", gapsPrompt);
  const { outputDir } = await resolveUiOutputDir();
  setStatus(`Rebuilding row ${row} from Gaps…`);
  openAtsGapsRows.add(row);
  try {
    const res = await chrome.runtime.sendMessage({
      type: "retry_job",
      csvRow: row,
      outputDir,
      additionalPrompt: merged,
      forceRebuild: true
    });
    if (!res?.ok) {
      setStatus(res?.error || `Rebuild row ${row} failed.`);
      return;
    }
    queueCache = queueCache.map((j) =>
      Number(j.csvRow) === row
        ? { ...j, status: "pending", attempts: 0, error: "", additionalPrompt: merged }
        : j
    );
    renderQueue();
    updateCsvSummaryFromQueue();
    setStatus(res.status || `Row ${row} rebuilding…`);
    await loadSettings().catch(() => {});
  } catch (err) {
    setStatus(`Rebuild failed: ${String(err?.message || err)}`);
  }
}

function wireAtsGapsActions(panel, { csvRow = null, oneOff = false, evaluation = null } = {}) {
  if (!panel) return;
  const btn = panel.querySelector(".ats-rebuild-btn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    rebuildFromGaps({
      evaluation,
      csvRow: csvRow != null ? Number(csvRow) : Number(btn.dataset.csvRow),
      oneOff: oneOff || btn.dataset.oneOff === "1"
    }).catch((err) => setStatus(String(err?.message || err)));
  });
}

function wireAtsGapsToggle(button, panel, csvRow) {
  if (!button || !panel) return;
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.textContent = open ? "Hide" : "Gaps";
    const key = Number(csvRow);
    if (!Number.isFinite(key)) return;
    if (open) openAtsGapsRows.add(key);
    else openAtsGapsRows.delete(key);
  });
}

function queueRenderSignature(jobs) {
  return (Array.isArray(jobs) ? jobs : [])
    .map((j) =>
      [
        j?.csvRow,
        j?.status,
        j?.applied ? 1 : 0,
        j?.atsScore ?? "",
        j?.atsGrade || "",
        j?.jobDir || "",
        j?.error || "",
        j?.inactive ? 1 : 0,
        j?.atsEvaluation ? 1 : 0
      ].join(":")
    )
    .join("|");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hasUsableOneOffDraft(draft = oneOffDraftCache) {
  return Boolean(draft?.resumeData && typeof draft.resumeData === "object");
}

/** Sheet/link duplicate blocked the last draft — next Draft should force. */
function oneOffNeedsForceDraft() {
  if (hasUsableOneOffDraft()) return false;
  if (lastOneOffAtsCache?.ok) return false;
  const err = String(lastOneOffAtsCache?.error || "").toLowerCase();
  return /sheet|duplicate|already on|already applied/.test(err);
}

function syncOneOffActionButtons({ busy = document.body.classList.contains("is-busy") } = {}) {
  const draftReady = hasUsableOneOffDraft();
  if (oneOffIdleActionsEl) oneOffIdleActionsEl.hidden = draftReady;
  if (oneOffDraftActionsEl) oneOffDraftActionsEl.hidden = !draftReady;
  if (oneOffAdditionalPromptFieldEl) oneOffAdditionalPromptFieldEl.hidden = !draftReady;

  if (runOneOffBtn) {
    runOneOffBtn.disabled = busy;
    const force = oneOffNeedsForceDraft();
    setIconButton(
      runOneOffBtn,
      force ? "retry" : "draft",
      force ? "Force Generate Draft Version" : "Generate Draft Version"
    );
  }
  if (logProfileApplyBtn) {
    logProfileApplyBtn.disabled = busy;
    setIconButton(logProfileApplyBtn, "profileApply", "Log apply — save JD and mark Applied");
  }
  if (emailBidPrepareBtn) {
    emailBidPrepareBtn.disabled = busy;
    setIconButton(emailBidPrepareBtn, "search", "Find contacts & draft (Email Bid)");
  }
  if (regenerateOneOffBtn) {
    regenerateOneOffBtn.disabled = busy || !draftReady;
    const score = Number(lastOneOffAtsCache?.atsScore);
    const needsGaps = draftReady && Number.isFinite(score) && score < 90;
    regenerateOneOffBtn.textContent = needsGaps ? "Regenerate for gaps" : "Regenerate";
    regenerateOneOffBtn.title = needsGaps
      ? "Rebuild using Gaps and Additional prompt"
      : "Re-run AI with current fields and additional prompt";
  }
  if (confirmOneOffBtn) confirmOneOffBtn.disabled = busy || !draftReady;
  if (discardOneOffBtn) discardOneOffBtn.disabled = busy || !draftReady;
  if (openOneOffPreviewBtn) openOneOffPreviewBtn.disabled = busy || !draftReady;
}

function renderOneOffDraft(draft) {
  oneOffDraftCache = draft && typeof draft === "object" ? draft : null;
  syncOneOffActionButtons();
}

function renderOneOffAts(payload) {
  lastOneOffAtsCache = payload && typeof payload === "object" ? payload : null;
  if (!oneOffAtsBlock || !oneOffAtsScoreEl) {
    syncOneOffActionButtons();
    return;
  }
  const scoreRaw = payload?.atsScore;
  const hasScore = scoreRaw != null && Number.isFinite(Number(scoreRaw));
  if (!hasScore) {
    oneOffAtsBlock.hidden = true;
    if (oneOffAtsGapsEl) {
      oneOffAtsGapsEl.hidden = true;
      oneOffAtsGapsEl.innerHTML = "";
    }
    if (oneOffViewGapsBtn) oneOffViewGapsBtn.setAttribute("aria-expanded", "false");
    syncOneOffActionButtons();
    return;
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(scoreRaw))));
  const grade = String(payload.atsGrade || "").trim();
  const tier =
    score >= 85 ? "is-excellent" : score >= 70 ? "is-good" : score >= 55 ? "is-fair" : "is-low";
  oneOffAtsBlock.hidden = false;
  oneOffAtsScoreEl.className = `ats-score ${tier}`;
  oneOffAtsScoreEl.style.setProperty("--ats", String(score));
  oneOffAtsScoreEl.title = atsScoreTitle({
    atsScore: score,
    atsGrade: grade,
    atsEvaluation: payload.atsEvaluation || {}
  });
  oneOffAtsScoreEl.setAttribute(
    "aria-label",
    `ATS match ${score} out of 100${grade ? `, ${grade}` : ""}`
  );
  oneOffAtsScoreEl.innerHTML =
    `<span class="ats-score-kicker">ATS</span>` +
    `<span class="ats-score-value">${score}</span>` +
    (grade
      ? `<span class="ats-score-grade">${escapeHtml(grade)}</span>`
      : `<span class="ats-score-grade ats-score-grade-empty"></span>`) +
    `<span class="ats-score-meter" aria-hidden="true"><span class="ats-score-fill"></span></span>`;
  if (oneOffAtsGapsEl) {
    oneOffAtsGapsEl.innerHTML = atsGapsHtml(payload.atsEvaluation || {}, { rebuild: true });
    const openGaps = score < 90;
    oneOffAtsGapsEl.hidden = !openGaps;
    wireAtsGapsActions(oneOffAtsGapsEl, {
      oneOff: true,
      evaluation: payload.atsEvaluation || {}
    });
  }
  if (oneOffViewGapsBtn) {
    const openGaps = score < 90;
    oneOffViewGapsBtn.setAttribute("aria-expanded", openGaps ? "true" : "false");
    oneOffViewGapsBtn.textContent = openGaps ? "Hide" : "Gaps";
  }
  syncOneOffActionButtons();
}

/** CSV row the batch is actively generating or Dice-applying (status line or running badge). */
function resolveCurrentWorkCsvRow() {
  const running = queueCache.find((j) => j.status === "running");
  if (running?.csvRow != null && running.csvRow !== "") return Number(running.csvRow);
  const m = String(lastStatusText || "").match(/\brow\s+(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

function resolveCurrentWorkJob() {
  const row = resolveCurrentWorkCsvRow();
  if (row == null || !Number.isFinite(row)) return null;
  return queueCache.find((j) => Number(j.csvRow) === row) || { csvRow: row };
}

/** Sticky strip above the list — always shows the active row while batch runs (no auto-scroll). */
function renderCurrentWorkIndicator() {
  if (!queueNowWorkingEl) return;
  const busy =
    batchState === "running" ||
    batchState === "paused" ||
    document.body.classList.contains("is-busy") ||
    queueCache.some((j) => j.status === "running");
  const job = resolveCurrentWorkJob();
  if (!busy || !job || job.csvRow == null || job.csvRow === "") {
    queueNowWorkingEl.hidden = true;
    queueNowWorkingEl.replaceChildren();
    queueNowWorkingEl.removeAttribute("data-csv-row");
    queueNowWorkingEl.removeAttribute("tabindex");
    queueNowWorkingEl.removeAttribute("title");
    return;
  }

  const row = Number(job.csvRow);
  const title = String(job.title || "").trim() || "Working…";
  const company = String(job.company || "").trim();
  const phase =
    job.status === "running"
      ? "Generating"
      : /\bauto-apply\b/i.test(lastStatusText)
        ? "Applying"
        : batchState === "paused"
          ? "Paused on"
          : "Working";

  queueNowWorkingEl.hidden = false;
  queueNowWorkingEl.dataset.csvRow = String(row);
  queueNowWorkingEl.tabIndex = 0;
  queueNowWorkingEl.removeAttribute("title");
  queueNowWorkingEl.replaceChildren();

  const kicker = document.createElement("span");
  kicker.className = "now-kicker";
  kicker.textContent = "Now";

  const body = document.createElement("div");
  body.className = "now-body";
  const titleEl = document.createElement("div");
  titleEl.className = "now-title";
  titleEl.append(`${phase} `);
  const rowEl = document.createElement("span");
  rowEl.className = "now-row";
  rowEl.textContent = `row ${row}`;
  titleEl.appendChild(rowEl);
  titleEl.append(` · ${title}`);
  const subEl = document.createElement("div");
  subEl.className = "now-sub";
  subEl.textContent = company || lastStatusText || "Batch in progress";
  body.appendChild(titleEl);
  body.appendChild(subEl);

  queueNowWorkingEl.appendChild(kicker);
  queueNowWorkingEl.appendChild(body);
}

function jumpQueueToCurrentWork() {
  if (!queueListEl || !queueNowWorkingEl) return;
  const row = Number(queueNowWorkingEl.dataset.csvRow || "");
  if (!Number.isFinite(row)) return;
  const el = queueListEl.querySelector(`.queue-item[data-csv-row="${row}"]`);
  if (!el) return;
  scrollQueueItemIntoView(queueListEl, el, { smooth: true });
  el.classList.add("is-current");
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
      "<p>Queue is empty</p>";
    queueListEl.appendChild(empty);
    lastQueueFollowRow = null;
    queueListScrollTop = 0;
    renderCurrentWorkIndicator();
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
    if (currentRow != null && Number(job.csvRow) === currentRow) {
      const nowBadge = document.createElement("span");
      nowBadge.className = "badge badge-now";
      nowBadge.textContent = "Now";
      nowBadge.removeAttribute("title");
      badges.appendChild(nowBadge);
    }
    const badge = document.createElement("span");
    badge.className = badgeClass(job.status);
    badge.textContent = job.status || "pending";
    badges.appendChild(badge);
    let atsScoreEl = null;
    let atsGapsWrap = null;
    if (job.atsScore != null && Number.isFinite(Number(job.atsScore))) {
      const score = Math.max(0, Math.min(100, Math.round(Number(job.atsScore))));
      const grade = String(job.atsGrade || "").trim();
      const tier =
        score >= 85 ? "is-excellent" : score >= 70 ? "is-good" : score >= 55 ? "is-fair" : "is-low";
      atsScoreEl = document.createElement("div");
      atsScoreEl.className = "queue-ats-block";
      const scoreBadge = document.createElement("div");
      scoreBadge.className = `ats-score ${tier}`;
      scoreBadge.style.setProperty("--ats", String(score));
      scoreBadge.title = atsScoreTitle(job);
      scoreBadge.setAttribute(
        "aria-label",
        `ATS match ${score} out of 100${grade ? `, ${grade}` : ""}`
      );
      scoreBadge.innerHTML =
        `<span class="ats-score-kicker">ATS</span>` +
        `<span class="ats-score-value">${score}</span>` +
        (grade
          ? `<span class="ats-score-grade">${escapeHtml(grade)}</span>`
          : `<span class="ats-score-grade ats-score-grade-empty"></span>`) +
        `<span class="ats-score-meter" aria-hidden="true"><span class="ats-score-fill"></span></span>`;
      atsScoreEl.appendChild(scoreBadge);

      if (job.atsEvaluation) {
        const gapsOpen = openAtsGapsRows.has(Number(job.csvRow));
        const gapsBtn = document.createElement("button");
        gapsBtn.type = "button";
        gapsBtn.className = "ghost compact ats-gaps-toggle";
        gapsBtn.textContent = gapsOpen ? "Hide" : "Gaps";
        gapsBtn.setAttribute("aria-expanded", gapsOpen ? "true" : "false");
        gapsBtn.removeAttribute("title");
        const gapsPanel = document.createElement("div");
        gapsPanel.className = "one-off-ats-gaps queue-ats-gaps";
        gapsPanel.hidden = !gapsOpen;
        gapsPanel.innerHTML = atsGapsHtml(job.atsEvaluation, {
          rebuild: true,
          csvRow: job.csvRow
        });
        wireAtsGapsToggle(gapsBtn, gapsPanel, job.csvRow);
        wireAtsGapsActions(gapsPanel, {
          csvRow: job.csvRow,
          evaluation: job.atsEvaluation
        });
        atsScoreEl.appendChild(gapsBtn);
        atsGapsWrap = gapsPanel;
      }
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
    if (isBuiltinJob(job)) {
      const builtinBadge = document.createElement("span");
      builtinBadge.className = "badge badge-builtin";
      builtinBadge.textContent = "Builtin";
      badges.appendChild(builtinBadge);
    }
    if (isHimalayasJob(job)) {
      const himalayasBadge = document.createElement("span");
      himalayasBadge.className = "badge badge-himalayas";
      himalayasBadge.textContent = "Himalayas";
      badges.appendChild(himalayasBadge);
    }
    if (isGreenhouseJob(job)) {
      const ghBadge = document.createElement("span");
      ghBadge.className = "badge badge-greenhouse";
      ghBadge.textContent = "Greenhouse";
      badges.appendChild(ghBadge);
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
      inactiveBadge.title = "Inactive";
      badges.appendChild(inactiveBadge);
    }
    meta.appendChild(title);
    meta.appendChild(sub);
    meta.appendChild(badges);
    if (atsScoreEl) meta.appendChild(atsScoreEl);
    if (atsGapsWrap) meta.appendChild(atsGapsWrap);
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
    setIconButton(removeBtn, "remove", "Remove");
    removeBtn.removeAttribute("title");
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
      retryBtn.removeAttribute("title");
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
              ? "Continue apply"
              : "Apply to job"
    );
    applyBtn.title = inactiveJob
      ? "Inactive"
      : !canApply
        ? "Files not ready"
        : job.applied
          ? appliedDocsTitle(job)
          : sheetReadyContinue && !filesReady
            ? "Continue apply"
            : "Apply";
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

  renderCurrentWorkIndicator();

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
    csvExtensionIdHintEl.textContent = id ? `Ext ID: ${id}` : "";
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
      ? `Auto-source · every ${res.alarm.minutes}m`
      : "Auto-source saved."
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
      : `Pinned ${file.name} · +${ingest.added || 0} · ${ingest.pending || 0} pending`
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
            : `Refreshed · +${ingest.added || 0} · ${ingest.pending || 0} pending`
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
        : `Refreshed (${res.via || "source"}) · +${r.added || 0} · ${r.pending || 0} pending`
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
  setStatus("Refresh done.");
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
      `Loaded ${result.totalRows} → ${allUsJobsCache.length} US` +
        (result.droppedNonUs ? ` · dropped ${result.droppedNonUs} non-US` : "") +
        `${dedupeNote}`
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

  setStatus("Opening job…");
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
    setStatus(res.status || "Auto apply running.");
    return;
  }
  if (res?.autofillSkipped || res?.openedOnly) {
    setStatus(res.status || "Opening job — recording Applied on sheet…");
    return;
  }
  setStatus(res.status || "Apply started.");
}

async function sendBatch(type) {
  const { outputDir } = await resolveUiOutputDir();
  await chrome.storage.local.set({ output_dir: outputDir, batch_output_dir: outputDir });
  const res = await chrome.runtime.sendMessage({ type, outputDir });
  if (!res?.ok) {
    setStatus(res?.error || `Batch ${type} failed.`);
    return;
  }
  if (type === "batch_start" || type === "batch_resume") {
    setStatus(res.status || "Batch started.");
    return;
  }
  setStatus(res.status || `Batch ${type} ok.`);
}

async function retryOneJob(job) {
  if (!job || job.csvRow == null) return;
  const { outputDir } = await resolveUiOutputDir();
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
  const { outputDir } = await resolveUiOutputDir();
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

async function onProfileChange() {
  const profileId = profileSelectEl.value;
  syncActivePersonChip();
  await setActivePersonId(profileId);
  await loadActivePersonIntoForm();
  const person = await getActivePerson();
  const rules = resolveExperienceRulesForPerson(person);
  const { resumeFilePrefix } = await syncActivePersonOutputContext(person);
  await chrome.storage.local.set({
    resume_file_prefix: resumeFilePrefix,
    experience_validation_rules: rules,
    experience_validation_person: person.name || person.label || ""
  });
}

async function copyAppsScript() {
  try {
    const res = await fetch(chrome.runtime.getURL("apps-script/Code.gs"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    await navigator.clipboard.writeText(text);
    setStatus("Apps Script copied.");
  } catch {
    setStatus("Could not copy. Open apps-script/Code.gs instead.");
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

function parseStyleExportPaste() {
  const raw = String(styleExportPasteEl?.value || "").trim();
  if (!raw) throw new Error("Paste resume text first.");
  const person = profilesCache.find((p) => p.id === profileSelectEl?.value) || null;
  const resumeData = resolvePastedResume(raw, { person });
  if (!isStyledExportResume(resumeData)) {
    throw new Error("Could not build a resume from that paste. Include a name and body text.");
  }
  return resumeData;
}

const STYLE_EXPORT_PASTE_KEY = "style_export_paste_json";

async function clearStyleExport() {
  if (styleExportPasteEl) styleExportPasteEl.value = "";
  if (jobTitleEl) jobTitleEl.value = "";
  if (companyNameEl) companyNameEl.value = "";
  if (jdLinkEl) jdLinkEl.value = "";
  if (jdTextEl) jdTextEl.value = "";
  await chrome.storage.local.remove(STYLE_EXPORT_PASTE_KEY).catch(() => {});
  await persistJobFields().catch(() => {});
  setStatus("Cleared paste and job details.");
}

async function openStyleExportPreview(templateId = "") {
  const resumeData = parseStyleExportPaste();
  const tid =
    String(templateId || templateSelectEl?.value || DEFAULT_TEMPLATE_ID).trim() || DEFAULT_TEMPLATE_ID;
  await chrome.storage.local.set({
    [STYLE_EXPORT_PASTE_KEY]: resumeData,
    selected_template_id: tid
  });
  if (templateSelectEl && tid) templateSelectEl.value = tid;

  const url = chrome.runtime.getURL(
    `preview.html?source=paste&template=${encodeURIComponent(tid)}`
  );
  const stored = (await chrome.storage.local.get(PREVIEW_WINDOW_KEY))[PREVIEW_WINDOW_KEY];
  if (stored != null) {
    try {
      await chrome.windows.update(stored, { focused: true, drawAttention: true });
      await chrome.runtime
        .sendMessage({ type: "template_preview_show", templateId: tid, source: "paste" })
        .catch(() => {});
      setStatus("Preview focused.");
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
  setStatus("Opened resume preview.");
}

async function exportStyleExportPdf() {
  const raw = String(styleExportPasteEl?.value || "").trim();
  if (!raw) {
    setStatus("Paste resume text first.");
    return;
  }
  parseStyleExportPaste();

  const storedTemplate = (await chrome.storage.local.get("selected_template_id")).selected_template_id;
  const activeTemplateId =
    String(storedTemplate || templateSelectEl?.value || DEFAULT_TEMPLATE_ID).trim() || DEFAULT_TEMPLATE_ID;
  if (templateSelectEl && templateSelectEl.value !== activeTemplateId) {
    templateSelectEl.value = activeTemplateId;
  }

  const details = await jobDetailsDialog({
    title: "Export resume PDF",
    confirmText: "Export & save",
    previewText: "Preview",
    templates: templatesCache.length ? templatesCache : getAllTemplates(),
    initial: {
      jobTitle: (jobTitleEl?.value || "").trim(),
      companyName: (companyNameEl?.value || "").trim(),
      jdLink: (jdLinkEl?.value || "").trim(),
      jdText: (jdTextEl?.value || "").trim(),
      templateId: activeTemplateId
    },
    onPreview: async ({ templateId }) => {
      await openStyleExportPreview(templateId);
    }
  });
  if (!details) {
    setStatus("Export cancelled.");
    return;
  }

  // Keep Manual Bid fields + active style in sync.
  if (jobTitleEl) jobTitleEl.value = details.jobTitle;
  if (companyNameEl) companyNameEl.value = details.companyName;
  if (jdLinkEl) jdLinkEl.value = details.jdLink;
  if (jdTextEl) jdTextEl.value = details.jdText;
  const templateId = details.templateId || templateSelectEl?.value || DEFAULT_TEMPLATE_ID;
  if (templateSelectEl && templateId) {
    templateSelectEl.value = templateId;
    chrome.storage.local.set({ selected_template_id: templateId }).catch(() => {});
  }

  const { outputDir, person } = await resolveUiOutputDir();
  await persistJobFields();
  setBusy(true);
  setStatus("Exporting resume + recording on Google Sheet…");
  const res = await chrome.runtime.sendMessage({
    type: "export_styled_resume_pdf",
    jsonText: raw,
    templateId,
    jobMeta: {
      ...details,
      outputDir,
      templateId,
      spreadsheetUrl: spreadsheetUrlEl.value.trim(),
      sheetsWebAppUrl: sheetsWebAppUrlEl.value.trim(),
      sheetTabName: (sheetTabNameEl?.value || "").trim(),
      resumeFilePrefix: person?.resumeFilePrefix || resumeFilePrefixFromName(person?.name || person?.label),
      profileId: person?.id || "",
      bidSource: "one-off"
    }
  });
  if (!res?.ok) {
    setStatus(res?.error || "Style export failed to start.");
    setBusy(false);
  }
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

function setSheetPanelOpen(open) {
  if (!sheetPanelBody || !toggleSheetPanelBtn) return;
  sheetPanelBody.hidden = !open;
  toggleSheetPanelBtn.setAttribute("aria-expanded", open ? "true" : "false");
  toggleSheetPanelBtn.textContent = open
    ? "Hide Google Sheet & saves"
    : "Show Google Sheet & saves";
}

function setPacingSlackPanelOpen(open) {
  if (!pacingSlackPanelBody || !togglePacingSlackPanelBtn) return;
  pacingSlackPanelBody.hidden = !open;
  togglePacingSlackPanelBtn.setAttribute("aria-expanded", open ? "true" : "false");
  togglePacingSlackPanelBtn.textContent = open
    ? "Hide pacing & Slack"
    : "Show pacing & Slack";
}

function normalizeAllowBatch(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  if (
    v === ALLOW_BATCH.NO ||
    v === "false" ||
    v === "0" ||
    v === "off" ||
    v === "non_us" ||
    v === "nonus" ||
    v === "not_us" ||
    v === "intl" ||
    v === "international"
  ) {
    return ALLOW_BATCH.NO;
  }
  if (
    v === ALLOW_BATCH.YES ||
    v === "true" ||
    v === "1" ||
    v === "on" ||
    v === "us"
  ) {
    return ALLOW_BATCH.YES;
  }
  return DEFAULT_ALLOW_BATCH;
}

/** Prefer allow_batch_process; fall back to legacy bid_market (us / non_us). */
function resolveAllowBatch(data = {}) {
  if (data[ALLOW_BATCH_KEY] !== undefined && data[ALLOW_BATCH_KEY] !== null && data[ALLOW_BATCH_KEY] !== "") {
    return normalizeAllowBatch(data[ALLOW_BATCH_KEY]);
  }
  if (data[LEGACY_BID_MARKET_KEY] !== undefined && data[LEGACY_BID_MARKET_KEY] !== null) {
    return normalizeAllowBatch(data[LEGACY_BID_MARKET_KEY]);
  }
  return DEFAULT_ALLOW_BATCH;
}

function isAllowBatchEnabled(value = allowBatchCache) {
  return normalizeAllowBatch(value) === ALLOW_BATCH.YES;
}

function renderAllowBatch(value, { expandManual = false } = {}) {
  allowBatchCache = normalizeAllowBatch(value);
  const batchOff = !isAllowBatchEnabled(allowBatchCache);
  document.body.classList.toggle("batch-process-off", batchOff);
  document.body.classList.toggle("batch-process-on", !batchOff);

  for (const btn of [allowBatchYesBtn, allowBatchNoBtn]) {
    if (!btn) continue;
    const active = btn.dataset.allowBatch === allowBatchCache;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }

  if (jobsSectionEl) {
    jobsSectionEl.hidden = batchOff;
    jobsSectionEl.setAttribute("aria-hidden", batchOff ? "true" : "false");
  }
  // Indeed grab stays product-hidden; never surface it when batch is off.
  if (indeedSectionEl && batchOff) {
    indeedSectionEl.hidden = true;
    indeedSectionEl.setAttribute("aria-hidden", "true");
  }

  if (jobsStepNumEl) jobsStepNumEl.textContent = "4";
  if (applyStepNumEl) applyStepNumEl.textContent = batchOff ? "4" : "5";
  if (manualStepNumEl) manualStepNumEl.textContent = batchOff ? "5" : "6";
  if (manualSectionTitleEl) {
    manualSectionTitleEl.textContent = "Manual bid";
  }
  if (manualSectionEl) {
    manualSectionEl.classList.toggle("section-hero", batchOff);
  }

  if (batchOff && expandManual) {
    setManualPanelOpen(true);
  }
}

async function setAllowBatch(value) {
  const next = normalizeAllowBatch(value);
  const prev = allowBatchCache;
  renderAllowBatch(next, { expandManual: next === ALLOW_BATCH.NO });
  await chrome.storage.local.set({ [ALLOW_BATCH_KEY]: next });
  if (next === ALLOW_BATCH.NO && prev !== ALLOW_BATCH.NO) {
    setStatus("Batch off.");
  } else if (next === ALLOW_BATCH.YES && prev !== ALLOW_BATCH.YES) {
    setStatus("Batch on.");
  }
}

function setBusy(busy) {
  batchStartBtn.disabled = busy && batchState === "running";
  if (fillFromOpenTabBtn) fillFromOpenTabBtn.disabled = busy;
  if (clearOneOffFieldsBtn) clearOneOffFieldsBtn.disabled = busy;
  document.body.classList.toggle("is-busy", Boolean(busy));
  syncOneOffActionButtons({ busy: Boolean(busy) });
  syncBatchPill();
}

async function clearOneOffJobFields() {
  if (jobTitleEl) jobTitleEl.value = "";
  if (companyNameEl) companyNameEl.value = "";
  if (jdLinkEl) jdLinkEl.value = "";
  if (jdTextEl) jdTextEl.value = "";
  if (oneOffExtraPromptEl) oneOffExtraPromptEl.value = "";
  emailBidUi?.clearEmailDraft?.();
  await persistJobFields().catch(() => {});
  setStatus("Cleared job fields.");
}

async function fillFromOpenTab() {
  setStatus("Scraping active tab…");
  try {
    const res = await chrome.runtime.sendMessage({ type: "scrape_active_job_tab" });
    if (!res?.ok) {
      setStatus(res?.error || "Could not scrape this tab.");
      return;
    }
    if (res.jobTitle) jobTitleEl.value = res.jobTitle;
    if (res.companyName) companyNameEl.value = res.companyName;
    if (res.jdLink) jdLinkEl.value = res.jdLink;
    if (res.jdText) jdTextEl.value = res.jdText;
    await persistJobFields();
    setManualPanelOpen(true);
    const site = res.site ? ` (${res.site})` : "";
    const jdLen = String(res.jdText || "").trim().length;
    const jdNote = jdLen
      ? ` · ${jdLen >= 1000 ? `${(jdLen / 1000).toFixed(1)}k` : jdLen} chars`
      : " · JD empty";
    const companyNote = String(res.companyName || "").trim() ? "" : " · no company";
    setStatus(`Filled from tab${site}${jdNote}${companyNote}.`);
    syncOneOffActionButtons();
  } catch (err) {
    setStatus(`Scrape failed: ${String(err?.message || err)}`);
  }
}

function buildOneOffJobMeta(person, outputDir, { forceRebuild = false } = {}) {
  return {
    jobTitle: (jobTitleEl.value || "").trim(),
    companyName: (companyNameEl.value || "").trim(),
    jdLink: (jdLinkEl.value || "").trim(),
    jdText: (jdTextEl.value || "").trim(),
    additionalPrompt: (oneOffExtraPromptEl?.value || "").trim(),
    forceRebuild: Boolean(forceRebuild),
    outputDir,
    spreadsheetUrl: spreadsheetUrlEl.value.trim(),
    sheetsWebAppUrl: sheetsWebAppUrlEl.value.trim(),
    templateId: templateSelectEl.value || person.templateId || DEFAULT_TEMPLATE_ID,
    resumeFilePrefix: person.resumeFilePrefix || resumeFilePrefixFromName(person.name || person.label),
    profileId: person.id,
    bidSource: "one-off"
  };
}

async function openOneOffDraftPreview(templateId = "") {
  const draft = oneOffDraftCache || (await chrome.storage.local.get(ONE_OFF_DRAFT_KEY))[ONE_OFF_DRAFT_KEY];
  const tid =
    String(templateId || draft?.templateId || draft?.jobMeta?.templateId || templateSelectEl.value || DEFAULT_TEMPLATE_ID).trim() ||
    DEFAULT_TEMPLATE_ID;
  const url = chrome.runtime.getURL(
    `preview.html?source=draft&template=${encodeURIComponent(tid)}`
  );
  const stored = (await chrome.storage.local.get(PREVIEW_WINDOW_KEY))[PREVIEW_WINDOW_KEY];
  if (stored != null) {
    try {
      await chrome.windows.update(stored, { focused: true, drawAttention: true });
      await chrome.runtime
        .sendMessage({ type: "template_preview_show", templateId: tid, source: "draft" })
        .catch(() => {});
      setStatus("Draft preview focused.");
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
  setStatus("Draft preview opened.");
}

async function runOneOffDraft({ forceRebuild = false, regenerate = false } = {}) {
  const jobTitle = (jobTitleEl.value || "").trim();
  const companyName = (companyNameEl.value || "").trim();
  const jd = (jdTextEl.value || "").trim();
  const { outputDir, person } = await resolveUiOutputDir();

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

  if (!person?.promptTemplate?.includes("{JD}")) {
    setStatus("Prompt needs {JD}.");
    return;
  }
  if (!person.masterResume?.trim() && person.promptTemplate.includes("{MASTER_RESUME}")) {
    setStatus("Master resume required.");
    return;
  }

  await persistJobFields();
  setBusy(true);
  setManualPanelOpen(true);
  setStatus(
    regenerate
      ? "Regenerating draft…"
      : forceRebuild
        ? "Force drafting…"
        : "Drafting resume (no files yet)…"
  );

  const res = await chrome.runtime.sendMessage({
    type: "draft_one_off",
    forceRebuild: Boolean(forceRebuild),
    regenerate: Boolean(regenerate),
    jobMeta: buildOneOffJobMeta(person, outputDir, { forceRebuild: forceRebuild || regenerate })
  });

  if (!res?.ok) {
    setStatus(res?.error || "Draft failed to start.");
    setBusy(false);
  }
}

async function confirmOneOffSave() {
  if (!hasUsableOneOffDraft()) {
    setStatus("No draft to confirm. Generate a draft first.");
    return;
  }
  const { outputDir, person } = await resolveUiOutputDir();
  await persistJobFields();
  setBusy(true);
  setManualPanelOpen(true);
  setStatus("Confirming draft — saving resume…");

  const res = await chrome.runtime.sendMessage({
    type: "confirm_one_off",
    jobMeta: {
      outputDir,
      templateId: templateSelectEl.value || person?.templateId || DEFAULT_TEMPLATE_ID,
      spreadsheetUrl: spreadsheetUrlEl.value.trim(),
      sheetsWebAppUrl: sheetsWebAppUrlEl.value.trim(),
      jobTitle: jobTitleEl?.value?.trim() || "",
      companyName: companyNameEl?.value?.trim() || "",
      jdLink: jdLinkEl?.value?.trim() || "",
      jdText: jdTextEl?.value?.trim() || ""
    }
  });

  if (!res?.ok) {
    setStatus(res?.error || "Confirm failed to start.");
    setBusy(false);
  }
}

/** Save jd.txt and mark sheet Applied (Profile apply). No AI / PDF. */
async function logProfileApply() {
  const jobTitle = (jobTitleEl.value || "").trim();
  const companyName = (companyNameEl.value || "").trim();
  const jdLink = (jdLinkEl.value || "").trim();
  const jdText = (jdTextEl.value || "").trim();
  const { outputDir, person } = await resolveUiOutputDir();

  if (!jobTitle && !companyName) {
    setStatus("Enter a job title or company first.");
    return;
  }
  if (!jdLink && !jdText) {
    setStatus("Add a JD link or paste the job description first.");
    return;
  }

  await persistJobFields();
  setBusy(true);
  setManualPanelOpen(true);
  setStatus("Logging profile apply — saving JD…");

  try {
    const res = await chrome.runtime.sendMessage({
      type: "log_profile_apply",
      jobMeta: {
        jobTitle,
        companyName,
        jdLink,
        jdText,
        outputDir,
        spreadsheetUrl: spreadsheetUrlEl.value.trim(),
        sheetsWebAppUrl: sheetsWebAppUrlEl.value.trim(),
        profileId: person?.id || "",
        resumeFilePrefix: person?.resumeFilePrefix || resumeFilePrefixFromName(person?.name || person?.label),
        bidSource: "profile-apply"
      }
    });
    if (!res?.ok) {
      setStatus(res?.error || "Log apply failed.");
      return;
    }
    if (res.duplicate) {
      setStatus(res.status || "Already Applied on sheet — not re-logged.");
      return;
    }
    setStatus(res.status || "Logged profile apply.");
  } catch (err) {
    setStatus(`Log apply failed: ${String(err?.message || err)}`);
  } finally {
    setBusy(false);
  }
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
    setStatus("Autofill is off.");
    return;
  }
  autofillPageBtn.disabled = true;
  autoApplyPageBtn.disabled = true;
  if (customQaPageBtn) customQaPageBtn.disabled = true;
  try {
    setStatus("Autofilling…");
    const res = await chrome.runtime.sendMessage({ type: "autofill_active_tab" });
    if (!res?.ok) {
      setStatus(res?.error || "Autofill failed.");
      return;
    }
    setStatus(res.statusText || formatAutofillSummary(res) || "Autofill complete.");
  } finally {
    syncAutofillUi();
  }
}

async function autoApplyThisPage() {
  if (!autofillEnabledCache) {
    setStatus("Autofill is off.");
    return;
  }
  const allowSubmit = Boolean(allowSubmitToggleEl?.checked);
  autofillPageBtn.disabled = true;
  autoApplyPageBtn.disabled = true;
  if (customQaPageBtn) customQaPageBtn.disabled = true;
  try {
    setStatus(allowSubmit ? "Auto Apply…" : "Auto Apply (no submit)…");
    const res = await chrome.runtime.sendMessage({
      type: "autofill_multi_step",
      allowSubmitOnAssist: allowSubmit
    });
    if (!res?.ok) {
      setStatus(res?.error || "Auto Apply failed.");
      return;
    }
    setStatus(res.status || res.detail || res.statusText || formatAutofillSummary(res) || "Auto Apply finished.");
  } finally {
    syncAutofillUi();
  }
}

async function customQaThisPage() {
  if (!autofillEnabledCache) {
    setStatus("Autofill is off.");
    return;
  }
  if (openaiQaToggleEl && !openaiQaToggleEl.checked) {
    setStatus("OpenAI Custom Q&A is off.");
    return;
  }
  autofillPageBtn.disabled = true;
  autoApplyPageBtn.disabled = true;
  if (customQaPageBtn) customQaPageBtn.disabled = true;
  if (customQaScanPageBtn) customQaScanPageBtn.disabled = true;
  try {
    setStatus("Custom Q&A…");
    const res = await chrome.runtime.sendMessage({ type: "autofill_openai_qa" });
    if (!res?.ok) {
      setStatus(res?.error || "Custom Q&A failed.");
      return;
    }
    setStatus(res.statusText || formatAutofillSummary(res) || "Custom Q&A complete.");
  } finally {
    syncAutofillUi();
  }
}

function selectedCustomQaEngine() {
  const el = document.querySelector('input[name="customQaEngine"]:checked');
  return el?.value === "chatgpt" ? "chatgpt" : "openai";
}

function syncCustomQaAskControls() {
  const engine = selectedCustomQaEngine();
  if (customQaStrongWrapEl) {
    customQaStrongWrapEl.style.opacity = engine === "openai" ? "1" : "0.45";
  }
  if (customQaStrongModelEl) {
    customQaStrongModelEl.disabled = engine !== "openai";
  }
  const busy = Boolean(customQaGenerateBtn?.dataset.busy === "1");
  const hasAnswer = Boolean(String(customQaAnswerEl?.value || "").trim());
  if (customQaCopyBtn) customQaCopyBtn.disabled = !hasAnswer;
  if (customQaSaveBtn) customQaSaveBtn.disabled = !hasAnswer || busy;
  if (customQaGenerateBtn) {
    customQaGenerateBtn.disabled = busy || !autofillEnabledCache;
  }
  if (customQaScanPageBtn) {
    const openaiOn = openaiQaToggleEl ? Boolean(openaiQaToggleEl.checked) : true;
    customQaScanPageBtn.disabled = busy || !autofillEnabledCache || !openaiOn;
  }
}

function setCustomQaMeta(text) {
  if (!customQaMetaEl) return;
  if (!text) {
    customQaMetaEl.hidden = true;
    customQaMetaEl.textContent = "";
    return;
  }
  customQaMetaEl.hidden = false;
  customQaMetaEl.textContent = text;
}

function toggleCustomQaAskPanel({ focus = true } = {}) {
  if (!customQaAskPanelEl) return;
  const open = customQaAskPanelEl.hidden;
  customQaAskPanelEl.hidden = !open;
  if (open) {
    syncCustomQaAskControls();
    if (focus) {
      try {
        customQaQuestionEl?.focus();
      } catch {
        /* ignore */
      }
    }
    setStatus("Enter a question.");
  }
}

async function generateCustomQaAsk() {
  if (!autofillEnabledCache) {
    setStatus("Autofill is off.");
    return;
  }
  const question = String(customQaQuestionEl?.value || "").trim();
  if (!question) {
    setStatus("Paste or type a question first.");
    try {
      customQaQuestionEl?.focus();
    } catch {
      /* ignore */
    }
    return;
  }
  const engine = selectedCustomQaEngine();
  const strongModel = Boolean(customQaStrongModelEl?.checked) && engine === "openai";
  if (customQaGenerateBtn) customQaGenerateBtn.dataset.busy = "1";
  syncCustomQaAskControls();
  if (customQaAnswerEl) customQaAnswerEl.value = "";
  setCustomQaMeta("");
  try {
    setStatus(
      engine === "chatgpt"
        ? "Custom Q&A · AI tab…"
        : strongModel
          ? "Custom Q&A · strong…"
          : "Custom Q&A…"
    );
    const res = await chrome.runtime.sendMessage({
      type: "custom_qa_ask",
      question,
      engine,
      strongModel
    });
    if (!res?.ok) {
      setStatus(res?.error || "Custom Q&A generate failed.");
      return;
    }
    if (customQaAnswerEl) customQaAnswerEl.value = String(res.answer || "").trim();
    const who = res.personLabel ? ` · ${res.personLabel}` : "";
    const src =
      res.source === "bank"
        ? `Q&A bank${who}`
        : res.source === "profile"
          ? `profile facts${who}`
          : res.source === "openai"
            ? `OpenAI${res.model ? ` · ${res.model}` : ""}${res.reusedThread ? " · same job thread" : ""}${who}`
            : res.source === "claude"
              ? `Claude tab${res.reusedChat ? " · same job chat" : ""}${who}`
              : `ChatGPT tab${res.reusedChat ? " · same job chat" : ""}${who}`;
    setCustomQaMeta(src);
    setStatus(`Custom Q&A ready (${src}).`);
  } finally {
    if (customQaGenerateBtn) customQaGenerateBtn.dataset.busy = "0";
    syncCustomQaAskControls();
  }
}

async function copyCustomQaAnswer() {
  const text = String(customQaAnswerEl?.value || "").trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Answer copied.");
  } catch {
    setStatus("Copy failed.");
  }
}

async function saveCustomQaAskToBank() {
  const question = String(customQaQuestionEl?.value || "").trim();
  const answer = String(customQaAnswerEl?.value || "").trim();
  if (!question || !answer) {
    setStatus("Need both question and answer to save.");
    return;
  }
  if (customQaSaveBtn) customQaSaveBtn.disabled = true;
  try {
    const engine = selectedCustomQaEngine();
    const res = await chrome.runtime.sendMessage({
      type: "custom_qa_save",
      question,
      answer,
      source: engine === "chatgpt" ? "custom_ask_agent" : "custom_ask"
    });
    if (!res?.ok) {
      setStatus(res?.error || "Save to bank failed.");
      return;
    }
    setStatus("Saved to Q&A bank for this person.");
    await refreshQaBank().catch(() => {});
  } finally {
    syncCustomQaAskControls();
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
  openAtsGapsRows.clear();
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
  setStatus("Queue cleared.");
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
    setStatus("Reset complete.");
    setBusy(false);
  } catch (err) {
    setStatus(`Reset failed: ${String(err.message || err)}`);
  }
}

// Events
queueNowWorkingEl?.addEventListener("click", () => jumpQueueToCurrentWork());
queueNowWorkingEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    jumpQueueToCurrentWork();
  }
});

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
  toggleManualPanelBtn.textContent = isOpen ? "Collapse" : "Expand bid form";
  if (isOpen) emailBidUi?.refreshFromAndMailbox?.().catch(() => {});
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

addProfileBtn?.addEventListener("click", () => {
  if (!inlineProfileEditor?.startNew) {
    setStatus("Profile editor panel is unavailable.");
    return;
  }
  inlineProfileEditor
    .startNew()
    .then(() => setStatus("New profile."))
    .catch((err) => setStatus(String(err?.message || err)));
});

activeRoleTrackBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    const person = profilesCache.find((p) => p.id === profileSelectEl.value);
    if (isRoleTrackLockedForPerson(person)) {
      applyActiveRoleTrackChange({ track: resolveRoleTrackForPerson(person) }).catch((e) =>
        setStatus(String(e.message || e))
      );
      return;
    }
    const track = normalizeRoleTrackId(btn.dataset.track);
    if (track === readActiveRoleTrack()) return;
    setActiveRoleTrackUi(track, { locked: false });
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
filterBuiltinBtn?.addEventListener("click", () => {
  applyChannelFilter("builtin").catch((e) => setStatus(String(e.message || e)));
});
filterHimalayasBtn?.addEventListener("click", () => {
  applyChannelFilter("himalayas").catch((e) => setStatus(String(e.message || e)));
});
filterGreenhouseBtn?.addEventListener("click", () => {
  applyChannelFilter("greenhouse").catch((e) => setStatus(String(e.message || e)));
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

fillFromOpenTabBtn?.addEventListener("click", () => {
  fillFromOpenTab().catch((e) => setStatus(String(e.message || e)));
});
clearOneOffFieldsBtn?.addEventListener("click", () => {
  clearOneOffJobFields().catch((e) => setStatus(String(e.message || e)));
});
copyAppsScriptBtn.addEventListener("click", copyAppsScript);
keepOpenBtn?.addEventListener("click", dockOutOfPopup);
openAsWindowBtn?.addEventListener("click", () => {
  openAsWindowApp().catch((e) => setStatus(String(e.message || e)));
});
toggleSheetPanelBtn?.addEventListener("click", () => {
  const open = sheetPanelBody?.hidden !== false;
  setSheetPanelOpen(open);
});
togglePacingSlackPanelBtn?.addEventListener("click", () => {
  const open = pacingSlackPanelBody?.hidden !== false;
  setPacingSlackPanelOpen(open);
});
previewTemplateBtn?.addEventListener("click", () => {
  openTemplatePreview().catch((e) => setStatus(String(e.message || e)));
});
styleExportClearBtn?.addEventListener("click", () => {
  clearStyleExport().catch((e) => setStatus(String(e.message || e)));
});
styleExportPdfBtn?.addEventListener("click", () => {
  exportStyleExportPdf().catch((e) => {
    setBusy(false);
    setStatus(String(e.message || e));
  });
});
testSlackBtn.addEventListener("click", testSlackWebhook);
runOneOffBtn.addEventListener("click", () => {
  const force = oneOffNeedsForceDraft();
  runOneOffDraft({ forceRebuild: force }).catch((e) => setStatus(String(e.message || e)));
});
logProfileApplyBtn?.addEventListener("click", () => {
  logProfileApply().catch((e) => {
    setBusy(false);
    setStatus(String(e.message || e));
  });
});
regenerateOneOffBtn?.addEventListener("click", () => {
  const score = Number(lastOneOffAtsCache?.atsScore);
  const needsGaps = Number.isFinite(score) && score < 90 && lastOneOffAtsCache?.atsEvaluation;
  if (needsGaps) {
    rebuildFromGaps({
      evaluation: lastOneOffAtsCache.atsEvaluation,
      oneOff: true
    }).catch((e) => setStatus(String(e.message || e)));
    return;
  }
  runOneOffDraft({ regenerate: true, forceRebuild: true }).catch((e) => setStatus(String(e.message || e)));
});
confirmOneOffBtn?.addEventListener("click", () => {
  confirmOneOffSave().catch((e) => setStatus(String(e.message || e)));
});
discardOneOffBtn?.addEventListener("click", () => {
  chrome.runtime
    .sendMessage({ type: "clear_one_off_draft" })
    .then(() => {
      renderOneOffDraft(null);
      renderOneOffAts(null);
      setStatus("Draft discarded.");
    })
    .catch((e) => setStatus(String(e.message || e)));
});
openOneOffPreviewBtn?.addEventListener("click", () => {
  openOneOffDraftPreview().catch((e) => setStatus(String(e.message || e)));
});
oneOffViewGapsBtn?.addEventListener("click", () => {
  if (!oneOffAtsGapsEl) return;
  const open = oneOffAtsGapsEl.hidden;
  oneOffAtsGapsEl.hidden = !open;
  oneOffViewGapsBtn.setAttribute("aria-expanded", open ? "true" : "false");
  oneOffViewGapsBtn.textContent = open ? "Hide" : "Gaps";
});
autofillPageBtn.addEventListener("click", autofillThisPage);
autoApplyPageBtn.addEventListener("click", autoApplyThisPage);
customQaPageBtn?.addEventListener("click", () => toggleCustomQaAskPanel({ focus: true }));
customQaGenerateBtn?.addEventListener("click", () => {
  generateCustomQaAsk().catch((e) => setStatus(String(e.message || e)));
});
customQaScanPageBtn?.addEventListener("click", () => {
  customQaThisPage().catch((e) => setStatus(String(e.message || e)));
});
customQaCopyBtn?.addEventListener("click", () => {
  copyCustomQaAnswer().catch((e) => setStatus(String(e.message || e)));
});
customQaSaveBtn?.addEventListener("click", () => {
  saveCustomQaAskToBank().catch((e) => setStatus(String(e.message || e)));
});
document.querySelectorAll('input[name="customQaEngine"]').forEach((el) => {
  el.addEventListener("change", syncCustomQaAskControls);
});
customQaAnswerEl?.addEventListener("input", syncCustomQaAskControls);
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
openaiQaToggleEl?.addEventListener("change", () => {
  chrome.storage.local
    .set({ [OPENAI_QA_ASSIST_KEY]: Boolean(openaiQaToggleEl.checked) })
    .catch(() => {});
  syncAutofillUi();
  setStatus(
    openaiQaToggleEl.checked
      ? "OpenAI Custom Q&A on."
      : "OpenAI Custom Q&A off."
  );
});
deleteAiChatToggleEl?.addEventListener("change", () => {
  const on = Boolean(deleteAiChatToggleEl.checked);
  chrome.storage.local.set({ [DELETE_AI_CHAT_HISTORY_KEY]: on }).catch(() => {});
  setStatus(
    on
      ? "Delete AI chat after job: on."
      : "Delete AI chat after job: off — shared AI accounts keep history."
  );
});
cleanLeftoverAiChatsBtn?.addEventListener("click", () => {
  if (!deleteAiChatToggleEl?.checked) {
    setStatus("Turn on Delete AI chat after job first.");
    return;
  }
  cleanLeftoverAiChatsBtn.disabled = true;
  setStatus("Cleaning leftover AI chats…");
  chrome.runtime
    .sendMessage({ type: "cleanup_leftover_ai_chats" })
    .then((res) => {
      if (res?.ok === false) {
        setStatus(`Clean leftover chats failed: ${String(res.error || "unknown")}`);
        cleanLeftoverAiChatsBtn.disabled = false;
      }
    })
    .catch((err) => {
      setStatus(`Clean leftover chats failed: ${String(err?.message || err)}`);
      cleanLeftoverAiChatsBtn.disabled = false;
    });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "cleanup_leftover_ai_chats_done") return;
  if (cleanLeftoverAiChatsBtn) cleanLeftoverAiChatsBtn.disabled = false;
  if (message.deferred) {
    setStatus("Leftover chat cleanup deferred — batch still running.");
    return;
  }
  if (message.via === "no-tab" || /no-.*-tab/i.test(String(message.error || ""))) {
    setStatus("Open a ChatGPT or Claude tab, then try Clean leftover AI chats again.");
    return;
  }
  if (message.via === "skipped-toggle-off") {
    setStatus("Keeping AI chat history (Delete AI chat after job is off).");
    return;
  }
  if (message.ok === false) {
    setStatus(`Clean leftover chats failed: ${String(message.error || "unknown")}`);
    return;
  }
  setStatus("Leftover AI chats cleaned.");
});
autofillEnabledToggleEl?.addEventListener("change", () => {
  const enabled = Boolean(autofillEnabledToggleEl.checked);
  syncAutofillUi(enabled);
  chrome.storage.local.set({ [AUTOFILL_ENABLED_KEY]: enabled }).catch(() => {});
  setStatus(enabled ? "Autofill on." : "Autofill off.");
});
aiProviderChatgptBtn?.addEventListener("click", () => {
  setAiProvider(AI_PROVIDERS.CHATGPT).catch((e) => setStatus(String(e.message || e)));
});
aiProviderClaudeBtn?.addEventListener("click", () => {
  setAiProvider(AI_PROVIDERS.CLAUDE).catch((e) => setStatus(String(e.message || e)));
});
humanizeOffBtn?.addEventListener("click", () => {
  setHumanizeMode(STRONG_HUMANIZE_MODES.OFF).catch((e) => setStatus(String(e.message || e)));
});
humanizeAutoBtn?.addEventListener("click", () => {
  setHumanizeMode(STRONG_HUMANIZE_MODES.AUTO).catch((e) => setStatus(String(e.message || e)));
});
humanizeOnBtn?.addEventListener("click", () => {
  setHumanizeMode(STRONG_HUMANIZE_MODES.ON).catch((e) => setStatus(String(e.message || e)));
});
sfPromptVersionEl?.addEventListener("change", () => {
  setSfPromptVersionUi(sfPromptVersionEl.value).catch((e) => setStatus(String(e.message || e)));
});

allowBatchYesBtn?.addEventListener("click", () => {
  setAllowBatch(ALLOW_BATCH.YES).catch((e) => setStatus(String(e.message || e)));
});
allowBatchNoBtn?.addEventListener("click", () => {
  setAllowBatch(ALLOW_BATCH.NO).catch((e) => setStatus(String(e.message || e)));
});

for (const el of [
  jobTitleEl,
  companyNameEl,
  jdLinkEl,
  jdTextEl,
  oneOffExtraPromptEl,
  outputDirEl,
  spreadsheetUrlEl,
  sheetsWebAppUrlEl,
  sheetTabNameEl,
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

if (fillFromOpenTabBtn) setIconButton(fillFromOpenTabBtn, "scrape", "Scrap from this page");
if (clearOneOffFieldsBtn) setIconButton(clearOneOffFieldsBtn, "remove", "Clear job fields");
if (runOneOffBtn) setIconButton(runOneOffBtn, "draft", "Generate Draft Version");
if (logProfileApplyBtn) {
  setIconButton(logProfileApplyBtn, "profileApply", "Log apply — save JD and mark Applied");
}
if (emailBidPrepareBtn) {
  setIconButton(emailBidPrepareBtn, "search", "Find contacts & draft (Email Bid)");
}
if (autofillPageBtn) {
  setIconButton(autofillPageBtn, "autofill", "Autofill (Ctrl+Shift+Y)");
}
if (autoApplyPageBtn) {
  setIconButton(autoApplyPageBtn, "apply", "Auto Apply (Ctrl+Shift+U)");
}
if (customQaPageBtn) {
  setIconButton(customQaPageBtn, "qa", "Custom Q&A (Ctrl+Shift+Q)");
}

if (openAsWindowBtn) setIconButton(openAsWindowBtn, "window", "Open as window app");
if (keepOpenBtn) {
  const panelLabel =
    UI_CONTEXT === "window" ? "Dock to Chrome side panel" : "Keep open in side panel";
  setIconButton(keepOpenBtn, "panel", panelLabel);
}

function setLabeledRunButton(button, label) {
  if (!button) return;
  button.classList.remove("icon-button");
  button.textContent = label;
  button.setAttribute("aria-label", label);
}

if (batchStartBtn) setLabeledRunButton(batchStartBtn, "Start");
if (batchPauseBtn) setLabeledRunButton(batchPauseBtn, "Pause");
if (batchSkipBtn) setLabeledRunButton(batchSkipBtn, "Skip");
if (batchStopBtn) setLabeledRunButton(batchStopBtn, "Stop");
if (forceSaveChatgptBtn) setIconButton(forceSaveChatgptBtn, "save", "Save JSON");
if (retryErrorsBtn) setIconButton(retryErrorsBtn, "retry", "Retry errors");
if (clearJobsBtn) setIconButton(clearJobsBtn, "remove", "Clear queue");
if (resetBtn) setIconButton(resetBtn, "reset", "Reset");

if (qaOpenEditorBtn) setIconButton(qaOpenEditorBtn, "editor", "Open editor");
if (qaImportBundledBtn) setIconButton(qaImportBundledBtn, "bundled", "Load bundled bank");
if (qaImportBtn) setIconButton(qaImportBtn, "import", "Import JSON");
if (qaExportBtn) setIconButton(qaExportBtn, "export", "Export JSON");

initThemePicker();
emailBidUi = initEmailBidUi({
  getActivePerson,
  setStatus,
  setBusy,
  setIconButton,
  setManualPanelOpen,
  DEFAULT_TEMPLATE_ID,
  templateSelectEl,
  spreadsheetUrlEl,
  sheetsWebAppUrlEl
});
loadSettings().catch((err) => setStatus(`Init failed: ${String(err.message || err)}`));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.allowSubmitOnAssist && allowSubmitToggleEl && changes.allowSubmitOnAssist.newValue !== undefined) {
    allowSubmitToggleEl.checked = Boolean(changes.allowSubmitOnAssist.newValue);
  }
  if (changes[OPENAI_QA_ASSIST_KEY] && openaiQaToggleEl && changes[OPENAI_QA_ASSIST_KEY].newValue !== undefined) {
    openaiQaToggleEl.checked = changes[OPENAI_QA_ASSIST_KEY].newValue !== false;
    syncAutofillUi();
  }
  if (
    changes[DELETE_AI_CHAT_HISTORY_KEY] &&
    deleteAiChatToggleEl &&
    changes[DELETE_AI_CHAT_HISTORY_KEY].newValue !== undefined
  ) {
    deleteAiChatToggleEl.checked = changes[DELETE_AI_CHAT_HISTORY_KEY].newValue !== false;
  }
  if (changes.qa_bank_version) refreshQaBank().catch(() => {});
  if (changes.qa_learn_enabled && qaLearnToggleEl && changes.qa_learn_enabled.newValue !== undefined) {
    qaLearnToggleEl.checked = changes.qa_learn_enabled.newValue !== false;
  }
  if (changes.selected_template_id && templateSelectEl) {
    const next = changes.selected_template_id.newValue;
    if (next && templateSelectEl.value !== next) {
      templateSelectEl.value = next;
      chrome.runtime.sendMessage({ type: "template_preview_show", templateId: next }).catch(() => {});
    }
  }
  if (changes[INDEED_GRAB_STATUS_KEY]) {
    renderIndeedGrabState(changes[INDEED_GRAB_STATUS_KEY].newValue);
  }
  if (changes[AI_PROVIDER_KEY] && changes[AI_PROVIDER_KEY].newValue !== undefined) {
    renderAiProvider(changes[AI_PROVIDER_KEY].newValue);
  }
  if (changes[STRONG_HUMANIZE_MODE_KEY] && changes[STRONG_HUMANIZE_MODE_KEY].newValue !== undefined) {
    renderHumanizeMode(changes[STRONG_HUMANIZE_MODE_KEY].newValue);
  }
  if (changes[SF_PROMPT_VERSION_KEY] && changes[SF_PROMPT_VERSION_KEY].newValue !== undefined) {
    renderSfPromptVersion(changes[SF_PROMPT_VERSION_KEY].newValue);
  }
  if (changes[SESSION_ROLE_TRACK_KEY]) {
    syncActiveTrackUi().catch(() => {});
  }
  if (changes[ALLOW_BATCH_KEY] && changes[ALLOW_BATCH_KEY].newValue !== undefined) {
    renderAllowBatch(changes[ALLOW_BATCH_KEY].newValue, {
      expandManual: normalizeAllowBatch(changes[ALLOW_BATCH_KEY].newValue) === ALLOW_BATCH.NO
    });
  } else if (changes[LEGACY_BID_MARKET_KEY] && changes[LEGACY_BID_MARKET_KEY].newValue !== undefined) {
    renderAllowBatch(changes[LEGACY_BID_MARKET_KEY].newValue, {
      expandManual: normalizeAllowBatch(changes[LEGACY_BID_MARKET_KEY].newValue) === ALLOW_BATCH.NO
    });
  }
  if (changes[LAST_ONE_OFF_ATS_KEY]) {
    renderOneOffAts(changes[LAST_ONE_OFF_ATS_KEY].newValue || null);
    if (changes[LAST_ONE_OFF_ATS_KEY].newValue?.ok && changes[LAST_ONE_OFF_ATS_KEY].newValue?.atsScore != null) {
      setManualPanelOpen(true);
    }
  }
  if (changes[ONE_OFF_DRAFT_KEY]) {
    const draft = changes[ONE_OFF_DRAFT_KEY].newValue || null;
    renderOneOffDraft(draft);
    if (hasUsableOneOffDraft(draft)) {
      setManualPanelOpen(true);
      openOneOffDraftPreview(draft.templateId || draft.jobMeta?.templateId || "").catch(() => {});
    }
  }
  if (changes.active_person_id || changes.selected_profile_id) {
    const nextId = String(
      changes.active_person_id?.newValue || changes.selected_profile_id?.newValue || ""
    ).trim();
    const prevId = String(
      changes.active_person_id?.oldValue || changes.selected_profile_id?.oldValue || ""
    ).trim();
    if (nextId && prevId && nextId !== prevId) {
      chrome.runtime.sendMessage({ type: "clear_one_off_draft" }).catch(() => {});
      renderOneOffDraft(null);
    }
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
    const nextQueue = data[QUEUE_KEY].map((j) => {
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
    const changed = queueRenderSignature(nextQueue) !== queueRenderSignature(queueCache);
    queueCache = nextQueue;
    if (changed) {
      renderQueue();
      updateCsvSummaryFromQueue();
    } else {
      followQueueToCurrentWork();
    }
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
