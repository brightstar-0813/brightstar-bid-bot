/**
 * Convert pasted plain-text resumes into the JSON shape templates expect.
 * Also accepts paste that is already resume JSON.
 */
import { extractProfileFromResumeText } from "./resume-profile.js";
import {
  extractResumeJson,
  isMinimallySaveableResume,
  isUsableResumeJson,
  sanitizeResumeData
} from "./resume-json.js";

const SECTION_ALIASES = [
  { key: "profile", re: /^(profile|summary|professional\s+summary|objective|about(\s+me)?)\b/i },
  {
    key: "technicalSummary",
    re: /^(technical\s+summary|highlights|key\s+highlights|accomplishments|achievements)\b/i
  },
  { key: "skills", re: /^(skills|technical\s+skills|core\s+competencies|technologies|tech\s+stack)\b/i },
  {
    key: "experience",
    re: /^(experience|work\s+experience|professional\s+experience|employment(\s+history)?|work\s+history|career\s+history)\b/i
  },
  { key: "education", re: /^(education|academic|academics)\b/i },
  {
    key: "certifications",
    re: /^(certifications?|licenses?|credentials?)\b/i
  },
  { key: "projects", re: /^(projects?|selected\s+projects)\b/i }
];

const DATE_RANGE_RE =
  /(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\s*[-–—to]+\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:(?:19|20)\d{2}|present|current|now)/i;

function linesOf(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l, i, arr) => l.trim() || (i > 0 && i < arr.length - 1 && arr[i - 1].trim()));
}

function looksLikeSectionHeader(line) {
  const t = String(line || "").trim();
  if (!t || t.length > 64) return false;
  if (/[.?!]$/.test(t)) return false;
  if (t.split(/\s+/).length > 6) return false;
  return SECTION_ALIASES.some((s) => s.re.test(t.replace(/[:：]\s*$/, "")));
}

function sectionKeyFor(line) {
  const t = String(line || "")
    .trim()
    .replace(/[:：]\s*$/, "");
  const hit = SECTION_ALIASES.find((s) => s.re.test(t));
  return hit?.key || "";
}

