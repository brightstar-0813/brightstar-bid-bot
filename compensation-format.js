/**
 * Format desired compensation for ATS fields (Greenhouse and others).
 * Defaults: $60 per hour (hourly) / $120000/yr (annual).
 */

export const DEFAULT_HOURLY_COMPENSATION = "$60 per hour";
export const DEFAULT_ANNUAL_COMPENSATION = "$120000/yr";
export const DEFAULT_HOURLY_AMOUNT = 60;
export const DEFAULT_ANNUAL_AMOUNT = 120000;

/**
 * @param {string} context Label, placeholder, and nearby field text.
 * @returns {"hourly"|"annual"|"number"|"unknown"}
 */
export function detectCompensationStyle(context = "") {
  const t = String(context || "").toLowerCase();
  if (!t.trim()) return "unknown";
  if (
    /\b(hour|hourly|\/\s*hr|per\s*hr|per\s*hour|\$\/hr|rate)\b/.test(t) &&
    !/\b(year|annual|salary|\/\s*yr|per\s*year)\b/.test(t)
  ) {
    return "hourly";
  }
  if (/\b(year|yearly|annual|annually|salary|\/\s*yr|per\s*year|\/\s*annum)\b/.test(t)) {
    return "annual";
  }
  if (/\b(number only|numeric|amount only|enter (a )?number|digits only)\b/.test(t)) {
    return "number";
  }
  // Desired Compensation without unit → treat as annual (common Greenhouse default).
  if (/\b(compensation|desired\s+pay|expected\s+pay|salary\s+expectation|desired\s+salary)\b/.test(t)) {
    return "annual";
  }
  return "unknown";
}

function parseAmount(text) {
  const m = String(text || "")
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : NaN;
}

function looksHourlyAmount(n) {
  return Number.isFinite(n) && n > 0 && n < 500;
}

function looksAnnualAmount(n) {
  return Number.isFinite(n) && n >= 1000;
}

/**
 * @param {string} raw Profile salaryExpectation / hourlyRate / extras value.
 * @param {string} fieldContext Label + placeholder for the control.
 * @param {{ hourly?: string, annual?: string }} [defaults]
 * @returns {string}
 */
export function formatCompensationExpectation(
  raw = "",
  fieldContext = "",
  defaults = {}
) {
  const hourlyDefault = String(defaults.hourly || DEFAULT_HOURLY_COMPENSATION).trim();
  const annualDefault = String(defaults.annual || DEFAULT_ANNUAL_COMPENSATION).trim();
  const style = detectCompensationStyle(fieldContext);
  const rawStr = String(raw || "").trim();
  const amount = parseAmount(rawStr);
  const rawLower = rawStr.toLowerCase();
  const rawIsHourly =
    /\b(hour|hourly|\/\s*hr|per\s*hr|per\s*hour)\b/.test(rawLower) || looksHourlyAmount(amount);
  const rawIsAnnual =
    /\b(year|yearly|annual|\/\s*yr|per\s*year|salary)\b/.test(rawLower) || looksAnnualAmount(amount);

  const hourlyAmount = Number.isFinite(amount) && rawIsHourly
    ? amount
    : Number.isFinite(amount) && !rawIsAnnual && looksHourlyAmount(amount)
      ? amount
      : DEFAULT_HOURLY_AMOUNT;
  const annualAmount = Number.isFinite(amount) && rawIsAnnual
    ? Math.round(amount)
    : Number.isFinite(amount) && !rawIsHourly && looksAnnualAmount(amount)
      ? Math.round(amount)
      : DEFAULT_ANNUAL_AMOUNT;

  if (style === "hourly") {
    if (/\d/.test(rawStr) && rawIsHourly) {
      if (/^\$?\s*\d/.test(rawStr) && /hour|hr/i.test(rawStr)) return rawStr;
      return `$${hourlyAmount} per hour`;
    }
    if (/\d/.test(hourlyDefault)) return hourlyDefault;
    return `$${DEFAULT_HOURLY_AMOUNT} per hour`;
  }

  if (style === "annual") {
    if (/\d/.test(rawStr) && rawIsAnnual) {
      if (/\/\s*yr|per\s*year|annual/i.test(rawStr)) return rawStr.replace(/,/g, "");
      return `$${annualAmount}/yr`;
    }
    if (/\d/.test(annualDefault)) return annualDefault.replace(/,/g, "");
    return `$${DEFAULT_ANNUAL_AMOUNT}/yr`;
  }

  if (style === "number") {
    // Prefer annual magnitude unless the field clearly looks hourly.
    if (/\bhour|hourly|\/\s*hr\b/.test(String(fieldContext || "").toLowerCase())) {
      return String(hourlyAmount);
    }
    return String(annualAmount);
  }

  // Unknown style: keep a sensible profile value or annual default.
  if (rawStr) {
    if (rawIsHourly && !/hour|hr/i.test(rawStr)) return `$${hourlyAmount} per hour`;
    if (rawIsAnnual && !/\/\s*yr|year|annual/i.test(rawStr)) return `$${annualAmount}/yr`;
    return rawStr.replace(/,/g, "");
  }
  return annualDefault.replace(/,/g, "");
}
