import { PROMPT as sfSeniorPrompt } from "./prompts/sf-senior.js";
import { PROMPT as deSeniorPrompt } from "./prompts/de-senior.js";
import { PROMPT as fsSeniorPrompt } from "./prompts/fs-senior.js";
import { PROMPT as aiSeniorPrompt } from "./prompts/ai-senior.js";
import { PROMPT as coverLetterSfPrompt } from "./prompts/cover-letter.js";
import { PROMPT as coverLetterDePrompt } from "./prompts/cover-letter-de.js";
import { PROMPT as coverLetterFsPrompt } from "./prompts/cover-letter-fs.js";
import { PROMPT as coverLetterAiPrompt } from "./prompts/cover-letter-ai.js";

export const SESSION_ROLE_TRACK_KEY = "session_role_track";

export const ROLE_TRACK_IDS = ["sf", "de", "fs", "ai"];

const SF_SKILL_CATALOG = [
  { name: "Service Cloud", re: /\bservice cloud\b/i, group: "clouds" },
  { name: "Sales Cloud", re: /\bsales cloud\b/i, group: "clouds" },
  { name: "Salesforce Data Cloud", re: /\bdata cloud\b|\bsalesforce genie\b/i, group: "clouds" },
  { name: "Agentforce", re: /\bagentforce\b/i, group: "clouds" },
  { name: "Public Sector Solutions (PSS)", re: /\bpublic sector solutions\b|\bPSS\b/i, group: "clouds" },
  { name: "Experience Cloud", re: /\bexperience cloud\b|\bcommunity cloud\b/i, group: "clouds" },
  { name: "Health Cloud", re: /\bhealth cloud\b/i, group: "clouds" },
  { name: "Financial Services Cloud", re: /\bfinancial services cloud\b|\bFSC\b/i, group: "clouds" },
  { name: "Marketing Cloud", re: /\bmarketing cloud\b|\bpardot\b/i, group: "clouds" },
  { name: "Revenue Cloud", re: /\brevenue cloud\b/i, group: "clouds" },
  { name: "Commerce Cloud", re: /\bcommerce cloud\b/i, group: "clouds" },
  { name: "Nonprofit Cloud", re: /\bnonprofit cloud\b/i, group: "clouds" },
  { name: "Education Cloud", re: /\beducation cloud\b/i, group: "clouds" },
  { name: "Field Service (FSL)", re: /\bfield service\b|\bFSL\b/i, group: "clouds" },
  { name: "Salesforce CPQ", re: /\bCPQ\b/i, group: "platform" },
  { name: "OmniStudio", re: /\bomnistudio\b|\bomniscript\b|\bvlocity\b/i, group: "platform" },
  { name: "Document Generation (DocGen)", re: /\bdocgen\b|\bdocument generation\b|\bconga\b|\bdrawloop\b/i, group: "platform" },
  { name: "MuleSoft", re: /\bmulesoft\b|\banypoint\b/i, group: "platform" },
  { name: "Salesforce Shield", re: /\bsalesforce shield\b/i, group: "platform" },
  { name: "Omni-Channel", re: /\bomni-?channel\b/i, group: "platform" },
  { name: "Tableau", re: /\btableau\b/i, group: "platform" },
  { name: "Apex", re: /\bapex\b/i, group: "development" },
  { name: "Lightning Web Components (LWC)", re: /\bLWC\b|\blightning web components?\b/i, group: "development" },
  { name: "Flow", re: /\bflow builder\b|\brecord-triggered flow\b|\bsalesforce flow\b/i, group: "development" },
  { name: "SOQL", re: /\bSOQL\b/i, group: "development" }
];

const DE_SKILL_CATALOG = [
  { name: "Snowflake", re: /\bsnowflake\b/i, group: "warehouse" },
  { name: "BigQuery", re: /\bbigquery\b/i, group: "warehouse" },
  { name: "Amazon Redshift", re: /\bredshift\b/i, group: "warehouse" },
  { name: "Databricks", re: /\bdatabricks\b/i, group: "platform" },
  { name: "Delta Lake", re: /\bdelta lake\b/i, group: "platform" },
  { name: "dbt", re: /\bdbt\b/i, group: "transform" },
  { name: "Apache Airflow", re: /\bairflow\b/i, group: "orchestration" },
  { name: "Apache Kafka", re: /\bkafka\b/i, group: "streaming" },
  { name: "Apache Spark", re: /\bspark\b/i, group: "streaming" },
  { name: "Apache Flink", re: /\bflink\b/i, group: "streaming" },
  { name: "Azure Data Factory", re: /\bazure data factory\b|\badf\b/i, group: "orchestration" },
  { name: "Apache NiFi", re: /\bnifi\b/i, group: "orchestration" },
  { name: "Fivetran", re: /\bfivetran\b/i, group: "pipeline" },
  { name: "Talend", re: /\btalend\b/i, group: "pipeline" },
  { name: "SSIS", re: /\bssis\b/i, group: "pipeline" },
  { name: "PostgreSQL", re: /\bpostgres(?:ql)?\b/i, group: "database" },
  { name: "MongoDB", re: /\bmongodb\b/i, group: "database" }
];