function stripBullet(line) {
  return String(line || "")
    .trim()
    .replace(/^[-–—*•●○▪▸►➤]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function isBulletLine(line) {
  const t = String(line || "").trim();
  return /^[-–—*•●○▪▸►➤]\s+\S/.test(t) || /^\d+[.)]\s+\S/.test(t);
}

function splitSections(text) {
  const lines = linesOf(text);
  const sections = { preamble: [] };
  let current = "preamble";
  for (const line of lines) {
    if (looksLikeSectionHeader(line)) {
      current = sectionKeyFor(line) || current;
      if (!sections[current]) sections[current] = [];
      continue;
    }
    if (!sections[current]) sections[current] = [];
    sections[current].push(line);
  }
  return sections;
}

function paragraphsFrom(lines) {
  const blocks = [];
  let buf = [];
  const flush = () => {
    const t = buf.join(" ").replace(/\s+/g, " ").trim();
    if (t) blocks.push(t);
    buf = [];
  };
  for (const line of lines || []) {
    if (!String(line).trim()) {
      flush();
      continue;
    }
    if (isBulletLine(line)) {
      flush();
      const b = stripBullet(line);
      if (b) blocks.push(b);
      continue;
    }
    buf.push(String(line).trim());
  }
  flush();
  return blocks;
}

function parseSkills(lines) {
  const out = [];
  for (const line of lines || []) {
    const t = String(line).trim();
    if (!t) continue;
    const cleaned = stripBullet(t);
    const colon = cleaned.match(/^([^:]{2,40}):\s*(.+)$/);
    if (colon) {
      out.push({ category: colon[1].trim(), items: colon[2].trim() });
      continue;
    }
    const pipe = cleaned.match(/^([^|]{2,40})\|\s*(.+)$/);
    if (pipe) {
      out.push({ category: pipe[1].trim(), items: pipe[2].trim() });
      continue;
    }
    out.push({ category: out.length ? `Skills ${out.length + 1}` : "Skills", items: cleaned });
  }
  // Merge anonymous trailing singles into one row when everything is flat.
  if (out.length > 6 && out.every((r) => /^Skills(\s+\d+)?$/i.test(r.category))) {
    return [{ category: "Skills", items: out.map((r) => r.items).join(", ") }];
  }
  return out.slice(0, 12);
}

function parseEducation(lines) {
  const blocks = paragraphsFrom(lines);
  return blocks.slice(0, 6).map((block) => {
    const year =
      (block.match(/(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present)/i) ||
        block.match(/\b((?:19|20)\d{2})\b/) ||
        [])[0] || "";
    const degreeMatch = block.match(
      /\b((?:B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|Ph\.?D\.?|MBA|Bachelor[^|,–—]*|Master[^|,–—]*|Diploma[^|,–—]*)[^|,–—]*)/i
    );
    const degree = degreeMatch ? degreeMatch[1].trim() : "";
    let school = block;
    if (degree) school = school.replace(degree, " ");
    if (year) school = school.replace(year, " ");
    school = school
      .replace(/\s*[-–—|,·•]+\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return {
      school: (school || block).slice(0, 120),
      degree: degree.slice(0, 120),
      year: String(year).slice(0, 40),
      details: ""
    };
  });
}

function parseCerts(lines) {
  return (lines || [])
    .map((l) => stripBullet(l))
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Split an experience section into role blocks using date lines / blank lines.
 */
function parseExperience(lines) {
  const jobs = [];
  let cur = null;

  const push = () => {
    if (!cur) return;
    if (!cur.company && !cur.title && !(cur.bullets || []).length) return;
    if (!cur.company && cur.title) {
      cur.company = cur.title;
      cur.title = "";
    }
    if (!cur.company) cur.company = "Experience";
    jobs.push(cur);
    cur = null;
  };

  const startJobFromHeader = (trimmed) => {
    const dateMatch = trimmed.match(DATE_RANGE_RE);
    const dates = dateMatch ? dateMatch[0].trim() : "";
    let rest = dates ? trimmed.replace(dateMatch[0], " ").replace(/\s{2,}/g, " ").trim() : trimmed;
    rest = rest.replace(/^[\s|·•,–—-]+|[\s|·•,–—-]+$/g, "").trim();
    const bits = rest
      .split(/\s+[|·•]\s+|\s{2,}|\s+[-–—]\s+/)
      .map((b) => b.trim())
      .filter(Boolean);
    let company = bits[0] || rest || "Experience";
    let title = bits[1] || "";
    let location = bits[2] || "";
    const at = rest.match(/^(.+?)\s+at\s+(.+)$/i);
    if (at) {
      title = at[1].trim();
      company = at[2].trim();
    } else if (
      bits.length >= 2 &&
      /engineer|developer|manager|consultant|analyst|architect|lead|director/i.test(bits[0])
    ) {
      title = bits[0];
      company = bits[1];
      location = bits[2] || "";
    }
    cur = {
      company: company.slice(0, 120),
      title: title.slice(0, 120),
      dates: dates.slice(0, 60),
      location: location.slice(0, 80),
      bullets: []
    };
  };

  for (const raw of lines || []) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;

    if (isBulletLine(trimmed)) {
      if (!cur) cur = { company: "Experience", title: "", dates: "", location: "", bullets: [] };
      const b = stripBullet(trimmed);
      if (b) cur.bullets.push(b);
      continue;
    }

    const dateOnly = trimmed.match(new RegExp(`^${DATE_RANGE_RE.source}$`, "i"));
    const dateMatch = trimmed.match(DATE_RANGE_RE);

    // Date-only line after a role header → attach to current role.
    if (dateOnly && cur && !(cur.bullets || []).length) {
      cur.dates = dateOnly[0].trim().slice(0, 60);
      continue;
    }

    const looksLikeHeader =
      Boolean(dateMatch) ||
      (/[|·•]/.test(trimmed) && trimmed.length < 100) ||
      (/\s[-–—]\s/.test(trimmed) && trimmed.length < 100) ||
      (trimmed.length < 90 && !/[.]$/.test(trimmed) && (!cur || (cur.bullets || []).length > 0));

    if (looksLikeHeader) {
      if (cur && ((cur.bullets || []).length > 0 || cur.company || cur.title)) push();
      startJobFromHeader(trimmed);
      continue;
    }

    if (!cur) cur = { company: "Experience", title: "", dates: "", location: "", bullets: [] };
    cur.bullets.push(trimmed);
  }
  push();

  if (!jobs.length) {
    const bullets = paragraphsFrom(lines).filter((p) => p.length > 8).slice(0, 40);
    if (bullets.length) {
      jobs.push({
        company: "Professional Experience",
        title: "",
        dates: "",
        location: "",
        bullets
      });
    }
  }
  return jobs.slice(0, 12).map((j) => ({
    ...j,
    bullets: (j.bullets || []).slice(0, 16)
  }));
}

function nonEmptyBody(data) {
  if (String(data?.profile || "").trim().length >= 20) return true;
  if (Array.isArray(data?.technicalSummary) && data.technicalSummary.some((x) => String(x || "").trim())) {
    return true;
  }
  if (Array.isArray(data?.skills) && data.skills.some((r) => String(r?.items || "").trim())) return true;
  if (Array.isArray(data?.education) && data.education.some((e) => e?.school || e?.degree)) return true;
  if (Array.isArray(data?.experience) && data.experience.some((j) => (j?.bullets || []).length)) return true;
  return false;
}

/** True when the object is good enough to render a styled PDF from paste. */
export function isStyledExportResume(data) {
  if (!data || typeof data !== "object") return false;
  if (!String(data.name || "").trim()) return false;
  return nonEmptyBody(data);
}

/**
 * Build resume JSON from plain text. Falls back to active person contact when missing.
 * @param {string} text
 * @param {{ person?: object }} [opts]
 */
export function plainTextToResumeData(text, { person = null } = {}) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const extracted = extractProfileFromResumeText(raw);
  const sections = splitSections(raw);

  const preambleLines = sections.preamble || [];
  // Drop contact/name lines already captured in the header from preamble used as profile.
  const preambleBody = preambleLines.filter((line) => {
    const t = line.trim();
    if (!t) return false;
    if (extracted.name && t === extracted.name) return false;
    if (extracted.headline && t === extracted.headline) return false;
    if (extracted.email && t.includes(extracted.email)) return false;
    if (extracted.phone && t.replace(/\D/g, "").length >= 10 && extracted.phone.replace(/\D/g, "").includes(t.replace(/\D/g, "").slice(-10))) {
      return false;
    }
    if (/linkedin\.com/i.test(t)) return false;
    return true;
  });

  const profileParts = [
    ...paragraphsFrom(sections.profile || []),
    ...(!sections.profile?.length ? paragraphsFrom(preambleBody).slice(0, 3) : [])
  ];

  let experience = parseExperience(sections.experience || []);
  if (!experience.length && sections.projects?.length) {
    experience = parseExperience(sections.projects);
  }
  // No EXPERIENCE header: treat leftover preamble (after profile) as experience prose.
  if (!experience.length) {
    const leftover = paragraphsFrom(preambleBody).slice(profileParts.length);
    if (leftover.length >= 2) {
      experience = [
        {
          company: "Professional Experience",
          title: "",
          dates: "",
          location: "",
          bullets: leftover.slice(0, 40)
        }
      ];
    }
  }

  const name =
    extracted.name ||
    String(person?.name || person?.label || "").trim() ||
    "Resume";

  const emailFromText = (raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0] || "";
  const phoneFromText =
    (raw.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/) || [])[0] || "";

  const data = {
    name,
    headline: extracted.headline || String(person?.signatureTitle || "").trim(),
    location: extracted.location || String(person?.location || "").trim(),
    phone: extracted.phone || phoneFromText || String(person?.phone || "").trim(),
    email: extracted.email || emailFromText || String(person?.email || "").trim(),
    linkedin: extracted.linkedin || String(person?.linkedin || "").trim(),
    profile: profileParts.join("\n\n").trim() || paragraphsFrom(preambleBody).slice(0, 2).join("\n\n"),
    technicalSummary: paragraphsFrom(sections.technicalSummary || []).slice(0, 8),
    skills: parseSkills(sections.skills || []),
    experience,
    education: parseEducation(sections.education || []),
    certifications: parseCerts(sections.certifications || [])
  };

  // Last resort: entire text as profile + one role so templates still render.
  if (!nonEmptyBody(data)) {
    const all = paragraphsFrom(linesOf(raw)).filter((p) => p !== name && p !== data.headline);
    data.profile = all.slice(0, 2).join("\n\n");
    data.experience = [
      {
        company: "Professional Experience",
        title: data.headline || "",
        dates: "",
        location: "",
        bullets: all.slice(2, 42)
      }
    ];
  }

  return sanitizeResumeData(data) || data;
}

/**
 * Resolve paste into resume JSON: prefer real JSON, else plain-text conversion.
 */
export function resolvePastedResume(rawText, { person = null } = {}) {
  const raw = String(rawText || "").trim();
  if (!raw) return null;

  // Prefer structured JSON when the paste clearly is JSON.
  if (/^\s*[{[]/.test(raw) || /```(?:json)?/i.test(raw)) {
    const fromJson = extractResumeJson(raw);
    if (isUsableResumeJson(fromJson) || isMinimallySaveableResume(fromJson) || isStyledExportResume(fromJson)) {
      return fromJson;
    }
  }

  const fromText = plainTextToResumeData(raw, { person });
  if (isStyledExportResume(fromText)) return fromText;

  // Soft JSON retry (JSON buried in prose).
  const soft = extractResumeJson(raw);
  if (isStyledExportResume(soft)) return soft;

  return fromText;
}
