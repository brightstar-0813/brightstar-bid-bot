import { PROMPT_TEMPLATE } from "./template.js";

const responseTextEl = document.getElementById("responseText");
const statusEl = document.getElementById("status");
const generateBtn = document.getElementById("generate");
const resetBtn = document.getElementById("reset");

function setStatus(message) {
  statusEl.textContent = message;
}

function buildPrompt(jdText) {
  return PROMPT_TEMPLATE.replace("{JD}", jdText);
}

async function loadSettings() {
  const data = await chrome.storage.local.get([
    "last_response",
    "generation_status",
    "generation_running"
  ]);
  if (responseTextEl) {
    responseTextEl.value = data.last_response || "";
  }
  setStatus(data.generation_status || "");
  generateBtn.disabled = Boolean(data.generation_running);
}

async function readClipboardText() {
  const text = await navigator.clipboard.readText();
  return text.trim();
}

async function generateResume() {
  setStatus("Reading JD from clipboard...");
  let jd = "";
  try {
    jd = await readClipboardText();
  } catch {
    setStatus("Clipboard read failed. Copy JD and try again.");
    return;
  }
  if (!jd) {
    setStatus("Clipboard is empty.");
    return;
  }

  const prompt = buildPrompt(jd);

  setStatus("Starting generation...");
  generateBtn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "start_generation", prompt });
    if (!res?.ok) {
      throw new Error(res?.error || "Failed to start generation.");
    }
    setStatus("Resume generated.");
  } catch (err) {
    setStatus(`Generation failed: ${String(err.message || err)}`);
  } finally {
    const state = await chrome.storage.local.get(["generation_running", "last_response"]);
    generateBtn.disabled = Boolean(state.generation_running);
    if (responseTextEl && state.last_response) {
      responseTextEl.value = state.last_response;
    }
  }
}

async function resetWorkflow() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "reset_generation_state" });
    if (!res?.ok) {
      throw new Error(res?.error || "Failed to reset.");
    }
    if (responseTextEl) {
      responseTextEl.value = "";
    }
    setStatus("Reset complete. Ready for next run.");
    generateBtn.disabled = false;
  } catch (err) {
    setStatus(`Reset failed: ${String(err.message || err)}`);
  }
}

generateBtn.addEventListener("click", generateResume);
resetBtn.addEventListener("click", resetWorkflow);

loadSettings().catch((err) => setStatus(`Init failed: ${String(err.message || err)}`));
setInterval(async () => {
  const data = await chrome.storage.local.get([
    "generation_status",
    "generation_running",
    "last_response"
  ]);
  if (typeof data.generation_status === "string") {
    setStatus(data.generation_status);
  }
  generateBtn.disabled = Boolean(data.generation_running);
  if (responseTextEl && typeof data.last_response === "string" && data.last_response.trim()) {
    responseTextEl.value = data.last_response;
  }
}, 1200);
