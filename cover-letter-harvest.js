/**
 * Cover-letter text checks used by the service worker.
 * The page reader is self-contained so chrome.scripting.executeScript can serialize it.
 */

export function looksLikeCoverLetterBody(text) {
  const s = String(text || "").trim();
  if (s.length < 80) return false;
  // Resume JSON dumped into the "letter" slot.
  if (/"experience"\s*:/.test(s) && /"technicalSummary"|"certifications"\s*:/.test(s)) return false;
  if (/^\s*\{/.test(s) && /"name"\s*:/.test(s)) return false;
  if (/dear\s+/i.test(s) || /hiring\s+(manager|team)/i.test(s)) return true;
  // Plain multi-paragraph letter without salutation still OK if long enough.
  const paras = s.split(/\n\s*\n+/).filter((p) => p.trim().length > 40);
  if (paras.length >= 2 && s.length >= 180) return true;
  return s.length >= 220 && !/"experience"\s*:/.test(s);
}

function findBalancedObjectEnd(input, start) {
  if (input[start] !== "{") return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i += 1) {
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
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Drop resume JSON objects so a following plain-text letter can be read. */
function stripResumeJsonObjects(raw) {
  let s = String(raw || "").replace(/```(?:json|JSON)?\s*[\s\S]*?```/g, (block) =>
    /"experience"\s*:|"technicalSummary"\s*:/.test(block) ? "\n" : block
  );
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== "{") {
      out += s[i];
      continue;
    }
    const end = findBalancedObjectEnd(s, i);
    if (end < 0) {
      out += s[i];
      continue;
    }
    const slice = s.slice(i, end + 1);
    if (/"experience"\s*:/.test(slice) || /"technicalSummary"\s*:/.test(slice)) {
      out += "\n";
      i = end;
      continue;
    }
    out += s[i];
  }
  return out;
}

/** The cover prompt itself contains "Dear Hiring Manager" plus these instructions. */
function isCoverPromptEcho(text) {
  return /OUTPUT RULES|MASTER RESUME|Return PLAIN TEXT only|Do NOT return JSON/i.test(String(text || ""));
}

function sliceFromDear(raw) {
  const idx = String(raw || "").search(/\bDear\s+/i);
  if (idx < 0) return "";
  const body = String(raw).slice(idx).trim();
  if (isCoverPromptEcho(body)) return "";
  return looksLikeCoverLetterBody(body) ? body : "";
}

/** Pull a letter out of a turn that also contains the earlier resume JSON. */
export function extractCoverLetterText(text) {
  const raw = String(text || "");
  const fromDear = sliceFromDear(raw);
  if (fromDear) return fromDear;
  const stripped = stripResumeJsonObjects(raw).trim();
  if (isCoverPromptEcho(stripped)) return "";
  const fromStrippedDear = sliceFromDear(stripped);
  if (fromStrippedDear) return fromStrippedDear;
  return looksLikeCoverLetterBody(stripped) ? stripped : "";
}

/**
 * Newest assistant prose on a ChatGPT/Claude page.
 * Skips nested stream sentinels, toolbars, code-block JSON, and the cover-letter prompt echo.
 * Must stay self-contained: executeScript serializes this function alone.
 */
export function readNewestAssistantProseInPage() {
  const assistantSelector = [
    "[data-message-author-role='assistant']",
    "[data-message-author-role=assistant]",
    "[data-turn='assistant']",
    "section[data-turn='assistant']",
    '[data-testid="assistant-message"]',
    '[data-testid="assistant"]',
    '[class*="assistant-message"]',
    '[class*="font-claude-message"]'
  ].join(", ");

  const candidates = [];
  const seen = new Set();
  const add = (el) => {
    if (!el || el.nodeType !== 1 || seen.has(el)) return;
    if (el.matches("button, [data-is-streaming]")) return;
    if (el.closest("button, #prompt-textarea")) return;
    const role = `${el.getAttribute("data-message-author-role") || ""} ${el.getAttribute("data-turn") || ""}`.toLowerCase();
    if (/\buser\b/.test(role)) return;
    seen.add(el);
    candidates.push(el);
  };

  for (const el of document.querySelectorAll(assistantSelector)) add(el);

  for (const turn of document.querySelectorAll('[data-testid^="conversation-turn"]')) {
    const userInside = turn.querySelector(
      "[data-message-author-role='user'], [data-turn='user'], [data-testid*='user-message']"
    );
    const assistant = turn.querySelector(assistantSelector);
    if (userInside && !assistant) continue;
    if (assistant) add(assistant);
    else if (!userInside) add(turn);
  }

  const roots = candidates.filter(
    (el) => !candidates.some((other) => other !== el && other.contains(el))
  );

  const readProse = (block) => {
    const clone = block.cloneNode(true);
    clone.querySelectorAll("pre, code, button, [data-is-streaming]").forEach((node) => node.remove());
    return String(clone.innerText || clone.textContent || "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  const promptEcho = /OUTPUT RULES|MASTER RESUME|Return PLAIN TEXT only|Do NOT return JSON/i;
  for (let i = roots.length - 1; i >= 0; i -= 1) {
    const text = readProse(roots[i]);
    if (!text || promptEcho.test(text)) continue;
    try {
      roots[i].scrollIntoView({ block: "end", inline: "nearest" });
    } catch {
      /* ignore */
    }
    return text.slice(0, 20000);
  }
  return "";
}
