/**
 * Shared citizenship label matching for profile → ATS dropdown options.
 * Keeps "US Citizen" aligned with Greenhouse-style "U.S. Citizen" lists
 * and avoids treating status menus as Yes/No.
 */

export function normalizeCitizenshipLabel(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z]) (?=[a-z]\b)/g, "$1");
}

export function citizenshipToken(value) {
  const v = normalizeCitizenshipLabel(value);
  if (!v) return "";
  if (/prefer not|decline|do not wish|don't wish/.test(v)) return "prefer_not";
  if (/permanent resident|green card|\blpr\b/.test(v)) return "permanent_resident";
  if (/visa holder|\bh ?1b\b|work visa|other visa/.test(v)) return "visa_holder";
  if (/ead|employment authorization|non citizen authorized|authorized to work/.test(v)) {
    return "work_auth";
  }
  if (/citizen/.test(v) && !/non citizen/.test(v)) return "us_citizen";
  if (/^(yes|y|true|1)$/.test(v)) return "us_citizen";
  return "";
}

const STATUS_BY_TOKEN = {
  us_citizen: [
    "U.S. Citizen",
    "US Citizen",
    "United States Citizen",
    "Citizen"
  ],
  permanent_resident: [
    "Lawful Permanent Resident",
    "Permanent Resident",
    "Permanent Resident (Green Card)",
    "Green Card",
    "LPR"
  ],
  work_auth: [
    "Employment Authorization Document (EAD)",
    "Employment Authorization Document",
    "EAD",
    "Non-citizen authorized to work",
    "Authorized to work"
  ],
  visa_holder: ["Visa Holder", "Work Visa", "H-1B", "Other Visa"],
  prefer_not: ["Prefer not to say", "Decline to self-identify", "I don't wish to answer"]
};

/** Ordered candidates for a profile citizenship value (status labels before Yes). */
export function expandCitizenshipCandidates(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const out = [raw];
  const token = citizenshipToken(raw);
  if (token && STATUS_BY_TOKEN[token]) {
    for (const label of STATUS_BY_TOKEN[token]) {
      if (!out.includes(label)) out.push(label);
    }
  }
  if (token === "us_citizen" && !out.some((c) => /^yes$/i.test(String(c).trim()))) {
    out.push("Yes");
  }
  out.sort((a, b) => {
    const aYn = /^(yes|no)$/i.test(String(a).trim()) ? 1 : 0;
    const bYn = /^(yes|no)$/i.test(String(b).trim()) ? 1 : 0;
    return aYn - bYn;
  });
  return out;
}

/**
 * Pick the best option text from an open list for a profile citizenship value.
 * Prefers status labels; uses Yes/No only when that is all the menu offers.
 */
export function pickCitizenshipOption(value, options = []) {
  const opts = (options || []).map((o) => String(o || "").trim()).filter(Boolean);
  if (!opts.length) return "";
  const candidates = expandCitizenshipCandidates(value);
  const onlyYesNo =
    opts.length <= 3 &&
    opts.every((o) => /^(yes|no|y|n)$/i.test(o.trim())) &&
    opts.some((o) => /^yes$/i.test(o.trim()));

  if (onlyYesNo) {
    const token = citizenshipToken(value);
    return token === "us_citizen" ? opts.find((o) => /^yes/i.test(o)) || "Yes" : opts.find((o) => /^no/i.test(o)) || "No";
  }

  for (const want of candidates) {
    if (/^(yes|no)$/i.test(want)) continue;
    const wantN = normalizeCitizenshipLabel(want);
    const hit = opts.find((o) => {
      const oN = normalizeCitizenshipLabel(o);
      if (oN === wantN) return true;
      if (oN.includes(wantN) || wantN.includes(oN)) return true;
      return false;
    });
    if (hit) return hit;
  }

  const token = citizenshipToken(value);
  if (token === "us_citizen") {
    const citizen = opts.find((o) => {
      const n = normalizeCitizenshipLabel(o);
      return /\bcitizen/.test(n) && !/non citizen/.test(n);
    });
    if (citizen) return citizen;
  }
  return "";
}
