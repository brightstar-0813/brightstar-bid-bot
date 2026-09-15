/**
 * Convert pasted plain-text / Markdown resumes into the JSON shape templates expect.
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
  { key: "profile", re: /^(profile|summary|professional\s+summary|objective|about(\s+me)?)$/i },
  {
    key: "technicalSummary",
    re: /^(technical\s+summary|highlights|key\s+highlights|accomplishments|achievements)$/i
  },
  {
    key: "skills",
    re: /^(skills|technical\s+skills|core\s+competencies|technologies|tech\s+stack)$/i
  },
  {
    key: "experience",
    re: /^(experience|work\s+experience|professional\s+experience|employment(\s+history)?|work\s+history|career\s+history)$/i
  },
  { key: "education", re: /^(education|academic|academics)$/i },
  { key: "certifications", re: /^(certifications?|licenses?|credentials?)$/i },
  { key: "projects", re: /^(projects?|selected\s+projects)$/i }
];

const DATE_RANGE_RE =
  /(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\s*[-–—to]+\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:(?:19|20)\d{2}|present|current|now)/i;

/** Strip Markdown wrappers so section/role detection sees clean labels. */
function stripMarkdownDecor(line) {
  let t = String(line || "").trim();
  // ATX headings: ## Title / ### Role
  t = t.replace(/^#{1,6}\s+/, "");
  // Bold/italic wrappers around a whole line
  t = t.replace(/^\*\*(.+)\*\*$/, "$1").replace(/^__(.+)__$/, "$1");
  t = t.replace(/^\*(.+)\*$/, "$1").replace(/^_(.+)_$/, "$1");
  // Markdown links: [label](url) → label (or url for mailto/http if label empty)
  t = t.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_, label, url) => {
    const lab = String(label || "").trim();
    const u = String(url || "").trim();
    if (lab) return lab;
    return u.replace(/^mailto:/i, "");
  });
  // Bare markdown emphasis leftovers
  t = t.replace(/\*\*/g, "").replace(/__/g, "");
  return t.trim();
}

function normalizeContactLine(line) {
  return stripMarkdownDecor(line)
    .replace(/\|\s*LinkedIn:\s*/i, " | ")
    .replace(/\s+/g, " ")
    .trim();
}

function linesOf(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""));
}

function compactBlankLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i];
    if (!String(t).trim()) {
      if (out.length && String(out[out.length - 1]).trim()) out.push("");
      continue;
    }
    out.push(t);
  }
  while (out.length && !String(out[out.length - 1]).trim()) out.pop();
  return out;
}

function headerLabel(line) {
  return stripMarkdownDecor(line)
    .replace(/[:：]\s*$/, "")
    .replace(/^\*+|\*+$/g, "")
    .trim();
}

