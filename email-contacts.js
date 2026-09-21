/**
 * Parse AI contact JSON for Email Bid.
 * Fields: name, email, role, phone (optional).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const PHONE_RE = /[\d+().\-\s]{7,}/;

/**
 * @param {string} text
 */
export function extractContactsJson(text) {
  const raw = String(text || "");
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 */
function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw || !PHONE_RE.test(raw)) return "";
  // Reject obvious non-phones / placeholders
  if (/^(n\/?a|none|unknown|null)$/i.test(raw)) return "";
  return raw.replace(/\s+/g, " ").slice(0, 40);
}

/**
 * @param {object|null} parsed
 */
export function normalizeContacts(parsed) {
  const list = Array.isArray(parsed?.contacts) ? parsed.contacts : [];
  const out = [];
  const seen = new Set();
  for (const c of list) {
    const email = String(c?.email || "")
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    // Legacy AI replies may still include confidence — drop weak guesses.
    const confidence = Number(c?.confidence);
    if (Number.isFinite(confidence) && confidence < 0.35) continue;
    seen.add(email);
    out.push({
      name: String(c?.name || "").trim(),
      email,
      role: String(c?.role || "").trim(),
      phone: normalizePhone(c?.phone)
    });
  }
  return out.slice(0, 8);
}

/**
 * @param {string} aiText
 * @param {{ company?: string }} [_opts]
 */
export function harvestContactsFromAiText(aiText, _opts = {}) {
  return normalizeContacts(extractContactsJson(aiText));
}

export { EMAIL_RE };
