/**
 * Per-person required employers for Experience validation.
 * Team profiles configure this once; GPT cannot drop listed companies.
 */

function normalizeCompanyKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** True when a resume job.company covers a required employer label. */
export function companyMatches(jobCompany, requiredLabel) {
  const a = normalizeCompanyKey(jobCompany);
  const b = normalizeCompanyKey(requiredLabel);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  return false;
}

/**
 * Normalize UI / storage input into ordered company labels.
 * Accepts:
 * - multiline text (one employer per line; optional "Company | 2" or "Company ×2")
 * - string[]
 * - { company|label|name, min? }[]
 */
export function normalizeRequiredExperienceInput(input) {
  if (input == null) return [];

  const pushExpanded = (label, min, out) => {
    const name = String(label || "").trim();
    if (!name || name.startsWith("#")) return;
    const n = Math.max(1, Math.min(12, Number(min) || 1));
    for (let i = 0; i < n; i += 1) out.push(name);
  };

  const out = [];

  if (typeof input === "string") {
    for (const rawLine of input.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const counted = line.match(/^(.*?)\s*[|x×]\s*(\d+)\s*$/i);
      if (counted) {
        pushExpanded(counted[1], counted[2], out);
        continue;
      }
      pushExpanded(line, 1, out);
    }
    return out;
  }

  if (!Array.isArray(input)) return [];

  for (const item of input) {
    if (typeof item === "string") {
      pushExpanded(item, 1, out);
      continue;
    }
    if (item && typeof item === "object") {
      pushExpanded(item.company || item.label || item.name, item.min ?? item.count ?? 1, out);
    }
  }
  return out;
}

export function requiredExperienceToText(input) {
  return normalizeRequiredExperienceInput(input).join("\n");
}

/**
 * Compile ordered employer labels into validation rules.
 * Duplicate labels become min > 1 (e.g. two Accenture lines → min: 2).
 * @returns {{ minJobs: number, roles: Array<{ label: string, min: number }> } | null}
 */
export function compileExperienceRules(input) {
  const list = normalizeRequiredExperienceInput(input);
  if (!list.length) return null;

  const roles = [];
  const indexByKey = new Map();
  for (const label of list) {
    const key = normalizeCompanyKey(label);
    if (!key) continue;
    if (indexByKey.has(key)) {
      roles[indexByKey.get(key)].min += 1;
    } else {
      indexByKey.set(key, roles.length);
      roles.push({ label, min: 1 });
    }
  }
  if (!roles.length) return null;
  return {
    minJobs: list.length,
    roles
  };
}

/**
 * Best-effort extract of FIXED COMPANY HISTORY employers from a tailor prompt.
 */
export function parseRequiredExperienceFromPrompt(promptText) {
  const text = String(promptText || "");
  if (!text.trim()) return [];

  // Prefer the real section heading (often mentioned earlier as a phrase).
  let start = -1;
  const headingRe =
    /FIXED\s+COMPANY\s+HISTORY[^\n]{0,80}(?:DO NOT MODIFY|company\s*\/\s*location|Use these exact)/i;
  const headingHit = headingRe.exec(text);
  if (headingHit) {
    start = headingHit.index;
  } else {
    const re = /FIXED\s+COMPANY\s+HISTORY/gi;
    let m;
    while ((m = re.exec(text)) !== null) start = m.index;
  }

  if (start >= 0) {
    const slice = text.slice(start, start + 4500);
    const stop = slice.search(
      /\n(?:EXISTING RESUME|PRIORITY ORDER|HUMAN RESUME|TARGET ROLE|JOB DESCRIPTION|CANDIDATE INFORMATION|WHAT MUST STAY|WHAT YOU MUST|JSON SCHEMA|PROFILE RULES|SKILLS RULES|EDUCATION RULES|JD ALIGNMENT|REALISM AND|COMPANY CONTEXT|METRICS RULES|CERTIFICATION RULES)\b/i
    );
    const block = stop > 40 ? slice.slice(0, stop) : slice;
    const found = [];
    for (const raw of block.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (/FIXED\s+COMPANY/i.test(line)) continue;
      if (
        /DO NOT MODIFY|Use these exact|Titles below|^Important:|^Keep unchanged/i.test(line) &&
        !/\([A-Za-z]/.test(line)
      ) {
        continue;
      }
      // "Company Name (Location…) — …"  (require location-ish paren + dash/pipe after)
      // The comma is allowed so suffixed names ("Avco Consulting, Inc.") parse.
      const withParen = line.match(
        /^([A-Z0-9][A-Za-z0-9&.,'''/\- ]{1,90}?)\s*\(([^)]{2,140})\)\s*[—–\-|:]/
      );
      if (!withParen) continue;
      const label = withParen[1].replace(/[,\s]+$/, "").trim();
      const loc = withParen[2];
      // Skip ALL-CAPS rule headings accidentally caught
      if (label === label.toUpperCase() && label.length > 12) continue;
      // Location should look like a place / remote note, not a rule parenthetical
      if (
        !/(remote|on-?site|united states|area|city|,|\|)/i.test(loc) &&
        loc.length < 8
      ) {
        continue;
      }
      found.push(label);
    }
    if (found.length) return found;
  }

  // "keep all company names exactly present: Uniqcli, Golabs Tech, and White Prompt"
  const listMatch = text.match(/company names exactly present:\s*([^\n.]+)/i);
  if (listMatch) {
    return listMatch[1]
      .split(/\s*,\s*|\s+and\s+/i)
      .map((s) => s.replace(/^(?:and\s+)/i, "").trim())
      .filter((s) => s && s.length > 1 && !/^and$/i.test(s));
  }

  return [];
}

/**
 * Resolve rules for a person: explicit list → prompt parse → null.
 */
export function resolveExperienceRulesForPerson(person) {
  if (!person || typeof person !== "object") return null;
  const explicit = compileExperienceRules(person.requiredExperience);
  if (explicit) return explicit;
  return compileExperienceRules(parseRequiredExperienceFromPrompt(person.promptTemplate));
}

export function missingCompaniesForRules(data, rules) {
  if (!rules?.roles?.length) return [];
  const jobs = Array.isArray(data?.experience) ? data.experience : [];
  const missing = [];
  for (const role of rules.roles) {
    const count = jobs.filter((j) => companyMatches(j?.company, role.label)).length;
    if (count >= role.min) continue;
    if (role.min > 1) {
      missing.push(
        count === 0
          ? `${role.label} (need ${role.min} entries)`
          : `${role.label} (have ${count}, need ${role.min})`
      );
    } else {
      missing.push(role.label);
    }
  }
  return missing;
}

export function hasAllRequiredCompanies(data, rules) {
  if (!rules?.roles?.length) return true;
  const jobs = Array.isArray(data?.experience) ? data.experience.length : 0;
  if (jobs < (rules.minJobs || rules.roles.length)) return false;
  return missingCompaniesForRules(data, rules).length === 0;
}

export function formatRequiredEmployersList(rules) {
  if (!rules?.roles?.length) return "";
  return rules.roles
    .map((r) => (r.min > 1 ? `${r.label} (×${r.min})` : r.label))
    .join(", ");
}