function looksLikeSectionHeader(line) {
  const t = headerLabel(line);
  if (!t || t.length > 64) return false;
  if (/[.?!]$/.test(t)) return false;
  if (t.split(/\s+/).length > 6) return false;
  // Markdown heading markers strongly suggest a section/role title
  const raw = String(line || "").trim();
  if (/^#{1,2}\s+\S/.test(raw) && SECTION_ALIASES.some((s) => s.re.test(t))) return true;
  return SECTION_ALIASES.some((s) => s.re.test(t));
}

function sectionKeyFor(line) {
  const t = headerLabel(line);
  const hit = SECTION_ALIASES.find((s) => s.re.test(t));
  return hit?.key || "";
}

function stripBullet(line) {
  return stripMarkdownDecor(line)
    .replace(/^[-–—*•●○▪▸►➤]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function isBulletLine(line) {
  const t = String(line || "").trim();
  return /^[-–—*•●○▪▸►➤]\s+\S/.test(t) || /^\d+[.)]\s+\S/.test(t);
}

function isMarkdownTableSep(line) {
  const t = String(line || "").trim();
  return /^\|?[\s|:.-]+\|[\s|:.-]+/.test(t) && !/[A-Za-z0-9]/.test(t.replace(/\|/g, ""));
}

function isMarkdownTableRow(line) {
  const t = String(line || "").trim();
  if (!t.includes("|")) return false;
  if (isMarkdownTableSep(t)) return false;
  // Real MD tables almost always start/end with a pipe. Avoid "| location" meta lines.
  if (!/^\|/.test(t) && !/\|$/.test(t)) return false;
  const cells = splitTableCells(t);
  return cells.length >= 2 && cells.some((c) => c.length > 0);
}

function splitTableCells(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => stripMarkdownDecor(c).trim());
}

function splitSections(text) {
  const lines = compactBlankLines(linesOf(text));
  const sections = { preamble: [] };
  let current = "preamble";
  for (const line of lines) {
    if (looksLikeSectionHeader(line)) {
      current = sectionKeyFor(line) || current;
      if (!sections[current]) sections[current] = [];
      continue; // never keep the section title as content
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
    const raw = String(line);
    if (!raw.trim()) {
      flush();
      continue;
    }
    if (isMarkdownTableRow(raw) || isMarkdownTableSep(raw)) {
      flush();
      continue;
    }
    if (isBulletLine(raw)) {
      flush();
      const b = stripBullet(raw);
      if (b) blocks.push(b);
      continue;
    }
    buf.push(stripMarkdownDecor(raw));
  }
  flush();
  return blocks;
}

function parseSkills(lines) {
  const out = [];
  let sawTable = false;
  for (const line of lines || []) {
    const t = String(line).trim();
    if (!t || isMarkdownTableSep(t)) continue;

    if (isMarkdownTableRow(t)) {
      const cells = splitTableCells(t);
      if (cells.length < 2) continue;
      const category = cells[0];
      const items = cells.slice(1).join(", ").replace(/\s+/g, " ").trim();
      // Skip header row
      if (/^category$/i.test(category) || /^technologies?/i.test(items)) continue;
      if (!category && !items) continue;
      sawTable = true;
      out.push({ category: category.slice(0, 80), items: items.slice(0, 500) });
      continue;
    }

    if (sawTable) continue; // ignore trailing noise after a skills table

    const cleaned = stripBullet(t);
    if (!cleaned) continue;
    const colon = cleaned.match(/^([^:]{2,48}):\s*(.+)$/);
    if (colon) {
      out.push({ category: colon[1].trim(), items: colon[2].trim() });
      continue;
    }
    const pipe = cleaned.match(/^([^|]{2,48})\|\s*(.+)$/);
    if (pipe) {
      out.push({ category: pipe[1].trim(), items: pipe[2].trim() });
      continue;
    }
    out.push({ category: out.length ? `Skills ${out.length + 1}` : "Skills", items: cleaned });
  }

  if (out.length > 8 && out.every((r) => /^Skills(\s+\d+)?$/i.test(r.category))) {
    return [{ category: "Skills", items: out.map((r) => r.items).join(", ") }];
  }
  return out.slice(0, 16);
}

function parseEducation(lines) {
  const cleaned = (lines || [])
    .map((l) => stripMarkdownDecor(l))
    .filter((l) => l.trim());
  if (!cleaned.length) return [];

  // Group into blocks separated by blank lines from original.
  const blocks = [];
  let buf = [];
  for (const line of lines || []) {
    if (!String(line).trim()) {
      if (buf.length) {
        blocks.push(buf);
        buf = [];
      }
      continue;
    }
    buf.push(stripMarkdownDecor(line));
  }
  if (buf.length) blocks.push(buf);

  return blocks.slice(0, 6).map((parts) => {
    const joined = parts.join(" | ");
    const year =
      (joined.match(/(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\s*[-–—]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:(?:19|20)\d{2}|present)/i) ||
        joined.match(/\b((?:19|20)\d{2})\b/) ||
        [])[0] || "";
    const degree =
      parts.find((p) =>
        /\b(b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?a\.?|ph\.?d\.?|mba|bachelor|master|diploma)\b/i.test(p)
      ) || "";
    const school =
      parts.find((p) => /university|college|school|institute|academy/i.test(p)) ||
      parts[0] ||
      "";
    const details =
      parts.find(
        (p) =>
          p !== school &&
          p !== degree &&
          p !== year &&
          /,\s*[A-Z]{2}\b|united states|usa|michigan|california|texas|illinois/i.test(p)
      ) || "";
    return {
      school: String(school).slice(0, 120),
      degree: String(degree).slice(0, 120),
      year: String(year).slice(0, 40),
      details: String(details).slice(0, 80)
    };
  });
}

function parseCerts(lines) {
  const out = [];
  let buf = [];
  const flush = () => {
    const label = buf
      .map((l) => stripMarkdownDecor(l))
      .filter(Boolean)
      .join(" — ")
      .replace(/\s+/g, " ")
      .trim();
    // Skip fluff LinkedIn micro-certs when a real Salesforce cert list is present
    if (label) out.push(label);
    buf = [];
  };
  for (const line of lines || []) {
    if (!String(line).trim()) {
      flush();
      continue;
    }
    if (isBulletLine(line) && buf.length) flush();
    buf.push(line);
  }
  flush();

  const filtered = out.filter((c) => {
    // Prefer real credentials; drop long soft-skill LinkedIn course titles when many exist
    if (/salesforce\s+certified/i.test(c)) return true;
    if (/linkedin/i.test(c) && out.some((x) => /salesforce\s+certified/i.test(x))) return false;
    return c.length <= 120;
  });
  return (filtered.length ? filtered : out).slice(0, 16);
}

function looksLikeRoleHeader(line) {
  const raw = String(line || "").trim();
  if (!raw || isBulletLine(raw) || isMarkdownTableRow(raw)) return false;
  // ### Company — Title  or  Company — Title
  if (/^#{1,3}\s+\S/.test(raw)) return true;
  const t = stripMarkdownDecor(raw);
  if (t.length > 140 || /[.]$/.test(t)) return false;
  if (DATE_RANGE_RE.test(t) && t.length < 120) return true;
  if (/\s[-–—]\s/.test(t) && t.length < 120) return true;
  if (/[|·•]/.test(t) && t.length < 100) return true;
  return false;
}

/**
 * Split an experience section into role blocks using markdown/role headers + date lines.
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

  const startJobFromHeader = (rawLine) => {
    const trimmed = stripMarkdownDecor(rawLine);
    const dateMatch = trimmed.match(DATE_RANGE_RE);
    const dates = dateMatch ? dateMatch[0].trim() : "";
    let rest = dates ? trimmed.replace(dateMatch[0], " ").replace(/\s{2,}/g, " ").trim() : trimmed;
    rest = rest.replace(/^[\s|·•,–—-]+|[\s|·•,–—-]+$/g, "").trim();

    // Prefer "Company — Title"
    const em = rest.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    let company = "";
    let title = "";
    let location = "";
    if (em) {
      company = em[1].trim();
      title = em[2].trim();
    } else {
      const bits = rest
        .split(/\s+[|·•]\s+|\s{2,}/)
        .map((b) => b.trim())
        .filter(Boolean);
      company = bits[0] || rest || "Experience";
      title = bits[1] || "";
      location = bits[2] || "";
      const at = rest.match(/^(.+?)\s+at\s+(.+)$/i);
      if (at) {
        title = at[1].trim();
        company = at[2].trim();
      } else if (
        bits.length >= 2 &&
        /engineer|developer|manager|consultant|analyst|architect|lead|director|intern/i.test(bits[0])
      ) {
        title = bits[0];
        company = bits[1];
        location = bits[2] || "";
      }
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
    if (isMarkdownTableRow(trimmed) || isMarkdownTableSep(trimmed)) continue;

    if (isBulletLine(trimmed)) {
      if (!cur) cur = { company: "Experience", title: "", dates: "", location: "", bullets: [] };
      const b = stripBullet(trimmed);
      if (b) cur.bullets.push(b);
      continue;
    }

    const plain = stripMarkdownDecor(trimmed);
    // Date / location meta line under a role header (with optional "| location | work mode").
    const datePrefix = plain.match(DATE_RANGE_RE);
    const looksLikeDateMeta =
      Boolean(datePrefix) &&
      plain.length < 120 &&
      (new RegExp(`^${DATE_RANGE_RE.source}\\s*$`, "i").test(plain) ||
        new RegExp(`^${DATE_RANGE_RE.source}\\s*[|·•,]`, "i").test(plain));

    if (looksLikeDateMeta && cur && !(cur.bullets || []).length) {
      cur.dates = datePrefix[0].trim().slice(0, 60);
      const rest = plain
        .replace(datePrefix[0], "")
        .replace(/^[\s|·•,]+/, "")
        .trim();
      if (rest && !cur.location) cur.location = rest.slice(0, 80);
      continue;
    }

    if (looksLikeRoleHeader(trimmed) && !looksLikeDateMeta) {
      if (cur && ((cur.bullets || []).length > 0 || cur.company || cur.title)) push();
      startJobFromHeader(trimmed);
      continue;
    }

    if (!cur) cur = { company: "Experience", title: "", dates: "", location: "", bullets: [] };
    cur.bullets.push(plain);
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
 * Build resume JSON from plain text / Markdown. Falls back to active person contact when missing.
 * @param {string} text
 * @param {{ person?: object }} [opts]
 */
export function plainTextToResumeData(text, { person = null } = {}) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  // Normalize contact markdown before profile extraction.
  const rawForExtract = raw.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  const extracted = extractProfileFromResumeText(rawForExtract);
  const sections = splitSections(raw);

  const preambleLines = (sections.preamble || []).map(normalizeContactLine);
  const preambleBody = preambleLines.filter((line) => {
    const t = line.trim();
    if (!t) return false;
    if (extracted.name && t === extracted.name) return false;
    if (extracted.headline && t === extracted.headline) return false;
    if (/@/.test(t) || /linkedin\.com/i.test(t)) return false;
    if (/\+?\d[\d\s().-]{8,}\d/.test(t) && t.length < 80) return false;
    if (/united states|\b[A-Z]{2}\b/.test(t) && t.length < 60 && /\|/.test(t)) return false;
    return true;
  });

  const profileParts = paragraphsFrom(sections.profile || []);
  // Only use preamble prose as profile when no Summary section exists.
  if (!profileParts.length && preambleBody.length) {
    profileParts.push(...paragraphsFrom(preambleBody).slice(0, 2));
  }

  let experience = parseExperience(sections.experience || []);
  if (!experience.length && sections.projects?.length) {
    experience = parseExperience(sections.projects);
  }

  const name =
    extracted.name ||
    String(person?.name || person?.label || "").trim() ||
    "Resume";

  const emailFromText = (rawForExtract.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0] || "";
  const phoneFromText =
    (rawForExtract.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/) || [])[0] || "";
  const linkedinFromText =
    (raw.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_/%-]+/i) || [])[0] || "";

  const data = {
    name,
    headline: extracted.headline || String(person?.signatureTitle || "").trim(),
    location: extracted.location || String(person?.location || "").trim(),
    phone: extracted.phone || phoneFromText || String(person?.phone || "").trim(),
    email: extracted.email || emailFromText || String(person?.email || "").trim(),
    linkedin: extracted.linkedin || linkedinFromText || String(person?.linkedin || "").trim(),
    profile: profileParts.join("\n\n").trim(),
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
 * Resolve paste into resume JSON: prefer real JSON, else plain-text / Markdown conversion.
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

  const soft = extractResumeJson(raw);
  if (isStyledExportResume(soft)) return soft;

  return fromText;
}
