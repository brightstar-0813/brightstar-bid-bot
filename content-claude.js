/**
 * Slim Claude.ai harvest script — mirrors content.js ready-flag path so
 * background automateChatGpt can save resume/cover PDFs after Claude replies.
 * Reload the extension, then refresh the Claude tab after installing/updating.
 */
(() => {
  if (window.__brightstarClaudeHarvest) return;
  window.__brightstarClaudeHarvest = true;

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
      toastTimer = setTimeout(() => {
        if (toastEl?.parentNode) toastEl.parentNode.removeChild(toastEl);
        toastEl = null;
      }, 7000);
    }
  }

  function isStreaming() {
    const stopBtn =
      document.querySelector("button[data-testid='stop-button']") ||
      document.querySelector("button[aria-label='Stop streaming']") ||
      document.querySelector("button[aria-label='Stop generating']") ||
      document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('[data-is-streaming="true"]');
    return Boolean(
      stopBtn &&
        (stopBtn.offsetParent !== null || stopBtn.getAttribute?.("data-is-streaming") === "true")
    );
  }

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
      const fp = `${s.length}:${s.slice(0, 80)}:${s.slice(-40)}`;
      if (seen.has(fp)) return;
      seen.add(fp);
      texts.push(s.slice(0, 500000));
    };

    const blocks = Array.from(
      document.querySelectorAll(
        "[data-testid='assistant-message'], [data-testid='assistant'], [class*='font-claude-message'], [class*='assistant-message'], [data-message-author-role='assistant'], [data-turn='assistant']"
      )
    );
    const start = Math.max(0, blocks.length - 20);
    for (let bi = start; bi < blocks.length; bi += 1) {
      const block = blocks[bi];
      for (const el of block.querySelectorAll(
        "pre code, pre, code, [class*='language-json'], [class*='markdown'], [class*='prose'], [class*='code'], [class*='artifact'], .cm-content"
      )) {
        push(el.innerText || el.textContent || "");
      }
      push(block.innerText || block.textContent || "");
    }
    for (const el of document.querySelectorAll(
      "main pre, main pre code, [class*='language-json'], [class*='artifact'] pre, .cm-content"
    )) {
      const t = el.innerText || el.textContent || "";
      if (t.includes('"experience"')) push(t);
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

    const scoreObj = (obj) => {
      if (!obj || typeof obj !== "object") return -1;
      const jobs = Array.isArray(obj.experience) ? obj.experience.length : 0;
      const bullets = Array.isArray(obj.experience)
        ? obj.experience.reduce(
            (n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.filter(Boolean).length : 0),
            0
          )
        : 0;
      let score = jobs * 1000 + bullets * 10;
      if (obj.name) score += 500;
      if (obj.profile) score += 200;
      if (Array.isArray(obj.skills) && obj.skills.length) score += 100;
      return score;
    };

    let best = null;
    let bestScore = -1;
    for (const text of texts) {
      for (const raw of extractBalanced(text)) {
        let s = raw.replace(/,\s*([}\]])/g, "$1");
        try {
          const obj = JSON.parse(s);
          const sc = scoreObj(obj);
          if (sc > bestScore) {
            bestScore = sc;
            best = obj;
          }
        } catch {
          /* ignore */
        }
      }
    }
    return best;
  }

  function isUsable(data) {
    if (!data || typeof data !== "object") return false;
    if (!Array.isArray(data.experience) || !data.experience.length) return false;
    if (/One summary paragraph|One sentence bullet|tailored to the JD/i.test(JSON.stringify(data))) {
      return false;
    }
    const bullets = data.experience.reduce(
      (n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.filter(Boolean).length : 0),
      0
    );
    const nameOk = Boolean(String(data.name || "").trim());
    const profile = String(data.profile || "").trim();
    return nameOk && bullets >= 4 && (profile.length >= 40 || bullets >= 8);
  }

  function looksComplete(data) {
    if (!isUsable(data)) return false;
    const bullets = data.experience.reduce(
      (n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.filter(Boolean).length : 0),
      0
    );
    const skills = Array.isArray(data.skills) ? data.skills.filter(Boolean).length : 0;
    const profile = String(data.profile || "").trim();
    return (
      skills >= 1 ||
      (data.experience.length >= 2 && bullets >= 8 && profile.length >= 40) ||
      (data.experience.length >= 3 && bullets >= 10)
    );
  }

  async function persistHarvest({ allowStreaming = false } = {}) {
    const streaming = isStreaming();
    const best = harvestResumeFromPage();
    if (!best || !Array.isArray(best.experience) || !best.experience.length) return null;

    const usable = isUsable(best);
    const ready = allowStreaming
      ? Boolean(usable)
      : streaming
        ? Boolean(looksComplete(best))
        : Boolean(usable);

    if (!ready && streaming && !allowStreaming && !usable) return null;

    if (usable || ready) {
      await chrome.storage.local.set({
        chatgpt_harvested_resume: best,
        chatgpt_harvested_at: Date.now(),
        chatgpt_harvested_jobs: best.experience.length,
        chatgpt_json_ready: Boolean(ready),
        chatgpt_json_ready_at: ready ? Date.now() : 0,
        last_resume_json: best
      });
    }
    return best;
  }

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
      persistHarvest().catch(() => {});
      return;
    }
    if (wasStreaming && !settleTimer) {
      wasStreaming = false;
      settleTimer = setTimeout(() => {
        settleTimer = null;
        persistHarvest().catch(() => {});
      }, 2500);
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
        showToast("Harvesting resume JSON from Claude…", { sticky: true });
        const data = await persistHarvest({ allowStreaming: true });
        if (!data) {
          showToast("No full resume JSON found. Scroll to the JSON block, then click again.");
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
  let harvestTimer = null;
  const scheduleHarvest = (ms) => {
    if (harvestTimer) clearInterval(harvestTimer);
    harvestTimer = setInterval(() => {
      watchStreaming();
      persistHarvest().catch(() => {});
    }, ms);
  };
  scheduleHarvest(1500);
  setInterval(watchStreaming, 800);
})();
