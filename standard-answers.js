/**
 * User-approved standard answers (2026-11-15) for questions the profile does not cover.
 * Never let AI or the Q&A bank invent these — compute them from this rule instead.
 *
 * Pay: posted range → its LOWEST value; no posted pay → $150,000/year.
 * Conversions: hourly = yearly / 2080 (rounded), monthly = yearly / 12.
 */

export const DEFAULT_YEARLY_SALARY = 150000;

/** Salary / compensation / rate / wage questions (not "rate your skill 1–5"). */
const COMP_QUESTION_RE =
  /\b(salary|compensation|desired pay|expected pay|pay expectation|pay requirement|wage|wages|(hourly|pay|bill|billing|expected|desired|target|contract|asking)\s+rate|rate\s+(expectation|requirement)s?|per hour|\/\s*(hr|hour)\b|rate\s*\(\s*(usd|\$))/i;

export function isCompensationQuestion(label) {
  return COMP_QUESTION_RE.test(String(label || ""));
}

/** Parse "$120,000–$130,000", "$55 - $65/hr", "120k-130k", "$90,000" → { min, max, unit }. */
export function parsePostedPay(text) {
  const t = String(text || "").replace(/,/g, "");
  if (!t.trim()) return null;
  const nums = [...t.matchAll(/\$?\s*(\d+(?:\.\d+)?)\s*(k)?/gi)]
    .map((m) => Number(m[1]) * (m[2] ? 1000 : 1))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  const hourly = /\b(hr|hour|hourly)\b|\/\s*h\b/i.test(t) || Math.max(...nums) < 500;
  const monthly = /\b(mo|month|monthly)\b/i.test(t);
  const unit = hourly ? "hourly" : monthly ? "monthly" : "yearly";
  return { min: Math.min(...nums), max: Math.max(...nums), unit };
}

function toYearly(value, unit) {
  if (unit === "hourly") return value * 2080;
  if (unit === "monthly") return value * 12;
  return value;
}

/** What unit the question asks for (default yearly). */
export function askedPayUnit(label) {
  const l = String(label || "");
  if (/\b(hourly|per hour|\/\s*(hr|hour))\b|hourly rate|bill rate|contract rate/i.test(l)) return "hourly";
  if (/\b(monthly|per month)\b/i.test(l)) return "monthly";
  return "yearly";
}

/**
 * @param {{ label?: string, postedPay?: string, unit?: "yearly"|"hourly"|"monthly" }} opts
 * @returns {{ amount: number, unit: string, text: string }}
 */
export function standardPayAnswer({ label = "", postedPay = "", unit } = {}) {
  const want = unit || askedPayUnit(label);
  const posted = parsePostedPay(postedPay);
  const yearly = posted ? toYearly(posted.min, posted.unit) : DEFAULT_YEARLY_SALARY;
  const amount =
    want === "hourly" ? Math.round(yearly / 2080) : want === "monthly" ? Math.round(yearly / 12) : Math.round(yearly);
  const text =
    want === "hourly" ? `$${amount}/hour` : want === "monthly" ? `$${amount.toLocaleString("en-US")}/month` : `$${amount.toLocaleString("en-US")}/year`;
  return { amount, unit: want, text };
}
