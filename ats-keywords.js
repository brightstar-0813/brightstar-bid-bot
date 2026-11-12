/**
 * JD keyword extraction for the local ATS match score.
 *
 * Split out of ats-score.js because the old inline extractor deflated every score:
 * it ranked raw unigrams by frequency over the WHOLE scraped JD, so the employer's
 * own name, the benefits block, and the EEO paragraph became "required keywords"
 * that no honest resume can ever match. It also kept "." inside tokens, so
 * "documentation." and "documentation" were different words.
 *
 * This module fixes measurement only — it never rewrites resume content.
 */

import { getRoleTrack, normalizeRoleTrackId } from "./role-tracks.js";

/** Generic hiring-page filler — never a differentiating skill. */
export const STOP_WORDS = new Set([
  // original list
  "about", "after", "also", "and", "any", "are", "based", "been", "being", "but",
  "can", "company", "day", "for", "from", "have", "into", "job", "more", "must",
  "our", "role", "should", "team", "that", "the", "their", "them", "they", "this",
  "through", "using", "will", "with", "work", "you", "your", "years", "year",
  "preferred", "required", "requirements", "responsibilities", "including", "strong",
  // hiring boilerplate
  "ability", "able", "across", "all", "along", "applicant", "applicants", "application",
  "apply", "candidate", "candidates", "career", "consideration", "current",
  "description", "desire", "desired", "duties", "employer", "employment", "ensure",
  "environment", "every", "excellent", "experience", "experienced", "familiar",
  "familiarity", "field", "following", "future", "gather", "great", "grow", "growing",
  "help", "high", "highly", "hire", "hiring", "how", "ideal", "join", "knowledge",
  "look", "looking", "make", "minimum", "new", "one", "opportunity", "other", "others",
  "outstanding", "over", "part", "passionate", "per", "plus", "position", "proven",
  "provide", "provides", "qualification", "qualifications", "qualified",
  "related", "relevant", "requires", "seeking",
  "similar", "some", "such", "take", "these", "those", "time", "top", "toward",
  "understand", "understanding", "use", "used", "various", "want", "well", "what",
  "when", "where", "which", "while", "who", "why", "within", "world", "would",
  // legal / EEO / benefits vocabulary
  "authorized", "color", "committed", "dental", "disability", "diverse", "eeo",
  "equal", "gender", "holidays", "identity", "inclusive", "insurance", "leave",
  "legal", "match", "national", "origin", "paid", "parental", "pay", "protected",
  "race", "regard", "religion", "reimbursement", "salary", "sex", "sexual",
  "sponsorship", "status", "veteran", "vision", "visa", "without", "workplace",
  "benefit", "benefits", "compensation", "perk", "perks", "bonus", "equity",
  "remote", "hybrid", "onsite", "flexible", "schedule", "schedules", "vacation",
  // corporate-name filler (company tokens are stripped separately too)
  "inc", "llc", "ltd", "corp", "corporation", "group", "holdings", "global",
  "technologies", "technology", "solutions", "services", "systems", "labs",
  "partners", "consulting", "agency", "agencies", "staffing", "recruiter",
  "recruiting", "client", "clients", "customer", "customers", "business",
  "industry", "enterprise", "organization", "department"
]);

/** Soft / behavioural terms — real, but never the reason an ATS ranks you. */
const SOFT_TERMS = new Set([
  "communication", "communicate", "collaboration", "collaborate", "collaborative",
  "interpersonal", "leadership", "lead", "mentor", "mentoring", "mentorship",
  "teamwork", "stakeholder", "stakeholders", "partner", "partnership", "motivated",
  "detail", "oriented", "organized", "organizational", "independent", "independently",
  "problem", "solving", "critical", "thinking", "creative", "creativity", "adaptable",
  "flexibility", "initiative", "ownership", "accountable", "accountability",
  "presentation", "written", "verbal", "cross", "functional", "fast", "paced",
  "dynamic", "positive", "attitude", "passion", "curious", "driven", "self",
  "coaching", "influence", "negotiation", "facilitate", "facilitation"
]);

