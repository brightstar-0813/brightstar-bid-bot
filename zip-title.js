/**
 * ZipRecruiter title heuristics (pure). Keep in sync with content/autofill.js.
 * Listing headings use pipes for location/eligibility; JD bodies often open with
 * "WE ARE HIRING: …" which must never become Job Title.
 */

export function isZipHiringBanner(title) {
  const t = String(title || "").trim();
  if (!t) return false;
  if (/^(we(?:\s+are|'re)|now|currently)\s+hiring\b/i.test(t)) return true;
  if (/^hiring\s*[:\-–]/i.test(t)) return true;
  return false;
}

export function zipJunkTitle(title) {
  const t = String(title || "").trim();
  if (!t || t.length < 3) return true;
  if (isZipHiringBanner(t)) return true;
  if (/\d+\s+jobs?\s+in\b/i.test(t)) return true;
  if (/^job\s*description\b/i.test(t)) return true;
  if (/^(see more jobs|find your next|1[- ]?click apply|quick apply|easy apply)\b/i.test(t)) {
    return true;
  }
  if (/^(jobs?|search|results?|ziprecruiter|filter|sign\s*in|log\s*in)\b/i.test(t)) return true;
  return false;
}

/** Short tokens like "NVS" are companies, not job titles. */
export function zipLooksLikeJobTitle(title) {
  const t = String(title || "").trim();
  if (zipJunkTitle(t)) return false;
  if (t.length < 8) return false;
  if (t.length <= 8 && !/\s/.test(t)) return false;
  if (
    /\b(developer|engineer|administrator|manager|analyst|architect|lead|consultant|specialist|director|coordinator|designer|scientist|technician|recruiter|salesforce|remote|hybrid)\b/i.test(
      t
    )
  ) {
    return true;
  }
    return t.length >= 16 && /\s/.test(t) && !/\b(must|eligible|investigation|candidates)\b/i.test(t);
}

export function zipTitleScore(text) {
  const t = String(text || "").trim();
  if (!t || zipJunkTitle(t)) return -1000;
  let score = Math.min(t.length, 80);
  if (zipLooksLikeJobTitle(t)) score += 80;
  if (t.length <= 8 && !/\s/.test(t)) score -= 120;
  if (t === t.toUpperCase() && t.length >= 20) score -= 25;
  if (/[•·|]/.test(t)) {
    const first = t.split(/\s*[•·|]\s*/)[0] || "";
    // ZipRecruiter listing titles: "Role | Remote USA | Federal Program | …"
    if (zipLooksLikeJobTitle(first)) score += 20;
    else score -= 40;
  }
  return score;
}

export function zipTitleFromJd(jdText) {
  const lines = String(jdText || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 10)) {
    if (/^job\s*description$/i.test(line)) continue;
    if (isZipHiringBanner(line)) continue;
    if (/^(location|eligibility|project|about|company|salary|compensation|posted)\s*:/i.test(line)) {
      continue;
    }
    if (/\b(must|should|eligible|investigation|looking for|we are seeking)\b/i.test(line)) {
      continue;
    }
    if (line.split(/\s+/).length > 14) continue;
    if (
      zipLooksLikeJobTitle(line) &&
      line.length < 120 &&
      /\b(developer|engineer|administrator|manager|analyst|architect|lead|consultant|specialist|director)\b/i.test(
        line
      )
    ) {
      return line;
    }
  }
  return "";
}

export function zipCleanDocumentTitle(raw) {
  return String(raw || "")
    .replace(/\s*[|\-–—]\s*ZipRecruiter\b.*$/i, "")
    .trim();
}

/**
 * Prefer the visible listing/detail heading over JD marketing copy.
 * @param {{ heading?: string, cardTitle?: string, pageTitle?: string, schemaTitle?: string, jdText?: string, onSearch?: boolean }} parts
 */
export function pickZipJobTitle(parts = {}) {
  const heading = String(parts.heading || "").trim();
  const cardTitle = String(parts.cardTitle || "").trim();
  const pageTitle = zipCleanDocumentTitle(parts.pageTitle || "");
  const schemaTitle = String(parts.schemaTitle || "").trim();
  const onSearch = Boolean(parts.onSearch);
  const ordered = [heading, cardTitle, pageTitle, onSearch ? "" : schemaTitle, zipTitleFromJd(parts.jdText || "")];
  let best = "";
  let bestScore = 0;
  for (const t of ordered) {
    const s = String(t || "").trim();
    const score = zipTitleScore(s);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return zipLooksLikeJobTitle(best) ? best : "";
}
