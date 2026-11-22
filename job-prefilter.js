/**
 * Queue pre-check: cheap, text-only rules that run BEFORE the AI tab builds a resume.
 * Each rule reads the row's title + JD text (+ link) and the candidate's state / relocation
 * answer; nothing here opens a tab or calls the network. Rows that fail are marked skipped
 * (with the reason) by the batch, never deleted.
 *
 * Calibrated on the Lewis SF queue (2026-11-22): Wisconsin-resident Dice rows, "(m/f/d)" and
 * "(all genders)" German postings, Jobgether "Remote from:" lists. Known false positives it must
 * NOT trip on: California privacy notices ("California residents should read…"), salary notes
 * ("for residents of the United States only"), "US or Canada", "not eligible for relocation
 * assistance", Tripoint "located in, or willing to relocate to, one of the states supported".
 *
 * Pure helpers — no chrome.* — so tests can import them.
 */

export const US_STATES = Object.freeze({
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
});

const NAME_TO_ABBR = new Map(
  Object.entries(US_STATES).map(([abbr, name]) => [name.toLowerCase(), abbr])
);

/** "Michigan" / "MI" / "mi" → "MI"; anything else → "". */
export function normalizeUsState(value) {
  const s = String(value || "").trim().replace(/\./g, "");
  if (!s) return "";
  const up = s.toUpperCase();
  if (US_STATES[up]) return up;
  return NAME_TO_ABBR.get(s.toLowerCase()) || "";
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longest names first so "West Virginia" wins over "Virginia".
const STATE_NAME_ALT = Object.values(US_STATES)
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)
  .join("|");
const STATE_ABBR_ALT = Object.keys(US_STATES).join("|");
/**
 * State as a full name (any case) or as an UPPERCASE two-letter code: patterns are built with
 * the `i` flag and the codes sit in a case-sensitive `(?-i:…)` group, so "in" / "or" / "me" in
 * running text never read as Indiana / Oregon / Maine.
 */
const STATE_TOKEN = `(?:${STATE_NAME_ALT}|(?-i:${STATE_ABBR_ALT}))`;

function stateFromToken(token) {
  return normalizeUsState(token);
}

