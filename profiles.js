import { PROMPT as matthewDaleHoffmanPrompt } from "./prompts/matthew-dale-hoffman.js";
import { PROMPT as sandeepMahankaliPrompt } from "./prompts/sandeep-mahankali.js";
import { PROMPT as coverLetterPrompt } from "./prompts/cover-letter.js";
import {
  normalizeRequiredExperienceInput,
  parseRequiredExperienceFromPrompt,
  resolveExperienceRulesForPerson
} from "./experience-rules.js";

export const COVER_LETTER_PROFILE_ID = "cover-letter";

/** Built-in prompts shipped as separate files under /prompts. */
export const BUILTIN_PROFILES = [
  {
    id: "matthew-dale-hoffman",
    label: "Matthew Dale Hoffman (Salesforce)",
    promptTemplate: matthewDaleHoffmanPrompt,
    templateId: "times-classic",
    resumeFilePrefix: "Matthew_Resume",
    builtin: true,
    kind: "resume",
    name: "Matthew Dale Hoffman",
    email: "matthew.dale.hoffman0513@outlook.com",
    phone: "+1 (254) 708-9742",
    linkedin: "https://www.linkedin.com/in/hoffmantxstate/",
    location: "Georgetown, Texas, United States",
    address: "129 Cherry Ridge Rd",
    zip: "78628",
    gender: "",
    ethnicity: "",
    disability: "No, I do not have a disability",
    veteran: "I am not a protected veteran",
    citizenship: "US Citizen",
    workAuthorized: "Yes",
    sponsorship: "No",
    hispanicLatino: "",
    signatureTitle: "Senior Salesforce Engineer",
    masterResume: "",
    coverLetterPrompt: coverLetterPrompt,
    autofillExtras: {},
    // Repeat Accenture twice — two distinct roles in FIXED COMPANY HISTORY.
    requiredExperience: [
      "Accenture Federal Services",
      "Hallmark Cards",
      "TeleTech",
      "Accenture Federal Services"
    ]
  },
  {
    id: "sandeep-mahankali",
    label: "Sandeep Mahankali (Salesforce)",
    promptTemplate: sandeepMahankaliPrompt,
    templateId: "sandeep-classic",
    resumeFilePrefix: "Sandeep_Resume",
    builtin: true,
    kind: "resume",
    name: "Sandeep Mahankali",
    email: "msandeep129@outlook.com",
    phone: "+1 (669) 223-1191",
    linkedin: "https://www.linkedin.com/in/sandeep-mahankali-7b8652129/",
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
    signatureTitle: "Salesforce Technical Architect",
    masterResume: "",
    coverLetterPrompt: coverLetterPrompt,
    autofillExtras: {},
    requiredExperience: [
      "Taproot Solutions Inc",
      "Deloitte",
      "Avco Consulting, Inc.",
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
    id: COVER_LETTER_PROFILE_ID,
    label: "CoverLetter",
    promptTemplate: coverLetterPrompt,
    builtin: true,
    kind: "coverLetter"
  }
];

export { resolveExperienceRulesForPerson, normalizeRequiredExperienceInput, parseRequiredExperienceFromPrompt };

export const DEFAULT_PROFILE_ID = "matthew-dale-hoffman";

/** @deprecated Use BUILTIN_PROFILES or getAllProfiles(). */
export const PROFILES = BUILTIN_PROFILES;

const CUSTOM_PROFILES_KEY = "custom_profiles";
const ACTIVE_PERSON_ID_KEY = "active_person_id";

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
    address = ""
  } = {}
) {
  return String(template || "")
    .replaceAll("{JD}", jdText)
    .replaceAll("{JOB_TITLE}", jobTitle)
    .replaceAll("{COMPANY}", companyName)
    .replaceAll("{MASTER_RESUME}", masterResume)
    .replaceAll("{NAME}", name)
    .replaceAll("{EMAIL}", email)
    .replaceAll("{PHONE}", phone)
    .replaceAll("{LINKEDIN}", linkedin)
    .replaceAll("{LOCATION}", location)
    .replaceAll("{ADDRESS}", address);
}

export async function getCustomProfiles() {
  const data = await chrome.storage.local.get(CUSTOM_PROFILES_KEY);
  const list = data[CUSTOM_PROFILES_KEY];
  return Array.isArray(list) ? list : [];
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
  return data[ACTIVE_PERSON_ID_KEY] || DEFAULT_PROFILE_ID;
}

