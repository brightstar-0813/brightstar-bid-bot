import {
  compileExperienceRules,
  missingCompaniesForRules,
  hasAllRequiredCompanies,
  formatRequiredEmployersList,
  companyMatches
} from "./experience-rules.js";

const EXPECTED_BULLET_COUNTS = [
  { match: /accenture\s*federal/i, count: 10 },
  { match: /^hallmark/i, count: 9 },
  { match: /^teletech$/i, count: 9 },
  { match: /sfa\s*solutions/i, count: 6 },
  { match: /^amazon$/i, count: 5 },
  { match: /bhg\s*financial/i, count: 5 },
  { match: /scholastic/i, count: 4 },
  { match: /vonage/i, count: 4 },
  { match: /forefront/i, count: 4 }
];

/** Active per-person experience rules (set by background for the current job). */
let activeExperienceRules = null;

/**
 * Install validation rules for the active teammate / person.
 * Pass null to clear. Accepts compiled rules or raw requiredExperience input.
 */
export function setExperienceValidationRules(rulesOrInput) {
  if (!rulesOrInput) {
    activeExperienceRules = null;
    return null;
  }
  if (rulesOrInput.roles && Array.isArray(rulesOrInput.roles)) {
    activeExperienceRules = {
      minJobs: Number(rulesOrInput.minJobs) || rulesOrInput.roles.length,
      roles: rulesOrInput.roles.map((r) => ({
        label: String(r.label || r.company || "").trim(),
        min: Math.max(1, Number(r.min) || 1)
      })).filter((r) => r.label)
    };
    if (!activeExperienceRules.roles.length) activeExperienceRules = null;
    return activeExperienceRules;
  }
  activeExperienceRules = compileExperienceRules(rulesOrInput);
  return activeExperienceRules;
}

export function getExperienceValidationRules() {
  return activeExperienceRules;
}

/** Resolve rules: explicit override → active person rules. */
export function resolveExpectedExperienceProfile(data, rulesOverride = null) {
  if (rulesOverride?.roles?.length) return rulesOverride;
  if (activeExperienceRules?.roles?.length) return activeExperienceRules;
  return null;
}

/**
 * Labels for required employers missing from experience.
 * Empty when no rules are active or all employers are present.
 */
export function missingExperienceCompanies(data, rulesOverride = null) {
  const rules = resolveExpectedExperienceProfile(data, rulesOverride);
  return missingCompaniesForRules(data, rules);
}

export function hasRequiredExperienceCompanies(data, rulesOverride = null) {
  const rules = resolveExpectedExperienceProfile(data, rulesOverride);
  return hasAllRequiredCompanies(data, rules);
}

/**
 * Experience entries that have a company/title header but no usable bullets.
 * These are truncated / "cut" roles (e.g. a trailing employer whose content
 * never got written), which must never render into a saved resume.
 */
export function incompleteExperienceEntries(data) {
  if (!Array.isArray(data?.experience)) return [];
  const out = [];
  for (const job of data.experience) {
    const company = String(job?.company || "").trim();
    const title = String(job?.title || "").trim();
    if (!company && !title) continue;
    const bulletCount = Array.isArray(job?.bullets)
      ? job.bullets.filter((b) => String(b || "").trim()).length
      : 0;
    if (bulletCount === 0) out.push(company || title);
  }
  return out;
}

/** True when every experience entry with a header also carries at least one bullet. */
export function hasCompleteExperienceEntries(data) {
  return incompleteExperienceEntries(data).length === 0;
}

/** Retry prompt when one or more roles were cut off with an empty header. */
export function buildIncompleteExperienceRetryPrompt(data, rulesOverride = null) {
  const incomplete = incompleteExperienceEntries(data);
  const missing = missingExperienceCompanies(data, rulesOverride);
  const rules = resolveExpectedExperienceProfile(data, rulesOverride);
  const requiredList = formatRequiredEmployersList(rules);
  const cutText = incomplete.length ? incomplete.join(", ") : "one or more roles";
  const missingLine = missing.length
    ? `\n- Also add missing employer(s): ${missing.join(", ")}`
    : "";
  return `Your previous resume JSON was cut off — these role(s) have a company/title but NO bullet points: ${cutText}.

Return ONLY one complete valid resume JSON object with REAL tailored content.
Rules:
- No markdown, no code fences, no commentary before or after the JSON
- Start with { and end with }
- EVERY experience entry MUST include its dates and full bullet points — never leave a role with an empty header${missingLine}
- Required employers: ${requiredList || "all employers from FIXED COMPANY HISTORY in the original prompt"}
- Finish the entire JSON in one message — do not stop early or split into parts

Output JSON now.`;
}

