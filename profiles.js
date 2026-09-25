import { PROMPT as dmarioLewisPrompt } from "./prompts/dmario-lewis.js";
import { PROMPT as edrwinRevolorioPrompt } from "./prompts/edrwin-revolorio.js";
import { PROMPT as sandeepMahankaliPrompt } from "./prompts/sandeep-mahankali.js";
import { PROMPT as michaelIbeaPrompt } from "./prompts/michael-ibea.js";
import { PROMPT as carlosCapulongPrompt } from "./prompts/carlos-capulong.js";
import { PROMPT as davidOliveiraPrompt } from "./prompts/david-oliveira.js";
import { PROMPT as davidOliveiraDePrompt } from "./prompts/david-oliveira-de.js";
import { PROMPT as victorHolandaPrompt } from "./prompts/victor-holanda.js";
import { PROMPT as coverLetterPrompt } from "./prompts/cover-letter.js";
import { PROMPT as coverLetterDePrompt } from "./prompts/cover-letter-de.js";
import { PROMPT as genericSeniorPrompt } from "./prompts/generic-senior.js";
import {
  ATS_RECRUITER_PASS,
  getTrackAtsAppendix,
  getTrackCoverLetterTemplate,
  getTrackPromptTemplate,
  isTrackDefaultCoverLetter,
  isTrackDefaultPrompt,
  normalizeRoleTrackId,
  resolveEffectiveRoleTrack,
  resolveRoleTrackForPerson,
  ROLE_TRACK_LIST
} from "./role-tracks.js";
import {
  normalizeRequiredExperienceInput,
  parseRequiredExperienceFromPrompt,
  promptHasFixedCompanyHistory,
  resolveExperienceRulesForPerson
} from "./experience-rules.js";
import {
  buildStrongHumanizeAppendix,
  getStrongHumanizeMode,
  normalizeStrongHumanizeMode,
  shouldApplyStrongHumanize
} from "./prompts/humanize-resume.js";
import { SF_ENTERPRISE_PROJECT_BANK } from "./prompts/sf-enterprise-projects.js";
import {
  PROMPT as sfTestPrompt,
  SF_TEST_HEADLINE_OVERRIDE,
  getSfPromptVersion,
  normalizeSfPromptVersion
} from "./prompts/sf-test.js";
import { PROMPT as aiV2Prompt } from "./prompts/ai-v2.js";
import { PROMPT as resumeV3Prompt } from "./prompts/resume-v3.js";
import { buildMustProveBlock, selectProjectBankExcerpts } from "./ats-score.js";
import {
  normalizeResumeFilePrefix,
  outputDirFromPerson,
  resolveOutputDirForPerson
} from "./resume-profile.js";
import { DEFAULT_TEMPLATE_ID } from "./templates/index.js";
import { clearQa, cloneQaBank } from "./qa-store.js";
import {
  resolveSheetTabNameForPerson,
  sanitizeSheetTabName
} from "./sheets.js";

export const COVER_LETTER_PROFILE_ID = "cover-letter";
export const GENERIC_SENIOR_PROMPT = genericSeniorPrompt;

export { resolveEffectiveRoleTrack } from "./role-tracks.js";
export {
  ROLE_TRACK_LIST,
  getTrackPromptTemplate,
  getTrackCoverLetterTemplate,
  resolveRoleTrackForPerson,
  isTrackDefaultPrompt,
  isTrackDefaultCoverLetter
} from "./role-tracks.js";
export { defaultSheetTabNameForPerson, resolveSheetTabNameForPerson, sanitizeSheetTabName } from "./sheets.js";
export const GENERIC_COVER_LETTER_PROMPT = coverLetterPrompt;

/** Default ATS / MyWorkday account password for create-account + sign-in. */
export const DEFAULT_ATS_PASSWORD = "Brightstar@0813";