/**
 * Terms that are hard skills regardless of how the JD capitalizes them.
 * The CamelCase / ALL-CAPS detector below catches most of the rest generically.
 */
const HARD_TERMS = new Set([
  "api", "apis", "sql", "etl", "elt", "ci", "cd", "cicd", "devops", "sdk", "cli",
  "rest", "soap", "grpc", "graphql", "json", "xml", "yaml", "oauth", "saml", "sso",
  "jwt", "http", "https", "tcp", "dns", "ssl", "tls", "crud", "orm", "mvc",
  "backend", "frontend", "fullstack", "microservices", "serverless", "container",
  "containers", "containerized", "pipeline", "pipelines", "schema", "query",
  "queries", "database", "databases", "warehouse", "lakehouse", "streaming",
  "batch", "caching", "cache", "index", "indexing", "sharding", "replication",
  "migration", "migrations", "integration", "integrations", "deployment",
  "authentication", "authorization", "encryption", "middleware", "webhook",
  "webhooks", "endpoint", "endpoints", "latency", "throughput", "scalability",
  "observability", "monitoring", "logging", "telemetry", "testing", "automation",
  "architecture", "architect", "refactor", "refactoring", "versioning", "governance",
  "compliance", "security", "provisioning", "orchestration", "infrastructure"
]);

/**
 * Alias groups — a JD term counts as matched when ANY alias is on the resume.
 * Mirrors how modern semantic ATS treat acronyms and short forms.
 */
const SYNONYM_GROUPS = [
  ["javascript", "js", "ecmascript"],
  ["typescript", "ts"],
  ["kubernetes", "k8s"],
  ["postgresql", "postgres", "psql"],
  ["mongodb", "mongo"],
  ["microsoft sql server", "mssql", "sql server"],
  ["amazon web services", "aws"],
  ["google cloud platform", "gcp"],
  ["microsoft azure", "azure"],
  ["continuous integration", "ci"],
  ["continuous delivery", "continuous deployment", "cd"],
  ["ci cd", "cicd"],
  ["infrastructure as code", "iac"],
  ["machine learning", "ml"],
  ["artificial intelligence", "ai"],
  ["natural language processing", "nlp"],
  ["large language model", "large language models", "llm", "llms"],
  ["retrieval augmented generation", "rag"],
  ["lightning web components", "lightning web component", "lwc"],
  ["salesforce object query language", "soql"],
  ["salesforce object search language", "sosl"],
  ["customer relationship management", "crm"],
  ["enterprise resource planning", "erp"],
  ["representational state transfer", "rest"],
  ["extract transform load", "etl"],
  ["quality assurance", "qa"],
  ["user interface", "ui"],
  ["user experience", "ux"],
  ["object oriented programming", "oop"],
  ["test driven development", "tdd"],
  ["single sign on", "sso"],
  ["role based access control", "rbac"],
  ["service level agreement", "sla"],
  ["proof of concept", "poc"],
  ["dotnet", "asp.net"],
  ["nodejs", "node.js"],
  ["reactjs", "react.js", "react"],
  ["vuejs", "vue.js", "vue"],
  ["c sharp", "csharp"],
  ["apache spark", "spark", "pyspark"],
  ["apache airflow", "airflow"],
  ["apache kafka", "kafka"],
  ["elasticsearch", "elastic search", "opensearch"],
  ["github actions", "gh actions"],
  ["root cause analysis", "rca"],
  ["release management", "release engineering"],
  ["data quality", "data integrity"],
  // Noun/verb pairs the suffix stemmer cannot bridge on its own.
  ["documentation", "document", "documents", "documented"],
  ["certification", "certifications", "certified", "certificate"],
  ["optimization", "optimize", "optimized", "optimisation"],
  ["implementation", "implement", "implemented"],
  ["maintenance", "maintain", "maintained"],
  ["analysis", "analyze", "analyzed", "analytics", "analytical"],
  ["troubleshooting", "troubleshoot", "troubleshot"],
  ["configuration", "configure", "configured"],
  ["administration", "administer", "administrator", "admin"]
];

