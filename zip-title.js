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

/** Pull the employer out of "See more jobs at TMS LLC" / "Learn more about YO AI Labs". */
export function zipCompanyFromCueText(raw) {
  let s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const cue = s.match(
    /^(?:see more jobs(?:\s+at)?|learn more about|more jobs at|jobs at)\s+(.+)$/i
  );
  if (cue) s = cue[1].trim();
  return s.replace(/[\s↗→➥‣•·|]+$/g, "").trim();
}

export function zipLooksLikeCompanyName(name) {
  const t = zipCompanyFromCueText(name);
  if (!t || t.length > 80) return false;
  if (!/[A-Za-z]{2}/.test(t)) return false;
  if (zipLooksLikeJobTitle(t) && t.length > 24) return false;
  if (
    /^(view|company|about|apply|save|remote|hybrid|on-?site|full[- ]?time|part[- ]?time|new|hot|featured|easy apply|1[- ]?click apply|quick apply|be seen first|learn more|see more|posted|estimated|people enjoy|learn new)\b/i.test(
      t
    )
  ) {
    return false;
  }
  if (/\d+\s+jobs?\b/i.test(t)) return false;
  // Pay rows ("$101K - $132K/yr", "$90/hr") and "Posted 4 days ago" are never companies.
  if (/[$\u20ac\u00a3]|\b(\d+\s*(k|hr|yr)\b|per\s+(hour|year)|an\s+hour)/i.test(t)) return false;
  if (/^\d/.test(t)) return false;
  if (/\bago$/i.test(t)) return false;
  if (/,\s*[A-Z]{2}\b/.test(t) && t.length < 48) return false;
  if (/^[A-Z]{2}\s*[-\u2013\u00b7\u2022]\s*(remote|hybrid|on-?site)\b/i.test(t)) return false;
  return true;
}

/**
 * Confidence of a company candidate by where it was found. ZipRecruiter repeats
 * company-ish text all over the panel, so the poster cue above the JD has to beat
 * the "Learn more about <other company>" widget that sits below it.
 */
export const ZIP_COMPANY_SCORE = {
  cardCue: 96,
  headerCue: 92,
  headerLearn: 84,
  card: 80,
  headerLink: 76,
  headerEmployees: 60,
  headerLine: 48,
  schema: 30,
  bodyCue: 26,
  bodyLearn: 18,
  bodyLink: 12
};

/** Split a detail-panel blob at the "Job description" heading. */
export function zipSplitDetailText(pageText) {
  const blob = String(pageText || "");
  const m = blob.match(/\bjob\s*description\b/i);
  if (!m || m.index === undefined) {
    return { header: blob.slice(0, 2000), body: blob.slice(2000) };
  }
  return { header: blob.slice(0, m.index), body: blob.slice(m.index) };
}

/**
 * Every company name the text offers, tagged with where it came from, so callers
 * can pick the highest score instead of the first match.
 * @returns {{ name: string, score: number, source: string }[]}
 */
export function zipCompanyCandidatesFromText(pageText, jobTitle = "") {
  const { header, body } = zipSplitDetailText(pageText);
  const title = String(jobTitle || "").trim().toLowerCase();
  const out = [];
  const add = (raw, score, source) => {
    const name = zipCompanyFromCueText(raw);
    if (!name || !zipLooksLikeCompanyName(name)) return;
    if (title && name.toLowerCase() === title) return;
    out.push({ name, score, source });
  };
  const cues = (text, cueScore, learnScore, where) => {
    for (const m of String(text).matchAll(/(?:see more jobs at|more jobs at)\s+([^\n]+)/gi)) {
      add(m[1], cueScore, `${where}:cue`);
    }
    for (const m of String(text).matchAll(/learn more about\s+([^\n]+)/gi)) {
      add(m[1], learnScore, `${where}:learn`);
    }
  };

  cues(header, ZIP_COMPANY_SCORE.headerCue, ZIP_COMPANY_SCORE.headerLearn, "header");
  cues(body, ZIP_COMPANY_SCORE.bodyCue, ZIP_COMPANY_SCORE.bodyLearn, "body");

  const emp = header.match(
    /([A-Za-z0-9][A-Za-z0-9 .,&'\u2019-]{1,70}?)\s*[\u2022\u00b7]\s*[^\n\u2022\u00b7]{2,120}?\s*[\u2022\u00b7]\s*\d+\s*[-\u2013]\s*\d+\s+employees/i
  );
  if (emp?.[1]) add(emp[1], ZIP_COMPANY_SCORE.headerEmployees, "header:employees");
  const stacked = header.match(
    /(?:^|\n)\s*([A-Za-z0-9][A-Za-z0-9 .,&'\u2019-]{1,70})\s*\n\s*[\u2022\u00b7]\s*[^\n]{8,160}?employees/i
  );
  if (stacked?.[1]) add(stacked[1], ZIP_COMPANY_SCORE.headerEmployees, "header:employees");

  for (const line of header.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    if (line.length > 60) continue;
    if (zipLooksLikeJobTitle(line) || zipJunkTitle(line)) continue;
    if (/^(or|remote|hybrid|full[- ]?time|part[- ]?time|contract|posted)\b/i.test(line)) continue;
    add(line, ZIP_COMPANY_SCORE.headerLine, "header:line");
  }

  return out;
}

/** Highest-confidence candidate; ties keep the one found first (closest to the title). */
export function zipBestCompanyCandidate(candidates) {
  let best = null;
  for (const c of candidates || []) {
    if (!c?.name) continue;
    if (!best || c.score > best.score) best = c;
  }
  return best;
}

/**
 * ZipRecruiter detail header: "See more jobs at TMS LLC", "Learn more about YO AI Labs",
 * and industry - employees lines. The poster cue above the JD outranks the related-company
 * widget below it, so "Learn more about NVS" can no longer replace the visible poster.
 */
export function zipCompanyFromPageText(pageText, jobTitle = "") {
  return zipBestCompanyCandidate(zipCompanyCandidatesFromText(pageText, jobTitle))?.name || "";
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
