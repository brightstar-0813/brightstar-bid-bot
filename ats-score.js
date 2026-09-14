import { getRoleTrack, jdRequiredSkills, normalizeRoleTrackId } from "./role-tracks.js";
import { SF_ENTERPRISE_PROJECT_BANK } from "./prompts/sf-enterprise-projects.js";
import { stripClearanceFromTitle } from "./resume-json.js";

const STOP_WORDS = new Set(
  [
    "about", "after", "also", "and", "any", "are", "based", "been", "being", "but",
    "can", "company", "day", "for", "from", "have", "into", "job", "more", "must",
    "our", "role", "should", "team", "that", "the", "their", "them", "they", "this",
    "through", "using", "will", "with", "work", "you", "your", "years", "year",
    "preferred", "required", "requirements", "responsibilities", "including", "strong"
  ]
);

/** Local ATS badge target — builds re-prompt / boost until this is cleared. */
export const ATS_TARGET_SCORE = 90;

/**
 * Skills-table categories that must never appear on a resume PDF.
 * ATS boost used to dump raw JD tokens into a "JD Keywords" row — that is forbidden.
 */
export function isKeywordDumpSkillsCategory(category) {
  const c = String(category || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!c) return false;
  if (/^(jd\s*)?keywords?$/.test(c)) return true;
  if (/^ats\s*keywords?$/.test(c)) return true;
  if (/^keyword\s*(dump|list|bank|match|coverage)?$/.test(c)) return true;
  if (/jd\s*keyword/.test(c)) return true;
  return false;
}

/** Drop keyword-dump skill rows; keep real skill categories only. */
export function stripKeywordDumpSkills(resumeData) {
  if (!resumeData || typeof resumeData !== "object") return resumeData;
  const skills = Array.isArray(resumeData.skills) ? resumeData.skills : null;
  if (!skills) return resumeData;
  const next = skills
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      category: String(r.category || "").trim(),
      items: String(r.items || "").trim()
    }))
    .filter((r) => r.category && r.items && !isKeywordDumpSkillsCategory(r.category));
  return { ...resumeData, skills: next };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectStrings(value, out = []) {
  if (value == null) return out;
  if (typeof value === "string" || typeof value === "number") {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out));
    return out;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, out));
  }
  return out;
}

