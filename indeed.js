/**
 * Pure Indeed helpers shared by the service worker and tests.
 */

export const SALESFORCE_JOB_RE =
  /\b(?:salesforce|apex|visualforce|lightning\s+web\s+components?|lwc|sales\s+cloud|service\s+cloud|experience\s+cloud|marketing\s+cloud|commerce\s+cloud|revenue\s+cloud|salesforce\s+cpq|mulesoft|tableau\s+crm|crm\s+analytics|einstein|force\.com)\b/i;

/** Capture only jobs posted within this many days. */
export const INDEED_CAPTURE_MAX_AGE_DAYS = 7;

/** Indeed "Remote" facet id used on www.indeed.com search URLs. */
export const INDEED_REMOTE_FACET = "attr(DSQF7)";

const DAY_MS = 24 * 60 * 60 * 1000;

export function isIndeedUrl(value) {
  try {
    return /(^|\.)indeed\.com$/i.test(new URL(String(value || "")).hostname);
  } catch {
    return false;
  }
}

/**
 * Build / normalize an Indeed search URL for Salesforce · US remote · last 7 days.
 * Existing URLs are kept on indeed.com but forced onto those capture filters.
 */
export function buildIndeedSearchUrl({ searchUrl = "", query = "Salesforce" } = {}) {
  const raw = String(searchUrl || "").trim();
  let url;
  if (raw) {
    url = new URL(raw);
    if (!isIndeedUrl(url.href)) {
      throw new Error("Indeed capture URL must be on indeed.com.");
    }
  } else {
    url = new URL("https://www.indeed.com/jobs");
  }
  url.searchParams.set("q", String(query || "Salesforce").trim() || "Salesforce");
  url.searchParams.set("l", "Remote");
  url.searchParams.set("fromage", String(INDEED_CAPTURE_MAX_AGE_DAYS));
  const sc = String(url.searchParams.get("sc") || "");
  if (!new RegExp(INDEED_REMOTE_FACET.replace(/[()]/g, "\\$&"), "i").test(sc)) {
    url.searchParams.set("sc", `0kf:${INDEED_REMOTE_FACET};`);
  }
  return url.href;
}

export function isSalesforceRelevantJob(job) {
  const text = `${job?.title || job?.jobTitle || ""}\n${job?.jdText || job?.description || ""}`;
  return SALESFORCE_JOB_RE.test(text);
}

export function isExplicitlyHostedIndeedJob(job) {
  const hosted =
    job?.indeedApplyOnSite === true || job?.applyOnIndeed === true || job?.hostedApply === true;
  return hosted && job?.externalApply !== true;
}

export function mergeIndeedApplyEvidence(previous, incoming) {
  const priorHosted = isExplicitlyHostedIndeedJob(previous);
  const evidence = String(incoming?.applyEvidence || "").toLowerCase();
  if (priorHosted && evidence !== "external") {
    return {
      ...incoming,
      applyEvidence: "hosted",
      applyOnIndeed: true,
      indeedApplyOnSite: true,
      hostedApply: true,
      externalApply: false
    };
  }
  return incoming;
}

function combinedLocationText(job = {}) {
  return [
    job.location,
    job.remoteRestrictedTo,
    job.jobLocationType,
    job.postedText,
    String(job.jdText || job.description || "").slice(0, 1200)
  ]
    .filter(Boolean)
    .join("\n");
}

function looksNonUsCountry(text) {
  const lower = String(text || "").toLowerCase();
  if (!lower) return false;
  if (
    /\bunited states\b|\busa\b|\bu\.s\.a\.?\b|\bu\.s\.\b/.test(lower) ||
    /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|DC)\b/.test(
      String(text || "")
    )
  ) {
    return false;
  }
  return /\b(?:canada|united kingdom|uk|india|mexico|germany|france|australia|philippines|poland|brazil|spain|netherlands|ireland|singapore|japan|china|pakistan|nigeria|romania|ukraine|israel|uae|dubai)\b/i.test(
    lower
  );
}

