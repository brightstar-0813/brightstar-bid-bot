/**
 * In-app confirm dialog — replaces window.confirm in extension pages.
 */

function shortDialogTip(text, max = 48) {
  const line = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).trimEnd()}…`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ title?: string, message?: string, confirmText?: string, cancelText?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog({
  title = "Confirm",
  message = "",
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false
} = {}) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.className = "ui-dialog-host";
    host.innerHTML = `
      <div class="ui-dialog-backdrop" data-ui-dismiss></div>
      <div class="ui-dialog" role="alertdialog" aria-labelledby="ui-dialog-title" aria-describedby="ui-dialog-msg">
        <p class="ui-dialog-title" id="ui-dialog-title">${escapeHtml(title)}</p>
        <p class="ui-dialog-message" id="ui-dialog-msg">${escapeHtml(message).replace(/\n/g, "<br>")}</p>
        <div class="ui-dialog-actions">
          <button type="button" class="ghost ui-dialog-cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="${danger ? "danger primary" : "primary"} ui-dialog-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      host.remove();
      resolve(Boolean(value));
    };

    const onKey = (e) => {
      if (e.key === "Escape") finish(false);
    };

    document.body.appendChild(host);
    document.addEventListener("keydown", onKey);

    host.querySelector("[data-ui-dismiss]")?.addEventListener("click", () => finish(false));
    host.querySelector(".ui-dialog-cancel")?.addEventListener("click", () => finish(false));
    host.querySelector(".ui-dialog-confirm")?.addEventListener("click", () => finish(true));
    host.querySelector(".ui-dialog-confirm")?.focus();
  });
}

/**
 * Job details form for style-export / Manual Bid-style save.
 *
 * With `templateOnly` the header gets a switch. On: the job fields hide, a format picker
 * shows, and the result carries `templateOnly: true` with empty job fields, so the caller
 * can download the styled resume without any job context. Off (default): unchanged.
 * @param {{
 *   title?: string,
 *   confirmText?: string,
 *   cancelText?: string,
 *   previewText?: string,
 *   clearText?: string,
 *   templates?: Array<{ id: string, label: string, description?: string }>,
 *   templateOnly?: null | {
 *     label?: string,
 *     hint?: string,
 *     title?: string,
 *     note?: string,
 *     confirmText?: string,
 *     formats?: Array<{ id: string, label: string }>
 *   },
 *   onPreview?: (values: {
 *     jobTitle: string,
 *     companyName: string,
 *     jdLink: string,
 *     jdText: string,
 *     templateId: string,
 *     templateOnly: boolean,
 *     format: string
 *   }) => void | Promise<void>,
 *   initial?: {
 *     jobTitle?: string,
 *     companyName?: string,
 *     jdLink?: string,
 *     jdText?: string,
 *     templateId?: string,
 *     templateOnly?: boolean,
 *     format?: string
 *   }
 * }} opts
 * @returns {Promise<null | {
 *   jobTitle: string,
 *   companyName: string,
 *   jdLink: string,
 *   jdText: string,
 *   templateId: string,
 *   templateOnly: boolean,
 *   format: string
 * }>}
 */