/**
 * Blocks whose vocabulary is legal/benefits/marketing, not the job.
 * A block is only dropped when it does NOT also read like a real JD section.
 */
const BOILERPLATE_BLOCK =
  /(equal\s+opportunity|\beeo\b|without\s+regard\s+to|protected\s+veteran|reasonable\s+accommodation|drug[-\s]free|e-verify|visa\s+sponsorship|does\s+not\s+(provide|offer)\s+sponsor|background\s+check|\bbenefits?\b|\bperks?\b|what\s+we\s+offer|401\s*\(?k\)?|paid\s+time\s+off|health,?\s*(and\s+)?dental|dental,?\s*(and\s+)?vision|^\s*about\b|who\s+we\s+are|why\s+(join|work)|our\s+(mission|culture|values|story)|diversity\s+and\s+inclusion|privacy\s+policy|how\s+to\s+apply|apply\s+now|disclaimer|staffing\s+agenc|recruit(ing|ment)\s+agenc)/im;

/** Wording that means the block really is describing the job. */
const REAL_SECTION =
  /(responsibilit|requirement|qualification|what\s+you.{0,4}ll\s+(do|bring)|duties|must[-\s]have|nice[-\s]to[-\s]have|day[-\s]to[-\s]day|the\s+role|job\s+description|technical\s+skills|proficien|expertise|hands[-\s]on)/i;

/** Single sentences that are always legal boilerplate. */
const BOILERPLATE_LINE =
  /(equal\s+opportunity|without\s+regard\s+to|protected\s+veteran|reasonable\s+accommodation|e-verify|visa\s+sponsorship|does\s+not\s+(provide|offer)\s+sponsor|authorized\s+to\s+work)/i;

/**
 * Lowercase and strip punctuation.
 * Unlike the old normalizer this drops LEADING and TRAILING dots, so a
 * sentence-final "documentation." is the same token as "documentation",
 * while "node.js" and "3.5" keep their internal dot.
 */
