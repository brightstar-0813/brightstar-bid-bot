/**
 * In-page autofill sidebar (Jobright-style). Top frame only.
 */
(() => {
  const PANEL_BUILD = "2026-09-10.panel15";
  if (window !== window.top) return;
  if (window.__brightstarAutofillPanelBuild === PANEL_BUILD) return;
  window.__brightstarAutofillPanelBuild = PANEL_BUILD;

  const ATS_HOST_RE =
    /(?:greenhouse|lever|indeed|myworkdayjobs|icims|taleo|successfactors|bamboohr|ashbyhq|smartrecruiters|jobvite|ultipro|dice|jobgether|braintrust|usebraintrust)\./i;
  const APPLY_PATH_RE = /\/(apply|application|job_app|careers\/apply)/i;

  function looksLikeApplyContext() {
    const pathQuery = `${location.pathname}${location.search}`;
    const host = location.hostname.toLowerCase();

    if (APPLY_PATH_RE.test(location.pathname)) return true;
    if (/\/apply\//i.test(pathQuery)) return true;
    if (/[?&]apply(?:=|&|$)/i.test(location.search)) return true;
    if (/myworkdayjobs\.com$/i.test(host) && /\/apply\b/i.test(pathQuery)) return true;
    if (
      /greenhouse\.io$/i.test(host)
    ) {
      // Job boards, embeds, and SPA apply forms (token / gh_jid query params).
      if (
        /\/(embed\/)?job_app\b|\/jobs\/|\/embed\//i.test(pathQuery) ||
        /[?&](gh_jid|token|for)=/i.test(pathQuery)
      ) {
        return true;
      }
      // Fallback: classic Greenhouse application inputs already on the page.
      try {
        if (
          document.querySelector(
            '#first_name, #last_name, input[name="job_application[first_name]"], input[autocomplete="email"], input[type="email"]'
          )
        ) {
          return true;
        }
      } catch {
        /* ignore */
      }
    }
    if (/lever\.co$/i.test(host) && /\/apply\b/i.test(pathQuery)) return true;
    if (/indeed\.com$/i.test(host) && /(indeedapply|viewjob.*apply|from=smartapply)/i.test(pathQuery)) {
      return true;
    }
    if (/ashbyhq\.com$/i.test(host) && /\/application\b/i.test(pathQuery)) return true;
    return false;
  }

  function isAtsHost() {
    return ATS_HOST_RE.test(location.hostname);
  }

  function shouldShowPanel(probe) {
    if (probe?.isApplicationForm) return true;
    return looksLikeApplyContext();
  }

  function shouldInitPanel() {
    return looksLikeApplyContext() || isAtsHost();
  }

  async function isAutofillEnabled() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["autofill_enabled"], (data) => {
        resolve(data.autofill_enabled !== false);
      });
    });
  }

  let hostEl = null;
  let shadow = null;
  let navWatchInstalled = false;
  let formWatchInstalled = false;
  let rescanTimer = null;
  let rescanRetries = 0;
  let state = {
    expanded: false,
    running: false,
    fields: [],
    stepLabel: "",
    progressPct: 0,
    statusText: "",
    jobTitle: "",
    jobCompany: "",
    profileIncomplete: false,
    allowSubmit: true,
    liveAutoSubmit: null,
    site: "",
    siteLabel: "",
    resultStatus: "",
    stats: { filled: 0, bank: 0, ai: 0, steps: 0 },
    answerFieldId: ""
  };

  const fieldStatusMap = new Map();

  function qs(sel) {
    return shadow?.querySelector(sel);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadCss() {
    try {
      const url = chrome.runtime.getURL("content/autofill-panel.css");
      const res = await fetch(url);
      return res.ok ? res.text() : "";
    } catch {
      return "";
    }
  }

  function fieldBuckets() {
    const needs = [];
    const matched = [];
    const filled = [];
    const optional = [];
    for (const f of state.fields) {
      const st = fieldStatusMap.get(f.id) || (f.matchSource === "filled" ? "done" : "pending");
      if (st === "done" || f.matchSource === "filled") filled.push(f);
      else if (f.matchSource === "optional") optional.push(f);
      else if (f.matchSource === "unmatched") needs.push(f);
      else matched.push(f);
    }
    return { needs, matched, filled, optional };
  }

  function renderAnswerEditor(f) {
    if (state.answerFieldId !== f.id) return "";
    const opts = Array.isArray(f.options) ? f.options.filter(Boolean).slice(0, 40) : [];
    const choice =
      opts.length >= 2 ||
      ["select", "radio", "checkbox", "combobox", "choice"].includes(String(f.type || "").toLowerCase());
    if (choice && opts.length) {
      const optionsHtml = [
        `<option value="">Select…</option>`,
        ...opts.map(
          (o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`
        )
      ].join("");
      return `<div class="field-answer" data-answer-for="${escapeHtml(f.id)}">
        <select class="field-answer-input" data-field-id="${escapeHtml(f.id)}">${optionsHtml}</select>
        <button type="button" class="field-answer-btn" data-apply-id="${escapeHtml(f.id)}">Apply</button>
      </div>`;
    }
    return `<div class="field-answer" data-answer-for="${escapeHtml(f.id)}">
      <input type="text" class="field-answer-input" data-field-id="${escapeHtml(f.id)}" placeholder="Type answer…" />
      <button type="button" class="field-answer-btn" data-apply-id="${escapeHtml(f.id)}">Apply</button>
    </div>`;
  }

  function renderFieldRow(f) {
    const st = fieldStatusMap.get(f.id) || (f.matchSource === "filled" ? "done" : "pending");
    const badge =
      st === "done" && fieldStatusMap.get(`${f.id}:source`) === "ai"
        ? `<span class="field-badge ai">AI</span>`
        : st === "done" && fieldStatusMap.get(`${f.id}:source`) === "bank"
          ? `<span class="field-badge bank">bank</span>`
          : f.matchSource === "profile"
            ? `<span class="field-badge">profile</span>`
            : f.matchSource === "extra"
              ? `<span class="field-badge">extra</span>`
              : f.matchSource === "bank"
                ? `<span class="field-badge bank">bank</span>`
                : f.matchSource === "credential"
                  ? `<span class="field-badge">login</span>`
                  : f.matchSource === "unmatched"
                    ? `<span class="field-badge warn">needs you</span>`
                    : f.matchSource === "optional"
                      ? `<span class="field-badge">skip</span>`
                      : f.required
                        ? `<span class="field-badge">req</span>`
                        : "";
    const statusClass =
      st === "filling" ? "filling" : st === "done" ? "done" : st === "error" ? "error" : st === "warn" ? "warn" : "pending";
    const req = f.required ? ` data-required="1"` : "";
    const open = state.answerFieldId === f.id ? ` data-open="1"` : "";
    const isNeed = f.matchSource === "unmatched" && st !== "done";
    const title = isNeed
      ? "Click to answer here or highlight on page"
      : "Click to highlight on page";
    return `<li class="field-row${isNeed ? " needs-answer" : ""}" data-field-id="${escapeHtml(f.id)}"${req}${open} title="${title}">
      <div class="field-row-main">
        <span class="field-status ${statusClass}"></span>
        <span class="field-label">${escapeHtml(f.label)}</span>
        ${badge}
      </div>
      ${isNeed ? renderAnswerEditor(f) : ""}
    </li>`;
  }

  function renderFieldList() {
    const list = qs("#fieldList");
    if (!list) return;
    if (!state.fields.length) {
      list.innerHTML = `<li class="panel-hint">No fields detected yet.</li>`;
      return;
    }
    const { needs, matched, filled, optional } = fieldBuckets();
    const sections = [];
    if (needs.length) {
      sections.push(
        `<li class="field-group-title">Needs attention (${needs.length})</li>`,
        ...needs.map(renderFieldRow)
      );
    }
    if (matched.length) {
      sections.push(
        `<li class="field-group-title">Ready to fill (${matched.length})</li>`,
        ...matched.map(renderFieldRow)
      );
    }
    if (optional.length) {
      sections.push(
        `<li class="field-group-title">Leave blank (${optional.length})</li>`,
        ...optional.map(renderFieldRow)
      );
    }
    if (filled.length) {
      sections.push(
        `<li class="field-group-title">Filled (${filled.length})</li>`,
        ...filled.map(renderFieldRow)
      );
    }
    list.innerHTML = sections.join("");
  }

  function resultTone(status) {
    if (status === "submitted") return "ok";
    if (status === "ready_for_review") return "warn";
    if (status === "cancelled" || status === "skipped") return "muted";
    if (status === "needs_review" || status === "unavailable") return "err";
    return "";
  }

  function updateUi() {
    const shell = qs("#panelShell");
    const tab = qs("#panelTab");
    const progressBlock = qs("#progressBlock");
    const autofillBtn = qs("#autofillBtn");
    const stepEl = qs("#stepLabel");
    const statusEl = qs("#statusText");
    const pctEl = qs("#progressPct");
    const fillEl = qs("#progressFill");
    const jobCard = qs("#jobCard");
    const jobTitle = qs("#jobTitle");
    const jobCompany = qs("#jobCompany");
    const profileDot = qs("#profileDot");
    const siteChip = qs("#siteChip");
    const modeChip = qs("#modeChip");
    const statsRow = qs("#statsRow");
    const resultBanner = qs("#resultBanner");

    if (shell) shell.hidden = !state.expanded;
    if (tab) {
      tab.hidden = state.expanded;
      tab.classList.toggle("running", state.running);
      tab.textContent = state.running ? "Filling…" : "Autofill";
    }
    if (stepEl) stepEl.textContent = state.stepLabel ? `Step: ${state.stepLabel}` : "";
    if (statusEl) statusEl.textContent = state.statusText || "";
    if (progressBlock) progressBlock.hidden = !state.running;
    if (autofillBtn) {
      autofillBtn.disabled = state.running;
      autofillBtn.textContent = state.running ? "Autofilling…" : "Autofill";
    }
    if (pctEl) pctEl.textContent = `${state.progressPct}%`;
    if (fillEl) fillEl.style.width = `${state.progressPct}%`;
    if (jobCard && jobTitle && jobCompany) {
      if (state.jobTitle || state.jobCompany) {
        jobCard.hidden = false;
        jobTitle.textContent = state.jobTitle || "Application";
        jobCompany.textContent = state.jobCompany || "";
      } else {
        jobCard.hidden = true;
      }
    }
    if (profileDot) {
      profileDot.classList.toggle("ok", !state.profileIncomplete);
      profileDot.hidden = !state.profileIncomplete;
    }
    const submitToggle = qs("#allowSubmitToggle");
    if (submitToggle) submitToggle.checked = state.allowSubmit;
    if (siteChip) {
      const label = state.siteLabel || state.site || "";
      siteChip.hidden = !label;
      siteChip.textContent = label || "";
    }
    if (modeChip) {
      const live =
        state.running && typeof state.liveAutoSubmit === "boolean"
          ? state.liveAutoSubmit
          : state.allowSubmit;
      modeChip.hidden = false;
      modeChip.textContent = live ? "Auto-submit" : "Review first";
      modeChip.classList.toggle("submit-on", live);
      modeChip.classList.toggle("submit-off", !live);
    }
    if (statsRow) {
      const { needs, matched, filled } = fieldBuckets();
      const show =
        state.fields.length > 0 ||
        state.stats.filled > 0 ||
        state.stats.bank > 0 ||
        state.stats.ai > 0;
      statsRow.hidden = !show;
      statsRow.innerHTML = [
        `<span class="stat"><strong>${filled.length || state.stats.filled || 0}</strong> filled</span>`,
        `<span class="stat"><strong>${matched.length}</strong> ready</span>`,
        `<span class="stat"><strong>${needs.length}</strong> open</span>`,
        state.stats.bank
          ? `<span class="stat"><strong>${state.stats.bank}</strong> bank</span>`
          : "",
        state.stats.ai ? `<span class="stat"><strong>${state.stats.ai}</strong> AI</span>` : "",
        state.stats.steps ? `<span class="stat"><strong>${state.stats.steps}</strong> steps</span>` : ""
      ]
        .filter(Boolean)
        .join("");
    }
    if (resultBanner) {
      const tone = resultTone(state.resultStatus);
      if (state.resultStatus && !state.running) {
        resultBanner.hidden = false;
        resultBanner.className = `result-banner ${tone}`;
        resultBanner.textContent = state.statusText || state.resultStatus;
      } else {
        resultBanner.hidden = true;
      }
    }
    renderFieldList();
  }

  function mountPanel() {
    if (hostEl) return;
    hostEl = document.createElement("div");
    hostEl.setAttribute("data-brightstar-autofill-panel", "1");
    Object.assign(hostEl.style, {
      position: "fixed",
      top: "0",
      right: "0",
      width: "0",
      height: "0",
      overflow: "visible",
      zIndex: "2147483645",
      pointerEvents: "none"
    });
    shadow = hostEl.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(hostEl);

    const iconUrl = chrome.runtime.getURL("icons/brightstar-icon.svg");

    shadow.innerHTML = `
      <style id="panelStyles"></style>
      <div class="panel-root">
        <button type="button" class="panel-tab" id="panelTab" title="Brightstar Autofill">Autofill</button>
        <div class="panel-shell" id="panelShell" hidden>
          <div class="panel-header">
            <div class="panel-brand">
              <img src="${iconUrl}" alt="" />
              <span>Brightstar</span>
            </div>
            <div class="panel-header-actions">
              <button type="button" class="icon-btn" id="rescanBtn" title="Rescan fields">↻</button>
              <button type="button" class="icon-btn" id="collapseBtn" title="Collapse">›</button>
              <button type="button" class="icon-btn" id="closeBtn" title="Collapse to tab">×</button>
            </div>
          </div>
          <div class="panel-body">
            <div class="chip-row" id="chipRow">
              <span class="chip site" id="siteChip" hidden></span>
              <span class="chip mode" id="modeChip">Review first</span>
            </div>
            <div class="job-card" id="jobCard" hidden>
              <div class="company" id="jobCompany"></div>
              <div class="title" id="jobTitle"></div>
            </div>
            <button type="button" class="profile-link" id="profileLink">
              <span>Your autofill information</span>
              <span class="dot" id="profileDot"></span>
            </button>
            <div class="step-label" id="stepLabel"></div>
            <button type="button" class="autofill-btn" id="autofillBtn">Autofill</button>
            <label class="toggle-row">
              <span>Allow auto submit</span>
              <input type="checkbox" id="allowSubmitToggle" checked />
            </label>
            <div class="progress-block" id="progressBlock" hidden>
              <div class="progress-head">
                <span>Autofilling… <strong id="progressPct">0%</strong></span>
                <button type="button" class="cancel" id="cancelBtn">Cancel</button>
              </div>
              <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
            </div>
            <div class="result-banner" id="resultBanner" hidden></div>
            <div class="stats-row" id="statsRow" hidden></div>
            <p class="panel-status" id="statusText"></p>
            <p class="field-section-title">Fields</p>
            <ul class="field-list" id="fieldList"></ul>
          </div>
        </div>
      </div>
    `;

    loadCss().then((css) => {
      const styleEl = qs("#panelStyles");
      if (styleEl && css) styleEl.textContent = css;
    });

    qs("#panelTab")?.addEventListener("click", () => {
      state.expanded = true;
      updateUi();
      runScan().catch(() => {});
    });
    qs("#collapseBtn")?.addEventListener("click", () => {
      state.expanded = false;
      updateUi();
    });
    qs("#closeBtn")?.addEventListener("click", () => {
      state.expanded = false;
      updateUi();
    });
    qs("#rescanBtn")?.addEventListener("click", () => {
      if (!state.running) runScan().catch(() => {});
    });
    qs("#autofillBtn")?.addEventListener("click", () => startAutofill());
    qs("#cancelBtn")?.addEventListener("click", () => cancelAutofill());
    qs("#profileLink")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "open_profile_editor", tab: "apply" }).catch(() => {});
    });
    qs("#allowSubmitToggle")?.addEventListener("change", (e) => {
      state.allowSubmit = Boolean(e.target.checked);
      chrome.storage.local.set({ allowSubmitOnAssist: state.allowSubmit }).catch(() => {});
      updateUi();
    });
    qs("#fieldList")?.addEventListener("click", (e) => {
      const applyBtn = e.target?.closest?.("[data-apply-id]");
      if (applyBtn) {
        e.preventDefault();
        e.stopPropagation();
        applyPanelAnswer(applyBtn.getAttribute("data-apply-id")).catch(() => {});
        return;
      }
      if (e.target?.closest?.(".field-answer")) {
        e.stopPropagation();
        return;
      }
      const row = e.target?.closest?.("[data-field-id]");
      if (!row) return;
      const fieldId = row.getAttribute("data-field-id");
      if (!fieldId) return;
      const field = state.fields.find((f) => f.id === fieldId);
      if (field?.matchSource === "unmatched") {
        state.answerFieldId = state.answerFieldId === fieldId ? "" : fieldId;
        updateUi();
      }
      chrome.runtime
        .sendMessage({ type: "autofill_panel_highlight", fieldId })
        .catch(() => {});
    });

    qs("#fieldList")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const input = e.target?.closest?.(".field-answer-input");
      if (!input) return;
      e.preventDefault();
      const fieldId = input.getAttribute("data-field-id");
      if (fieldId) applyPanelAnswer(fieldId).catch(() => {});
    });

    chrome.storage.local.get(["allowSubmitOnAssist", "last_job_title", "last_job_company"], (data) => {
      state.allowSubmit = data.allowSubmitOnAssist !== false;
      state.jobTitle = data.last_job_title || "";
      state.jobCompany = data.last_job_company || "";
      updateUi();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      // Do not rescan on every profile learn write — that steals focus while the user types.
      if (changes.active_person_id) {
        scheduleRescan(1500);
      }
      // User-filled answers landed in the Q&A bank — refresh panel badges.
      if (changes.qa_bank_version) {
        scheduleRescan(700, { force: false });
      }
      if (changes.last_job_title) state.jobTitle = changes.last_job_title.newValue || "";
      if (changes.last_job_company) state.jobCompany = changes.last_job_company.newValue || "";
      if (changes.last_job_title || changes.last_job_company) updateUi();
      if (changes.allowSubmitOnAssist) {
        state.allowSubmit = changes.allowSubmitOnAssist.newValue !== false;
        updateUi();
      }
    });

    installNavWatch();
    installFormWatch();
  }

  function isFormControlFocused() {
    try {
      const a = document.activeElement;
      if (!a || a === document.body) return false;
      // Typing in the Brightstar panel itself should not block page rescans.
      if (hostEl?.contains?.(a) || shadow?.contains?.(a)) return false;
      return Boolean(
        a.matches?.(
          "input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox']"
        )
      );
    } catch {
      return false;
    }
  }

  function scheduleRescan(delayMs = 700, { force = false } = {}) {
    if (state.running) return;
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      if (state.running) return;
      // While the user is mid-keystroke, retry instead of dropping — otherwise the
      // panel stays stale forever as they tab through fields.
      if (!force && isFormControlFocused()) {
        if (rescanRetries < 10) {
          rescanRetries += 1;
          scheduleRescan(600, { force: false });
        }
        return;
      }
      rescanRetries = 0;
      if (!state.expanded && !shouldInitPanel()) return;
      runScan().catch(() => {});
    }, delayMs);
  }

  function installFormWatch() {
    if (formWatchInstalled) return;
    formWatchInstalled = true;
    const onFormChange = (event) => {
      const t = event?.target;
      if (!t || typeof t.matches !== "function") return;
      if (hostEl?.contains?.(t)) return;
      if (
        !t.matches?.(
          "input, textarea, select, [role='combobox'], [contenteditable='true']"
        )
      ) {
        return;
      }
      // Selects/radios finish on change; text fields finish on focusout.
      const type = String(t.type || "").toLowerCase();
      if (event.type === "change" || type === "radio" || type === "checkbox" || t.tagName === "SELECT") {
        scheduleRescan(450, { force: true });
        return;
      }
      if (event.type === "focusout") {
        scheduleRescan(500, { force: false });
      }
    };
    document.addEventListener("change", onFormChange, true);
    document.addEventListener("focusout", onFormChange, true);
    document.addEventListener(
      "click",
      (event) => {
        const opt = event.target?.closest?.(
          '[role="option"], .select__option, [class*="select__option"]'
        );
        if (opt) scheduleRescan(350, { force: true });
      },
      true
    );
  }

  function installNavWatch() {
    if (navWatchInstalled) return;
    navWatchInstalled = true;
    let lastHref = location.href;
    const onNav = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      scheduleRescan(500, { force: true });
    };
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    const wrap = (name) => {
      const orig = history[name];
      if (typeof orig !== "function") return;
      history[name] = function patchedHistory(...args) {
        const ret = orig.apply(this, args);
        onNav();
        return ret;
      };
    };
    try {
      wrap("pushState");
      wrap("replaceState");
    } catch {
      /* ignore */
    }
  }

  function showPanelTab({ expand = false } = {}) {
    mountPanel();
    if (hostEl) hostEl.style.display = "";
    if (expand) {
      state.expanded = true;
      updateUi();
    }
  }

  async function probeAndMaybeShow({ expand = false } = {}) {
    if (!(await isAutofillEnabled())) return false;
    try {
      const probe = await chrome.runtime.sendMessage({ type: "autofill_panel_probe" });
      if (shouldShowPanel(probe)) {
        showPanelTab({ expand });
        if (!state.fields.length) await runScan();
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  let probeAttempts = 0;
  const MAX_PROBE_ATTEMPTS = 20;

  async function initPanelVisibility() {
    if (!(await isAutofillEnabled())) return;
    if (!shouldInitPanel()) return;

    // Show the tab immediately on ATS/apply pages — never wait ~30s for a probe.
    const applyCtx = looksLikeApplyContext();
    if (applyCtx || isAtsHost()) {
      showPanelTab({ expand: applyCtx || /greenhouse\.io$/i.test(location.hostname.toLowerCase()) });
    }

    if (await probeAndMaybeShow({ expand: applyCtx })) return;

    if (probeAttempts < MAX_PROBE_ATTEMPTS) {
      probeAttempts += 1;
      setTimeout(initPanelVisibility, 1500);
    }
  }

  function applyScanResult(result) {
    if (!result?.ok) {
      state.statusText = result?.error || "No application form on this page.";
      state.fields = [];
      updateUi();
      return;
    }
    state.fields = result.fields || [];
    state.stepLabel = result.stepLabel || "";
    state.site = result.site || state.site;
    state.siteLabel = result.siteLabel || state.siteLabel;
    state.statusText = result.fields?.length
      ? `${result.fields.length} field${result.fields.length === 1 ? "" : "s"} detected`
      : "Scan complete";
    if (state.answerFieldId && !state.fields.some((f) => f.id === state.answerFieldId)) {
      state.answerFieldId = "";
    }
    fieldStatusMap.clear();
    for (const f of state.fields) {
      if (f.matchSource === "filled") fieldStatusMap.set(f.id, "done");
    }
    const filled = state.fields.filter((f) => f.matchSource === "filled").length;
    state.progressPct = state.fields.length
      ? Math.round((filled / state.fields.length) * 100)
      : 0;
    updateUi();
  }

  async function applyPanelAnswer(fieldId) {
    const id = String(fieldId || "").trim();
    if (!id || state.running) return;
    const field = state.fields.find((f) => f.id === id);
    if (!field) return;
    const wrap = qs(`[data-answer-for="${CSS.escape(id)}"]`);
    const input = wrap?.querySelector?.(".field-answer-input");
    const answer = String(input?.value || "").trim();
    if (!answer) {
      state.statusText = "Enter an answer first.";
      updateUi();
      return;
    }
    fieldStatusMap.set(id, "filling");
    state.statusText = "Applying answer…";
    updateUi();
    try {
      const res = await chrome.runtime.sendMessage({
        type: "autofill_panel_answer",
        fieldId: id,
        label: field.label || "",
        answer,
        fieldType: field.type || "text",
        options: field.options || []
      });
      if (!res?.ok) {
        fieldStatusMap.set(id, "error");
        state.statusText = res?.error || "Could not apply answer.";
        updateUi();
        return;
      }
      fieldStatusMap.set(id, "done");
      fieldStatusMap.set(`${id}:source`, "bank");
      state.answerFieldId = "";
      state.statusText = "Answer saved to Q&A bank.";
      updateUi();
      runScan().catch(() => {});
    } catch (err) {
      fieldStatusMap.set(id, "error");
      state.statusText = String(err?.message || err);
      updateUi();
    }
  }

  async function runScan() {
    state.statusText = "Scanning page…";
    state.resultStatus = "";
    updateUi();
    try {
      const res = await chrome.runtime.sendMessage({ type: "autofill_panel_scan" });
      applyScanResult(res);
      state.profileIncomplete = Boolean(res?.profileIncomplete);
      if (res?.jobTitle) state.jobTitle = res.jobTitle;
      if (res?.jobCompany) state.jobCompany = res.jobCompany;
      if (res?.site) state.site = res.site;
      if (res?.siteLabel) state.siteLabel = res.siteLabel;
      updateUi();
    } catch (err) {
      state.statusText = String(err?.message || err);
      updateUi();
    }
  }

  async function startAutofill() {
    if (state.running) return;
    state.running = true;
    state.progressPct = 0;
    state.resultStatus = "";
    state.statusText = "Starting autofill…";
    state.stats = { filled: 0, bank: 0, ai: 0, steps: 0 };
    fieldStatusMap.clear();
    updateUi();
    try {
      const res = await chrome.runtime.sendMessage({
        type: "autofill_panel_start",
        allowSubmitOnAssist: state.allowSubmit
      });
      if (!res?.ok) {
        state.statusText = res?.error || "Autofill failed.";
        state.resultStatus = res?.status || "needs_review";
      } else {
        state.statusText = res.detail || res.statusText || "Autofill complete.";
        state.resultStatus = res.status || "done";
        state.progressPct = 100;
        state.stats = {
          filled: Number(res.filledCount || res.filled || 0),
          bank: Number(res.bankHits || 0),
          ai: Number(res.aiHits || 0),
          steps: Number(res.steps || 0)
        };
        if (res.site) state.site = res.site;
        if (res.siteLabel) state.siteLabel = res.siteLabel;
      }
    } catch (err) {
      state.statusText = String(err?.message || err);
      state.resultStatus = "needs_review";
    } finally {
      state.running = false;
      updateUi();
      runScan().catch(() => {});
    }
  }

  function cancelAutofill() {
    chrome.runtime.sendMessage({ type: "autofill_panel_cancel" }).catch(() => {});
    state.running = false;
    state.resultStatus = "cancelled";
    state.statusText = "Cancelled.";
    updateUi();
  }

  function handleProgress(msg) {
    const expandPanel =
      state.expanded ||
      state.running ||
      msg.phase === "start" ||
      msg.phase === "step" ||
      msg.phase === "field" ||
      msg.phase === "filled" ||
      msg.phase === "advance" ||
      msg.phase === "scan" ||
      msg.phase === "done" ||
      msg.phase === "cancelled";
    showPanelTab({ expand: expandPanel });
    if (msg.phase === "field") {
      if (msg.id) {
        fieldStatusMap.set(msg.id, msg.status || "done");
        if (msg.source) fieldStatusMap.set(`${msg.id}:source`, msg.source);
      }
    }
    if (msg.phase === "scan" && Array.isArray(msg.fields)) {
      state.fields = msg.fields;
      state.stepLabel = msg.stepLabel || state.stepLabel;
    }
    if (typeof msg.progressPct === "number") state.progressPct = msg.progressPct;
    if (msg.statusText) state.statusText = msg.statusText;
    if (msg.site) state.site = msg.site;
    if (msg.siteLabel) state.siteLabel = msg.siteLabel;
    if (typeof msg.autoSubmit === "boolean") state.liveAutoSubmit = msg.autoSubmit;
    if (msg.phase === "step") {
      state.stepLabel =
        msg.stepLabel ||
        (msg.step && msg.stepBudget ? `${msg.step}/${msg.stepBudget}` : state.stepLabel);
      fieldStatusMap.clear();
    }
    if (msg.phase === "filled") {
      state.stats = {
        filled: Number(msg.filledCount || state.stats.filled || 0),
        bank: Number(msg.bankHits || state.stats.bank || 0),
        ai: Number(msg.aiHits || state.stats.ai || 0),
        steps: Number(msg.step || state.stats.steps || 0)
      };
    }
    if (msg.phase === "start") {
      state.running = true;
      state.resultStatus = "";
      state.liveAutoSubmit = typeof msg.autoSubmit === "boolean" ? msg.autoSubmit : null;
      fieldStatusMap.clear();
    }
    if (msg.phase === "done" || msg.phase === "cancelled") {
      state.running = false;
      state.liveAutoSubmit = null;
      state.resultStatus = msg.status || msg.phase;
      if (msg.statusText) state.statusText = msg.statusText;
      if (typeof msg.progressPct === "number") state.progressPct = msg.progressPct;
      if (msg.filledCount != null || msg.bankHits != null || msg.aiHits != null || msg.steps != null) {
        state.stats = {
          filled: Number(msg.filledCount ?? state.stats.filled ?? 0),
          bank: Number(msg.bankHits ?? state.stats.bank ?? 0),
          ai: Number(msg.aiHits ?? state.stats.ai ?? 0),
          steps: Number(msg.steps ?? state.stats.steps ?? 0)
        };
      }
    }
    updateUi();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "autofill_panel_ping") {
      sendResponse({ ok: true, build: PANEL_BUILD });
      return false;
    }
    if (message?.type === "autofill_progress") {
      handleProgress(message);
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "autofill_panel_show") {
      const expand = message.expand !== false;
      showPanelTab({ expand });
      runScan()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    }
    return undefined;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(initPanelVisibility, 400);
    });
  } else {
    setTimeout(initPanelVisibility, 400);
  }
})();
