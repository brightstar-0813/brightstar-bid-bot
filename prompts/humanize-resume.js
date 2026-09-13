/**
 * Strong humanize appendix for resume generation.
 * Targets ATS with anti-AI / faker detection (esp. Greenhouse-style boards).
 */

import { applySiteFromUrl } from "../ats/adapters.js";
import { normalizeRoleTrackId } from "../role-tracks.js";

export const STRONG_HUMANIZE_MODE_KEY = "strong_humanize_mode";

/** @typedef {"off"|"auto"|"on"} StrongHumanizeMode */

export const STRONG_HUMANIZE_MODES = Object.freeze({
  OFF: "off",
  AUTO: "auto",
  ON: "on"
});

/** Employer ATS boards known for stricter AI/fraud screening on applications. */
export const ANTI_AI_RESUME_SITES = new Set(["greenhouse", "ashby", "lever"]);

const TRACK_HUMAN_ROLE = {
  sf: "Salesforce Developer",
  de: "Data Engineer",
  fs: "Full Stack Developer",
  ai: "AI / ML Engineer"
};

/**
 * User-supplied anti-AI humanize rules (verbatim core).
 * The closing role line is track-aware so DE/FS/AI runs stay coherent.
 */
export function humanizeRulesForTrack(roleTrack = "sf") {
  const role = TRACK_HUMAN_ROLE[normalizeRoleTrackId(roleTrack)] || TRACK_HUMAN_ROLE.sf;
  return `Rewrite my resume so it reads like it was written by a real human with real experience, not AI. AI‑detectors are flagging it as artificial, so you must intentionally break typical AI writing patterns.

Follow these rules:
Vary sentence rhythm and structure.
Use occasional informal phrasing that still fits a professional resume.
Add realistic micro‑stories or context (short, subtle, not long paragraphs).
Use verbs that humans naturally use instead of AI‑favored verbs.
Add specific details about tools, systems, and challenges.
Include realistic numbers, metrics, and outcomes.
Avoid generic corporate clichés and buzzwords.
Avoid symmetrical or overly polished sentences.
Avoid repeating the same verbs at the start of bullets.
Keep the resume ATS‑friendly with clear bullets and keywords.
Make it sound like a real ${role} describing their actual work.
Rewrite the resume using these rules and produce a version that will pass AI‑detection tools like GPTZero, Copyleaks, and Originality.ai.`;
}

export const US_RESUME_STYLE_RULES = `US RESUME STYLE (required for this run):
- Write in standard US senior resume voice: reverse-chronological experience, crisp bullets, City/ST location style.
- Prefer concrete US workplace phrasing over generic global corporate speak.
- Keep bullets scannable for US ATS parsers (Greenhouse / Ashby / Lever friendly).
- No photo, no objective essay, no "References available upon request".
- Do not add clearance, citizenship, visa, or immigration language.`;

export function normalizeStrongHumanizeMode(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (v === "off" || v === "false" || v === "0" || v === "never") {
    return STRONG_HUMANIZE_MODES.OFF;
  }
  if (v === "on" || v === "always" || v === "true" || v === "1" || v === "strong") {
    return STRONG_HUMANIZE_MODES.ON;
  }
  return STRONG_HUMANIZE_MODES.AUTO;
}

export function strongHumanizeModeLabel(mode) {
  const m = normalizeStrongHumanizeMode(mode);
  if (m === STRONG_HUMANIZE_MODES.ON) return "Always";
  if (m === STRONG_HUMANIZE_MODES.OFF) return "Off";
  return "Auto (Greenhouse+)";
}

export function isAntiAiResumeSite(siteOrUrl = "") {
  const raw = String(siteOrUrl || "").trim().toLowerCase();
  if (!raw) return false;
  if (ANTI_AI_RESUME_SITES.has(raw)) return true;
  const site = applySiteFromUrl(raw.includes("://") ? raw : `https://${raw}`);
  return ANTI_AI_RESUME_SITES.has(site);
}

/**
 * @param {StrongHumanizeMode|string} mode
 * @param {{ jdLink?: string, site?: string }} [ctx]
 */
export function shouldApplyStrongHumanize(mode, ctx = {}) {
  const m = normalizeStrongHumanizeMode(mode);
  if (m === STRONG_HUMANIZE_MODES.OFF) return false;
  if (m === STRONG_HUMANIZE_MODES.ON) return true;
  return isAntiAiResumeSite(ctx.site || ctx.jdLink || "");
}

/**
 * Appendix appended after the main track prompt + ATS appendix.
 * Still requires JSON-only output from the base prompt.
 */
export function buildStrongHumanizeAppendix(roleTrack = "sf") {
  const track = normalizeRoleTrackId(roleTrack);
  return `
==================================================
STRONG HUMANIZE + US RESUME VOICE (ANTI-AI / FAKER DETECTORS)
==================================================
This job board screens for AI-generated / fake resumes. Apply the rules below to ALL prose inside the JSON (profile, experience bullets, projects, skills phrasing where natural).

${US_RESUME_STYLE_RULES}

${humanizeRulesForTrack(track)}

CRITICAL OUTPUT CONSTRAINT
Still return ONLY one complete valid resume JSON object matching the schema from the main prompt.
Humanize the wording inside the JSON fields — do not add Markdown, commentary, coverage tables, or detector notes before or after the JSON.
Do not invent employers, titles, dates, degrees, certifications, clearances, or contact details.
`.trim();
}

export async function getStrongHumanizeMode() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return STRONG_HUMANIZE_MODES.AUTO;
  }
  const data = await chrome.storage.local.get(STRONG_HUMANIZE_MODE_KEY);
  return normalizeStrongHumanizeMode(data[STRONG_HUMANIZE_MODE_KEY]);
}

export async function setStrongHumanizeMode(mode) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.set({
    [STRONG_HUMANIZE_MODE_KEY]: normalizeStrongHumanizeMode(mode)
  });
}
