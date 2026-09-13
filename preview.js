import {
  DEFAULT_TEMPLATE_ID,
  getAllTemplates,
  getTemplateById,
  resumeJsonToHtml
} from "./templates/index.js";
import { getActivePerson } from "./profiles.js";
import { isResumePreviewable, sampleResumeForPerson } from "./templates/preview-sample.js";
import { loadAndApplyTheme, watchThemeChanges, mountThemeSwatches } from "./theme.js";

const PREVIEW_SOURCE_KEY = "template_preview_source";
const ONE_OFF_DRAFT_KEY = "one_off_draft";

const templateSelectEl = document.getElementById("templateSelect");
const sourceSampleBtn = document.getElementById("sourceSample");
const sourceDraftBtn = document.getElementById("sourceDraft");
const sourceLastBtn = document.getElementById("sourceLast");
const useStyleBtn = document.getElementById("useStyle");
const pageEl = document.getElementById("page");
const ledeEl = document.getElementById("previewLede");
const statusEl = document.getElementById("status");

const params = new URLSearchParams(location.search);
let templateId = params.get("template") || DEFAULT_TEMPLATE_ID;
let source = "sample";
let hasLastResume = false;
let hasDraft = false;
let draftTemplateId = "";

function setStatus(message, tone = "") {
  const text = String(message || "").trim();
  statusEl.textContent = text;
  statusEl.classList.remove("is-ok", "is-warn", "is-err", "is-empty");
  if (!text) {
    statusEl.classList.add("is-empty");
    return;
  }
  if (tone === "err") statusEl.classList.add("is-err");
  else if (tone === "warn") statusEl.classList.add("is-warn");
  else statusEl.classList.add("is-ok");
}

pageEl.addEventListener("load", () => {
  try {
    const doc = pageEl.contentDocument;
    if (!doc) return;
    const h = Math.max(doc.documentElement?.scrollHeight || 0, doc.body?.scrollHeight || 0, 1120);
    pageEl.style.height = `${h + 16}px`;
  } catch {
    // ignore
  }
});

function populateTemplates() {
  const templates = getAllTemplates();
  templateSelectEl.innerHTML = "";
  for (const template of templates) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    option.title = template.description || template.label;
    templateSelectEl.appendChild(option);
  }
  const valid = new Set(templates.map((t) => t.id));
  if (!valid.has(templateId)) templateId = DEFAULT_TEMPLATE_ID;
  templateSelectEl.value = templateId;
}

function syncSourceButtons() {
  sourceSampleBtn.classList.toggle("active", source === "sample");
  sourceDraftBtn?.classList.toggle("active", source === "draft");
  sourceLastBtn.classList.toggle("active", source === "last");
  if (sourceDraftBtn) {
    sourceDraftBtn.disabled = !hasDraft;
    sourceDraftBtn.title = hasDraft ? "Manual bid draft resume" : "Draft a Manual bid first";
  }
  sourceLastBtn.disabled = !hasLastResume;
}

async function loadDraftResume() {
  const stored = await chrome.storage.local.get(ONE_OFF_DRAFT_KEY);
  const draft = stored[ONE_OFF_DRAFT_KEY];
  if (isResumePreviewable(draft?.resumeData)) {
    draftTemplateId = String(draft.templateId || draft.jobMeta?.templateId || "").trim();
    return draft.resumeData;
  }
  return null;
}

async function loadResumeData() {
  if (source === "draft") {
    const data = await loadDraftResume();
    if (data) return { data, kind: "draft" };
    source = "sample";
  }
  if (source === "last") {
    const stored = await chrome.storage.local.get("last_resume_json");
    if (isResumePreviewable(stored.last_resume_json)) {
      return { data: stored.last_resume_json, kind: "last" };
    }
    source = "sample";
  }
  const person = await getActivePerson().catch(() => null);
  return { data: sampleResumeForPerson(person || {}), kind: "sample" };
}

async function renderPreview() {
  const template = getTemplateById(templateId);
  const { data, kind } = await loadResumeData();
  syncSourceButtons();
  const html = resumeJsonToHtml(data, templateId);
  pageEl.srcdoc = html;
  if (ledeEl) {
    ledeEl.hidden = false;
    if (kind === "draft") ledeEl.textContent = `Manual draft · ${template.label}`;
    else if (kind === "last") ledeEl.textContent = `Last generated · ${template.label}`;
    else ledeEl.textContent = `Sample · ${template.label}`;
  }
  if (kind === "draft") {
    setStatus("Draft resume — Confirm in the bot when ready.", "ok");
  }
}

