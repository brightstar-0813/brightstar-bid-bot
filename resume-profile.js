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
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  if (words.some((w) => TITLE_WORD.test(w))) return false;
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

function isNoiseCompany(label) {
  const s = String(label || "").trim();
  if (s.length < 2 || s.length > 70) return true;
  if (
    /^(experience|education|skills|certifications?|summary|profile|technical|projects|awards|languages|contact|references|present|current)$/i.test(
      s
    )
  ) {
    return true;
  }
  if (/\b(university|college|institute|bachelor|master|gpa|certified|resume)\b/i.test(s)) return true;
  if (TITLE_WORD.test(s.split(/\s+/)[0]) && looksLikeHeadline(s)) return true;
  if (DATE_RANGE.test(s) && s.length < 28) return true;
  return false;
}

function companyFromDatedLine(line) {
  const range = line.match(DATE_RANGE);
  if (!range) return "";
  let left = line.slice(0, range.index).replace(/[|•·\-–—]+$/g, "").trim();
  left = left.replace(/\s{2,}.*/, "").trim();
  const at = left.match(/\b(?:at|@)\s+(.+)$/i);
  if (at) left = at[1].trim();
  const piped = left.split(/\s*[|•·]\s*/).map((p) => p.trim()).filter(Boolean);
  if (piped.length >= 2) {
    const last = piped[piped.length - 1];
    left = looksLikeHeadline(last) ? piped[0] : last;
  }
  left = left.replace(/\s+[-–—]\s+(Senior|Staff|Lead|Principal|Software|Salesforce).*$/i, "").trim();
  if (looksLikeHeadline(left) || looksLikePersonName(left)) return "";
  return isNoiseCompany(left) ? "" : left;
}

export function parseEmployersFromResume(text) {
  const lines = linesOf(text);
  const start = lines.findIndex(
    (l) => /^(professional\s+)?(experience|work history|employment history)\b/i.test(l) && l.length < 48
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
    const name = String(label || "").replace(/[.,;:]+$/, "").trim();
    if (!name || isNoiseCompany(name)) return;
    if (!valueAppearsInResume(name, text)) return;
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push(name);
  };

  for (let i = 0; i < slice.length; i += 1) {
    const line = slice[i];
    if (DATE_RANGE.test(line)) {
      const same = companyFromDatedLine(line);
      if (same) {
        push(same);
        continue;
      }
      const prev = slice[i - 1] || "";
      if (prev && !DATE_RANGE.test(prev)) {
        const fromPrev = companyFromDatedLine(`${prev}  ${line}`);
        if (fromPrev) push(fromPrev);
      }
      continue;
    }
    const next = slice[i + 1] || "";
    if (next && DATE_RANGE.test(next) && !DATE_RANGE.test(line)) {
      const fromPair = companyFromDatedLine(`${line}  ${next}`);
      if (fromPair) push(fromPair);
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
