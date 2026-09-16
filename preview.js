import {
  DEFAULT_TEMPLATE_ID,
  getAllTemplates,
  getTemplateById,
  resumeJsonToHtml
} from "./templates/index.js";
import { getActivePerson } from "./profiles.js";
import { isResumePreviewable, sampleResumeForPerson } from "./templates/preview-sample.js";
import { loadAndApplyTheme, watchThemeChanges } from "./theme.js";
import { showToast } from "./ui-toast.js";

const PREVIEW_SOURCE_KEY = "template_preview_source";
const ONE_OFF_DRAFT_KEY = "one_off_draft";
const STYLE_EXPORT_PASTE_KEY = "style_export_paste_json";

const templateSelectEl = document.getElementById("templateSelect");
const useStyleBtn = document.getElementById("useStyle");
const pageEl = document.getElementById("page");
const ledeEl = document.getElementById("previewLede");
const statusEl = document.getElementById("status");

const params = new URLSearchParams(location.search);
let templateId = params.get("template") || DEFAULT_TEMPLATE_ID;
let source = "sample";
let hasLastResume = false;
let hasDraft = false;
let hasPaste = false;
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

async function loadDraftResume() {
  const stored = await chrome.storage.local.get(ONE_OFF_DRAFT_KEY);
  const draft = stored[ONE_OFF_DRAFT_KEY];
  if (isResumePreviewable(draft?.resumeData)) {
    draftTemplateId = String(draft.templateId || draft.jobMeta?.templateId || "").trim();
    return draft.resumeData;
  }
  return null;
}

async function loadPasteResume() {
  const stored = await chrome.storage.local.get(STYLE_EXPORT_PASTE_KEY);
  if (isResumePreviewable(stored[STYLE_EXPORT_PASTE_KEY])) {
    return stored[STYLE_EXPORT_PASTE_KEY];
  }
  return null;
}

async function loadResumeData() {
  if (source === "draft") {
    const data = await loadDraftResume();
    if (data) return { data, kind: "draft" };
    source = "sample";
  }
  if (source === "paste") {
    const data = await loadPasteResume();
    if (data) return { data, kind: "paste" };
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
  const html = resumeJsonToHtml(data, templateId);
  pageEl.srcdoc = html;
  if (ledeEl) {
    ledeEl.hidden = false;
    if (kind === "draft") ledeEl.textContent = `Manual draft · ${template.label}`;
    else if (kind === "paste") ledeEl.textContent = `Pasted resume · ${template.label}`;
    else if (kind === "last") ledeEl.textContent = `Last generated · ${template.label}`;
    else ledeEl.textContent = `Sample · ${template.label}`;
  }
  if (kind === "draft") {
    setStatus("Draft resume — Confirm in the bot when ready.", "ok");
  } else if (kind === "paste") {
    setStatus("Pasted resume — Export PDF from Resume style when ready.", "ok");
  }
}

async function initSource() {
  const stored = await chrome.storage.local.get([
    "last_resume_json",
    PREVIEW_SOURCE_KEY,
    ONE_OFF_DRAFT_KEY,
    STYLE_EXPORT_PASTE_KEY
  ]);
  hasLastResume = isResumePreviewable(stored.last_resume_json);
  hasDraft = isResumePreviewable(stored[ONE_OFF_DRAFT_KEY]?.resumeData);
  hasPaste = isResumePreviewable(stored[STYLE_EXPORT_PASTE_KEY]);
  draftTemplateId = String(
    stored[ONE_OFF_DRAFT_KEY]?.templateId || stored[ONE_OFF_DRAFT_KEY]?.jobMeta?.templateId || ""
  ).trim();

  const querySource = String(params.get("source") || "").trim().toLowerCase();
  if (querySource === "draft" && hasDraft) {
    source = "draft";
    if (draftTemplateId) templateId = draftTemplateId;
  } else if (querySource === "paste" && hasPaste) {
    source = "paste";
  } else if (querySource === "last" && hasLastResume) {
    source = "last";
  } else if (stored[PREVIEW_SOURCE_KEY] === "draft" && hasDraft) {
    source = "draft";
  } else if (stored[PREVIEW_SOURCE_KEY] === "paste" && hasPaste) {
    source = "paste";
  } else if (stored[PREVIEW_SOURCE_KEY] === "last" && hasLastResume) {
    source = "last";
  } else {
    source = "sample";
  }
}

async function persistActiveTemplate(nextId = templateId) {
  const tid = String(nextId || DEFAULT_TEMPLATE_ID).trim() || DEFAULT_TEMPLATE_ID;
  templateId = tid;
  templateSelectEl.value = tid;
  await chrome.storage.local.set({ selected_template_id: tid });
  const url = new URL(location.href);
  url.searchParams.set("template", tid);
  history.replaceState({}, "", url);
}

async function useThisStyle() {
  await persistActiveTemplate(templateId);
  const template = getTemplateById(templateId);
  const msg = `${template.label} is now the active resume style.`;
  setStatus(msg, "ok");
  showToast(msg, { kind: "ok", placement: "center" });
}

templateSelectEl.addEventListener("change", () => {
  persistActiveTemplate(templateSelectEl.value)
    .then(() => renderPreview())
    .catch((err) => setStatus(String(err?.message || err), "err"));
});

useStyleBtn.addEventListener("click", () =>
  useThisStyle().catch((err) => {
    const msg = String(err?.message || err);
    setStatus(msg, "err");
    showToast(msg, { kind: "err", placement: "center" });
  })
);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "template_preview_show") {
    if (message.templateId) {
      templateId = message.templateId;
      templateSelectEl.value = templateId;
    }
    if (message.source === "draft" || message.source === "last" || message.source === "sample" || message.source === "paste") {
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
  if (area !== "local") return;
  if (changes.selected_template_id) {
    const next = String(changes.selected_template_id.newValue || "").trim();
    if (next && next !== templateId) {
      templateId = next;
      templateSelectEl.value = next;
      const url = new URL(location.href);
      url.searchParams.set("template", next);
      history.replaceState({}, "", url);
      renderPreview().catch(() => {});
    }
  }
  if (changes[STYLE_EXPORT_PASTE_KEY] && (source === "paste" || params.get("source") === "paste")) {
    hasPaste = isResumePreviewable(changes[STYLE_EXPORT_PASTE_KEY].newValue);
    if (hasPaste) {
      source = "paste";
      renderPreview().catch(() => {});
    } else {
      source = "sample";
      setStatus("Paste cleared.", "warn");
      renderPreview().catch(() => {});
    }
  }
  if (!changes[ONE_OFF_DRAFT_KEY]) return;
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
      setStatus("Draft cleared.", "warn");
    }
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

populateTemplates();
initSource()
  .then(async () => {
    const stored = await chrome.storage.local.get("selected_template_id");
    const active = String(stored.selected_template_id || templateId || DEFAULT_TEMPLATE_ID).trim();
    if (active) await persistActiveTemplate(active);
    return renderPreview();
  })
  .catch((err) => setStatus(`Preview failed: ${String(err?.message || err)}`, "err"));
