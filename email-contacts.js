/**
 * Parse AI contact JSON for Email Bid.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

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
    const confidence = Number(c?.confidence);
    if (Number.isFinite(confidence) && confidence < 0.35) continue;
    seen.add(email);
    out.push({
      name: String(c?.name || "").trim(),
      role: String(c?.role || "").trim(),
      email,
      source: String(c?.source || "").trim(),
      confidence: Number.isFinite(confidence) ? confidence : 0.5,
      evidence: String(c?.evidence || "").trim()
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
