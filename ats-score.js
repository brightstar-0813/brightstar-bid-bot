import { getRoleTrack, jdRequiredSkills, normalizeRoleTrackId } from "./role-tracks.js";
import { SF_ENTERPRISE_PROJECT_BANK } from "./prompts/sf-enterprise-projects.js";
import { stripClearanceFromTitle } from "./resume-json.js";
import {
  coverTerms,
  extractJdTerms,
  normalizeAtsText,
  topKeywords
} from "./ats-keywords.js";

export { topKeywords } from "./ats-keywords.js";

/** Local ATS badge target — builds re-prompt / boost until this is cleared. */
export const ATS_TARGET_SCORE = 85;

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

function round(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function cloneResume(data) {
  if (!data || typeof data !== "object") return data;
  return JSON.parse(JSON.stringify(data));
}

function skillsHaystack(resumeData) {
  return (Array.isArray(resumeData?.skills) ? resumeData.skills : [])
    .map((row) => `${row?.category || ""} ${row?.items || ""}`)
    .join(" ");
}

function experienceJobs(resumeData) {
  return Array.isArray(resumeData?.experience) ? resumeData.experience : [];
}

function jobBulletsText(job) {
  const bullets = Array.isArray(job?.bullets) ? job.bullets : [];
  return bullets.map((b) => String(b || "")).join(" ");
}

/**
 * Products that appear in skills AND in at least `minBullets` experience bullets.
 * Skills-only listings score 0 for that product.
 */
export function scoreProductBulletProof(
  resumeData,
  requiredProducts,
  { minBullets = 2, coreCount = Infinity, relaxedMinBullets = 1 } = {}
) {
  const products = Array.isArray(requiredProducts) ? requiredProducts : [];
  if (!products.length) {
    return { score: 0, max: 0, matched: 0, total: 0, skillsOnly: [], proved: [] };
  }
  const skillsText = skillsHaystack(resumeData);
  const jobs = experienceJobs(resumeData);
  const proved = [];
  const skillsOnly = [];

  // Only the JD's headline tools need two bullets. A long catalog tail cannot
  // fit two bullets each on a two-page resume, so demanding it capped the score.
  products.forEach((product, index) => {
    const need = index < coreCount ? minBullets : relaxedMinBullets;
    const inSkills = product.re.test(skillsText);
    let bulletHits = 0;
    for (const job of jobs) {
      const bullets = Array.isArray(job?.bullets) ? job.bullets : [];
      for (const b of bullets) {
        if (product.re.test(String(b || ""))) bulletHits += 1;
      }
    }
    if (inSkills && bulletHits >= need) {
      proved.push(product.name);
    } else if (inSkills && bulletHits < need) {
      skillsOnly.push(product.name);
    } else if (bulletHits >= need) {
      // Named in bullets but missing from skills — still partial credit via proved-adjacent
      proved.push(product.name);
    }
  });

  const matched = proved.length;
  const max = 15;
  return {
    score: round((matched / products.length) * max),
    max,
    matched,
    total: products.length,
    skillsOnly,
    proved
  };
}

/**
 * GATE 1A mirror: each of the two most recent roles should name ≥3 JD-required
 * products/skills in its bullets (or all required products when fewer than 3).
 */
export function scoreRecentRoleProof(resumeData, requiredProducts, { minPerRole = 3 } = {}) {
  const products = Array.isArray(requiredProducts) ? requiredProducts : [];
  const jobs = experienceJobs(resumeData).slice(0, 2);
  if (!products.length || !jobs.length) {
    return { score: 0, max: 0, matched: 0, total: 0, roleHits: [] };
  }
  const need = Math.min(minPerRole, products.length);
  const roleHits = jobs.map((job) => {
    const text = jobBulletsText(job);
    const hitNames = products.filter((p) => p.re.test(text)).map((p) => p.name);
    return {
      company: String(job?.company || "").trim(),
      hitCount: hitNames.length,
      hits: hitNames,
      met: hitNames.length >= need
    };
  });
  const rolesMet = roleHits.filter((r) => r.met).length;
  // Always score against two recent roles so a single-role resume cannot max out.
  // The current role carries more weight — every major ATS favours recent experience.
  const max = 12;
  const recencyWeights = [0.6, 0.4];
  const earned = roleHits.reduce(
    (sum, r, i) => sum + (r.met ? recencyWeights[i] || 0 : 0),
    0
  );
  return {
    score: round(earned * max),
    max,
    matched: rolesMet,
    total: 2,
    roleHits,
    needPerRole: need
  };
}

/**
 * Deterministic cleanup only: strip forbidden keyword-dump skill rows and
 * clearance notes from the headline. Never paste the JD job title into headline —
 * ATS title coverage comes from AI-chosen resume identities + profile/bullets.
 */
export function boostResumeForAts(
  resumeData,
  { jdText = "", jobTitle = "", roleTrack = "sf", companyName = "" } = {}
) {
  if (!resumeData || typeof resumeData !== "object") {
    return {
      data: resumeData,
      evaluation: evaluateAtsScore(resumeData, { jdText, jobTitle, roleTrack, companyName }),
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

  const evaluation = evaluateAtsScore(cleaned, { jdText, jobTitle, roleTrack, companyName });
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
 * Short first-pass block so the model targets evidence before any ATS retry.
 * Products use catalog spellings; keywords are distinctive JD tokens.
 */
export function buildMustProveBlock(jdText = "", roleTrack = "sf", { companyName = "" } = {}) {
  const trackId = normalizeRoleTrackId(roleTrack);
  const track = getRoleTrack(trackId);
  const required = jdRequiredSkills(jdText, trackId);
  const products = required.map((p) => p.name).slice(0, 12);
  const keywords = topKeywords(jdText, 10, { companyName, roleTrack: trackId });
  if (!products.length && !keywords.length) return "";
  const lines = [
    "==================================================",
    "MUST PROVE (first-pass evidence — before writing JSON)",
    "==================================================",
    "Prove these in real skills categories (exact JD spellings), profile sentences, AND ≥2 bullets across the TWO most recent roles. Never a keyword-dump skills row. Never invent employers.",
    products.length
      ? `${track.domainProductLabel || "Must-have products"}: ${products.join(", ")}`
      : "",
    keywords.length ? `Distinctive JD terms to weave naturally: ${keywords.join(", ")}` : "",
    "Adapt project patterns into EXISTING employers only — never paste bank titles as companies."
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * Same-chat re-prompt: raise ATS via project-bank evidence and coherent bullets —
 * never via a "JD Keywords" skills section or raw token dumps.
 */
export function buildAtsScoreRetryPrompt(
  resumeData,
  evaluation,
  { jdText = "", jobTitle = "", roleTrack = "sf", projectBank = "", companyName = "" } = {}
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

export function evaluateAtsScore(
  resumeData,
  { jdText = "", jobTitle = "", roleTrack = "sf", companyName = "" } = {}
) {
  const trackId = normalizeRoleTrackId(roleTrack);
  const resumeText = collectStrings(resumeData).join(" ");
  const experienceText = collectStrings(resumeData?.experience).join(" ");
  const headlineText = [
    resumeData?.headline,
    resumeData?.profile,
    ...(Array.isArray(resumeData?.technicalSummary) ? resumeData.technicalSummary : [])
  ].join(" ");

  const keywords = extractJdTerms(jdText, { companyName, roleTrack: trackId, jobTitle });
  const keywordCoverage = coverTerms(keywords, resumeText);
  const experienceCoverage = coverTerms(keywords, experienceText);
  const titleKeywords = extractJdTerms(jobTitle, { roleTrack: trackId, limit: 8, phraseLimit: 0 });
  const titleCoverage = coverTerms(titleKeywords, headlineText);

  // Rank required products by how insistently the JD names them, so the
  // headline tools are the ones held to the stricter two-bullet proof.
  const jdNormalized = normalizeAtsText(jdText);
  const requiredProducts = jdRequiredSkills(jdText, trackId)
    .map((product) => ({
      product,
      mentions: (jdNormalized.match(new RegExp(product.re.source, "gi")) || []).length
    }))
    .sort((a, b) => b.mentions - a.mentions)
    .map((entry) => entry.product);
  const productMatches = requiredProducts.filter((product) => product.re.test(resumeText));
  const missingProducts = requiredProducts.filter((product) => !product.re.test(resumeText));

  const productProof = scoreProductBulletProof(resumeData, requiredProducts, {
    minBullets: 2,
    coreCount: 3,
    relaxedMinBullets: 1
  });
  const recentProof = scoreRecentRoleProof(resumeData, requiredProducts, { minPerRole: 3 });

  // Lexical catalog presence — lower weight; proof components carry recruiter fit.
  const domainProductsScore = requiredProducts.length
    ? round((productMatches.length / requiredProducts.length) * 12)
    : 0;

  const keywordExpMax = keywords.length ? 8 : 0;
  const keywordExpScore = round(experienceCoverage.ratio * keywordExpMax);
  const recentRoleScore = recentProof.max ? recentProof.score : 0;
  // Max is the sum of the parts that can actually be earned. The old flat 20
  // was unreachable whenever the JD produced no catalog products.
  const experienceEvidenceMax = keywordExpMax + (recentProof.max || 0);
  const experienceEvidenceScore = Math.min(
    experienceEvidenceMax,
    keywordExpScore + recentRoleScore
  );

  const components = {
    keywordMatch: {
      score: round(keywordCoverage.ratio * 35),
      max: 35,
      matched: keywordCoverage.matched.length,
      total: keywords.length
    },
    titleAlignment: {
      score: round(titleCoverage.ratio * 10),
      max: titleKeywords.length ? 10 : 0,
      matched: titleCoverage.matched.length,
      total: titleKeywords.length
    },
    domainProducts: {
      score: domainProductsScore,
      max: requiredProducts.length ? 12 : 0,
      matched: productMatches.length,
      total: requiredProducts.length
    },
    // Alias for older Gaps UI — excluded from score sum below.
    salesforceProducts: {
      score: domainProductsScore,
      max: requiredProducts.length ? 12 : 0,
      matched: productMatches.length,
      total: requiredProducts.length
    },
    productBulletProof: {
      score: productProof.score,
      max: productProof.max,
      matched: productProof.matched,
      total: productProof.total,
      skillsOnly: productProof.skillsOnly,
      proved: productProof.proved
    },
    experienceEvidence: {
      score: experienceEvidenceScore,
      max: experienceEvidenceMax,
      matched: recentProof.matched || experienceCoverage.matched.length,
      total: recentProof.total || keywords.length,
      roleHits: recentProof.roleHits || [],
      needPerRole: recentProof.needPerRole || 0
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

  const scoreKeys = [
    "keywordMatch",
    "titleAlignment",
    "domainProducts",
    "productBulletProof",
    "experienceEvidence",
    "atsStructure"
  ];
  const raw = scoreKeys.reduce((sum, key) => sum + (Number(components[key]?.score) || 0), 0);
  const possible = scoreKeys.reduce((sum, key) => sum + (Number(components[key]?.max) || 0), 0) || 1;
  const score = Math.min(100, round((raw / possible) * 100));
  const grade = score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 55 ? "Fair" : "Low";

  return {
    score,
    grade,
    components,
    matchedKeywords: keywordCoverage.matched.map((t) => t.term),
    // Soft terms are dropped: the retry prompt used to order the model to weave
    // "collaboration" (and the employer's own name) into experience bullets.
    missingKeywords: keywordCoverage.missing
      .filter((t) => t.kind !== "soft")
      .map((t) => t.term)
      .slice(0, 15),
    requiredProducts: requiredProducts.map((product) => product.name),
    missingProducts: missingProducts.map((product) => product.name),
    skillsOnlyProducts: productProof.skillsOnly || [],
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
    { key: "productBulletProof", label: "Skills + bullet proof" },
    { key: "experienceEvidence", label: "Recent-role evidence" },
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
  const findings = [];
  const primaryCategory = track.primarySkillsCategory || "Technical Skills";
  const skillsOnly = Array.isArray(evaluation?.skillsOnlyProducts)
    ? evaluation.skillsOnlyProducts
    : Array.isArray(components.productBulletProof?.skillsOnly)
      ? components.productBulletProof.skillsOnly
      : [];
  const score = Number(evaluation?.score);
  const grade = String(evaluation?.grade || "").trim();

  if (Number.isFinite(score)) {
    findings.push({
      kind: "score",
      title: `Match score: ${Math.round(score)}/100${grade ? ` (${grade})` : ""}`,
      body:
        score >= ATS_TARGET_SCORE
          ? "Looks solid for a local match. Still skim the bullets — recruiters care about proof, not the number."
          : score >= 75
            ? "Close, but a recruiter may still doubt you did this work. Fix the weak spots below before you send."
            : "This resume would not convince a careful recruiter yet. The gaps below are what failed the check."
    });
  }

  if (missingProducts.length) {
    const list = missingProducts.join(", ");
    findings.push({
      kind: "missing-products",
      title: "Skills & tech to add",
      items: missingProducts.slice(),
      body: `Add these under “${primaryCategory}” (exact spellings), then prove each in ≥2 bullets across your two most recent roles.`
    });
    tips.push(
      `Skills & tech to add (skills row + recent-role bullets): ${list}.`
    );
  }

  if (skillsOnly.length) {
    const list = skillsOnly.join(", ");
    findings.push({
      kind: "skills-only",
      title: "Skills & tech to prove in bullets",
      items: skillsOnly.slice(),
      body: `Already in the skills table — rewrite the last two roles so each appears in a real story (what you built, for whom, what changed).`
    });
    tips.push(
      `Skills & tech to prove in recent-role bullets: ${list}.`
    );
  }

  if (missingKeywords.length) {
    const weave = missingKeywords.slice(0, 12);
    const list = weave.join(", ");
    findings.push({
      kind: "missing-keywords",
      title: "JD tech language to weave in",
      items: weave,
      body: `Use these terms naturally in profile, technicalSummary sentences, and bullets — never a “JD Keywords” dump row.`
    });
    tips.push(
      `JD tech language to weave (profile / bullets, not a keyword row): ${list}.`
    );
  }

  const titleComp = components.titleAlignment;
  if (titleComp && Number(titleComp.max) > 0 && titleComp.score / titleComp.max < 0.75) {
    findings.push({
      kind: "headline",
      title: "Headline feels off for this JD",
      body: "Pick a short resume identity that matches seniority and focus. Do not paste the JD title, and never add clearance or citizenship wording."
    });
    tips.push(
      "Use a short resume-identity headline that reflects JD seniority and key words — do not paste the JD job title verbatim — and reinforce those words in the profile."
    );
  }

  const expComp = components.experienceEvidence;
  if (expComp && Number(expComp.max) > 0 && expComp.score / expComp.max < 0.75) {
    const need = Number(expComp.needPerRole) || 3;
    const roleBits = Array.isArray(expComp.roleHits)
      ? expComp.roleHits
          .map((r) => {
            const co = String(r?.company || "Recent role").trim() || "Recent role";
            return `${co}: ${Number(r?.hitCount) || 0}/${need} tools named`;
          })
          .join("; ")
      : "";
    findings.push({
      kind: "recent-roles",
      title: "Recent roles do not prove the JD",
      body: `Each of the two most recent jobs should name about ${need} required tools in separate bullets${
        roleBits ? ` (${roleBits})` : ""
      }. Skills table coverage alone does not count. ${
        track.bulletInternalsHint
          ? `Show internals: ${track.bulletInternalsHint}`
          : "Name the feature, what you built, and the outcome."
      }`
    });
    tips.push(
      `Rewrite the two most recent roles so each names at least ${need} JD-required tools in real bullets (${track.bulletInternalsHint || "name the feature, what you built, and the outcome"}). Skills-table coverage alone does not raise this score.`
    );
  }

  const proofComp = components.productBulletProof;
  if (
    proofComp &&
    Number(proofComp.max) > 0 &&
    proofComp.score / proofComp.max < 0.75 &&
    !skillsOnly.length &&
    !missingProducts.length
  ) {
    findings.push({
      kind: "proof",
      title: "Product proof is thin",
      body: `Must-haves should show up both under “${primaryCategory}” (or sibling rows) and in two or more experience bullets.`
    });
    tips.push(
      `Strengthen product proof: each must-have should appear under "${primaryCategory}" (or sibling rows) and in two or more experience bullets.`
    );
  }

  const structComp = components.atsStructure;
  if (structComp && Number(structComp.max) > 0 && structComp.score < structComp.max) {
    findings.push({
      kind: "structure",
      title: "Resume sections incomplete",
      body: "Fill contact, profile, skills, experience, plus education or certifications."
    });
    tips.push("Fill every standard section: contact, profile, skills, experience, plus education or certifications.");
  }

  const weakBreakdown = breakdown.filter((b) => b.weak);
  if (weakBreakdown.length && findings.length < 2) {
    findings.push({
      kind: "weak-areas",
      title: "Weak score areas",
      body: weakBreakdown.map((b) => `${b.label} ${b.score}/${b.max}`).join(" · ")
    });
  }

  if (!tips.length && Number(evaluation?.score) >= ATS_TARGET_SCORE) {
    const ok =
      "Match looks strong — Tier 0 tools are proved in recent-role bullets. Keep that evidence on the next regenerate if the JD shifts.";
    tips.push(ok);
    if (!findings.some((f) => f.kind === "score")) {
      findings.push({ kind: "ok", title: "Looking good", body: ok });
    }
  } else if (!tips.length) {
    const fallback =
      "Rebuild with stronger project evidence in the two most recent roles, then re-check Gaps.";
    tips.push(fallback);
    findings.push({ kind: "fallback", title: "Needs a stronger rebuild", body: fallback });
  }

  const rebuildPrompt = buildGapsRebuildPrompt({
    findings,
    tips,
    missingProducts,
    missingKeywords,
    skillsOnlyProducts: skillsOnly,
    primaryCategory,
    track
  });

  const upgradeSkills = [...new Set([...missingProducts, ...skillsOnly])];
  const weaveTech = missingKeywords.slice(0, 12);

  const summary =
    Number.isFinite(score) && score >= ATS_TARGET_SCORE
      ? "Local match is strong. Skim findings if you want polish."
      : upgradeSkills.length || weaveTech.length
        ? [
            upgradeSkills.length
              ? `${upgradeSkills.length} skill${upgradeSkills.length === 1 ? "" : "s"}/tech to upgrade`
              : "",
            weaveTech.length
              ? `${weaveTech.length} JD term${weaveTech.length === 1 ? "" : "s"} to weave`
              : ""
          ]
            .filter(Boolean)
            .join(" · ")
        : findings.filter((f) => f.kind !== "score").length
          ? `Here’s what a recruiter would still doubt (${findings.filter((f) => f.kind !== "score").length} issue${
              findings.filter((f) => f.kind !== "score").length === 1 ? "" : "s"
            }).`
          : "Gaps recorded — rebuild to raise evidence.";

  return {
    score: evaluation?.score ?? null,
    grade: evaluation?.grade || "",
    roleTrack: trackId,
    breakdown,
    missingProducts,
    missingKeywords,
    skillsOnlyProducts: skillsOnly,
    upgradeSkills,
    weaveTech,
    tips,
    findings,
    summary,
    rebuildPrompt
  };
}

/**
 * Additional prompt block injected on Rebuild — targets Gaps without inventing employers.
 */
export function buildGapsRebuildPrompt({
  findings = [],
  tips = [],
  missingProducts = [],
  missingKeywords = [],
  skillsOnlyProducts = [],
  primaryCategory = "Technical Skills",
  track = {}
} = {}) {
  const lines = [
    "REBUILD FOR ATS GAPS (local evidence score) — follow in addition to all HARD FLOOR / GATE rules:",
    "- Keep every employer, date, title, education, and certification exactly as they already are. Never invent employers.",
    "- Never create a JD Keywords / keyword-dump skills row. Never paste the JD title into headline. No clearance or citizenship language.",
    `- Put must-have tools in real skills categories (e.g. "${primaryCategory}") with EXACT JD spellings.`,
    "- Prove tools in the TWO most recent roles with concrete bullets (feature → what you built → outcome).",
    track?.bulletInternalsHint ? `- Internals hint: ${track.bulletInternalsHint}` : "",
    missingProducts.length
      ? `- Skills & tech to ADD (skills row + prove in bullets):\n${missingProducts
          .map((p) => `  • ${p}`)
          .join("\n")}`
      : "",
    skillsOnlyProducts.length
      ? `- Skills & tech to PROVE in recent-role bullets:\n${skillsOnlyProducts
          .map((p) => `  • ${p}`)
          .join("\n")}`
      : "",
    missingKeywords.length
      ? `- JD tech language to weave naturally (not as a list):\n${missingKeywords
          .slice(0, 12)
          .map((k) => `  • ${k}`)
          .join("\n")}`
      : "",
    findings.filter((f) => f.kind !== "score" && f.kind !== "ok" && !f.items?.length).length
      ? "- Focus areas:\n" +
        findings
          .filter((f) => f.kind !== "score" && f.kind !== "ok" && !f.items?.length)
          .map((f) => `  • ${f.title}: ${f.body}`)
          .join("\n")
      : "",
    tips.length ? `- Checklist: ${tips.slice(0, 4).join(" | ")}` : "",
    "Return ONLY the complete resume JSON object."
  ].filter(Boolean);
  return lines.join("\n");
}
