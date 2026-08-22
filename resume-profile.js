/**
 * Parse contact + employers from a master resume / profile doc.
 * Only returns values that actually appear in the uploaded text.
 */

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const DATE_TOKEN = `(?:${MONTH}\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`;
const DATE_RANGE = new RegExp(
  `${DATE_TOKEN}\\s*(?:[–—\\-]|to)+\\s*(?:Present|Current|Now|${DATE_TOKEN})`,
  "i"
);

const TITLE_WORD =
  /^(senior|staff|lead|principal|software|salesforce|engineer|developer|architect|consultant|manager|director|analyst|administrator|specialist|resume|curriculum|vitae|profile|summary|objective|professional|technical|experience)$/i;

function linesOf(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function headerBlock(text) {
  const raw = String(text || "");
  const cut = raw.search(
    /\n(?:professional\s+experience|work experience|employment history|work history)\b/i
  );
  if (cut > 60) return raw.slice(0, cut);
  const alt = raw.search(/\n(?:education|skills|certifications?)\b/i);
  if (alt > 60) return raw.slice(0, Math.min(alt, 1600));
  return raw.slice(0, 1200);
}

export function valueAppearsInResume(value, text) {
  const v = String(value || "").trim();
  const hay = String(text || "");
  if (!v || !hay) return false;
  if (hay.toLowerCase().includes(v.toLowerCase())) return true;
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 10) {
    const hayDigits = hay.replace(/\D/g, "");
    if (hayDigits.includes(digits) || hayDigits.includes(digits.slice(-10))) return true;
  }
  const slug = v.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "");
  if (slug.length > 8 && hay.toLowerCase().includes(slug.toLowerCase())) return true;
  return false;
}

function keepIfSupported(value, text) {
  const v = String(value || "").trim();
  return v && valueAppearsInResume(v, text) ? v : "";
}

function cleanEmail(raw) {
  const m = String(raw || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!m) return "";
  if (/example\.com|email\.com|domain\.com|placeholder/i.test(m[0])) return "";
  return m[0];
}

function cleanPhone(raw) {
  const text = String(raw || "");
  const m =
    text.match(/(?:\+1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}\b/) ||
    text.match(/\+\d{1,3}[\s.-]?(?:\d[\s.-]*){8,14}\d/);
  if (!m) return "";
  const digits = m[0].replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return "";
  if (/^(\d)\1{9,}$/.test(digits)) return "";
  if (/^555/.test(digits.slice(-10))) return "";
  return m[0].replace(/\s+/g, " ").trim();
}

