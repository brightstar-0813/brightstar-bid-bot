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

function splitTsvCells(line) {
  const raw = String(line || "");
  if (/\t/.test(raw)) {
    return raw
      .split(/\t+/)
      .map((c) => stripMarkdownDecor(c).trim())
      .filter(Boolean);
  }
  // Two-or-more spaces as a soft column break (Word/Docs paste).
  const spaced = raw.match(/^(.{2,60}?)\s{2,}(.+)$/);
  if (spaced) {
    return [stripMarkdownDecor(spaced[1]).trim(), stripMarkdownDecor(spaced[2]).trim()].filter(Boolean);
  }
  return [];
}

function isSkillsHeaderRow(category, items) {
  return (
    /^category$/i.test(category) ||
    (/^technologies?/i.test(category) && /skills?/i.test(items)) ||
    (/^category$/i.test(category) && /technologies?|skills?/i.test(items)) ||
    (/^technologies?\s*\/?\s*skills?$/i.test(items) && /^category$/i.test(category))
  );
}

const MAX_SKILL_ITEMS_LEN = 4000;
const MAX_SKILL_CATEGORY_LEN = 96;

function parseSkills(lines) {
  const out = [];
  let sawStructured = false;

  const pushSkillRow = (category, items) => {
    const cat = String(category || "").trim().slice(0, MAX_SKILL_CATEGORY_LEN);
    const rowItems = String(items || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_SKILL_ITEMS_LEN);
    if (!cat && !rowItems) return;
    if (isSkillsHeaderRow(cat, rowItems)) return;
    sawStructured = true;
    out.push({ category: cat || "Skills", items: rowItems });
  };

  for (const line of lines || []) {
    const t = String(line).trim();
    if (!t || isMarkdownTableSep(t)) continue;

    if (isMarkdownTableRow(t)) {
      const cells = splitTableCells(t);
      if (cells.length < 2) continue;
      pushSkillRow(cells[0], cells.slice(1).join(", "));
      continue;
    }

    const tsv = splitTsvCells(t);
    if (tsv.length >= 2) {
      const category = tsv[0];
      const items = tsv.slice(1).join(", ");
      // Reject rows where "category" looks like a duty sentence.
      if (category.length > 72 || /[.]$/.test(category)) {
        // fall through
      } else {
        pushSkillRow(category, items);
        continue;
      }
    }

    const cleaned = stripBullet(t);
    if (!cleaned) continue;
    const colon = cleaned.match(/^([^:]{2,72}):\s*(.+)$/);
    if (colon) {
      pushSkillRow(colon[1].trim(), colon[2].trim());
      continue;
    }
    const pipe = cleaned.match(/^([^|]{2,72})\|\s*(.+)$/);
    if (pipe) {
      pushSkillRow(pipe[1].trim(), pipe[2].trim());
      continue;
    }

    if (sawStructured) continue;

    // Single-line leftovers: keep as one generic row only when nothing structured yet.
    out.push({ category: "Skills", items: cleaned.slice(0, MAX_SKILL_ITEMS_LEN) });
  }

  // Merge only anonymous single-line leftovers — never collapse real category rows.
  if (out.length > 1 && out.every((r) => /^Skills$/i.test(r.category))) {
    return [{ category: "Skills", items: out.map((r) => r.items).join(", ") }];
  }
  return out.filter((r) => r.category || r.items);
}

const EDU_LOCATION_RE =
  /,\s*[A-Z]{2}\b|united states|\busa\b|brazil|philippines|hong kong|michigan|california|texas|illinois|pernambuco|recife|colorado|new york|cavite/i;
const EDU_PLACE_LINE_RE = /^[A-Z][A-Za-z .'-]+(?:,\s*[A-Z][A-Za-z .'-]+)+$/;
const EDU_YEAR_RANGE_RE =
  /(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\s*[-–—]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:(?:19|20)\d{2}|present)/i;

function isSchoolLine(p) {
  return /university|college|school|institute|academy/i.test(p);
}

function isDegreeLine(p) {
  const t = String(p || "").trim();
  if (!t) return false;
  // "Cambridge, MA" / "Jackson, MS" are city-state lines, not M.A. / M.S. degrees.
  if (/,\s*[A-Z]{2}\b/.test(t) && !/\b(bachelor|master|diploma|mba|ph\.?d\.?)\b/i.test(t)) return false;
  return /\b(b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?a\.?|ph\.?d\.?|mba|bachelor|master|diploma)\b/i.test(t);
}

