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
  const grade = score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 55 ? "Fair" : "Low";

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