/** Built-in prompts shipped as separate files under /prompts. */
export const BUILTIN_PROFILES = [
  {
    id: "dmario-lewis",
    label: "D'Mario Lewis",
    roleTrack: "sf",
    promptTemplate: dmarioLewisPrompt,
    templateId: "ats-modern",
    resumeFilePrefix: "Lewis_Resume",
    sheetTabName: "Lewis-SF",
    outputDir: "Lewis-SF",
    builtin: true,
    kind: "resume",
    name: "D'Mario Lewis",
    email: "dmario.lewis1992@outlook.com",
    phone: "+1 (248) 340-3582",
    linkedin: "https://www.linkedin.com/in/dmario-lewis/",
    portfolio: "",
    password: DEFAULT_ATS_PASSWORD,
    location: "Muskegon, Michigan, United States",
    address: "1325 Sumac St",
    zip: "49445",
    gender: "",
    ethnicity: "",
    disability: "No, I do not have a disability",
    veteran: "I am not a protected veteran",
    citizenship: "US Citizen",
    workAuthorized: "Yes",
    sponsorship: "No",
    hispanicLatino: "",
    signatureTitle: "Senior Salesforce Engineer | Technical Architect",
    masterResume: "",
    coverLetterPrompt: coverLetterPrompt,
    autofillExtras: {},
    requiredExperience: [
      "Culligan International",
      "Fusion Academy",
      "HexArmor",
      "Christian Reformed Church in North America",
      "Bostwick Lake Congregation UCC",
      "Wolverine World Wide"
    ]
  },
  {
    id: "edrwin-revolorio",
    label: "Edrwin S Revolorio",
    roleTrack: "sf",
    promptTemplate: edrwinRevolorioPrompt,
    templateId: "ats-modern",
    resumeFilePrefix: "Revolorio_Resume",
    sheetTabName: "Edrwin-SF",
    outputDir: "Edrwin-SF",
    builtin: true,
    kind: "resume",
    name: "Edrwin S Revolorio",
    email: "edrwin.revolorio1996@outlook.com",
    phone: "+1 (317) 563-1795",
    linkedin: "https://www.linkedin.com/in/edwin-revolorio/",
    portfolio: "",
    password: DEFAULT_ATS_PASSWORD,
    location: "Indianapolis, Indiana, United States",
    address: "1633 Deloss St",
    zip: "46201",
    gender: "",
    ethnicity: "",
    disability: "No, I do not have a disability",
    veteran: "I am not a protected veteran",
    citizenship: "US Citizen",
    workAuthorized: "Yes",
    sponsorship: "No",
    hispanicLatino: "",
    signatureTitle: "Senior Salesforce Engineer | Technical Lead",
    masterResume: "",
    coverLetterPrompt: coverLetterPrompt,
    autofillExtras: {},
    requiredExperience: [
      "Accenture",
      "Capgemini",
      "Appirio",
      "Innoit",
      "Indiana University Serve IT Clinic"
    ]
  },
  {
    id: "sandeep-mahankali",
    label: "Sandeep Mahankali",
    roleTrack: "sf",
    promptTemplate: sandeepMahankaliPrompt,
    templateId: "ats-modern",
    resumeFilePrefix: "Mahankali_Resume",
    sheetTabName: "Sandeep-SF",
    outputDir: "Sandeep-SF",
    builtin: true,
    kind: "resume",
    name: "Sandeep Mahankali",
    email: "msandeep129@outlook.com",
    phone: "+1 (669) 223-1191",
    linkedin: "https://www.linkedin.com/in/sandeep-mahankali-7b8652129/",
    portfolio: "",
    password: DEFAULT_ATS_PASSWORD,
    location: "Round Rock, Texas, United States",
    address: "1462 Sawmill Xing",
    zip: "78665",
    gender: "",
    ethnicity: "",
    disability: "No, I do not have a disability",
    veteran: "I am not a protected veteran",
    citizenship: "US Citizen",
    workAuthorized: "Yes",
    sponsorship: "No",
    hispanicLatino: "",
    signatureTitle: "Senior Salesforce Technical Architect | Senior Salesforce Engineer",
    masterResume: "",
    coverLetterPrompt: coverLetterPrompt,
    autofillExtras: {},
    requiredExperience: [
      "Taproot Solutions Inc",
      "Deloitte",
      "Salesforce",
      "Altice USA",
      "Suddenlink Communications",
      "Allstate",
      "Visions Healthcare",
      "NovoTech Solutions",
      "Sejal Technologies"
    ]
  },
  {
    id: "michael-ibea",
    label: "Michael Haries Namuco Ibea",
    roleTrack: "sf",
    promptTemplate: michaelIbeaPrompt,
    templateId: "ats-modern",
    resumeFilePrefix: "Ibea_Resume",
    sheetTabName: "Michael-SF",
    outputDir: "Michael-SF",
    builtin: true,
    kind: "resume",
    name: "Michael Haries Namuco Ibea",
    email: "michaelhariesibea3@gmail.com",
    phone: "+63 948 803 6855",
    linkedin: "https://www.linkedin.com/in/michael-haries-ibea-0baa0a417/",
    portfolio: "",
    password: DEFAULT_ATS_PASSWORD,
    location: "Trece Martires, Calabarzon, Cavite, Philippines",
    address: "",
    zip: "",
    gender: "",
    ethnicity: "",
    disability: "No, I do not have a disability",
    veteran: "I am not a protected veteran",
    citizenship: "",
    workAuthorized: "Yes",
    sponsorship: "Yes",
    hispanicLatino: "",
    signatureTitle: "Senior Salesforce Application Systems Analyst / Salesforce Developer",
    masterResume: "",
    coverLetterPrompt: coverLetterPrompt,
    autofillExtras: {},
    requiredExperience: [
      "Intrado Life & Safety Inc",
      "Smart Park Inc",
      "Clibase Technology Inc",
      "App It"
    ]
  },
  {
    id: "carlos-capulong",
    label: "Carlos Padonan Capulong",
    roleTrack: "sf",
    promptTemplate: carlosCapulongPrompt,
    templateId: "ats-modern",
    resumeFilePrefix: "Capulong_Resume",
    sheetTabName: "Carlos-SF",
    outputDir: "Carlos-SF",
    builtin: true,
    kind: "resume",
    name: "Carlos Padonan Capulong",
    email: "carlos.capulong.ex@gmail.com",
    phone: "+63 924 519 4392",
    linkedin: "https://www.linkedin.com/in/carlos-capulong/",
    portfolio: "",
    password: DEFAULT_ATS_PASSWORD,
    location: "Malabon, National Capital Region, Philippines",
    address: "14 Luis St., Panghulo, City of Malabon",
    zip: "1470",
    gender: "",
    ethnicity: "",
    disability: "No, I do not have a disability",
    veteran: "I am not a protected veteran",
    citizenship: "",
    workAuthorized: "Yes",
    sponsorship: "Yes",
    hispanicLatino: "",
    signatureTitle: "Senior Salesforce Engineer",
    masterResume: "",
    coverLetterPrompt: coverLetterPrompt,
    autofillExtras: {},
    requiredExperience: [
      "Intrado Life & Safety Inc",
      "Simplus",
      "Third Pillar",
      "Pointwest Squad Inc",
      "Deloitte"
    ]
  },
  {
    id: "david-oliveira",
    label: "David Leandro de Oliveira (Salesforce)",
    roleTrack: "sf",
    promptTemplate: davidOliveiraPrompt,
    templateId: "ats-modern",
    resumeFilePrefix: "Oliveira_Resume",
    sheetTabName: "David-SF",
    outputDir: "David-SF",
    builtin: true,
    kind: "resume",
    name: "David Leandro de Oliveira",
    email: "davidoliveira2308l@gmail.com",
    phone: "+55 61 8212 1297",
    linkedin: "https://www.linkedin.com/in/davidleandro",
    portfolio: "",
    password: DEFAULT_ATS_PASSWORD,
    location: "Paulista, Pernambuco, Brazil",
    address: "",
    zip: "",
    gender: "",
    ethnicity: "",
    disability: "No, I do not have a disability",
    veteran: "I am not a protected veteran",
    citizenship: "",
    workAuthorized: "Yes",
    sponsorship: "Yes",
    hispanicLatino: "",
    signatureTitle: "Senior Salesforce Engineer",
    masterResume: "",
    coverLetterPrompt: coverLetterPrompt,
    autofillExtras: {},
    requiredExperience: [
      "Intrado",
      "S&P Global",
      "AI/R Everymind",
      "Pismo",
      "Concrete Solutions"
    ]
  },
  {
    id: "david-oliveira-de",
    label: "David Leandro de Oliveira (Data Engineering)",
    roleTrack: "de",
    promptTemplate: davidOliveiraDePrompt,
    templateId: "ats-modern",
    resumeFilePrefix: "Oliveira_Resume",
    sheetTabName: "David-DE",
    outputDir: "David-DE",
    builtin: true,
    kind: "resume",
    name: "David Leandro de Oliveira",
    email: "davidoliveira2308l@gmail.com",
    phone: "+55 61 8212 1297",
    linkedin: "https://www.linkedin.com/in/davidleandrodeoliveria0823/",
    portfolio: "",
    password: DEFAULT_ATS_PASSWORD,
    location: "Paulista, Pernambuco, Brazil",
    address: "",
    zip: "",
    gender: "",
    ethnicity: "",
    disability: "No, I do not have a disability",
    veteran: "I am not a protected veteran",
    citizenship: "",
    workAuthorized: "Yes",
    sponsorship: "Yes",
    hispanicLatino: "",
    signatureTitle: "Senior Analytics Engineer / Senior Data Engineer",
    masterResume: `David Leandro de Oliveira
Senior Data Engineer / Senior Analytics Engineer
Paulista, Pernambuco, Brazil | +55 61 8212 1297 | davidoliveira2308l@gmail.com
https://www.linkedin.com/in/davidleandrodeoliveria0823/

SUMMARY
Senior Data Engineer with 9+ years designing and optimizing scalable data platforms, backend services, and analytics workflows for SaaS, fintech, cybersecurity, retail, and enterprise environments. Strong in reliable pipelines, cloud data architecture, API-driven systems, and production analytics layers for reporting and operational visibility.

SKILLS
Python, SQL, Java, JavaScript, TypeScript, Bash; Apache Airflow, dbt, ELT/ETL, data modeling, data warehousing, incremental loads, data quality testing, data lineage; AWS, S3, Lambda, Redshift, Docker, Terraform, GitHub Actions, CI/CD, Linux; Snowflake, PostgreSQL, MySQL, SQL Server, MongoDB; REST APIs, Spring Boot, FastAPI, Flask, microservices; dimensional modeling, BI layers, reporting pipelines; pytest, JUnit, dbt tests. Also familiar with Kafka, Flink, Hadoop, NiFi, SSIS/SSRS, Azure Data Factory, BigQuery, GCP, Azure.

EXPERIENCE
Clevertech — Analytics Engineer | New York, United States | Remote | Jan 2024 - Present
dbt, Snowflake, Python, SQL analytics for US SaaS clients; dimensional models for subscriptions, accounts, billing, product usage; ELT from databases/APIs/cloud storage; dbt tests, freshness, GitHub Actions CI; warehouse optimization; Python API extraction utilities; Airflow observability; AWS/S3 and Terraform-supported environments.

Softbinator Technologies — Senior Data Engineer | Bucharest, Romania | Remote | Mar 2021 - Nov 2023
Python, SQL, Airflow, Snowflake, AWS S3, dbt, Redshift, Docker for fintech, SaaS, e-commerce, logistics clients; warehouse models and ELT; Airflow DAGs with retries/alerts/backfills; API/file/DB ingestion; warehouse optimization; Terraform and GitHub Actions; dbt tests and CI.

Concrete Solutions — Backend Engineer / Data Engineer | São Paulo, Brazil | On-site | Aug 2018 - Feb 2021
Java, Spring Boot, Python, SQL, PostgreSQL, AWS S3, Redshift, Airflow for retail and financial services; REST microservices; ELT to AWS analytics; query tuning; incremental processing; Docker and CI/CD collaboration.

Tempest Security Intelligence — Software Engineer Intern / Backend Developer | Recife, Pernambuco, Brazil | On-site | Jan 2017 - Jun 2018
Java, Python, SQL, Linux, REST APIs for cybersecurity platforms; security log normalization; SQL reporting; backend utilities and small Python automation.

EDUCATION
Federal University of Pernambuco — Bachelor's Degree in Mathematics and Computer Science | Sep 2013 - Dec 2017 | Recife, Brazil`,
    coverLetterPrompt: coverLetterDePrompt,
    autofillExtras: {},
    requiredExperience: [
      "Clevertech",
      "Softbinator Technologies",
      "Concrete Solutions",
      "Tempest Security Intelligence"
    ]
  },
  {
    id: "victor-holanda",
    label: "Victor Barros de Holanda",
    roleTrack: "sf",
    promptTemplate: victorHolandaPrompt,
    templateId: "ats-modern",
    resumeFilePrefix: "Holanda_Resume",
    sheetTabName: "Victor-SF",
    outputDir: "Victor-SF",
    builtin: true,
    kind: "resume",
    name: "Victor Barros de Holanda",
    email: "victor.holanda201@gmail.com",
    phone: "+55 81 9573 5610",
    linkedin: "https://www.linkedin.com/in/victorstardev1996",
    portfolio: "",
    password: DEFAULT_ATS_PASSWORD,
    location: "Paulista, Pernambuco, Brazil",
    address: "",
    zip: "",
    gender: "",
    ethnicity: "",
    disability: "No, I do not have a disability",
    veteran: "I am not a protected veteran",
    citizenship: "",
    workAuthorized: "Yes",
    sponsorship: "Yes",
    hispanicLatino: "",
    signatureTitle: "Senior Salesforce Engineer",
    masterResume: "",
    coverLetterPrompt: coverLetterPrompt,
    autofillExtras: {},
    requiredExperience: ["EPAM Systems", "Endava", "BairesDev", "Accenture"]
  },
  {
    id: COVER_LETTER_PROFILE_ID,
    label: "CoverLetter",
    promptTemplate: coverLetterPrompt,
    builtin: true,
    kind: "coverLetter"
  }
];

export {
  resolveExperienceRulesForPerson,
  normalizeRequiredExperienceInput,
  parseRequiredExperienceFromPrompt,
  promptHasFixedCompanyHistory
};

export const DEFAULT_PROFILE_ID = "dmario-lewis";

/** @deprecated Use BUILTIN_PROFILES or getAllProfiles(). */
export const PROFILES = BUILTIN_PROFILES;

const CUSTOM_PROFILES_KEY = "custom_profiles";
const ACTIVE_PERSON_ID_KEY = "active_person_id";
/** Per-person Google Sheet tab (+ legacy per-person workbook URLs). */
const PERSON_SHEET_KEY = "person_sheet_config";

export async function getPersonSheetConfig(personId) {
  const id = String(personId || "").trim();
  if (!id) return { spreadsheetUrl: "", sheetsWebAppUrl: "", sheetTabName: "", outputDir: "" };
  const data = await chrome.storage.local.get(PERSON_SHEET_KEY);
  const map =
    data[PERSON_SHEET_KEY] && typeof data[PERSON_SHEET_KEY] === "object" && !Array.isArray(data[PERSON_SHEET_KEY])
      ? data[PERSON_SHEET_KEY]
      : {};
  const row = map[id] && typeof map[id] === "object" ? map[id] : {};
  return {
    spreadsheetUrl: String(row.spreadsheetUrl || "").trim(),
    sheetsWebAppUrl: String(row.sheetsWebAppUrl || "").trim(),
    sheetTabName: sanitizeSheetTabName(row.sheetTabName || ""),
    outputDir: String(row.outputDir || "").trim()
  };
}