function isEduCityLine(p) {
  const t = String(p || "").trim();
  if (!t || isSchoolLine(t) || isDegreeLine(t)) return false;
  return EDU_LOCATION_RE.test(t) || (EDU_PLACE_LINE_RE.test(t) && t.length < 60);
}

function isEduDateLine(p) {
  const t = String(p || "").trim();
  if (!t) return false;
  return DATE_RANGE_RE.test(t) || EDU_YEAR_RANGE_RE.test(t) || /^(?:19|20)\d{2}$/.test(t);
}

function parseEducation(lines) {
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
  if (!blocks.length) return [];

  // Merge split school / degree blocks separated by blank lines.
  const merged = [];
  for (let i = 0; i < blocks.length; i++) {
    const cur = blocks[i];
    const next = blocks[i + 1];
    const schoolOnly = cur.length === 1 && isSchoolLine(cur[0]) && !isDegreeLine(cur[0]);
    const degreeOnly = cur.length >= 1 && isDegreeLine(cur[0]) && !cur.some(isSchoolLine);
    if (schoolOnly && next) {
      merged.push([cur[0], ...next]);
      i++;
      continue;
    }
    if (degreeOnly && next && next.some(isSchoolLine)) {
      merged.push([...cur, ...next]);
      i++;
      continue;
    }
    merged.push(cur);
  }

  // Word/PDF pastes often blank-line school, city, and dates into separate blocks.
  // Fold location/date-only leftovers into the preceding school/degree entry.
  const folded = [];
  for (const cur of merged) {
    const hasIdentity = cur.some((p) => isSchoolLine(p) || isDegreeLine(p));
    const metaOnly = cur.length > 0 && !hasIdentity && cur.every((p) => isEduCityLine(p) || isEduDateLine(p));
    if (metaOnly && folded.length) {
      folded[folded.length - 1].push(...cur);
      continue;
    }
    folded.push([...cur]);
  }

  return folded
    .map((parts) => {
      const joined = parts.join(" | ");
      const year = (joined.match(EDU_YEAR_RANGE_RE) || joined.match(/\b((?:19|20)\d{2})\b/) || [])[0] || "";
      const degree = parts.find((p) => isDegreeLine(p)) || "";
      let school =
        parts.find((p) => isSchoolLine(p) && p !== degree) ||
        // Degree-first blocks: school is usually the next non-degree, non-date, non-city line
        parts.find(
          (p) =>
            p !== degree &&
            p !== year &&
            !isEduDateLine(p) &&
            !isEduCityLine(p) &&
            !/^(remote|hybrid|on-?site)$/i.test(p) &&
            p.length < 80 &&
            !/[.]$/.test(p) &&
            !/\b(bachelor|master|diploma|computer science|honou?rs?|upper division|lower division)\b/i.test(p)
        ) ||
        "";
      // Never mirror the degree into school (causes duplicate bold/regular lines on PDF).
      if (school && degree && school.toLowerCase() === degree.toLowerCase()) school = "";
      if (
        !school &&
        parts[0] &&
        parts[0] !== degree &&
        !isEduDateLine(parts[0]) &&
        !isEduCityLine(parts[0]) &&
        !isDegreeLine(parts[0])
      ) {
        school = parts[0];
      }
      const honours =
        parts.find(
          (p) =>
            p !== school &&
            p !== degree &&
            p !== year &&
            /\b(honou?rs?|cum laude|distinction|upper division|lower division)\b/i.test(p)
        ) || "";
      const details =
        parts.find(
          (p) => p !== school && p !== degree && p !== year && p !== honours && isEduCityLine(p)
        ) ||
        honours ||
        "";
      return {
        school: String(school).slice(0, 120),
        degree: String(degree).slice(0, 120),
        year: String(year).slice(0, 40),
        details: String(details).slice(0, 80)
      };
    })
    .filter((edu) => edu.school || edu.degree);
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
    if (/salesforce\s+certified/i.test(c)) return true;
    if (/linkedin/i.test(c) && out.some((x) => /salesforce\s+certified/i.test(x))) return false;
    return c.length <= 120;
  });
  return filtered.length ? filtered : out;
}

