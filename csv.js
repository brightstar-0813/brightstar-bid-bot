/**
 * Parse job CSVs (sf-job-capture Dice export and similar), assign 1-based csvRow,
 * and keep only United States jobs.
 */

const US_STATE_ABBR = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"
]);

const US_STATE_NAMES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
  "new mexico", "new york", "north carolina", "north dakota", "ohio",
  "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
  "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
  "washington", "west virginia", "wisconsin", "wyoming", "district of columbia"
];

const NON_US_COUNTRIES = [
  "india", "brazil", "germany", "spain", "united kingdom", "uk", "poland",
  "mexico", "canada", "france", "portugal", "philippines", "south africa",
  "slovakia", "australia", "netherlands", "ireland", "italy", "sweden",
  "switzerland", "belgium", "romania", "ukraine", "japan", "china",
  "singapore", "uae", "united arab emirates", "israel", "argentina",
  "colombia", "chile", "peru", "egypt", "nigeria", "kenya", "pakistan",
  "bangladesh", "vietnam", "thailand", "indonesia", "malaysia", "taiwan",
  "south korea", "korea", "turkey", "greece", "czech", "hungary", "austria",
  "denmark", "norway", "finland", "new zealand", "costa rica", "panama"
];

/** Well-known non-US cities (when location is city-only with no US signal). */
const NON_US_CITIES = [
  "warsaw", "krakow", "wroclaw", "london", "manchester", "berlin", "munich",
  "paris", "toronto", "vancouver", "montreal", "sydney", "melbourne",
  "bangalore", "bengaluru", "hyderabad", "mumbai", "delhi", "pune",
  "dublin", "amsterdam", "lisbon", "madrid", "barcelona", "tel aviv",
  "sao paulo", "mexico city", "singapore"
];

/**
 * Parse CSV text into an array of objects keyed by header names.
 * Handles quoted fields and embedded newlines.
 * @param {string} text
 * @returns {{ headers: string[], rows: Record<string, string>[] }}
 */
export function parseCsv(text) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(field);
      field = "";
      if (row.some((cell) => String(cell).trim() !== "")) {
        rows.push(row);
      }
      row = [];
      if (ch === "\r") i += 1;
      continue;
    }
    if (ch === "\r") {
      row.push(field);
      field = "";
      if (row.some((cell) => String(cell).trim() !== "")) {
        rows.push(row);
      }
      row = [];
      continue;
    }
    field += ch;
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => String(cell).trim() !== "")) {
      rows.push(row);
    }
  }

  if (!rows.length) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0].map((h) => String(h || "").trim());
  const dataRows = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c] || `col_${c}`;
      obj[key] = cells[c] != null ? String(cells[c]) : "";
    }
    dataRows.push(obj);
  }

  return { headers, rows: dataRows };
}

