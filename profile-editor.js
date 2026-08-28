import { initThemePicker } from "./theme.js";
import { getAllTemplates, DEFAULT_TEMPLATE_ID } from "./templates/index.js";
import {
  getResumeProfiles,
  getActivePersonId,
  setActivePersonId,
  getProfileById,
  getBuiltinPreset,
  deleteCustomProfile,
  getPersonSheetConfig,
  DEFAULT_PROFILE_ID
} from "./profiles.js";
import {
  fillPersonForm,
  readPersonFromForm,
  savePersonFromForm,
  applyCompleteness,
  isEditingBuiltin,
  mergeExtractedProfileIntoPerson,
  requiredExperienceToText
} from "./person-profile-form.js";
import {
  extractMasterResumeFromFile,
  extractProfileFromResumeText,
  MASTER_RESUME_ACCEPT
} from "./master-resume-file.js";
import { namesLikelyDifferent } from "./resume-profile.js";
import {
  normalizeRoleTrackId,
  resolveRoleTrackForPerson,
  resolveCoverLetterTemplateForTrack,
  getTrackPromptTemplate,
  isTrackDefaultPrompt,
  isTrackDefaultCoverLetter
} from "./role-tracks.js";
import {
  parseRequiredExperienceFromPrompt,
  parseEmployersFromResume
} from "./experience-rules.js";
import { getQaCount } from "./qa-store.js";
import { confirmDialog } from "./ui-dialog.js";

const formRoot = document.getElementById("profileForm");
const profileSelectEl = document.getElementById("profileSelect");
const deleteProfileBtn = document.getElementById("deleteProfile");
const statusEl = document.getElementById("status");
const completenessBannerEl = document.getElementById("completenessBanner");
const savePersonTopBtn = document.getElementById("savePersonTop");
const savePersonAsNewBtn = document.getElementById("savePersonAsNew");
const personSaveStatusEl = document.getElementById("personSaveStatus");
const qaBankNoteEl = document.getElementById("qaBankNote");
const profileKindNoteEl = document.getElementById("profileKindNote");
const openQaEditorBtn = document.getElementById("openQaEditorBtn");
const templateSelectEl = document.getElementById("templateSelect");
const personResumeFileEl = document.getElementById("personResumeFile");
const replaceResumeFromFileBtn = document.getElementById("replaceResumeFromFile");
const clearMasterResumeBtn = document.getElementById("clearMasterResume");
const detectRequiredExperienceBtn = document.getElementById("detectRequiredExperience");
const masterResumeFileHintEl = document.getElementById("masterResumeFileHint");
const roleTrackBtns = Array.from(document.querySelectorAll(".role-track-btn"));
const tabBtns = Array.from(document.querySelectorAll(".profile-tab"));
const tabPanels = Array.from(document.querySelectorAll(".profile-tab-panel"));

let profilesCache = [];
let editingPersonId = null;
let activeRoleTrack = "sf";
let activeTab = "apply";

const params = new URLSearchParams(location.search);
const initialTab = params.get("tab") || "apply";
const initialPresetId = params.get("preset") || "";
const initialProfileId = params.get("profileId") || "";

const VALID_TABS = new Set(["apply", "resume", "batch"]);

if (personResumeFileEl) personResumeFileEl.setAttribute("accept", MASTER_RESUME_ACCEPT);

/** Map legacy tab names from entry points. */
function normalizeTab(tab) {
  const t = String(tab || "apply").toLowerCase();
  if (t === "prompts" || t === "integrations") return "batch";
  return VALID_TABS.has(t) ? t : "apply";
}