export async function setActivePersonId(profileId) {
  await chrome.storage.local.set({
    [ACTIVE_PERSON_ID_KEY]: profileId,
    selected_profile_id: profileId
  });
}

/** Active person used for prompts, contact autofill, and cover letter. */
export async function getActivePerson() {
  const id = await getActivePersonId();
  const person = await getProfileById(id);
  return normalizePerson(person);
}

function normalizePerson(p) {
  const empty = {
    id: DEFAULT_PROFILE_ID,
    label: "Matthew Dale Hoffman (Salesforce)",
    name: "Matthew Dale Hoffman",
    email: "",
    phone: "",
    linkedin: "",
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
    resumeFilePrefix: "Matthew_Resume",
    templateId: "times-classic",
    signatureTitle: "Salesforce Developer",
    autofillExtras: {},
    requiredExperience: [],
    builtin: true,
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
  return {
    ...empty,
    id: p.id,
    label: p.label || p.name || "Person",
    name: p.name || p.label || "",
    email: p.email || "",
    phone: p.phone || "",
    linkedin: p.linkedin || "",
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
    resumeFilePrefix: p.resumeFilePrefix || "Resume",
    templateId: p.templateId || "times-classic",
    signatureTitle: p.signatureTitle || p.headline || "",
    autofillExtras: extras,
    requiredExperience,
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
    address: person.address || ""
  };
}

export async function buildPrompt(profileId, jdText, extras = {}) {
  const profile = profileId ? await getProfileById(profileId) : await getActivePerson();
  const person = normalizePerson(profile);
  if (!person?.promptTemplate) {
    throw new Error("Selected profile has no prompt content.");
  }
  if (!person.promptTemplate.includes("{JD}")) {
    throw new Error("Prompt must include the {JD} placeholder.");
  }
  return applyPlaceholders(
    person.promptTemplate,
    personPlaceholderExtras(person, {
      jdText,
      jobTitle: extras.jobTitle || "",
      companyName: extras.companyName || "",
      masterResume: extras.masterResume
    })
  );
}

export async function buildCoverLetterPrompt({ jdText, jobTitle, companyName }) {
  const profile = await getCoverLetterProfile();
  const person = await getActivePerson();
  if (!profile?.promptTemplate) {
    throw new Error('CoverLetter profile is missing. Add a cover letter prompt on the active person.');
  }
  if (!profile.promptTemplate.includes("{JD}")) {
    throw new Error("CoverLetter prompt must include the {JD} placeholder.");
  }
  return applyPlaceholders(
    profile.promptTemplate,
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
  requiredExperience = []
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
  if (profileKind === "resume" && employers.length < 2) {
    throw new Error(
      "Add Required experience employers (one company per line, at least 2). Repeat a company if they had two roles there. Or include a FIXED COMPANY HISTORY section in the tailor prompt so employers can be detected."
    );
  }

  const profile = {
    id,
    label: displayName,
    promptTemplate: prompt,
    kind: profileKind,
    name: String(name || displayName).trim(),
    email: String(email || "").trim(),
    phone: String(phone || "").trim(),
    linkedin: String(linkedin || "").trim(),
    location: String(location || "").trim(),
    address: String(address || "").trim(),
    zip: String(zip || "").trim(),
    gender: String(gender || "").trim(),
    ethnicity: String(ethnicity || "").trim(),
    disability: String(disability || "").trim(),
    veteran: String(veteran || "").trim(),
    citizenship: String(citizenship || "").trim(),
    workAuthorized: String(workAuthorized || "").trim(),
    sponsorship: String(sponsorship || "").trim(),
    hispanicLatino: String(hispanicLatino || "").trim(),
    masterResume: String(masterResume || ""),
    coverLetterPrompt: String(coverLetterPrompt || "").trim(),
    resumeFilePrefix: String(resumeFilePrefix || slugify(displayName).replace(/-/g, "_") || "Resume"),
    templateId: String(templateId || "times-classic").trim(),
    signatureTitle: String(signatureTitle || "").trim(),
    autofillExtras: extras,
    requiredExperience: employers
  };
  custom.push(profile);
  await chrome.storage.local.set({ [CUSTOM_PROFILES_KEY]: custom });
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
    resumeFilePrefix: String(person?.resumeFilePrefix || "Resume").trim() || "Resume",
    templateId: String(person?.templateId || "times-classic").trim(),
    signatureTitle: String(person?.signatureTitle || "").trim(),
    autofillExtras:
      person?.autofillExtras && typeof person.autofillExtras === "object" && !Array.isArray(person.autofillExtras)
        ? { ...person.autofillExtras }
        : {},
    requiredExperience: (() => {
      let employers = normalizeRequiredExperienceInput(person?.requiredExperience);
      if (!employers.length) employers = parseRequiredExperienceFromPrompt(prompt);
      if (employers.length < 2) {
        throw new Error(
          "Add Required experience employers (one company per line, at least 2). Repeat a company for two roles at the same employer. Or include FIXED COMPANY HISTORY in the tailor prompt."
        );
      }
      return employers;
    })(),
    kind: "resume"
  };

  const custom = await getCustomProfiles();
  const isBuiltin = BUILTIN_PROFILES.some((b) => b.id === person?.id);
  const existingId = person?.id && !isBuiltin ? person.id : null;

  // Updating an existing custom profile
  if (existingId && custom.some((p) => p.id === existingId)) {
    const next = custom.map((p) => (p.id === existingId ? { ...p, ...payload, id: existingId, builtin: false } : p));
    await chrome.storage.local.set({ [CUSTOM_PROFILES_KEY]: next });
    await setActivePersonId(existingId);
    const profile = next.find((p) => p.id === existingId);
    return { profile, created: false, fromBuiltin: false };
  }

  // Built-in selected → save as new custom person (copy)
  const created = await addCustomProfile(payload);
  await setActivePersonId(created.id);
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
  [["earliest start", "start date", "available date", "availability date", "when can you start"], "earliestStartDate"],
  [["years of experience", "years experience", "total experience", "years of exp"], "yearsExperience"],
  [["relevant experience"], "relevantExperience"],
  [["github"], "githubUrl"],
  [["portfolio", "personal website", "website url"], "portfolioUrl"],
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
  [["address line 2", "address2", "apt", "suite", "unit"], "addressLine2"]
];

const APPLICANT_KEY_TO_PERSON = {
  email: "email",
  phone: "phone",
  linkedinUrl: "linkedin",
  addressLine1: "address",
  zipCode: "zip",
  gender: "gender",
  raceEthnicity: "ethnicity",
  disabilityStatus: "disability",
  veteranStatus: "veteran",
  workAuthorized: "workAuthorized",
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
  if (/american indian|alaska native/.test(t)) return "american_indian";
  if (/native hawaiian|pacific islander/.test(t)) return "native_hawaiian";
  if (/two or more|multiracial|mixed/.test(t)) return "two_or_more";
  if (/hispanic|latino|latinx/.test(t)) return "hispanic";
  if (/african american|\bblack\b/.test(t)) return "black";
  if (/\basian\b/.test(t)) return "asian";
  if (/\bwhite\b|caucasian/.test(t)) return "white";
  return t;
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
    earliestStartDate: "",
    backgroundCheckConsent: "",
    drugTestConsent: "",
    gender: "",
    hispanicLatino: "",
    raceEthnicity: "",
    veteranStatus: "",
    disabilityStatus: ""
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
  info.addressLine1 = String(person.address || "").trim();
  info.zipCode = String(person.zip || extras.zip || extras.postal || "").trim();
  info.city = loc.city;
  info.state = loc.state;
  info.country = loc.country || extras.country || "United States";
  info.cityCountryOfResidence = String(person.location || "").trim();
  info.gender = genderToken(person.gender);
  info.raceEthnicity = raceToken(person.ethnicity);
  info.disabilityStatus = disabilityToken(person.disability);
  info.veteranStatus = veteranToken(person.veteran);
  info.hispanicLatino = yesNoToken(person.hispanicLatino) || String(person.hispanicLatino || "").trim();
  info.workAuthorized = yesNoToken(person.workAuthorized) || String(person.workAuthorized || "").trim().toLowerCase();
  info.needsSponsorship = yesNoToken(person.sponsorship) || String(person.sponsorship || "").trim().toLowerCase();

  for (const [key, value] of Object.entries(extras)) {
    const v = String(value || "").trim();
    if (!v) continue;
    const field = matchExtraToApplicantKey(key);
    if (field && !String(info[field] || "").trim()) {
      if (["workAuthorized", "needsSponsorship", "willingToRelocate", "over18", "felonyConviction", "backgroundCheckConsent", "drugTestConsent", "hispanicLatino"].includes(field)) {
        info[field] = yesNoToken(v) || v;
      } else {
        info[field] = v;
      }
    }
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
