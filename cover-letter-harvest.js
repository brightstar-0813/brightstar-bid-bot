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
 * Delegates to chatgpt-dom-harvest.js (injected in the isolated world) so a
 * conversation turn that also contains the user prompt is still readable.
 * executeScript serializes this function alone; the harvest API must already be loaded.
 */
export function readNewestAssistantProseInPage() {
  const api = globalThis.__brightstarDomHarvest;
  if (typeof api?.readNewestAssistantProse === "function") {
    return String(api.readNewestAssistantProse(typeof document !== "undefined" ? document : undefined) || "");
  }
  return "";
}
