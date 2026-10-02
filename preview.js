import {
  DEFAULT_TEMPLATE_ID,
  getAllTemplates,
  getTemplateById,
  resumeJsonToHtml
} from "./templates/index.js";
import { applyPathEdits } from "./templates/shared.js";
import { isPlainResumePath, sanitizeRichHtml } from "./resume-rich.js";
import { buildResumeDocx, resumeDocxFileName } from "./resume-docx.js";
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
const editControlsEl = document.getElementById("editControls");
const editBtn = document.getElementById("editResume");
const saveBtn = document.getElementById("saveResume");
const discardBtn = document.getElementById("discardEdits");
const formatBar = document.getElementById("formatBar");
const downloadDocxBtn = document.getElementById("downloadDocx");

const params = new URLSearchParams(location.search);
let templateId = params.get("template") || DEFAULT_TEMPLATE_ID;
let source = "sample";
let hasLastResume = false;
let hasDraft = false;
let hasPaste = false;
let draftTemplateId = "";

/** Working copy of resume JSON for the current preview source. */
let workingResumeData = null;
let editMode = false;
let dirty = false;
/** When true, ignore storage-driven re-renders that would wipe mid-edit. */
let skipStorageRefresh = false;

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

function canEditSource(kind = source) {
  return kind === "draft" || kind === "paste";
}

function cloneResume(data) {
  if (!data || typeof data !== "object") return null;
  try {
    return typeof structuredClone === "function"
      ? structuredClone(data)
      : JSON.parse(JSON.stringify(data));
  } catch {
    return null;
  }
}

function updateEditChrome() {
  const editable = canEditSource();
  if (editControlsEl) editControlsEl.hidden = !editable;
  document.body.classList.toggle("is-editing", Boolean(editable && editMode));
  if (!editable) {
    editMode = false;
    dirty = false;
  }
  if (editBtn) {
    editBtn.disabled = !editable;
    editBtn.textContent = editMode ? "Editing…" : "Edit";
  }
  if (saveBtn) saveBtn.disabled = !editable || !editMode || !dirty;
  if (discardBtn) discardBtn.disabled = !editable || !editMode;
  if (formatBar) formatBar.hidden = !editable || !editMode;
  if (downloadDocxBtn) downloadDocxBtn.disabled = !editable || !workingResumeData;
}

function collectPathEdits(doc) {
  const edits = {};
  if (!doc) return edits;
  for (const el of doc.querySelectorAll("[data-bs-path]")) {
    const path = String(el.getAttribute("data-bs-path") || "").trim();
    if (!path) continue;
    if (isPlainResumePath(path)) {
      edits[path] = String(el.innerText || el.textContent || "")
        .replace(/\u00a0/g, " ")
        .replace(/\r\n/g, "\n")
        .trim();
      continue;
    }
    let html = sanitizeRichHtml(el.innerHTML || "");
    const align = String(el.style?.textAlign || "").toLowerCase();
    if ((align === "center" || align === "left") && /^(headline|profile)$/.test(path)) {
      html = `<div style="text-align:${align}">${html}</div>`;
    }
    edits[path] = html;
  }
  return edits;
}

function fieldFromNode(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  return el?.closest?.("[data-bs-path]") || null;
}

function markDirty() {
  dirty = true;
  updateEditChrome();
}

function applyEmphasis(doc, command) {
  const host = fieldFromNode(doc.getSelection()?.anchorNode);
  const path = host?.getAttribute("data-bs-path") || "";
  if (!host || isPlainResumePath(path)) return;
  doc.execCommand(command, false);
  host.innerHTML = sanitizeRichHtml(host.innerHTML);
  markDirty();
}

function wrapSelection(doc, style) {
  const sel = doc.getSelection();
  const host = fieldFromNode(sel?.anchorNode);
  const path = host?.getAttribute("data-bs-path") || "";
  if (!host || !sel || !sel.rangeCount || sel.isCollapsed || isPlainResumePath(path)) return;
  const range = sel.getRangeAt(0);
  const span = doc.createElement("span");
  span.setAttribute("style", style);
  span.appendChild(range.extractContents());
  range.insertNode(span);
  host.innerHTML = sanitizeRichHtml(host.innerHTML);
  markDirty();
}

