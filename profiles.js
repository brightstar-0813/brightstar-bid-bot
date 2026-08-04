import { PROMPT as matthewDaleHoffmanPrompt } from "./prompts/matthew-dale-hoffman.js";
import { PROMPT as coverLetterPrompt } from "./prompts/cover-letter.js";

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
    signatureTitle: "Salesforce Developer",
    masterResume: "",
    coverLetterPrompt: coverLetterPrompt
  },
  {
    id: COVER_LETTER_PROFILE_ID,
    label: "CoverLetter",
    promptTemplate: coverLetterPrompt,
    builtin: true,
    kind: "coverLetter"
  }
];

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
    location = ""
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
    .replaceAll("{LOCATION}", location);
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
  if (!p) {
    return {
      id: DEFAULT_PROFILE_ID,
      label: "Matthew Dale Hoffman (Salesforce)",
      name: "Matthew Dale Hoffman",
      email: "",
      phone: "",
      linkedin: "",
      location: "",
      masterResume: "",
      promptTemplate: "",
      coverLetterPrompt: "",
      resumeFilePrefix: "Matthew_Resume",
      templateId: "times-classic",
      signatureTitle: "Salesforce Developer",
      builtin: true,
      kind: "resume"
    };
  }
  return {
    id: p.id,
    label: p.label || p.name || "Person",
    name: p.name || p.label || "",
    email: p.email || "",
    phone: p.phone || "",
    linkedin: p.linkedin || "",
    location: p.location || "",
    masterResume: p.masterResume || "",
    promptTemplate: p.promptTemplate || "",
    coverLetterPrompt: p.coverLetterPrompt || "",
    resumeFilePrefix: p.resumeFilePrefix || "Resume",
    templateId: p.templateId || "times-classic",
    signatureTitle: p.signatureTitle || p.headline || "",
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
    location: person.location || ""
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
  masterResume = "",
  coverLetterPrompt = "",
  resumeFilePrefix = "",
  templateId = "",
  signatureTitle = ""
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
    masterResume: String(masterResume || ""),
    coverLetterPrompt: String(coverLetterPrompt || "").trim(),
    resumeFilePrefix: String(resumeFilePrefix || slugify(displayName).replace(/-/g, "_") || "Resume"),
    templateId: String(templateId || "times-classic").trim(),
    signatureTitle: String(signatureTitle || "").trim()
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
    masterResume: String(person?.masterResume || ""),
    promptTemplate: prompt,
    coverLetterPrompt: cl,
    resumeFilePrefix: String(person?.resumeFilePrefix || "Resume").trim() || "Resume",
    templateId: String(person?.templateId || "times-classic").trim(),
    signatureTitle: String(person?.signatureTitle || "").trim(),
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
  return {
    name: person.name || person.label || "",
    email: person.email || "",
    phone: person.phone || "",
    linkedin: person.linkedin || "",
    location: person.location || "",
    signatureTitle: person.signatureTitle || ""
  };
}
