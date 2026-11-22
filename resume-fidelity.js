/**
 * Content-preservation guard for pasted resume text.
 *
 * The text → JSON parser in resume-text.js is heuristic; on an unfamiliar layout it can
 * drop or merge lines. For "template only" export the user's words are the product, so
 * every non-trivial source line must still appear in the structured resume. Lines that do
 * not are kept verbatim, in source order, under `additionalSections`, which every template
 * and the DOCX writer render. Pure functions only (no chrome.*), runnable under node --test.
 */
import { isKnownSectionHeader, isStyledExportResume, resolvePastedResume } from "./resume-text.js";

/** Share of a line's words that must exist in the resume (case/punctuation-insensitive). */
const WORD_COVERAGE_MIN = 0.9;
/** For lines of 4+ words, share of adjacent word pairs that must survive intact. */
const PAIR_COVERAGE_MIN = 0.6;
const PAIR_CHECK_MIN_WORDS = 4;

const DOC_TITLE_RE = /^(r[eé]sum[eé]|curriculum\s+vitae|cv)$/i;

export const ADDITIONAL_TITLE = "Additional Information";

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
}

/** Source line without Markdown scaffolding, bullets, or table pipes. */
export function cleanSourceLine(line) {
  return String(line || "")
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_, label, url) => label || url)
    .replace(/(\*\*|__|`)/g, "")
    .replace(/^[*_]+|[*_]+$/g, "")
    .replace(/^\s*[-–—*•●○▪▸►➤]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTableSeparator(line) {
  const t = String(line || "").trim();
  return /\|/.test(t) && !/[\p{L}\p{N}]/u.test(t);
}

function looksJsonPaste(raw) {
  return /^\s*[{[]/.test(raw) || /```(?:json)?/i.test(raw);
}

/**
 * Meaningful source lines in order, each tagged with its position among non-blank lines
 * so neighbours can be regrouped. Section titles, rules, and "Resume" titles are not content.
 * @returns {Array<{ text: string, raw: string, idx: number }>}
 */
export function sourceContentLines(sourceText) {
  const out = [];
  let idx = -1;
  for (const raw of String(sourceText || "").replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) continue;
    idx += 1;
    if (isTableSeparator(raw) || isKnownSectionHeader(raw, { extras: true })) continue;
    const text = cleanSourceLine(raw);
    if (!tokens(text).length || DOC_TITLE_RE.test(text)) continue;
    out.push({ text, raw: raw.trim(), idx });
  }
  return out;
}

function collectStrings(value, out, depth = 0) {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    out.push(value);
  } else if (typeof value === "number") {
    out.push(String(value));
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
  } else if (typeof value === "object") {
    const direct = [];
    for (const v of Object.values(value)) {
      if (typeof v === "string") direct.push(v);
      collectStrings(v, out, depth + 1);
    }
    // Adjacent fields of one record read as one run ("Category" + "items", "Company" + "Title").
    for (let i = 0; i + 1 < direct.length; i += 1) out.push(`${direct[i]} ${direct[i + 1]}`);
  }
}

/** Word + adjacent-pair index of everything the structured resume will print. */
export function buildResumeIndex(data) {
  const strings = [];
  collectStrings(data, strings);
  const words = new Set();
  const pairs = new Set();
  for (const s of strings) {
    const t = tokens(s);
    for (let i = 0; i < t.length; i += 1) {
      words.add(t[i]);
      if (i + 1 < t.length) pairs.add(`${t[i]} ${t[i + 1]}`);
    }
  }
  return { words, pairs };
}

function lineIsCovered(text, index) {
  const t = tokens(text);
  if (!t.length) return true;
  const present = t.filter((w) => index.words.has(w)).length;
  if (present / t.length < WORD_COVERAGE_MIN) return false;
  if (t.length >= PAIR_CHECK_MIN_WORDS) {
    let hit = 0;
    for (let i = 0; i + 1 < t.length; i += 1) if (index.pairs.has(`${t[i]} ${t[i + 1]}`)) hit += 1;
    if (hit / (t.length - 1) < PAIR_COVERAGE_MIN) return false;
  }
  return true;
}

/** Source lines whose content is not present in the structured resume. */
export function findMissingLines(sourceText, data) {
  const index = buildResumeIndex(data);
  return sourceContentLines(sourceText).filter((line) => !lineIsCovered(line.text, index));
}

function looksLikeHeading(line) {
  const t = line.text;
  if (/[.!?:;,]$/.test(t) || t.split(/\s+/).length > 6 || t.length > 48) return false;
  if (/^#{1,6}\s/.test(line.raw)) return true;
  if (/^(\*\*|__).+(\*\*|__)$/.test(line.raw)) return true;
  const letters = t.replace(/[^\p{L}]/gu, "");
  return letters.length >= 3 && letters === letters.toUpperCase();
}

/** Contiguous runs of missing lines, headed by their own title when the source had one. */
function groupMissing(missing) {
  const runs = [];
  for (const line of missing) {
    const last = runs[runs.length - 1];
    if (last && line.idx === last[last.length - 1].idx + 1) last.push(line);
    else runs.push([line]);
  }

  const titled = [];
  const loose = [];
  for (const run of runs) {
    if (run.length > 1 && looksLikeHeading(run[0])) {
      titled.push({ title: run[0].text, lines: run.slice(1).map((l) => l.text) });
    } else {
      loose.push(...run.map((l) => l.text));
    }
  }
  const sections = [...titled];
  if (loose.length) sections.push({ title: ADDITIONAL_TITLE, lines: loose });
  return sections;
}

/**
 * Keep every source line: whatever the parser lost is appended verbatim.
 * @returns {{ data: object, missing: string[], recovered: number }}
 */
export function recoverMissingContent(sourceText, data) {
  if (!data || typeof data !== "object") return { data, missing: [], recovered: 0 };
  const missing = findMissingLines(sourceText, data);
  if (!missing.length) return { data, missing: [], recovered: 0 };
  const sections = groupMissing(missing);
  return {
    data: {
      ...data,
      additionalSections: [
        ...(Array.isArray(data.additionalSections) ? data.additionalSections : []),
        ...sections
      ]
    },
    missing: missing.map((l) => l.text),
    recovered: sections.reduce((n, s) => n + s.lines.length, 0)
  };
}

/**
 * Paste → resume JSON for template-only export. JSON pastes are trusted as-is;
 * text pastes go through the recovery pass. No profile is consulted.
 * @returns {{ data: object|null, missing: string[], recovered: number }}
 */
export function resolveLosslessResume(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) return { data: null, missing: [], recovered: 0 };
  const data = resolvePastedResume(raw, { person: null, keepExtraSections: true, verbatim: true });
  if (!data || looksJsonPaste(raw) || !isStyledExportResume(data)) {
    return { data, missing: [], recovered: 0 };
  }
  return recoverMissingContent(raw, data);
}
