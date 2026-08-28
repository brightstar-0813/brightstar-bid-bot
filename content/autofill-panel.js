/**
 * In-page autofill sidebar (Jobright-style). Top frame only.
 */
(() => {
  const PANEL_BUILD = "2026-08-29.panel02";
  if (window !== window.top) return;
  if (window.__brightstarAutofillPanelBuild === PANEL_BUILD) return;
  window.__brightstarAutofillPanelBuild = PANEL_BUILD;

  const ATS_HOST_RE =
    /(?:greenhouse|lever|indeed|myworkdayjobs|icims|taleo|successfactors|bamboohr|ashbyhq|smartrecruiters|jobvite|ultipro|dice|jobgether|braintrust|usebraintrust)\./i;
  const APPLY_PATH_RE = /\/(apply|application|job_app|careers\/apply)/i;

  function looksLikeApplyContext() {
    if (ATS_HOST_RE.test(location.hostname)) return true;
    if (APPLY_PATH_RE.test(location.pathname)) return true;
    return /\/apply\//i.test(location.href);
  }

  function shouldShowPanel(probe) {
    if (looksLikeApplyContext()) return true;
    if (probe?.isApplicationForm) return true;
    if (Number(probe?.fillableCount || 0) >= 1) return true;
    if (probe?.hasFormFields) return true;
    return false;
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
    allowSubmit: true
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

  function renderFieldList() {
    const list = qs("#fieldList");
    if (!list) return;
    if (!state.fields.length) {
      list.innerHTML = `<li class="panel-hint">No fields detected yet. Open an application form step.</li>`;
      return;
    }
    list.innerHTML = state.fields
      .map((f) => {
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
                  : f.matchSource === "unmatched"
                    ? `<span class="field-badge">AI?</span>`
                    : "";
        const statusClass =
          st === "filling" ? "filling" : st === "done" ? "done" : st === "error" ? "error" : st === "warn" ? "warn" : "pending";
        return `<li class="field-row" data-field-id="${escapeHtml(f.id)}">
          <span class="field-status ${statusClass}"></span>
          <span class="field-label">${escapeHtml(f.label)}</span>
          ${badge}
        </li>`;
      })
      .join("");
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

    if (shell) shell.hidden = !state.expanded;
    if (tab) tab.hidden = state.expanded;
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
              <button type="button" class="icon-btn" id="collapseBtn" title="Collapse">›</button>
              <button type="button" class="icon-btn" id="closeBtn" title="Collapse to tab">×</button>
            </div>
          </div>
          <div class="panel-body">
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
            <p class="panel-status" id="statusText"></p>
            <p class="field-section-title">Required</p>
            <ul class="field-list" id="fieldList"></ul>
            <p class="panel-hint">Uses your profile, Q&amp;A bank, then OpenAI for unknown questions.</p>
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
    qs("#autofillBtn")?.addEventListener("click", () => startAutofill());
    qs("#cancelBtn")?.addEventListener("click", () => cancelAutofill());
    qs("#profileLink")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "open_profile_editor", tab: "apply" }).catch(() => {});
    });
    qs("#allowSubmitToggle")?.addEventListener("change", (e) => {
      state.allowSubmit = Boolean(e.target.checked);
      chrome.storage.local.set({ allowSubmitOnAssist: state.allowSubmit }).catch(() => {});
    });

    chrome.storage.local.get(["allowSubmitOnAssist", "last_job_title", "last_job_company"], (data) => {
      state.allowSubmit = data.allowSubmitOnAssist !== false;
      state.jobTitle = data.last_job_title || "";
      state.jobCompany = data.last_job_company || "";
      updateUi();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.custom_profiles || changes.active_person_id) {
        runScan().catch(() => {});
      }
    });
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

    if (looksLikeApplyContext()) {
      showPanelTab({ expand: true });
      runScan().catch(() => {});
      return;
    }

    if (await probeAndMaybeShow({ expand: true })) return;

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
    state.statusText = result.fields?.length
      ? `${result.fields.length} field${result.fields.length === 1 ? "" : "s"} detected`
      : "Scan complete";
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

  async function runScan() {
    state.statusText = "Scanning page…";
    updateUi();
    try {
      const res = await chrome.runtime.sendMessage({ type: "autofill_panel_scan" });
      applyScanResult(res);
      state.profileIncomplete = Boolean(res?.profileIncomplete);
      if (res?.jobTitle) state.jobTitle = res.jobTitle;
      if (res?.jobCompany) state.jobCompany = res.jobCompany;
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
    state.statusText = "Starting autofill…";
    fieldStatusMap.clear();
    updateUi();
    try {
      const res = await chrome.runtime.sendMessage({
        type: "autofill_panel_start",
        allowSubmitOnAssist: state.allowSubmit
      });
      if (!res?.ok) {
        state.statusText = res?.error || "Autofill failed.";
      } else {
        state.statusText = res.detail || res.statusText || "Autofill complete.";
        state.progressPct = 100;
      }
    } catch (err) {
      state.statusText = String(err?.message || err);
    } finally {
      state.running = false;
      updateUi();
      runScan().catch(() => {});
    }
  }

  function cancelAutofill() {
    chrome.runtime.sendMessage({ type: "autofill_panel_cancel" }).catch(() => {});
    state.running = false;
    state.statusText = "Cancelled.";
    updateUi();
  }

  function handleProgress(msg) {
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
    if (msg.phase === "step") {
      state.stepLabel = msg.stepLabel || state.stepLabel;
      fieldStatusMap.clear();
    }
    if (msg.phase === "start") {
      state.running = true;
      fieldStatusMap.clear();
    }
    if (msg.phase === "done" || msg.phase === "cancelled") {
      state.running = false;
      if (msg.statusText) state.statusText = msg.statusText;
      if (typeof msg.progressPct === "number") state.progressPct = msg.progressPct;
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