const TITLE_WORD_RE =
  /\b(engineer|developer|architect|specialist|administrator|consultant|manager|analyst|lead|director|intern|principal|staff|owner)\b/i;

function looksLikeJobTitle(line) {
  const t = stripMarkdownDecor(line);
  if (!t || t.length > 120 || t.length < 4) return false;
  if (DATE_RANGE_RE.test(t)) return false;
  if (/[.]$/.test(t) && t.length > 40) return false;
  if (isCorporateSuffixLine(t)) return false;
  // Require a role keyword — bare company names like "Intrado" must not count as titles.
  if (!TITLE_WORD_RE.test(t)) return false;
  const words = t.split(/\s+/);
  return words.length <= 14;
}

function isCorporateSuffixLine(line) {
  const t = stripMarkdownDecor(line);
  return /\b(inc|llc|corp|corporation|ltd|limited|co|company|plc|gmbh|s\.?a\.?)\.?\s*$/i.test(t);
}

function looksLikeCompanyLine(line) {
  const t = stripMarkdownDecor(line);
  if (!t || t.length > 80 || t.length < 2) return false;
  if (DATE_RANGE_RE.test(t)) return false;
  if (looksLikeJobTitle(t)) return false;
  // Allow "Smart Park Inc." / "Intrado Life & Safety Inc." — reject other sentence-ending periods.
  if (/[.]$/.test(t) && !isCorporateSuffixLine(t)) return false;
  if (/^(remote|hybrid|on-?site)$/i.test(t)) return false;
  if (isLocationLine(t)) return false;
  return t.split(/\s+/).length <= 10;
}

const GEO_LOCATION_ANCHOR_RE =
  /\b(remote|hybrid|on-?site|usa|u\.?s\.?a\.?|united states|united kingdom|brazil|canada|india|germany|australia|philippines|hong kong|pennsylvania|colorado|cavite|california|texas|illinois|pernambuco|recife|new york|longmont|philadelphia|imus|sheung wan)\b/i;

function isLocationLine(line) {
  const t = stripMarkdownDecor(line);
  if (!t || t.length > 100) return false;
  if (DATE_RANGE_RE.test(t) && !/\|/.test(t)) return false;
  if (/^(remote|hybrid|on-?site)$/i.test(t)) return true;
  if (/\b(remote|hybrid|on-?site)\b/i.test(t) && (/\|/.test(t) || /,/.test(t))) return true;
  if (GEO_LOCATION_ANCHOR_RE.test(t) && t.length < 90) return true;
  // City, State / City, Country — require a geographic anchor so project phrases are not locations.
  if (
    /^[A-Za-z .'-]+,\s*[A-Za-z .'-]+/.test(t) &&
    t.length < 80 &&
    !TITLE_WORD_RE.test(t) &&
    GEO_LOCATION_ANCHOR_RE.test(t)
  ) {
    return true;
  }
  return false;
}

function looksLikeProjectLine(line) {
  const t = stripMarkdownDecor(line);
  if (!t || t.length > 90 || t.length < 8) return false;
  if (DATE_RANGE_RE.test(t) || isLocationLine(t) || TITLE_WORD_RE.test(t)) return false;
  if (/[.]$/.test(t)) return false;
  if (t.split(/\s+/).length > 12) return false;
  // Title Case / Capitalized phrase
  return /^[A-Z]/.test(t) && !/^(and|the|with|for)\b/i.test(t);
}

function looksLikeDateMetaLine(line) {
  const plain = stripMarkdownDecor(line);
  const datePrefix = plain.match(DATE_RANGE_RE);
  if (!datePrefix || plain.length > 120) return false;
  return (
    new RegExp(`^${DATE_RANGE_RE.source}\\s*$`, "i").test(plain) ||
    new RegExp(`^${DATE_RANGE_RE.source}\\s*[|·•,]`, "i").test(plain) ||
    new RegExp(`^${DATE_RANGE_RE.source}$`, "i").test(plain)
  );
}