function setStatus(message, kind = "") {
  if (!statusEl) return;
  const text = String(message || "").trim();
  if (!text || kind === "ok") {
    statusEl.hidden = true;
    statusEl.textContent = "";
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.className = `editor-status status-bar is-${kind || "err"}`;
}

function setSaveStatus(message, { ok = true } = {}) {
  if (!personSaveStatusEl) return;
  if (!message) {
    personSaveStatusEl.hidden = true;
    personSaveStatusEl.textContent = "";
    personSaveStatusEl.className = "profile-save-status";
    return;
  }
  personSaveStatusEl.hidden = false;
  personSaveStatusEl.textContent = message;
  personSaveStatusEl.className = `profile-save-status ${ok ? "ok" : "err"}`;
}

function readActiveRoleTrack() {
  return normalizeRoleTrackId(activeRoleTrack);
}

function setActiveRoleTrackUi(track) {
  activeRoleTrack = normalizeRoleTrackId(track);
  for (const btn of roleTrackBtns) {
    const isActive = btn.dataset.track === activeRoleTrack;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}

function updateEditorUrl(tab, profileId) {
  try {
    const url = new URL(location.href);
    url.searchParams.set("tab", tab);
    if (profileId) url.searchParams.set("profileId", profileId);
    else url.searchParams.delete("profileId");
    history.replaceState(null, "", `${url.pathname}${url.search}`);
  } catch {
    /* ignore */
  }
}

function setActiveTab(tabId) {
  const tab = normalizeTab(tabId);
  activeTab = tab;
  for (const btn of tabBtns) {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
    btn.tabIndex = isActive ? 0 : -1;
  }
  const panels = formRoot
    ? Array.from(formRoot.querySelectorAll(".profile-tab-panel"))
    : tabPanels;
  for (const panel of panels) {
    const isActive = panel.dataset.panel === tab;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
    panel.setAttribute("aria-hidden", isActive ? "false" : "true");
  }
  updateEditorUrl(tab, profileSelectEl?.value || editingPersonId || "");
  const activePanel = panels.find((panel) => panel.dataset.panel === tab);
  activePanel?.scrollIntoView({ block: "start", behavior: "smooth" });
  formRoot?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function syncSaveButtonLabels() {
  const label = isEditingBuiltin(editingPersonId) ? "Save as mine" : "Save";
  if (savePersonTopBtn) savePersonTopBtn.textContent = label;
}

function populateProfileSelect(selectedId) {
  if (!profileSelectEl) return;
  profileSelectEl.innerHTML = "";
  for (const profile of profilesCache) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.builtin ? profile.label : `${profile.label} (custom)`;
    profileSelectEl.appendChild(option);
  }
  const validIds = new Set(profilesCache.map((p) => p.id));
  const nextId = validIds.has(selectedId) ? selectedId : profilesCache[0]?.id || DEFAULT_PROFILE_ID;
  profileSelectEl.value = nextId;
  const selected = profilesCache.find((p) => p.id === profileSelectEl.value);
  if (deleteProfileBtn) deleteProfileBtn.hidden = !(selected && !selected.builtin);
  updateProfileKindNote(selected);
}

function populateTemplateSelect(selectedId) {
  if (!templateSelectEl) return;
  const templates = getAllTemplates();
  templateSelectEl.innerHTML = "";
  for (const template of templates) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    templateSelectEl.appendChild(option);
  }
  const validIds = new Set(templates.map((t) => t.id));
  templateSelectEl.value = validIds.has(selectedId) ? selectedId : DEFAULT_TEMPLATE_ID;
}

function updateProfileKindNote(profile) {
  if (!profileKindNoteEl) return;
  const selected = profile || profilesCache.find((p) => p.id === (profileSelectEl?.value || editingPersonId));
  if (!selected) {
    profileKindNoteEl.hidden = true;
    return;
  }
  if (selected.builtin) {
    profileKindNoteEl.hidden = false;
    profileKindNoteEl.className = "toolbar-hint is-warn";
    profileKindNoteEl.textContent =
      "Starter template — use Save or Save as new to keep your changes.";
    return;
  }
  profileKindNoteEl.hidden = false;
  profileKindNoteEl.className = "toolbar-hint";
  profileKindNoteEl.textContent = "Your profile — changes apply after Save.";
}

function renderCompleteness(person) {
  if (!completenessBannerEl) return;
  const { complete, missing } = applyCompleteness(person || {});
  if (complete) {
    completenessBannerEl.hidden = false;
    completenessBannerEl.className = "profile-completeness-bar";
    completenessBannerEl.innerHTML =
      '<p class="completeness-label">Autofill readiness</p><span class="completeness-chip ok">All required fields filled</span>';
    return;
  }
  completenessBannerEl.hidden = false;
  completenessBannerEl.className = "profile-completeness-bar is-warn";
  completenessBannerEl.innerHTML = [
    '<p class="completeness-label">Still needed for autofill</p>',
    ...missing.map((m) => `<span class="completeness-chip">${m}</span>`)
  ].join("");
}

async function refreshQaBankNote(profileId) {
  if (!qaBankNoteEl) return;
  try {
    const count = await getQaCount(profileId || "");
    qaBankNoteEl.textContent = count === 1 ? "1 answer" : `${count} answers`;
  } catch {
    qaBankNoteEl.textContent = "0 answers";
  }
}

async function loadPersonIntoForm(person) {
  editingPersonId = person?.id || null;
  const track = person?.roleTrack || resolveRoleTrackForPerson(person);
  setActiveRoleTrackUi(track);
  populateTemplateSelect(person?.templateId || DEFAULT_TEMPLATE_ID);
  fillPersonForm(formRoot, person, { roleTrack: track });
  if (profileSelectEl && person?.id) profileSelectEl.value = person.id;
  syncSaveButtonLabels();
  renderCompleteness(person);
  updateProfileKindNote(person);
  await refreshQaBankNote(person?.id);
  setSaveStatus("");
}

async function loadProfileById(profileId) {
  if (!profileId) throw new Error("No profile selected.");
  await setActivePersonId(profileId);
  const full = await getProfileById(profileId);
  if (!full) throw new Error("Profile not found.");
  const config = await getPersonSheetConfig(profileId);
  const withSheet = {
    ...full,
    spreadsheetUrl: config?.spreadsheetUrl || full.spreadsheetUrl || "",
    sheetsWebAppUrl: config?.sheetsWebAppUrl || full.sheetsWebAppUrl || ""
  };
  populateProfileSelect(profileId);
  await loadPersonIntoForm(withSheet);
}

async function refreshProfiles(selectedId) {
  profilesCache = await getResumeProfiles();
  populateProfileSelect(selectedId || (await getActivePersonId()));
}

function applyTrackTemplatesToForm(track, person) {
  const resumeEl = formRoot.querySelector("#personResumePrompt");
  const coverEl = formRoot.querySelector("#personCoverPrompt");
  const currentResume = resumeEl?.value || "";
  const currentCover = coverEl?.value || "";
  if (!currentResume.trim() || isTrackDefaultPrompt(currentResume) || !currentResume.includes("{JD}")) {
    if (resumeEl) resumeEl.value = getTrackPromptTemplate(track, person);
  }
  if (!currentCover.trim() || isTrackDefaultCoverLetter(currentCover) || !currentCover.includes("{JD}")) {
    if (coverEl) coverEl.value = resolveCoverLetterTemplateForTrack(person || { roleTrack: track }, track);
  }
}

async function saveProfile({ asNew = false } = {}) {
  if (savePersonTopBtn) savePersonTopBtn.disabled = true;
  if (savePersonAsNewBtn) savePersonAsNewBtn.disabled = true;
  setSaveStatus("Saving…");
  try {
    const result = await savePersonFromForm(formRoot, {
      asNew,
      editingPersonId: asNew ? null : editingPersonId,
      roleTrack: readActiveRoleTrack(),
      templateId: templateSelectEl?.value
    });
    const saved = result?.profile || result;
    editingPersonId = saved?.id || editingPersonId;
    await refreshProfiles(saved?.id);
    await loadPersonIntoForm(saved);
    const msg = result?.fromBuiltin ? `Saved as ${saved.label}` : `Saved ${saved.label}`;
    setSaveStatus(msg, { ok: true });
    setStatus("");
    return saved;
  } catch (err) {
    const msg = String(err?.message || err);
    setSaveStatus(msg, { ok: false });
    setStatus(msg, "err");
    if (err.focusKey) {
      const idMap = {
        label: "personLabel",
        promptTemplate: "personResumePrompt",
        masterResume: "personMasterResume",
        requiredExperience: "personRequiredExperience",
        coverLetterPrompt: "personCoverPrompt"
      };
      formRoot.querySelector(`#${idMap[err.focusKey] || ""}`)?.focus();
      if (err.focusKey === "promptTemplate" || err.focusKey === "coverLetterPrompt") setActiveTab("batch");
      if (err.focusKey === "masterResume" || err.focusKey === "requiredExperience") setActiveTab("resume");
      if (err.focusKey === "label") setActiveTab("apply");
    }
    return null;
  } finally {
    if (savePersonTopBtn) savePersonTopBtn.disabled = false;
    if (savePersonAsNewBtn) savePersonAsNewBtn.disabled = false;
  }
}

async function importFromResumeText(text, { sourceLabel = "resume" } = {}) {
  const resumeText = String(text || "").trim();
  if (resumeText.length < 40) {
    throw new Error("Not enough text to import. Upload a text-based PDF/DOCX or paste resume text.");
  }
  const parsed = extractProfileFromResumeText(resumeText);
  const current = await getProfileById(editingPersonId || profileSelectEl.value);
  const asNew =
    isEditingBuiltin(editingPersonId) ||
    Boolean(parsed.name && current?.name && namesLikelyDifferent(current.name, parsed.name));
  const merged = mergeExtractedProfileIntoPerson(current, parsed, resumeText, { resetEeo: asNew });
  fillPersonForm(formRoot, merged, { roleTrack: readActiveRoleTrack() });
  applyTrackTemplatesToForm(readActiveRoleTrack(), merged);
  setActiveTab("resume");
  renderCompleteness(merged);
  if (parsed.name) {
    await saveProfile({ asNew });
  } else {
    setSaveStatus("Imported — add name, then Save.", { ok: true });
    setActiveTab("apply");
  }
}

async function openQaEditor() {
  const profileId = profileSelectEl.value || editingPersonId || "";
  const url = new URL(chrome.runtime.getURL("qa-editor.html"));
  if (profileId) url.searchParams.set("profileId", profileId);
  const href = url.toString();
  try {
    await chrome.windows.create({ url: href, type: "popup", width: 980, height: 860, focused: true });
  } catch {
    await chrome.tabs.create({ url: href, active: true });
  }
}

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
});