/** Retry prompt when experience dropped required employers. */
export function buildMissingExperienceRetryPrompt(data, rulesOverride = null) {
  const rules = resolveExpectedExperienceProfile(data, rulesOverride);
  const missing = missingExperienceCompanies(data, rules);
  const requiredList = formatRequiredEmployersList(rules);
  const missingText = missing.length ? missing.join(", ") : "one or more fixed employers";
  return `Your previous resume JSON omitted required employer(s) from FIXED COMPANY HISTORY: ${missingText}.

Return ONLY one complete valid resume JSON object with REAL tailored content.
Rules:
- No markdown, no code fences, no commentary before or after the JSON
- Start with { and end with }
- experience MUST include EVERY required employer — do not drop any company
- Required employers: ${requiredList || "all employers from FIXED COMPANY HISTORY in the original prompt"}
- Keep full bullet counts for each role
- Finish the entire JSON in one message

Output JSON now.`;
}

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

  // ChatGPT auto-links emails/URLs in raw JSON and can CORRUPT field boundaries:
  //   "linkedin":"[https://…/","profile":"Salesforce](https://…%22,%22profile%22:%22Salesforce) Rest…"
  // Repair that pattern before generic [label](url) stripping.
  trimmed = trimmed.replace(
    /"linkedin"\s*:\s*"\[(https?:\/\/[^"\]]+)","profile"\s*:\s*"([^"\]]*)\]\(([^)]+)\)/gi,
    (_m, url, profilePrefix, encodedUrl) => {
      let profileStart = profilePrefix || "";
      try {
        const decoded = decodeURIComponent(String(encodedUrl || ""));
        const hit = decoded.match(/","profile":"(.*)$/i);
        if (hit && hit[1]) profileStart = hit[1];
      } catch {
        // keep profilePrefix
      }
      const cleanUrl = String(url || "").replace(/\/?$/, "/");
      return `"linkedin":"${cleanUrl}","profile":"${profileStart}`;
    }
  );

  // Email autolinks: "email":"[a@b.com](mailto:a@b.com)" → plain email
  trimmed = trimmed.replace(
    /"email"\s*:\s*"\[([^\]]+)\]\(mailto:[^)]+\)"/gi,
    '"email":"$1"'
  );

  // Un-mangle remaining markdown links. Prefer the visible label (keeps JSON
  // field text) except we already specialized email/linkedin above.
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

  // ChatGPT / DOM often leave literal newlines inside JSON string values —
  // JSON.parse rejects those even when the object is otherwise complete.
  trimmed = escapeControlCharsInJsonStrings(trimmed);

  return trimmed.trim();
}

/**
 * Escape raw control characters inside JSON strings so JSON.parse can succeed.
 * Leaves structure outside strings unchanged.
 */
function escapeControlCharsInJsonStrings(text) {
  const input = String(text || "");
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
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
  return out;
}

/**
 * Clean contact fields after parse — ChatGPT autolinks often leave markdown or
 * truncated URLs inside email/linkedin/profile even when JSON still parses.
 */
export function sanitizeResumeData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const out = { ...data };

  const stripMd = (v) =>
    String(v || "")
      .replace(/\[([^\]]*)\]\(([^)]+)\)/g, "$1")
      .trim();

  out.email = stripMd(out.email)
    .replace(/^mailto:/i, "")
    .replace(/[[\]]/g, "")
    .trim();

  let linkedin = stripMd(out.linkedin).replace(/[[\]]/g, "").trim();
  const urlHit = linkedin.match(/https?:\/\/[^\s"'<>\\]+/i);
  if (urlHit) linkedin = urlHit[0].replace(/[),.;\]]+$/g, "");
  if (linkedin && !/^https?:\/\//i.test(linkedin) && /linkedin\.com/i.test(linkedin)) {
    linkedin = `https://${linkedin.replace(/^\/+/, "")}`;
  }
  if (linkedin && /linkedin\.com/i.test(linkedin) && !/\/$/.test(linkedin)) {
    linkedin = `${linkedin}/`;
  }
  // Incomplete/mangled linkedin values are worse than empty (person overlay fills).
  if (!linkedin || linkedin.includes('","') || !/linkedin\.com/i.test(linkedin)) {
    linkedin = "";
  }
  out.linkedin = linkedin;

  let profile = String(out.profile || "");
  // Leftover from cross-field autolink: "Salesforce](https://…) Rest of profile"
  profile = profile.replace(/^[A-Za-z0-9 ._-]*\]\(https?:\/\/[^)]+\)\s*/i, "");
  profile = stripMd(profile);
  // If profile accidentally starts with a URL fragment, drop it.
  profile = profile.replace(/^https?:\/\/\S+\s*/i, "").trim();
  out.profile = profile;

  out.phone = String(out.phone || "").trim();
  out.name = String(out.name || "").trim();
  out.headline = String(out.headline || "").trim();
  out.location = String(out.location || "").trim();

  return out;
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

