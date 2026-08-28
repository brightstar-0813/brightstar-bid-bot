/**
 * Single source of truth for Person profile form read/fill/validate/completeness.
 * Used by profile-editor.html and any entry points (popup import, panel).
 */

import {
  savePersonProfile,
  addCustomProfile,
  BUILTIN_PROFILES,
  DEFAULT_ATS_PASSWORD
} from "./profiles.js";
import {
  normalizeRequiredExperienceInput,
  parseRequiredExperienceFromPrompt,
  requiredExperienceToText
} from "./experience-rules.js";
import { normalizeRoleTrackId } from "./role-tracks.js";

export { requiredExperienceToText };

export const PERSON_FIELD_GROUPS = {
  contact: ["label", "name", "email", "phone", "linkedin", "portfolio", "location", "address", "zip", "password"],
  apply: [
    "gender",
    "ethnicity",
    "disability",
    "veteran",
    "citizenship",
    "workAuthorized",
    "sponsorship",
    "hispanicLatino",
    "autofillExtras"
  ],
  resume: ["resumeFilePrefix", "signatureTitle", "masterResume", "requiredExperience"],
  prompts: ["roleTrack", "promptTemplate", "coverLetterPrompt", "templateId"],
  integrations: ["spreadsheetUrl", "sheetsWebAppUrl"]
};

/** Map person keys to form element ids in profile-editor / legacy popup. */
export const PERSON_FIELD_IDS = {
  label: "personLabel",
  name: "personName",
  email: "personEmail",
  phone: "personPhone",
  linkedin: "personLinkedin",
  portfolio: "personPortfolio",
  password: "personPassword",
  location: "personLocation",
  address: "personAddress",
  zip: "personZip",
  gender: "personGender",
  ethnicity: "personEthnicity",
  disability: "personDisability",
  veteran: "personVeteran",
  citizenship: "personCitizenship",
  workAuthorized: "personWorkAuthorized",
  sponsorship: "personSponsorship",
  hispanicLatino: "personHispanicLatino",
  autofillExtras: "personAutofillExtras",
  resumeFilePrefix: "personResumePrefix",
  signatureTitle: "personSignatureTitle",
  masterResume: "personMasterResume",
  requiredExperience: "personRequiredExperience",
  promptTemplate: "personResumePrompt",
  coverLetterPrompt: "personCoverPrompt",
  spreadsheetUrl: "spreadsheetUrl",
  sheetsWebAppUrl: "sheetsWebAppUrl"
};

export function extrasToText(extras) {
  if (!extras || typeof extras !== "object") return "";
  return Object.entries(extras)
    .filter(([k, v]) => String(k).trim() && String(v).trim())
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");
}

export function textToExtras(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([^=:]+)\s*[=:]\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key && value) out[key] = value;
  }
  return out;
}

export function setSelectValue(el, value) {
  if (!el) return;
  const v = String(value || "");
  el.value = v;
  if (el.value !== v && v) {
    for (const opt of el.options) {
      if (opt.value === v || opt.textContent.trim() === v) {
        el.value = opt.value;
        break;
      }
    }
  }
}

function fieldEl(root, key) {
  const id = PERSON_FIELD_IDS[key];
  return id ? root.querySelector(`#${id}`) : null;
}

export function isEditingBuiltin(editingPersonId) {
  return BUILTIN_PROFILES.some((b) => b.id === editingPersonId && b.kind !== "coverLetter");
}

/**
 * @param {ParentNode} root
 * @param {object} person
 * @param {{ roleTrack?: string }} [opts]
 */
