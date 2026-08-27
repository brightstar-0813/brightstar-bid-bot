import { getResumeProfiles } from "./profiles.js";
import {
  QA_FIELD_TYPES,
  fieldTypeLabel,
  normalizeFieldType,
  getAllQa,
  saveQa,
  deleteQa,
  clearQa,
  exportQa,
  importQa,
  parseQaBankPayload,
  loadBundledQaBank
} from "./qa-store.js";
import { loadAndApplyTheme, watchThemeChanges } from "./theme.js";

const SHARED_ID = "";
const ALL_ID = "__all__";
const PAGE_SIZE_KEY = "qa_editor_page_size";
const DEFAULT_PAGE_SIZE = 25;

const els = {
  status: document.getElementById("status"),
  filterProfile: document.getElementById("filterProfile"),
  filterType: document.getElementById("filterType"),
  searchInput: document.getElementById("searchInput"),
  countHint: document.getElementById("countHint"),
  formSection: document.getElementById("formSection"),
  formTitle: document.getElementById("formTitle"),
  formHint: document.getElementById("formHint"),
  editBanner: document.getElementById("editBanner"),
  editBannerText: document.getElementById("editBannerText"),
  formQuestion: document.getElementById("formQuestion"),
  formAnswer: document.getElementById("formAnswer"),
  formFieldType: document.getElementById("formFieldType"),
  formScope: document.getElementById("formScope"),
  saveBtn: document.getElementById("saveBtn"),
  cancelEditBtn: document.getElementById("cancelEditBtn"),
  savedSub: document.getElementById("savedSub"),
  qaList: document.getElementById("qaList"),
  pagination: document.getElementById("pagination"),
  pageFirst: document.getElementById("pageFirst"),
  pagePrev: document.getElementById("pagePrev"),
  pageNext: document.getElementById("pageNext"),
  pageLast: document.getElementById("pageLast"),
  pageMeta: document.getElementById("pageMeta"),
  pageSize: document.getElementById("pageSize"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importBundledBtn: document.getElementById("importBundledBtn"),
  importInput: document.getElementById("importInput"),
  remapImportToggle: document.getElementById("remapImportToggle"),
  clearBtn: document.getElementById("clearBtn")
};

const ACTION_ICON_PATHS = {
  cancel: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  remove: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 15H6L5 6"/><path d="M10 11v5m4-5v5"/>',
  bundled:
    '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.27 6.96 8.73 5.05 8.73-5.05M12 22.08V12"/>',
  import: '<path d="M12 3v12"/><path d="m7 10 5-5 5 5"/><path d="M5 21h14"/>',
  export: '<path d="M12 3v12"/><path d="m7 14 5 5 5-5"/><path d="M5 21h14"/>',
  first: '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/><path d="M5 5v14"/>',
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  last: '<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/><path d="M19 5v14"/>'
};

function setIconButton(button, icon, label) {
  if (!button) return;
  button.classList.add("icon-button");
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ACTION_ICON_PATHS[icon] || ""}</svg>`;
}

function wireStaticIcons() {
  setIconButton(els.cancelEditBtn, "cancel", "Cancel edit");
  setIconButton(els.saveBtn, "save", "Save Q&A");
  setIconButton(els.importBundledBtn, "bundled", "Load bundled bank");
  setIconButton(els.exportBtn, "export", "Export JSON");
  setIconButton(els.importBtn, "import", "Import JSON");
  setIconButton(els.clearBtn, "remove", "Clear this bank");
  setIconButton(els.pageFirst, "first", "First page");
  setIconButton(els.pagePrev, "prev", "Previous page");
  setIconButton(els.pageNext, "next", "Next page");
  setIconButton(els.pageLast, "last", "Last page");
}

/** @type {{ id: string, label: string }[]} */
let profiles = [];
/** @type {object[]} */
let allRows = [];
let editingId = null;
let currentPage = 1;
let pageSize = DEFAULT_PAGE_SIZE;

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.style.color = isError ? "var(--danger)" : "var(--ok)";
}

function urlProfileId() {
  return new URLSearchParams(location.search).get("profileId") || "";
}

function fillSelect(selectEl, options) {
  selectEl.innerHTML = "";
  for (const opt of options) {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    selectEl.appendChild(option);
  }
}

function profileLabel(id) {
  if (!id) return "Shared (all people)";
  return profiles.find((p) => p.id === id)?.label || id;
}

function initSelects() {
  fillSelect(els.filterType, [{ value: "", label: "All types" }, ...QA_FIELD_TYPES]);
  fillSelect(els.formFieldType, QA_FIELD_TYPES);

  fillSelect(els.filterProfile, [
    { value: ALL_ID, label: "All people + shared" },
    { value: SHARED_ID, label: "Shared (all people)" },
    ...profiles.map((p) => ({ value: p.id, label: p.label }))
  ]);

  fillSelect(els.formScope, [
    ...profiles.map((p) => ({ value: p.id, label: p.label })),
    { value: SHARED_ID, label: "Shared (all people)" }
  ]);

  const preferred = urlProfileId();
  if (preferred && profiles.some((p) => p.id === preferred)) {
    els.filterProfile.value = preferred;
    els.formScope.value = preferred;
  } else if (profiles[0]) {
    els.filterProfile.value = profiles[0].id;
    els.formScope.value = profiles[0].id;
  }
}

function filterProfileId() {
  return els.filterProfile.value;
}

function importRemapId() {
  if (!els.remapImportToggle?.checked) return null;
  return els.formScope.value || SHARED_ID;
}

function rowsForView() {
  const view = filterProfileId();
  const type = String(els.filterType.value || "").trim();
  const q = String(els.searchInput.value || "").trim().toLowerCase();
  return allRows.filter((row) => {
    if (view !== ALL_ID && (row.profileId || "") !== view) return false;
    if (type && normalizeFieldType(row.fieldType) !== type) return false;
    if (q) {
      const hay = `${row.question || ""} ${row.answer || ""} ${row.site || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function totalPagesFor(count) {
  return Math.max(1, Math.ceil(count / pageSize));
}

function clampPage(page, totalPages) {
  return Math.min(Math.max(1, page), totalPages);
}

function resetForm() {
  editingId = null;
  els.formTitle.textContent = "Add Q&A";
  setIconButton(els.saveBtn, "save", "Save Q&A");
  els.formHint.textContent =
    "Store the question text as it appears on the form. For dropdowns, save the option text to pick. For checkboxes, save Yes or No.";
  els.editBanner.hidden = true;
  els.formSection.classList.remove("is-editing");
  els.formQuestion.value = "";
  els.formAnswer.value = "";
  els.formFieldType.value = "text";
  const view = filterProfileId();
  if (view && view !== ALL_ID) els.formScope.value = view;
}

function startEdit(row) {
  editingId = row.id;
  els.formTitle.textContent = "Edit Q&A";
  setIconButton(els.saveBtn, "save", "Update Q&A");
  els.formHint.textContent = "Update the fields below, then click Update Q&A. Cancel to discard.";
  els.editBanner.hidden = false;
  els.editBannerText.textContent = `Editing: ${(row.question || "").slice(0, 80)}${
    (row.question || "").length > 80 ? "…" : ""
  }`;
  els.formSection.classList.add("is-editing");
  els.formQuestion.value = row.question || "";
  els.formAnswer.value = row.answer || "";
  els.formFieldType.value = normalizeFieldType(row.fieldType);
  els.formScope.value = row.profileId || SHARED_ID;
  els.formSection.scrollIntoView({ behavior: "smooth", block: "start" });
  els.formQuestion.focus();
  renderList();
}

function renderPagination(filteredCount) {
  const totalPages = totalPagesFor(filteredCount);
  currentPage = clampPage(currentPage, totalPages);

  if (filteredCount === 0) {
    els.pagination.hidden = true;
    return { start: 0, end: 0, totalPages: 1 };
  }

  els.pagination.hidden = false;
  const start = (currentPage - 1) * pageSize;
  const end = Math.min(start + pageSize, filteredCount);
  els.pageMeta.textContent = `Page ${currentPage} of ${totalPages} · showing ${start + 1}–${end} of ${filteredCount}`;
  const atStart = currentPage <= 1;
  const atEnd = currentPage >= totalPages;
  els.pageFirst.disabled = atStart;
  els.pagePrev.disabled = atStart;
  els.pageNext.disabled = atEnd;
  els.pageLast.disabled = atEnd;
  return { start, end, totalPages };
}

function goToPage(page) {
  currentPage = page;
  renderList();
  els.qaList.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderList() {
  const rows = rowsForView();
  const view = filterProfileId();
  const viewLabel = view === ALL_ID ? "all people" : profileLabel(view);
  els.countHint.textContent = `${rows.length} shown · ${allRows.length} total · viewing ${viewLabel}`;
  if (els.savedSub) {
    els.savedSub.textContent =
      rows.length === 0
        ? "No answers match the current filters"
        : `${rows.length} matching · page size ${pageSize}`;
  }

  const { start, end } = renderPagination(rows.length);
  els.qaList.innerHTML = "";

  if (!rows.length) {
    els.qaList.innerHTML =
      '<p class="qa-empty">No saved answers in this view. Import a JSON bank, load the bundled file, or add one above.</p>';
    return;
  }

  const pageRows = rows.slice(start, end);
  const frag = document.createDocumentFragment();
  for (const row of pageRows) {
    const item = document.createElement("div");
    item.className = "qa-item";
    if (row.id === editingId) item.classList.add("is-editing");

    const q = document.createElement("p");
    q.className = "qa-item-q";
    q.textContent = row.question;
    item.appendChild(q);

    const a = document.createElement("p");
    a.className = "qa-item-a-preview";
    a.textContent = row.answer;
    item.appendChild(a);

    const meta = document.createElement("div");
    meta.className = "qa-item-meta";

    const typeTag = document.createElement("span");
    typeTag.className = "qa-source-tag";
    typeTag.textContent = fieldTypeLabel(row.fieldType);
    meta.appendChild(typeTag);

    const src = document.createElement("span");
    src.className = `qa-source-tag ${row.source === "user" ? "qa-source-user" : "qa-source-ai"}`;
    src.textContent = row.source === "user" ? "manual" : "ai";
    meta.appendChild(src);

    const scope = document.createElement("span");
    scope.textContent = profileLabel(row.profileId || "");
    meta.appendChild(scope);

    const used = document.createElement("span");
    used.textContent = `used ${Number(row.timesUsed || 0)}×`;
    meta.appendChild(used);

    if (row.site) {
      const site = document.createElement("span");
      site.textContent = row.site;
      meta.appendChild(site);
    }

    const actions = document.createElement("div");
    actions.className = "qa-item-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ghost compact icon-button";
    setIconButton(edit, "edit", "Edit");
    edit.addEventListener("click", () => startEdit(row));
    actions.appendChild(edit);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost danger compact icon-button";
    setIconButton(del, "remove", "Delete");
    del.addEventListener("click", async () => {
      if (!window.confirm("Delete this Q&A?")) return;
      await deleteQa(row.id);
      if (editingId === row.id) resetForm();
      await reload();
      setStatus("Q&A deleted.");
    });
    actions.appendChild(del);

    meta.appendChild(actions);
    item.appendChild(meta);
    frag.appendChild(item);
  }
  els.qaList.appendChild(frag);
}

function onFiltersChanged() {
  currentPage = 1;
  renderList();
}

async function reload() {
  allRows = await getAllQa(null);
  renderList();
}

async function saveForm() {
  const question = String(els.formQuestion.value || "").trim();
  const answer = String(els.formAnswer.value || "").trim();
  if (!question || !answer) {
    setStatus("Enter both a question and an answer.", true);
    return;
  }

  const existing = editingId ? allRows.find((r) => r.id === editingId) : null;
  const saved = await saveQa({
    profileId: els.formScope.value || SHARED_ID,
    question,
    answer,
    fieldType: els.formFieldType.value || "text",
    source: "user",
    site: existing?.site || ""
  });

  if (editingId && saved?.id && saved.id !== editingId) {
    await deleteQa(editingId);
  }

  resetForm();
  await reload();
  setStatus(existing ? "Q&A updated." : "Q&A saved.");
}

async function exportShown() {
  const view = filterProfileId();
  const rows = view === ALL_ID ? await exportQa(null) : await exportQa(view);
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const suffix = view === ALL_ID ? "all" : view || "shared";
  a.download = `qa-bank-${suffix}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${rows.length} Q&A ${rows.length === 1 ? "entry" : "entries"}.`);
}

async function importRecords(records, sourceLabel) {
  const list = parseQaBankPayload(records);
  const remapProfileId = importRemapId();
  const target = remapProfileId != null ? profileLabel(remapProfileId) : "original profile IDs in the file";
  const ok = window.confirm(
    `Import ${list.length} answer${list.length === 1 ? "" : "s"} from ${sourceLabel} into ${target}?\n\n` +
      "Identity answers in the file (name, phone, LinkedIn) will be used for leftover form questions."
  );
  if (!ok) return;
  const count = await importQa(list, { remapProfileId });
  currentPage = 1;
  await reload();
  setStatus(`Imported ${count} Q&A ${count === 1 ? "entry" : "entries"} into ${target}.`);
}

async function importFromFile(file) {
  if (!file) return;
  const parsed = JSON.parse(await file.text());
  await importRecords(parsed, file.name || "JSON file");
}

async function importBundled() {
  const records = await loadBundledQaBank();
  await importRecords(records, "the bundled Steven Avon bank");
}

async function clearShown() {
  const view = filterProfileId();
  const label = view === ALL_ID ? "ALL people (entire bank)" : profileLabel(view);
  const ok = window.confirm(`Delete every Q&A shown for ${label}? This cannot be undone.`);
  if (!ok) return;
  if (view === ALL_ID) {
    await clearQa(null);
  } else {
    await clearQa(view);
  }
  resetForm();
  currentPage = 1;
  await reload();
  setStatus("Cleared.");
}

async function loadPageSizePreference() {
  try {
    const stored = await chrome.storage.local.get(PAGE_SIZE_KEY);
    const n = Number(stored[PAGE_SIZE_KEY]);
    if ([10, 25, 50, 100].includes(n)) {
      pageSize = n;
      els.pageSize.value = String(n);
    }
  } catch {
    /* ignore — default page size */
  }
}

els.filterProfile.addEventListener("change", () => {
  const view = filterProfileId();
  if (view && view !== ALL_ID) els.formScope.value = view;
  onFiltersChanged();
});
els.filterType.addEventListener("change", onFiltersChanged);
els.searchInput.addEventListener("input", onFiltersChanged);
els.pageFirst.addEventListener("click", () => goToPage(1));
els.pagePrev.addEventListener("click", () => goToPage(currentPage - 1));
els.pageNext.addEventListener("click", () => goToPage(currentPage + 1));
els.pageLast.addEventListener("click", () => {
  goToPage(totalPagesFor(rowsForView().length));
});
els.pageSize.addEventListener("change", () => {
  pageSize = Number(els.pageSize.value) || DEFAULT_PAGE_SIZE;
  currentPage = 1;
  chrome.storage.local.set({ [PAGE_SIZE_KEY]: pageSize }).catch(() => {});
  renderList();
});
els.saveBtn.addEventListener("click", () => {
  saveForm().catch((err) => setStatus(String(err.message || err), true));
});
els.cancelEditBtn.addEventListener("click", () => {
  resetForm();
  renderList();
});
els.exportBtn.addEventListener("click", () => {
  exportShown().catch((err) => setStatus(String(err.message || err), true));
});
els.importBtn.addEventListener("click", () => els.importInput.click());
els.importInput.addEventListener("change", () => {
  const file = els.importInput.files?.[0];
  importFromFile(file)
    .catch((err) => setStatus(`Import failed: ${String(err.message || err)}`, true))
    .finally(() => {
      els.importInput.value = "";
    });
});
els.importBundledBtn.addEventListener("click", () => {
  importBundled().catch((err) => setStatus(`Bundled import failed: ${String(err.message || err)}`, true));
});
els.clearBtn.addEventListener("click", () => {
  clearShown().catch((err) => setStatus(String(err.message || err), true));
});

let reloadTimer = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.qa_bank_version) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reload().catch(() => {});
    }, 200);
  }
});

(async () => {
  try {
    await loadAndApplyTheme();
    watchThemeChanges();
    wireStaticIcons();
    await loadPageSizePreference();
    profiles = await getResumeProfiles();
    initSelects();
    await reload();
  } catch (err) {
    setStatus(`Could not load Q&A bank: ${String(err.message || err)}`, true);
  }
})();