function formatNumberWithCommas(value) {
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function currencySymbol(code) {
  const c = String(code || "").trim().toUpperCase();
  const map = { USD: "$", CAD: "$", AUD: "$", GBP: "£", EUR: "€", INR: "₹" };
  if (map[c]) return map[c];
  return c ? `${c} ` : "$";
}

function salaryUnitSuffix(unit) {
  const u = String(unit || "").trim().toLowerCase();
  if (!u) return "";
  if (/year|yr|annual|annum/.test(u)) return "/yr";
  if (/month|mo\b/.test(u)) return "/mo";
  if (/week|wk/.test(u)) return "/wk";
  if (/day|daily/.test(u)) return "/day";
  if (/hour|hr/.test(u)) return "/hr";
  return "";
}

/**
 * Build a human-readable salary range string from CSV salary fields.
 * Returns "" when no usable min/max is present.
 */
export function formatSalaryRange({ min, max, currency, unit, raw } = {}) {
  const sym = currencySymbol(currency);
  const suffix = salaryUnitSuffix(unit);
  const lo = formatNumberWithCommas(min);
  const hi = formatNumberWithCommas(max);

  if (lo && hi) return `${sym}${lo}–${sym}${hi}${suffix}`;
  if (lo) return `${sym}${lo}+${suffix}`;
  if (hi) return `Up to ${sym}${hi}${suffix}`;

  // Fall back to a raw salary string (e.g. Fantastic Jobs "salary_raw") if given.
  const rawStr = String(raw || "").trim();
  return rawStr;
}

/** Tidy a salary snippet pulled from free text into a consistent form. */
function cleanSalaryString(s) {
  let out = String(s || "").trim().replace(/\s+/g, " ");
  out = out.replace(/\.00\b/g, "");
  // Unify the range separator (hyphen / en–em dash / "to") into an en dash.
  out = out.replace(/\s*(?:-|to|\u2013|\u2014)\s*/i, "\u2013");
  // Normalize pay-period units.
  out = out.replace(/\s*(?:\/|per\s+)\s*(?:hour|hr)\b\.?/i, "/hr");
  out = out.replace(/\s*(?:\/|per\s+)\s*(?:year|yr|annually|annum)\b\.?/i, "/yr");
  out = out.replace(/\s*(?:\/|per\s+)\s*(?:month|mo)\b\.?/i, "/mo");
  out = out.replace(/\s*(?:\/|per\s+)\s*(?:week|wk)\b\.?/i, "/wk");
  // Uppercase the thousands "k".
  out = out.replace(/(\d)\s?k\b/gi, "$1K");
  return out.trim();
}

/** Leading numeric magnitude of a salary snippet ("$85,800" → 85800; "$135K" → 135000). */
function salaryLeadingAmount(s) {
  const m = String(s || "").match(/\$?\s?(\d[\d,]*(?:\.\d+)?)(\s?[kK])?/);
  if (!m) return 0;
  let n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  if (m[2]) n *= 1000;
  return n;
}

const SALARY_AMOUNT = "\\$\\s?\\d[\\d,]*(?:\\.\\d+)?\\s?[kK]?";
const SALARY_UNIT =
  "(?:\\s*(?:/|per\\s+)\\s*(?:hour|hr|year|yr|annually|annum|month|mo|week|wk)\\b\\.?)";
const SALARY_RANGE_RE = new RegExp(
  `${SALARY_AMOUNT}\\s*(?:-|to|\\u2013|\\u2014)\\s*${SALARY_AMOUNT}${SALARY_UNIT}?`,
  "i"
);
const SALARY_SINGLE_UNIT_RE = new RegExp(`${SALARY_AMOUNT}${SALARY_UNIT}`, "i");
const SALARY_SINGLE_K_RE = new RegExp("\\$\\s?\\d[\\d,]*(?:\\.\\d+)?\\s?[kK]\\b", "i");

/**
 * Extract a salary range from free-text (job description) when structured CSV
 * columns are empty. Conservative: only returns matches that clearly read as
 * pay (a range, an amount with a pay-period unit, or a "$###K" figure) and
 * ignores tiny stray "$5" style numbers that lack a unit.
 */
export function extractSalaryFromText(text) {
  const t = String(text || "");
  if (!t) return "";

  const range = SALARY_RANGE_RE.exec(t);
  if (range) {
    const hasUnit = /(?:hour|hr|year|yr|annually|annum|month|mo|week|wk)/i.test(range[0]);
    const hasK = /\dk\b/i.test(range[0]);
    // Range without a unit must be salary-sized to avoid "$5 - $10" style noise.
    if (hasUnit || hasK || salaryLeadingAmount(range[0]) >= 1000) {
      return cleanSalaryString(range[0]);
    }
  }

  const singleUnit = SALARY_SINGLE_UNIT_RE.exec(t);
  if (singleUnit) return cleanSalaryString(singleUnit[0]);

  const singleK = SALARY_SINGLE_K_RE.exec(t);
  if (singleK && salaryLeadingAmount(singleK[0]) >= 10000) {
    return cleanSalaryString(singleK[0]);
  }

  return "";
}

function getField(row, names) {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim() !== "") {
      return String(row[name]).trim();
    }
    const found = Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase());
    if (found && String(row[found]).trim() !== "") {
      return String(row[found]).trim();
    }
  }
  return "";
}

