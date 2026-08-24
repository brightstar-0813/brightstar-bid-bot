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
    /\bu\.s\.\b/.test(lower)
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
  return false;
}

/**
 * Job boards whose postings are US-only. A row from these sources is treated as
 * US even when the location is a bare city (e.g. Dice "Boston"), empty, or
 * "Remote" — unless the location/remote explicitly names a foreign country.
 */
const US_ONLY_SOURCES = new Set(["dice"]);

export function isUsOnlySource(source) {
  const src = String(source || "").toLowerCase().trim();
  if (!src) return false;
  if (US_ONLY_SOURCES.has(src)) return true;
  // Some exports prefix/suffix the board name (e.g. "dice.com", "dice_run3").
  for (const board of US_ONLY_SOURCES) {
    if (src.includes(board)) return true;
  }
  return false;
}

/**
 * Conservative US filter using location + remote_restricted_to. When the row
 * comes from a US-only board (e.g. Dice), trust the source and only drop it if
 * the location clearly names a foreign country.
 * @param {{ location?: string, remoteRestrictedTo?: string, source?: string }} fields
 */
export function isUnitedStatesJob(fields) {
  const location = String(fields.location || "").trim();
  const remote = String(fields.remoteRestrictedTo || "").trim();
  const combined = `${location} ${remote}`.trim();

  const usSignal = textLooksUs(location) || textLooksUs(remote) || textLooksUs(combined);
  if (usSignal) {
    // Explicit non-US-only remote restriction without US → drop
    if (remote && textLooksNonUsCountry(remote) && !textLooksUs(remote)) {
      return false;
    }
    return true;
  }

  if (textLooksNonUsCountry(location) || textLooksNonUsCountry(remote)) {
    return false;
  }

  // US-only board (Dice etc.): city-only, empty, or "Remote" locations are US.
  if (isUsOnlySource(fields.source)) {
    return true;
  }

  // Bare "Remote" with empty location — do not treat as US
  return false;
}

/**
 * LinkedIn Easy Apply / LinkedIn-hosted postings (harder to automate applications).
 */
export function isLinkedInJob({ jdLink = "", source = "" } = {}) {
  const link = String(jdLink || "").toLowerCase();
  const src = String(source || "").toLowerCase();
  if (src.includes("linkedin") || src === "li") return true;
  if (/linkedin\.com/i.test(link)) return true;
  if (/^li_/i.test(String(source || ""))) return true;
  return false;
}

/**
 * Dice.com Easy Apply / Dice-hosted postings (interleaved generate → apply path).
 */
export function isDiceJob({ jdLink = "", source = "" } = {}) {
  const link = String(jdLink || "").toLowerCase();
  const src = String(source || "").toLowerCase();
  if (src.includes("dice") || src === "dice") return true;
  if (/dice\.com/i.test(link)) return true;
  if (/^dice[_-]/i.test(String(source || ""))) return true;
  return false;
}

/**
 * Indeed / Apply-on-Indeed postings.
 */
export function isIndeedJob({ jdLink = "", source = "" } = {}) {
  const link = String(jdLink || "").toLowerCase();
  const src = String(source || "").toLowerCase();
  if (src.includes("indeed")) return true;
  if (/(?:^|\.)indeed\.com/i.test(link)) return true;
  if (/^indeed[_-]/i.test(String(source || ""))) return true;
  return false;
}

/**
 * Normalize legacy channel keys (e.g. "general" → "etc").
 * @param {string} filter
 * @returns {"all"|"dice"|"linkedin"|"indeed"|"etc"}
 */
export function normalizeChannelFilter(filter) {
  const mode = String(filter || "dice").toLowerCase();
  if (mode === "all") return "all";
  if (mode === "linkedin" || mode === "li") return "linkedin";
  if (mode === "indeed") return "indeed";
  if (mode === "dice") return "dice";
  // Legacy "general" and unknown → Etc (not Dice, LI, or Indeed)
  if (mode === "etc" || mode === "general" || mode === "other") return "etc";
  return "dice";
}

/**
 * @param {Array} jobs
 * @param {"all"|"general"|"linkedin"|"indeed"|"dice"|"etc"} filter
 */
export function filterJobsByChannel(jobs, filter = "dice") {
  const list = Array.isArray(jobs) ? jobs : [];
  const mode = normalizeChannelFilter(filter);
  if (mode === "all") return list.slice();
  if (mode === "linkedin") {
    return list.filter((j) => j.isLinkedIn || isLinkedInJob(j));
  }
  if (mode === "dice") {
    return list.filter((j) => j.isDice || isDiceJob(j));
  }
  if (mode === "indeed") {
    return list.filter((j) => j.isIndeed || isIndeedJob(j));
  }
  // etc = not Dice, LinkedIn, or Indeed
  return list.filter(
    (j) =>
      !(j.isDice || isDiceJob(j)) &&
      !(j.isLinkedIn || isLinkedInJob(j)) &&
      !(j.isIndeed || isIndeedJob(j))
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
      "Remote Restricted To"
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

    if (!isUnitedStatesJob({ location, remoteRestrictedTo, source: source || id })) {
      droppedNonUs += 1;
      continue;
    }

    const srcKey = source || id;
    const linkedIn = isLinkedInJob({ jdLink, source: srcKey });
    const dice = isDiceJob({ jdLink, source: srcKey });
    const indeed = isIndeedJob({ jdLink, source: srcKey });

    usJobs.push({
      csvRow,
      title: title || "Untitled",
      company: company || "Company",
      jdLink,
      jdText,
      location,
      remoteRestrictedTo,
      salary,
      source: source || (linkedIn ? "linkedin" : dice ? "dice" : indeed ? "indeed" : "general"),
      isLinkedIn: linkedIn,
      isDice: dice,
      isIndeed: indeed,
      status: "pending"
    });
  }

  return {
    totalRows: rows.length,
    usJobs,
    droppedNonUs,
    linkedInCount: usJobs.filter((j) => j.isLinkedIn).length,
    diceCount: usJobs.filter((j) => j.isDice).length,
    indeedCount: usJobs.filter((j) => j.isIndeed).length,
    etcCount: usJobs.filter((j) => !j.isLinkedIn && !j.isDice && !j.isIndeed).length,
    /** @deprecated use etcCount — kept for older UI strings */
    generalCount: usJobs.filter((j) => !j.isLinkedIn && !j.isDice && !j.isIndeed).length
  };
}
