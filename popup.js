import {
  DEFAULT_PROFILE_ID,
  getAllProfiles,
  buildPrompt,
  addCustomProfile,
  deleteCustomProfile
} from "./profiles.js";

const DEFAULT_OUTPUT_DIR = "Resume Applications";

const statusEl = document.getElementById("status");
const profileSelectEl = document.getElementById("profileSelect");
const deleteProfileBtn = document.getElementById("deleteProfile");
const jobTitleEl = document.getElementById("jobTitle");
const companyNameEl = document.getElementById("companyName");
const jdLinkEl = document.getElementById("jdLink");
const jdTextEl = document.getElementById("jdText");
const outputDirEl = document.getElementById("outputDir");
const pasteJdBtn = document.getElementById("pasteJd");
const generateBtn = document.getElementById("generate");
const resetBtn = document.getElementById("reset");
const toggleAddProfileBtn = document.getElementById("toggleAddProfile");
const addProfileBody = document.getElementById("addProfileBody");
const newProfileNameEl = document.getElementById("newProfileName");
const newProfilePromptEl = document.getElementById("newProfilePrompt");
const saveProfileBtn = document.getElementById("saveProfile");

let profilesCache = [];

function setStatus(message) {
  statusEl.textContent = message;
}

function syncDeleteButton() {
  const selected = profilesCache.find((p) => p.id === profileSelectEl.value);
  const canDelete = Boolean(selected && !selected.builtin);
  deleteProfileBtn.hidden = !canDelete;
}

function populateProfileSelect(selectedId) {
  profileSelectEl.innerHTML = "";
  for (const profile of profilesCache) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.builtin ? profile.label : `${profile.label} (custom)`;
    profileSelectEl.appendChild(option);
  }
  const validIds = new Set(profilesCache.map((p) => p.id));
  profileSelectEl.value = validIds.has(selectedId) ? selectedId : DEFAULT_PROFILE_ID;
  syncDeleteButton();
}

async function refreshProfiles(selectedId) {
  profilesCache = await getAllProfiles();
  const preferred =
    selectedId ||
    (await chrome.storage.local.get("selected_profile_id")).selected_profile_id ||
    DEFAULT_PROFILE_ID;
  populateProfileSelect(preferred);
}

async function saveSelectedProfile(profileId) {
  await chrome.storage.local.set({ selected_profile_id: profileId });
}

async function persistJobFields() {
  await chrome.storage.local.set({
    last_job_title: jobTitleEl.value,
    last_company_name: companyNameEl.value,
    last_jd_link: jdLinkEl.value,
    last_jd_text: jdTextEl.value,
    output_dir: outputDirEl.value.trim() || DEFAULT_OUTPUT_DIR
  });
}

async function loadSettings() {
  const data = await chrome.storage.local.get([
    "selected_profile_id",
    "last_job_title",
    "last_company_name",
    "last_jd_link",
    "last_jd_text",
    "output_dir",
    "generation_status",
    "generation_running"
  ]);

  await refreshProfiles(data.selected_profile_id || DEFAULT_PROFILE_ID);
  jobTitleEl.value = data.last_job_title || "";
  companyNameEl.value = data.last_company_name || "";
  jdLinkEl.value = data.last_jd_link || "";
  jdTextEl.value = data.last_jd_text || "";
  outputDirEl.value = data.output_dir || DEFAULT_OUTPUT_DIR;
  setStatus(data.generation_status || "");
  generateBtn.disabled = Boolean(data.generation_running);
}

async function readClipboardText() {
  const text = await navigator.clipboard.readText();
  return text.trim();
}

async function pasteJdFromClipboard() {
  setStatus("Reading JD from clipboard...");
  try {
    const jd = await readClipboardText();
    if (!jd) {
      setStatus("Clipboard is empty.");
      return;
    }
    jdTextEl.value = jd;
    await persistJobFields();
    setStatus("JD pasted from clipboard.");
  } catch {
    setStatus("Clipboard read failed. Paste JD into the text field manually.");
  }
}