export async function setPersonSheetConfig(
  personId,
  { spreadsheetUrl, sheetsWebAppUrl, sheetTabName, outputDir } = {}
) {
  const id = String(personId || "").trim();
  if (!id) return;
  const data = await chrome.storage.local.get(PERSON_SHEET_KEY);
  const map = {
    ...(data[PERSON_SHEET_KEY] && typeof data[PERSON_SHEET_KEY] === "object" && !Array.isArray(data[PERSON_SHEET_KEY])
      ? data[PERSON_SHEET_KEY]
      : {})
  };
  const prev = map[id] && typeof map[id] === "object" ? map[id] : {};
  map[id] = {
    spreadsheetUrl:
      spreadsheetUrl !== undefined
        ? String(spreadsheetUrl || "").trim()
        : String(prev.spreadsheetUrl || "").trim(),
    sheetsWebAppUrl:
      sheetsWebAppUrl !== undefined
        ? String(sheetsWebAppUrl || "").trim()
        : String(prev.sheetsWebAppUrl || "").trim(),
    sheetTabName:
      sheetTabName !== undefined
        ? sanitizeSheetTabName(sheetTabName)
        : sanitizeSheetTabName(prev.sheetTabName || ""),
    outputDir:
      outputDir !== undefined ? String(outputDir || "").trim() : String(prev.outputDir || "").trim()
  };
  await chrome.storage.local.set({ [PERSON_SHEET_KEY]: map });
}

function slugify(name) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "profile";
}

export function applyPlaceholders(
  template,
  {
    jdText = "",
    jobTitle = "",
    companyName = "",
    masterResume = "",
    name = "",
    email = "",
    phone = "",
    linkedin = "",
    location = "",
    address = "",
    headline = "",
    sfProjectBank = SF_ENTERPRISE_PROJECT_BANK
  } = {}
) {
  return String(template || "")
    .replaceAll("{JD}", jdText)
    .replaceAll("{JOB_TITLE}", jobTitle)
    .replaceAll("{COMPANY}", companyName)
    .replaceAll("{MASTER_RESUME}", masterResume)
    .replaceAll("{SF_PROJECT_BANK}", sfProjectBank)
    .replaceAll("{NAME}", name)
    .replaceAll("{EMAIL}", email)
    .replaceAll("{PHONE}", phone)
    .replaceAll("{LINKEDIN}", linkedin)
    .replaceAll("{LOCATION}", location)
    .replaceAll("{ADDRESS}", address)
    .replaceAll("{HEADLINE}", headline);
}

const SF_PROJECT_BANK_APPENDIX =
  "\n\n==================================================\n" +
  "ENTERPRISE SALESFORCE PROJECTS REFERENCE LIBRARY\n" +
  "==================================================\n" +
  "Treat as PROJECT PATTERN AND ARCHITECTURE REFERENCE only — never as the candidate's claimed employers or official project titles.\n" +
  "Adapt patterns into EXISTING employers; never invent employers or paste bank titles as companies.\n\n" +
  "{SF_PROJECT_BANK}";

/** Prefer a JD-scored bank excerpt (~4–6k) over dumping the full library. */
export function resolveSfProjectBankForJd(jdText = "", { maxChars = 5500, maxProjects = 5 } = {}) {
  const excerpt = selectProjectBankExcerpts({
    jdText,
    missingProducts: [],
    bank: SF_ENTERPRISE_PROJECT_BANK,
    maxProjects,
    maxChars
  });
  return excerpt || String(SF_ENTERPRISE_PROJECT_BANK || "").slice(0, maxChars);
}

/** Append built-in SF project bank when the template lacks {SF_PROJECT_BANK}. */
export function ensureSfProjectBankInTemplate(template, roleTrack) {
  const track = normalizeRoleTrackId(roleTrack);
  const text = String(template || "");
  if (track !== "sf") return text;
  if (text.includes("{SF_PROJECT_BANK}") || text.includes("Patient 360 + EHR Integration Platform")) {
    return text;
  }
  return `${text.trimEnd()}${SF_PROJECT_BANK_APPENDIX}`;
}

/** Soft cap for total prompt size — trim bank first when humanize + person prompt bloat. */
export const MAX_RESUME_PROMPT_CHARS = 52000;

export function trimPromptToBudget(prompt, { maxChars = MAX_RESUME_PROMPT_CHARS } = {}) {
  const text = String(prompt || "");
  if (text.length <= maxChars) return text;
  const bankStart = text.indexOf("ENTERPRISE SALESFORCE PROJECTS REFERENCE LIBRARY");
  const bankMarker = "{SF_PROJECT_BANK}";
  // Prefer trimming after the bank header / between bank body and later appendices.
  if (bankStart >= 0) {
    const afterHeader = text.indexOf("\n", bankStart + 40);
    const bankBodyStart = afterHeader >= 0 ? afterHeader + 1 : bankStart;
    const mustProve = text.indexOf("MUST PROVE (first-pass evidence", bankBodyStart);
    const atsEv = text.indexOf("ATS EVIDENCE MATCH", bankBodyStart);
    const humanize = text.indexOf("STRONG HUMANIZE", bankBodyStart);
    const candidates = [mustProve, atsEv, humanize].filter((i) => i > bankBodyStart);
    const bankBodyEnd = candidates.length ? Math.min(...candidates) : text.length;
    const before = text.slice(0, bankBodyStart);
    const bankBody = text.slice(bankBodyStart, bankBodyEnd);
    const after = text.slice(bankBodyEnd);
    const overhead = before.length + after.length + 80;
    const keep = Math.max(1200, maxChars - overhead);
    if (bankBody.length > keep) {
      const trimmedBank =
        bankBody.slice(0, keep).trimEnd() +
        "\n\n[Project bank truncated to fit prompt budget — prioritize patterns already shown.]\n\n";
      return before + trimmedBank + after;
    }
  }
  // Fallback: hard slice keeping the end (JD / MUST PROVE / appendices often matter more).
  void bankMarker;
  return `${text.slice(0, Math.floor(maxChars * 0.35)).trimEnd()}\n\n[…prompt truncated…]\n\n${text.slice(-(Math.floor(maxChars * 0.6))).trimStart()}`;
}

const REMOVED_PERSON_IDS = new Set(["matthew-dale-hoffman"]);
const REMOVED_PERSON_NAME = /matthew\s+dale\s+hoffman/i;
/** Legacy Edrwin Houston number — always rewrite to Indianapolis. */
const EDRWIN_LEGACY_PHONE_RE = /(?:\+?1[\s\-.]*)?\(?713\)?[\s\-.]*(?:659)[\s\-.]*(?:9480)/;
const EDRWIN_CURRENT_PHONE = "+1 (317) 563-1795";

function isRemovedPerson(p) {
  const id = String(p?.id || "");
  const name = String(p?.name || p?.label || "");
  return (
    REMOVED_PERSON_IDS.has(id) ||
    id.startsWith("matthew-dale-hoffman") ||
    REMOVED_PERSON_NAME.test(name)
  );
}

function looksLikeEdrwinPerson(p) {
  const id = String(p?.id || "").toLowerCase();
  const name = String(p?.name || p?.label || "").toLowerCase();
  return id.includes("edrwin") || id.includes("revolorio") || /edrwin|revolorio/.test(name);
}

function normalizeEdrwinPhone(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return raw;
  if (EDRWIN_LEGACY_PHONE_RE.test(raw)) return EDRWIN_CURRENT_PHONE;
  return raw;
}