function textLooksUs(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  const lower = t.toLowerCase();

  if (
    /\bunited states\b/.test(lower) ||
    /\busa\b/.test(lower) ||
    /\bu\.s\.a\.?\b/.test(lower) ||
    /\bu\.s\.\b/.test(lower) ||
    // Bare "US" / "U.S" common on Greenhouse exports ("Remote US", "Remote - US", "REMOTE, US")
    /(^|[^a-z])u\.?s\.?([^a-z]|$)/i.test(t)
  ) {
    return true;
  }

  // City, ST or City, ST ZIP
  const abbrMatch = t.match(/,\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
  if (abbrMatch && US_STATE_ABBR.has(abbrMatch[1].toUpperCase())) {
    return true;
  }

  // City, State, United States already covered; also City, State Name
  for (const state of US_STATE_NAMES) {
    if (new RegExp(`,\\s*${state}\\b`, "i").test(t)) return true;
    if (new RegExp(`\\b${state},\\s*united states\\b`, "i").test(lower)) return true;
  }

  return false;
}

function textLooksNonUsCountry(text) {
  const lower = String(text || "").toLowerCase().trim();
  if (!lower) return false;
  if (textLooksUs(text)) return false;

  for (const country of NON_US_COUNTRIES) {
    if (lower === country) return true;
    if (new RegExp(`\\b${country}\\b`).test(lower) && !/\bunited states\b/.test(lower)) {
      // Avoid matching "georgia" the US state as the country — only when alone or as country suffix
      if (country === "georgia" && /,\s*(ga|georgia)\b/i.test(text) && !/\btbilisi\b/i.test(lower)) {
        continue;
      }
      return true;
    }
  }

  for (const city of NON_US_CITIES) {
    if (lower === city || new RegExp(`^${city}\\b`, "i").test(lower)) {
      return true;
    }
  }
  return false;
}

/**
 * Job boards / capture bots whose exports are US-remote (or US-only).
 * Bare "Remote" / city-only locations are treated as US unless a foreign country
 * is explicitly named. Classification of Dice/Greenhouse/etc. remains URL-only.
 */
const US_REMOTE_CAPTURE_SOURCES = new Set([
  "dice",
  "builtin",
  "greenhouse",
  "jobright",
  "jobgether",
  "linkedin",
  "indeed",
  "workday",
  "myworkday"
]);

/** Hostnames from US-remote capture bots / boards (URL wins over CSV source label). */
const US_REMOTE_CAPTURE_HOST_RE =
  /(^|\.)(dice\.com|builtin\.com|greenhouse\.io|linkedin\.com|indeed\.com|jobright\.ai|jobgether\.com|myworkdayjobs\.com|workdayjobs\.com)$/i;

/** @deprecated use isUsRemoteCaptureSource — kept for older callers */
const US_ONLY_SOURCES = US_REMOTE_CAPTURE_SOURCES;

export function isUsOnlySource(source) {
  return isUsRemoteCaptureSource(source);
}

export function isUsRemoteCaptureSource(source) {
  const src = String(source || "").toLowerCase().trim();
  if (!src) return false;
  if (US_REMOTE_CAPTURE_SOURCES.has(src)) return true;
  for (const board of US_REMOTE_CAPTURE_SOURCES) {
    if (src.includes(board)) return true;
  }
  return false;
}

function isUsRemoteCaptureUrl(jdLink = "") {
  return US_REMOTE_CAPTURE_HOST_RE.test(jobLinkHost(jdLink));
}

function looksBareRemote(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return /^(fully\s+)?remote(\s*[-,]?\s*(work|only|role|position|job))?$|^work\s+from\s+home$|^wfh$/i.test(
    t
  );
}

/**
 * Conservative US filter using location + remote fields + capture-bot source/URL.
 * When the row comes from a US-remote capture bot (Builtin, Dice, Greenhouse, …)
 * or a known board URL, trust Remote / city-only locations unless a foreign
 * country is explicit.
 * @param {{ location?: string, remoteRestrictedTo?: string, source?: string, jdLink?: string }} fields
 */
export function isUnitedStatesJob(fields) {
  const location = String(fields.location || "").trim();
  const remote = String(fields.remoteRestrictedTo || "").trim();
  const combined = `${location} ${remote}`.trim();
  const captureUs =
    isUsRemoteCaptureSource(fields.source) || isUsRemoteCaptureUrl(fields.jdLink);

  const usSignal = textLooksUs(location) || textLooksUs(remote) || textLooksUs(combined);
  if (usSignal) {
    // Explicit non-US-only remote restriction without US → drop
    if (remote && textLooksNonUsCountry(remote) && !textLooksUs(remote)) {
      return false;
    }
    // Location is clearly a foreign city/country even if remote says "Remote"
    // (e.g. Warsaw + Remote) — keep only when location itself also looks US
    // or remote explicitly restricts to US.
    if (
      location &&
      textLooksNonUsCountry(location) &&
      !textLooksUs(location) &&
      !textLooksUs(remote)
    ) {
      return false;
    }
    return true;
  }

  if (textLooksNonUsCountry(location) || textLooksNonUsCountry(remote)) {
    return false;
  }

  // US-remote capture bots (Builtin/Dice/Greenhouse/…): Remote or city-only → US.
  // Indeed/LinkedIn can include non-US posts — only accept when location is empty/Remote
  // (explicit foreign already returned false above).
  if (captureUs) {
    const softBoard =
      /\b(indeed|linkedin)\b/i.test(String(fields.source || "")) ||
      /(^|\.)(indeed\.com|linkedin\.com)$/i.test(jobLinkHost(fields.jdLink));
    if (softBoard) {
      if (!location && !remote) return false;
      if (looksBareRemote(location) || looksBareRemote(remote) || looksBareRemote(combined)) {
        return true;
      }
      // City-only on Indeed/LI without US marker — leave to textLooksUs above; reject here.
      return false;
    }
    return true;
  }

  // Bare Remote without a capture-bot source/URL — do not treat as US
  if (looksBareRemote(location) || looksBareRemote(remote) || looksBareRemote(combined)) {
    return false;
  }

  return false;
}

/**
 * Board classification is URL-only. CSV "source" / site labels are ignored so a
 * Greenhouse (etc.) link is never treated as Dice/LI/Indeed just because the
 * export said so.
 */
function jobLinkHost(jdLink = "") {
  try {
    return new URL(String(jdLink || "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * LinkedIn Easy Apply / LinkedIn-hosted postings (harder to automate applications).
 */
export function isLinkedInJob({ jdLink = "" } = {}) {
  return /(^|\.)linkedin\.com$/i.test(jobLinkHost(jdLink));
}

/**
 * Dice.com Easy Apply / Dice-hosted postings (interleaved generate → apply path).
 */
export function isDiceJob({ jdLink = "" } = {}) {
  return /(^|\.)dice\.com$/i.test(jobLinkHost(jdLink));
}

/**
 * Indeed / Apply-on-Indeed postings.
 */
export function isIndeedJob({ jdLink = "" } = {}) {
  return /(^|\.)indeed\.com$/i.test(jobLinkHost(jdLink));
}

/**
 * Jobright.ai postings.
 */
export function isJobrightJob({ jdLink = "" } = {}) {
  return /(^|\.)jobright\.ai$/i.test(jobLinkHost(jdLink));
}

/**
 * MyWorkday / Workday career-site application URLs.
 */
export function isWorkdayJob({ jdLink = "" } = {}) {
  const host = jobLinkHost(jdLink);
  return /(^|\.)myworkdayjobs\.com$/i.test(host) || /(^|\.)workdayjobs\.com$/i.test(host);
}

/**
 * Greenhouse-hosted job boards (boards / job-boards / embed).
 */
export function isGreenhouseJob({ jdLink = "" } = {}) {
  return /(^|\.)greenhouse\.io$/i.test(jobLinkHost(jdLink));
}

/**
 * Jobgether aggregator — APPLY opens employer ATS (usually Workday / Greenhouse).
 * Stays in the Etc / Other channel; hosted apply follows the external board.
 */
export function isJobgetherJob({ jdLink = "" } = {}) {
  return /(^|\.)jobgether\.com$/i.test(jobLinkHost(jdLink));
}

/**
 * Normalize legacy channel keys (e.g. "general" → "etc").
 * @param {string} filter
 * @returns {"all"|"dice"|"linkedin"|"indeed"|"jobright"|"workday"|"greenhouse"|"etc"}
 */
export function normalizeChannelFilter(filter) {
  const mode = String(filter || "dice").toLowerCase();
  if (mode === "all") return "all";
  if (mode === "linkedin" || mode === "li") return "linkedin";
  if (mode === "indeed") return "indeed";
  if (mode === "jobright" || mode === "jr") return "jobright";
  if (mode === "workday" || mode === "wd") return "workday";
  if (mode === "greenhouse" || mode === "gh") return "greenhouse";
  if (mode === "dice") return "dice";
  // Legacy "general" and unknown → Etc (not Dice, LI, Indeed, Jobright, Workday, or Greenhouse)
  if (mode === "etc" || mode === "general" || mode === "other") return "etc";
  return "dice";
}

/**
 * @param {Array} jobs
 * @param {"all"|"general"|"linkedin"|"indeed"|"jobright"|"workday"|"greenhouse"|"dice"|"etc"} filter
 */
export function filterJobsByChannel(jobs, filter = "dice") {
  const list = Array.isArray(jobs) ? jobs : [];
  const mode = normalizeChannelFilter(filter);
  if (mode === "all") return list.slice();
  if (mode === "linkedin") {
    return list.filter((j) => isLinkedInJob(j));
  }
  if (mode === "dice") {
    return list.filter((j) => isDiceJob(j));
  }
  if (mode === "indeed") {
    return list.filter((j) => isIndeedJob(j));
  }
  if (mode === "jobright") {
    return list.filter((j) => isJobrightJob(j));
  }
  if (mode === "workday") {
    return list.filter((j) => isWorkdayJob(j));
  }
  if (mode === "greenhouse") {
    return list.filter((j) => isGreenhouseJob(j));
  }
  // etc = not Dice, LinkedIn, Indeed, Jobright, Workday, or Greenhouse by URL
  return list.filter(
    (j) =>
      !isDiceJob(j) &&
      !isLinkedInJob(j) &&
      !isIndeedJob(j) &&
      !isJobrightJob(j) &&
      !isWorkdayJob(j) &&
      !isGreenhouseJob(j)
  );
}

/**
 * @param {string} csvText
 * @returns {{
 *   totalRows: number,
 *   usJobs: Array<{
 *     csvRow: number,
 *     title: string,
 *     company: string,
 *     jdLink: string,
 *     jdText: string,
 *     location: string,
 *     remoteRestrictedTo: string,
 *     source: string,
 *     isLinkedIn: boolean,
 *     isDice: boolean,
 *     isIndeed: boolean,
 *     status: string
 *   }>,
 *   droppedNonUs: number,
 *   linkedInCount: number,
 *   indeedCount: number,
 *   generalCount: number,
 *   diceCount: number,
 *   etcCount: number
 * }}
 */
export function parseJobsCsv(csvText) {
  const { rows } = parseCsv(csvText);
  const usJobs = [];
  let droppedNonUs = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const csvRow = i + 1; // 1-based data row (after header)
    const title = getField(row, ["title", "job_title", "Job Title"]);
    const company = getField(row, ["organization", "company", "company_name", "Company"]);
    const location = getField(row, ["location", "Location"]);
    const remoteRestrictedTo = getField(row, [
      "remote_restricted_to",
      "remoteRestrictedTo",
      "Remote Restricted To",
      "work_arrangement",
      "workArrangement",
      "Work Arrangement"
    ]);
    const jdLink = getField(row, ["url", "link", "jd_link", "job_url", "Job Link"]);
    const jdText = getField(row, ["description", "job_description", "jd", "Description"]);
    const source = getField(row, ["source", "Source", "id"]);
    const id = getField(row, ["id", "Id"]);
    let salary = formatSalaryRange({
      min: getField(row, ["salary_min", "salaryMin", "min_salary", "Salary Min"]),
      max: getField(row, ["salary_max", "salaryMax", "max_salary", "Salary Max"]),
      currency: getField(row, ["salary_currency", "salaryCurrency", "currency", "Salary Currency"]),
      unit: getField(row, ["salary_unit", "salaryUnit", "salary_period", "Salary Unit"]),
      raw: getField(row, ["salary_raw", "salaryRaw", "salary", "compensation", "Salary"])
    });
    // Boards like Dice leave salary columns empty — recover it from the JD text.
    if (!salary) salary = extractSalaryFromText(jdText);

    if (!title && !company && !jdText) {
      continue;
    }

    if (
      !isUnitedStatesJob({
        location,
        remoteRestrictedTo,
        source: source || id,
        jdLink
      })
    ) {
      droppedNonUs += 1;
      continue;
    }

    const linkedIn = isLinkedInJob({ jdLink });
    const dice = isDiceJob({ jdLink });
    const indeed = isIndeedJob({ jdLink });
    const jobright = isJobrightJob({ jdLink });
    const workday = isWorkdayJob({ jdLink });
    const greenhouse = isGreenhouseJob({ jdLink });
    const jobgether = isJobgetherJob({ jdLink });

    usJobs.push({
      csvRow,
      title: title || "Untitled",
      company: company || "Company",
      jdLink,
      jdText,
      location,
      remoteRestrictedTo,
      salary,
      source:
        source ||
        (linkedIn
          ? "linkedin"
          : dice
            ? "dice"
            : indeed
              ? "indeed"
              : jobright
                ? "jobright"
                : workday
                  ? "workday"
                  : greenhouse
                    ? "greenhouse"
                    : jobgether
                      ? "jobgether"
                      : "general"),
      isLinkedIn: linkedIn,
      isDice: dice,
      isIndeed: indeed,
      isJobright: jobright,
      isWorkday: workday,
      isGreenhouse: greenhouse,
      isJobgether: jobgether,
      status: "pending"
    });
  }

  const etcJobs = usJobs.filter(
    (j) =>
      !j.isLinkedIn &&
      !j.isDice &&
      !j.isIndeed &&
      !j.isJobright &&
      !j.isWorkday &&
      !j.isGreenhouse
  );

  return {
    totalRows: rows.length,
    usJobs,
    droppedNonUs,
    linkedInCount: usJobs.filter((j) => j.isLinkedIn).length,
    diceCount: usJobs.filter((j) => j.isDice).length,
    indeedCount: usJobs.filter((j) => j.isIndeed).length,
    jobrightCount: usJobs.filter((j) => j.isJobright).length,
    workdayCount: usJobs.filter((j) => j.isWorkday).length,
    greenhouseCount: usJobs.filter((j) => j.isGreenhouse).length,
    etcCount: etcJobs.length,
    /** @deprecated use etcCount — kept for older UI strings */
    generalCount: etcJobs.length
  };
}