function applyAlign(doc, align) {
  const sel = doc.getSelection();
  const node = sel?.anchorNode;
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const field = el?.closest?.("[data-bs-path]");
  const path = field?.getAttribute("data-bs-path") || "";
  if (field && /^(headline|profile)$/.test(path)) {
    field.style.textAlign = align;
  } else {
    doc.querySelectorAll("h2").forEach((heading) => {
      heading.style.textAlign = align;
    });
    if (workingResumeData) workingResumeData.headingAlign = align;
  }
  markDirty();
}

function enableEditableFields(doc) {
  if (!doc) return;
  for (const el of doc.querySelectorAll("[data-bs-path], h2")) {
    el.setAttribute("contenteditable", "true");
    el.setAttribute("spellcheck", "true");
  }
  if (!doc.__bsEditBound) {
    doc.__bsEditBound = true;
    doc.addEventListener("input", () => {
      if (!editMode) return;
      markDirty();
    });
    doc.addEventListener("paste", (event) => {
      if (!editMode) return;
      const target = event.target?.closest?.("[data-bs-path]");
      if (!target) return;
      event.preventDefault();
      const path = target.getAttribute("data-bs-path") || "";
      const html = String(event.clipboardData?.getData("text/html") || "");
      const text = String(event.clipboardData?.getData("text/plain") || "").replace(/\r\n/g, "\n");
      if (!isPlainResumePath(path) && html.trim()) {
        doc.execCommand("insertHTML", false, sanitizeRichHtml(html));
      } else {
        doc.execCommand("insertText", false, text);
      }
      markDirty();
    });
    doc.addEventListener("keydown", (event) => {
      if (!editMode || !(event.ctrlKey || event.metaKey)) return;
      const key = String(event.key || "").toLowerCase();
      if (key !== "b" && key !== "i" && key !== "u") return;
      event.preventDefault();
      applyEmphasis(doc, key === "b" ? "bold" : key === "i" ? "italic" : "underline");
    });
  }
}

function disableEditableFields(doc) {
  if (!doc) return;
  for (const el of doc.querySelectorAll("[data-bs-path], h2")) {
    el.removeAttribute("contenteditable");
  }
}

function syncIframeHeight() {
  try {
    const doc = pageEl.contentDocument;
    if (!doc) return;
    const h = Math.max(doc.documentElement?.scrollHeight || 0, doc.body?.scrollHeight || 0, 1120);
    pageEl.style.height = `${h + 16}px`;
  } catch {
    // ignore
  }
}

pageEl.addEventListener("load", () => {
  syncIframeHeight();
  if (editMode && canEditSource()) {
    enableEditableFields(pageEl.contentDocument);
  }
});