/** Drop retired built-in people (and saved copies) from this Chrome profile. */
async function purgeRemovedPeopleFromStorage() {
  const data = await chrome.storage.local.get([CUSTOM_PROFILES_KEY, ACTIVE_PERSON_ID_KEY, "selected_profile_id"]);
  const list = Array.isArray(data[CUSTOM_PROFILES_KEY]) ? data[CUSTOM_PROFILES_KEY] : [];
  const kept = list.filter((p) => !isRemovedPerson(p));
  let phoneFixed = false;
  const withPhones = kept.map((p) => {
    if (!looksLikeEdrwinPerson(p)) return p;
    const nextPhone = normalizeEdrwinPhone(p.phone) || EDRWIN_CURRENT_PHONE;
    if (nextPhone === p.phone) return p;
    phoneFixed = true;
    return { ...p, phone: nextPhone };
  });
  const patch = {};
  if (kept.length !== list.length || phoneFixed) patch[CUSTOM_PROFILES_KEY] = withPhones;
  const activeId = String(data[ACTIVE_PERSON_ID_KEY] || "");
  const selectedId = String(data.selected_profile_id || "");
  if (REMOVED_PERSON_IDS.has(activeId) || activeId.startsWith("matthew-dale-hoffman")) {
    patch[ACTIVE_PERSON_ID_KEY] = DEFAULT_PROFILE_ID;
  }
  if (REMOVED_PERSON_IDS.has(selectedId) || selectedId.startsWith("matthew-dale-hoffman")) {
    patch.selected_profile_id = DEFAULT_PROFILE_ID;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
}

export async function getCustomProfiles() {
  await purgeRemovedPeopleFromStorage();
  const data = await chrome.storage.local.get(CUSTOM_PROFILES_KEY);
  const list = data[CUSTOM_PROFILES_KEY];
  return Array.isArray(list) ? list.filter((p) => !isRemovedPerson(p)) : [];
}

export async function getAllProfiles() {
  const custom = await getCustomProfiles();
  return [
    ...BUILTIN_PROFILES,
    ...custom.map((p) => ({ ...p, builtin: false, kind: p.kind || "resume" }))
  ];
}

/** Profiles shown in the resume generator dropdown (excludes CoverLetter). */
export async function getResumeProfiles() {
  const profiles = await getAllProfiles();
  return profiles.filter((p) => p.kind !== "coverLetter" && p.id !== COVER_LETTER_PROFILE_ID);
}

export async function getProfileById(profileId) {
  const profiles = await getAllProfiles();
  return profiles.find((p) => p.id === profileId) || profiles.find((p) => p.kind === "resume") || profiles[0];
}

export async function getActivePersonId() {
  const data = await chrome.storage.local.get(ACTIVE_PERSON_ID_KEY);
  const raw = String(data[ACTIVE_PERSON_ID_KEY] || "").trim();
  if (!raw || raw === "__new__") return DEFAULT_PROFILE_ID;
  return raw;
}

export async function setActivePersonId(profileId) {
  await chrome.storage.local.set({
    [ACTIVE_PERSON_ID_KEY]: profileId,
    selected_profile_id: profileId
  });
  // Keep Downloads folder + PDF prefix in lockstep with the active person (custom + built-in).
  try {
    const person = await getActivePerson();
    await syncActivePersonOutputContext(person);
  } catch {
    /* ignore — profile may be mid-create */
  }
}

/** Default US apply / EEO answers for new custom people (matches built-in parity). */
export const US_APPLICANT_DEFAULTS = {
  disability: "No, I do not have a disability",
  veteran: "I am not a protected veteran",
  citizenship: "US Citizen",
  workAuthorized: "Yes",
  sponsorship: "No"
};

export function applyUsApplicantDefaults(person = {}, { onlyEmpty = true } = {}) {
  const next = { ...(person || {}) };
  for (const [key, value] of Object.entries(US_APPLICANT_DEFAULTS)) {
    if (onlyEmpty && String(next[key] || "").trim()) continue;
    next[key] = value;
  }
  return next;
}

/**
 * Persist Applications-{Person} + resume_file_prefix + PDF template from the person record.
 * Call after save / activate so batch Start never freezes on bare "Applications".
 */
export async function syncActivePersonOutputContext(person) {
  const p = normalizePerson(person);
  const resumeFilePrefix = normalizeResumeFilePrefix(p.resumeFilePrefix, p.name || p.label);
  const sheet = p.id ? await getPersonSheetConfig(p.id).catch(() => ({})) : {};
  const sheetTabName = resolveSheetTabNameForPerson({
    ...p,
    sheetTabName: p.sheetTabName || sheet.sheetTabName || ""
  });
  const outputDir = resolveOutputDirForPerson({
    ...p,
    resumeFilePrefix,
    sheetTabName,
    outputDir: sheetTabName
  });
  const templateId = String(p.templateId || DEFAULT_TEMPLATE_ID).trim() || DEFAULT_TEMPLATE_ID;
  await chrome.storage.local.set({
    output_dir: outputDir,
    batch_output_dir: outputDir,
    resume_file_prefix: resumeFilePrefix,
    selected_template_id: templateId
  });
  return { outputDir, resumeFilePrefix, templateId, personFolder: sheetTabName, saveRoot: "" };
}

/** Active person used for prompts, contact autofill, and cover letter. */
export async function getActivePerson() {
  const id = await getActivePersonId();
  const person = normalizePerson(await getProfileById(id));
  const sheet = await getPersonSheetConfig(person.id);
  const sheetTabName = resolveSheetTabNameForPerson({
    ...person,
    sheetTabName: sheet.sheetTabName || person.sheetTabName || ""
  });
  return {
    ...person,
    spreadsheetUrl: sheet.spreadsheetUrl || person.spreadsheetUrl || "",
    sheetsWebAppUrl: sheet.sheetsWebAppUrl || person.sheetsWebAppUrl || "",
    sheetTabName,
    outputDir:
      sanitizeSheetTabName(sheet.outputDir || sheet.sheetTabName || person.outputDir || person.sheetTabName || "") ||
      sheetTabName
  };
}

function normalizePerson(p) {
  const empty = {
    id: DEFAULT_PROFILE_ID,
    label: "Person",
    name: "",
    email: "",
    phone: "",
    linkedin: "",
    portfolio: "",
    password: DEFAULT_ATS_PASSWORD,
    location: "",
    address: "",
    zip: "",
    gender: "",
    ethnicity: "",
    disability: "",
    veteran: "",
    citizenship: "",
    workAuthorized: "",
    sponsorship: "",
    hispanicLatino: "",
    masterResume: "",
    promptTemplate: "",
    coverLetterPrompt: "",
    resumeFilePrefix: "Applicant_Resume",
    templateId: DEFAULT_TEMPLATE_ID,
    signatureTitle: "",
    roleTrack: "sf",
    autofillExtras: {},
    requiredExperience: [],
    workHistory: [],
    educationHistory: [],
    spreadsheetUrl: "",
    sheetsWebAppUrl: "",
    sheetTabName: "",
    outputDir: "",
    builtin: false,
    kind: "resume"
  };
  if (!p) return empty;
  const extras =
    p.autofillExtras && typeof p.autofillExtras === "object" && !Array.isArray(p.autofillExtras)
      ? { ...p.autofillExtras }
      : {};
  let requiredExperience = normalizeRequiredExperienceInput(p.requiredExperience);
  // Backfill from FIXED COMPANY HISTORY when older custom profiles omit the field.
  if (!requiredExperience.length && p.promptTemplate) {
    requiredExperience = parseRequiredExperienceFromPrompt(p.promptTemplate);
  }
  const portfolioFromExtras =
    String(extras.portfolio || extras["portfolio url"] || extras["personal website"] || extras.website || "").trim();
  return {
    ...empty,
    id: p.id,
    label: p.label || p.name || "Person",
    name: p.name || p.label || "",
    email: p.email || "",
    phone: p.phone || "",
    linkedin: p.linkedin || "",
    portfolio: String(p.portfolio || portfolioFromExtras || "").trim(),
    password: String(p.password || DEFAULT_ATS_PASSWORD).trim() || DEFAULT_ATS_PASSWORD,
    location: p.location || "",
    address: p.address || "",
    zip: p.zip || "",
    gender: p.gender || "",
    ethnicity: p.ethnicity || "",
    disability: p.disability || "",
    veteran: p.veteran || "",
    citizenship: p.citizenship || "",
    workAuthorized: p.workAuthorized || "",
    sponsorship: p.sponsorship || "",
    hispanicLatino: p.hispanicLatino || "",
    masterResume: p.masterResume || "",
    promptTemplate: p.promptTemplate || "",
    coverLetterPrompt: p.coverLetterPrompt || "",
    resumeFilePrefix: normalizeResumeFilePrefix(p.resumeFilePrefix, p.name || p.label || ""),
    templateId: p.templateId || DEFAULT_TEMPLATE_ID,
    signatureTitle: p.signatureTitle || p.headline || "",
    roleTrack: normalizeRoleTrackId(p.roleTrack),
    autofillExtras: extras,
    requiredExperience,
    workHistory: Array.isArray(p.workHistory) ? p.workHistory : [],
    educationHistory: Array.isArray(p.educationHistory) ? p.educationHistory : [],
    spreadsheetUrl: p.spreadsheetUrl || "",
    sheetsWebAppUrl: p.sheetsWebAppUrl || "",
    sheetTabName: sanitizeSheetTabName(p.sheetTabName || ""),
    outputDir: String(p.outputDir || "").trim(),
    builtin: Boolean(p.builtin),
    kind: p.kind || "resume"
  };
}

/** Snapshot of a built-in for loading into the person editor (does not mutate shipped files). */
export function getBuiltinPreset(profileId) {
  const builtin = BUILTIN_PROFILES.find(
    (p) => p.id === profileId && p.kind !== "coverLetter" && p.id !== COVER_LETTER_PROFILE_ID
  );
  return builtin ? normalizePerson(builtin) : null;
}

export async function getCoverLetterProfile() {
  const active = await getActivePerson();
  if (active?.coverLetterPrompt && String(active.coverLetterPrompt).includes("{JD}")) {
    return {
      id: `${active.id}-cover-letter`,
      label: "CoverLetter",
      promptTemplate: active.coverLetterPrompt,
      kind: "coverLetter",
      builtin: false
    };
  }

  const profiles = await getAllProfiles();
  const customOverride = [...profiles]
    .reverse()
    .find(
      (p) =>
        !p.builtin &&
        (p.kind === "coverLetter" ||
          String(p.label || "").toLowerCase().replace(/\s+/g, "") === "coverletter")
    );
  if (customOverride) return customOverride;

  return (
    profiles.find((p) => p.id === COVER_LETTER_PROFILE_ID) ||
    profiles.find((p) => p.kind === "coverLetter") ||
    null
  );
}

const BUILTIN_SF_PROFILE_IDS = new Set([
  "dmario-lewis",
  "edrwin-revolorio",
  "sandeep-mahankali",
  "michael-ibea",
  "carlos-capulong",
  "david-oliveira",
  "victor-holanda"
]);

const BUILTIN_DE_PROFILE_IDS = new Set(["david-oliveira-de"]);

function isBuiltinSfProfile(person) {
  return BUILTIN_SF_PROFILE_IDS.has(String(person?.id || ""));
}

function isBuiltinDeProfile(person) {
  return BUILTIN_DE_PROFILE_IDS.has(String(person?.id || ""));
}

/** Resume prompt for the active engineering track (session or saved default). */
export function resolvePromptTemplateForTrack(person, roleTrack) {
  const track = normalizeRoleTrackId(roleTrack);
  const rawPrompt = String(person?.promptTemplate || "");
  const prompt = rawPrompt.trim();
  const hasRichPrompt =
    Boolean(prompt) &&
    (promptHasFixedCompanyHistory(prompt) || !isTrackDefaultPrompt(prompt));

  // Built-ins and Save-as-mine copies with FIXED COMPANY HISTORY / custom rich prompts
  // keep their template when the session track matches that person's engineering track.
  if (
    track === "sf" &&
    (isBuiltinSfProfile(person) ||
      (promptHasFixedCompanyHistory(prompt) && resolveRoleTrackForPerson(person) === "sf"))
  ) {
    return prompt ? rawPrompt : getTrackPromptTemplate(track);
  }
  if (
    track === "de" &&
    (isBuiltinDeProfile(person) ||
      (promptHasFixedCompanyHistory(prompt) && resolveRoleTrackForPerson(person) === "de"))
  ) {
    return prompt ? rawPrompt : getTrackPromptTemplate(track);
  }

  const personTrack = resolveRoleTrackForPerson(person);
  if (track !== personTrack) {
    // Session override: only keep a rich non-default prompt when it already targets this track.
    if (hasRichPrompt && !isTrackDefaultPrompt(prompt) && personTrack === track) {
      return rawPrompt;
    }
    return getTrackPromptTemplate(track);
  }
  if (hasRichPrompt) return rawPrompt;
  return getTrackPromptTemplate(track);
}

/**
 * Resume prompt after the v1 / test / v2 / v3 switch.
 * Test replaces the person's stored prompt on the SF track only.
 * v2 is the shared AI prompt. v3 is the shared ATS resume prompt.
 * Both apply for any person and any track.
 * Employer checks still read person.promptTemplate, not this result.
 */
export function resolveResumePromptForVersion(person, roleTrack, sfPromptVersion = "v1") {
  const version = normalizeSfPromptVersion(sfPromptVersion);
  if (version === "v2") return aiV2Prompt;
  if (version === "v3") return resumeV3Prompt;
  const track = normalizeRoleTrackId(roleTrack);
  if (track === "sf" && version === "test") return sfTestPrompt;
  return resolvePromptTemplateForTrack(person, roleTrack);
}

/** Cover letter prompt for the active engineering track. */
export function resolveCoverLetterTemplateForTrack(person, roleTrack) {
  const track = normalizeRoleTrackId(roleTrack);
  const personTrack = resolveRoleTrackForPerson(person);
  if (track !== personTrack) {
    return getTrackCoverLetterTemplate(track);
  }
  const cover = String(person?.coverLetterPrompt || "").trim();
  if (cover && !isTrackDefaultCoverLetter(cover)) {
    return cover;
  }
  if (cover) return cover;
  return getTrackCoverLetterTemplate(track);
}

function personPlaceholderExtras(person, extras = {}) {
  return {
    jdText: extras.jdText || "",
    jobTitle: extras.jobTitle || "",
    companyName: extras.companyName || "",
    masterResume: extras.masterResume != null ? extras.masterResume : person.masterResume || "",
    name: person.name || "",
    email: person.email || "",
    phone: person.phone || "",
    linkedin: person.linkedin || "",
    location: person.location || "",
    address: person.address || "",
    headline: extras.headline || person.signatureTitle || person.headline || ""
  };
}

export async function buildPrompt(profileId, jdText, extras = {}) {
  const profile = profileId ? await getProfileById(profileId) : await getActivePerson();
  const person = normalizePerson(profile);
  const roleTrack = normalizeRoleTrackId(
    extras.roleTrack ||
      resolveEffectiveRoleTrack(person, extras.sessionRoleTrack || "")
  );
  const sfPromptVersion = normalizeSfPromptVersion(
    extras.sfPromptVersion != null ? extras.sfPromptVersion : await getSfPromptVersion()
  );
  const resolvedTemplate = resolveResumePromptForVersion(person, roleTrack, sfPromptVersion);
  const promptTemplate =
    sfPromptVersion === "v2"
      ? resolvedTemplate
      : ensureSfProjectBankInTemplate(resolvedTemplate, roleTrack);
  if (!promptTemplate) {
    throw new Error("Selected profile has no prompt content.");
  }
  if (!promptTemplate.includes("{JD}")) {
    throw new Error("Prompt must include the {JD} placeholder.");
  }
  const sfProjectBank =
    roleTrack === "sf"
      ? resolveSfProjectBankForJd(jdText, {
          maxChars: Number(extras.sfBankMaxChars) > 0 ? Number(extras.sfBankMaxChars) : 5500,
          maxProjects: Number(extras.sfBankMaxProjects) > 0 ? Number(extras.sfBankMaxProjects) : 5
        })
      : "";
  const body = applyPlaceholders(
    promptTemplate,
    {
      ...personPlaceholderExtras(person, {
        jdText,
        jobTitle: extras.jobTitle || "",
        companyName: extras.companyName || "",
        masterResume: extras.masterResume
      }),
      sfProjectBank: sfProjectBank || SF_ENTERPRISE_PROJECT_BANK
    }
  );
  const instructionTrack = sfPromptVersion === "v2" ? "ai" : roleTrack;
  const mustProve = buildMustProveBlock(jdText, instructionTrack, {
    companyName: extras.companyName || ""
  });
  const atsAppendix = getTrackAtsAppendix(instructionTrack);
  let prompt = mustProve ? `${body}\n\n${mustProve}\n\n${atsAppendix}` : `${body}\n\n${atsAppendix}`;

  const humanizeMode = normalizeStrongHumanizeMode(
    extras.strongHumanizeMode != null
      ? extras.strongHumanizeMode
      : extras.strongHumanize === true
        ? "on"
        : extras.strongHumanize === false
          ? "off"
          : await getStrongHumanizeMode()
  );
  const applyHumanize =
    extras.forceStrongHumanize === true ||
    shouldApplyStrongHumanize(humanizeMode, {
      jdLink: extras.jdLink || "",
      site: extras.site || ""
    });
  if (applyHumanize) {
    prompt = `${prompt}\n\n${buildStrongHumanizeAppendix(instructionTrack)}`;
  }
  const additional = String(extras.additionalPrompt || "").trim();
  if (additional) {
    prompt = `${prompt}\n\n---\nAdditional instructions for this job only (follow in addition to the rules above):\n${additional}`;
  }
  if (roleTrack === "sf" && sfPromptVersion === "test") {
    prompt = `${prompt}\n\n${SF_TEST_HEADLINE_OVERRIDE}`;
  }
  prompt = `${prompt}\n\n${ATS_RECRUITER_PASS}`;
  return trimPromptToBudget(prompt, {
    maxChars: Number(extras.maxPromptChars) > 0 ? Number(extras.maxPromptChars) : MAX_RESUME_PROMPT_CHARS
  });
}

export async function buildCoverLetterPrompt({ jdText, jobTitle, companyName, roleTrack, sessionRoleTrack } = {}) {
  const person = await getActivePerson();
  const effectiveTrack = normalizeRoleTrackId(
    roleTrack || resolveEffectiveRoleTrack(person, sessionRoleTrack || "")
  );
  const promptTemplate = resolveCoverLetterTemplateForTrack(person, effectiveTrack);
  if (!promptTemplate) {
    throw new Error("CoverLetter profile is missing. Add a cover letter prompt on the active person.");
  }
  if (!promptTemplate.includes("{JD}")) {
    throw new Error("CoverLetter prompt must include the {JD} placeholder.");
  }
  return applyPlaceholders(
    promptTemplate,
    personPlaceholderExtras(person, { jdText, jobTitle, companyName })
  );
}

export async function addCustomProfile({
  label,
  promptTemplate,
  kind = "resume",
  name = "",
  email = "",
  phone = "",
  linkedin = "",
  portfolio = "",
  password = DEFAULT_ATS_PASSWORD,
  location = "",
  address = "",
  zip = "",
  gender = "",
  ethnicity = "",
  disability = "",
  veteran = "",
  citizenship = "",
  workAuthorized = "",
  sponsorship = "",
  hispanicLatino = "",
  masterResume = "",
  coverLetterPrompt = "",
  resumeFilePrefix = "",
  templateId = "",
  signatureTitle = "",
  autofillExtras = {},
  requiredExperience = [],
  workHistory = [],
  educationHistory = [],
  roleTrack = "sf",
  spreadsheetUrl = "",
  sheetsWebAppUrl = "",
  sheetTabName = "",
  outputDir = ""
} = {}) {
  const displayName = String(label || name || "").trim();
  const prompt = String(promptTemplate || "").trim();

  if (!displayName) throw new Error("Profile name is required.");
  if (!prompt) throw new Error("Prompt content is required.");
  if (!prompt.includes("{JD}")) {
    throw new Error("Prompt content must include {JD} where the job description goes.");
  }

  const custom = await getCustomProfiles();
  const idBase = slugify(displayName);
  let id = `custom-${idBase}`;
  let n = 2;
  const used = new Set([...BUILTIN_PROFILES.map((p) => p.id), ...custom.map((p) => p.id)]);
  while (used.has(id)) {
    id = `custom-${idBase}-${n}`;
    n += 1;
  }

  const profileKind =
    kind === "coverLetter" || displayName.toLowerCase().replace(/\s+/g, "") === "coverletter"
      ? "coverLetter"
      : "resume";

  const extras =
    autofillExtras && typeof autofillExtras === "object" && !Array.isArray(autofillExtras)
      ? { ...autofillExtras }
      : {};

  let employers = normalizeRequiredExperienceInput(requiredExperience);
  if (!employers.length && profileKind === "resume") {
    employers = parseRequiredExperienceFromPrompt(prompt);
  }
  if (profileKind === "resume" && employers.length < 1 && !String(masterResume || "").trim()) {
    if (!promptHasFixedCompanyHistory(prompt)) {
      throw new Error(
        "Add Required experience employers (one company per line), or upload a master resume so employers can be detected."
      );
    }
  }

  const seeded = applyUsApplicantDefaults({
    disability: String(disability || "").trim(),
    veteran: String(veteran || "").trim(),
    citizenship: String(citizenship || "").trim(),
    workAuthorized: String(workAuthorized || "").trim(),
    sponsorship: String(sponsorship || "").trim()
  });

  const profile = {
    id,
    label: displayName,
    promptTemplate: prompt,
    kind: profileKind,
    name: String(name || displayName).trim(),
    email: String(email || "").trim(),
    phone: String(phone || "").trim(),
    linkedin: String(linkedin || "").trim(),
    portfolio: String(portfolio || "").trim(),
    password: String(password || DEFAULT_ATS_PASSWORD).trim() || DEFAULT_ATS_PASSWORD,
    location: String(location || "").trim(),
    address: String(address || "").trim(),
    zip: String(zip || "").trim(),
    gender: String(gender || "").trim(),
    ethnicity: String(ethnicity || "").trim(),
    disability: seeded.disability,
    veteran: seeded.veteran,
    citizenship: seeded.citizenship,
    workAuthorized: seeded.workAuthorized,
    sponsorship: seeded.sponsorship,
    hispanicLatino: String(hispanicLatino || "").trim(),
    masterResume: String(masterResume || ""),
    coverLetterPrompt: String(coverLetterPrompt || "").trim(),
    resumeFilePrefix: normalizeResumeFilePrefix(
      resumeFilePrefix,
      String(name || displayName).trim()
    ),
    templateId: String(templateId || DEFAULT_TEMPLATE_ID).trim() || DEFAULT_TEMPLATE_ID,
    signatureTitle: String(signatureTitle || "").trim(),
    roleTrack: normalizeRoleTrackId(roleTrack),
    autofillExtras: extras,
    requiredExperience: employers,
    workHistory: Array.isArray(workHistory) ? workHistory : [],
    educationHistory: Array.isArray(educationHistory) ? educationHistory : [],
    spreadsheetUrl: String(spreadsheetUrl || "").trim(),
    sheetsWebAppUrl: String(sheetsWebAppUrl || "").trim(),
    sheetTabName: resolveSheetTabNameForPerson({
      label: displayName,
      name,
      roleTrack: normalizeRoleTrackId(roleTrack),
      sheetTabName
    }),
    outputDir: ""
  };
  profile.outputDir = String(outputDir || "").trim() || profile.sheetTabName;
  custom.push(profile);
  await chrome.storage.local.set({ [CUSTOM_PROFILES_KEY]: custom });
  await setPersonSheetConfig(profile.id, {
    spreadsheetUrl: profile.spreadsheetUrl,
    sheetsWebAppUrl: profile.sheetsWebAppUrl,
    sheetTabName: profile.sheetTabName,
    outputDir: profile.outputDir
  });
  return profile;
}

/**
 * Create or update a custom person. Built-ins cannot be overwritten — save as a new custom copy.
 * @returns {{ profile: object, created: boolean, fromBuiltin: boolean }}
 */
export async function savePersonProfile(person) {
  const displayName = String(person?.label || person?.name || "").trim();
  const prompt = String(person?.promptTemplate || "").trim();
  if (!displayName) throw new Error("Display name is required.");
  if (!prompt) throw new Error("Resume tailor prompt is required — paste ChatGPT instructions (not the job description).");
  if (!prompt.includes("{JD}")) {
    throw new Error("Add {JD} in the tailor prompt — each CSV job’s description is inserted there automatically.");
  }

  const cl = String(person?.coverLetterPrompt || "").trim();
  if (cl && !cl.includes("{JD}")) {
    throw new Error("Cover letter prompt must include {JD} when set.");
  }

  const payload = {
    label: displayName,
    name: String(person?.name || displayName).trim(),
    email: String(person?.email || "").trim(),
    phone: String(person?.phone || "").trim(),
    linkedin: String(person?.linkedin || "").trim(),
    portfolio: String(person?.portfolio || "").trim(),
    password: String(person?.password || DEFAULT_ATS_PASSWORD).trim() || DEFAULT_ATS_PASSWORD,
    location: String(person?.location || "").trim(),
    address: String(person?.address || "").trim(),
    zip: String(person?.zip || "").trim(),
    gender: String(person?.gender || "").trim(),
    ethnicity: String(person?.ethnicity || "").trim(),
    disability: String(person?.disability || "").trim(),
    veteran: String(person?.veteran || "").trim(),
    citizenship: String(person?.citizenship || "").trim(),
    workAuthorized: String(person?.workAuthorized || "").trim(),
    sponsorship: String(person?.sponsorship || "").trim(),
    hispanicLatino: String(person?.hispanicLatino || "").trim(),
    masterResume: String(person?.masterResume || ""),
    promptTemplate: prompt,
    coverLetterPrompt: cl,
    resumeFilePrefix: normalizeResumeFilePrefix(person?.resumeFilePrefix, displayName),
    templateId: String(person?.templateId || DEFAULT_TEMPLATE_ID).trim() || DEFAULT_TEMPLATE_ID,
    signatureTitle: String(person?.signatureTitle || "").trim(),
    roleTrack: normalizeRoleTrackId(person?.roleTrack),
    autofillExtras:
      person?.autofillExtras && typeof person.autofillExtras === "object" && !Array.isArray(person.autofillExtras)
        ? { ...person.autofillExtras }
        : {},
    requiredExperience: (() => {
      let employers = normalizeRequiredExperienceInput(person?.requiredExperience);
      if (!employers.length) employers = parseRequiredExperienceFromPrompt(prompt);
      if (
        employers.length < 1 &&
        !String(person?.masterResume || "").trim() &&
        !promptHasFixedCompanyHistory(prompt)
      ) {
        throw new Error(
          "Add Required experience employers (one company per line), or upload a master resume so employers can be detected."
        );
      }
      return employers;
    })(),
    // undefined = preserve existing history on update (inline editor has no wizard)
    workHistory: Array.isArray(person?.workHistory) ? person.workHistory : undefined,
    educationHistory: Array.isArray(person?.educationHistory) ? person.educationHistory : undefined,
    spreadsheetUrl: String(person?.spreadsheetUrl || "").trim(),
    sheetsWebAppUrl: String(person?.sheetsWebAppUrl || "").trim(),
    sheetTabName: resolveSheetTabNameForPerson({
      label: displayName,
      name: person?.name,
      roleTrack: normalizeRoleTrackId(person?.roleTrack),
      sheetTabName: person?.sheetTabName
    }),
    outputDir: "",
    kind: "resume"
  };
  payload.outputDir = String(person?.outputDir || "").trim() || payload.sheetTabName;

  const custom = await getCustomProfiles();
  const isBuiltin = BUILTIN_PROFILES.some((b) => b.id === person?.id);
  const existingId = person?.id && !isBuiltin ? person.id : null;

  // Updating an existing custom profile
  if (existingId && custom.some((p) => p.id === existingId)) {
    const prev = custom.find((p) => p.id === existingId) || {};
    const mergedPayload = {
      ...payload,
      workHistory:
        payload.workHistory !== undefined
          ? payload.workHistory
          : Array.isArray(prev.workHistory)
            ? prev.workHistory
            : [],
      educationHistory:
        payload.educationHistory !== undefined
          ? payload.educationHistory
          : Array.isArray(prev.educationHistory)
            ? prev.educationHistory
            : []
    };
    const next = custom.map((p) =>
      p.id === existingId ? { ...p, ...mergedPayload, id: existingId, builtin: false } : p
    );
    await chrome.storage.local.set({ [CUSTOM_PROFILES_KEY]: next });
    await setActivePersonId(existingId);
    await setPersonSheetConfig(existingId, {
      spreadsheetUrl: mergedPayload.spreadsheetUrl,
      sheetsWebAppUrl: mergedPayload.sheetsWebAppUrl,
      sheetTabName: resolveSheetTabNameForPerson({
        label: displayName,
        name: mergedPayload.name,
        roleTrack: mergedPayload.roleTrack,
        sheetTabName: mergedPayload.sheetTabName
      }),
      outputDir: mergedPayload.outputDir || mergedPayload.sheetTabName
    });
    const profile = next.find((p) => p.id === existingId);
    await syncActivePersonOutputContext(profile);
    return { profile, created: false, fromBuiltin: false };
  }

  // Built-in selected → save as new custom person (copy)
  const forkPayload = applyUsApplicantDefaults({
    ...payload,
    workHistory: Array.isArray(payload.workHistory) ? payload.workHistory : person?.workHistory || [],
    educationHistory: Array.isArray(payload.educationHistory)
      ? payload.educationHistory
      : person?.educationHistory || []
  });
  const created = await addCustomProfile(forkPayload);
  await setActivePersonId(created.id);
  if (person?.id && created?.id && person.id !== created.id) {
    await cloneQaBank(person.id, created.id).catch(() => 0);
  }
  return { profile: created, created: true, fromBuiltin: isBuiltin };
}

export async function updateCustomProfile(profileId, updates) {
  const custom = await getCustomProfiles();
  const idx = custom.findIndex((p) => p.id === profileId);
  if (idx < 0) throw new Error("Only custom profiles can be updated.");

  const prompt = updates.promptTemplate != null ? String(updates.promptTemplate).trim() : custom[idx].promptTemplate;
  if (prompt && !prompt.includes("{JD}")) {
    throw new Error("Resume prompt must include {JD}.");
  }
  const cl =
    updates.coverLetterPrompt != null
      ? String(updates.coverLetterPrompt).trim()
      : custom[idx].coverLetterPrompt || "";
  if (cl && !cl.includes("{JD}")) {
    throw new Error("Cover letter prompt must include {JD} when set.");
  }

  custom[idx] = {
    ...custom[idx],
    ...updates,
    id: profileId,
    promptTemplate: prompt,
    coverLetterPrompt: cl,
    resumeFilePrefix: normalizeResumeFilePrefix(
      updates.resumeFilePrefix != null ? updates.resumeFilePrefix : custom[idx].resumeFilePrefix,
      updates.name || updates.label || custom[idx].name || custom[idx].label || ""
    ),
    builtin: false,
    kind: custom[idx].kind || "resume"
  };
  await chrome.storage.local.set({ [CUSTOM_PROFILES_KEY]: custom });
  return custom[idx];
}

export async function deleteCustomProfile(profileId) {
  const custom = await getCustomProfiles();
  const next = custom.filter((p) => p.id !== profileId);
  if (next.length === custom.length) {
    throw new Error("Only profiles you added can be deleted.");
  }
  await chrome.storage.local.set({ [CUSTOM_PROFILES_KEY]: next });

  // Drop per-person sheet URLs and Q&A bank for this custom person.
  try {
    const data = await chrome.storage.local.get(PERSON_SHEET_KEY);
    const map =
      data[PERSON_SHEET_KEY] && typeof data[PERSON_SHEET_KEY] === "object" && !Array.isArray(data[PERSON_SHEET_KEY])
        ? { ...data[PERSON_SHEET_KEY] }
        : {};
    if (map[profileId]) {
      delete map[profileId];
      await chrome.storage.local.set({ [PERSON_SHEET_KEY]: map });
    }
  } catch {
    /* ignore */
  }
  await clearQa(profileId).catch(() => {});

  try {
    const resumeMapData = await chrome.storage.local.get([
      "last_resume_json_by_profile",
      "last_resume_json_profile_id"
    ]);
    const resumeMap = {
      ...(resumeMapData.last_resume_json_by_profile &&
      typeof resumeMapData.last_resume_json_by_profile === "object"
        ? resumeMapData.last_resume_json_by_profile
        : {})
    };
    if (resumeMap[profileId]) {
      delete resumeMap[profileId];
      const patch = { last_resume_json_by_profile: resumeMap };
      if (String(resumeMapData.last_resume_json_profile_id || "") === profileId) {
        patch.last_resume_json_profile_id = "";
      }
      await chrome.storage.local.set(patch);
    }
  } catch {
    /* ignore */
  }

  const activeId = await getActivePersonId();
  if (activeId === profileId) {
    await setActivePersonId(DEFAULT_PROFILE_ID);
  }
}

/** Contact fields used for ATS autofill / cover letter signature. */
export async function getAutofillContact() {
  const person = await getActivePerson();
  const location = person.location || "";
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    name: person.name || person.label || "",
    email: person.email || "",
    phone: person.phone || "",
    linkedin: person.linkedin || "",
    location,
    address: person.address || "",
    zip: person.zip || "",
    city: parts[0] || "",
    state: parts[1] || "",
    country: parts[2] || parts[parts.length - 1] || "",
    gender: person.gender || "",
    ethnicity: person.ethnicity || "",
    disability: person.disability || "",
    veteran: person.veteran || "",
    citizenship: person.citizenship || "",
    workAuthorized: person.workAuthorized || "",
    sponsorship: person.sponsorship || "",
    hispanicLatino: person.hispanicLatino || "",
    signatureTitle: person.signatureTitle || "",
    extras: person.autofillExtras || {}
  };
}