export function fillPersonForm(root, person, opts = {}) {
  if (!root || !person) return;
  const set = (key, value) => {
    const el = fieldEl(root, key);
    if (!el) return;
    if (el.tagName === "SELECT") setSelectValue(el, value);
    else el.value = value != null ? String(value) : "";
  };

  set("label", person.label || "");
  set("name", person.name || person.label || "");
  set("email", person.email || "");
  set("phone", person.phone || "");
  set("linkedin", person.linkedin || "");
  set("portfolio", person.portfolio || "");
  set("password", person.password || DEFAULT_ATS_PASSWORD);
  set("location", person.location || "");
  set("address", person.address || "");
  set("zip", person.zip || "");
  set("gender", person.gender);
  set("ethnicity", person.ethnicity);
  set("disability", person.disability);
  set("veteran", person.veteran);
  set("citizenship", person.citizenship);
  set("workAuthorized", person.workAuthorized);
  set("sponsorship", person.sponsorship);
  set("hispanicLatino", person.hispanicLatino);
  set("autofillExtras", extrasToText(person.autofillExtras));
  set("resumeFilePrefix", person.resumeFilePrefix || "");
  set("signatureTitle", person.signatureTitle || "");
  set("masterResume", person.masterResume || "");
  set("requiredExperience", requiredExperienceToText(person.requiredExperience || []));
  set("promptTemplate", person.promptTemplate || "");
  set("coverLetterPrompt", person.coverLetterPrompt || "");
  set("spreadsheetUrl", person.spreadsheetUrl || "");
  set("sheetsWebAppUrl", person.sheetsWebAppUrl || "");

  const templateEl = root.querySelector("#templateSelect");
  if (templateEl && person.templateId) templateEl.value = person.templateId;

  const track = opts.roleTrack || person.roleTrack;
  if (track) {
    const trackId = normalizeRoleTrackId(track);
    for (const btn of root.querySelectorAll(".role-track-btn")) {
      const active = btn.dataset.track === trackId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  const hint = root.querySelector("#masterResumeFileHint");
  if (hint) {
    hint.textContent = person.masterResume
      ? `Master resume loaded (${person.masterResume.length} chars).`
      : "";
  }
}

/**
 * @param {ParentNode} root
 * @param {{ editingPersonId?: string|null, asNew?: boolean, roleTrack?: string, templateId?: string }} [opts]
 */
export function readPersonFromForm(root, opts = {}) {
  const val = (key) => {
    const el = fieldEl(root, key);
    if (!el) return "";
    if (el.tagName === "SELECT") return el.value.trim();
    return String(el.value ?? "").trim();
  };

  const templateEl = root.querySelector("#templateSelect");
  const roleTrack =
    opts.roleTrack ||
    normalizeRoleTrackId(
      root.querySelector(".role-track-btn.is-active")?.dataset?.track || "sf"
    );

  return {
    id: opts.asNew ? null : opts.editingPersonId || null,
    label: val("label"),
    name: val("name") || val("label"),
    email: val("email"),
    phone: val("phone"),
    linkedin: val("linkedin"),
    portfolio: val("portfolio"),
    password: val("password") || DEFAULT_ATS_PASSWORD,
    location: val("location"),
    address: val("address"),
    zip: val("zip"),
    gender: val("gender"),
    ethnicity: val("ethnicity"),
    disability: val("disability"),
    veteran: val("veteran"),
    citizenship: val("citizenship"),
    workAuthorized: val("workAuthorized"),
    sponsorship: val("sponsorship"),
    hispanicLatino: val("hispanicLatino"),
    autofillExtras: textToExtras(val("autofillExtras")),
    resumeFilePrefix: val("resumeFilePrefix") || "Resume",
    signatureTitle: val("signatureTitle"),
    masterResume: fieldEl(root, "masterResume")?.value ?? "",
    requiredExperience: normalizeRequiredExperienceInput(val("requiredExperience")),
    roleTrack,
    promptTemplate: val("promptTemplate"),
    coverLetterPrompt: val("coverLetterPrompt"),
    templateId: opts.templateId || templateEl?.value || "times-classic",
    spreadsheetUrl: val("spreadsheetUrl"),
    sheetsWebAppUrl: val("sheetsWebAppUrl"),
    workHistory: opts.workHistory || [],
    educationHistory: opts.educationHistory || []
  };
}

/** @returns {{ ok: boolean, errors: string[], focusKey?: string }} */
export function validatePerson(person) {
  const errors = [];
  let focusKey = "";

  if (!person.label?.trim() && !person.name?.trim()) {
    errors.push("Enter a display name (or full name) before saving.");
    focusKey = focusKey || "label";
  }
  if (!person.promptTemplate?.trim()) {
    errors.push(
      "Paste your resume tailor prompt (ChatGPT instructions). Job descriptions come from the CSV — not here."
    );
    focusKey = focusKey || "promptTemplate";
  } else if (!person.promptTemplate.includes("{JD}")) {
    errors.push("Add the {JD} placeholder in your tailor prompt.");
    focusKey = focusKey || "promptTemplate";
  }
  if (!person.masterResume?.trim() && person.promptTemplate?.includes("{MASTER_RESUME}")) {
    errors.push("Your prompt uses {MASTER_RESUME}. Upload or paste master resume text first.");
    focusKey = focusKey || "masterResume";
  }

  let requiredExperience = person.requiredExperience || [];
  if (!requiredExperience.length && person.promptTemplate) {
    requiredExperience = parseRequiredExperienceFromPrompt(person.promptTemplate);
  }
  if (requiredExperience.length < 1 && !person.masterResume?.trim()) {
    errors.push(
      "List required experience employers (one per line), or upload a master resume so they can be detected."
    );
    focusKey = focusKey || "requiredExperience";
  }

  const cl = String(person.coverLetterPrompt || "").trim();
  if (cl && !cl.includes("{JD}")) {
    errors.push("Cover letter prompt must include {JD} when set.");
    focusKey = focusKey || "coverLetterPrompt";
  }

  return { ok: errors.length === 0, errors, focusKey };
}

/**
 * Autofill readiness — same Person object `personToApplicantInfo` uses.
 * @returns {{ complete: boolean, missing: string[] }}
 */
export function applyCompleteness(person = {}) {
  const missing = [];
  if (!String(person.name || person.label || "").trim()) missing.push("Name");
  if (!String(person.email || "").trim()) missing.push("Email");
  if (!String(person.phone || "").trim()) missing.push("Phone");
  if (!String(person.address || "").trim()) missing.push("Street address");
  if (!String(person.zip || "").trim()) missing.push("ZIP / postal code");
  return { complete: missing.length === 0, missing };
}

/**
 * Merge resume extraction into an existing person record (no duplicate store).
 */
export function mergeExtractedProfileIntoPerson(person, parsed, resumeText, { resetEeo = false } = {}) {
  const next = { ...(person || {}) };
  if (resumeText) next.masterResume = resumeText;
  if (parsed.name) {
    next.name = parsed.name;
    next.label = parsed.name;
    next.resumeFilePrefix = parsed.name.replace(/[^\w]+/g, "_").replace(/_+/g, "_") || "Resume";
  }
  if (parsed.email) next.email = parsed.email;
  if (parsed.phone) next.phone = parsed.phone;
  if (parsed.linkedin) next.linkedin = parsed.linkedin;
  if (parsed.location) next.location = parsed.location;
  if (parsed.address) next.address = parsed.address;
  if (parsed.zip) next.zip = parsed.zip;
  if (parsed.headline) next.signatureTitle = parsed.headline;
  if (parsed.employers?.length) next.requiredExperience = parsed.employers;
  if (resetEeo) {
    next.gender = "";
    next.ethnicity = "";
    next.disability = "";
    next.veteran = "";
    next.citizenship = "";
    next.workAuthorized = "";
    next.sponsorship = "";
    next.hispanicLatino = "";
    next.autofillExtras = {};
  }
  return next;
}

/**
 * @param {ParentNode} root
 * @param {{ asNew?: boolean, editingPersonId?: string|null, roleTrack?: string, templateId?: string, workHistory?: object[], educationHistory?: object[] }} [opts]
 */
export async function savePersonFromForm(root, opts = {}) {
  let person = readPersonFromForm(root, opts);
  if (Array.isArray(opts.workHistory)) person.workHistory = opts.workHistory;
  if (Array.isArray(opts.educationHistory)) person.educationHistory = opts.educationHistory;
  const validation = validatePerson(person);
  if (!validation.ok) {
    const err = new Error(validation.errors[0]);
    err.focusKey = validation.focusKey;
    err.errors = validation.errors;
    throw err;
  }

  if (!person.requiredExperience?.length) {
    const detected = parseRequiredExperienceFromPrompt(person.promptTemplate);
    if (detected.length) person.requiredExperience = detected;
  }

  if (opts.asNew) {
    const saved = await addCustomProfile({
      label: person.label || person.name,
      name: person.name || person.label,
      email: person.email,
      phone: person.phone,
      linkedin: person.linkedin,
      portfolio: person.portfolio,
      password: person.password,
      location: person.location,
      address: person.address,
      zip: person.zip,
      gender: person.gender,
      ethnicity: person.ethnicity,
      disability: person.disability,
      veteran: person.veteran,
      citizenship: person.citizenship,
      workAuthorized: person.workAuthorized,
      sponsorship: person.sponsorship,
      hispanicLatino: person.hispanicLatino,
      autofillExtras: person.autofillExtras,
      masterResume: person.masterResume,
      requiredExperience: person.requiredExperience,
      promptTemplate: person.promptTemplate,
      coverLetterPrompt: person.coverLetterPrompt,
      resumeFilePrefix: person.resumeFilePrefix,
      templateId: person.templateId,
      signatureTitle: person.signatureTitle,
      roleTrack: person.roleTrack,
      spreadsheetUrl: person.spreadsheetUrl,
      sheetsWebAppUrl: person.sheetsWebAppUrl,
      workHistory: person.workHistory || [],
      educationHistory: person.educationHistory || []
    });
    return { profile: saved, created: true, fromBuiltin: false };
  }

  return savePersonProfile(person);
}
