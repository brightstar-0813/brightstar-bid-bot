/**
 * Sheet rows sometimes arrive with an empty JD cell (SkipTheDrive, Glassdoor, …) and used to
 * error out as "Empty job description in CSV". The batch now reads the posting text from the
 * row's job link instead. User OK (Slack Q30, 2026-11-16).
 *
 * Pure helpers — no chrome.* — so tests can import them.
 */

const BLOCKED_JD_HOSTS = [/(^|\.)linkedin\.com$/i];

/** http(s) link we may open to read the JD (never LinkedIn — user rule 2026-11-14). */
export function canFetchJdFromLink(url) {
  let u;
  try {
    u = new URL(String(url || "").trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  return !BLOCKED_JD_HOSTS.some((re) => re.test(u.hostname));
}

/** Collapse whitespace / blank lines and cap the length sent to the AI. */
export function cleanJobPageText(raw, { maxChars = 12000 } = {}) {
  const text = String(raw || "")
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

const GONE_RE =
  /\b(no longer (available|accepting)|job (has )?expired|position (has been )?filled|page not found|job not found|this job is closed)\b/i;

// Bot-check / block pages (Glassdoor "Humans only" + Cloudflare Ray ID, 2026-11-16 row 159).
const BLOCK_PAGE_RE =
  /\b(humans only|verify (that )?you are (a )?human|are you a robot|checking your browser|just a moment|access denied|request blocked|unusual traffic|enable (javascript|cookies)|ray id|cloudflare location|captcha|sign in to (view|see) (this|the) job|log in to (view|see|continue))\b/i;

/** Enough real posting text to tailor a resume (not a login wall / bot check / 404 / closed notice). */
export function isUsableJdText(text, { minChars = 400 } = {}) {
  const t = String(text || "").trim();
  if (t.length < minChars) return false;
  if (t.length < 3000 && BLOCK_PAGE_RE.test(t)) return false;
  if (t.length < 1500 && GONE_RE.test(t)) return false;
  return true;
}