/**
 * Merge newly learned autofill values into the active custom person.
 * Built-in profiles are skipped (caller should Save as my person first).
 */
export async function mergeAutofillExtras(learned) {
  if (!learned || typeof learned !== "object") return null;
  const person = await getActivePerson();
  if (!person?.id || person.builtin) return null;
  const nextExtras = { ...(person.autofillExtras || {}) };
  let changed = false;
  for (const [key, value] of Object.entries(learned)) {
    const k = String(key || "").trim().toLowerCase();
    const v = String(value || "").trim();
    if (!k || !v) continue;
    if (nextExtras[k] === v) continue;
    nextExtras[k] = v;
    changed = true;
  }
  // Promote well-known keys onto first-class fields when empty.
  const patch = { ...person, autofillExtras: nextExtras };
  const promote = [
    ["address", ["address", "street address", "address line 1"]],
    ["zip", ["zip", "postal", "postal code"]],
    ["gender", ["gender", "sex"]],
    ["ethnicity", ["ethnicity", "race", "race ethnicity"]],
    ["disability", ["disability", "disabled"]],
    ["veteran", ["veteran", "veteran status"]],
    ["citizenship", ["citizenship", "citizen"]],
    ["workAuthorized", ["work authorized", "authorized to work", "work authorization"]],
    ["sponsorship", ["sponsorship", "visa sponsorship", "require sponsorship"]],
    ["hispanicLatino", ["hispanic", "latino", "hispanic latino"]]
  ];
  for (const [field, keys] of promote) {
    if (patch[field]) continue;
    for (const k of keys) {
      if (learned[k]) {
        patch[field] = String(learned[k]).trim();
        changed = true;
        break;
      }
    }
  }
  if (!changed) return person;
  const result = await savePersonProfile(patch);
  return result?.profile || patch;
}

