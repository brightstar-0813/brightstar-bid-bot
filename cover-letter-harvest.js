/**
 * Cover-letter text checks used by the service worker.
 * The page reader is self-contained so chrome.scripting.executeScript can serialize it.
 */

/** Footer and model chrome that sits under the composer, not part of the letter. */
export function stripChatGptChrome(text) {
  return String(text || "")
    .replace(/The\s*ChatGPT can make mistakes\.?/gi, "")
    .replace(/ChatGPT can make mistakes\.?/gi, "")
    .replace(/Check important info\.?/gi, "")
    .replace(/Latest\s*response/gi, "")
    .replace(/Thinking\s*effort/gi, "")
    .replace(/(^|[\s,])Instant\b/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function letterBodyChunks(text) {
  const chunks = String(text || "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40 && !/^dear\s+/i.test(p));
  if (chunks.length >= 2) return chunks;
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40 && !/^dear\s+/i.test(p));
}

export function looksLikeCoverLetterBody(text) {
  const s = stripChatGptChrome(text);
  // Resume JSON dumped into the "letter" slot.
  if (/"experience"\s*:/.test(s) && /"technicalSummary"|"certifications"\s*:/.test(s)) return false;
  if (/^\s*\{/.test(s) && /"name"\s*:/.test(s)) return false;
  // Salutation glued to the ChatGPT footer is not a finished letter.
  if (/ChatGPT can make mistakes|Check important info|Latest response|Thinking effort/i.test(s)) return false;
  const paras = letterBodyChunks(s);
  const bodyLen = paras.reduce((n, p) => n + p.length, 0);
  if (paras.length < 2 || bodyLen < 160) return false;
  // The closing is the last thing ChatGPT writes. A salutation, or a letter
  // that has not reached that line yet, is not ready to download.
  const tail = s.slice(-600);
  return /thank you|consideration|welcome the opportunity|i would welcome|happy to discuss/i.test(tail);
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
  return /OUTPUT RULES|MASTER RESUME|Return PLAIN TEXT only|Do NOT return JSON|Ignore the resume JSON above/i.test(
    String(text || "")
  );
}

/**
 * The cover prompt says "Start with: Dear Hiring Manager" before the real letter.
 * Keep scanning later salutations instead of rejecting everything after that first Dear.
 */
function sliceFromDear(raw) {
  let rest = String(raw || "");
  let best = "";
  while (rest.length > 40) {
    const idx = rest.search(/\bDear\s+/i);
    if (idx < 0) break;
    const body = rest.slice(idx).trim();
    const later = body.slice(5).search(/\bDear\s+/i);
    const segment = (later >= 0 ? body.slice(0, later + 5) : body).trim();
    const cleaned = stripChatGptChrome(segment);
    if (!isCoverPromptEcho(cleaned) && looksLikeCoverLetterBody(cleaned) && cleaned.length >= best.length) {
      best = cleaned;
    }
    rest = rest.slice(idx + 5);
  }
  return best;
}

/** Drop instruction paragraphs so a letter that follows the cover prompt can be read. */
function dropPromptParagraphs(text) {
  const kept = [];
  for (const part of String(text || "").split(/\n\s*\n+/)) {
    const t = part.trim();
    if (!t) continue;
    if (
      isCoverPromptEcho(t) ||
      /^(IMPORTANT:|Stop\. Do NOT|You are an expert career writer|CANDIDATE\b|ROLE POSITIONING|JOB TITLE\b|COMPANY\b|- )/i.test(
        t
      )
    ) {
      kept.length = 0;
      continue;
    }
    kept.push(t);
  }
  return kept.join("\n\n").trim();
}

/** Pull a letter out of a turn that also contains the earlier resume JSON or the cover prompt. */
export function extractCoverLetterText(text) {
  const raw = String(text || "");
  const fromDear = sliceFromDear(raw);
  if (fromDear) return fromDear;
  const stripped = stripResumeJsonObjects(raw).trim();
  const fromStrippedDear = sliceFromDear(stripped);
  if (fromStrippedDear) return fromStrippedDear;
  const afterPrompt = stripChatGptChrome(dropPromptParagraphs(stripped));
  if (looksLikeCoverLetterBody(afterPrompt)) return afterPrompt;
  if (isCoverPromptEcho(stripped)) return "";
  return looksLikeCoverLetterBody(stripped) ? stripChatGptChrome(stripped) : "";
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
    const fromApi = String(api.readNewestAssistantProse(typeof document !== "undefined" ? document : undefined) || "").trim();
    if (fromApi) return fromApi;
  }
  const root =
    (typeof document !== "undefined" && (document.querySelector("main") || document.body)) || null;
  const text = String(root?.innerText || "");
  if (text.length <= 20000) return text;
  return text.slice(-60000);
}
