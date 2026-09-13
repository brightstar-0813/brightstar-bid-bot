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