function cleanLinkedin(raw) {
  const text = String(raw || "");
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+\/?/i);
  if (!m) return "";
  if (/linkedin\.com\/in\/(username|profile|name|me)\b/i.test(m[0])) return "";
  const url = m[0].replace(/\/+$/, "");
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function looksLikePersonName(line) {
  let s = String(line || "").trim();
  s = s.replace(/,?\s*(PMP|MBA|Ph\.?D\.?|CPA|CISSP|Jr\.?|Sr\.?|III|II|IV)\s*$/i, "").trim();
  if (s.length < 4 || s.length > 70) return false;
  if (/@|https?:|linkedin|phone|email|resume|curriculum|profile|summary|objective|skills|experience/i.test(s)) {
    return false;
  }
  if (/\d/.test(s)) return false;
  if (
    /\b(inc\.?|llc|ltd|corp|co\.|technologies|solutions|consulting|communications|partners|labs|systems|group)\b/i.test(
      s
    )
  ) {
    return false;
  }
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  if (words.some((w) => TITLE_WORD.test(w))) return false;
  if (words.some((w) => /^(USA|UK|UAE|Inc|LLC|Ltd)$/i.test(w))) return false;
  return words.every((w) => /^[A-Z][a-zA-Z'’.\-]*$/.test(w) || /^[A-Z]{2,}$/.test(w));
}

function looksLikeHeadline(line) {
  const s = String(line || "").trim();
  if (s.length < 8 || s.length > 90) return false;
  if (/@|https?:|linkedin|\d{3}[\s.-]\d{3}/i.test(s)) return false;
  return /\b(engineer|developer|architect|consultant|administrator|manager|lead|director|analyst|specialist|principal|staff)\b/i.test(
    s
  );
}

function extractLocation(header) {
  const cityState = String(header || "").match(
    /\b([A-Z][A-Za-z .'-]{2,30},\s*(?:[A-Z]{2}|[A-Z][A-Za-z .'-]{3,20})(?:,\s*United States)?)\b/
  );
  if (!cityState) return "";
  const loc = cityState[1].replace(/\s+/g, " ").trim();
  if (/linkedin|experience|education|university|inc\.?$|llc|corp/i.test(loc)) return "";
  return loc;
}

function extractAddress(header) {
  const m = String(header || "").match(
    /\b(\d{1,6}\s+[A-Za-z0-9.'#\- ]{3,40}\s(?:Rd|Road|St|Street|Ave|Avenue|Blvd|Lane|Ln|Dr|Drive|Way|Ct|Court|Xing|Crossing|Pkwy|Parkway)\.?)\b/i
  );
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function extractZip(header, address) {
  if (!address) return "";
  const idx = String(header || "").indexOf(address);
  if (idx < 0) return "";
  const window = String(header).slice(idx, idx + address.length + 40);
  const m = window.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : "";
}

const JOB_META =
  /^(contract|full[-\s]?time|part[-\s]?time|intern(ship)?|freelance|contractor|remote|hybrid|on[-\s]?site|permanent|temporary|seasonal|w-?2|c2c|1099|consultant|admin)$/i;

const TITLE_TAIL =
  /^(intern(ship)?|senior|staff|lead|principal|junior|associate|software|engineer|developer|architect|consultant|administrator|admin|manager|director|analyst|specialist)\b/i;

function isJobMeta(value) {
  return JOB_META.test(String(value || "").trim());
}

function isLocationish(value) {
  const s = String(value || "").trim();
  if (!s) return false;
  if (/\b(inc|llc|ltd|corp|co\.|technologies|solutions|consulting|communications)\b/i.test(s)) return false;
  return (
    /\b(united states|philippines|india|remote|hybrid|on-?site|greater\s+\w+\s+area)\b/i.test(s) ||
    /,\s*([A-Z]{2}|[A-Z][a-z]+)\s*$/.test(s)
  );
}

function looksLikeJobTitle(value) {
  const s = String(value || "").trim();
  if (!s) return false;
  if (isJobMeta(s)) return true;
  if (looksLikeHeadline(s)) return true;
  return TITLE_TAIL.test(s) && !/\b(inc|llc|ltd|corp|technologies|solutions|consulting)\b/i.test(s);
}

function isNoiseCompany(label) {
  const s = String(label || "").trim();
  if (s.length < 2 || s.length > 70) return true;
  if (/^\{/.test(s) || /\bHYPERLINK\b/i.test(s) || /https?:\/\//i.test(s)) return true;
  if (/linkedin\.com\/(company|in)\b/i.test(s)) return true;
  if (isJobMeta(s) || looksLikeJobTitle(s)) return true;
  if (
    /^(experience|education|skills|certifications?|summary|profile|technical|projects|awards|languages|contact|references|present|current)$/i.test(
      s
    )
  ) {
    return true;
  }
  if (/\b(university|college|institute|bachelor|master|gpa|certified|resume)\b/i.test(s)) return true;
  if (DATE_RANGE.test(s) && s.length < 28) return true;
  return false;
}

function stripTitleFromCompany(value) {
  const parts = String(value || "")
    .split(/\s+[-–—]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return String(value || "").trim();
  const right = parts.slice(1).join(" - ");
  if (looksLikeJobTitle(right) || isJobMeta(right)) return parts[0];
  return String(value || "").trim();
}

/** Keep the employer name only — drop titles, dates, location, Full-time/Contract. */
export function cleanCompanyLabel(raw) {
  let s = String(raw || "")
    .replace(/\{?\s*HYPERLINK\s+"[^"]*"\s*\}?/gi, " ")
    .replace(/\{HYPERLINK[^}]*\}?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  const at = s.match(/\b(?:at|@)\s+(.+)$/i);
  if (at) s = at[1].trim();
  const segments = s.split(/\s*[|•·]\s*/).map((p) => p.trim()).filter(Boolean);
  const kept = segments.filter(
    (seg) => !isJobMeta(seg) && !DATE_RANGE.test(seg) && !isLocationish(seg)
  );
  for (const seg of kept) {
    const name = stripTitleFromCompany(seg).replace(/[.,;:]+$/, "").trim();
    if (name && !isNoiseCompany(name) && !looksLikeJobTitle(name)) return name;
  }
  return "";
}

function companyFromDatedLine(line) {
  const range = String(line || "").match(DATE_RANGE);
  if (!range) return cleanCompanyLabel(line);
  return cleanCompanyLabel(line.slice(0, range.index));
}

function companyNearDate(slice, dateIndex) {
  const same = companyFromDatedLine(slice[dateIndex] || "");
  if (same) return same;
  for (let back = 1; back <= 3; back += 1) {
    const prev = slice[dateIndex - back] || "";
    if (!prev || DATE_RANGE.test(prev)) continue;
    const cleaned = cleanCompanyLabel(prev) || companyFromDatedLine(`${prev}  ${slice[dateIndex]}`);
    if (cleaned) return cleaned;
  }
  return "";
}

export function parseEmployersFromResume(text) {
  const lines = linesOf(text);
  const start = lines.findIndex(
    (l) => /^(professional\s+)?(experience|work history|employment history)\b/i.test(l) && l.length < 60
  );
  const end = lines.findIndex(
    (l, i) =>
      i > (start < 0 ? 0 : start) &&
      /^(education|certifications?|skills|technical skills|awards)\b/i.test(l) &&
      l.length < 48
  );
  const slice = start >= 0 ? lines.slice(start + 1, end > start ? end : undefined) : lines;

  const found = [];
  const seen = new Set();
  const push = (label) => {
    const name = cleanCompanyLabel(label);
    if (!name || isNoiseCompany(name)) return;
    if (!valueAppearsInResume(name, text)) return;
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push(name);
  };

  for (let i = 0; i < slice.length; i += 1) {
    if (DATE_RANGE.test(slice[i])) {
      push(companyNearDate(slice, i));
      continue;
    }
    const next = slice[i + 1] || "";
    if (next && DATE_RANGE.test(next)) continue;
    if (/\s[-–—]\s/.test(slice[i])) {
      const stripped = stripTitleFromCompany(slice[i]);
      if (stripped && stripped !== slice[i].trim()) push(slice[i]);
    }
  }
  return found.slice(0, 14);
}

export function extractProfileFromResumeText(text) {
  const raw = String(text || "").trim();
  const header = headerBlock(raw);
  const headLines = linesOf(header).slice(0, 12);

  let name = "";
  for (const line of headLines) {
    if (looksLikePersonName(line)) {
      name = line.replace(/,?\s*(PMP|MBA|Ph\.?D\.?|CPA|CISSP|Jr\.?|Sr\.?|III|II|IV)\s*$/i, "").trim();
      break;
    }
  }

  let headline = "";
  if (name) {
    const idx = headLines.findIndex((l) => l === name || l.startsWith(name));
    const after = idx >= 0 ? headLines[idx + 1] : "";
    if (looksLikeHeadline(after)) headline = after;
  }

  const email = cleanEmail(header) || cleanEmail(raw);
  const phone = cleanPhone(header);
  const linkedin = cleanLinkedin(header) || cleanLinkedin(raw);
  const location = extractLocation(header);
  const address = extractAddress(header);
  const zip = extractZip(header, address);
  const employers = parseEmployersFromResume(raw);

  const supported = {
    name: keepIfSupported(name, raw),
    headline: keepIfSupported(headline, raw),
    email: keepIfSupported(email, raw),
    phone: keepIfSupported(phone, raw) || keepIfSupported(phone, header),
    linkedin: keepIfSupported(linkedin, raw),
    location: keepIfSupported(location, header),
    address: keepIfSupported(address, header),
    zip: keepIfSupported(zip, header),
    employers: employers.filter((c) => valueAppearsInResume(c, raw))
  };

  const filled = [];
  if (supported.name) filled.push("name");
  if (supported.headline) filled.push("title");
  if (supported.email) filled.push("email");
  if (supported.phone) filled.push("phone");
  if (supported.linkedin) filled.push("LinkedIn");
  if (supported.location) filled.push("location");
  if (supported.address) filled.push("address");
  if (supported.zip) filled.push("ZIP");
  if (supported.employers.length) {
    filled.push(`${supported.employers.length} employer${supported.employers.length === 1 ? "" : "s"}`);
  }

  return {
    name: supported.name,
    label: supported.name,
    headline: supported.headline,
    email: supported.email,
    phone: supported.phone,
    linkedin: supported.linkedin,
    location: supported.location,
    address: supported.address,
    zip: supported.zip,
    employers: supported.employers,
    filled
  };
}

export function resumeFilePrefixFromName(name) {
  const first = String(name || "")
    .trim()
    .split(/\s+/)[0]
    .replace(/[^A-Za-z0-9]/g, "");
  return first ? `${first}_Resume` : "Resume";
}

/** Downloads subfolder for a person, e.g. Lewis_Resume / "D'mario Lewis" → Applications-Lewis */
export function outputDirFromPerson(person = {}) {
  const prefix = String(person?.resumeFilePrefix || "").trim();
  let token = prefix
    .replace(/_?(Resume|resume)$/i, "")
    .replace(/_+$/, "")
    .replace(/[^A-Za-z0-9]+/g, "");
  if (!token) {
    const parts = String(person?.name || person?.label || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : "";
    token = last.replace(/[^A-Za-z0-9]+/g, "");
  }
  return `Applications-${token || "Applicant"}`;
}

export function namesLikelyDifferent(a, b) {
  const norm = (v) =>
    String(v || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  return left !== right;
}