const FS_SKILL_CATALOG = [
  { name: "React", re: /\breact(?:\.js|js)?\b/i, group: "frontend" },
  { name: "Next.js", re: /\bnext\.?js\b/i, group: "frontend" },
  { name: "TypeScript", re: /\btypescript\b|\bts\b/i, group: "language" },
  { name: "JavaScript", re: /\bjavascript\b|\bjs\b/i, group: "language" },
  { name: "Node.js", re: /\bnode\.?js\b/i, group: "backend" },
  { name: "Python", re: /\bpython\b/i, group: "language" },
  { name: "Java", re: /\bjava\b/i, group: "language" },
  { name: "GraphQL", re: /\bgraphql\b/i, group: "backend" },
  { name: "REST APIs", re: /\brest(?:ful)?\s+api\b|\brest api\b/i, group: "backend" },
  { name: "Docker", re: /\bdocker\b/i, group: "devops" },
  { name: "Kubernetes", re: /\bkubernetes\b|\bk8s\b/i, group: "devops" },
  { name: "AWS", re: /\baws\b|\bamazon web services\b/i, group: "cloud" },
  { name: "Azure", re: /\bazure\b/i, group: "cloud" },
  { name: "Google Cloud Platform (GCP)", re: /\bgcp\b|\bgoogle cloud\b/i, group: "cloud" },
  { name: "PostgreSQL", re: /\bpostgres(?:ql)?\b/i, group: "database" },
  { name: "Redis", re: /\bredis\b/i, group: "database" },
  { name: "MongoDB", re: /\bmongodb\b/i, group: "database" },
  { name: "CI/CD", re: /\bci\/cd\b|\bcontinuous integration\b/i, group: "devops" }
];

const AI_SKILL_CATALOG = [
  { name: "LLM evaluation", re: /\bllm evaluation\b|\bevaluat(?:e|ion).*llm\b/i, group: "evaluation" },
  { name: "RAG", re: /\brag\b|\bretrieval augmented\b/i, group: "evaluation" },
  { name: "Prompt engineering", re: /\bprompt engineering\b|\bprompt design\b/i, group: "evaluation" },
  { name: "LangChain", re: /\blangchain\b/i, group: "framework" },
  { name: "Hugging Face", re: /\bhugging\s*face\b/i, group: "framework" },
  { name: "OpenAI API", re: /\bopenai\b|\bgpt-?\d\b/i, group: "framework" },
  { name: "PyTorch", re: /\bpytorch\b/i, group: "ml" },
  { name: "TensorFlow", re: /\btensorflow\b/i, group: "ml" },
  { name: "Python", re: /\bpython\b/i, group: "language" },
  { name: "SQL", re: /\bsql\b/i, group: "language" },
  { name: "MLOps", re: /\bmlops\b/i, group: "ml" },
  { name: "Vector database", re: /\bvector (?:db|database)\b|\bpinecone\b|\bweaviate\b|\bchromadb\b/i, group: "evaluation" },
  { name: "A/B testing", re: /\ba\/b test\b|\bab test\b/i, group: "experimentation" },
  { name: "Regression testing", re: /\bregression test\b/i, group: "evaluation" }
];

const SF_ATS_APPENDIX = `
==================================================
ATS KEYWORD DENSITY (local match target ≥ 90/100)
==================================================
Mirror the job description's exact terminology throughout the JSON — do not paraphrase away keywords.
- Put the target job title (or its key words) in "headline".
- Every Tier 0 / must-have technology and every Salesforce product named in the JD must appear in: skills items, profile, AND at least two bullets across the two most recent roles.
- Prefer JD spellings: "Lightning Web Components", "Service Cloud", "SOQL", "Apex", "MuleSoft", "integration", "architecture", etc.
- technicalSummary should list the JD's top tools verbatim.
A resume that covers fewer than ~90% of the JD's distinctive tokens will be boosted and may be re-prompted until it clears 90.`.trim();

const DE_ATS_APPENDIX = `
==================================================
ATS KEYWORD DENSITY (local match target ≥ 90/100)
==================================================
Mirror the job description's exact terminology throughout the JSON.
- Put the target job title (or its key words) in "headline".
- Every Tier 0 / must-have data tool (Snowflake, dbt, Airflow, Kafka, Spark, etc.) must appear in skills, profile, AND at least two bullets across the two most recent roles.
- Prefer JD spellings for warehouses, orchestrators, and cloud platforms.
- technicalSummary should list the JD's top data stack verbatim.`.trim();

