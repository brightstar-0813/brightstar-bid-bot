/**
 * Double-Ctrl shortcut: press Ctrl twice quickly (JetBrains-style) to paste the
 * resume JSON from the clipboard and trigger the same render + cover letter
 * pipeline as the "Render resume & cover letter" button — no need to open the
 * popup and paste manually.
 */
(() => {
  const DOUBLE_TAP_MS = 500;
  const DEFAULT_OUTPUT_DIR = "Resume Applications";

  let lastCtrlTap = 0;
  let ctrlUsedAsModifier = false;
  let busy = false;

  // --- On-page toast (the popup is closed during this flow) --------------
  let toastEl = null;
  let toastTimer = null;

  function showToast(message, { sticky = false } = {}) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.setAttribute("data-resume-gpt-toast", "1");
      Object.assign(toastEl.style, {
        position: "fixed",
        zIndex: "2147483647",
        right: "16px",
        bottom: "16px",
        maxWidth: "360px",
        padding: "12px 14px",
        background: "#1f3b5a",
        color: "#fff",
        font: "13px/1.4 Arial, Helvetica, sans-serif",
        borderRadius: "8px",
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
        whiteSpace: "pre-wrap"
      });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (!sticky) {
      toastTimer = setTimeout(hideToast, 6000);
    }
  }

  function hideToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (toastEl && toastEl.parentNode) {
      toastEl.parentNode.removeChild(toastEl);
    }
    toastEl = null;
  }

  // --- Build jobMeta from the values the popup already persists -----------
  async function loadJobMeta() {
    const s = await chrome.storage.local.get([
      "last_job_title",
      "last_company_name",
      "last_jd_link",
      "last_jd_text",
      "output_dir",
      "spreadsheet_url",
      "sheets_web_app_url"
    ]);
    return {
      jobTitle: s.last_job_title || "",
      companyName: s.last_company_name || "",
      jdLink: s.last_jd_link || "",
      jdText: s.last_jd_text || "",
      outputDir: (s.output_dir || "").trim() || DEFAULT_OUTPUT_DIR,
      spreadsheetUrl: (s.spreadsheet_url || "").trim(),
      sheetsWebAppUrl: (s.sheets_web_app_url || "").trim()
    };
  }

  async function readClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      return (text || "").trim();
    } catch {
      return null;
    }
  }

  async function onDoubleCtrl() {
    if (busy) return;
    busy = true;
    try {
      showToast("Reading resume JSON from clipboard...", { sticky: true });
      const text = await readClipboard();

      if (text === null) {
        showToast(
          "Couldn't read the clipboard. Click anywhere on this page, then press Ctrl twice again."
        );
        return;
      }
      if (!text || !text.includes("{")) {
        showToast("Clipboard doesn't contain resume JSON. Copy the JSON first, then press Ctrl twice.");
        return;
      }

      const jobMeta = await loadJobMeta();
      showToast("Rendering resume & cover letter...", { sticky: true });

      const res = await chrome.runtime.sendMessage({
        type: "save_from_json",
        jsonText: text,
        jobMeta
      });

      if (res && res.ok === false) {
        showToast(`Could not start: ${res.error || "unknown error"}`);
      }
      // Progress + final status arrive via storage.onChanged below.
    } catch (err) {
      showToast(`Shortcut failed: ${String((err && err.message) || err)}`);
    } finally {
      busy = false;
    }
  }

  // --- Double-tap Ctrl detection (ignores Ctrl used in combos like Ctrl+C)
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Control") {
        if (!e.repeat) ctrlUsedAsModifier = false;
      } else if (e.ctrlKey) {
        ctrlUsedAsModifier = true;
      }
    },
    true
  );

  window.addEventListener(
    "keyup",
    (e) => {
      if (e.key !== "Control") return;
      if (ctrlUsedAsModifier) {
        ctrlUsedAsModifier = false;
        return;
      }
      const now = Date.now();
      if (now - lastCtrlTap < DOUBLE_TAP_MS) {
        lastCtrlTap = 0;
        onDoubleCtrl();
      } else {
        lastCtrlTap = now;
      }
    },
    true
  );

  // --- Reflect background progress in the toast --------------------------
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.generation_status || !toastEl) return;
    const status = changes.generation_status.newValue || "";
    const done = /saved to downloads|generation failed|saved resume to downloads/i.test(status);
    showToast(status, { sticky: !done });
  });
})();