const EXTRA_TO_APPLICANT_KEY = [
  [["desired salary", "expected salary", "salary expectation", "salary", "compensation", "pay expectation"], "salaryExpectation"],
  [["years of experience", "years experience", "total experience", "years of exp", "total years of relevant experience", "years of relevant experience"], "yearsExperience"],
  [["relevant experience", "describe your experience"], "relevantExperience"],
  [["current employer", "current company", "present employer"], "currentEmployer"],
  [["current job title", "current title", "current position"], "currentJobTitle"],
  [["earliest start", "start date", "available date", "availability date", "when can you start"], "earliestStartDate"],
  [["github"], "githubUrl"],
  [["portfolio", "personal website", "website url", "website"], "portfolioUrl"],
  [["willing to relocate", "relocate", "relocation"], "willingToRelocate"],
  [["over 18", "18 years", "at least 18"], "over18"],
  [["felony", "criminal conviction", "conviction"], "felonyConviction"],
  [["background check"], "backgroundCheckConsent"],
  [["drug test"], "drugTestConsent"],
  [["preferred name", "nickname"], "preferredName"],
  [["middle name"], "middleName"],
  [["highest degree", "education level"], "highestDegree"],
  [["school name", "university", "college"], "schoolName"],
  [["field of study", "major"], "fieldOfStudy"],
  [["graduation date", "graduated"], "graduationDate"],
  [["why are you interested", "why do you want", "why this role"], "whyInterested"],
  [["english level", "english proficiency"], "englishLevel"],
  [["address line 2", "address2", "apt", "suite", "unit"], "addressLine2"],
  [["how did you hear", "how did you hear about us", "source", "general source"], "howDidYouHear"],
  [["terms and conditions", "consent to the terms", "read and consent"], "termsConsent"],
  [["signature", "print name", "typed name", "applicant name"], "signatureName"],
  [["todays date", "today's date", "signature date", "date signed"], "signatureDate"],
  [["language", "preferred language"], "selfIdentifyLanguage"]
];

