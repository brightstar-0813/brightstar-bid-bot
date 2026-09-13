/**
 * Lightweight toast for extension pages (profile editor, popup, etc.).
 */

let toastEl = null;
let toastTimer = null;

/**
 * @param {string} message
 * @param {{ kind?: "ok"|"err"|"info", duration?: number }} [opts]
 */
export function showToast(message, { kind = "ok", duration = 3200 } = {}) {
  const text = String(message || "").trim();
  if (!text) return;

  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "ui-toast-host";
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    document.body.appendChild(toastEl);
  }

  toastEl.textContent = text;
  toastEl.className = `ui-toast-host is-${kind || "ok"} is-visible`;

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (!toastEl) return;
    toastEl.classList.remove("is-visible");
  }, Math.max(1200, Number(duration) || 3200));
}
