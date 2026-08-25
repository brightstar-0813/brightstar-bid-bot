import { jdRequiredProducts } from "./resume-json.js";

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

function resumeHaystack(data) {
  return collectStrings(data).join(" ");
}

function wordStillMissing(word, haystack) {
  const normalized = ` ${normalizeText(haystack)} `;
  return !normalized.includes(` ${String(word || "").toLowerCase()} `);
}

/**
 * Deterministic ATS lift against the local scorer: weave missing JD tokens into
 * skills, profile, technicalSummary, headline, and recent-role bullets.
 * Does not invent employers, dates, degrees, or certifications.
 */
export function boostResumeForAts(resumeData, { jdText = "", jobTitle = "" } = {}) {
  if (!resumeData || typeof resumeData !== "object") {
    return {
      data: resumeData,
      evaluation: evaluateAtsScore(resumeData, { jdText, jobTitle }),
      changed: false
    };
  }

  let evaluation = evaluateAtsScore(resumeData, { jdText, jobTitle });
  if (evaluation.score >= ATS_TARGET_SCORE) {
    return { data: resumeData, evaluation, changed: false };
  }

  const out = cloneResume(resumeData);
  let changed = false;
  // Use the full JD keyword set (not the 15-item UI slice) so 90+ is reachable.
  const allJdKeywords = topKeywords(jdText, 50);
  const missing = coverage(allJdKeywords, resumeHaystack(out)).missing;
  const missingProducts = [...(evaluation.missingProducts || [])];

  // 1) Title alignment — put the job title (or its tokens) in the headline.
  const title = String(jobTitle || "").trim();
  if (title) {
    const headline = String(out.headline || "").trim();
    const titleWords = topKeywords(title, 8);
    const titleHit = coverage(
      titleWords,
      [headline, out.profile, ...(out.technicalSummary || [])].join(" ")
    );
    if (titleHit.ratio < 0.75) {
      out.headline =
        headline && !normalizeText(headline).includes(normalizeText(title).slice(0, 24))
          ? `${title} | ${headline}`
          : title;
      changed = true;
    }
  }

  // 2) Skills row — append missing tokens + product names exactly.
  const skillWords = [...missingProducts, ...missing.filter((w) => w.length >= 3)];
  if (skillWords.length) {
    const rows = (Array.isArray(out.skills) ? out.skills : [])
      .filter((r) => r && typeof r === "object")
      .map((r) => ({
        category: String(r.category || "").trim(),
        items: String(r.items || "").trim()
      }));
    let idx = rows.findIndex((r) => /keyword|competenc|core skill|technical/i.test(r.category));
    if (idx < 0) {
      rows.push({ category: "JD Keywords", items: "" });
      idx = rows.length - 1;
    }
    const existing = rows[idx].items;
    const toAdd = skillWords.filter((w) => wordStillMissing(w, `${existing} ${resumeHaystack(out)}`));
    if (toAdd.length) {
      const unique = [...new Set(toAdd.map((w) => String(w).trim()).filter(Boolean))];
      rows[idx].items = existing ? `${existing}, ${unique.join(", ")}` : unique.join(", ");
      out.skills = rows.filter((r) => r.category && r.items);
      changed = true;
    }
  }

  // 3) Profile — one dense sentence for still-missing tokens.
  {
    const still = missing.filter((w) => wordStillMissing(w, resumeHaystack(out)));
    const stillProducts = missingProducts.filter((p) => wordStillMissing(p, resumeHaystack(out)));
    const bag = [...stillProducts, ...still].slice(0, 28);
    if (bag.length) {
      const profile = String(out.profile || "").trim();
      const addendum = `Hands-on with ${bag.join(", ")}.`;
      out.profile = profile ? `${profile} ${addendum}` : addendum;
      changed = true;
    }
  }

  // technicalSummary is rendered as resume bullets — never inject bare JD tokens here.
  // Keyword coverage belongs in skills, profile, and experience bullets instead.

  // 4) Experience evidence — weave remaining tokens into the two most recent roles.
  {
    const still = [...missingProducts, ...missing].filter((w) =>
      wordStillMissing(w, collectStrings(out.experience).join(" "))
    );
    if (still.length && Array.isArray(out.experience) && out.experience.length) {
      const roles = out.experience.slice(0, 2);
      const mid = Math.ceil(still.length / roles.length) || still.length;
      roles.forEach((job, i) => {
        const chunk = still.slice(i * mid, i === roles.length - 1 ? still.length : (i + 1) * mid);
        if (!chunk.length) return;
        const bullets = Array.isArray(job.bullets) ? job.bullets.map((b) => String(b || "")) : [];
        bullets.push(
          `Delivered solutions using ${chunk.join(", ")}, aligned to stakeholder outcomes and platform standards.`
        );
        job.bullets = bullets.filter(Boolean);
        changed = true;
      });
    }
  }

  evaluation = evaluateAtsScore(out, { jdText, jobTitle });
  return { data: out, evaluation, changed };
}

