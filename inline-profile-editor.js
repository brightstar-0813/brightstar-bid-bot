/**
 * Collapsible profile editor panel inside the Person section.
 * Uses the same storage + person-profile-form as the popup,
 * so built-in and custom profiles always appear in the picker.
 */

import {
  getResumeProfiles,
  getActivePersonId,
  setActivePersonId,
  getProfileById,
  getBuiltinPreset,
  deleteCustomProfile,
  getPersonSheetConfig,
  DEFAULT_PROFILE_ID,
  resolveCoverLetterTemplateForTrack,
  resolvePromptTemplateForTrack
} from "./profiles.js";
import {
  fillPersonForm,
  readPersonFromForm,
  savePersonFromForm,
  applyCompleteness,
  isEditingBuiltin,
  requiredExperienceToText
} from "./person-profile-form.js";
import {
  normalizeRoleTrackId,
  resolveRoleTrackForPerson,
  getTrackPromptTemplate
} from "./role-tracks.js";
import { parseRequiredExperienceFromPrompt } from "./experience-rules.js";
import { parseEmployersFromResume } from "./resume-profile.js";
import { DEFAULT_TEMPLATE_ID, getAllTemplates } from "./templates/index.js";
import { showToast } from "./ui-toast.js";
import { confirmDialog } from "./ui-dialog.js";

const NEW_PROFILE_ID = "__new__";

/**
 * @param {{
 *   panelEl: HTMLElement,
 *   panelBodyEl?: HTMLElement,
 *   toggleBtn?: HTMLButtonElement|null,
 *   onClose?: () => void,
 *   onSaved?: (profile: object) => void,
 *   setStatus?: (msg: string, kind?: string) => void
 * }} opts
 */