function looksLikeCombinedRoleHeader(line) {
  const raw = String(line || "").trim();
  if (!raw || isBulletLine(raw) || isMarkdownTableRow(raw)) return false;
  if (/^#{1,3}\s+\S/.test(raw)) return true;
  const t = stripMarkdownDecor(raw);
  if (t.length > 140 || /[.!?]$/.test(t)) return false;
  if (/\s[-–—]\s/.test(t) && t.length < 120) return true;
  if (/[|·•]/.test(t) && TITLE_WORD_RE.test(t) && t.length < 100) return true;
  return false;
}

function collectingDuties(job) {
  return Boolean(job && (job.bullets || []).length > 0);
}

function isDutyProse(line) {
  const t = stripMarkdownDecor(line);
  if (!t || t.length < 50) return false;
  if (isBulletLine(line)) return true;
  if (/[.!?]$/.test(t) && t.split(/\s+/).length >= 8) return true;
  return false;
}

function isContinuationLine(line, prevBullet) {
  const t = stripMarkdownDecor(line);
  if (!t || !prevBullet) return false;
  if (
    looksLikeCompanyLine(t) ||
    looksLikeJobTitle(t) ||
    looksLikeDateMetaLine(t) ||
    isLocationLine(t) ||
    looksLikeProjectLine(t)
  ) {
    return false;
  }
  if (/^[a-z('"(\[]/.test(t)) return true;
  if (t.length < 48 && !/[.!?]$/.test(t)) return true;
  return false;
}

function emptyJob() {
  return { company: "", title: "", dates: "", location: "", project: "", bullets: [] };
}

/**
 * Split an experience section into role blocks.
 * Supports stacked plain text (Company / Title / Dates / Location / Project / prose)
 * and Markdown `### Company — Title` headers.
 */
function parseExperience(lines) {
  const jobs = [];
  let cur = null;

  const push = () => {
    if (!cur) return;
    if (!cur.company && !cur.title && !(cur.bullets || []).length) {
      cur = null;
      return;
    }
    if (!cur.company && cur.title) {
      cur.company = cur.title;
      cur.title = "";
    }
    if (!cur.company) cur.company = "Experience";
    // Strip metadata that accidentally landed in bullets; recover into fields when empty
    const kept = [];
    for (const b of cur.bullets || []) {
      const t = String(b || "").trim();
      if (!t) continue;
      if (t === cur.company || t === cur.title || t === cur.dates || t === cur.location || t === cur.project) {
        continue;
      }
      if (!cur.dates && looksLikeDateMetaLine(t)) {
        const datePrefix = t.match(DATE_RANGE_RE);
        if (datePrefix) cur.dates = datePrefix[0].trim().slice(0, 60);
        continue;
      }
      if (!cur.location && isLocationLine(t)) {
        cur.location = t.slice(0, 80);
        continue;
      }
      if (!cur.company && looksLikeCompanyLine(t)) {
        cur.company = t.slice(0, 120);
        continue;
      }
      if (!cur.title && looksLikeJobTitle(t)) {
        cur.title = t.slice(0, 120);
        continue;
      }
      if (!cur.project && looksLikeProjectLine(t) && kept.length === 0) {
        cur.project = t.slice(0, 120);
        continue;
      }
      if (looksLikeDateMetaLine(t) || isLocationLine(t)) continue;
      kept.push(t);
    }
    cur.bullets = kept;
    jobs.push(cur);
    cur = null;
  };

  const ensureJob = () => {
    if (!cur) cur = emptyJob();
    return cur;
  };

  const roleCompleteEnoughToClose = (job) =>
    Boolean(job && (job.bullets || []).length > 0 && (job.company || job.title));

  const startFromCombinedHeader = (rawLine) => {
    const trimmed = stripMarkdownDecor(rawLine);
    const dateMatch = trimmed.match(DATE_RANGE_RE);
    const dates = dateMatch ? dateMatch[0].trim() : "";
    let rest = dates ? trimmed.replace(dateMatch[0], " ").replace(/\s{2,}/g, " ").trim() : trimmed;
    rest = rest.replace(/^[\s|·•,–—-]+|[\s|·•,–—-]+$/g, "").trim();

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
      } else if (bits.length >= 2 && TITLE_WORD_RE.test(bits[0])) {
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
      project: "",
      bullets: []
    };
  };

  for (const raw of lines || []) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    if (isMarkdownTableRow(trimmed) || isMarkdownTableSep(trimmed)) continue;

    if (isBulletLine(trimmed)) {
      const b = stripBullet(trimmed);
      if (!b) continue;
      ensureJob().bullets.push(b);
      continue;
    }

    const plain = stripMarkdownDecor(trimmed);

    if (cur && collectingDuties(cur) && isContinuationLine(plain, cur.bullets[cur.bullets.length - 1])) {
      cur.bullets[cur.bullets.length - 1] = `${cur.bullets[cur.bullets.length - 1]} ${plain}`.replace(
        /\s+/g,
        " "
      );
      continue;
    }

    // Combined Markdown / "Company — Title" header
    if (
      looksLikeCombinedRoleHeader(trimmed) &&
      !looksLikeDateMetaLine(trimmed) &&
      !(collectingDuties(cur) && isDutyProse(trimmed))
    ) {
      if (cur && (cur.company || cur.title || (cur.bullets || []).length)) push();
      startFromCombinedHeader(trimmed);
      continue;
    }

    // Dates
    if (looksLikeDateMetaLine(trimmed) && !(collectingDuties(cur) && isDutyProse(trimmed))) {
      const job = ensureJob();
      if (!(job.bullets || []).length || !job.dates) {
        const datePrefix = plain.match(DATE_RANGE_RE);
        job.dates = datePrefix[0].trim().slice(0, 80);
        const rest = plain
          .replace(datePrefix[0], "")
          .replace(/^[\s|·•,]+/, "")
          .trim();
        if (rest && !job.location) job.location = rest.slice(0, 120);
        continue;
      }
    }

    // Location (before duties)
    if (isLocationLine(plain) && cur && !(cur.bullets || []).length) {
      const loc = plain.slice(0, 120);
      if (!cur.location) cur.location = loc;
      else if (!cur.location.includes(plain) && /^(remote|hybrid|on-?site)$/i.test(plain)) {
        cur.location = `${cur.location} | ${plain}`.slice(0, 120);
      }
      continue;
    }

    // Title fills open job missing title
    if (looksLikeJobTitle(plain) && cur && cur.company && !cur.title && !(cur.bullets || []).length) {
      cur.title = plain.slice(0, 160);
      continue;
    }

    // Project line before duties
    if (
      looksLikeProjectLine(plain) &&
      cur &&
      (cur.company || cur.title) &&
      !cur.project &&
      !(cur.bullets || []).length &&
      (cur.dates || cur.location || cur.title)
    ) {
      cur.project = plain.slice(0, 160);
      continue;
    }

    // New company line — close previous role when it already has duties or a full header
    if (looksLikeCompanyLine(plain) && !looksLikeJobTitle(plain)) {
      if (roleCompleteEnoughToClose(cur) || (cur && cur.company && cur.title && cur.dates)) {
        push();
      }
      if (cur && cur.company && !cur.title && !(cur.bullets || []).length && !cur.dates) {
        // Replace incomplete company-only stub
        cur.company = plain.slice(0, 120);
      } else if (!cur) {
        cur = emptyJob();
        cur.company = plain.slice(0, 120);
      } else if (cur.company && !cur.title && looksLikeJobTitle(plain)) {
        cur.title = plain.slice(0, 120);
      } else if (!cur.company) {
        cur.company = plain.slice(0, 120);
      } else if ((cur.bullets || []).length || cur.dates) {
        push();
        cur = emptyJob();
        cur.company = plain.slice(0, 120);
      } else {
        // Open job with company only — if this looks like another company, replace
        cur.company = plain.slice(0, 120);
      }
      continue;
    }

    // Title without company yet (rare) or title after company handled above
    if (looksLikeJobTitle(plain) && !(cur && cur.bullets && cur.bullets.length)) {
      const job = ensureJob();
      if (!job.title) {
        job.title = plain.slice(0, 120);
        continue;
      }
      if (job.title && job.company && (job.dates || job.location)) {
        // Title for a new role
        push();
        cur = emptyJob();
        cur.title = plain.slice(0, 120);
        continue;
      }
    }

    // Duty / prose
    ensureJob().bullets.push(plain);
  }
  push();

  if (!jobs.length) {
    const bullets = paragraphsFrom(lines).filter((p) => p.length > 8);
    if (bullets.length) {
      jobs.push({
        company: "Professional Experience",
        title: "",
        dates: "",
        location: "",
        project: "",
        bullets
      });
    }
  }

  return jobs.map((j) => ({
    company: j.company || "",
    title: j.title || "",
    dates: j.dates || "",
    location: j.location || "",
    project: j.project || "",
    bullets: (j.bullets || []).filter(Boolean)
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
    technicalSummary: paragraphsFrom(sections.technicalSummary || []),
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