function shortPreviewTip(text, max = 48) {
  const line = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).trimEnd()}…`;
}

function populateTemplates() {
  const templates = getAllTemplates();
  templateSelectEl.innerHTML = "";
  for (const template of templates) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    option.title = shortPreviewTip(template.description || template.label);
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

async function renderPreview({ keepWorkingCopy = false } = {}) {
  const template = getTemplateById(templateId);
  const { data, kind } = await loadResumeData();
  if (!keepWorkingCopy || !workingResumeData) {
    workingResumeData = cloneResume(data);
  }
  const renderData = workingResumeData || data;
  const html = resumeJsonToHtml(renderData, templateId);
  pageEl.srcdoc = html;
  if (ledeEl) {
    ledeEl.hidden = false;
    if (kind === "draft") ledeEl.textContent = `Manual draft · ${template.label}`;
    else if (kind === "paste") ledeEl.textContent = `Pasted resume · ${template.label}`;
    else if (kind === "last") ledeEl.textContent = `Last generated · ${template.label}`;
    else ledeEl.textContent = `Sample · ${template.label}`;
  }
  if (kind === "draft") {
    setStatus(
      editMode
        ? dirty
          ? "Editing draft — Save to keep changes, then Confirm in the bot."
          : "Editing draft — click text to change, then Save."
        : "Draft resume — Edit here or Confirm in the bot when ready.",
      "ok"
    );
  } else if (kind === "paste") {
    setStatus(
      editMode
        ? dirty
          ? "Editing paste — Save to keep changes, then Export PDF from Resume style."
          : "Editing paste — click text to change, then Save."
        : "Pasted resume — Edit here or Export PDF from Resume style when ready.",
      "ok"
    );
  }
  updateEditChrome();
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

function enterEditMode() {
  if (!canEditSource()) return;
  editMode = true;
  dirty = false;
  skipStorageRefresh = true;
  enableEditableFields(pageEl.contentDocument);
  updateEditChrome();
  setStatus("Editing — click text to change, then Save.", "ok");
}

async function discardEdits() {
  if (!canEditSource()) return;
  editMode = false;
  dirty = false;
  skipStorageRefresh = false;
  workingResumeData = null;
  await renderPreview();
  showToast("Edits discarded.", { kind: "warn", placement: "center" });
}

async function saveEdits() {
  if (!canEditSource() || !editMode) return;
  const doc = pageEl.contentDocument;
  if (!doc || !workingResumeData) {
    setStatus("Nothing to save.", "warn");
    return;
  }
  const edits = collectPathEdits(doc);
  const next = applyPathEdits(workingResumeData, edits);
  workingResumeData = next;
  dirty = false;

  try {
    if (source === "draft") {
      const res = await chrome.runtime.sendMessage({
        type: "update_one_off_draft",
        resumeData: next,
        templateId
      });
      if (!res?.ok) throw new Error(res?.error || "Save failed");
      const score =
        res.atsEvaluation?.score != null ? ` · ATS ${res.atsEvaluation.score}/100` : "";
      setStatus(`Draft saved${score}. Confirm in the bot when ready.`, "ok");
      showToast(`Draft saved${score}.`, { kind: "ok", placement: "center" });
    } else if (source === "paste") {
      await chrome.storage.local.set({ [STYLE_EXPORT_PASTE_KEY]: next });
      setStatus("Paste saved. Export PDF from Resume style when ready.", "ok");
      showToast("Paste saved.", { kind: "ok", placement: "center" });
    }
    editMode = false;
    skipStorageRefresh = false;
    disableEditableFields(doc);
    updateEditChrome();
    await renderPreview({ keepWorkingCopy: true });
  } catch (err) {
    dirty = true;
    const msg = String(err?.message || err);
    setStatus(msg, "err");
    showToast(msg, { kind: "err", placement: "center" });
    updateEditChrome();
  }
}

editBtn?.addEventListener("click", () => enterEditMode());
saveBtn?.addEventListener("click", () => {
  saveEdits().catch((err) => setStatus(String(err?.message || err), "err"));
});
discardBtn?.addEventListener("click", () => {
  discardEdits().catch((err) => setStatus(String(err?.message || err), "err"));
});

function keepPreviewSelection(event) {
  event.preventDefault();
}

for (const button of [document.getElementById("fmtBold"), document.getElementById("fmtItalic"), document.getElementById("fmtUnderline"), document.getElementById("fmtLeft"), document.getElementById("fmtCenter")]) {
  button?.addEventListener("mousedown", keepPreviewSelection);
}

document.getElementById("fmtBold")?.addEventListener("click", () => {
  const doc = pageEl.contentDocument;
  if (doc) applyEmphasis(doc, "bold");
});
document.getElementById("fmtItalic")?.addEventListener("click", () => {
  const doc = pageEl.contentDocument;
  if (doc) applyEmphasis(doc, "italic");
});
document.getElementById("fmtUnderline")?.addEventListener("click", () => {
  const doc = pageEl.contentDocument;
  if (doc) applyEmphasis(doc, "underline");
});
document.getElementById("fmtFont")?.addEventListener("change", (event) => {
  const font = String(event.target.value || "");
  event.target.value = "";
  const doc = pageEl.contentDocument;
  if (font && doc) wrapSelection(doc, `font-family:${font}`);
});
document.getElementById("fmtSize")?.addEventListener("change", (event) => {
  const size = String(event.target.value || "");
  event.target.value = "";
  const doc = pageEl.contentDocument;
  if (size && doc) wrapSelection(doc, `font-size:${size}pt`);
});
document.getElementById("fmtLeft")?.addEventListener("click", () => {
  const doc = pageEl.contentDocument;
  if (doc) applyAlign(doc, "left");
});
document.getElementById("fmtCenter")?.addEventListener("click", () => {
  const doc = pageEl.contentDocument;
  if (doc) applyAlign(doc, "center");
});

downloadDocxBtn?.addEventListener("click", () => {
  if (!workingResumeData) return;
  if (editMode) {
    workingResumeData = applyPathEdits(
      workingResumeData,
      collectPathEdits(pageEl.contentDocument)
    );
  }
  const bytes = buildResumeDocx(workingResumeData);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = resumeDocxFileName(workingResumeData);
  link.click();
  URL.revokeObjectURL(url);
});

templateSelectEl.addEventListener("change", () => {
  const run = async () => {
    if (editMode && dirty) {
      const edits = collectPathEdits(pageEl.contentDocument);
      workingResumeData = applyPathEdits(workingResumeData || {}, edits);
    }
    await persistActiveTemplate(templateSelectEl.value);
    await renderPreview({ keepWorkingCopy: editMode });
    if (editMode) {
      // iframe load handler re-enables contenteditable
      skipStorageRefresh = true;
    }
  };
  run().catch((err) => setStatus(String(err?.message || err), "err"));
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
    if (skipStorageRefresh && dirty) return;
    if (message.templateId) {
      templateId = message.templateId;
      templateSelectEl.value = templateId;
    }
    if (
      message.source === "draft" ||
      message.source === "last" ||
      message.source === "sample" ||
      message.source === "paste"
    ) {
      source = message.source;
    }
    editMode = false;
    dirty = false;
    skipStorageRefresh = false;
    workingResumeData = null;
    renderPreview().catch(() => {});
    return;
  }
  if (message?.type === "one_off_draft_updated") {
    if (skipStorageRefresh && dirty) return;
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
        editMode = false;
        dirty = false;
        workingResumeData = null;
        return renderPreview();
      })
      .catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.selected_template_id && !(skipStorageRefresh && dirty)) {
    const next = String(changes.selected_template_id.newValue || "").trim();
    if (next && next !== templateId) {
      templateId = next;
      templateSelectEl.value = next;
      const url = new URL(location.href);
      url.searchParams.set("template", next);
      history.replaceState({}, "", url);
      renderPreview({ keepWorkingCopy: editMode }).catch(() => {});
    }
  }
  if (changes[STYLE_EXPORT_PASTE_KEY] && (source === "paste" || params.get("source") === "paste")) {
    if (skipStorageRefresh && dirty) return;
    hasPaste = isResumePreviewable(changes[STYLE_EXPORT_PASTE_KEY].newValue);
    if (hasPaste) {
      source = "paste";
      editMode = false;
      dirty = false;
      workingResumeData = null;
      renderPreview().catch(() => {});
    } else {
      source = "sample";
      setStatus("Paste cleared.", "warn");
      editMode = false;
      dirty = false;
      workingResumeData = null;
      renderPreview().catch(() => {});
    }
  }
  if (!changes[ONE_OFF_DRAFT_KEY]) return;
  if (skipStorageRefresh && dirty) return;
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
      editMode = false;
      dirty = false;
      workingResumeData = null;
      renderPreview().catch(() => {});
    } else {
      source = "sample";
      editMode = false;
      dirty = false;
      workingResumeData = null;
      setStatus("Draft cleared.", "warn");
      updateEditChrome();
    }
  }
});

window.addEventListener("keydown", (event) => {
  const inEditable =
    event.target?.closest?.("[contenteditable='true']") ||
    (event.target && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName));
  if ((event.ctrlKey || event.metaKey) && String(event.key || "").toLowerCase() === "s") {
    if (editMode && canEditSource()) {
      event.preventDefault();
      saveEdits().catch((err) => setStatus(String(err?.message || err), "err"));
    }
    return;
  }
  if (inEditable) return;
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
