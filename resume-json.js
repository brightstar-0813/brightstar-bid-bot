import {
  compileExperienceRules,
  missingCompaniesForRules,
  hasAllRequiredCompanies,
  formatRequiredEmployersList,
  companyMatches,
  cleanEmployerLabel,
  looksLikeLocationLabel
} from "./experience-rules.js";

const EXPECTED_BULLET_COUNTS = [
  { match: /sfa\s*solutions/i, count: 6 },
  { match: /^amazon$/i, count: 5 },
  { match: /bhg\s*financial/i, count: 5 },
  { match: /scholastic/i, count: 4 },
  { match: /vonage/i, count: 4 },
  { match: /forefront/i, count: 4 },
  // D'mario Lewis — deep on the three senior roles; short floors on the 2014 internships
  { match: /culligan/i, count: 10 },
  { match: /fusion\s*academy/i, count: 9 },
  { match: /hexarmor/i, count: 10 },
  { match: /christian\s*reformed\s*church/i, count: 6 },
  { match: /bostwick\s*lake/i, count: 2 },
  { match: /wolverine\s*world\s*wide/i, count: 2 },
  // Edrwin Revolorio
  { match: /accenture/i, count: 10 },
  { match: /capgemini/i, count: 9 },
  { match: /appirio/i, count: 8 },
  { match: /innoit|innodit/i, count: 4 },
  { match: /serve\s*it/i, count: 2 }
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
    const roles = rulesOrInput.roles
      .map((r) => ({
        label: cleanEmployerLabel(r.label || r.company || ""),
        min: Math.max(1, Number(r.min) || 1)
      }))
      .filter((r) => r.label && !looksLikeLocationLabel(r.label));
    if (!roles.length) {
      activeExperienceRules = null;
      return null;
    }
    // minJobs = employer slots only (ignore inflated mins from location junk).
    activeExperienceRules = {
      minJobs: roles.reduce((n, r) => n + r.min, 0),
      roles
    };
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

/** Non-empty bullet count for one experience entry. */
function roleBulletCount(job) {
  return Array.isArray(job?.bullets)
    ? job.bullets.filter((b) => String(b || "").trim()).length
    : 0;
}

/**
 * Minimum bullets a role should carry before we trust it wasn't truncated.
 * Known employers (fixed history) use their expected count capped at 4; other
 * roles get a generic floor of 2 only when the resume is otherwise rich, so a
 * legitimately short one-off role on a sparse resume is never over-rejected.
 */
function expectedBulletFloor(company, richResume) {
  const rule = EXPECTED_BULLET_COUNTS.find((r) => r.match.test(String(company || "").trim()));
  if (rule) return Math.min(rule.count, 4);
  return richResume ? 2 : 0;
}

/**
 * Floor used only to detect a cut-off reply — not a quality target.
 * Deep consulting roles still need several bullets; early/short roles only
 * need one real bullet so a 10-job JSON can render instead of failing PDF.
 */
function saveBulletFloor(company) {
  const rule = EXPECTED_BULLET_COUNTS.find((r) => r.match.test(String(company || "").trim()));
  if (!rule) return 1;
  if (rule.count >= 9) return 3;
  return 1;
}

function roleUnderfillLabels(data, floorFn) {
  if (!Array.isArray(data?.experience)) return [];
  const out = [];
  for (const job of data.experience) {
    const company = String(job?.company || "").trim();
    const title = String(job?.title || "").trim();
    if (!company && !title) continue;
    const count = roleBulletCount(job);
    if (count === 0) continue; // empty headers are handled by incompleteExperienceEntries
    const floor = floorFn(company);
    if (floor > 0 && count < floor) out.push(`${company || title} (${count}/${floor})`);
  }
  return out;
}

/**
 * Roles that have some bullets but fewer than the quality target — used to
 * re-prompt, not to block PDF save. Returns labels like "Fusion Academy (1/4)".
 */
export function underfilledExperienceEntries(data) {
  if (!Array.isArray(data?.experience)) return [];
  const jobs = data.experience;
  const richResume = jobs.length >= 3 && totalExperienceBullets(data) >= 12;
  return roleUnderfillLabels(data, (company) => expectedBulletFloor(company, richResume));
}

/** Roles so short they look truncated, not merely below the ideal count. */
export function cutOffExperienceEntries(data) {
  return roleUnderfillLabels(data, saveBulletFloor);
}

const BULLET_TERMINAL_RE = /[.!?)\]"'%]$/;
const BULLET_MIDPHRASE_RE =
  /(?:,|;|:|\/|-|\b(?:and|or|but|with|to|of|the|an?|in|for|on|at|by|as|that|which|while|so|including|such)\b)$/i;

