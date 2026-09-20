/**
 * In-app confirm dialog — replaces window.confirm in extension pages.
 */

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
 * @param {{
 *   title?: string,
 *   confirmText?: string,
 *   cancelText?: string,
 *   previewText?: string,
 *   clearText?: string,
 *   templates?: Array<{ id: string, label: string, description?: string }>,
 *   onPreview?: (values: {
 *     jobTitle: string,
 *     companyName: string,
 *     jdLink: string,
 *     jdText: string,
 *     templateId: string
 *   }) => void | Promise<void>,
 *   initial?: {
 *     jobTitle?: string,
 *     companyName?: string,
 *     jdLink?: string,
 *     jdText?: string,
 *     templateId?: string
 *   }
 * }} opts
 * @returns {Promise<null | {
 *   jobTitle: string,
 *   companyName: string,
 *   jdLink: string,
 *   jdText: string,
 *   templateId: string
 * }>}
 */
export function jobDetailsDialog({
  title = "Job details",
  confirmText = "Export & save",
  cancelText = "Cancel",
  previewText = "Preview",
  clearText = "Clear",
  templates = [],
  onPreview = null,
  initial = {}
} = {}) {
  return new Promise((resolve) => {
    const templateOptions = (Array.isArray(templates) ? templates : [])
      .map((t) => {
        const id = String(t?.id || "").trim();
        if (!id) return "";
        const label = escapeHtml(t.label || id);
        const desc = t.description ? ` title="${escapeHtml(t.description)}"` : "";
        return `<option value="${escapeHtml(id)}"${desc}>${label}</option>`;
      })
      .filter(Boolean)
      .join("");

    const showPreview = typeof onPreview === "function";
    const host = document.createElement("div");
    host.className = "ui-dialog-host";
    host.innerHTML = `
      <div class="ui-dialog-backdrop" data-ui-dismiss></div>
      <div class="ui-dialog ui-dialog-form" role="dialog" aria-labelledby="ui-job-dialog-title">
        <p class="ui-dialog-title" id="ui-job-dialog-title">${escapeHtml(title)}</p>
        <form class="ui-dialog-fields" autocomplete="off">
          <label class="field">
            <span>Resume style</span>
            <select name="templateId" aria-label="Resume style">${templateOptions}</select>
          </label>
          <div class="ui-dialog-grid">
            <label class="field">
              <span>Job title</span>
              <input name="jobTitle" type="text" placeholder="Senior Software Engineer" />
            </label>
            <label class="field">
              <span>Company</span>
              <input name="companyName" type="text" placeholder="Acme Inc." />
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

    const readValues = () => ({
      jobTitle: String(titleEl.value || "").trim(),
      companyName: String(companyEl.value || "").trim(),
      jdLink: String(linkEl.value || "").trim(),
      jdText: String(textEl.value || "").trim(),
      templateId: String(templateEl?.value || "").trim()
    });

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
      if (!values.jobTitle && !values.companyName) {
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

    document.body.appendChild(host);
    document.addEventListener("keydown", onKey);
    chrome.storage.onChanged.addListener(onStorageChange);
    host.querySelector("[data-ui-dismiss]")?.addEventListener("click", () => finish(null));
    host.querySelector(".ui-dialog-cancel")?.addEventListener("click", () => finish(null));
    (templateEl || (titleEl.value ? linkEl : titleEl)).focus();
  });
}
