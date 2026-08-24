/**
 * Pure Indeed helpers shared by the service worker and tests.
 */

export const SALESFORCE_JOB_RE =
  /\b(?:salesforce|apex|visualforce|lightning\s+web\s+components?|lwc|sales\s+cloud|service\s+cloud|experience\s+cloud|marketing\s+cloud|commerce\s+cloud|revenue\s+cloud|salesforce\s+cpq|mulesoft|tableau\s+crm|crm\s+analytics|einstein|force\.com)\b/i;

export function isIndeedUrl(value) {
  try {
    return /(^|\.)indeed\.com$/i.test(new URL(String(value || "")).hostname);
  } catch {
    return false;
  }
}

export function buildIndeedSearchUrl({ searchUrl = "", query = "Salesforce" } = {}) {
  const raw = String(searchUrl || "").trim();
  if (raw) {
    const parsed = new URL(raw);
    if (!isIndeedUrl(parsed.href)) {
      throw new Error("Indeed capture URL must be on indeed.com.");
    }
    if (String(query || "").trim()) parsed.searchParams.set("q", String(query).trim());
    return parsed.href;
  }
  const url = new URL("https://www.indeed.com/jobs");
  url.searchParams.set("q", String(query || "Salesforce").trim() || "Salesforce");
  url.searchParams.set("l", "United States");
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

export function normalizeIndeedCapturedJob(job, csvRow) {
  const jdLink = String(job?.jdLink || job?.url || "").trim();
  const hosted = isExplicitlyHostedIndeedJob(job);
  const capturedValue = job?.capturedAt;
  const capturedAt = Number.isFinite(Number(capturedValue))
    ? Number(capturedValue)
    : Date.parse(String(capturedValue || "")) || Date.now();
  return {
    ...job,
    csvRow,
    title: String(job?.title || job?.jobTitle || "").trim(),
    company: String(job?.company || job?.companyName || "").trim(),
    jdLink,
    jdText: String(job?.jdText || job?.description || "").trim(),
    location: String(job?.location || "").trim(),
    remoteRestrictedTo: String(job?.remoteRestrictedTo || "United States").trim(),
    source: "indeed",
    isIndeed: true,
    indeedApplyOnSite: hosted,
    applyOnIndeed: hosted,
    hostedApply: hosted,
    externalApply: !hosted,
    capturedAt
  };
}