const FS_ATS_APPENDIX = `
==================================================
ATS KEYWORD DENSITY (local match target ≥ 90/100)
==================================================
Mirror the job description's exact terminology throughout the JSON.
- Put the target job title (or its key words) in "headline".
- Every Tier 0 / must-have framework, language, or cloud service must appear in skills, profile, AND at least two bullets across the two most recent roles.
- Prefer JD spellings: "React", "TypeScript", "Node.js", "Kubernetes", "CI/CD", etc.
- technicalSummary should list the JD's top stack verbatim.`.trim();

const AI_ATS_APPENDIX = `
==================================================
ATS KEYWORD DENSITY (local match target ≥ 90/100)
==================================================
Mirror the job description's exact terminology throughout the JSON.
- Put the target job title (or its key words) in "headline".
- Every Tier 0 / must-have evaluation, ML, or AI tool must appear in skills, profile, AND at least two bullets where honestly supportable.
- Prefer JD spellings: "LLM evaluation", "RAG", "Python", "experimentation", "regression testing", etc.
- Never invent AI experience to satisfy keywords — use adjacent engineering language when needed.`.trim();

/** @type {Record<string, object>} */
export const ROLE_TRACKS = {
  sf: {
    id: "sf",
    label: "Salesforce (SF)",
    shortLabel: "SF",
    prompt: sfSeniorPrompt,
    coverLetterPrompt: coverLetterSfPrompt,
    skillCatalog: SF_SKILL_CATALOG,
    groupToCategory: {
      clouds: "Salesforce Clouds",
      platform: "Salesforce Platform",
      development: "Salesforce Development"
    },
    primarySkillsCategory: "Salesforce Clouds",
    primaryRowMatcher: (category) => /\bclouds?\b/i.test(category) && !/architect/i.test(category),
    domainProductLabel: "Salesforce / platform products",
    roleIdentities: [
      "Salesforce Technical Architect",
      "Salesforce Solution Architect",
      "Senior Salesforce Engineer",
      "Senior Salesforce Developer",
      "Salesforce Consultant"
    ],
    atsAppendix: SF_ATS_APPENDIX,
    bulletInternalsHint:
      "Data Cloud means data streams, DMOs, identity resolution; Agentforce means agent topics, actions, Prompt Builder; Service Cloud means Cases, Queues, Omni-Channel routing; Apex/LWC/Flow mean concrete development artifacts."
  },
  de: {
    id: "de",
    label: "Data Engineering (DE)",
    shortLabel: "DE",
    prompt: deSeniorPrompt,
    coverLetterPrompt: coverLetterDePrompt,
    skillCatalog: DE_SKILL_CATALOG,
    groupToCategory: {
      pipeline: "ETL & Data Pipeline Development",
      warehouse: "Database, Data Lake & Warehouse",
      platform: "Big Data & Cloud",
      orchestration: "Data Orchestration",
      transform: "Data Modeling & Transformation",
      streaming: "Big Data & Cloud",
      database: "Database, Data Lake & Warehouse"
    },
    primarySkillsCategory: "ETL & Data Pipeline Development",
    primaryRowMatcher: (category) => /etl|pipeline|data pipeline/i.test(category),
    domainProductLabel: "data platform / pipeline tools",
    roleIdentities: [
      "Senior Data Engineer",
      "Senior Analytics Engineer",
      "Data Platform Engineer",
      "AI Data Engineer",
      "Cloud Data Engineer"
    ],
    atsAppendix: DE_ATS_APPENDIX,
    bulletInternalsHint:
      "Snowflake means warehouses, stages, tasks, streams; dbt means incremental models, snapshots, tests; Airflow means DAGs, sensors, backfills; Kafka means topics, partitions, consumer groups; Spark means jobs, stages, partitioning."
  },
  fs: {
    id: "fs",
    label: "Full Stack (FS)",
    shortLabel: "FS",
    prompt: fsSeniorPrompt,
    coverLetterPrompt: coverLetterFsPrompt,
    skillCatalog: FS_SKILL_CATALOG,
    groupToCategory: {
      language: "Programming Languages",
      frontend: "Frontend",
      backend: "Backend & APIs",
      cloud: "Cloud & DevOps",
      devops: "Cloud & DevOps",
      database: "Databases"
    },
    primarySkillsCategory: "Programming Languages",
    primaryRowMatcher: (category) => /programming|language/i.test(category),
    domainProductLabel: "stack / platform technologies",
    roleIdentities: [
      "Senior Full Stack Engineer",
      "Senior Software Engineer",
      "Backend Engineer",
      "Frontend Engineer",
      "Platform Engineer"
    ],
    atsAppendix: FS_ATS_APPENDIX,
    bulletInternalsHint:
      "React means components, hooks, state management; Node.js means Express/Fastify APIs, middleware; Kubernetes means deployments, services, ingress; CI/CD means pipelines, automated tests, deployment gates."
  },
  ai: {
    id: "ai",
    label: "AI / ML (AI)",
    shortLabel: "AI",
    prompt: aiSeniorPrompt,
    coverLetterPrompt: coverLetterAiPrompt,
    skillCatalog: AI_SKILL_CATALOG,
    groupToCategory: {
      evaluation: "AI & Evaluation",
      framework: "AI & Evaluation",
      ml: "AI & Evaluation",
      language: "Programming & Data",
      experimentation: "Data & Experimentation"
    },
    primarySkillsCategory: "AI & Evaluation",
    primaryRowMatcher: (category) => /\bai\b|evaluation|machine learning|\bml\b/i.test(category),
    domainProductLabel: "AI / evaluation technologies",
    roleIdentities: [
      "Senior AI Evaluation Engineer",
      "AI Quality Engineer",
      "LLM Evaluation Engineer",
      "Applied AI Engineer",
      "ML Engineer"
    ],
    atsAppendix: AI_ATS_APPENDIX,
    bulletInternalsHint:
      "LLM evaluation means rubrics, golden datasets, human/model judges; RAG means retrieval quality, chunking, grounding checks; regression testing means eval harnesses, baseline comparisons, failure taxonomies."
  }
};