const APPLICANT_KEY_TO_PERSON = {
  email: "email",
  phone: "phone",
  linkedinUrl: "linkedin",
  portfolioUrl: "portfolio",
  addressLine1: "address",
  zipCode: "zip",
  gender: "gender",
  raceEthnicity: "ethnicity",
  disabilityStatus: "disability",
  veteranStatus: "veteran",
  workAuthorized: "workAuthorized",
  citizenship: "citizenship",
  needsSponsorship: "sponsorship",
  hispanicLatino: "hispanicLatino"
};

function splitPersonName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ")
  };
}

function parsePersonLocation(location) {
  const parts = String(location || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    city: parts[0] || "",
    state: parts.length >= 2 ? parts[1] : "",
    country: parts.length >= 3 ? parts[parts.length - 1] : ""
  };
}

function yesNoToken(value) {
  const t = String(value || "").trim().toLowerCase();
  if (!t) return "";
  if (/^(yes|y|true|1)\b/.test(t) || /^yes\b/.test(t)) return "yes";
  if (
    /^(no|n|false|0)\b/.test(t) ||
    /^no\b/.test(t) ||
    /^i (am not|do not|don't|do not want)/.test(t)
  ) {
    return "no";
  }
  return "";
}

function disabilityToken(value) {
  const t = String(value || "").trim().toLowerCase();
  if (!t) return "";
  if (/decline|prefer not|do not want to answer|do not wish/.test(t)) return "decline";
  if (/do not have a disability|don't have a disability|no disability/.test(t)) return "no";
  const yn = yesNoToken(t);
  if (yn) return yn;
  return t;
}

function veteranToken(value) {
  const t = String(value || "").trim().toLowerCase();
  if (!t) return "";
  if (/decline|prefer not|do not wish/.test(t)) return "decline";
  if (/not a (protected )?veteran|i am not a veteran/.test(t)) return "not_veteran";
  if (/protected veteran|i identify as|i am a veteran/.test(t)) return "protected_veteran";
  const yn = yesNoToken(t);
  if (yn === "no") return "not_veteran";
  if (yn === "yes") return "protected_veteran";
  return t;
}

function genderToken(value) {
  const t = String(value || "").trim().toLowerCase();
  if (!t) return "";
  if (/non[-\s]?binary/.test(t)) return "non_binary";
  if (/^f\b|female|woman/.test(t)) return "female";
  if (/^m\b|male|man/.test(t) && !/female/.test(t)) return "male";
  if (/other|self/.test(t)) return "other";
  return t;
}

function raceToken(value) {
  const t = String(value || "").trim().toLowerCase();
  if (!t) return "";
  if (/prefer not|decline|not specified|do not wish|do not want/.test(t)) return "not_specified";
  if (/american indian|alaska native/.test(t)) return "american_indian";
  if (/native hawaiian|pacific islander/.test(t)) return "native_hawaiian";
  if (/two or more|multiracial|mixed/.test(t)) return "two_or_more";
  if (/hispanic|latino|latinx/.test(t)) return "hispanic";
  if (/african american|\bblack\b/.test(t)) return "black";
  if (/\basian\b/.test(t)) return "asian";
  if (/\bwhite\b|caucasian/.test(t)) return "white";
  return t;
}

/** Login credentials for MyWorkday create-account / sign-in steps. */
export function personToAtsCredentials(person = {}) {
  return {
    email: String(person.email || "").trim(),
    username: String(person.email || "").trim(),
    password: String(person.password || DEFAULT_ATS_PASSWORD).trim() || DEFAULT_ATS_PASSWORD
  };
}

function matchExtraToApplicantKey(extraKey) {
  const k = String(extraKey || "").trim().toLowerCase();
  if (!k) return "";
  for (const [aliases, field] of EXTRA_TO_APPLICANT_KEY) {
    if (aliases.some((a) => k === a || k.includes(a) || a.includes(k))) return field;
  }
  return "";
}

function emptyApplicantInfo() {
  return {
    firstName: "",
    lastName: "",
    middleName: "",
    preferredName: "",
    email: "",
    phone: "",
    country: "United States",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    zipCode: "",
    cityCountryOfResidence: "",
    workAuthorized: "",
    needsSponsorship: "",
    postEmploymentRestrictions: "",
    willingToRelocate: "",
    over18: "",
    felonyConviction: "",
    felonyExplanation: "",
    yearsExperience: "",
    currentEmployer: "",
    currentJobTitle: "",
    relevantExperience: "",
    englishLevel: "",
    linkedinUrl: "",
    portfolioUrl: "",
    githubUrl: "",
    highestDegree: "",
    schoolName: "",
    fieldOfStudy: "",
    graduationDate: "",
    whyInterested: "",
    salaryExpectation: "",
    hourlyRate: "",
    earliestStartDate: "",
    backgroundCheckConsent: "",
    drugTestConsent: "",
    termsConsent: "yes",
    howDidYouHear: "",
    signatureName: "",
    signatureDate: "",
    selfIdentifyLanguage: "English",
    gender: "",
    hispanicLatino: "",
    raceEthnicity: "",
    veteranStatus: "",
    disabilityStatus: ""
  };
}

function todaysDateMmDdYyyy() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function estimateYearsFromWorkHistory(workHistory = []) {
  const rows = Array.isArray(workHistory) ? workHistory : [];
  let minYear = null;
  const nowY = new Date().getFullYear();
  for (const job of rows) {
    const y = Number(job?.startYear || job?.start?.year || 0);
    if (Number.isFinite(y) && y >= 1975 && y <= nowY) {
      if (minYear == null || y < minYear) minYear = y;
    }
  }
  if (minYear == null) return "";
  const years = nowY - minYear;
  if (years < 1 || years > 50) return "";
  return String(years);
}

function currentJobFromWorkHistory(workHistory = []) {
  const rows = Array.isArray(workHistory) ? workHistory : [];
  const current = rows.find((j) => j?.current) || rows[0] || null;
  if (!current) return { employer: "", title: "" };
  return {
    employer: String(current.company || "").trim(),
    title: String(current.title || "").trim()
  };
}

/** Map Brightstar person + extras onto the resume-bot applicant-info shape. */
export function personToApplicantInfo(person = {}) {
  const info = emptyApplicantInfo();
  const name = splitPersonName(person.name || person.label || "");
  const loc = parsePersonLocation(person.location || "");
  const extras =
    person.autofillExtras && typeof person.autofillExtras === "object" && !Array.isArray(person.autofillExtras)
      ? person.autofillExtras
      : person.extras && typeof person.extras === "object"
        ? person.extras
        : {};

  info.firstName = name.firstName;
  info.lastName = name.lastName;
  info.email = String(person.email || "").trim();
  info.phone = String(person.phone || "").trim();
  info.linkedinUrl = String(person.linkedin || "").trim();
  info.portfolioUrl = String(person.portfolio || extras.portfolio || extras["portfolio url"] || extras["personal website"] || "").trim();
  info.addressLine1 = String(person.address || "").trim();
  info.zipCode = String(person.zip || extras.zip || extras.postal || "").trim();
  info.city = loc.city;
  info.state = loc.state;
  info.country = loc.country || extras.country || "United States";
  info.cityCountryOfResidence = String(person.location || "").trim();
  info.gender = genderToken(person.gender);
  info.raceEthnicity = raceToken(person.ethnicity) || "not_specified";
  info.disabilityStatus = disabilityToken(person.disability);
  info.veteranStatus = veteranToken(person.veteran);
  info.hispanicLatino = yesNoToken(person.hispanicLatino) || String(person.hispanicLatino || "").trim();
  info.citizenship = String(person.citizenship || extras.citizenship || "").trim();
  info.workAuthorized = yesNoToken(person.workAuthorized) || String(person.workAuthorized || "").trim().toLowerCase();
  info.needsSponsorship = yesNoToken(person.sponsorship) || String(person.sponsorship || "").trim().toLowerCase();
  info.signatureName = String(person.name || person.label || `${name.firstName} ${name.lastName}`.trim()).trim();
  info.signatureDate = todaysDateMmDdYyyy();
  const eduRow = Array.isArray(person.educationHistory) ? person.educationHistory[0] : null;
  if (eduRow) {
    if (eduRow.school) info.schoolName = String(eduRow.school).trim();
    if (eduRow.degree) info.highestDegree = String(eduRow.degree).trim();
    if (eduRow.fieldOfStudy) info.fieldOfStudy = String(eduRow.fieldOfStudy).trim();
    const gradYear = String(eduRow.endYear || "").trim();
    const gradMonth = String(eduRow.endMonth || "05").trim().padStart(2, "0");
    if (gradYear) info.graduationDate = `${gradYear}-${gradMonth}`;
  }
  info.selfIdentifyLanguage = String(extras.language || extras["self identify language"] || "English").trim() || "English";
  info.howDidYouHear = String(
    extras["how did you hear"] ||
      extras["how did you hear about us"] ||
      extras.source ||
      extras["general source"] ||
      "Job Board"
  ).trim();
  info.termsConsent = "yes";

  const job = currentJobFromWorkHistory(person.workHistory);
  info.currentEmployer = String(
    extras["current employer"] || extras.currentEmployer || job.employer || ""
  ).trim();
  info.currentJobTitle = String(
    extras["current job title"] || extras.currentJobTitle || extras["current title"] || job.title || ""
  ).trim();
  info.yearsExperience = String(
    extras["years of experience"] ||
      extras["total years of relevant experience"] ||
      extras.yearsExperience ||
      extras["years experience"] ||
      ""
  ).trim();
  if (!info.yearsExperience) {
    info.yearsExperience = estimateYearsFromWorkHistory(person.workHistory);
  }

  for (const [key, value] of Object.entries(extras)) {
    const v = String(value || "").trim();
    if (!v) continue;
    const field = matchExtraToApplicantKey(key);
    if (field && !String(info[field] || "").trim()) {
      if (["workAuthorized", "needsSponsorship", "willingToRelocate", "over18", "felonyConviction", "backgroundCheckConsent", "drugTestConsent", "hispanicLatino", "termsConsent"].includes(field)) {
        info[field] = yesNoToken(v) || v;
      } else {
        info[field] = v;
      }
    }
  }

  // Compensation: only fill when person extras explicitly provide values.
  if (!String(info.salaryExpectation || "").trim()) {
    info.salaryExpectation = String(
      extras["desired salary"] || extras["expected salary"] || extras.compensation || ""
    ).trim();
  }
  if (!String(info.hourlyRate || "").trim()) {
    info.hourlyRate = String(
      extras["hourly rate"] || extras["desired hourly"] || extras.hourly || ""
    ).trim();
  }

  return info;
}

export async function getApplicantInfoForAutofill() {
  const person = await getActivePerson();
  const extras =
    person.autofillExtras && typeof person.autofillExtras === "object" ? person.autofillExtras : {};
  return {
    person,
    applicantInfo: personToApplicantInfo(person),
    credentials: personToAtsCredentials(person),
    extras: { ...extras, ...(person.citizenship ? { citizenship: person.citizenship } : {}) }
  };
}

/**
 * Learn-mode write-back: fill empty person fields or extras (custom persons only).
 */
export async function applyLearnedApplicantField(key, value) {
  const k = String(key || "").trim();
  const v = String(value || "").trim();
  if (!k || !v) return null;
  const person = await getActivePerson();
  if (!person?.id || person.builtin) return null;

  const personField = APPLICANT_KEY_TO_PERSON[k];
  if (personField) {
    if (String(person[personField] || "").trim()) return person;
    const result = await savePersonProfile({ ...person, [personField]: v });
    return result?.profile || person;
  }

  return mergeAutofillExtras({ [k]: v });
}