async function generateResume() {
  const profileId = profileSelectEl.value || DEFAULT_PROFILE_ID;
  const jobTitle = (jobTitleEl.value || "").trim();
  const companyName = (companyNameEl.value || "").trim();
  const jdLink = (jdLinkEl.value || "").trim();
  const jd = (jdTextEl.value || "").trim();
  const outputDir = (outputDirEl.value || "").trim() || DEFAULT_OUTPUT_DIR;

  if (!jobTitle) {
    setStatus("Enter a job title first.");
    jobTitleEl.focus();
    return;
  }
  if (!companyName) {
    setStatus("Enter a company name first.");
    companyNameEl.focus();
    return;
  }
  if (!jd) {
    setStatus("Paste a job description into the JD field first.");
    jdTextEl.focus();
    return;
  }

  await chrome.storage.local.set({
    selected_profile_id: profileId,
    last_job_title: jobTitle,
    last_company_name: companyName,
    last_jd_link: jdLink,
    last_jd_text: jd,
    output_dir: outputDir
  });

  let prompt = "";
  try {
    prompt = await buildPrompt(profileId, jd);
  } catch (err) {
    setStatus(String(err.message || err));
    return;
  }

  setStatus("Starting generation...");
  generateBtn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: "start_generation",
      prompt,
      jobMeta: {
        jobTitle,
        companyName,
        jdLink,
        jdText: jd,
        outputDir
      }
    });
    if (!res?.ok) {
      throw new Error(res?.error || "Failed to start generation.");
    }
    setStatus("Resume generated.");
  } catch (err) {
    setStatus(`Generation failed: ${String(err.message || err)}`);
  } finally {
    const state = await chrome.storage.local.get(["generation_running"]);
    generateBtn.disabled = Boolean(state.generation_running);
  }
}

async function resetWorkflow() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "reset_generation_state" });
    if (!res?.ok) {
      throw new Error(res?.error || "Failed to reset.");
    }
    setStatus("Reset complete. Ready for next run.");
    generateBtn.disabled = false;
  } catch (err) {
    setStatus(`Reset failed: ${String(err.message || err)}`);
  }
}

async function saveNewProfile() {
  const label = newProfileNameEl.value;
  const promptTemplate = newProfilePromptEl.value;

  saveProfileBtn.disabled = true;
  try {
    const profile = await addCustomProfile({ label, promptTemplate });
    newProfileNameEl.value = "";
    newProfilePromptEl.value = "";
    await chrome.storage.local.set({ selected_profile_id: profile.id });
    await refreshProfiles(profile.id);
    addProfileBody.hidden = true;
    toggleAddProfileBtn.setAttribute("aria-expanded", "false");
    setStatus(`Profile saved: ${profile.label}`);
  } catch (err) {
    setStatus(String(err.message || err));
  } finally {
    saveProfileBtn.disabled = false;
  }
}

async function removeSelectedProfile() {
  const profileId = profileSelectEl.value;
  const selected = profilesCache.find((p) => p.id === profileId);
  if (!selected || selected.builtin) {
    setStatus("Built-in profiles cannot be deleted.");
    return;
  }

  const ok = window.confirm(`Delete profile "${selected.label}"?`);
  if (!ok) return;

  try {
    await deleteCustomProfile(profileId);
    await chrome.storage.local.set({ selected_profile_id: DEFAULT_PROFILE_ID });
    await refreshProfiles(DEFAULT_PROFILE_ID);
    setStatus(`Deleted profile: ${selected.label}`);
  } catch (err) {
    setStatus(String(err.message || err));
  }
}

profileSelectEl.addEventListener("change", () => {
  syncDeleteButton();
  saveSelectedProfile(profileSelectEl.value).catch(() => {});
});

for (const el of [jobTitleEl, companyNameEl, jdLinkEl, jdTextEl, outputDirEl]) {
  el.addEventListener("change", () => {
    persistJobFields().catch(() => {});
  });
}

toggleAddProfileBtn.addEventListener("click", () => {
  const open = addProfileBody.hidden;
  addProfileBody.hidden = !open;
  toggleAddProfileBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) newProfileNameEl.focus();
});

pasteJdBtn.addEventListener("click", pasteJdFromClipboard);
generateBtn.addEventListener("click", generateResume);
resetBtn.addEventListener("click", resetWorkflow);
saveProfileBtn.addEventListener("click", saveNewProfile);
deleteProfileBtn.addEventListener("click", removeSelectedProfile);

loadSettings().catch((err) => setStatus(`Init failed: ${String(err.message || err)}`));
setInterval(async () => {
  const data = await chrome.storage.local.get(["generation_status", "generation_running"]);
  if (typeof data.generation_status === "string") {
    setStatus(data.generation_status);
  }
  generateBtn.disabled = Boolean(data.generation_running);
}, 1200);