/**
 * ChatGPT JSON often has trailing commas that JSON.parse rejects even when the
 * resume object is otherwise complete.
 */
function sanitizeLooseJson(text) {
  let s = String(text || "").replace(/^\uFEFF/, "");
  // Trailing commas before } or ]
  for (let i = 0; i < 8; i += 1) {
    const next = s.replace(/,\s*([}\]])/g, "$1");
    if (next === s) break;
    s = next;
  }
  return s;
}

function safeJsonParse(text) {
  const raw = String(text || "");
  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }
  try {
    return JSON.parse(sanitizeLooseJson(raw));
  } catch {
    return null;
  }
}

function tryParseJson(text) {
  const trimmed = normalizeJsonText(text);

  // Always prefer the richest balanced resume object when several {...} exist
  // (prompt schema example + real answer often appear in the same transcript).
  const objects = [...extractBalancedJsonObjects(trimmed)];
  // Also try loose-sanitized balanced slices when strict parse missed trailing commas.
  if (!objects.length) {
    const loose = sanitizeLooseJson(trimmed);
    if (loose !== trimmed) {
      for (const obj of extractBalancedJsonObjects(loose)) objects.push(obj);
    }
  }
  // extractBalancedJsonObjects only pushes successful JSON.parse — re-scan with loose parse
  {
    const str = sanitizeLooseJson(trimmed);
    let depth = 0;
    let startIdx = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < str.length && objects.length < 24; i += 1) {
      const ch = str[i];
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
            const parsed = safeJsonParse(str.slice(startIdx, i + 1));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              objects.push(parsed);
            }
            startIdx = -1;
          }
        }
      }
    }
  }

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

  const direct = safeJsonParse(trimmed);
  if (direct) return direct;

  // Fast path: first "{" to last "}" (single-object replies).
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = safeJsonParse(trimmed.slice(start, end + 1));
    if (slice) return slice;
  }

  const closed = closeTruncatedJson(trimmed);
  if (closed) {
    const closedParsed = safeJsonParse(closed);
    if (closedParsed) return closedParsed;
    const cs = closed.indexOf("{");
    const ce = closed.lastIndexOf("}");
    if (cs >= 0 && ce > cs) {
      const slice = safeJsonParse(closed.slice(cs, ce + 1));
      if (slice) return slice;
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
  return sanitizeResumeData(coerceResumeObject(tryParseJson(responseText)));
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

function averageBulletLength(data) {
  const bullets = experienceBulletTexts(data);
  if (!bullets.length) return 0;
  return bullets.reduce((n, b) => n + b.length, 0) / bullets.length;
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
  const expected = resolveExpectedExperienceProfile(data);
  const jobs = Array.isArray(data.experience) ? data.experience.length : 0;
  const minJobs = expected?.minJobs || 3;
  if (jobs < minJobs) gaps.push(`jobs(${jobs}/${minJobs})`);
  const missingCos = missingExperienceCompanies(data);
  if (missingCos.length) gaps.push(`missingCompanies(${missingCos.join("; ")})`);
  const cutRoles = incompleteExperienceEntries(data);
  if (cutRoles.length) gaps.push(`emptyRoles(${cutRoles.join("; ")})`);
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
 * and people without certifications still automate end to end — except when the
 * candidate has a FIXED COMPANY HISTORY (must include every required employer).
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

  // Known fixed-history candidates must not drop employers (e.g. Matthew needs 4).
  if (!hasRequiredExperienceCompanies(data)) return false;

  // A role with a header but zero bullets means the resume was cut off mid-stream.
  if (!hasCompleteExperienceEntries(data)) return false;

  // At least one role must carry real, non-trivial bullets.
  const hasDetailedRole = data.experience.some(
    (j) => Array.isArray(j?.bullets) && j.bullets.filter((b) => String(b || "").trim().length > 25).length >= 2
  );
  if (!hasDetailedRole) return false;

  if (totalExperienceBullets(data) < 4) return false;
  // Soft floor — BA/analyst bullets can be shorter than deep Salesforce essays.
  // (Was 55; that rejected finished JSON and looked like a "parse" failure after waits.)
  if (averageBulletLength(data) < 40) return false;
  return true;
}

/**
 * Last-chance bar when JSON is clearly on the page but strict gates failed.
 * Still rejects schema stubs / empty shells / missing fixed employers.
 */
export function isMinimallySaveableResume(data) {
  if (!data || typeof data !== "object") return false;
  if (!String(data.name || "").trim()) return false;
  if (looksLikeSchemaPlaceholderResume(data)) return false;
  const jobs = Array.isArray(data.experience) ? data.experience : [];
  if (jobs.length < 1) return false;
  if (!hasRequiredExperienceCompanies(data)) return false;
  // Never save a resume that still has a cut-off role (header with no bullets).
  if (!hasCompleteExperienceEntries(data)) return false;
  const bullets = experienceBulletTexts(data).filter((b) => String(b).trim().length >= 25);
  if (bullets.length < 4) return false;
  const hasBody =
    String(data.profile || "").trim().length >= 40 ||
    (Array.isArray(data.technicalSummary) && data.technicalSummary.filter(Boolean).length >= 2);
  return hasBody;
}

/**
 * The full-quality bar. While ChatGPT is still streaming we wait for this, so a
 * half-streamed (auto-repaired) object is never mistaken for the final answer.
 */
export function isRichResumeJson(data) {
  if (!isUsableResumeJson(data)) return false;

  const profile = String(data.profile || "").trim();
  if (profile.length < 80) return false;

  const expected = resolveExpectedExperienceProfile(data);
  const jobs = Array.isArray(data.experience) ? data.experience.length : 0;
  const minJobs = expected?.minJobs || 3;
  if (jobs < minJobs) return false;

  const bullets = totalExperienceBullets(data);
  if (bullets < 20) return false;
  // Deep bullets (~2–3 lines) — thin one-liners fail even with high counts.
  if (averageBulletLength(data) < 110) return false;

  const skills = Array.isArray(data.skills) ? data.skills.length : 0;
  const certs = Array.isArray(data.certifications) ? data.certifications.length : 0;
  if (jobs >= 4 && bullets >= 30 && profile.length >= 100 && averageBulletLength(data) >= 120) {
    return true;
  }
  if (skills < 2) return false;
  if (certs < 1) return false;

  return true;
}

/**
 * True when the resume object looks finished even if ChatGPT's stop button is
 * still visible (post-JSON "thinking" / follow-up UI). Tail sections or a large
 * experience block mean we are past a mid-stream truncated repair.
 */
export function resumeJsonLooksComplete(data) {
  if (isRichResumeJson(data)) return true;
  if (!isUsableResumeJson(data)) return false;

  const skills = Array.isArray(data.skills) ? data.skills.filter(Boolean).length : 0;
  const certs = Array.isArray(data.certifications) ? data.certifications.filter(Boolean).length : 0;
  const edu = Array.isArray(data.education) ? data.education.length : 0;
  const expected = resolveExpectedExperienceProfile(data);
  const jobs = Array.isArray(data.experience) ? data.experience.length : 0;
  const minJobs = expected?.minJobs || 3;
  const bullets = totalExperienceBullets(data);
  const profile = String(data.profile || "").trim();
  const avg = averageBulletLength(data);

  // Prefer finished tail sections + deep bullets over thin mid-stream repairs.
  if ((skills >= 1 || certs >= 1 || edu >= 1) && jobs >= minJobs && bullets >= 20 && avg >= 100) {
    return true;
  }
  return jobs >= Math.max(4, minJobs) && bullets >= 28 && profile.length >= 60 && avg >= 110;
}

/** Strict completeness check used for continuation decisions. */
export function isCompleteResumeJson(data) {
  if (!isRichResumeJson(data)) return false;
  if (!String(data.profile || "").trim() || String(data.profile).length < 80) return false;
  if (!Array.isArray(data.skills) || data.skills.length < 1) return false;
  if (!Array.isArray(data.experience) || data.experience.length < 2) return false;
  if (!hasRequiredExperienceCompanies(data)) return false;
  if (!hasCompleteExperienceEntries(data)) return false;
  if (totalExperienceBullets(data) < 8) return false;

  // Enforce company-specific bullet floors for every required / known employer present.
  const expected = resolveExpectedExperienceProfile(data);
  if (expected) {
    for (const role of expected.roles) {
      const matches = data.experience.filter((j) => companyMatches(j?.company, role.label));
      for (const job of matches) {
        const rule = EXPECTED_BULLET_COUNTS.find((r) => r.match.test(String(job?.company || "").trim()));
        const floor = Math.min(rule?.count || 4, 4);
        if (!Array.isArray(job.bullets) || job.bullets.filter(Boolean).length < floor) {
          return false;
        }
      }
    }
  } else {
    for (const rule of EXPECTED_BULLET_COUNTS) {
      const job = data.experience.find((j) => rule.match.test(String(j?.company || "").trim()));
      if (!job) continue;
      if (!Array.isArray(job.bullets) || job.bullets.filter(Boolean).length < Math.min(rule.count, 4)) {
        return false;
      }
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