function looksUs(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (/\bunited states\b|\busa\b|\bu\.s\.a\.?\b|\bu\.s\.\b/.test(lower)) return true;
  if (
    /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|DC)(?:\s+\d{5})?\b/.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

function looksRemote(text, job = {}) {
  if (job.isRemote === true) return true;
  if (/telecommut/i.test(String(job.jobLocationType || ""))) return true;
  const source = String(text || "");
  if (/\bhybrid\b/i.test(source) && !/\bremote\b/i.test(source)) return false;
  return /\bremote\b|\bwork from home\b|\bwfh\b|\btelecommut/i.test(source);
}

/** US remote Salesforce posts only — used after Indeed SERP enrichment. */
export function isUsRemoteIndeedJob(job = {}) {
  const location = String(job.location || "").trim();
  const remoteTo = String(job.remoteRestrictedTo || "").trim();
  const blob = combinedLocationText(job);
  if (!looksRemote(`${location}\n${remoteTo}\n${blob}`, job)) return false;
  if (looksNonUsCountry(location) || looksNonUsCountry(remoteTo) || looksNonUsCountry(blob)) {
    return false;
  }
  if (looksUs(location) || looksUs(remoteTo) || looksUs(blob)) return true;
  // www.indeed.com "Remote" SERP with no foreign country → treat as US remote.
  if (/^\s*remote\b/i.test(location) || /^\s*remote\b/i.test(remoteTo) || job.isRemote === true) {
    return true;
  }
  return false;
}

/**
 * Parse Indeed relative date text or ISO timestamps into epoch ms.
 * Returns null when unknown.
 */
export function parseIndeedPostedAt(value, now = Date.now()) {
  if (value == null || value === "") return null;
  if (Number.isFinite(Number(value)) && Number(value) > 1e11) return Number(value);
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = Date.parse(raw);
  if (Number.isFinite(iso)) return iso;

  const lower = raw.toLowerCase();
  if (/just posted|today|hours? ago|minutes? ago|moments? ago/.test(lower)) return now;
  if (/yesterday/.test(lower)) return now - DAY_MS;
  const days = lower.match(/(\d+)\s*\+?\s*days?\s+ago/);
  if (days) return now - Number(days[1]) * DAY_MS;
  const weeks = lower.match(/(\d+)\s*weeks?\s+ago/);
  if (weeks) return now - Number(weeks[1]) * 7 * DAY_MS;
  const months = lower.match(/(\d+)\s*months?\s+ago/);
  if (months) return now - Number(months[1]) * 30 * DAY_MS;
  if (/30\+\s*days?\s+ago/.test(lower)) return now - 31 * DAY_MS;
  return null;
}

export function isPostedWithinDays(
  job = {},
  days = INDEED_CAPTURE_MAX_AGE_DAYS,
  now = Date.now()
) {
  const postedAt =
    parseIndeedPostedAt(job.postedAt, now) ||
    parseIndeedPostedAt(job.datePosted, now) ||
    parseIndeedPostedAt(job.postedText, now);
  if (postedAt == null) {
    // Unknown age: allow when the SERP itself was forced to fromage=N.
    return job.fromageFiltered === true || job.postedWithinDaysUnknownOk === true;
  }
  return now - postedAt <= days * DAY_MS + DAY_MS / 2;
}

/** Full capture gate: Salesforce + US remote + posted within N days. */
export function isIndeedCaptureEligible(job = {}, options = {}) {
  const days = Number(options.maxAgeDays || INDEED_CAPTURE_MAX_AGE_DAYS);
  const now = options.now || Date.now();
  if (!isSalesforceRelevantJob(job)) return false;
  if (!isUsRemoteIndeedJob(job)) return false;
  if (!isPostedWithinDays(job, days, now)) return false;
  return true;
}

export function normalizeIndeedCapturedJob(job, csvRow) {
  const jdLink = String(job?.jdLink || job?.url || "").trim();
  const hosted = isExplicitlyHostedIndeedJob(job);
  const explicitlyExternal =
    String(job?.applyEvidence || "").toLowerCase() === "external" || job?.externalApply === true;
  const capturedValue = job?.capturedAt;
  const capturedAt = Number.isFinite(Number(capturedValue))
    ? Number(capturedValue)
    : Date.parse(String(capturedValue || "")) || Date.now();
  const postedAt =
    parseIndeedPostedAt(job?.postedAt) ||
    parseIndeedPostedAt(job?.datePosted) ||
    parseIndeedPostedAt(job?.postedText);
  const usRemote = isUsRemoteIndeedJob(job);
  return {
    ...job,
    csvRow,
    title: String(job?.title || job?.jobTitle || "").trim(),
    company: String(job?.company || job?.companyName || "").trim(),
    jdLink,
    jdText: String(job?.jdText || job?.description || "").trim(),
    location: String(job?.location || "").trim() || (usRemote ? "Remote" : ""),
    remoteRestrictedTo: usRemote
      ? String(job?.remoteRestrictedTo || "United States").trim() || "United States"
      : String(job?.remoteRestrictedTo || "").trim(),
    isRemote: usRemote || job?.isRemote === true,
    postedAt: postedAt || null,
    source: "indeed",
    isIndeed: true,
    indeedApplyOnSite: hosted,
    applyOnIndeed: hosted,
    hostedApply: hosted,
    externalApply: !hosted && explicitlyExternal,
    capturedAt
  };
}