function keywordFrequency(text) {
  const counts = new Map();
  for (const token of normalizeText(text).split(" ")) {
    if (
      token.length < 3 ||
      STOP_WORDS.has(token) ||
      /^\d+$/.test(token) ||
      /^(?:http|www|com)$/.test(token)
    ) {
      continue;
    }
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}

function topKeywords(text, limit = 35) {
  return [...keywordFrequency(text).entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

function coverage(words, haystack) {
  if (!words.length) return { ratio: 1, matched: [], missing: [] };
  const normalized = ` ${normalizeText(haystack)} `;
  const matched = words.filter((word) => normalized.includes(` ${word} `));
  return {
    ratio: matched.length / words.length,
    matched,
    missing: words.filter((word) => !matched.includes(word))
  };
}

function round(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function cloneResume(data) {
  if (!data || typeof data !== "object") return data;
  return JSON.parse(JSON.stringify(data));
}

/**
 * Deterministic cleanup only: strip forbidden keyword-dump skill rows and
 * clearance notes from the headline. Never paste the JD job title into headline —
 * ATS title coverage comes from AI-chosen resume identities + profile/bullets.
 */
export function boostResumeForAts(resumeData, { jdText = "", jobTitle = "", roleTrack = "sf" } = {}) {
  if (!resumeData || typeof resumeData !== "object") {
    return {
      data: resumeData,
      evaluation: evaluateAtsScore(resumeData, { jdText, jobTitle, roleTrack }),
      changed: false
    };
  }

  const cleaned = stripKeywordDumpSkills(cloneResume(resumeData));
  let changed =
    JSON.stringify(cleaned?.skills || []) !== JSON.stringify(resumeData?.skills || []);

  const headline = stripClearanceFromTitle(String(cleaned.headline || "").trim());
  if (headline !== String(cleaned.headline || "").trim()) {
    cleaned.headline = headline;
    changed = true;
  }

  const evaluation = evaluateAtsScore(cleaned, { jdText, jobTitle, roleTrack });
  return { data: cleaned, evaluation, changed };
}

/**
 * Pick the strongest SF project-bank blueprints for this JD / missing products.
 * Used by the ATS re-prompt so the model rewrites experience as real projects —
 * never as a keyword dump section.
 */
export function selectProjectBankExcerpts({
  jdText = "",
  missingProducts = [],
  bank = "",
  maxProjects = 4,
  maxChars = 9000
} = {}) {
  const text = String(bank || "").trim();
  if (!text) return "";
  const chunks = text
    .split(/(?=^\d+\.\s+)/m)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!chunks.length) return text.slice(0, maxChars);

  const needles = [
    ...missingProducts.map((p) => String(p || "").toLowerCase().trim()),
    ...topKeywords(jdText, 40)
  ].filter((n) => n && n.length >= 3);

  const scored = chunks
    .map((chunk) => {
      const hay = chunk.toLowerCase();
      let score = 0;
      for (const n of needles) {
        if (!hay.includes(n)) continue;
        score += /\s/.test(n) || n.length >= 8 ? 3 : 1;
      }
      return { chunk, score };
    })
    .sort((a, b) => b.score - a.score);

  const ranked = scored.some((s) => s.score > 0) ? scored : scored.slice(0, maxProjects);
  let out = "";
  for (const row of ranked.slice(0, maxProjects)) {
    const next = row.chunk.length > 3200 ? `${row.chunk.slice(0, 3200).trimEnd()}…` : row.chunk;
    if (out.length + next.length + 2 > maxChars) break;
    out += (out ? "\n\n" : "") + next;
  }
  return out || chunks[0].slice(0, maxChars);
}

/**
 * Same-chat re-prompt: raise ATS via project-bank evidence and coherent bullets —
 * never via a "JD Keywords" skills section or raw token dumps.
 */
export function buildAtsScoreRetryPrompt(
  resumeData,
  evaluation,
  { jdText = "", jobTitle = "", roleTrack = "sf", projectBank = "" } = {}
) {
  const track = getRoleTrack(roleTrack);
  const trackId = normalizeRoleTrackId(roleTrack);
  const missingProducts = evaluation?.missingProducts || [];
  const missingKw = (evaluation?.missingKeywords || []).slice(0, 18);
  const score = evaluation?.score ?? 0;
  const bank =
    projectBank ||
    (trackId === "sf" ? SF_ENTERPRISE_PROJECT_BANK : "");
  const excerpts =
    trackId === "sf"
      ? selectProjectBankExcerpts({ jdText, missingProducts, bank })
      : "";
  const primaryCategory = track.primarySkillsCategory || "Technical Skills";
  const domainLabel = track.domainProductLabel || "domain products";
  const internalsHint =
    track.bulletInternalsHint ||
    "name the concrete feature or capability, what was personally built, and the outcome";
  const workstreamLabel =
    trackId === "sf"
      ? "ONE enterprise Salesforce workstream"
      : trackId === "de"
        ? "ONE coherent data-platform / pipeline workstream"
        : trackId === "fs"
          ? "ONE coherent product / platform workstream"
          : trackId === "ai"
            ? "ONE coherent evaluation / ML engineering workstream"
            : "ONE coherent enterprise workstream";
  const stackPhrase =
    trackId === "sf"
      ? "Salesforce/stack used"
      : trackId === "de"
        ? "data stack used"
        : trackId === "fs"
          ? "application stack used"
          : trackId === "ai"
            ? "evaluation/ML stack used"
            : "stack used";

  const recentCompanies = (Array.isArray(resumeData?.experience) ? resumeData.experience : [])
    .slice(0, 2)
    .map((j) => String(j?.company || "").trim())
    .filter(Boolean);

  return [
    `ATS MATCH IS TOO LOW (${score}/100). Target is ${ATS_TARGET_SCORE}+.`,
    "Return the COMPLETE corrected resume JSON (same schema, every role, every field).",
    "Improve match by rewriting Professional Experience as coherent enterprise PROJECT narratives — not by dumping JD words into a skills row.",
    "",
    jobTitle ? `TARGET TITLE: ${stripClearanceFromTitle(jobTitle)}` : "",
    recentCompanies.length
      ? `KEEP THESE EMPLOYERS (rewrite bullets only): ${recentCompanies.join(" · ")}`
      : "",
    missingProducts.length
      ? `MUST-PROVE ${domainLabel.toUpperCase()} (name each inside real project bullets for the two most recent roles, and list them under real skills categories such as "${primaryCategory}"): ${missingProducts.join(", ")}`
      : "",
    missingKw.length
      ? `MIRROR THESE JD TERMS naturally inside project bullets / profile / skills items (never as a keyword list section): ${missingKw.join(", ")}`
      : "",
    "",
    "HOW TO RAISE ATS (in priority order):",
    `1. Rewrite the TWO most recent roles so each reads as ${workstreamLabel}: business problem → ${stackPhrase} → what YOU built → integration/security/scale → outcome. Show internals: ${internalsHint}`,
    trackId === "sf"
      ? "2. Pull architecture patterns from the PROJECT BANK excerpts below (SF track). Treat them as pattern reference only — never invent new employers, never paste project titles as company names, never claim the verified vendor case studies as your employment."
      : `2. Expand bullets with track-credible ${domainLabel} evidence already implied by the master history — never invent employers, dates, clearances, degrees, or certifications.`,
    `3. Put missing products into real skills categories (e.g. "${primaryCategory}" and sibling catalog rows). Never invent a keyword-dump category.`,
    "4. Choose a short resume-identity headline that reflects JD seniority and key words — do NOT paste the JD job title verbatim. Never append clearance, Public Trust, Secret, TS/SCI, citizenship, or visa wording. Keep technicalSummary as full-sentence highlights (no one-word stubs).",
    "",
    "HARD FORBIDDEN:",
    '- Never create skills categories named "JD Keywords", "Keywords", "ATS Keywords", or any keyword-dump row.',
    "- Never append a comma-separated JD word salad to skills, profile, or bullets.",
    "- Never invent employers, dates, clearances, degrees, or certifications.",
    "- Never put clearance language in headline or experience titles.",
    "- Never set headline to the exact JD job title string.",
    "- Keep every employer, date, location, title, education, and certification exactly as they already are.",
    "",
    "Return ONLY the JSON object, starting with { and ending with }.",
    "",
    excerpts
      ? [
          "PROJECT BANK EXCERPTS (architecture patterns for this JD — adapt into the candidate's EXISTING companies):",
          excerpts
        ].join("\n")
      : "",
    "",
    "JOB DESCRIPTION:",
    String(jdText || "").slice(0, 6000)
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function evaluateAtsScore(resumeData, { jdText = "", jobTitle = "", roleTrack = "sf" } = {}) {
  const trackId = normalizeRoleTrackId(roleTrack);
  const resumeText = collectStrings(resumeData).join(" ");
  const experienceText = collectStrings(resumeData?.experience).join(" ");
  const headlineText = [
    resumeData?.headline,
    resumeData?.profile,
    ...(Array.isArray(resumeData?.technicalSummary) ? resumeData.technicalSummary : [])
  ].join(" ");

  const keywords = topKeywords(jdText);
  const keywordCoverage = coverage(keywords, resumeText);
  const experienceCoverage = coverage(keywords, experienceText);
  const titleKeywords = topKeywords(jobTitle, 8);
  const titleCoverage = coverage(titleKeywords, headlineText);
  const requiredProducts = jdRequiredSkills(jdText, trackId);
  const productMatches = requiredProducts.filter((product) => product.re.test(resumeText));
  const missingProducts = requiredProducts.filter((product) => !product.re.test(resumeText));

  const domainProductsScore = requiredProducts.length
    ? round((productMatches.length / requiredProducts.length) * 20)
    : 0;

  const components = {
    keywordMatch: {
      score: round(keywordCoverage.ratio * 45),
      max: 45,
      matched: keywordCoverage.matched.length,
      total: keywords.length
    },
    titleAlignment: {
      score: round(titleCoverage.ratio * 15),
      max: titleKeywords.length ? 15 : 0,
      matched: titleCoverage.matched.length,
      total: titleKeywords.length
    },
    domainProducts: {
      score: domainProductsScore,
      max: requiredProducts.length ? 20 : 0,
      matched: productMatches.length,
      total: requiredProducts.length
    },
    salesforceProducts: {
      score: domainProductsScore,
      max: requiredProducts.length ? 20 : 0,
      matched: productMatches.length,
      total: requiredProducts.length
    },
    experienceEvidence: {
      score: round(experienceCoverage.ratio * 15),
      max: 15,
      matched: experienceCoverage.matched.length,
      total: keywords.length
    },
    atsStructure: {
      score: [
        Boolean(resumeData?.name && (resumeData?.email || resumeData?.phone)),
        Boolean(String(resumeData?.profile || "").trim()),
        Array.isArray(resumeData?.skills) && resumeData.skills.length > 0,
        Array.isArray(resumeData?.experience) && resumeData.experience.length > 0,
        (Array.isArray(resumeData?.education) && resumeData.education.length > 0) ||
          (Array.isArray(resumeData?.certifications) && resumeData.certifications.length > 0)
      ].filter(Boolean).length,
      max: 5
    }
  };

  const raw = Object.values(components).reduce((sum, item) => sum + item.score, 0);
  const possible = Object.values(components).reduce((sum, item) => sum + item.max, 0) || 1;
  const score = Math.min(100, round((raw / possible) * 100));
  const grade = score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 55 ? "Fair" : "Low";

  return {
    score,
    grade,
    components,
    matchedKeywords: keywordCoverage.matched,
    missingKeywords: keywordCoverage.missing.slice(0, 15),
    requiredProducts: requiredProducts.map((product) => product.name),
    missingProducts: missingProducts.map((product) => product.name),
    roleTrack: trackId,
    evaluatedAt: Date.now()
  };
}

/**
 * Human-readable ATS gap report for the popup Gaps panel.
 * Lists score breakdown, missing products/keywords, and concrete improve tips
 * (real skills categories + experience evidence — never keyword-dump rows).
 */
export function describeAtsGaps(evaluation = {}) {
  const components = evaluation?.components && typeof evaluation.components === "object"
    ? evaluation.components
    : {};
  const trackId = normalizeRoleTrackId(evaluation?.roleTrack);
  const track = getRoleTrack(trackId);
  const missingProducts = Array.isArray(evaluation?.missingProducts)
    ? evaluation.missingProducts.map((p) => String(p || "").trim()).filter(Boolean)
    : [];
  const missingKeywords = Array.isArray(evaluation?.missingKeywords)
    ? evaluation.missingKeywords.map((k) => String(k || "").trim()).filter(Boolean).slice(0, 16)
    : [];

  const domainKey = components.domainProducts?.max > 0 ? "domainProducts" : "salesforceProducts";
  const breakdownDefs = [
    { key: "keywordMatch", label: "JD keywords" },
    { key: "titleAlignment", label: "Title alignment" },
    { key: domainKey, label: track.domainProductLabel || "Domain products" },
    { key: "experienceEvidence", label: "Experience evidence" },
    { key: "atsStructure", label: "Resume structure" }
  ];

  const seen = new Set();
  const breakdown = [];
  for (const def of breakdownDefs) {
    if (seen.has(def.key)) continue;
    seen.add(def.key);
    const item = components[def.key];
    if (!item || !(Number(item.max) > 0)) continue;
    const score = Number(item.score) || 0;
    const max = Number(item.max) || 0;
    const ratio = max ? score / max : 1;
    breakdown.push({
      key: def.key,
      label: def.label,
      score,
      max,
      matched: item.matched,
      total: item.total,
      weak: ratio < 0.75
    });
  }

  const tips = [];
  const primaryCategory = track.primarySkillsCategory || "Technical Skills";

  if (missingProducts.length) {
    tips.push(
      `Add missing ${track.domainProductLabel || "products"} under real skills categories (e.g. "${primaryCategory}") and name each in bullets for the two most recent roles: ${missingProducts.join(", ")}.`
    );
  }

  if (missingKeywords.length) {
    tips.push(
      `Mirror these JD terms naturally in profile, full-sentence technicalSummary, and experience bullets — never a "JD Keywords" skills row: ${missingKeywords.slice(0, 10).join(", ")}.`
    );
  }

  const titleComp = components.titleAlignment;
  if (titleComp && Number(titleComp.max) > 0 && titleComp.score / titleComp.max < 0.75) {
    tips.push(
      "Use a short resume-identity headline that reflects JD seniority and key words — do not paste the JD job title verbatim — and reinforce those words in the profile."
    );
  }

  const expComp = components.experienceEvidence;
  if (
    expComp &&
    Number(expComp.max) > 0 &&
    expComp.score / expComp.max < 0.75 &&
    !missingProducts.length
  ) {
    tips.push(
      `Rewrite the two most recent roles as coherent workstreams that prove JD tools in real bullets (${track.bulletInternalsHint || "name the feature, what you built, and the outcome"}).`
    );
  }

  const structComp = components.atsStructure;
  if (structComp && Number(structComp.max) > 0 && structComp.score < structComp.max) {
    tips.push("Fill every standard section: contact, profile, skills, experience, plus education or certifications.");
  }

  if (!tips.length && Number(evaluation?.score) >= ATS_TARGET_SCORE) {
    tips.push("Match looks strong — no critical gaps. Keep proving Tier 0 tools inside recent-role bullets on the next regenerate if the JD shifts.");
  } else if (!tips.length) {
    tips.push(
      "Regenerate with stronger project evidence in the two most recent roles, or open Gaps after the next ATS pass once missing products/keywords are recorded."
    );
  }

  return {
    score: evaluation?.score ?? null,
    grade: evaluation?.grade || "",
    roleTrack: trackId,
    breakdown,
    missingProducts,
    missingKeywords,
    tips
  };
}
