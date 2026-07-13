import { PROMPT as charlytonPrompt } from "./prompts/charlyton.js";

/** Built-in prompts shipped as separate files under /prompts. */
export const BUILTIN_PROFILES = [
  {
    id: "charlyton",
    label: "Charlyton Santana",
    promptTemplate: charlytonPrompt,
    builtin: true
  }
];

export const DEFAULT_PROFILE_ID = BUILTIN_PROFILES[0].id;

/** @deprecated Use BUILTIN_PROFILES or getAllProfiles(). */
export const PROFILES = BUILTIN_PROFILES;

const CUSTOM_PROFILES_KEY = "custom_profiles";

function slugify(name) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "profile";
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
    ...custom.map((p) => ({ ...p, builtin: false }))
  ];
}

export async function getProfileById(profileId) {
  const profiles = await getAllProfiles();
  return profiles.find((p) => p.id === profileId) || profiles[0];
}

export async function buildPrompt(profileId, jdText) {
  const profile = await getProfileById(profileId);
  if (!profile?.promptTemplate) {
    throw new Error("Selected profile has no prompt content.");
  }
  if (!profile.promptTemplate.includes("{JD}")) {
    throw new Error('Prompt must include the {JD} placeholder.');
  }
  return profile.promptTemplate.replace("{JD}", jdText);
}

export async function addCustomProfile({ label, promptTemplate }) {
  const name = String(label || "").trim();
  const prompt = String(promptTemplate || "").trim();

  if (!name) throw new Error("Profile name is required.");
  if (!prompt) throw new Error("Prompt content is required.");
  if (!prompt.includes("{JD}")) {
    throw new Error('Prompt content must include {JD} where the job description goes.');
  }

  const custom = await getCustomProfiles();
  const idBase = slugify(name);
  let id = `custom-${idBase}`;
  let n = 2;
  const used = new Set([
    ...BUILTIN_PROFILES.map((p) => p.id),
    ...custom.map((p) => p.id)
  ]);
  while (used.has(id)) {
    id = `custom-${idBase}-${n}`;
    n += 1;
  }

  const profile = {
    id,
    label: name,
    promptTemplate: prompt
  };
  custom.push(profile);
  await chrome.storage.local.set({ [CUSTOM_PROFILES_KEY]: custom });
  return profile;
}

export async function deleteCustomProfile(profileId) {
  const custom = await getCustomProfiles();
  const next = custom.filter((p) => p.id !== profileId);
  if (next.length === custom.length) {
    throw new Error("Only profiles you added can be deleted.");
  }
  await chrome.storage.local.set({ [CUSTOM_PROFILES_KEY]: next });
}
