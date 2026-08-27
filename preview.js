import {
  DEFAULT_TEMPLATE_ID,
  getAllTemplates,
  getTemplateById,
  resumeJsonToHtml
} from "./templates/index.js";
import { getActivePerson } from "./profiles.js";
import { isResumePreviewable, sampleResumeForPerson } from "./templates/preview-sample.js";
import { loadAndApplyTheme, watchThemeChanges } from "./theme.js";

const PREVIEW_SOURCE_KEY = "template_preview_source";

const templateSelectEl = document.getElementById("templateSelect");
const sourceSampleBtn = document.getElementById("sourceSample");
const sourceLastBtn = document.getElementById("sourceLast");
const useStyleBtn = document.getElementById("useStyle");
const pageEl = document.getElementById("page");
const ledeEl = document.getElementById("previewLede");
const statusEl = document.getElementById("status");

let templateId = new URLSearchParams(location.search).get("template") || DEFAULT_TEMPLATE_ID;
let source = "sample";
let hasLastResume = false;

function setStatus(message) {
  statusEl.textContent = message || "";
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
  sourceLastBtn.classList.toggle("active", source === "last");
  sourceLastBtn.disabled = !hasLastResume;
}

async function loadResumeData() {
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
  if (kind === "last") {
    ledeEl.textContent = `Last generated resume · ${template.label}`;
  } else {
    ledeEl.textContent = `Sample layout · ${template.label} — next generate uses the active person’s content.`;
  }
}

async function initSource() {
  const stored = await chrome.storage.local.get(["last_resume_json", PREVIEW_SOURCE_KEY]);
  hasLastResume = isResumePreviewable(stored.last_resume_json);
  source = stored[PREVIEW_SOURCE_KEY] === "last" && hasLastResume ? "last" : "sample";
}

async function setSource(next) {
  if (next === "last" && !hasLastResume) {
    setStatus("No generated resume yet — showing sample layout.");
    source = "sample";
  } else {
    source = next;
  }
  await chrome.storage.local.set({ [PREVIEW_SOURCE_KEY]: source });
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
sourceLastBtn.addEventListener("click", () => setSource("last"));
useStyleBtn.addEventListener("click", () => useThisStyle().catch((err) => setStatus(String(err?.message || err))));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "template_preview_show") return;
  if (message.templateId) {
    templateId = message.templateId;
    templateSelectEl.value = templateId;
  }
  renderPreview().catch(() => {});
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
  .then(renderPreview)
  .catch((err) => setStatus(`Preview failed: ${String(err?.message || err)}`));