profileSelectEl?.addEventListener("change", () => {
  loadProfileById(profileSelectEl.value).catch((err) => setStatus(String(err.message || err), "err"));
});

deleteProfileBtn?.addEventListener("click", async () => {
  const profileId = profileSelectEl.value;
  const selected = profilesCache.find((p) => p.id === profileId);
  if (!selected || selected.builtin) return;
  if (
    !(await confirmDialog({
      title: "Delete person?",
      message: `"${selected.label}" will be removed permanently.`,
      confirmText: "Delete",
      danger: true
    }))
  )
    return;
  await deleteCustomProfile(profileId);
  await refreshProfiles(DEFAULT_PROFILE_ID);
  await loadProfileById(profileSelectEl.value);
  setStatus(`Deleted ${selected.label}`, "ok");
});

roleTrackBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const track = normalizeRoleTrackId(btn.dataset.track);
    if (track === readActiveRoleTrack()) return;
    setActiveRoleTrackUi(track);
    applyTrackTemplatesToForm(track, profilesCache.find((p) => p.id === editingPersonId));
  });
});

formRoot?.addEventListener("submit", (e) => {
  e.preventDefault();
  saveProfile({ asNew: false }).catch(() => {});
});

savePersonAsNewBtn?.addEventListener("click", () => {
  saveProfile({ asNew: true }).catch(() => {});
});