/**
 * Detect a bullet that was cut off mid-sentence — the tell-tale sign of a
 * truncated reply (or a mid-stream snapshot the auto-repair closed early).
 * @param {string} text - bullet text
 * @param {boolean} expectTerminal - most bullets in this resume end with punctuation
 */
function bulletLooksTruncated(text, expectTerminal) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/,$/.test(t)) return true; // no real bullet ends with a comma
  if (BULLET_MIDPHRASE_RE.test(t) && !BULLET_TERMINAL_RE.test(t)) return true;
  if (expectTerminal && !BULLET_TERMINAL_RE.test(t)) return true;
  return false;
}

/**
 * Role(s) whose final bullet appears cut off mid-sentence. Only the last bullet
 * of the last role is checked (that is where a truncated reply always ends), so
 * legitimately punctuation-free interior bullets are never flagged.
 */
export function truncatedBulletRoles(data) {
  if (!Array.isArray(data?.experience) || !data.experience.length) return [];
  const all = experienceBulletTexts(data);
  if (!all.length) return [];
  const withTerminal = all.filter((b) => BULLET_TERMINAL_RE.test(String(b).trim())).length;
  const expectTerminal = withTerminal / all.length >= 0.7;
  const lastJob = data.experience[data.experience.length - 1];
  const bullets = Array.isArray(lastJob?.bullets)
    ? lastJob.bullets.filter((b) => String(b || "").trim())
    : [];
  if (!bullets.length) return [];
  if (bulletLooksTruncated(bullets[bullets.length - 1], expectTerminal)) {
    return [String(lastJob?.company || lastJob?.title || "").trim() || "last role"];
  }
  return [];
}

/** True when no role is empty or cut off mid-sentence (thin older roles still pass). */
export function hasFullExperienceEntries(data) {
  return (
    incompleteExperienceEntries(data).length === 0 &&
    cutOffExperienceEntries(data).length === 0 &&
    truncatedBulletRoles(data).length === 0
  );
}