/** `(?-i:…)` needs a modern V8 (Chrome 125+, Node 23+); older engines drop the modifier. */
function buildRe(source, flags = "gi") {
  try {
    return new RegExp(source, flags);
  } catch {
    // Older engines: codes then also match lowercase; the requirement-word guards below
    // still keep false positives out.
    return new RegExp(source.replace(/\(\?-i:/g, "(?:"), flags);
  }
}

const REQUIREMENT_BEFORE_RE =
  /\b(must|has to|have to|need to|needs to|required|requires|requirement|only|mandatory|applicant|candidates?)\b[^.;\n]{0,40}$/i;

const RESIDENT_AFTER_RE = buildRe(`\\b(${STATE_TOKEN})\\s+residen(?:ts?|cy)\\b`);
const RESIDENT_OF_RE = buildRe(
  `\\bresiden(?:ts?|cy)\\s+(?:of|in)\\s+(?:the\\s+state\\s+of\\s+)?(${STATE_TOKEN})\\b`
);
const LIVE_IN_RE = buildRe(
  `\\b(?:must|has to|have to|need to|required to)\\s+(?:currently\\s+)?(?:live|reside|be\\s+located|be\\s+based)\\s+in\\s+(?:the\\s+state\\s+of\\s+)?(${STATE_TOKEN})\\b`
);
const ONLY_AFTER_RE = /^[^.;\n]{0,25}\bonly\b/i;

/**
 * States the posting requires the candidate to live in (e.g. ["WI"]). Empty when none.
 * A state only counts when a requirement word sits right before it ("must be a current WI
 * resident", "candidates must be WI residents", "must live in Wisconsin") or "only" right
 * after ("Texas residents only"), or when it is in the job title.
 */
export function detectRequiredResidencyStates({ title = "", jdText = "" } = {}) {
  const found = new Set();
  const scan = (text, inTitle) => {
    const src = String(text || "");
    if (!src) return;
    for (const re of [RESIDENT_AFTER_RE, RESIDENT_OF_RE, LIVE_IN_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const st = stateFromToken(m[1]);
        if (!st) continue;
        if (re === LIVE_IN_RE || inTitle) {
          found.add(st);
          continue;
        }
        const before = src.slice(Math.max(0, m.index - 60), m.index);
        const after = src.slice(m.index + m[0].length, m.index + m[0].length + 30);
        if (REQUIREMENT_BEFORE_RE.test(before) || ONLY_AFTER_RE.test(after)) found.add(st);
      }
    }
  };
  scan(title, true);
  scan(jdText, false);
  return [...found];
}

const RELOCATION_REQUIRED_RES = [
  /\bmust\s+(?:be\s+(?:willing|able)\s+to\s+)?relocate\b/i,
  /\brelocation\s+(?:is\s+)?(?:required|mandatory|a\s+must)\b/i,
  /\brequired\s+to\s+relocate\b/i,
  /\b(?:has|have|need|needs)\s+to\s+relocate\b/i,
  /\brelocate\s+to\s+[A-Za-z][\w ,.]{1,40}?\s+(?:before|prior\s+to)\s+(?:joining|starting|the\s+start|day\s+one)\b/i
];

/** Posting says the candidate must relocate (not "relocation assistance", not "or be willing to"). */
export function detectRelocationRequired({ title = "", jdText = "" } = {}) {
  const text = `${title}\n${jdText}`;
  return RELOCATION_REQUIRED_RES.some((re) => re.test(text));
}

// "US" stays case-sensitive ("join us" is not a country); the words match in any case.
const US_SIGNAL_RE =
  /\b(?:(?-i:US|USA|U\.S\.A?\.?)|united states|america|north america|anywhere|worldwide|global(?:ly)?)\b/i;
const GENDER_TAG_RE = /\((?:m\/[fwd]\/[dfwx]|[fw]\/m\/[dx]|m\/w\/d|w\/m\/d|all genders|m\/f\/x)\)/i;
const REMOTE_FROM_RE = /\bremote\s+from\s*:?\s*([^\n]{2,140})/i;
const ARBEITNOW_COUNTRY_RE =
  /\bjobs\s+in\s+(Germany|Austria|Switzerland|United Kingdom|UK|London|Netherlands|France|Spain|Poland|Ireland|Portugal|Italy|Sweden|Denmark|India|Canada)\b[^.\n]{0,20}\bon\s+Arbeitnow\b/i;
const STATE_NAME_RE = new RegExp(`\\b(${STATE_NAME_ALT})\\b`, "i");

/**
 * Reason text when the listing is clearly not open to a US-based candidate, else "".
 * Conservative: "US or Canada", "US, LATAM, or India" and global boilerplate stay in.
 */
export function detectNonUsListing({ title = "", jdText = "" } = {}) {
  const t = String(title || "");
  const jd = String(jdText || "");
  const tag = t.match(GENDER_TAG_RE);
  if (tag) return `non-US posting (title marker ${tag[0]})`;
  const rf = `${t}\n${jd}`.match(REMOTE_FROM_RE);
  if (rf) {
    const list = rf[1].split(/[.;]|\s{3,}/)[0];
    if (!US_SIGNAL_RE.test(list) && !STATE_NAME_RE.test(list)) {
      return `non-US remote (Remote from: ${list.trim().slice(0, 60)})`;
    }
  }
  const an = jd.match(ARBEITNOW_COUNTRY_RE);
  if (an) return `non-US posting (Arbeitnow: jobs in ${an[1]})`;
  return "";
}

const CLOSED_RES = [
  /\bno\s+longer\s+accepting\s+applications\b/i,
  /\bthis\s+(?:job|position|posting|role)\s+(?:is\s+no\s+longer\s+available|has\s+been\s+filled|has\s+expired|is\s+closed)\b/i,
  /\b(?:job|posting)\s+has\s+expired\b/i,
  /\bapplications?\s+(?:are|is)\s+(?:now\s+)?closed\b/i
];

/** Listing text says it is closed / expired, else "". */
export function detectClosedListing({ jdText = "" } = {}) {
  const jd = String(jdText || "");
  for (const re of CLOSED_RES) {
    const m = jd.match(re);
    if (m) return `closed listing ("${m[0]}")`;
  }
  return "";
}

/** "Yes"/"true" → true, "No"/"false" → false, blank → null. */
export function parseYesNo(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(y|yes|true|1|willing)/.test(s)) return true;
  if (/^(n|no|false|0|not)/.test(s)) return false;
  return null;
}

/**
 * Run every text rule for one queue row.
 * @param {{title?:string,jdText?:string,jdLink?:string}} job
 * @param {{ candidateState?: string, willingToRelocate?: boolean|null }} candidate
 *   willingToRelocate null/undefined = not permitted (standard answer "willing to relocate → No").
 * @returns {{ skip: boolean, code: string, reason: string }}
 */
export function prefilterJob(job = {}, { candidateState = "", willingToRelocate = null } = {}) {
  const title = String(job.title ?? job.jobTitle ?? "");
  const jdText = String(job.jdText || "");
  const keep = { skip: false, code: "", reason: "" };

  const closed = detectClosedListing({ jdText });
  if (closed) return { skip: true, code: "closed", reason: closed };

  const nonUs = detectNonUsListing({ title, jdText });
  if (nonUs) return { skip: true, code: "non_us", reason: nonUs };

  const home = normalizeUsState(candidateState);
  const states = detectRequiredResidencyStates({ title, jdText });
  if (states.length && !(home && states.includes(home))) {
    return {
      skip: true,
      code: "state_residency",
      reason: `requires ${states.join("/")} residency (candidate ${home ? `in ${home}` : "state unknown"})`
    };
  }

  if (willingToRelocate !== true && detectRelocationRequired({ title, jdText })) {
    // Living in the required state already means no move — only skip when the posting names
    // a state the candidate is not in, or names none at all.
    if (!(home && states.includes(home))) {
      return {
        skip: true,
        code: "relocation_required",
        reason: "requires relocation (candidate not willing to relocate)"
      };
    }
  }
  return keep;
}
