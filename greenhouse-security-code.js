/**
 * Extract Greenhouse-style security codes from email body text/HTML.
 * Prefers standalone alphanumeric tokens (e.g. 0wPbvHmX).
 * @param {string} body
 * @returns {string}
 */
export function extractGreenhouseSecurityCode(body = "") {
  const text = String(body || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "");

  const isPlausibleCode = (token) => {
    const t = String(token || "").trim();
    if (!/^[A-Za-z0-9]{6,12}$/.test(t)) return false;
    if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return false;
    if (
      /^(security|verification|greenhouse|application|resubmit|continue|submit|confirm)$/i.test(t)
    ) {
      return false;
    }
    return true;
  };

  const labeled =
    text.match(
      /(?:security\s*code|verification\s*code|enter\s+(?:the\s+)?code|copy\s+and\s+paste\s+this\s+code)[\s\S]{0,120}?([A-Za-z0-9]{6,12})\b/i
    ) || text.match(/(?:code\s*(?:is|:))\s*([A-Za-z0-9]{6,12})\b/i);
  if (labeled?.[1] && isPlausibleCode(labeled[1])) {
    return labeled[1];
  }

  // Prominent standalone token on its own line (common in Greenhouse emails).
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (isPlausibleCode(line)) return line;
  }

  const loose = text.match(/\b([A-Za-z0-9]{8})\b/g) || [];
  for (const token of loose) {
    if (isPlausibleCode(token)) return token;
  }
  return "";
}
