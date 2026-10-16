/**
 * Shared resume prompt menu. The same choices apply to SF, DE, FS, and AI.
 * Track senior is the default. A person's own text is used only for Custom.
 */

import { getRoleTrack, normalizeRoleTrackId } from "../role-tracks.js";

export const RESUME_PROMPT_ID_KEY = "resume_prompt_id";
/** Previous menu key. Read once so existing installs keep Vector or V3. */
export const LEGACY_SF_PROMPT_VERSION_KEY = "sf_prompt_version";

export const RESUME_PROMPT_IDS = Object.freeze({
  TRACK: "track",
  V3: "v3",
  VECTOR: "vector",
  CUSTOM: "custom"
});

/**
 * @param {unknown} value
 * @returns {"track"|"v3"|"vector"|"custom"}
 */
export function normalizeResumePromptId(value) {
  const id = String(value ?? "")
    .trim()
    .toLowerCase();
  if (id === "v3" || id === "vector" || id === "custom" || id === "track") return id;
  if (id === "test") return "vector";
  return "track";
}

/** Menu rows for the active track. Vector is Salesforce-only. */
export function resumePromptChoices(roleTrack) {
  const ids = [RESUME_PROMPT_IDS.TRACK, RESUME_PROMPT_IDS.V3];
  if (normalizeRoleTrackId(roleTrack) === "sf") ids.push(RESUME_PROMPT_IDS.VECTOR);
  ids.push(RESUME_PROMPT_IDS.CUSTOM);
  return ids;
}

/**
 * Choice that generation will actually use.
 * Vector on a non-SF track, and Custom without a saved prompt, fall back to the track prompt.
 */
export function effectiveResumePromptId(promptId, roleTrack, { customReady = false } = {}) {
  const id = normalizeResumePromptId(promptId);
  if (id === RESUME_PROMPT_IDS.VECTOR && normalizeRoleTrackId(roleTrack) !== "sf") {
    return RESUME_PROMPT_IDS.TRACK;
  }
  if (id === RESUME_PROMPT_IDS.CUSTOM && !customReady) return RESUME_PROMPT_IDS.TRACK;
  return id;
}

export function resumePromptLabel(promptId, roleTrack) {
  const id = normalizeResumePromptId(promptId);
  if (id === RESUME_PROMPT_IDS.V3) return "V3: Luck";
  if (id === RESUME_PROMPT_IDS.VECTOR) return "Vector";
  if (id === RESUME_PROMPT_IDS.CUSTOM) return "Custom";
  return `${getRoleTrack(roleTrack).shortLabel}: Senior`;
}

export function resumePromptTitle(promptId) {
  const id = normalizeResumePromptId(promptId);
  if (id === RESUME_PROMPT_IDS.V3) return "Shared ATS prompt";
  if (id === RESUME_PROMPT_IDS.VECTOR) return "Salesforce prompt";
  if (id === RESUME_PROMPT_IDS.CUSTOM) return "Saved prompt";
  return "Track senior prompt";
}

export async function getResumePromptId() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return RESUME_PROMPT_IDS.TRACK;
  const data = await chrome.storage.local.get([RESUME_PROMPT_ID_KEY, LEGACY_SF_PROMPT_VERSION_KEY]);
  const stored = data[RESUME_PROMPT_ID_KEY];
  if (stored != null && String(stored).trim()) return normalizeResumePromptId(stored);
  const legacy = data[LEGACY_SF_PROMPT_VERSION_KEY];
  if (legacy != null && String(legacy).trim()) return normalizeResumePromptId(legacy);
  return RESUME_PROMPT_IDS.TRACK;
}

export async function setResumePromptId(value) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.set({
    [RESUME_PROMPT_ID_KEY]: normalizeResumePromptId(value)
  });
}