async function initSource() {
  const stored = await chrome.storage.local.get([
    "last_resume_json",
    PREVIEW_SOURCE_KEY,
    ONE_OFF_DRAFT_KEY
  ]);
  hasLastResume = isResumePreviewable(stored.last_resume_json);
  hasDraft = isResumePreviewable(stored[ONE_OFF_DRAFT_KEY]?.resumeData);
  draftTemplateId = String(
    stored[ONE_OFF_DRAFT_KEY]?.templateId || stored[ONE_OFF_DRAFT_KEY]?.jobMeta?.templateId || ""
  ).trim();

  const querySource = String(params.get("source") || "").trim().toLowerCase();
  if (querySource === "draft" && hasDraft) {
    source = "draft";
    if (draftTemplateId) templateId = draftTemplateId;
  } else if (querySource === "last" && hasLastResume) {
    source = "last";
  } else if (stored[PREVIEW_SOURCE_KEY] === "draft" && hasDraft) {
    source = "draft";
  } else if (stored[PREVIEW_SOURCE_KEY] === "last" && hasLastResume) {
    source = "last";
  } else {
    source = "sample";
  }
}

async function setSource(next) {
  if (next === "draft" && !hasDraft) {
    setStatus("No Manual draft yet — showing sample layout.", "warn");
    source = "sample";
  } else if (next === "last" && !hasLastResume) {
    setStatus("No generated resume yet — showing sample layout.", "warn");
    source = "sample";
  } else {
    source = next;
  }
  await chrome.storage.local.set({ [PREVIEW_SOURCE_KEY]: source });
  if (source === "draft" && draftTemplateId) {
    templateId = draftTemplateId;
    templateSelectEl.value = templateId;
  }
  await renderPreview();
}

async function useThisStyle() {
  await chrome.storage.local.set({ selected_template_id: templateId });
  const template = getTemplateById(templateId);
  setStatus(`${template.label} is now the active resume style.`);
}

templateSelectEl.addEventListener("change", () => {
  templateId = templateSelectEl.value;
  const url = new URL(location.href);
  url.searchParams.set("template", templateId);
  history.replaceState({}, "", url);
  renderPreview().catch((err) => setStatus(String(err?.message || err)));
});

sourceSampleBtn.addEventListener("click", () => setSource("sample"));
sourceDraftBtn?.addEventListener("click", () => setSource("draft"));
sourceLastBtn.addEventListener("click", () => setSource("last"));
useStyleBtn.addEventListener("click", () => useThisStyle().catch((err) => setStatus(String(err?.message || err))));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "template_preview_show") {
    if (message.templateId) {
      templateId = message.templateId;
      templateSelectEl.value = templateId;
    }
    if (message.source === "draft" || message.source === "last" || message.source === "sample") {
      source = message.source;
    }
    renderPreview().catch(() => {});
    return;
  }
  if (message?.type === "one_off_draft_updated") {
    loadDraftResume()
      .then((data) => {
        hasDraft = Boolean(data);
        if (hasDraft) {
          source = "draft";
          if (draftTemplateId) {
            templateId = draftTemplateId;
            templateSelectEl.value = templateId;
          }
        }
        return renderPreview();
      })
      .catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[ONE_OFF_DRAFT_KEY]) return;
  const draft = changes[ONE_OFF_DRAFT_KEY].newValue;
  hasDraft = isResumePreviewable(draft?.resumeData);
  draftTemplateId = String(draft?.templateId || draft?.jobMeta?.templateId || "").trim();
  if (source === "draft" || params.get("source") === "draft") {
    if (hasDraft) {
      source = "draft";
      if (draftTemplateId) {
        templateId = draftTemplateId;
        templateSelectEl.value = templateId;
      }
      renderPreview().catch(() => {});
    } else {
      source = "sample";
      syncSourceButtons();
      setStatus("Draft cleared.", "warn");
    }
  } else {
    syncSourceButtons();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.target && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
  const templates = getAllTemplates();
  const index = templates.findIndex((t) => t.id === templateId);
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    const next = templates[(index + 1) % templates.length];
    templateSelectEl.value = next.id;
    templateSelectEl.dispatchEvent(new Event("change"));
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    const prev = templates[(index - 1 + templates.length) % templates.length];
    templateSelectEl.value = prev.id;
    templateSelectEl.dispatchEvent(new Event("change"));
  } else if (/^[1-9]$/.test(event.key) || event.key === "0") {
    const n = event.key === "0" ? 10 : Number(event.key);
    const picked = templates[n - 1];
    if (!picked) return;
    event.preventDefault();
    templateSelectEl.value = picked.id;
    templateSelectEl.dispatchEvent(new Event("change"));
  }
});

loadAndApplyTheme().catch(() => {});
watchThemeChanges();
mountThemeSwatches(document.getElementById("themeSwatches"), {
  onSelect: (theme) => setStatus(`Theme: ${theme.label}`)
});

populateTemplates();
initSource()
  .then(() => {
    templateSelectEl.value = templateId;
    return renderPreview();
  })
  .catch((err) => setStatus(`Preview failed: ${String(err?.message || err)}`, "err"));