export function normalizeAtsText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.net\b/g, " dotnet ")
    .replace(/\bc\+\+/g, " cplusplus ")
    .replace(/\bc#/g, " csharp ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/(^|\s)\.+/g, "$1")
    .replace(/\.+(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Conservative suffix stemmer used ONLY for match keys, never for display.
 * Makes "integration"/"integrated"/"integrate" and "deploy"/"deployed"/"deploying"
 * the same key so honest phrasing is not punished.
 */
export function stemToken(word) {
  let w = String(word || "").toLowerCase();
  if (w.length <= 3 || w.includes(".") || /[+#0-9]/.test(w)) return w;
  if (/(ss|us|is)$/.test(w)) {
    // "analysis", "status", "business" — no plural to strip
  } else if (/ies$/.test(w) && w.length > 4) {
    w = `${w.slice(0, -3)}y`;
  } else if (/s$/.test(w) && w.length > 3) {
    w = w.slice(0, -1);
  }
  if (/ing$/.test(w) && w.length > 5) w = w.slice(0, -3);
  else if (/ed$/.test(w) && w.length > 4) w = w.slice(0, -2);
  // "development" -> "develop", "management" -> "manage". The length guard keeps
  // "document" intact instead of shredding it to "docu".
  if (/ment$/.test(w) && w.length - 4 >= 5) w = w.slice(0, -4);
  if (/ion$/.test(w) && w.length > 5) w = w.slice(0, -3);
  if (/([bdfglmnprt])\1$/.test(w)) w = w.slice(0, -1);
  if (/e$/.test(w) && w.length > 4) w = w.slice(0, -1);
  return w;
}

/** Stem every word of a term so phrases compare the same way unigrams do. */
export function stemTerm(term) {
  return normalizeAtsText(term).split(" ").filter(Boolean).map(stemToken).join(" ");
}

const CANONICAL_BY_ALIAS = (() => {
  const map = new Map();
  for (const group of SYNONYM_GROUPS) {
    const canonical = stemTerm(group[0]);
    for (const alias of group) {
      const key = stemTerm(alias);
      if (key) map.set(key, canonical);
    }
  }
  return map;
})();

/** Fold a term onto its alias group so "k8s" and "Kubernetes" share a key. */
export function canonicalKey(term) {
  const key = stemTerm(term);
  return CANONICAL_BY_ALIAS.get(key) || key;
}

/** Tokens of the employer's own name — unmatchable by definition. */
function companyTokens(companyName) {
  return new Set(
    normalizeAtsText(companyName)
      .split(" ")
      .filter((w) => w.length > 2)
  );
}

/**
 * Drop the blocks of a scraped JD that describe the employer, the benefits,
 * or the law rather than the job.
 * Falls back to the original text if cleaning would remove most of the posting.
 */
export function cleanJdForKeywords(jdText, { companyName = "" } = {}) {
  const raw = String(jdText || "");
  if (!raw.trim()) return "";

  const kept = raw
    .split(/\n\s*\n+/)
    .filter((block) => {
      if (!block.trim()) return false;
      if (!BOILERPLATE_BLOCK.test(block)) return true;
      return REAL_SECTION.test(block);
    })
    .map((block) =>
      block
        .split(/\n/)
        .filter((line) => !BOILERPLATE_LINE.test(line))
        .join("\n")
    )
    .join("\n\n");

  let cleaned = kept.trim();
  // Guard against an oddly formatted scrape (one giant block, no blank lines).
  if (cleaned.length < raw.trim().length * 0.3) {
    cleaned = raw
      .split(/\n/)
      .filter((line) => !BOILERPLATE_LINE.test(line))
      .join("\n")
      .trim();
  }

  const company = companyTokens(companyName);
  if (!company.size) return cleaned;
  return cleaned
    .split(/(\s+)/)
    .filter((chunk) => /\s/.test(chunk) || !company.has(normalizeAtsText(chunk)))
    .join("");
}

/** ALL-CAPS ("SOQL") or internal capital ("MuleSoft") reads as a technology. */
function looksTechnicalInSource(term, sourceText) {
  if (!/^[a-z][a-z0-9]*$/.test(term)) return true;
  if (new RegExp(`\\b${term.toUpperCase()}\\b`).test(sourceText)) return true;
  const camels = sourceText.match(/\b[A-Z][a-z]+[A-Z][A-Za-z]*\b/g) || [];
  return camels.some((c) => c.toLowerCase() === term);
}

function classifyTerm(term, { sourceText, catalog }) {
  const stem = stemTerm(term);
  if (catalog.some((p) => p.re.test(term))) return "hard";
  if (HARD_TERMS.has(term) || HARD_TERMS.has(stem)) return "hard";
  if (SOFT_TERMS.has(term) || SOFT_TERMS.has(stem)) return "soft";
  if (looksTechnicalInSource(term, sourceText)) return "hard";
  return "neutral";
}

/** Hard skills outrank soft skills, the way every major ATS weights them. */
const KIND_WEIGHT = { hard: 1, neutral: 0.55, soft: 0.2 };

function isStop(word) {
  return (
    word.length < 3 ||
    STOP_WORDS.has(word) ||
    /^\d+$/.test(word) ||
    /^(?:http|www|com)$/.test(word)
  );
}

/**
 * Weighted JD terms: unigrams plus repeated multi-word phrases.
 * Returns objects, not bare strings — callers that only need the words use topKeywords().
 */
export function extractJdTerms(
  jdText,
  { companyName = "", roleTrack = "sf", limit = 35, phraseLimit = 8, jobTitle = "" } = {}
) {
  const source = cleanJdForKeywords(jdText, { companyName });
  if (!source.trim()) return [];
  const catalog = getRoleTrack(normalizeRoleTrackId(roleTrack)).skillCatalog || [];
  const words = normalizeAtsText(source).split(" ").filter(Boolean);

  const unigrams = new Map();
  for (const word of words) {
    if (isStop(word)) continue;
    unigrams.set(word, (unigrams.get(word) || 0) + 1);
  }

  // Phrases: 2- and 3-word runs of non-stop words seen more than once.
  const phrases = new Map();
  for (const size of [2, 3]) {
    for (let i = 0; i + size <= words.length; i += 1) {
      const span = words.slice(i, i + size);
      if (span.some((w) => isStop(w))) continue;
      const phrase = span.join(" ");
      phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
    }
  }

  // Phrases lifted straight out of the job title are scored by titleAlignment.
  // Charging keywordMatch for them too would punish the resume for obeying the
  // house rule that forbids pasting the JD title verbatim.
  const titlePhrase = ` ${normalizeAtsText(jobTitle)} `;
  const isTitlePhrase = (phrase) =>
    titlePhrase.trim().length > 0 && titlePhrase.includes(` ${phrase} `);

  const phraseTerms = [...phrases.entries()]
    .filter(([phrase, count]) => count > 1 && !isTitlePhrase(phrase))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, phraseLimit)
    .map(([term]) => ({
      term,
      kind: catalog.some((p) => p.re.test(term)) ? "hard" : "neutral",
      phrase: true
    }));

  // A phrase already covers its own words — do not also charge for them.
  const inPhrase = new Set(phraseTerms.flatMap((p) => p.term.split(" ")));

  const unigramTerms = [...unigrams.entries()]
    .filter(([word]) => !inPhrase.has(word))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, limit - phraseTerms.length))
    .map(([term]) => ({
      term,
      kind: classifyTerm(term, { sourceText: source, catalog }),
      phrase: false
    }));

  return [...phraseTerms, ...unigramTerms]
    .map((t) => ({
      ...t,
      weight: (KIND_WEIGHT[t.kind] ?? 0.55) * (t.phrase ? 1.4 : 1),
      key: canonicalKey(t.term)
    }))
    .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term));
}

