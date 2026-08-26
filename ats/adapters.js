/**
 * Thin ATS adapter registry — site identity, auto-submit policy, and step budgets.
 * DOM fill stays in content/autofill.js; adapters only encode host quirks the SW needs.
 */

/**
 * @typedef {object} AtsAdapter
 * @property {string} id
 * @property {string} label
 * @property {RegExp[]} hostPatterns
 * @property {boolean} autoSubmitAllowed
 * @property {boolean} [alwaysAutoSubmit]  // Ctrl+Shift+U / multi-step without caller flag
 * @property {boolean} [isEmployerAts]     // Jobgether / aggregator may redirect here
 * @property {number} [stepBudget]
 * @property {boolean} [emailOtp]
 */

/** @type {AtsAdapter[]} */
export const ATS_ADAPTERS = [
  {
    id: "dice",
    label: "Dice",
    hostPatterns: [/(^|\.)dice\.com$/i],
    autoSubmitAllowed: true,
    stepBudget: 12
  },
  {
    id: "indeed",
    label: "Indeed",
    hostPatterns: [/(^|\.)indeed\.com$/i],
    autoSubmitAllowed: true,
    stepBudget: 12
  },
  {
    id: "workday",
    label: "Workday",
    hostPatterns: [/(^|\.)myworkdayjobs\.com$/i, /(^|\.)workdayjobs\.com$/i],
    autoSubmitAllowed: true,
    isEmployerAts: true,
    stepBudget: 16
  },
  {
    id: "greenhouse",
    label: "Greenhouse",
    hostPatterns: [/(^|\.)greenhouse\.io$/i],
    autoSubmitAllowed: true,
    alwaysAutoSubmit: true,
    isEmployerAts: true,
    stepBudget: 18,
    emailOtp: true
  },
  {
    id: "ashby",
    label: "Ashby",
    hostPatterns: [/(^|\.)ashbyhq\.com$/i],
    autoSubmitAllowed: true,
    alwaysAutoSubmit: true,
    isEmployerAts: true,
    stepBudget: 14
  },
  {
    id: "lever",
    label: "Lever",
    hostPatterns: [/(^|\.)lever\.co$/i],
    autoSubmitAllowed: true,
    alwaysAutoSubmit: true,
    isEmployerAts: true,
    stepBudget: 14
  },
  {
    id: "jobgether",
    label: "Jobgether",
    hostPatterns: [/(^|\.)jobgether\.com$/i],
    autoSubmitAllowed: true,
    stepBudget: 18
  }
];

const BY_ID = new Map(ATS_ADAPTERS.map((a) => [a.id, a]));

export function hostnameFromUrl(url) {
  try {
    return new URL(String(url || "")).hostname || "";
  } catch {
    return "";
  }
}

/**
 * @param {string} url
 * @returns {AtsAdapter | null}
 */
export function matchAdapter(url) {
  const host = hostnameFromUrl(url).toLowerCase();
  if (!host) return null;
  for (const adapter of ATS_ADAPTERS) {
    if (adapter.hostPatterns.some((re) => re.test(host))) return adapter;
  }
  return null;
}

/**
 * @param {string} url
 * @returns {string} adapter id or "generic"
 */
export function applySiteFromUrl(url) {
  return matchAdapter(url)?.id || "generic";
}

/**
 * @param {string} site
 * @returns {AtsAdapter | null}
 */
export function getAdapter(site) {
  return BY_ID.get(String(site || "")) || null;
}

export function applySiteLabel(site) {
  return getAdapter(site)?.label || "application";
}

export function isEmployerAtsSite(site) {
  return Boolean(getAdapter(site)?.isEmployerAts);
}

export function isAutoSubmitAllowedSite(site) {
  return Boolean(getAdapter(site)?.autoSubmitAllowed);
}

/**
 * Resolve whether this apply run should click Submit.
 * @param {string} site
 * @param {boolean} autoSubmitCaller
 */
export function resolveEffectiveAutoSubmit(site, autoSubmitCaller = false) {
  const adapter = getAdapter(site);
  if (!adapter?.autoSubmitAllowed) return false;
  return Boolean(autoSubmitCaller) || Boolean(adapter.alwaysAutoSubmit);
}

export function stepBudgetForSite(site, maxSteps = 12) {
  const budget = getAdapter(site)?.stepBudget;
  return Math.max(Number(maxSteps) || 12, Number(budget) || 12);
}

/** Hosts Jobgether (and similar) may open after APPLY. */
export function isEmployerAtsHost(hostname = "") {
  const host = String(hostname || "").toLowerCase();
  return ATS_ADAPTERS.some(
    (a) => a.isEmployerAts && a.hostPatterns.some((re) => re.test(host))
  );
}
