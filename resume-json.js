const EXPECTED_BULLET_COUNTS = [
  { match: /accenture\s*federal/i, count: 8 },
  { match: /^hallmark/i, count: 8 },
  { match: /^teletech$/i, count: 8 },
  { match: /sfa\s*solutions/i, count: 6 },
  { match: /^amazon$/i, count: 5 },
  { match: /bhg\s*financial/i, count: 5 },
  { match: /scholastic/i, count: 4 },
  { match: /vonage/i, count: 4 },
  { match: /forefront/i, count: 4 }
];

export function stripMarkdownFences(text) {
  let trimmed = String(text || "").trim();
  if (/^```/m.test(trimmed)) {
    trimmed = trimmed
      .replace(/^```(?:json|JSON|html|HTML)?\s*\r?\n?/, "")
      .replace(/\r?\n?```\s*$/, "")
      .trim();
  }
  return trimmed;
}

function normalizeJsonText(text) {
  let trimmed = stripMarkdownFences(text)
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00A0/g, " ")
    .trim();

  // ChatGPT code blocks sometimes prefix a bare language label.
  trimmed = trimmed.replace(/^(json|JSON)\s*\r?\n/, "");

  // Un-mangle markdown-linkified JSON. When ChatGPT prints raw JSON (no code
  // fence) it auto-links emails/URLs; copying that rendered text injects
  // `[label](url)` wrappers where the url is percent-encoded and the label
  // keeps the original characters (real quotes/commas). Keep the label so the
  // JSON field boundaries are restored. A `]` immediately followed by `(` does
  // not occur in clean resume JSON, so this is safe for well-formed input.
  if (/\]\(/.test(trimmed)) {
    trimmed = trimmed.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  }

  // Strip common line-number gutters: "12|{..." or "12 {...".
  if (/^\s*\d+\s*[|:]/.test(trimmed) || /\n\s*\d+\s*[|:]/.test(trimmed)) {
    trimmed = trimmed
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\d+\s*[|:]\s?/, ""))
      .join("\n");
  }

  return trimmed.trim();
}

/**
 * Scan text for every balanced {...} block (ignoring braces inside strings)
 * and return the parsed objects. This survives leading/trailing prose,
 * code-fence leftovers, and multiple JSON-ish blocks in one message.
 */
function extractBalancedJsonObjects(text) {
  const str = String(text || "");
  const objects = [];
  let depth = 0;
  let startIdx = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
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
          const candidate = str.slice(startIdx, i + 1);
          try {
            objects.push(JSON.parse(candidate));
          } catch {
            // ignore non-parseable slice
          }
          startIdx = -1;
        }
      }
    }
  }

  return objects;
}

/**
 * Repair JSON that was truncated mid-stream / mid-copy:
 * close an open string, strip dangling keys/colons/commas, then append missing
 * closing brackets/braces. Returns null when there is nothing useful to close.
 */
function closeTruncatedJson(text) {
  let str = String(text || "");
  const startBrace = str.indexOf("{");
  if (startBrace < 0) return null;
  // Ignore leading prose — only repair from the first object.
  str = str.slice(startBrace);

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

  // Close an unterminated string (neutralize a trailing odd backslash first).
  if (inString) {
    let backslashes = 0;
    for (let i = str.length - 1; i >= 0 && str[i] === "\\"; i -= 1) backslashes += 1;
    if (backslashes % 2 === 1) str += "\\";
    str += '"';
  }

  let repaired = str.replace(/\s+$/, "");
  // Strip incomplete trailing property fragments (never strip a finished array value).
  for (let pass = 0; pass < 4; pass += 1) {
    const before = repaired;
    repaired = repaired.replace(/,\s*$/, "");
    repaired = repaired
      .replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, "")
      .replace(/\{\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, "{")
      .replace(/:\s*$/, "");
    // Bare `"key"` only when we are inside an object (expecting a key), not an array.
    const top = scan(repaired).stack;
    if (top[top.length - 1] === "{") {
      repaired = repaired.replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/, "");
    }
    repaired = repaired.replace(/,\s*$/, "");
    if (repaired === before) break;
  }

  ({ stack, inString } = scan(repaired));
  if (inString) {
    let backslashes = 0;
    for (let i = repaired.length - 1; i >= 0 && repaired[i] === "\\"; i -= 1) backslashes += 1;
    if (backslashes % 2 === 1) repaired += "\\";
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
}

function tryParseJson(text) {
  const trimmed = normalizeJsonText(text);

  // Always prefer the richest balanced resume object when several {...} exist
  // (prompt schema example + real answer often appear in the same transcript).
  const objects = extractBalancedJsonObjects(trimmed);
  if (objects.length) {
    const scoreObj = (obj) => {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return -1;
      let score = 0;
      if (Array.isArray(obj.experience)) score += 100000 + obj.experience.length * 1000;
      if (Array.isArray(obj.certifications)) score += 50000 + obj.certifications.length * 100;
      if (Array.isArray(obj.skills)) score += 20000 + obj.skills.length * 50;
      if (typeof obj.profile === "string") score += 25000 + Math.min(obj.profile.length, 500);
      if (typeof obj.name === "string") score += 1000;
      const bullets = Array.isArray(obj.experience)
        ? obj.experience.reduce(
            (n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.length : 0),
            0
          )
        : 0;
      score += bullets * 25;
      return score;
    };

    let best = null;
    let bestScore = -1;
    for (const obj of objects) {
      const s = scoreObj(obj);
      if (s > bestScore) {
        best = obj;
        bestScore = s;
      }
    }
    if (best && Array.isArray(best.experience) && best.experience.length >= 1) {
      return best;
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // Fast path: first "{" to last "}" (single-object replies).
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // continue
    }
  }

  const closed = closeTruncatedJson(trimmed);
  if (closed) {
    try {
      return JSON.parse(closed);
    } catch {
      // continue
    }
    const cs = closed.indexOf("{");
    const ce = closed.lastIndexOf("}");
    if (cs >= 0 && ce > cs) {
      try {
        return JSON.parse(closed.slice(cs, ce + 1));
      } catch {
        // ignore
      }
    }
  }

  return null;
}

function coerceResumeObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    const inner = tryParseJson(value);
    if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner;
  }
  return null;
}

export function extractResumeJson(responseText) {
  return coerceResumeObject(tryParseJson(responseText));
}

function totalExperienceBullets(data) {
  if (!Array.isArray(data?.experience)) return 0;
  return data.experience.reduce(
    (sum, job) => sum + (Array.isArray(job?.bullets) ? job.bullets.filter(Boolean).length : 0),
    0
  );
}

function experienceBulletTexts(data) {
  if (!Array.isArray(data?.experience)) return [];
  return data.experience
    .flatMap((job) => (Array.isArray(job?.bullets) ? job.bullets : []))
    .map((b) => String(b || "").trim())
    .filter(Boolean);
}

/** Detect ChatGPT echoing the schema/example placeholders instead of real resume content. */
export function looksLikeSchemaPlaceholderResume(data) {
  if (!data || typeof data !== "object") return true;
  const blob = [
    data.headline,
    data.profile,
    ...(Array.isArray(data.technicalSummary) ? data.technicalSummary : []),
    ...(Array.isArray(data.certifications) ? data.certifications : []),
    ...(Array.isArray(data.experience)
      ? data.experience.flatMap((j) => [j?.project, ...(j?.bullets || [])])
      : [])
  ]
    .map((x) => String(x || ""))
    .join("\n");

  const placeholderRe =
    /One summary paragraph|tailored to the JD|One technical capability|Salesforce delivery depth relevant|One sentence bullet|One realistic project name|JD-aligned Salesforce identity|from the role list above|field names must match|Matching the schema|\byour (name|title|company)\b|lorem ipsum|<[A-Z_ ]{3,}>|\{\{[a-z_]+\}\}/i;
  if (placeholderRe.test(blob)) return true;

  // Content-shaped stub check (never a job-count check — short real resumes are
  // legitimate). Placeholder bullets are uniformly tiny or literally repeated.
  const bullets = experienceBulletTexts(data);
  if (bullets.length) {
    const avgLen = bullets.reduce((n, b) => n + b.length, 0) / bullets.length;
    if (avgLen < 18) return true;
    if (new Set(bullets.map((b) => b.toLowerCase())).size === 1 && bullets.length > 2) return true;
  }

  return false;
}

/**
 * Soft check: enough real content to render a resume PDF.
 * Rejects schema-example stubs that GPT sometimes returns first.
 */
export function describeResumeGaps(data) {
  if (!data || typeof data !== "object") return "no parseable JSON yet";
  if (looksLikeSchemaPlaceholderResume(data)) return "schema stub (not real content yet)";
  const gaps = [];
  if (!String(data.name || "").trim()) gaps.push("name");
  const profile = String(data.profile || "").trim();
  if (profile.length < 80) gaps.push(`profile(${profile.length}/80)`);
  const jobs = Array.isArray(data.experience) ? data.experience.length : 0;
  if (jobs < 3) gaps.push(`jobs(${jobs}/3)`);
  const bullets = totalExperienceBullets(data);
  if (bullets < 10) gaps.push(`bullets(${bullets}/10)`);
  const skills = Array.isArray(data.skills) ? data.skills.length : 0;
  if (skills < 2) gaps.push(`skills(${skills}/2)`);
  const certs = Array.isArray(data.certifications) ? data.certifications.length : 0;
  if (certs < 1) gaps.push(`certs(${certs}/1)`);
  return gaps.length ? gaps.join(", ") : "";
}

/**
 * Minimum bar to render a real PDF. Deliberately relaxed so short/2-job resumes
 * and people without certifications still automate end to end. The poller only
 * accepts this tier once ChatGPT has stopped streaming (see isRichResumeJson).
 */
export function isUsableResumeJson(data) {
  if (!data || typeof data !== "object") return false;
  if (!String(data.name || "").trim()) return false;
  if (looksLikeSchemaPlaceholderResume(data)) return false;

  const profile = String(data.profile || "").trim();
  const summary = Array.isArray(data.technicalSummary) ? data.technicalSummary.filter(Boolean).length : 0;
  if (profile.length < 40 && summary < 3) return false;

  const jobs = Array.isArray(data.experience) ? data.experience.length : 0;
  if (jobs < 1) return false;

  // At least one role must carry real, non-trivial bullets.
  const hasDetailedRole = data.experience.some(
    (j) => Array.isArray(j?.bullets) && j.bullets.filter((b) => String(b || "").trim().length > 25).length >= 2
  );
  if (!hasDetailedRole) return false;

  return totalExperienceBullets(data) >= 4;
}

/**
 * The full-quality bar. While ChatGPT is still streaming we wait for this, so a
 * half-streamed (auto-repaired) object is never mistaken for the final answer.
 */
export function isRichResumeJson(data) {
  if (!isUsableResumeJson(data)) return false;

  const profile = String(data.profile || "").trim();
  if (profile.length < 80) return false;

  const jobs = Array.isArray(data.experience) ? data.experience.length : 0;
  if (jobs < 3) return false;

  const bullets = totalExperienceBullets(data);
  if (bullets < 10) return false;

  const skills = Array.isArray(data.skills) ? data.skills.length : 0;
  const certs = Array.isArray(data.certifications) ? data.certifications.length : 0;
  if (jobs >= 4 && bullets >= 20 && profile.length >= 100) return true;
  if (skills < 2) return false;
  if (certs < 1) return false;

  return true;
}

/** Strict completeness check used for continuation decisions. */
export function isCompleteResumeJson(data) {
  if (!isRichResumeJson(data)) return false;
  if (!String(data.profile || "").trim() || String(data.profile).length < 80) return false;
  if (!Array.isArray(data.skills) || data.skills.length < 1) return false;
  if (!Array.isArray(data.experience) || data.experience.length < 2) return false;
  if (totalExperienceBullets(data) < 8) return false;

  // Only enforce company-specific bullet floors when that company appears.
  for (const rule of EXPECTED_BULLET_COUNTS) {
    const job = data.experience.find((j) => rule.match.test(String(j?.company || "").trim()));
    if (!job) continue;
    if (!Array.isArray(job.bullets) || job.bullets.filter(Boolean).length < Math.min(rule.count, 4)) {
      return false;
    }
  }

  return true;
}

export function mergeJsonFragments(parts) {
  const cleaned = parts.filter(Boolean).map(normalizeJsonText);
  let usable = null;

  for (let i = cleaned.length - 1; i >= 0; i -= 1) {
    const one = extractResumeJson(cleaned[i]);
    if (isCompleteResumeJson(one)) return one;
    if (!usable && isUsableResumeJson(one)) usable = one;
  }

  const combined = extractResumeJson(cleaned.join("\n"));
  if (isCompleteResumeJson(combined)) return combined;
  if (isUsableResumeJson(combined)) return combined;

  // Truncated object + continuation tail often stitch better without a newline.
  if (cleaned.length >= 2) {
    const stitched = extractResumeJson(cleaned.join(""));
    if (isCompleteResumeJson(stitched)) return stitched;
    if (isUsableResumeJson(stitched)) return stitched;
  }

  return usable || combined;
}

export function looksLikeAlreadyCompleteRefusal(responseText) {
  const text = String(responseText || "").toLowerCase();
  return (
    text.includes("already complete") ||
    text.includes("already closed") ||
    text.includes("nothing remaining") ||
    text.includes("nothing to continue") ||
    text.includes("can't truthfully fabricate") ||
    text.includes("cannot truthfully fabricate") ||
    (text.includes("properly closed") && text.includes("json"))
  );
}

export function resumeJsonNeedsContinuation(rawText, data) {
  // If we can render a resume, do not ask ChatGPT to continue.
  if (isUsableResumeJson(data) || isCompleteResumeJson(data)) return false;
  if (looksLikeAlreadyCompleteRefusal(rawText)) return false;

  const text = String(rawText || "").toLowerCase();
  const signals = [
    "multiple parts",
    "in multiple parts",
    "exceeds the maximum",
    "maximum single-response",
    "response size limit",
    "too large to",
    "due to length",
    "continue in the next",
    "i will continue",
    "provide it in multiple",
    "split into several",
    "part 1 of",
    "part 2 of",
    "combine the parts"
  ];
  if (signals.some((s) => text.includes(s))) return true;
  if (!data) return true;

  const trimmed = normalizeJsonText(rawText);
  if (trimmed.includes("{") && !trimmed.trim().endsWith("}")) return true;
  return !isUsableResumeJson(data);
}

export { resumeJsonToHtml } from "./templates/index.js";