openQaEditorBtn?.addEventListener("click", () => {
  openQaEditor().catch((err) => setStatus(String(err.message || err), "err"));
});

replaceResumeFromFileBtn?.addEventListener("click", () => personResumeFileEl?.click());

clearMasterResumeBtn?.addEventListener("click", () => {
  const el = formRoot.querySelector("#personMasterResume");
  if (el) el.value = "";
  if (personResumeFileEl) personResumeFileEl.value = "";
  if (masterResumeFileHintEl) masterResumeFileHintEl.textContent = "";
});

personResumeFileEl?.addEventListener("change", async () => {
  const file = personResumeFileEl.files?.[0];
  if (!file) return;
  try {
    const { text, fileName } = await extractMasterResumeFromFile(file);
    await importFromResumeText(text, { sourceLabel: fileName });
    if (masterResumeFileHintEl) {
      masterResumeFileHintEl.textContent = `Loaded ${fileName} (${text.length} chars).`;
    }
    personResumeFileEl.value = "";
  } catch (err) {
    setStatus(String(err.message || err), "err");
  }
});

detectRequiredExperienceBtn?.addEventListener("click", () => {
  const prompt = formRoot.querySelector("#personResumePrompt")?.value || "";
  const resume = formRoot.querySelector("#personMasterResume")?.value || "";
  const detected = parseRequiredExperienceFromPrompt(prompt).length
    ? parseRequiredExperienceFromPrompt(prompt)
    : parseEmployersFromResume(resume);
  if (!detected.length) {
    setSaveStatus("No employers detected from prompt or resume.", { ok: false });
    return;
  }
  const el = formRoot.querySelector("#personRequiredExperience");
  if (el) el.value = requiredExperienceToText(detected);
  setSaveStatus(`Detected ${detected.length} employer(s).`, { ok: true });
});

formRoot?.addEventListener("input", () => {
  const person = readPersonFromForm(formRoot, {
    editingPersonId,
    roleTrack: readActiveRoleTrack(),
    templateId: templateSelectEl?.value
  });
  renderCompleteness(person);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.custom_profiles) {
    refreshProfiles(profileSelectEl?.value).catch(() => {});
  }
  if (changes.active_person_id?.newValue && changes.active_person_id.newValue !== editingPersonId) {
    loadProfileById(changes.active_person_id.newValue).catch(() => {});
  }
  if (changes.qa_bank_version) {
    refreshQaBankNote(editingPersonId).catch(() => {});
  }
});

async function init() {
  initThemePicker(document.getElementById("themeSwatches"));
  setActiveTab(normalizeTab(initialTab));
  populateTemplateSelect(DEFAULT_TEMPLATE_ID);
  await refreshProfiles(initialProfileId || (await getActivePersonId()));

  if (initialPresetId) {
    const preset = getBuiltinPreset(initialPresetId);
    if (preset) {
      await loadPersonIntoForm({ ...preset, id: preset.id });
      setActiveTab("batch");
      return;
    }
  }

  const profileId = initialProfileId || profileSelectEl.value || (await getActivePersonId());
  await loadProfileById(profileId);
  setStatus("");
}

init().catch((err) => setStatus(String(err.message || err), "err"));