/**
 * Same-chat re-prompt: force missing JD keywords / products into JSON so the
 * local ATS badge can clear 90+.
 */
export function buildAtsScoreRetryPrompt(resumeData, evaluation, { jdText = "", jobTitle = "" } = {}) {
  const allJdKeywords = topKeywords(jdText, 50);
  const fromFull = coverage(allJdKeywords, resumeHaystack(resumeData)).missing;
  const missingKw = fromFull.length ? fromFull : evaluation?.missingKeywords || [];
  const missingProducts = evaluation?.missingProducts || [];
  const score = evaluation?.score ?? 0;
  return [
    `ATS MATCH IS TOO LOW (${score}/100). Target is ${ATS_TARGET_SCORE}+. Return the COMPLETE corrected JSON object again — same schema, every role, every field — with denser JD keyword coverage.`,
    "",
    jobTitle ? `TARGET TITLE: ${jobTitle}` : "",
    missingProducts.length
      ? `MISSING SALESFORCE / PLATFORM PRODUCTS (must appear in skills AND in at least two recent-role bullets AND in profile): ${missingProducts.join(", ")}`
      : "",
    missingKw.length
      ? `MISSING JD KEYWORD TOKENS (each must appear somewhere in the resume text — skills items, profile, and recent-role bullets; never as one-word technicalSummary lines). Use the exact tokens: ${missingKw.join(", ")}`
      : "",
    "",
    "RULES:",
    "1. Put the target title (or its key words) in \"headline\".",
    "2. Mirror JD terminology exactly — do not paraphrase away keywords (e.g. keep \"Lightning Web Components\", \"SOQL\", \"Service Cloud\", \"integration\", \"architecture\" when the JD uses them).",
    "3. Every missing product and as many missing tokens as possible must appear in Professional Experience bullets for the two most recent roles — not only in the skills table. Do not add single-word lines or keyword stubs to technicalSummary; keep every technicalSummary bullet a full sentence.",
    "4. Keep every employer, date, location, title, education entry, and certification exactly as they already are. Do not invent metrics, clearances, or employers.",
    "5. Do not explain gaps. Return ONLY the JSON object, starting with { and ending with }.",
    "",
    "JOB DESCRIPTION (for keyword reference):",
    String(jdText || "").slice(0, 6000)
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function evaluateAtsScore(resumeData, { jdText = "", jobTitle = "" } = {}) {
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
  const requiredProducts = jdRequiredProducts(jdText);
  const productMatches = requiredProducts.filter((product) => product.re.test(resumeText));
  const missingProducts = requiredProducts.filter((product) => !product.re.test(resumeText));

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
    salesforceProducts: {
      score: requiredProducts.length
        ? round((productMatches.length / requiredProducts.length) * 20)
        : 0,
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
    evaluatedAt: Date.now()
  };
}