/** Backwards-compatible word list (buildMustProveBlock, prompts, tests). */
export function topKeywords(text, limit = 35, options = {}) {
  return extractJdTerms(text, { ...options, limit }).map((t) => t.term);
}

/**
 * Searchable index of a resume: canonical keys for every word and every
 * 2-/3-word run, so a JD phrase matches real prose rather than a keyword row.
 */
export function buildMatchIndex(haystack) {
  const words = normalizeAtsText(haystack).split(" ").filter(Boolean);
  const keys = new Set();
  for (let i = 0; i < words.length; i += 1) {
    keys.add(canonicalKey(words[i]));
    if (i + 1 < words.length) keys.add(canonicalKey(`${words[i]} ${words[i + 1]}`));
    if (i + 2 < words.length) {
      keys.add(canonicalKey(`${words[i]} ${words[i + 1]} ${words[i + 2]}`));
    }
  }
  return keys;
}

/**
 * Weighted coverage of JD terms by a resume section.
 * ratio is weight-based, so missing "MuleSoft" costs far more than missing
 * "collaboration" — matching how real ATS rank hard skills above soft ones.
 */
export function coverTerms(terms, haystack) {
  const list = Array.isArray(terms) ? terms : [];
  if (!list.length) {
    return { ratio: 1, matched: [], missing: [], matchedWeight: 0, totalWeight: 0 };
  }
  const index = buildMatchIndex(haystack);
  const matched = [];
  const missing = [];
  let matchedWeight = 0;
  let totalWeight = 0;
  for (const term of list) {
    const weight = Number(term?.weight) || 0;
    totalWeight += weight;
    if (index.has(term.key)) {
      matched.push(term);
      matchedWeight += weight;
    } else {
      missing.push(term);
    }
  }
  return {
    ratio: totalWeight ? matchedWeight / totalWeight : 1,
    matched,
    missing,
    matchedWeight,
    totalWeight
  };
}