export const ROLE_TRACK_LIST = ROLE_TRACK_IDS.map((id) => ROLE_TRACKS[id]);

export function normalizeRoleTrackId(value) {
  const id = String(value || "")
    .trim()
    .toLowerCase();
  return ROLE_TRACK_IDS.includes(id) ? id : "sf";
}

export function getRoleTrack(id) {
  return ROLE_TRACKS[normalizeRoleTrackId(id)];
}

export function jdRequiredSkills(jdText, roleTrack = "sf") {
  const jd = String(jdText || "");
  if (!jd.trim()) return [];
  const catalog = getRoleTrack(roleTrack).skillCatalog;
  return catalog.filter((p) => p.re.test(jd));
}

export function resolveRoleTrackForPerson(person) {
  if (person?.roleTrack) return normalizeRoleTrackId(person.roleTrack);
  const id = String(person?.id || "");
  if (id === "dmario-lewis" || id === "edrwin-revolorio") return "sf";
  return "sf";
}

export function resolveEffectiveRoleTrack(person, sessionOverride) {
  const session = String(sessionOverride ?? "").trim();
  if (session && ROLE_TRACK_IDS.includes(session)) return session;
  return resolveRoleTrackForPerson(person);
}

export function getTrackPromptTemplate(roleTrack) {
  return getRoleTrack(roleTrack).prompt;
}

export function getTrackCoverLetterTemplate(roleTrack) {
  return getRoleTrack(roleTrack).coverLetterPrompt;
}

export function getTrackAtsAppendix(roleTrack) {
  return getRoleTrack(roleTrack).atsAppendix;
}

export function isTrackDefaultPrompt(promptText, roleTrack) {
  const normalized = String(promptText || "").trim();
  if (!normalized) return true;
  if (roleTrack) return normalized === String(getRoleTrack(roleTrack).prompt).trim();
  return ROLE_TRACK_IDS.some((id) => normalized === String(getRoleTrack(id).prompt).trim());
}

export function isTrackDefaultCoverLetter(promptText, roleTrack) {
  const normalized = String(promptText || "").trim();
  if (!normalized) return true;
  if (roleTrack) return normalized === String(getRoleTrack(roleTrack).coverLetterPrompt).trim();
  return ROLE_TRACK_IDS.some((id) => normalized === String(getRoleTrack(id).coverLetterPrompt).trim());
}

export async function getSessionRoleTrack() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return "";
  const data = await chrome.storage.local.get(SESSION_ROLE_TRACK_KEY);
  const value = String(data[SESSION_ROLE_TRACK_KEY] ?? "").trim().toLowerCase();
  return ROLE_TRACK_IDS.includes(value) ? value : "";
}

export async function setSessionRoleTrack(id) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  const value = String(id ?? "").trim().toLowerCase();
  await chrome.storage.local.set({
    [SESSION_ROLE_TRACK_KEY]: ROLE_TRACK_IDS.includes(value) ? value : ""
  });
}

export function formatRoleTrackStatus(roleTrack, { sessionOverride = "", personTrack = "" } = {}) {
  const track = getRoleTrack(roleTrack);
  const session = String(sessionOverride || "").trim();
  const person = normalizeRoleTrackId(personTrack || roleTrack);
  if (session && session !== person) {
    return `${track.shortLabel} (session override)`;
  }
  return `${track.shortLabel} (person default)`;
}