/** Retry prompt when one or more roles were cut off (empty or too few bullets). */
export function buildIncompleteExperienceRetryPrompt(data, rulesOverride = null) {
  const incomplete = incompleteExperienceEntries(data);
  const underfilled = underfilledExperienceEntries(data);
  const truncated = truncatedBulletRoles(data);
  const missing = missingExperienceCompanies(data, rulesOverride);
  const rules = resolveExpectedExperienceProfile(data, rulesOverride);
  const requiredList = formatRequiredEmployersList(rules);
  const problems = [];
  if (incomplete.length) problems.push(`no bullet points: ${incomplete.join(", ")}`);
  if (underfilled.length) problems.push(`too few bullet points: ${underfilled.join(", ")}`);
  if (truncated.length) problems.push(`a bullet cut off mid-sentence: ${truncated.join(", ")}`);
  const problemText = problems.length ? problems.join("; ") : "one or more roles were cut off";
  const missingLine = missing.length
    ? `\n- Also add missing employer(s): ${missing.join(", ")}`
    : "";
  const shortRoles = [...incomplete, ...underfilled].join("; ");
  // Employer names come from the resume itself so this prompt stays person-agnostic.
  const companies = (Array.isArray(data?.experience) ? data.experience : [])
    .map((j) => String(j?.company || "").trim())
    .filter(Boolean);
  const recentNames = companies.slice(0, 2).join(" and ");
  const olderNames = companies.slice(2).join(", ");
  return `Your previous resume JSON was cut off — these role(s) are incomplete (${problemText}).

Return ONLY one complete valid resume JSON object with REAL tailored content.
Rules:
- No markdown, no code fences, no commentary before or after the JSON
- Start with { and end with }
- Keep the recent roles (${recentNames || "the two most recent employers"}) as already written if they already have 8+ bullets
- Expand ONLY these short roles to the counts shown: ${shortRoles || "every role that is still thin"}
- Older roles (${olderNames || "everything below the recent roles"}) need 2–4 compact bullets each — do not spend the whole reply rewriting the most recent role${missingLine}
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

function normalizeJsonText(text, { convertSmartQuotes = true } = {}) {
  // Curly quotes are legal *content* inside a JSON string. Converting them
  // globally turns `"\u2026the \u201Cgolden record\u201D pattern\u2026"` into unescaped delimiters
  // and destroys the object, so callers retry with this off.
  let trimmed = stripMarkdownFences(text)
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, (m) => (convertSmartQuotes ? '"' : m))
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
 * Escape stray double quotes that appear INSIDE a JSON string value.
 * ChatGPT writes bullets like: "applied the "golden record" pattern" — those
 * inner quotes are content, not delimiters, and JSON.parse rejects the object.
 *
 * A quote only closes a string when what follows continues the JSON grammar:
 * `:` (key), `}` / `]` (end of object/array), or `,` followed by the start of
 * another value. Anything else is treated as content and escaped.
 * Fallback only — run this after a normal parse has already failed.
 */
function escapeStrayQuotesInJsonStrings(text) {
  const input = String(text || "");
  let out = "";
  let inString = false;
  let escaped = false;

  const closesString = (idx) => {
    let j = idx + 1;
    while (j < input.length && /\s/.test(input[j])) j += 1;
    if (j >= input.length) return true;
    const next = input[j];
    if (next === ":" || next === "}" || next === "]") return true;
    if (next !== ",") return false;
    // `,` only ends the string when a fresh value/key follows it.
    let k = j + 1;
    while (k < input.length && /\s/.test(input[k])) k += 1;
    if (k >= input.length) return true;
    const after = input[k];
    return (
      after === '"' ||
      after === "{" ||
      after === "[" ||
      after === "-" ||
      /[0-9]/.test(after) ||
      /^(true|false|null)/.test(input.slice(k, k + 5))
    );
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }
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
    if (ch !== '"') {
      out += ch;
      continue;
    }
    if (closesString(i)) {
      out += ch;
      inString = false;
    } else {
      out += '\\"';
    }
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

  out.profile = stripDisqualifyingClaims(out.profile);

  if (Array.isArray(out.technicalSummary)) {
    out.technicalSummary = out.technicalSummary
      .map((line) => stripDisqualifyingClaims(line))
      .filter(Boolean);
  }

  if (Array.isArray(out.experience)) {
    out.experience = out.experience.map((job) => {
      if (!job || typeof job !== "object") return job;
      const next = {
        ...job,
        location: stripEmploymentType(job.location),
        title: stripEmploymentType(job.title)
      };
      if (Array.isArray(job.bullets)) {
        next.bullets = job.bullets.map((b) => stripDisqualifyingClaims(b)).filter(Boolean);
      }
      return enforceKnownInternTitle(next);
    });
  }

  return out;
}

/** Force early internship employers to their canonical Intern titles. */
function enforceKnownInternTitle(job) {
  const company = String(job?.company || "").toLowerCase();
  if (/bostwick lake congregation/.test(company)) {
    return { ...job, title: "IT Team Intern" };
  }
  if (/wolverine world wide/.test(company)) {
    return { ...job, title: "IT Project Management Intern" };
  }
  return job;
}

/**
 * Sentences that disqualify the candidate on sight. Models add these when a JD
 * names a skill the source material lacks, or demands a clearance:
 *   "the verified master resume does not establish production Data Cloud … experience"
 *   "U.S. citizen since 2023; no active Secret clearance is stated"
 * A resume never argues against itself — the recruiter decides, not the document.
 */
const DISQUALIFYING_RE = [
  /\bclearance\b/i,
  /\b(u\.?s\.?\s+)?citizen(ship)?\b/i,
  /\b(visa|green card|work authoriz|immigration|naturaliz)/i,
  /\b(does|do|did) not (establish|list|include|show|reflect|demonstrate|contain)\b/i,
  /\bis not (stated|established|listed|documented|reflected)\b/i,
  /\bno (verified|documented|production|direct|hands-on)\b.{0,40}\bexperience\b/i,
  /\bmaster resume (does not|lacks|omits)\b/i,
  /\b(verified|source) (resume|profile|history) (does not|lacks)\b/i,
  /\blacks? (production|direct|hands-on|documented)\b/i
];

function isDisqualifyingSentence(sentence) {
  return DISQUALIFYING_RE.some((re) => re.test(sentence));
}

/**
 * Drop disqualifying sentences from free text, keeping the rest intact.
 * Returns "" when nothing survives.
 */
const DOT = "";
// "U.S.", "Ph.D.", "Inc." must not be mistaken for sentence ends when splitting.
const ABBREVIATIONS = /\b(?:[A-Za-z]\.){1,4}|\b(?:Inc|Ltd|Co|Corp|Jr|Sr|Dr|Mr|Ms|Mrs|St|vs|etc|approx|No)\./g;

export function stripDisqualifyingClaims(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  const masked = raw.replace(ABBREVIATIONS, (m) => m.replace(/\./g, DOT));
  const sentences = masked.match(/[^.;!?]+[.;!?]*/g);
  if (!sentences) {
    return isDisqualifyingSentence(raw) ? "" : raw;
  }

  const kept = sentences
    .map((s) => s.replace(new RegExp(DOT, "g"), "."))
    .filter((s) => s.trim() && !isDisqualifyingSentence(s));

  return kept
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.;,!?])/g, "$1")
    .replace(/[;,]\s*$/, ".")
    .trim();
}

const EMPLOYMENT_TYPE_RE =
  /^(full[\s-]?time|part[\s-]?time|contract[\s-]?to[\s-]?hire|contract(?:or|ing)?|c2h|temp(?:orary)?|intern(?:ship)?|permanent|perm|freelance|consultant|w[\s-]?2|1099|corp[\s-]?to[\s-]?corp|c2c|seasonal|per[\s-]?diem)$/i;

/**
 * Drop employment type (Full-Time, Contract, Intern…) from a role's location line.
 * Work mode (Hybrid / Remote / On-Site) is kept — recruiters filter on it.
 * "Austin, TX, USA | Hybrid | Full-Time" -> "Austin, TX, USA | Hybrid"
 */
export function stripEmploymentType(location) {
  const raw = String(location || "").trim();
  if (!raw) return "";
  if (!raw.includes("|")) return raw;
  const kept = raw
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && !EMPLOYMENT_TYPE_RE.test(part));
  return kept.join(" | ");
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

/** Rank parsed candidates so the richest resume object wins. */
function scoreResumeObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return -1;
  let score = 0;
  if (Array.isArray(obj.experience)) score += 100000 + obj.experience.length * 1000;
  if (Array.isArray(obj.certifications)) score += 50000 + obj.certifications.length * 100;
  if (Array.isArray(obj.skills)) score += 20000 + obj.skills.length * 50;
  if (typeof obj.profile === "string") score += 25000 + Math.min(obj.profile.length, 500);
  if (typeof obj.name === "string") score += 1000;
  const bullets = Array.isArray(obj.experience)
    ? obj.experience.reduce((n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.length : 0), 0)
    : 0;
  score += bullets * 25;
  return score;
}

/**
 * Parse one already-normalized candidate string.
 * tryParseJson feeds this several repaired variants and keeps the best result.
 */
function parseNormalizedJson(trimmed) {
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
    let best = null;
    let bestScore = -1;
    for (const obj of objects) {
      const s = scoreResumeObject(obj);
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

/**
 * Parse ChatGPT's reply, retrying with progressively more aggressive repairs.
 * Variants cover the two ways a well-formed answer still fails JSON.parse:
 * curly quotes used as content, and unescaped inner quotes inside a bullet.
 * The richest successful parse wins, so a repair never costs us content.
 */
function tryParseJson(text) {
  const seen = new Set();
  const variants = [];
  const addVariant = (candidate) => {
    const v = String(candidate || "");
    if (!v || seen.has(v)) return;
    seen.add(v);
    variants.push(v);
  };

  for (const convertSmartQuotes of [true, false]) {
    const normalized = normalizeJsonText(text, { convertSmartQuotes });
    addVariant(normalized);
    addVariant(escapeStrayQuotesInJsonStrings(normalized));
  }

  let best = null;
  let bestScore = -1;
  for (const variant of variants) {
    const parsed = parseNormalizedJson(variant);
    if (!parsed) continue;
    const score = scoreResumeObject(parsed);
    if (score > bestScore) {
      best = parsed;
      bestScore = score;
    }
  }
  return best;
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

/**
 * Salesforce products a JD may demand, with the recruiter/ATS spelling to emit.
 * `group` picks the skills row a missing product is added to.
 */
const SF_PRODUCT_CATALOG = [
  { name: "Service Cloud", re: /\bservice cloud\b/i, group: "clouds" },
  { name: "Sales Cloud", re: /\bsales cloud\b/i, group: "clouds" },
  { name: "Salesforce Data Cloud", re: /\bdata cloud\b|\bsalesforce genie\b/i, group: "clouds" },
  { name: "Agentforce", re: /\bagentforce\b/i, group: "clouds" },
  { name: "Public Sector Solutions (PSS)", re: /\bpublic sector solutions\b|\bPSS\b/i, group: "clouds" },
  { name: "Experience Cloud", re: /\bexperience cloud\b|\bcommunity cloud\b/i, group: "clouds" },
  { name: "Health Cloud", re: /\bhealth cloud\b/i, group: "clouds" },
  { name: "Financial Services Cloud", re: /\bfinancial services cloud\b|\bFSC\b/i, group: "clouds" },
  { name: "Marketing Cloud", re: /\bmarketing cloud\b|\bpardot\b/i, group: "clouds" },
  { name: "Revenue Cloud", re: /\brevenue cloud\b/i, group: "clouds" },
  { name: "Commerce Cloud", re: /\bcommerce cloud\b/i, group: "clouds" },
  { name: "Nonprofit Cloud", re: /\bnonprofit cloud\b/i, group: "clouds" },
  { name: "Education Cloud", re: /\beducation cloud\b/i, group: "clouds" },
  { name: "Field Service (FSL)", re: /\bfield service\b|\bFSL\b/i, group: "clouds" },
  { name: "Salesforce CPQ", re: /\bCPQ\b/i, group: "platform" },
  { name: "OmniStudio", re: /\bomnistudio\b|\bomniscript\b|\bvlocity\b/i, group: "platform" },
  { name: "Document Generation (DocGen)", re: /\bdocgen\b|\bdocument generation\b|\bconga\b|\bdrawloop\b/i, group: "platform" },
  { name: "MuleSoft", re: /\bmulesoft\b|\banypoint\b/i, group: "platform" },
  { name: "Salesforce Shield", re: /\bsalesforce shield\b/i, group: "platform" },
  { name: "Omni-Channel", re: /\bomni-?channel\b/i, group: "platform" },
  { name: "Tableau", re: /\btableau\b/i, group: "platform" },
  { name: "Apex", re: /\bapex\b/i, group: "development" },
  { name: "Lightning Web Components (LWC)", re: /\bLWC\b|\blightning web components?\b/i, group: "development" },
  { name: "Flow", re: /\bflow builder\b|\brecord-triggered flow\b|\bsalesforce flow\b/i, group: "development" },
  { name: "SOQL", re: /\bSOQL\b/i, group: "development" }
];

const GROUP_TO_CATEGORY = {
  clouds: "Salesforce Clouds",
  platform: "Salesforce Platform",
  development: "Salesforce Development"
};

/** Products the JD actually asks for, in catalog order. */
export function jdRequiredProducts(jdText) {
  const jd = String(jdText || "");
  if (!jd.trim()) return [];
  return SF_PRODUCT_CATALOG.filter((p) => p.re.test(jd));
}

/**
 * Guarantee every Salesforce product named in the JD appears in the skills
 * table, and that the clouds row leads. The model is asked to do this, but the
 * ask is routinely ignored — and a person's stored prompt may predate the rule
 * entirely — so this enforces it after the fact.
 */
export function enforceJdSkills(data, jdText) {
  const wanted = jdRequiredProducts(jdText);
  if (!data || typeof data !== "object" || Array.isArray(data) || !wanted.length) return data;

  const out = { ...data };
  const rows = (Array.isArray(out.skills) ? out.skills : [])
    .filter((r) => r && typeof r === "object")
    .map((r) => ({ category: String(r.category || "").trim(), items: String(r.items || "").trim() }));

  const rowFor = (categoryName) => {
    const wantCloud = /clouds?$/i.test(categoryName);
    let idx = rows.findIndex((r) => r.category.toLowerCase() === categoryName.toLowerCase());
    // "Salesforce Clouds" may arrive as "Clouds" / "Salesforce Cloud"; never match "Cloud Architecture".
    if (idx < 0 && wantCloud) {
      idx = rows.findIndex((r) => /\bclouds?\b/i.test(r.category) && !/architect/i.test(r.category));
    }
    if (idx < 0) {
      rows.push({ category: categoryName, items: "" });
      idx = rows.length - 1;
    }
    return idx;
  };

  for (const product of wanted) {
    const idx = rowFor(GROUP_TO_CATEGORY[product.group] || "Salesforce Platform");
    const items = rows[idx].items;
    if (product.re.test(items)) continue;
    rows[idx].items = items ? `${product.name}, ${items}` : product.name;
  }

  // JD-critical products lead their row, and the clouds row leads the table.
  const cloudsIdx = rows.findIndex(
    (r) => /\bclouds?\b/i.test(r.category) && !/architect/i.test(r.category)
  );
  if (cloudsIdx > 0) {
    const [cloudsRow] = rows.splice(cloudsIdx, 1);
    rows.unshift(cloudsRow);
  }

  out.skills = rows.filter((r) => r.category && r.items);
  return out;
}

/**
 * Roles among the most recent `roles` that do not prove the JD's products in
 * their bullets. The skills table can be enforced outright; bullets cannot, so
 * this drives one targeted re-prompt.
 * @returns {Array<{index:number, company:string, covered:number, need:number, missing:string[]}>}
 */
export function rolesMissingJdSkills(data, jdText, { roles = 2, minBullets = 2 } = {}) {
  const wanted = jdRequiredProducts(jdText);
  if (!wanted.length || !Array.isArray(data?.experience)) return [];
  const top = data.experience.slice(0, roles);
  if (!top.length) return [];

  const bulletsOf = (job) =>
    (Array.isArray(job?.bullets) ? job.bullets : []).map((b) => String(b || ""));

  // A product the candidate already owns (Service Cloud, Apex) can satisfy the
  // per-role bullet count while the scarce must-haves appear nowhere — so track
  // which products are proven across the recent roles, not just how many bullets hit.
  const proven = new Set();
  for (const job of top) {
    for (const bullet of bulletsOf(job)) {
      for (const p of wanted) if (p.re.test(bullet)) proven.add(p.name);
    }
  }
  const unproven = wanted.filter((p) => !proven.has(p.name)).map((p) => p.name);

  const gaps = [];
  top.forEach((job, index) => {
    const bullets = bulletsOf(job);
    const covered = bullets.filter((b) => wanted.some((p) => p.re.test(b))).length;
    const missing = wanted.filter((p) => !bullets.some((b) => p.re.test(b))).map((p) => p.name);
    // Products proven nowhere belong to the most recent role, which is the one
    // whose dates can carry a recently released product.
    const owesUnproven = index === 0 && unproven.length > 0;
    if (covered < minBullets || owesUnproven) {
      gaps.push({
        index,
        company: String(job?.company || `role ${index + 1}`),
        covered,
        need: minBullets,
        missing,
        unproven: index === 0 ? unproven : []
      });
    }
  });
  return gaps;
}

/**
 * Re-prompt that asks only for the recent roles' bullets to be rewritten around
 * the JD's required products. Built in code so it works no matter which prompt
 * template the active person is running.
 */
export function buildJdSkillsRetryPrompt(data, jdText, { roles = 2, minBullets = 3 } = {}) {
  const wanted = jdRequiredProducts(jdText).map((p) => p.name);
  const recent = (Array.isArray(data?.experience) ? data.experience : [])
    .slice(0, roles)
    .map((j) => String(j?.company || "").trim())
    .filter(Boolean);
  const gaps = rolesMissingJdSkills(data, jdText, { roles, minBullets: 2 });
  const unproven = gaps.find((g) => g.unproven?.length)?.unproven || [];

  return [
    "The JSON you just returned lists the required skills in the skills table but never proves them in Professional Experience. Return the COMPLETE corrected JSON object again — every role, every field, same schema — with these changes:",
    "",
    `REQUIRED SKILLS: ${wanted.join(", ")}`,
    unproven.length
      ? `PROVEN NOWHERE IN THE RECENT ROLES — these are the priority: ${unproven.join(", ")}`
      : "",
    `ROLES TO FIX: ${recent.join(" and ")}`,
    "",
    `1. Each of those roles must contain at least ${minBullets} bullets that name the required skills explicitly and describe real work with them.`,
    "2. Spread the skills across those bullets rather than stuffing them all into one line.",
    "3. Each such bullet names the business process, the exact feature or capability used, what was personally built or configured, and the outcome. Show internals, not product names alone: Data Cloud means data streams, data model objects, identity resolution, unified profiles, segmentation; Agentforce means agent topics, actions, Prompt Builder, grounding on CRM records, Einstein Trust Layer guardrails; Public Sector Solutions means licensing, permits, benefits, inspections, business rules engine; Document Generation means templates, merge fields, conditional content, batch generation, e-signature handoff; Service Cloud means Cases, Queues, Omni-Channel routing, Entitlements, escalation.",
    "4. If a product was released after a role ended, place it in the most recent role instead of that older one.",
    "5. Keep every employer, date, location, title, education entry and certification exactly as they already are. Do not mention clearance, citizenship, visa status, or employment type anywhere.",
    "6. Do not explain what is missing or unsupported. Never write that the resume does not establish something.",
    "",
    "Return ONLY the JSON object, starting with { and ending with }. Do not put double quotes inside string values."
  ].join("\n");
}

export function extractResumeJson(responseText) {
  return sanitizeResumeData(coerceResumeObject(tryParseJson(responseText)));
}

export function totalExperienceBullets(data) {
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
  const thinRoles = underfilledExperienceEntries(data);
  if (thinRoles.length) gaps.push(`thinRoles(${thinRoles.join("; ")})`);
  const cutBullets = truncatedBulletRoles(data);
  if (cutBullets.length) gaps.push(`truncatedBullet(${cutBullets.join("; ")})`);
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

  // Known fixed-history candidates must not drop required employers.
  if (!hasRequiredExperienceCompanies(data)) return false;

  // Empty or mid-sentence-cut roles mean the resume was truncated mid-stream.
  // Older roles a bullet short of the quality target still render.
  if (!hasFullExperienceEntries(data)) return false;

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
  // Never save a resume that still has an empty or mid-sentence-cut role.
  if (!hasFullExperienceEntries(data)) return false;
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
  if (!hasFullExperienceEntries(data)) return false;
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