export function createInlineProfileEditor(opts) {
  const panelEl = opts.panelEl;
  const panelBodyEl = opts.panelBodyEl || panelEl.closest(".panel-body");
  const toggleBtn = opts.toggleBtn || null;
  const formRoot = panelEl.querySelector("#inlineProfileForm");
  const selectEl = panelEl.querySelector("#inlineProfileSelect");
  const saveBtn = panelEl.querySelector("#inlineProfileSave");
  const saveAsNewBtn = panelEl.querySelector("#inlineProfileSaveAsNew");
  const deleteBtn = panelEl.querySelector("#inlineProfileDelete");
  const completenessEl = panelEl.querySelector("#inlineCompleteness");
  const saveStatusEl = panelEl.querySelector("#inlineProfileSaveStatus");
  const templateSelectEl = panelEl.querySelector("#inlineTemplateSelect");
  const tabBtns = Array.from(panelEl.querySelectorAll(".profile-tab"));
  const roleTrackBtns = Array.from(formRoot?.querySelectorAll(".role-track-btn") || []);

  let profilesCache = [];
  let editingPersonId = null;
  let activeRoleTrack = "sf";
  let activeTab = "apply";
  let isOpen = false;

  function setPanelOpen(open, { persist = true } = {}) {
    isOpen = Boolean(open);
    if (panelBodyEl) panelBodyEl.hidden = !isOpen;
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      toggleBtn.textContent = isOpen ? "Hide profile editor" : "Edit or add profile";
    }
    if (persist) opts.setPanelOpen?.(isOpen);
    if (!isOpen) opts.onClose?.();
  }

  function setSaveStatus(message, { ok = true } = {}) {
    if (!saveStatusEl) return;
    if (!message) {
      saveStatusEl.hidden = true;
      saveStatusEl.textContent = "";
      return;
    }
    saveStatusEl.hidden = false;
    saveStatusEl.textContent = message;
    saveStatusEl.className = `inline-profile-save-status ${ok ? "ok" : "err"}`;
  }

  function setActiveTab(tabId) {
    activeTab = ["apply", "resume", "batch"].includes(tabId) ? tabId : "apply";
    for (const btn of tabBtns) {
      const on = btn.dataset.tab === activeTab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    }
    for (const panel of formRoot?.querySelectorAll(":scope > .profile-tab-panel") || []) {
      const on = panel.dataset.panel === activeTab;
      panel.classList.toggle("is-active", on);
      panel.hidden = !on;
      panel.setAttribute("aria-hidden", on ? "false" : "true");
    }
  }

  function setActiveRoleTrackUi(track) {
    activeRoleTrack = normalizeRoleTrackId(track);
    for (const btn of roleTrackBtns) {
      const on = btn.dataset.track === activeRoleTrack;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function syncSaveLabel() {
    if (saveBtn) saveBtn.textContent = isEditingBuiltin(editingPersonId) ? "Save as mine" : "Save";
  }

  function renderCompleteness(person) {
    if (!completenessEl) return;
    const { complete, missing } = applyCompleteness(person || {});
    completenessEl.hidden = false;
    completenessEl.className = `profile-completeness-bar${complete ? "" : " is-warn"}`;
    completenessEl.textContent = complete
      ? "Autofill ready"
      : `Still needed: ${missing.join(", ")}`;
  }

  function populateSelect(selectedId) {
    if (!selectEl) return;
    selectEl.innerHTML = "";

    const addOpt = document.createElement("option");
    addOpt.value = NEW_PROFILE_ID;
    addOpt.textContent = "Add a new profile";
    selectEl.appendChild(addOpt);

    for (const profile of profilesCache) {
      const opt = document.createElement("option");
      opt.value = profile.id;
      opt.textContent = profile.builtin ? profile.label : `${profile.label} (custom)`;
      selectEl.appendChild(opt);
    }

    const valid = new Set(profilesCache.map((p) => p.id));
    let next = NEW_PROFILE_ID;
    if (selectedId === NEW_PROFILE_ID) next = NEW_PROFILE_ID;
    else if (valid.has(selectedId)) next = selectedId;
    else if (valid.has(DEFAULT_PROFILE_ID)) next = DEFAULT_PROFILE_ID;
    else if (profilesCache[0]?.id) next = profilesCache[0].id;

    selectEl.value = next;
    if (deleteBtn) {
      const selected = profilesCache.find((p) => p.id === next);
      deleteBtn.hidden = !(selected && !selected.builtin);
    }
  }

  function populateTemplates(selectedId) {
    if (!templateSelectEl) return;
    const templates = getAllTemplates();
    templateSelectEl.innerHTML = "";
    for (const t of templates) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      templateSelectEl.appendChild(opt);
    }
    const valid = new Set(templates.map((t) => t.id));
    templateSelectEl.value = valid.has(selectedId) ? selectedId : DEFAULT_TEMPLATE_ID;
  }

  function blankPerson() {
    const track = "sf";
    return {
      id: null,
      label: "",
      name: "",
      email: "",
      phone: "",
      linkedin: "",
      portfolio: "",
      location: "",
      address: "",
      zip: "",
      masterResume: "",
      requiredExperience: [],
      workHistory: [],
      educationHistory: [],
      roleTrack: track,
      promptTemplate: getTrackPromptTemplate(track),
      coverLetterPrompt: resolveCoverLetterTemplateForTrack({ roleTrack: track }, track),
      templateId: DEFAULT_TEMPLATE_ID,
      resumeFilePrefix: "Resume",
      signatureTitle: "",
      autofillExtras: {},
      builtin: false
    };
  }

  function applyTrackPrompts(nextTrack, previousTrack) {
    const saved = profilesCache.find((p) => p.id === editingPersonId) || {};
    const person = {
      ...saved,
      ...readPersonFromForm(formRoot, {
        editingPersonId,
        roleTrack: previousTrack,
        templateId: templateSelectEl?.value
      }),
      roleTrack: previousTrack
    };
    const resumeEl = formRoot.querySelector("#personResumePrompt");
    const coverEl = formRoot.querySelector("#personCoverPrompt");
    if (resumeEl) resumeEl.value = resolvePromptTemplateForTrack(person, nextTrack);
    if (coverEl) coverEl.value = resolveCoverLetterTemplateForTrack(person, nextTrack);
  }

  async function loadPerson(person) {
    editingPersonId = person?.id || null;
    const track = person?.roleTrack || resolveRoleTrackForPerson(person);
    setActiveRoleTrackUi(track);
    populateTemplates(person?.templateId || DEFAULT_TEMPLATE_ID);
    fillPersonForm(formRoot, person || {}, { roleTrack: track });
    const sheetUrlEl = formRoot.querySelector("#inlineSpreadsheetUrl");
    const sheetAppEl = formRoot.querySelector("#inlineSheetsWebAppUrl");
    if (sheetUrlEl) sheetUrlEl.value = person?.spreadsheetUrl || "";
    if (sheetAppEl) sheetAppEl.value = person?.sheetsWebAppUrl || "";
    populateSelect(person?.id || NEW_PROFILE_ID);
    syncSaveLabel();
    renderCompleteness(person || {});
    setSaveStatus("");
  }

  async function loadById(profileId) {
    const id = String(profileId || "").trim();
    if (!id || id === NEW_PROFILE_ID) {
      await loadPerson(blankPerson());
      populateSelect(NEW_PROFILE_ID);
      return;
    }
    const full = await getProfileById(id);
    if (!full?.id) throw new Error("Profile not found.");
    await setActivePersonId(full.id);
    const sheet = await getPersonSheetConfig(full.id);
    await loadPerson({
      ...full,
      spreadsheetUrl: sheet?.spreadsheetUrl || full.spreadsheetUrl || "",
      sheetsWebAppUrl: sheet?.sheetsWebAppUrl || full.sheetsWebAppUrl || ""
    });
  }

  async function refreshAndSelect(selectedId) {
    profilesCache = await getResumeProfiles();
    populateSelect(selectedId || (await getActivePersonId()));
  }

  async function saveProfile({ asNew = false } = {}) {
    if (saveBtn) saveBtn.disabled = true;
    if (saveAsNewBtn) saveAsNewBtn.disabled = true;
    setSaveStatus("Saving…");
    try {
      const result = await savePersonFromForm(formRoot, {
        asNew: asNew || selectEl?.value === NEW_PROFILE_ID,
        editingPersonId: asNew || selectEl?.value === NEW_PROFILE_ID ? null : editingPersonId,
        roleTrack: activeRoleTrack,
        templateId: templateSelectEl?.value,
        spreadsheetUrl: formRoot.querySelector("#inlineSpreadsheetUrl")?.value?.trim() || "",
        sheetsWebAppUrl: formRoot.querySelector("#inlineSheetsWebAppUrl")?.value?.trim() || ""
      });
      const saved = result?.profile || result;
      editingPersonId = saved?.id || editingPersonId;
      await refreshAndSelect(saved?.id);
      await loadPerson(saved);
      const msg = result?.fromBuiltin ? `Saved as ${saved.label}` : `Saved ${saved.label}`;
      setSaveStatus(msg, { ok: true });
      showToast(msg, { kind: "ok" });
      opts.onSaved?.(saved);
      return saved;
    } catch (err) {
      const msg = String(err?.message || err);
      setSaveStatus(msg, { ok: false });
      showToast(msg, { kind: "err", duration: 4500 });
      if (err.focusKey === "promptTemplate" || err.focusKey === "coverLetterPrompt") setActiveTab("batch");
      if (err.focusKey === "masterResume" || err.focusKey === "requiredExperience") setActiveTab("resume");
      if (err.focusKey === "label") setActiveTab("apply");
      return null;
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      if (saveAsNewBtn) saveAsNewBtn.disabled = false;
    }
  }

  function close() {
    setPanelOpen(false);
  }

  async function open({ profileId = "", tab = "apply", presetId = "" } = {}) {
    setPanelOpen(true, { persist: true });
    setActiveTab(tab === "prompts" || tab === "integrations" ? "batch" : tab);

    profilesCache = await getResumeProfiles();

    if (presetId) {
      const preset = getBuiltinPreset(presetId);
      if (preset) {
        await loadPerson({ ...preset, id: preset.id });
        setActiveTab("batch");
        return;
      }
    }

    const target =
      String(profileId || "").trim() ||
      (await getActivePersonId()) ||
      profilesCache[0]?.id ||
      NEW_PROFILE_ID;

    await loadById(target);
  }

  if (panelEl.dataset.bound !== "1") {
    panelEl.dataset.bound = "1";

    toggleBtn?.addEventListener("click", () => {
      if (isOpen) close();
      else open().catch((err) => opts.setStatus?.(String(err.message || err), "err"));
    });

    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
    });

    selectEl?.addEventListener("change", () => {
      loadById(selectEl.value).catch((err) => opts.setStatus?.(String(err.message || err), "err"));
    });

    formRoot?.addEventListener("submit", (e) => {
      e.preventDefault();
      saveProfile({ asNew: false }).catch(() => {});
    });

    saveAsNewBtn?.addEventListener("click", () => {
      saveProfile({ asNew: true }).catch(() => {});
    });

    deleteBtn?.addEventListener("click", async () => {
      const id = selectEl?.value;
      const selected = profilesCache.find((p) => p.id === id);
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
      await deleteCustomProfile(id);
      await refreshAndSelect(DEFAULT_PROFILE_ID);
      await loadById(selectEl.value);
    });

    roleTrackBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const track = normalizeRoleTrackId(btn.dataset.track);
        if (track === activeRoleTrack) return;
        const previousTrack = activeRoleTrack;
        setActiveRoleTrackUi(track);
        applyTrackPrompts(track, previousTrack);
      });
    });

    formRoot?.querySelector("#detectRequiredExperience")?.addEventListener("click", () => {
      const prompt = formRoot.querySelector("#personResumePrompt")?.value || "";
      const resume = formRoot.querySelector("#personMasterResume")?.value || "";
      const fromPrompt = parseRequiredExperienceFromPrompt(prompt);
      const detected = fromPrompt.length ? fromPrompt : parseEmployersFromResume(resume);
      if (!detected.length) {
        setSaveStatus("No employers detected.", { ok: false });
        return;
      }
      const el = formRoot.querySelector("#personRequiredExperience");
      if (el) el.value = requiredExperienceToText(detected);
      setSaveStatus(`Detected ${detected.length} employer(s).`, { ok: true });
    });

    formRoot?.addEventListener("input", () => {
      const person = readPersonFromForm(formRoot, {
        editingPersonId,
        roleTrack: activeRoleTrack,
        templateId: templateSelectEl?.value
      });
      renderCompleteness(person);
    });
  }

  return {
    open,
    close,
    refreshAndSelect,
    setPanelOpen,
    isOpen: () => isOpen
  };
}