export function jobDetailsDialog({
  title = "Job details",
  confirmText = "Export & save",
  cancelText = "Cancel",
  previewText = "Preview",
  clearText = "Clear",
  templates = [],
  templateOnly = null,
  onPreview = null,
  initial = {}
} = {}) {
  return new Promise((resolve) => {
    const templateOptions = (Array.isArray(templates) ? templates : [])
      .map((t) => {
        const id = String(t?.id || "").trim();
        if (!id) return "";
        const label = escapeHtml(t.label || id);
        const desc = t.description ? ` title="${escapeHtml(shortDialogTip(t.description))}"` : "";
        return `<option value="${escapeHtml(id)}"${desc}>${label}</option>`;
      })
      .filter(Boolean)
      .join("");

    const showPreview = typeof onPreview === "function";
    const toggle = templateOnly && typeof templateOnly === "object" ? templateOnly : null;
    const formatOptions = (Array.isArray(toggle?.formats) ? toggle.formats : [])
      .map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.label || f.id)}</option>`)
      .join("");
    const switchHtml = toggle
      ? `<label class="ui-dialog-switch" title="${escapeHtml(toggle.hint || "")}">
            <input type="checkbox" name="templateOnly" role="switch" />
            <span class="ui-dialog-switch-track" aria-hidden="true"></span>
            <span class="ui-dialog-switch-label">${escapeHtml(toggle.label || "Template only")}</span>
          </label>`
      : "";
    const host = document.createElement("div");
    host.className = "ui-dialog-host";
    host.innerHTML = `
      <div class="ui-dialog-backdrop" data-ui-dismiss></div>
      <div class="ui-dialog ui-dialog-form" role="dialog" aria-labelledby="ui-job-dialog-title">
        <div class="ui-dialog-head">
          <p class="ui-dialog-title" id="ui-job-dialog-title">${escapeHtml(title)}</p>
          ${switchHtml}
        </div>
        <form class="ui-dialog-fields" autocomplete="off">
          <label class="field">
            <span>Resume style</span>
            <select name="templateId" aria-label="Resume style">${templateOptions}</select>
          </label>
          ${
            toggle
              ? `<label class="field ui-dialog-template-only-field" hidden>
            <span>Download as</span>
            <select name="format" aria-label="Download format">${formatOptions}</select>
          </label>
          <p class="ui-dialog-note ui-dialog-template-only-field" hidden>${escapeHtml(toggle.note || "")}</p>`
              : ""
          }
          <div class="ui-dialog-job-fields">
            <div class="ui-dialog-grid">
              <label class="field">
                <span>Job title</span>
                <input name="jobTitle" type="text" placeholder="Senior Software Engineer" />
              </label>
              <label class="field">
                <span>Company</span>
                <input name="companyName" type="text" placeholder="Company" />
              </label>
            </div>
            <label class="field">
              <span>JD link</span>
              <input name="jdLink" type="text" placeholder="https://… (optional for direct jobs)" />
            </label>
            <label class="field">
              <span>Job description</span>
              <textarea name="jdText" rows="12" placeholder="Paste the job description…"></textarea>
            </label>
          </div>
          <p class="ui-dialog-error" hidden></p>
          <div class="ui-dialog-actions">
            <button type="button" class="ghost ui-dialog-cancel">${escapeHtml(cancelText)}</button>
            <button type="button" class="ghost ui-dialog-clear">${escapeHtml(clearText)}</button>
            ${
              showPreview
                ? `<button type="button" class="ghost ui-dialog-preview">${escapeHtml(previewText)}</button>`
                : ""
            }
            <button type="submit" class="primary ui-dialog-confirm">${escapeHtml(confirmText)}</button>
          </div>
        </form>
      </div>
    `;

    const form = host.querySelector("form");
    const templateEl = form.querySelector('[name="templateId"]');
    const titleEl = form.querySelector('[name="jobTitle"]');
    const companyEl = form.querySelector('[name="companyName"]');
    const linkEl = form.querySelector('[name="jdLink"]');
    const textEl = form.querySelector('[name="jdText"]');
    const errEl = host.querySelector(".ui-dialog-error");
    const previewBtn = host.querySelector(".ui-dialog-preview");
    const clearBtn = host.querySelector(".ui-dialog-clear");
    const switchEl = host.querySelector('[name="templateOnly"]');
    const formatEl = host.querySelector('[name="format"]');
    const dialogTitleEl = host.querySelector(".ui-dialog-title");
    const confirmBtn = host.querySelector(".ui-dialog-confirm");
    const jobFieldsEl = host.querySelector(".ui-dialog-job-fields");
    const templateOnlyFieldEls = host.querySelectorAll(".ui-dialog-template-only-field");

    const isTemplateOnly = () => Boolean(switchEl?.checked);

    /** Template-only hides every job field; the confirm label and title say what will happen. */
    const applyMode = () => {
      const on = isTemplateOnly();
      if (jobFieldsEl) jobFieldsEl.hidden = on;
      templateOnlyFieldEls.forEach((el) => {
        el.hidden = !on;
      });
      if (clearBtn) clearBtn.hidden = on;
      if (dialogTitleEl) dialogTitleEl.textContent = on ? toggle?.title || title : title;
      if (confirmBtn) confirmBtn.textContent = on ? toggle?.confirmText || "Download" : confirmText;
      showError("");
    };

    const wantedTemplate = String(initial.templateId || "").trim();
    if (templateEl && wantedTemplate) {
      const valid = Array.from(templateEl.options).some((o) => o.value === wantedTemplate);
      if (valid) templateEl.value = wantedTemplate;
    }

    titleEl.value = String(initial.jobTitle || "");
    companyEl.value = String(initial.companyName || "");
    linkEl.value = String(initial.jdLink || "");
    textEl.value = String(initial.jdText || "");

    let done = false;
    const onStorageChange = (changes, area) => {
      if (done || area !== "local" || !changes.selected_template_id || !templateEl) return;
      const next = String(changes.selected_template_id.newValue || "").trim();
      if (!next || templateEl.value === next) return;
      if (Array.from(templateEl.options).some((o) => o.value === next)) {
        templateEl.value = next;
      }
    };

    const finish = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      chrome.storage.onChanged.removeListener(onStorageChange);
      host.remove();
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === "Escape") finish(null);
    };

    const showError = (msg) => {
      if (!errEl) return;
      errEl.hidden = !msg;
      errEl.textContent = msg || "";
    };

    const readValues = () => {
      const on = isTemplateOnly();
      return {
        // Template-only never carries job context, even if fields were typed earlier.
        jobTitle: on ? "" : String(titleEl.value || "").trim(),
        companyName: on ? "" : String(companyEl.value || "").trim(),
        jdLink: on ? "" : String(linkEl.value || "").trim(),
        jdText: on ? "" : String(textEl.value || "").trim(),
        templateId: String(templateEl?.value || "").trim(),
        templateOnly: on,
        format: String(formatEl?.value || "").trim()
      };
    };

    const clearJobFields = () => {
      titleEl.value = "";
      companyEl.value = "";
      linkEl.value = "";
      textEl.value = "";
      showError("");
      titleEl.focus();
    };

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const values = readValues();
      if (!values.templateOnly && !values.jobTitle && !values.companyName) {
        showError("Add a job title or company.");
        titleEl.focus();
        return;
      }
      finish(values);
    });

    clearBtn?.addEventListener("click", () => clearJobFields());

    previewBtn?.addEventListener("click", () => {
      showError("");
      const values = readValues();
      Promise.resolve(onPreview(values)).catch((err) => {
        showError(String(err?.message || err || "Preview failed."));
      });
    });

    templateEl?.addEventListener("change", () => {
      const tid = String(templateEl.value || "").trim();
      if (!tid) return;
      chrome.storage.local.set({ selected_template_id: tid }).catch(() => {});
      chrome.runtime.sendMessage({ type: "template_preview_show", templateId: tid }).catch(() => {});
    });

    if (switchEl) {
      const wantedFormat = String(initial.format || "").trim();
      if (formatEl && Array.from(formatEl.options).some((o) => o.value === wantedFormat)) {
        formatEl.value = wantedFormat;
      }
      switchEl.checked = Boolean(initial.templateOnly);
      switchEl.addEventListener("change", applyMode);
      applyMode();
    }

    document.body.appendChild(host);
    document.addEventListener("keydown", onKey);
    chrome.storage.onChanged.addListener(onStorageChange);
    host.querySelector("[data-ui-dismiss]")?.addEventListener("click", () => finish(null));
    host.querySelector(".ui-dialog-cancel")?.addEventListener("click", () => finish(null));
    (templateEl || (titleEl.value ? linkEl : titleEl)).focus();
  });
}
