/**
 * Keyboard shortcuts on ChatGPT (optional fallback):
 * - Double-tap Ctrl, or Ctrl+Shift+V
 * Reads resume JSON from the clipboard and runs render + cover letter.
 * Preferred flow: use the popup CSV batch / Generate (auto) — no JSON paste needed.
 *
 * Reload the extension, then refresh the ChatGPT tab after installing/updating.
 */
(() => {
  const DOUBLE_TAP_MS = 500;
  const DEFAULT_OUTPUT_DIR = "Resume Applications";
  const DEFAULT_TEMPLATE_ID = "times-classic";

  let lastCtrlTap = 0;
  let ctrlUsedAsModifier = false;
  let busy = false;
  let pasteFallbackOpen = false;

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
        maxWidth: "380px",
        padding: "12px 14px",
        background: "#1f3b5a",
        color: "#fff",
        font: "13px/1.4 Arial, Helvetica, sans-serif",
        borderRadius: "8px",
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
        whiteSpace: "pre-wrap"
      });
      (document.body || document.documentElement).appendChild(toastEl);
    }
    toastEl.textContent = message;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (!sticky) {
      toastTimer = setTimeout(hideToast, 7000);
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

  async function loadJobMeta() {
    const s = await chrome.storage.local.get([
      "last_job_title",
      "last_company_name",
      "last_jd_link",
      "last_jd_text",
      "output_dir",
      "spreadsheet_url",
      "sheets_web_app_url",
      "selected_template_id",
      "selected_profile_id",
      "resume_file_prefix"
    ]);
    return {
      jobTitle: s.last_job_title || "",
      companyName: s.last_company_name || "",
      jdLink: s.last_jd_link || "",
      jdText: s.last_jd_text || "",
      outputDir: (s.output_dir || "").trim() || DEFAULT_OUTPUT_DIR,
      spreadsheetUrl: (s.spreadsheet_url || "").trim(),
      sheetsWebAppUrl: (s.sheets_web_app_url || "").trim(),
      templateId: s.selected_template_id || DEFAULT_TEMPLATE_ID,
      resumeFilePrefix: (s.resume_file_prefix || "").trim() || "Matthew_Resume"
    };
  }

  async function readClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      return { ok: true, text: (text || "").trim() };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  function looksLikeResumeJson(text) {
    const t = String(text || "").trim();
    return t.includes("{") && (t.includes('"experience"') || t.includes('"name"') || t.includes("experience"));
  }

  async function startRender(jsonText) {
    const jobMeta = await loadJobMeta();
    if (!String(jobMeta.jobTitle || "").trim() || !String(jobMeta.companyName || "").trim()) {
      showToast(
        "Fill Job title and Company in the extension popup first, then try the shortcut again."
      );
      return;
    }
    if (!String(jobMeta.jdText || "").trim()) {
      showToast("Paste a job description in the extension popup first, then try again.");
      return;
    }

    showToast("Rendering resume & cover letter...", { sticky: true });
    const res = await chrome.runtime.sendMessage({
      type: "save_from_json",
      jsonText,
      jobMeta
    });

    if (res && res.ok === false) {
      showToast(`Could not start: ${res.error || "unknown error"}`);
    }
  }

  function openPasteFallback() {
    if (pasteFallbackOpen) return;
    pasteFallbackOpen = true;
    hideToast();

    const overlay = document.createElement("div");
    overlay.setAttribute("data-resume-gpt-paste", "1");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "rgba(0,0,0,0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px"
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      width: "min(560px, 100%)",
      background: "#fff",
      color: "#111",
      borderRadius: "10px",
      padding: "16px",
      boxShadow: "0 8px 28px rgba(0,0,0,0.3)",
      font: "14px/1.4 Arial, Helvetica, sans-serif"
    });

    panel.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;">Paste resume JSON</div>
      <div style="margin-bottom:10px;color:#444;font-size:13px;">
        Clipboard access was blocked. Click the box and press <b>Ctrl+V</b>, then click Render
        (or press Ctrl+Enter).
      </div>
    `;

    const ta = document.createElement("textarea");
    ta.rows = 10;
    Object.assign(ta.style, {
      width: "100%",
      boxSizing: "border-box",
      font: "12px/1.35 Consolas, monospace",
      padding: "8px",
      border: "1px solid #ccc",
      borderRadius: "6px",
      resize: "vertical"
    });
    ta.placeholder = 'Paste the full JSON object here, starting with { ... }';

    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      gap: "8px",
      marginTop: "10px",
      justifyContent: "flex-end"
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    Object.assign(cancelBtn.style, {
      padding: "8px 12px",
      border: "1px solid #ccc",
      borderRadius: "6px",
      background: "#f5f5f5",
      cursor: "pointer"
    });

    const renderBtn = document.createElement("button");
    renderBtn.type = "button";
    renderBtn.textContent = "Render";
    Object.assign(renderBtn.style, {
      padding: "8px 12px",
      border: "none",
      borderRadius: "6px",
      background: "#1f3b5a",
      color: "#fff",
      cursor: "pointer"
    });

    const close = () => {
      pasteFallbackOpen = false;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };

    const submit = async () => {
      const text = (ta.value || "").trim();
      if (!looksLikeResumeJson(text)) {
        ta.focus();
        return;
      }
      close();
      busy = true;
      try {
        await startRender(text);
      } catch (err) {
        showToast(`Shortcut failed: ${String((err && err.message) || err)}`);
      } finally {
        busy = false;
      }
    };

    cancelBtn.addEventListener("click", close);
    renderBtn.addEventListener("click", () => {
      submit().catch(() => {});
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        submit().catch(() => {});
      }
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    row.appendChild(cancelBtn);
    row.appendChild(renderBtn);
    panel.appendChild(ta);
    panel.appendChild(row);
    overlay.appendChild(panel);
    (document.body || document.documentElement).appendChild(overlay);
    setTimeout(() => ta.focus(), 50);
  }

  async function onShortcut() {
    if (busy || pasteFallbackOpen) return;
    busy = true;
    try {
      showToast("Reading resume JSON from clipboard...\n(Ctrl twice or Ctrl+Shift+V)", {
        sticky: true
      });
      const clip = await readClipboard();

      if (!clip.ok) {
        showToast("Clipboard blocked — use the paste box...");
        openPasteFallback();
        return;
      }
      if (!clip.text || !looksLikeResumeJson(clip.text)) {
        showToast(
          "Clipboard doesn't look like resume JSON.\nCopy the JSON from ChatGPT, then press Ctrl twice (or Ctrl+Shift+V)."
        );
        return;
      }

      await startRender(clip.text);
    } catch (err) {
      showToast(`Shortcut failed: ${String((err && err.message) || err)}`);
    } finally {
      busy = false;
    }
  }

  // Ctrl+Shift+V — clear alternate shortcut
  window.addEventListener(
    "keydown",
    (e) => {
      const key = String(e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "v") {
        // Don't steal normal paste inside inputs unless we want the render flow.
        // Always run on ChatGPT for this dedicated combo.
        e.preventDefault();
        e.stopPropagation();
        onShortcut();
      }
    },
    true
  );

  // Double-tap Ctrl (ignores Ctrl used in combos like Ctrl+C)
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
        onShortcut();
      } else {
        lastCtrlTap = now;
      }
    },
    true
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.generation_status || !toastEl) return;
    const status = changes.generation_status.newValue || "";
    const done =
      /saved to downloads|generation failed|saved resume to downloads|Force-saved|Saving jd\.txt|Saving files/i.test(
        status
      );
    showToast(status, { sticky: !done });
  });

  function isStreaming() {
    const stopBtn =
      document.querySelector("button[data-testid='stop-button']") ||
      document.querySelector("button[aria-label='Stop streaming']") ||
      document.querySelector("button[aria-label='Stop generating']");
    return Boolean(stopBtn && stopBtn.offsetParent !== null);
  }

  /**
   * Deep-scan the ChatGPT page for the richest resume JSON.
   * CRITICAL: scan ALL assistant turns + every <pre>/code block — not just the
   * last 3. Retry prompts create new messages that push the good JSON out of a
   * narrow window, which is why the user can see JSON while the bot re-prompts.
   */
  function harvestResumeFromPage() {
    const texts = [];
    const seen = new Set();
    const push = (t) => {
      let s = String(t || "")
        .replace(/\uFEFF/g, "")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\u00A0/g, " ")
        .trim();
      if (s.length < 80) return;
      // Dedupe by a short fingerprint so we don't parse the same block 10 times.
      const fp = `${s.length}:${s.slice(0, 80)}:${s.slice(-40)}`;
      if (seen.has(fp)) return;
      seen.add(fp);
      texts.push(s.slice(0, 500000));
    };

    const looksResumeish = (s) =>
      (s.includes('"experience"') || s.includes('"Experience"')) &&
      (s.includes('"name"') || s.includes('"Name"') || s.includes('"profile"'));

    // 1) Every assistant message (cap at last 20 for performance).
    const blocks = Array.from(
      document.querySelectorAll(
        "[data-message-author-role='assistant'], [data-message-author-role=assistant], [data-turn='assistant'], section[data-turn='assistant']"
      )
    );
    const start = Math.max(0, blocks.length - 20);
    for (let bi = start; bi < blocks.length; bi += 1) {
      const block = blocks[bi];
      for (const el of block.querySelectorAll(
        "pre code, pre, code, [class*='language-json'], [class*='hljs'], [class*='markdown'], [class*='prose'], [class*='code'], [class*='Code'], [class*='artifact'], [data-message-content], .cm-content"
      )) {
        push(el.innerText || el.textContent || "");
      }
      push(block.innerText || block.textContent || "");
    }

    // 2) Page-wide code / artifact panels (JSON often lives here when virtualized).
    for (const el of document.querySelectorAll(
      "pre code, pre, [class*='language-json'], [class*='artifact'] pre, [class*='Artifact'] pre, [data-testid*='code'] pre, .cm-content, .monaco-editor .view-lines, main pre, main code"
    )) {
      const t = el.innerText || el.textContent || "";
      if (looksResumeish(t) || t.includes('"experience"')) push(t);
    }

    // 3) Fallback: walk text nodes under main that contain "experience".
    if (!texts.some(looksResumeish)) {
      const main = document.querySelector("main") || document.body;
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      let node;
      let buf = "";
      while ((node = walker.nextNode())) {
        const v = node.nodeValue || "";
        if (v.includes("experience") || v.includes("{") || buf) {
          buf += v;
          if (buf.length > 400000) break;
        }
      }
      if (buf.length > 200) push(buf);
    }

    const extractBalanced = (str) => {
      const out = [];
      const input = String(str || "").slice(0, 400000);
      let depth = 0;
      let startIdx = -1;
      let inString = false;
      let escaped = false;
      for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === "{") {
          if (depth === 0) startIdx = i;
          depth += 1;
        } else if (ch === "}") {
          if (depth > 0) {
            depth -= 1;
            if (depth === 0 && startIdx >= 0) {
              out.push(input.slice(startIdx, i + 1));
              startIdx = -1;
              if (out.length >= 16) break;
            }
          }
        }
      }
      return out;
    };

    const closeTruncated = (text) => {
      let str = String(text || "");
      const brace = str.indexOf("{");
      if (brace < 0) return null;
      str = str.slice(brace);
      const scan = (input) => {
        const stack = [];
        let inString = false;
        let escaped = false;
        for (let i = 0; i < input.length; i += 1) {
          const ch = input[i];
          if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
          }
          if (ch === '"') inString = true;
          else if (ch === "{" || ch === "[") stack.push(ch);
          else if (ch === "}" || ch === "]") {
            if (stack.length) stack.pop();
          }
        }
        return { stack, inString };
      };
      let { stack, inString } = scan(str);
      if (!stack.length && !inString) return null;
      if (inString) {
        let bs = 0;
        for (let i = str.length - 1; i >= 0 && str[i] === "\\"; i -= 1) bs += 1;
        if (bs % 2 === 1) str += "\\";
        str += '"';
      }
      let repaired = str.replace(/\s+$/, "");
      for (let pass = 0; pass < 4; pass += 1) {
        const before = repaired;
        repaired = repaired.replace(/,\s*$/, "");
        repaired = repaired
          .replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, "")
          .replace(/\{\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, "{")
          .replace(/:\s*$/, "");
        const top = scan(repaired).stack;
        if (top[top.length - 1] === "{") {
          repaired = repaired.replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/, "");
        }
        repaired = repaired.replace(/,\s*$/, "");
        if (repaired === before) break;
      }
      ({ stack, inString } = scan(repaired));
      if (inString) {
        repaired += '"';
        repaired = repaired.replace(/,\s*$/, "");
        ({ stack } = scan(repaired));
      }
      repaired = repaired.replace(/,\s*$/, "");
      ({ stack } = scan(repaired));
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        repaired += stack[i] === "{" ? "}" : "]";
      }
      return repaired;
    };

    const scoreObj = (obj) => {
      if (!obj || typeof obj !== "object") return -1;
      const jobs = Array.isArray(obj.experience) ? obj.experience.length : 0;
      const bullets = Array.isArray(obj.experience)
        ? obj.experience.reduce(
            (n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.length : 0),
            0
          )
        : 0;
      const certs = Array.isArray(obj.certifications) ? obj.certifications.length : 0;
      const skills = Array.isArray(obj.skills) ? obj.skills.length : 0;
      if (!obj.name && jobs < 1) return -1;
      // Prefer fuller resumes so an older complete reply beats a newer stub.
      return jobs * 10000 + bullets * 40 + certs * 30 + skills * 20 + String(obj.profile || "").length;
    };

    const tryParse = (raw) => {
      let normalized = String(raw || "")
        .replace(/^\uFEFF/, "")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\u00A0/g, " ")
        .trim()
        .replace(/^```(?:json|JSON)?\s*\r?\n?/, "")
        .replace(/\r?\n?```\s*$/, "")
        .replace(/^(json|JSON)\s*\r?\n/, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

      // Escape literal control chars inside JSON strings (DOM/ChatGPT).
      {
        let out = "";
        let inString = false;
        let escaped = false;
        for (let i = 0; i < normalized.length; i += 1) {
          const ch = normalized[i];
          const code = ch.charCodeAt(0);
          if (inString) {
            if (escaped) {
              out += ch;
              escaped = false;
              continue;
            }
            if (ch === "\\") {
              out += ch;
              escaped = true;
              continue;
            }
            if (ch === '"') {
              out += ch;
              inString = false;
              continue;
            }
            if (ch === "\n") {
              out += "\\n";
              continue;
            }
            if (ch === "\r") {
              out += "\\r";
              continue;
            }
            if (ch === "\t") {
              out += "\\t";
              continue;
            }
            if (code < 32) {
              out += `\\u${code.toString(16).padStart(4, "0")}`;
              continue;
            }
            out += ch;
            continue;
          }
          if (ch === '"') inString = true;
          out += ch;
        }
        normalized = out;
      }

      const looseFix = (s) => {
        let t = String(s || "");
        for (let i = 0; i < 8; i += 1) {
          const n = t.replace(/,\s*([}\]])/g, "$1");
          if (n === t) break;
          t = n;
        }
        return t;
      };
      const parseOne = (s) => {
        try {
          return JSON.parse(s);
        } catch {
          try {
            return JSON.parse(looseFix(s));
          } catch {
            return null;
          }
        }
      };

      let bestLocalObj = null;
      let bestLocal = -1;
      const consider = (obj) => {
        if (!obj || typeof obj !== "object") return;
        const s = scoreObj(obj);
        if (s > bestLocal) {
          bestLocalObj = obj;
          bestLocal = s;
        }
      };
      for (const slice of extractBalanced(normalized)) {
        consider(parseOne(slice));
      }
      {
        const start = normalized.indexOf("{");
        const end = normalized.lastIndexOf("}");
        if (start >= 0 && end > start) consider(parseOne(normalized.slice(start, end + 1)));
      }
      if (!bestLocalObj || bestLocal < 10000) {
        const closed = closeTruncated(normalized);
        if (closed) consider(parseOne(closed));
      }
      return bestLocalObj;
    };

    let best = null;
    let bestScore = -1;
    for (const raw of texts) {
      if (!looksResumeish(raw) && !raw.includes('"experience"')) continue;
      const obj = tryParse(raw);
      if (!obj) continue;
      const s = scoreObj(obj);
      if (s > bestScore) {
        best = obj;
        bestScore = s;
      }
    }
    return best;
  }

  /** Click ChatGPT code-block Copy buttons and read clipboard — virtualized
   * editors often only expose visible lines via innerText.
   * Only safe when this document is focused; otherwise ChatGPT shows
   * "Copy failed because document lost focus". */
  async function harvestFromCopyButtons() {
    if (document.visibilityState !== "visible" || !document.hasFocus()) {
      return [];
    }
    const texts = [];
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const btn of buttons.slice(0, 40)) {
      const label = `${btn.getAttribute("aria-label") || ""} ${btn.textContent || ""}`.toLowerCase();
      if (!/\bcopy\b|clipboard/.test(label)) continue;
      const nearby =
        btn.closest("pre, [class*='code'], [class*='Code'], [class*='group'], [class*='overflow']") ||
        btn.parentElement;
      const nearbyText = nearby ? nearby.innerText || nearby.textContent || "" : "";
      if (nearbyText && !nearbyText.includes('"experience"') && nearbyText.length > 200) continue;
      try {
        btn.click();
        await new Promise((r) => setTimeout(r, 120));
        const clip = await navigator.clipboard.readText();
        if (clip && clip.includes('"experience"') && clip.length > 200) {
          texts.push(clip.slice(0, 500000));
        }
      } catch {
        // clipboard may be blocked / focus lost
      }
    }
    return texts;
  }

  async function persistHarvest({ allowStreaming = false } = {}) {
    const streaming = isStreaming();
    let best = harvestResumeFromPage();
    // Never click Copy during background polls — that steals focus and triggers
    // ChatGPT's "Copy failed because document lost focus" toast. Only try on
    // explicit manual save when the tab is focused and DOM harvest looks thin.
    const jobs = Array.isArray(best?.experience) ? best.experience.length : 0;
    const needCopy =
      allowStreaming &&
      document.hasFocus() &&
      document.visibilityState === "visible" &&
      (!best || jobs < 2);
    if (needCopy) {
      let copied = [];
      try {
        copied = await harvestFromCopyButtons();
      } catch {
        copied = [];
      }
      for (const clip of copied) {
        const probe = (() => {
          try {
            const start = clip.indexOf("{");
            const end = clip.lastIndexOf("}");
            if (start < 0 || end <= start) return null;
            let s = clip.slice(start, end + 1);
            for (let i = 0; i < 8; i += 1) {
              const n = s.replace(/,\s*([}\]])/g, "$1");
              if (n === s) break;
              s = n;
            }
            return JSON.parse(s);
          } catch {
            return null;
          }
        })();
        if (
          probe &&
          Array.isArray(probe.experience) &&
          probe.experience.length > (best?.experience?.length || 0)
        ) {
          best = probe;
        }
      }
    }
    if (!best || !Array.isArray(best.experience) || !best.experience.length) {
      if (streaming && !allowStreaming) {
        return null;
      }
      return null;
    }

    const data = best;

    // Lightweight "usable resume" check (content script cannot import resume-json.js).
    const nameOk = Boolean(String(data.name || "").trim());
    const profile = String(data.profile || "").trim();
    const summary = Array.isArray(data.technicalSummary) ? data.technicalSummary.filter(Boolean).length : 0;
    const skills = Array.isArray(data.skills) ? data.skills.filter(Boolean).length : 0;
    const certs = Array.isArray(data.certifications) ? data.certifications.filter(Boolean).length : 0;
    const edu = Array.isArray(data.education) ? data.education.length : 0;
    const bullets = data.experience.reduce(
      (n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.filter(Boolean).length : 0),
      0
    );
    // A role header with no bullets — or a single bullet in an otherwise rich
    // resume — means the reply was cut off before the role finished.
    const richResume = data.experience.length >= 3 && bullets >= 12;
    const roleBullets = (j) =>
      Array.isArray(j?.bullets) ? j.bullets.filter((x) => String(x || "").trim()).length : 0;
    const hasEmptyRole = data.experience.some((j) => {
      const header = String(j?.company || "").trim() || String(j?.title || "").trim();
      const b = roleBullets(j);
      return header && (b === 0 || (richResume && b < 2));
    });
    const stub = /One summary paragraph|One sentence bullet|One realistic project name|tailored to the JD/i.test(
      JSON.stringify(data)
    );
    // Fixed company history from active person (set by background before each job).
    const rulesStored = await chrome.storage.local.get(["experience_validation_rules"]);
    const rules = rulesStored.experience_validation_rules;
    const cos = data.experience.map((j) => String(j?.company || "").trim());
    const normalizeKey = (s) =>
      String(s || "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
    const companyMatches = (jobCompany, requiredLabel) => {
      const a = normalizeKey(jobCompany);
      const b = normalizeKey(requiredLabel);
      if (!a || !b) return false;
      if (a === b) return true;
      if (b.length >= 4 && a.includes(b)) return true;
      if (a.length >= 4 && b.includes(a)) return true;
      return false;
    };
    let missingEmployers = false;
    let minJobs = 1;
    if (rules?.roles?.length) {
      minJobs = Number(rules.minJobs) || rules.roles.length;
      missingEmployers =
        data.experience.length < minJobs ||
        rules.roles.some((role) => {
          const need = Math.max(1, Number(role.min) || 1);
          const have = cos.filter((c) => companyMatches(c, role.label)).length;
          return have < need;
        });
    }
    const usable =
      nameOk &&
      !stub &&
      !missingEmployers &&
      !hasEmptyRole &&
      data.experience.length >= minJobs &&
      bullets >= 4 &&
      (profile.length >= 40 || summary >= 3) &&
      data.experience.some(
        (j) =>
          Array.isArray(j?.bullets) &&
          j.bullets.filter((b) => String(b || "").trim().length > 25).length >= 2
      );
    // Tail sections or a large experience block ⇒ past mid-stream truncation.
    const looksComplete =
      usable &&
      (skills >= 1 ||
        certs >= 1 ||
        edu >= 1 ||
        (data.experience.length >= minJobs && bullets >= 8 && profile.length >= 60) ||
        (data.experience.length >= Math.max(2, minJobs) && bullets >= 10 && profile.length >= 40));

    // While streaming, only raise ready when the object looks finished.
    // Manual save (allowStreaming) accepts any usable object.
    const ready = allowStreaming
      ? Boolean(usable)
      : streaming
        ? Boolean(looksComplete)
        : Boolean(usable);

    if (!ready && streaming && !allowStreaming && !usable) {
      return null;
    }

    // Always persist a usable object so background can read it even if ready=false.
    if (usable || ready) {
      await chrome.storage.local.set({
        chatgpt_harvested_resume: data,
        chatgpt_harvested_at: Date.now(),
        chatgpt_harvested_jobs: data.experience.length,
        chatgpt_json_ready: Boolean(ready),
        chatgpt_json_ready_at: ready ? Date.now() : 0,
        last_resume_json: data
      });
    }
    return data;
  }

  // After streaming stops, wait briefly for the DOM to finish painting the
  // full JSON, then harvest and raise the ready flag.
  // Also harvest WHILE streaming — GPT often stays "busy" after JSON is done.
  let wasStreaming = false;
  let settleTimer = null;
  const watchStreaming = () => {
    const streaming = isStreaming();
    if (streaming) {
      wasStreaming = true;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      // Do NOT clear chatgpt_json_ready here — that raced with recognition and
      // blocked file save while the stop button lingered after complete JSON.
      persistHarvest().catch(() => {});
      return;
    }
    if (wasStreaming && !settleTimer) {
      wasStreaming = false;
      settleTimer = setTimeout(() => {
        settleTimer = null;
        persistHarvest().catch(() => {});
      }, 1200);
    }
  };

  function ensureSaveButton() {
    if (document.getElementById("brightstar-save-json-btn")) return;
    const btn = document.createElement("button");
    btn.id = "brightstar-save-json-btn";
    btn.type = "button";
    btn.textContent = "Brightstar: Save resume JSON";
    Object.assign(btn.style, {
      position: "fixed",
      zIndex: "2147483646",
      right: "16px",
      bottom: "72px",
      padding: "10px 14px",
      background: "#0b3d5c",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      font: "13px/1.3 Arial, Helvetica, sans-serif",
      fontWeight: "700",
      cursor: "pointer",
      boxShadow: "0 4px 14px rgba(0,0,0,0.28)"
    });
    btn.addEventListener("click", async () => {
      try {
        showToast("Harvesting resume JSON from this page…", { sticky: true });
        const data = await persistHarvest({ allowStreaming: true });
        if (!data) {
          showToast("No full resume JSON found on page. Scroll to the JSON block, then click again.");
          return;
        }
        showToast(`Found JSON (${data.experience.length} jobs). Saving files…`, { sticky: true });
        const res = await chrome.runtime.sendMessage({
          type: "force_save_chatgpt_resume",
          resumeData: data
        });
        if (!res?.ok) {
          showToast(res?.error || "Save failed.");
          return;
        }
        showToast(res.status || "Save started.");
      } catch (err) {
        showToast(`Save failed: ${String(err?.message || err)}`);
      }
    });
    (document.body || document.documentElement).appendChild(btn);
  }

  ensureSaveButton();
  // Fast harvest while a batch/one-off is running so recognition → file save is snappy.
  let harvestTimer = null;
  const scheduleHarvest = (ms) => {
    if (harvestTimer) clearInterval(harvestTimer);
    harvestTimer = setInterval(() => {
      ensureSaveButton();
      watchStreaming();
      persistHarvest().catch(() => {});
    }, ms);
  };
  scheduleHarvest(4000);
  chrome.storage.local.get(["generation_running"], (data) => {
    if (data.generation_running) scheduleHarvest(1000);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.generation_running) {
      scheduleHarvest(changes.generation_running.newValue ? 1000 : 4000);
    }
  });
})();
