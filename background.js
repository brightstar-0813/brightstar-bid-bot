import {
  appendJobToSpreadsheet,
  markJobAppliedOnSpreadsheet,
  formatAppliedStatus,
  formatApplicationDateTime,
  fetchExistingJobLinks,
  fetchExistingSheetDedupKeys,
  buildKnownLinkSet,
  normalizeJobLink
} from "./sheets.js";
import { notifySlackBatchComplete, notifySlackAlert, notifySlackJobStatus, notifySlackDuplicates } from "./slack.js";
import {
  buildCoverLetterPrompt,
  buildPrompt,
  getActivePerson,
  getAutofillContact,
  resolveExperienceRulesForPerson,
  resolveRoleTrackForPerson,
  DEFAULT_PROFILE_ID
} from "./profiles.js";
import {
  formatRoleTrackStatus,
  getSessionRoleTrack,
  jdRequiredSkills,
  resolveEffectiveRoleTrack
} from "./role-tracks.js";
import { outputDirFromPerson } from "./resume-profile.js";
import {
  setLastGeneratedDocs,
  startAutofillOnTab,
  startMultiStepApplyOnTab,
  openJobAndApply,
  closeApplyTab,
  probeJobLinkInactive,
  resolveUploadDocs,
  setActiveApplyJob,
  hydrateJobsWithFolders,
  locateJobFolder,
  handleProfileLearnCapture,
  handleQaLearnCapture,
  answerQuestionsFromBank
} from "./autofill-runner.js";
import { formatAutofillSummary } from "./autofill-summary.js";
import {
  resumeJsonToHtml,
  extractResumeJson,
  enforceJdSkills,
  rolesMissingJdSkills,
  buildJdSkillsRetryPrompt,
  totalExperienceBullets,
  isUsableResumeJson,
  isMinimallySaveableResume,
  isRichResumeJson,
  resumeJsonLooksComplete,
  sanitizeResumeData,
  looksLikeSchemaPlaceholderResume,
  describeResumeGaps,
  missingExperienceCompanies,
  buildMissingExperienceRetryPrompt,
  incompleteExperienceEntries,
  underfilledExperienceEntries,
  truncatedBulletRoles,
  buildIncompleteExperienceRetryPrompt,
  setExperienceValidationRules
} from "./resume-json.js";
import { formatRequiredEmployersList } from "./experience-rules.js";
import { DEFAULT_TEMPLATE_ID } from "./templates/index.js";
import {
  parseJobsCsv,
  filterJobsByChannel,
  normalizeChannelFilter,
  isDiceJob,
  isIndeedJob,
  isWorkdayJob,
  isGreenhouseJob,
  isAshbyJob,
  isLeverJob,
  isJobgetherJob,
  isUnitedStatesJob
} from "./csv.js";
import {
  CSV_SOURCE_ALARM,
  NATIVE_HOST_NAME,
  clampPollMinutes,
  fingerprintText,
  getCsvSourceSettings,
  jobIdentity,
  mergeParsedJobs,
  saveCsvSourceSettings
} from "./csv-source.js";
import {
  isExplicitlyHostedIndeedJob,
  isIndeedUrl,
  normalizeIndeedCapturedJob
} from "./indeed.js";
import {
  evaluateAtsScore,
  boostResumeForAts,
  buildAtsScoreRetryPrompt,
  ATS_TARGET_SCORE
} from "./ats-score.js";
import {
  AI_PROVIDER_KEY,
  AI_PROVIDERS,
  aiProviderHomeUrl,
  aiProviderLabel,
  aiProviderNewChatUrl,
  isAiProviderUrl,
  normalizeAiProvider
} from "./ai-provider.js";

const QUEUE_KEY = "job_queue";
const BATCH_STATE_KEY = "batch_state";
const APPLY_HISTORY_KEY = "apply_history";
const ALL_US_JOBS_KEY = "all_us_jobs";
const JOB_CHANNEL_FILTER_KEY = "job_channel_filter";
const REMOVED_JOB_IDENTITIES_KEY = "removed_job_identities";
const DEFAULT_CHANNEL_FILTER = "dice";
const AUTOFILL_ENABLED_KEY = "autofill_enabled";

/** All-channel batch runs generate files only — never auto-apply. */
async function isBatchAutoApplyEnabled() {
  const data = await chrome.storage.local.get([JOB_CHANNEL_FILTER_KEY]);
  const channel = normalizeChannelFilter(data[JOB_CHANNEL_FILTER_KEY] || DEFAULT_CHANNEL_FILTER);
  return channel !== "all";
}

/** Manual Apply assist and non-Dice hosted batch apply. Dice batch always auto-applies. Default on. */
async function isAutofillEnabled() {
  const data = await chrome.storage.local.get([AUTOFILL_ENABLED_KEY]);
  return data[AUTOFILL_ENABLED_KEY] !== false;
}

function isDiceBatchAutoApply(board = "") {
  return String(board || "").trim() === "Dice";
}

/** A row is retried this many times before the batch moves on without it. */
const MAX_JOB_ATTEMPTS = 2;
/** Retries of the resume prompt inside one chat before the row is failed.
 * 3 = initial + up to two re-prompts (e.g. missing employers, then stub/parse).
 * When JSON is already complete we harvest instead of re-prompting. */
const MAX_JSON_ATTEMPTS = 3;

const JSON_RETRY_PROMPT = `Your previous reply was not usable (it looked like a schema stub or incomplete JSON). Return ONLY one complete valid resume JSON object with REAL tailored content.

Rules:
- No markdown, no code fences, no commentary before or after the JSON
- Start with { and end with }
- Include filled: name, headline, location, phone, email, linkedin, profile (4–6 real sentences), technicalSummary (6–10 real bullets), education, ALL certifications from the source list, skills (multiple categories), experience (ALL employers from FIXED COMPANY HISTORY with full bullet counts — do not omit any company)
- NEVER output placeholder text such as "One summary paragraph", "One sentence bullet", "tailored to the JD", or "One realistic project name"
- Finish the entire JSON in one message. Do not ask clarifying questions.

Output JSON now.`;

function buildJsonRetryPrompt(partialData) {
  const incomplete = incompleteExperienceEntries(partialData);
  const underfilled = underfilledExperienceEntries(partialData);
  const truncated = truncatedBulletRoles(partialData);
  if (incomplete.length || underfilled.length || truncated.length) {
    return buildIncompleteExperienceRetryPrompt(partialData);
  }
  const missing = missingExperienceCompanies(partialData);
  if (missing.length) return buildMissingExperienceRetryPrompt(partialData);
  return JSON_RETRY_PROMPT;
}

/** Install per-person experience employer rules for validation + content-script harvest. */
async function activatePersonExperienceRules(person) {
  const experienceRules = resolveExperienceRulesForPerson(person);
  setExperienceValidationRules(experienceRules);
  await chrome.storage.local
    .set({
      experience_validation_rules: experienceRules,
      experience_validation_person: person?.name || person?.label || ""
    })
    .catch(() => {});
  return experienceRules;
}

/**
 * Dedicated deep DOM scan (all assistant turns + page-wide <pre>).
 * Used when the narrow poller misses JSON the user can clearly see.
 */
async function deepHarvestResumeFromTab(tabId) {
  if (typeof tabId !== "number") return null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const texts = [];
        const seen = new Set();
        const push = (t) => {
          let s = String(t || "")
            .replace(/\uFEFF/g, "")
            .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/\u00A0/g, " ")
            .trim();
          if (s.length < 80) return;
          const fp = `${s.length}:${s.slice(0, 60)}:${s.slice(-30)}`;
          if (seen.has(fp)) return;
          seen.add(fp);
          texts.push(s.slice(0, 500000));
        };
        const blocks = Array.from(
          document.querySelectorAll(
            "[data-message-author-role='assistant'], [data-turn='assistant'], section[data-turn='assistant'], [data-testid='assistant-message'], [data-testid='assistant'], [class*='font-claude-message'], [class*='assistant-message']"
          )
        );
        const startBi = Math.max(0, blocks.length - 20);
        for (let bi = startBi; bi < blocks.length; bi += 1) {
          const block = blocks[bi];
          for (const el of block.querySelectorAll(
            "pre code, pre, code, [class*='language-json'], [class*='markdown'], [class*='prose']"
          )) {
            push(el.innerText || el.textContent || "");
          }
          push(block.innerText || block.textContent || "");
        }
        for (const el of document.querySelectorAll("main pre, main pre code, [class*='language-json']")) {
          const t = el.innerText || el.textContent || "";
          if (t.includes('"experience"')) push(t);
        }

        const extractBalanced = (str) => {
          const out = [];
          const input = String(str || "").slice(0, 400000);
          let depth = 0;
          let startIdx = -1;
          let inString = false;
          let escaped = false;
          for (let i = 0; i < input.length; i += 1) {
            const ch = input[i];
            if (inString) {
              if (escaped) escaped = false;
              else if (ch === "\\") escaped = true;
              else if (ch === '"') inString = false;
              continue;
            }
            if (ch === '"') {
              inString = true;
              continue;
            }
            if (ch === "{") {
              if (depth === 0) startIdx = i;
              depth += 1;
            } else if (ch === "}") {
              if (depth > 0) {
                depth -= 1;
                if (depth === 0 && startIdx >= 0) {
                  out.push(input.slice(startIdx, i + 1));
                  startIdx = -1;
                  if (out.length >= 16) break;
                }
              }
            }
          }
          return out;
        };

        const scoreObj = (obj) => {
          if (!obj || typeof obj !== "object") return -1;
          const jobs = Array.isArray(obj.experience) ? obj.experience.length : 0;
          const bullets = Array.isArray(obj.experience)
            ? obj.experience.reduce(
                (n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.length : 0),
                0
              )
            : 0;
          if (!obj.name && jobs < 1) return -1;
          return (
            jobs * 10000 +
            bullets * 40 +
            (Array.isArray(obj.certifications) ? obj.certifications.length * 30 : 0) +
            (Array.isArray(obj.skills) ? obj.skills.length * 20 : 0) +
            String(obj.profile || "").length
          );
        };

        let best = null;
        let bestScore = -1;
        const looseFix = (s) => {
          let t = String(s || "");
          for (let i = 0; i < 8; i += 1) {
            const n = t.replace(/,\s*([}\]])/g, "$1");
            if (n === t) break;
            t = n;
          }
          return t;
        };
        const tryParse = (s) => {
          try {
            return JSON.parse(s);
          } catch {
            try {
              return JSON.parse(looseFix(s));
            } catch {
              return null;
            }
          }
        };
        for (const raw of texts) {
          if (!raw.includes('"experience"')) continue;
          const normalized = raw
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/^```(?:json|JSON)?\s*/i, "")
            .replace(/```\s*$/i, "");
          for (const slice of extractBalanced(normalized)) {
            const obj = tryParse(slice);
            if (!obj) continue;
            const s = scoreObj(obj);
            if (s > bestScore) {
              best = obj;
              bestScore = s;
            }
          }
          {
            const a = normalized.indexOf("{");
            const b = normalized.lastIndexOf("}");
            if (a >= 0 && b > a) {
              const obj = tryParse(normalized.slice(a, b + 1));
              if (obj) {
                const s = scoreObj(obj);
                if (s > bestScore) {
                  best = obj;
                  bestScore = s;
                }
              }
            }
          }
        }
        return best;
      }
    });
    const data = results?.[0]?.result;
    if (data && typeof data === "object") return data;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Read resume JSON that is ALREADY on the ChatGPT page.
 * Prefer the explicit chatgpt_json_ready flag set by the content script after
 * streaming settles — that means "use this JSON and generate files now".
 */
async function tryRecognizeResumeOnPage(tabId) {
  if (isUsableResumeJson(lastUsableResumeData)) return lastUsableResumeData;

  try {
    const stored = await chrome.storage.local.get([
      "chatgpt_json_ready",
      "chatgpt_json_ready_at",
      "chatgpt_harvested_resume",
      "last_resume_json"
    ]);
    if (stored.chatgpt_json_ready && isUsableResumeJson(stored.chatgpt_harvested_resume)) {
      lastUsableResumeData = stored.chatgpt_harvested_resume;
      return stored.chatgpt_harvested_resume;
    }
    if (isUsableResumeJson(stored.chatgpt_harvested_resume)) {
      lastUsableResumeData = stored.chatgpt_harvested_resume;
      return stored.chatgpt_harvested_resume;
    }
    if (isUsableResumeJson(stored.last_resume_json)) {
      lastUsableResumeData = stored.last_resume_json;
      return stored.last_resume_json;
    }
  } catch {
    // ignore
  }

  if (typeof tabId !== "number") return null;

  const deep = await deepHarvestResumeFromTab(tabId);
  if (isUsableResumeJson(deep) || isMinimallySaveableResume(deep)) {
    lastUsableResumeData = deep;
    await chrome.storage.local
      .set({
        chatgpt_harvested_resume: deep,
        chatgpt_harvested_at: Date.now(),
        chatgpt_json_ready: true,
        chatgpt_json_ready_at: Date.now(),
        last_resume_json: deep
      })
      .catch(() => {});
    return deep;
  }

  try {
    const state = await withTimeout(
      chatgptPollState(tabId, { harvestJson: true }),
      20000,
      "Page harvest timed out."
    );
    if (isUsableResumeJson(state.resumeData)) {
      lastUsableResumeData = state.resumeData;
      await chrome.storage.local
        .set({
          chatgpt_harvested_resume: state.resumeData,
          chatgpt_harvested_at: Date.now(),
          chatgpt_json_ready: true,
          chatgpt_json_ready_at: Date.now(),
          last_resume_json: state.resumeData
        })
        .catch(() => {});
      return state.resumeData;
    }
    const fromText = extractResumeJson(state.latest);
    if (isUsableResumeJson(fromText)) {
      lastUsableResumeData = fromText;
      await chrome.storage.local
        .set({
          chatgpt_harvested_resume: fromText,
          chatgpt_harvested_at: Date.now(),
          chatgpt_json_ready: true,
          chatgpt_json_ready_at: Date.now(),
          last_resume_json: fromText
        })
        .catch(() => {});
      return fromText;
    }
  } catch {
    // ignore — caller may retry prompting
  }
  return null;
}

/** Wait for the page ready flag / harvest after ChatGPT finishes streaming. */
async function waitForJsonReadyFlag(tabId, { since = 0, timeoutMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (batchControl.skipCurrent || batchControl.stop) return null;
    try {
      const stored = await chrome.storage.local.get([
        "chatgpt_json_ready",
        "chatgpt_json_ready_at",
        "chatgpt_harvested_resume",
        "chatgpt_harvested_at"
      ]);
      const readyAt = Number(stored.chatgpt_json_ready_at || 0);
      const harvestedAt = Number(stored.chatgpt_harvested_at || 0);
      const stamp = Math.max(readyAt, harvestedAt);
      if (stamp >= since && isUsableResumeJson(stored.chatgpt_harvested_resume)) {
        lastUsableResumeData = stored.chatgpt_harvested_resume;
        return stored.chatgpt_harvested_resume;
      }
    } catch {
      // ignore
    }
    const harvested = await tryRecognizeResumeOnPage(tabId);
    if (isUsableResumeJson(harvested)) return harvested;
    await new Promise((r) => setTimeout(r, 800));
  }
  return tryRecognizeResumeOnPage(tabId);
}

function describeUnusableResume(rawText, data) {
  const preview = String(rawText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  if (!data || typeof data !== "object") {
    if (/"experience"|"name"|"profile"/.test(String(rawText || ""))) {
      return `Resume JSON was on screen but could not be recognized/parsed for file generation. Click “Save JSON now” or retry. Preview: "${preview}${preview.length >= 160 ? "…" : ""}"`;
    }
    if (/^\s*\{/.test(String(rawText || "").trim())) {
      return `ChatGPT JSON could not be recognized/parsed for file generation. Preview: "${preview}${preview.length >= 160 ? "…" : ""}"`;
    }
    return `ChatGPT did not return resume JSON (got text/HTML instead). Preview: "${preview}${preview.length >= 160 ? "…" : ""}"`;
  }
  if (looksLikeSchemaPlaceholderResume(data)) {
    return `ChatGPT returned schema placeholder text instead of a filled resume (e.g. "One summary paragraph…"). Retry the job after reload. Preview: "${preview}${preview.length >= 160 ? "…" : ""}"`;
  }
  // Mirror the minimum bar in isUsableResumeJson so the message is actionable.
  const missing = [];
  if (!String(data.name || "").trim()) missing.push("name");
  if (String(data.profile || "").trim().length < 40) missing.push("profile(<40 chars)");
  if (!Array.isArray(data.experience) || data.experience.length < 1) missing.push("experience");
  const missingCos = missingExperienceCompanies(data);
  if (missingCos.length) missing.push(`missingCompanies(${missingCos.join("; ")})`);
  const cutRoles = incompleteExperienceEntries(data);
  if (cutRoles.length) missing.push(`emptyRoles(${cutRoles.join("; ")})`);
  const thinRoles = underfilledExperienceEntries(data);
  if (thinRoles.length) missing.push(`thinRoles(${thinRoles.join("; ")})`);
  const cutBullets = truncatedBulletRoles(data);
  if (cutBullets.length) missing.push(`truncatedBullet(${cutBullets.join("; ")})`);
  const bullets = Array.isArray(data.experience)
    ? data.experience.reduce(
        (n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.filter(Boolean).length : 0),
        0
      )
    : 0;
  if (bullets < 4) missing.push(`bullets(${bullets}<4)`);
  const avg =
    bullets > 0
      ? Math.round(
          (Array.isArray(data.experience)
            ? data.experience.reduce(
                (n, j) =>
                  n +
                  (Array.isArray(j?.bullets)
                    ? j.bullets.reduce((m, b) => m + String(b || "").trim().length, 0)
                    : 0),
                0
              )
            : 0) / bullets
        )
      : 0;
  if (avg > 0 && avg < 40) missing.push(`avgBulletLen(${avg}<40)`);
  if (missing.length) {
    return `Resume JSON recognized but incomplete for PDF (${missing.join(", ")}). Preview: "${preview}${preview.length >= 160 ? "…" : ""}"`;
  }
  return `Resume JSON not usable for file generation. Preview: "${preview}${preview.length >= 160 ? "…" : ""}"`;
}
let isRunning = false;
let keepAliveTimer = null;
/** Last usable resume object harvested during ChatGPT polling (survives messy page text). */
let lastUsableResumeData = null;
let batchControl = {
  pauseAfterCurrent: false,
  skipCurrent: false,
  stop: false,
  forceProceed: false
};

function startKeepAlive() {
  stopKeepAlive();
  // MV3 service workers can sleep during long ChatGPT waits; ping storage periodically.
  keepAliveTimer = setInterval(() => {
    chrome.storage.local.set({ generation_heartbeat: Date.now() }).catch(() => {});
  }, 15000);
  try {
    chrome.alarms.create("brightstar-tick", { periodInMinutes: 1 });
  } catch {
    // alarms may be unavailable in some contexts
  }
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  try {
    chrome.alarms.clear("brightstar-tick");
  } catch {
    // alarms may be unavailable in some contexts
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === CSV_SOURCE_ALARM) {
    pollCsvSources({ reason: "alarm" }).catch(async (err) => {
      await saveCsvSourceSettings({
        lastStatus: `Poll failed: ${String(err?.message || err)}`
      }).catch(() => {});
    });
    return;
  }
  if (alarm?.name !== "brightstar-tick") return;
  (async () => {
    const data = await chrome.storage.local.get([
      "generation_heartbeat",
      BATCH_STATE_KEY,
      "generation_running",
      QUEUE_KEY,
      "batch_output_dir"
    ]);
    const batchState = data[BATCH_STATE_KEY];
    if (batchState !== "running") return;

    const age = Date.now() - Number(data.generation_heartbeat || 0);
    // Service worker died mid-batch: heartbeat goes stale while UI still says running.
    if (age > 90000 && !isRunning) {
      await setStatus("Batch heartbeat lost — auto-resuming from pending jobs…");
      const queue = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
      const fixed = queue.map((j) =>
        j.status === "running"
          ? { ...j, status: "pending", error: "Auto-resumed after worker sleep" }
          : j
      );
      await chrome.storage.local.set({
        [QUEUE_KEY]: fixed,
        generation_running: true,
        generation_heartbeat: Date.now()
      });
      const outputDir = await resolveOutputDir(data.batch_output_dir);
      isRunning = true;
      runBatchLoop(outputDir).catch(async (err) => {
        isRunning = false;
        await setStatus(`Auto-resume failed: ${String(err?.message || err)}`);
        await chrome.storage.local.set({ generation_running: false });
        await setBatchState("paused");
      });
    } else {
      await chrome.storage.local.set({ generation_heartbeat: Date.now() }).catch(() => {});
    }
  })().catch(() => {});
});

function safeSendResponse(sendResponse, payload) {
  try {
    sendResponse(payload);
  } catch {
    // Popup may have closed; status is already in storage.
  }
}

const DETACHED_WINDOW_KEY = "detached_window_id";
const DETACHED_WINDOW_BOUNDS_KEY = "detached_window_bounds";
const DEFAULT_APP_WINDOW = { width: 580, height: 860 };

/** The docked panel reuses popup.html but needs the full-width layout. */
function configureSidePanel() {
  try {
    chrome.sidePanel
      ?.setOptions?.({ path: "popup.html?ctx=panel", enabled: true })
      ?.catch(() => {});
    chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false })?.catch(() => {});
  } catch {
    // Side panel is unsupported in this Chrome build.
  }
}

function sanitizeWindowBounds(bounds = {}) {
  const width = Math.min(Math.max(Number(bounds.width) || DEFAULT_APP_WINDOW.width, 420), 1400);
  const height = Math.min(Math.max(Number(bounds.height) || DEFAULT_APP_WINDOW.height, 560), 1400);
  const left = Number.isFinite(Number(bounds.left)) ? Math.round(Number(bounds.left)) : undefined;
  const top = Number.isFinite(Number(bounds.top)) ? Math.round(Number(bounds.top)) : undefined;
  return { width, height, ...(left != null ? { left } : {}), ...(top != null ? { top } : {}) };
}

async function rememberAppWindowBounds(windowId) {
  if (windowId == null) return;
  try {
    const win = await chrome.windows.get(windowId);
    if (!win || win.type !== "popup") return;
    await chrome.storage.local.set({
      [DETACHED_WINDOW_BOUNDS_KEY]: sanitizeWindowBounds({
        width: win.width,
        height: win.height,
        left: win.left,
        top: win.top
      })
    });
  } catch {
    // Window may already be gone.
  }
}

/** Open (or focus) the bot as a dedicated popup app window. */
async function openBotAppWindow() {
  const stored = await chrome.storage.local.get([DETACHED_WINDOW_KEY, DETACHED_WINDOW_BOUNDS_KEY]);
  const existingId = stored[DETACHED_WINDOW_KEY];
  if (existingId != null) {
    try {
      await chrome.windows.update(existingId, { focused: true, drawAttention: true });
      return { ok: true, focused: true, windowId: existingId };
    } catch {
      await chrome.storage.local.remove(DETACHED_WINDOW_KEY).catch(() => {});
    }
  }

  const bounds = sanitizeWindowBounds(stored[DETACHED_WINDOW_BOUNDS_KEY] || DEFAULT_APP_WINDOW);
  const created = await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?ctx=window"),
    type: "popup",
    focused: true,
    ...bounds
  });
  if (created?.id != null) {
    await chrome.storage.local.set({ [DETACHED_WINDOW_KEY]: created.id });
  }
  return { ok: true, created: true, windowId: created?.id ?? null };
}

configureSidePanel();

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.local.get(DETACHED_WINDOW_KEY).then((data) => {
    if (data[DETACHED_WINDOW_KEY] === windowId) {
      chrome.storage.local.remove(DETACHED_WINDOW_KEY).catch(() => {});
    }
  });
});

if (chrome.windows.onBoundsChanged) {
  chrome.windows.onBoundsChanged.addListener((windowId) => {
    chrome.storage.local.get(DETACHED_WINDOW_KEY).then((data) => {
      if (data[DETACHED_WINDOW_KEY] === windowId) {
        rememberAppWindowBounds(windowId).catch(() => {});
      }
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  isRunning = false;
  stopKeepAlive();
  configureSidePanel();
  recoverInterruptedBatch("Ready.").then(resumeBatchIfInterrupted);
});

chrome.runtime.onStartup.addListener(() => {
  isRunning = false;
  stopKeepAlive();
  configureSidePanel();
  recoverInterruptedBatch("Ready.").then(resumeBatchIfInterrupted);
});

/**
 * @param {string} statusMessage
 * @param {{retryFailed?: boolean}} [options] retryFailed resets rows that hit the
 *   attempt ceiling so an explicit Start re-runs them.
 * @returns {Promise<boolean>} whether a batch was running when it was interrupted
 */
async function recoverInterruptedBatch(statusMessage = "Ready.", { retryFailed = false } = {}) {
  try {
    const data = await chrome.storage.local.get([QUEUE_KEY, BATCH_STATE_KEY, "generation_running"]);
    const queue = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
    const wasRunning = data[BATCH_STATE_KEY] === "running";
    let changed = false;
    const next = queue.map((j) => {
      if (j.status === "running") {
        changed = true;
        return { ...j, status: "pending", error: "Interrupted — resuming" };
      }
      if (retryFailed && (j.status === "failed" || j.status === "error")) {
        changed = true;
        return { ...j, status: "pending", attempts: 0, error: "" };
      }
      return j;
    });
    const patch = {
      generation_running: false,
      generation_status: statusMessage,
      [BATCH_STATE_KEY]: "idle"
    };
    if (changed) patch[QUEUE_KEY] = next;
    await chrome.storage.local.set(patch);
    return wasRunning;
  } catch {
    await chrome.storage.local.set({
      generation_running: false,
      generation_status: statusMessage,
      [BATCH_STATE_KEY]: "idle"
    });
    return false;
  }
}

/** Chrome restarted / the worker was evicted mid-batch: pick the queue back up. */
async function resumeBatchIfInterrupted(wasRunning) {
  if (!wasRunning || isRunning) return;
  const data = await chrome.storage.local.get([QUEUE_KEY, "batch_output_dir"]);
  const queue = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
  const hasWork = queue.some(
    (j) => j.status === "pending" || (j.status === "error" && Number(j.attempts || 0) < MAX_JOB_ATTEMPTS)
  );
  if (!hasWork) return;

  isRunning = true;
  await setStatus("Resuming interrupted batch…");
  runBatchLoop(await resolveOutputDir(data.batch_output_dir)).catch(async (err) => {
    isRunning = false;
    await setStatus(`Auto-resume failed: ${String(err?.message || err)}`);
    await chrome.storage.local.set({ generation_running: false });
    await setBatchState("paused");
  });
}

async function getStoredAiProvider() {
  const data = await chrome.storage.local.get([AI_PROVIDER_KEY]);
  return normalizeAiProvider(data[AI_PROVIDER_KEY]);
}

async function getOpenAiTab(provider) {
  const p = normalizeAiProvider(provider);
  const tabs = await chrome.tabs.query({});
  const chatTabs = tabs.filter((tab) => isAiProviderUrl(tab.url, p) && typeof tab.id === "number");
  if (!chatTabs.length) return null;

  chatTabs.sort((a, b) => {
    if (!!b.active !== !!a.active) return (b.active ? 1 : 0) - (a.active ? 1 : 0);
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });
  return chatTabs[0];
}

/**
 * Full automation must not stall on a missing tab: open the selected AI site
 * when none is present. Signed-out users still get a clear error from send.
 */
async function ensureAiTab(provider) {
  const p = normalizeAiProvider(provider || (await getStoredAiProvider()));
  const label = aiProviderLabel(p);
  const existing = await getOpenAiTab(p);
  if (existing && typeof existing.id === "number") return existing;

  await setStatus(`No ${label} tab open — opening one…`);
  const tab = await chrome.tabs.create({ url: aiProviderHomeUrl(p), active: true });
  if (typeof tab?.id !== "number") {
    throw new Error(`Open ${label} in a browser tab first.`);
  }
  try {
    await withTimeout(waitForTabComplete(tab.id, 30000), 32000, `Timed out opening ${label}.`);
  } catch {
    // Slow load is fine — the composer wait below covers it.
  }
  for (let i = 0; i < 40; i += 1) {
    const state = await readChatReadiness(tab.id, p);
    if (state.hasInput) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return chrome.tabs.get(tab.id);
}

/** @deprecated Prefer ensureAiTab — kept for older call sites during transition. */
async function ensureChatGptTab() {
  return ensureAiTab(await getStoredAiProvider());
}

async function getOpenChatGptTab() {
  return getOpenAiTab(AI_PROVIDERS.CHATGPT);
}

async function setStatus(status) {
  await chrome.storage.local.set({ generation_status: status });
}

/** Fire-and-forget Slack alert; never throws into the batch loop. */
async function trySlackAlert(opts) {
  try {
    const data = await chrome.storage.local.get(["slack_webhook_url"]);
    const webhookUrl = String(data.slack_webhook_url || "").trim();
    if (!webhookUrl) return false;
    const person = await getActivePerson().catch(() => null);
    await notifySlackAlert({
      webhookUrl,
      personLabel: person?.label || person?.name || "",
      ...opts
    });
    return true;
  } catch {
    return false;
  }
}

/** Per-job Slack status (done / failed / retry). Never throws. */
async function trySlackJobStatus(opts) {
  try {
    const data = await chrome.storage.local.get(["slack_webhook_url"]);
    const webhookUrl = String(data.slack_webhook_url || "").trim();
    if (!webhookUrl) return false;
    const person = await getActivePerson().catch(() => null);
    await notifySlackJobStatus({
      webhookUrl,
      personLabel: person?.label || person?.name || "",
      ...opts
    });
    return true;
  } catch {
    return false;
  }
}

async function queueSlackProgress(queue) {
  const list = Array.isArray(queue) ? queue : await getQueue();
  return {
    done: list.filter((j) => j.status === "done").length,
    failed: list.filter((j) => j.status === "failed").length,
    remaining: list.filter((j) => ["pending", "running", "error"].includes(j.status)).length,
    total: list.length
  };
}

async function trySlackBatchComplete(summary) {
  try {
    const data = await chrome.storage.local.get(["slack_webhook_url"]);
    const webhookUrl = String(data.slack_webhook_url || "").trim();
    if (!webhookUrl) return false;
    const person = await getActivePerson().catch(() => null);
    await notifySlackBatchComplete({
      webhookUrl,
      personLabel: person?.label || person?.name || "",
      ...summary
    });
    return true;
  } catch (err) {
    throw err;
  }
}

async function trySlackDuplicates(duplicates, sheetLinkCount) {
  try {
    const data = await chrome.storage.local.get(["slack_webhook_url"]);
    const webhookUrl = String(data.slack_webhook_url || "").trim();
    if (!webhookUrl || !duplicates?.length) return false;
    const person = await getActivePerson().catch(() => null);
    await notifySlackDuplicates({
      webhookUrl,
      duplicates,
      sheetLinkCount,
      personLabel: person?.label || person?.name || ""
    });
    return true;
  } catch {
    return false;
  }
}

async function getSheetConfig() {
  const person = await getActivePerson().catch(() => null);
  const fromPerson = {
    spreadsheetUrl: String(person?.spreadsheetUrl || "").trim(),
    webAppUrl: String(person?.sheetsWebAppUrl || "").trim()
  };
  if (fromPerson.spreadsheetUrl && fromPerson.webAppUrl) return fromPerson;

  const data = await chrome.storage.local.get(["spreadsheet_url", "sheets_web_app_url"]);
  return {
    spreadsheetUrl: fromPerson.spreadsheetUrl || String(data.spreadsheet_url || "").trim(),
    webAppUrl: fromPerson.webAppUrl || String(data.sheets_web_app_url || "").trim()
  };
}

/** Remember the current job so leftover-question OpenAI calls have JD context. */
async function persistJobContextForAutofill(job = {}) {
  const csvRow = job.csvRow != null && String(job.csvRow).trim() !== "" ? Number(job.csvRow) : "";
  let jobDir = String(job.jobDir || "").trim();
  const jdLink = String(job.jdLink || job.url || "").trim();
  if (!jobDir && csvRow !== "") {
    const located = await locateJobFolder({
      csvRow,
      jobDir: "",
      jdLink,
      company: job.companyName || job.company || "",
      title: job.jobTitle || job.title || ""
    }).catch(() => null);
    jobDir = String(located?.jobDir || "").trim();
  }
  if (!jobDir && csvRow !== "") {
    const queue = await getQueue();
    const row = queue.find((j) => Number(j.csvRow) === Number(csvRow));
    const hist = (await chrome.storage.local.get(APPLY_HISTORY_KEY))[APPLY_HISTORY_KEY] || {};
    jobDir = String(row?.jobDir || hist[String(csvRow)]?.jobDir || "").trim();
  }
  if (jobDir && csvRow !== "") {
    const folder = jobDir.replace(/\\/g, "/").split("/").pop() || "";
    if (!new RegExp(`^${Number(csvRow)}\\s+-\\s+`).test(folder)) {
      jobDir = "";
    }
  }
  await chrome.storage.local.set({
    last_job_title: String(job.jobTitle || job.title || "").trim(),
    last_company_name: String(job.companyName || job.company || "").trim(),
    last_jd_link: jdLink,
    last_jd_text: String(job.jdText || "").trim()
  });
  await setActiveApplyJob({ csvRow, jobDir, jdLink });
}

/** Mark the sheet row Applied (or a custom Status) after apply / inactive detection. */
async function markQueueJobAppliedOnSheet(jobMeta = {}, statusOverride = "") {
  const jdLink = String(jobMeta.jdLink || jobMeta.url || "").trim();
  if (!jdLink) return { skipped: true, reason: "no-link" };
  const { spreadsheetUrl, webAppUrl } = await getSheetConfig();
  if (!spreadsheetUrl || !webAppUrl) return { skipped: true, reason: "no-sheet" };
  const statusText = String(statusOverride || "").trim();
  try {
    const result = await markJobAppliedOnSpreadsheet({
      spreadsheetUrl,
      webAppUrl,
      jobNo: jobMeta.csvRow != null ? jobMeta.csvRow : jobMeta.jobNo || "",
      jobTitle: jobMeta.jobTitle || jobMeta.title || "",
      companyName: jobMeta.companyName || jobMeta.company || "",
      jdLink,
      salary: jobMeta.salary || "",
      ...(statusText ? { status: statusText } : {})
    });
    if (jobMeta.csvRow != null && jobMeta.csvRow !== "" && !statusText) {
      await updateQueueJob(jobMeta.csvRow, {
        applied: true,
        appliedDate: result.appliedDate || ""
      });
    }
    return result;
  } catch (err) {
    return { skipped: false, error: String(err?.message || err) };
  }
}

const MAX_HOSTED_APPLY_ATTEMPTS = 3;

/** True when this queue row is already known to be an inactive / removed posting. */
function isJobMarkedInactive(j) {
  if (!j) return false;
  if (j.inactive) return true;
  const err = String(j.error || "")
    .trim()
    .toLowerCase();
  return err === "inactive job" || /\binactive\b.*\b(job|posting|listing)\b/.test(err);
}

/** Mark a queue row inactive — no resume build / apply retries. */
async function markJobSkippedAsInactive(csvRow, reason = "inactive job", jobMeta = {}) {
  const detail = String(reason || "inactive job").trim() || "inactive job";
  const sheet = await markQueueJobAppliedOnSheet(
    {
      csvRow,
      jobTitle: jobMeta.jobTitle || jobMeta.title || "",
      companyName: jobMeta.companyName || jobMeta.company || "",
      jdLink: jobMeta.jdLink || "",
      salary: jobMeta.salary || ""
    },
    "inactive job"
  ).catch(() => null);
  await updateQueueJob(csvRow, {
    status: "skipped",
    applied: false,
    inactive: true,
    applyAttempted: true,
    applyAttempts: MAX_HOSTED_APPLY_ATTEMPTS,
    error: detail
  }).catch(() => {});
  return sheet;
}

/** Mark a built row inactive after apply detected the posting is gone. */
async function markQueueJobInactive(jobMeta = {}, detail = "inactive job") {
  const sheetStatus = "inactive job";
  const sheet = await markQueueJobAppliedOnSheet(
    {
      csvRow: jobMeta.csvRow,
      jobTitle: jobMeta.jobTitle || jobMeta.title || "",
      companyName: jobMeta.companyName || jobMeta.company || "",
      jdLink: jobMeta.jdLink || "",
      salary: jobMeta.salary || "",
      jobDir: jobMeta.jobDir || ""
    },
    sheetStatus
  );
  await updateQueueJob(jobMeta.csvRow, {
    applied: false,
    inactive: true,
    applyAttempted: true,
    applyAttempts: MAX_HOSTED_APPLY_ATTEMPTS,
    error: detail,
    jobDir: jobMeta.jobDir || ""
  }).catch(() => {});
  await setStatus(
    sheet?.error
      ? `Row ${jobMeta.csvRow}: inactive job (sheet update failed: ${sheet.error}). Closing tab…`
      : `Row ${jobMeta.csvRow}: inactive job — marked on sheet. Closing tab…`
  );
  return sheet;
}

/** Queue rows belong to a person via profileId, or via Applications-* jobDir for legacy rows. */
function jobBelongsToPerson(job, person) {
  if (!person?.id) return true;
  const pid = String(job?.profileId || "").trim();
  if (pid) return pid === person.id;
  const apps = String(outputDirFromPerson(person) || "")
    .replace(/\\/g, "/")
    .toLowerCase();
  const dir = String(job?.jobDir || "")
    .replace(/\\/g, "/")
    .toLowerCase();
  if (apps && dir) {
    if (dir === apps || dir.startsWith(`${apps}/`) || dir.includes(`/${apps}/`)) return true;
    // Built for a different person's Applications-* folder.
    if (/\/applications-[^/]+\//i.test(`/${dir}/`) || /^applications-[^/]+\//i.test(dir)) {
      return false;
    }
  }
  // Untagged legacy rows with no jobDir: only the default person owns them.
  return person.id === DEFAULT_PROFILE_ID;
}

/**
 * True when this JD link was already built/applied/inactive for the SAME person.
 */
async function isJobLinkAlreadyCovered(jdLink, { excludeCsvRow } = {}) {
  const linkKey = normalizeJobLink(jdLink || "");
  if (!linkKey) return { covered: false };

  const person = await getActivePerson().catch(() => null);

  const queue = await getQueue();
  for (const j of queue) {
    if (excludeCsvRow != null && Number(j.csvRow) === Number(excludeCsvRow)) continue;
    if (person && !jobBelongsToPerson(j, person)) continue;
    if (normalizeJobLink(j.jdLink || "") !== linkKey) continue;
    if (j.applied || j.inactive || j.status === "done") {
      return {
        covered: true,
        reason: `same job link already handled (row ${j.csvRow})`
      };
    }
  }

  const { spreadsheetUrl, webAppUrl } = await getSheetConfig();
  if (!spreadsheetUrl || !webAppUrl) return { covered: false };
  try {
    const { links } = await fetchExistingSheetDedupKeys({
      spreadsheetUrl,
      webAppUrl
    });
    if (buildKnownLinkSet(links).has(linkKey)) {
      return { covered: true, reason: "same job link already on Google Sheet" };
    }
  } catch {
    /* sheet check optional at apply time */
  }
  return { covered: false };
}

/**
 * Duplicate gate that MUST run before ChatGPT resume build.
 * Returns a human reason if the job should be skipped, else "".
 */
async function getPreGenerateSkipReason(jobMeta = {}) {
  const linkDup = await isJobLinkAlreadyCovered(jobMeta.jdLink || "", {
    excludeCsvRow: jobMeta.csvRow
  });
  if (linkDup.covered) {
    return linkDup.reason || "duplicate job link";
  }
  return "";
}

/** Mark a queue row skipped for company/link coverage — no resume build, no apply. */
async function markJobSkippedAsDuplicate(csvRow, reason, { lockSheetSkip = true } = {}) {
  const detail = String(reason || "duplicate").trim() || "duplicate";
  await updateQueueJob(csvRow, {
    status: "skipped",
    applied: false,
    applyAttempted: true,
    applyAttempts: MAX_HOSTED_APPLY_ATTEMPTS,
    companySheetSkipLocked: Boolean(lockSheetSkip),
    error: `Skipped — ${detail}`
  }).catch(() => {});
}

/**
 * Hosted-board interleaved flow: auto-apply with submit after files exist.
 * On incomplete apply, pause (keep tab open) so Start can retry.
 */
async function runHostedInterleavedApply(jobMeta = {}, board = "Dice") {
  if (!isDiceBatchAutoApply(board) && !(await isAutofillEnabled())) {
    await setStatus(`Row ${jobMeta.csvRow}: autofill disabled — files ready, apply skipped.`);
    return { status: "skipped", detail: "Autofill disabled", tabId: null, needsPause: false };
  }
  const boardLabel =
    board === "Indeed"
      ? "Indeed"
      : board === "Workday"
        ? "Workday"
        : board === "Greenhouse"
          ? "Greenhouse"
          : board === "Ashby"
            ? "Ashby"
            : board === "Lever"
              ? "Lever"
              : board === "Jobgether"
                ? "Jobgether"
                : "Dice";
  const jdLink = String(jobMeta.jdLink || "").trim();
  const prevAttempts = Number(jobMeta.applyAttempts || 0);

  const queueSnap = await getQueue().catch(() => []);
  const prior = (queueSnap || []).find((j) => Number(j.csvRow) === Number(jobMeta.csvRow));
  if (isJobMarkedInactive(prior || jobMeta)) {
    const detail = prior?.error || jobMeta.error || "inactive job";
    await setStatus(`Row ${jobMeta.csvRow}: inactive job — skipping apply.`);
    return { status: "unavailable", detail, tabId: null, needsPause: false };
  }

  const linkDup = await isJobLinkAlreadyCovered(jdLink, {
    excludeCsvRow: jobMeta.csvRow
  });
  if (linkDup.covered) {
    const queueSnap = await getQueue().catch(() => []);
    const prior = (queueSnap || []).find((j) => Number(j.csvRow) === Number(jobMeta.csvRow));
    const recheckAfterReadySkip = isRetriableReadyRowCompanySkip(prior);
    await updateQueueJob(jobMeta.csvRow, {
      applied: false,
      applyAttempted: true,
      applyAttempts: MAX_HOSTED_APPLY_ATTEMPTS,
      companySheetSkipLocked: recheckAfterReadySkip || Boolean(prior?.companySheetSkipLocked),
      error: `Skipped — ${linkDup.reason}`
    }).catch(() => {});
    await setStatus(
      `Row ${jobMeta.csvRow}: skipped duplicate job link. Continuing…`
    );
    return {
      status: "skipped",
      detail: linkDup.reason || "Duplicate job link",
      tabId: null,
      needsPause: false
    };
  }

  // Clearing a prior false-positive sheet skip so apply can proceed.
  if (jobMeta.csvRow != null && jobMeta.csvRow !== "") {
    await updateQueueJob(jobMeta.csvRow, {
      error: "",
      companySheetSkipLocked: false,
      applyAttempts: prevAttempts < MAX_HOSTED_APPLY_ATTEMPTS ? prevAttempts : 0
    }).catch(() => {});
  }

  if (!jdLink) {
    await updateQueueJob(jobMeta.csvRow, {
      applied: false,
      applyAttempted: true,
      applyAttempts: prevAttempts + 1,
      error: `Generated files, but missing job URL for ${boardLabel} auto-apply`
    });
    await setStatus(
      `Row ${jobMeta.csvRow}: files ready, but no JD link — skipping apply and continuing…`
    );
    return { status: "needs_review", detail: "Missing job URL", tabId: null };
  }

  if (batchControl.skipCurrent || batchControl.stop) {
    return { status: "skipped", detail: "Skipped before apply", tabId: null };
  }

  await setStatus(
    `${boardLabel} auto-apply: row ${jobMeta.csvRow} — ${jobMeta.companyName || jobMeta.company} / ${jobMeta.jobTitle || jobMeta.title}`
  );

  let applyResult;
  try {
    applyResult = await openJobAndApply(jdLink, {
      multiStep: true,
      autoSubmit: true,
      csvRow: jobMeta.csvRow,
      jobDir: jobMeta.jobDir || "",
      jdLink
    });
  } catch (err) {
    applyResult = {
      status: "needs_review",
      detail: String(err?.message || err).slice(0, 240),
      tabId: null
    };
  }

  if (batchControl.skipCurrent) {
    batchControl.skipCurrent = false;
    await closeApplyTab(applyResult?.tabId).catch(() => false);
    await updateQueueJob(jobMeta.csvRow, {
      applied: false,
      applyAttempted: true,
      applyAttempts: prevAttempts + 1,
      error: `Skipped during ${boardLabel} auto-apply`
    });
    return { ...applyResult, status: "skipped", detail: "Skipped during apply" };
  }

  const status = String(applyResult?.status || "");
  const detail = String(applyResult?.detail || "").slice(0, 240);
  const nextAttempts = prevAttempts + 1;

  if (status === "unavailable") {
    const sheetStatus = "inactive job";
    await markQueueJobInactive(
      {
        csvRow: jobMeta.csvRow,
        jobTitle: jobMeta.jobTitle || jobMeta.title || "",
        companyName: jobMeta.companyName || jobMeta.company || "",
        jdLink,
        salary: jobMeta.salary || "",
        jobDir: jobMeta.jobDir || applyResult?.uploadFolder || ""
      },
      detail || sheetStatus
    );
    await closeApplyTab(applyResult?.tabId).catch(() => false);
    return {
      ...applyResult,
      status: "unavailable",
      detail: detail || sheetStatus,
      needsPause: false
    };
  }

  if (status === "submitted") {
    const sheet = await markQueueJobAppliedOnSheet({
      csvRow: jobMeta.csvRow,
      jobTitle: jobMeta.jobTitle || jobMeta.title || "",
      companyName: jobMeta.companyName || jobMeta.company || "",
      jdLink,
      salary: jobMeta.salary || "",
      jobDir: jobMeta.jobDir || applyResult?.uploadFolder || ""
    });
    const appliedDate = sheet?.appliedDate || formatApplicationDateTime();
    const docsPatch = {
      applied: !sheet?.error,
      applyAttempted: true,
      applyAttempts: nextAttempts,
      appliedDate: sheet?.error ? "" : appliedDate,
      jobDir: applyResult?.uploadFolder || jobMeta.jobDir || "",
      hasFiles: true,
      error: sheet?.error ? `Submitted; sheet mark failed: ${sheet.error}` : ""
    };
    if (applyResult?.uploadResumeName) docsPatch.resumeName = applyResult.uploadResumeName;
    if (applyResult?.uploadCoverName) docsPatch.coverName = applyResult.uploadCoverName;
    await updateQueueJob(jobMeta.csvRow, docsPatch).catch(() => {});
    await rememberApplyHistory(jobMeta.csvRow, {
      jobDir: docsPatch.jobDir,
      jdLink,
      applied: docsPatch.applied,
      appliedDate: docsPatch.appliedDate
    }).catch(() => {});
    await setStatus(
      sheet?.error
        ? `Row ${jobMeta.csvRow}: submitted, but sheet mark failed (${sheet.error}). Continuing…`
        : `Row ${jobMeta.csvRow}: submitted and marked Applied. Closing tab…`
    );
    await closeApplyTab(applyResult?.tabId).catch(() => false);
    return applyResult;
  }

  const reviewMsg =
    detail ||
    (status === "unavailable" ? "Job unavailable" : "Apply needs review (login, CAPTCHA, or form blocker)");
  const exhausted = status === "skipped" || nextAttempts >= MAX_HOSTED_APPLY_ATTEMPTS;
  await updateQueueJob(jobMeta.csvRow, {
    applied: false,
    applyAttempted: exhausted,
    applyAttempts: status === "skipped" ? MAX_HOSTED_APPLY_ATTEMPTS : nextAttempts,
    error: reviewMsg.slice(0, 240)
  }).catch(() => {});
  await setStatus(`Row ${jobMeta.csvRow}: ${reviewMsg}`);
  await trySlackJobStatus({
    outcome: "error",
    csvRow: jobMeta.csvRow,
    company: jobMeta.companyName || jobMeta.company || "",
    jobTitle: jobMeta.jobTitle || jobMeta.title || "",
    jdLink,
    message: `${boardLabel} auto-apply: ${reviewMsg}`,
    attempts: nextAttempts,
    maxAttempts: MAX_HOSTED_APPLY_ATTEMPTS,
    progress: await queueSlackProgress().catch(() => null)
  }).catch(() => {});

  // Keep the tab open for review when submit did not finish.
  applyResult = {
    ...applyResult,
    status: status || "needs_review",
    detail: reviewMsg,
    needsPause: !exhausted && status !== "unavailable" && status !== "skipped"
  };
  return applyResult;
}

async function pauseAfterFailedHostedApply(applyResult, jobLabel = "") {
  const detail = String(applyResult?.detail || "Application needs review");
  await setBatchState("paused");
  await setStatus(
    `${jobLabel ? `Row ${jobLabel}: ` : ""}${detail}. Batch paused — fix the form (login/CAPTCHA/Next), then click Start to retry apply.`
  );
  await chrome.storage.local.set({ generation_running: false });
}

function hostedApplyAttemptCount(j) {
  const n = Number(j.applyAttempts || 0);
  if (n > 0) return n;
  // Legacy rows only had applyAttempted — count as one try so Start can still retry.
  return j.applyAttempted ? 1 : 0;
}

/** Prior skip from a false-positive sheet duplicate (legacy company or link). */
function isRetriableReadyRowCompanySkip(j) {
  return (
    Boolean(j) &&
    !j.companySheetSkipLocked &&
    /^Skipped — same (company|job link) already on Google Sheet/i.test(String(j.error || ""))
  );
}

function isIndeedHostedApplyJob(j) {
  if (!isIndeedJob(j || {})) return false;
  return isExplicitlyHostedIndeedJob(j);
}

function isHostedApplyBacklogJob(j, person = null) {
  const hostedIndeed = isIndeedHostedApplyJob(j);
  const workday = isWorkdayJob(j || {});
  const greenhouse = isGreenhouseJob(j || {});
  const ashby = isAshbyJob(j || {});
  const lever = isLeverJob(j || {});
  const jobgether = isJobgetherJob(j || {});
  if (
    !(isDiceJob(j) || hostedIndeed || workday || greenhouse || ashby || lever || jobgether) ||
    j.status !== "done" ||
    j.applied ||
    isJobMarkedInactive(j) ||
    !Boolean(j.jobDir || j.hasFiles) ||
    !String(j.jdLink || "").trim()
  ) {
    return false;
  }
  const attempts = hostedApplyAttemptCount(j);
  if (attempts >= MAX_HOSTED_APPLY_ATTEMPTS && !isRetriableReadyRowCompanySkip(j)) {
    return false;
  }
  if (person) return jobBelongsToPerson(j, person);
  return true;
}

/**
 * Skip queue jobs whose JD link is already on the Google Sheet (or appears
 * twice in this queue). Alerts Slack with the skipped list.
 */
async function dedupeQueueAgainstSheet({ notifySlack = true } = {}) {
  const { spreadsheetUrl, webAppUrl } = await getSheetConfig();
  let links = [];
  let sheetError = "";
  let sheetConfigured = Boolean(spreadsheetUrl && webAppUrl);

  if (sheetConfigured) {
    await setStatus("Checking Google Sheet for job links already bid…");
    try {
      const keys = await fetchExistingSheetDedupKeys({ spreadsheetUrl, webAppUrl });
      links = keys.links || [];
    } catch (err) {
      sheetError = String(err?.message || err);
      await setStatus(
        `Sheet duplicate check failed (${sheetError}). Deduping within this queue only…`
      );
    }
  } else {
    await setStatus("Google Sheet not configured — deduping within this queue only…");
  }

  const knownLinks = buildKnownLinkSet(links);
  const queue = await getQueue();
  const person = await getActivePerson().catch(() => null);
  const duplicates = [];
  const seenLinks = new Set(knownLinks);

  for (const job of queue) {
    if (person && !jobBelongsToPerson(job, person)) continue;
    if (!(job.status === "done" || job.status === "skipped" || job.applied || job.inactive)) {
      continue;
    }
    const linkKey = normalizeJobLink(job.jdLink || "");
    if (linkKey) seenLinks.add(linkKey);
  }

  const next = queue.map((job) => {
    if (job.status === "done" || job.status === "skipped") return job;
    if (person && job.profileId && !jobBelongsToPerson(job, person)) return job;
    const linkKey = normalizeJobLink(job.jdLink || "");

    if (linkKey && seenLinks.has(linkKey)) {
      duplicates.push(job);
      return {
        ...job,
        status: "skipped",
        error: sheetConfigured
          ? "Duplicate — same job link already in Google Sheet (or earlier in this CSV)"
          : "Duplicate — same job link already earlier in this CSV"
      };
    }

    if (linkKey) seenLinks.add(linkKey);
    return person?.id ? { ...job, profileId: job.profileId || person.id } : job;
  });

  if (duplicates.length) {
    await setQueue(next);
    if (notifySlack) {
      await trySlackDuplicates(duplicates, links.length);
    }
  }

  return {
    ok: sheetConfigured ? !sheetError : true,
    checked: true,
    skipped: duplicates.length,
    sheetLinkCount: links.length,
    pendingLeft: next.filter((j) => j.status === "pending" || j.status === "error").length,
    duplicates,
    ...(!sheetConfigured
      ? { reason: "Google Sheet not configured — duplicate check used queue only." }
      : {}),
    ...(sheetError ? { error: sheetError } : {})
  };
}

function startDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: false,
        conflictAction: "uniquify"
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (typeof downloadId !== "number") {
          reject(new Error("Chrome refused the download (no id returned)."));
          return;
        }
        resolve(downloadId);
      }
    );
  });
}

/**
 * chrome.downloads.download() resolves as soon as the download *starts*, so an
 * interrupted write (blocked, disk full, bad path) used to be reported as a
 * success. Wait for the terminal state and surface the real error instead.
 */
function waitForDownloadComplete(downloadId, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err, filename) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (err) reject(err);
      else resolve(filename || "");
    };

    const inspect = (item) => {
      if (!item) return;
      if (item.state === "complete") finish(null, item.filename);
      else if (item.state === "interrupted") {
        finish(new Error(`Download interrupted (${item.error || "unknown reason"}).`));
      }
    };

    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") {
        chrome.downloads.search({ id: downloadId }).then(
          (items) => finish(null, items?.[0]?.filename || ""),
          () => finish(null, "")
        );
      } else if (delta.state?.current === "interrupted") {
        finish(new Error(`Download interrupted (${delta.error?.current || "unknown reason"}).`));
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);

    // The terminal state can land before the listener attaches (data: URLs are fast).
    const check = () => {
      chrome.downloads.search({ id: downloadId }).then((items) => inspect(items?.[0]), () => {});
    };
    const poll = setInterval(check, 1000);
    check();

    const timer = setTimeout(() => {
      // Slow disk is not a failure — treat a still-running download as started.
      finish(null, "");
    }, timeoutMs);
  });
}

async function downloadDataUrl(url, filename) {
  const downloadId = await startDownload(url, filename);
  await waitForDownloadComplete(downloadId);
  return downloadId;
}

/** data: URLs have size limits — keep JD downloads under a safe ceiling. */
function downloadTextFile(text, mimeType, filename) {
  let body = String(text || "");
  const maxChars = 400000;
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars)}\n\n---\n[Truncated for download size limit]\n`;
  }
  const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(body)}`;
  return downloadDataUrl(url, filename);
}

function downloadBase64File(base64, mimeType, filename) {
  const url = `data:${mimeType};base64,${base64}`;
  return downloadDataUrl(url, filename);
}

function sanitizePathSegment(value, fallback = "untitled") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

/** Prefer explicit dir, then stored settings, then Applications-{person}. */
async function resolveOutputDir(explicit = "") {
  const fromArg = String(explicit || "").trim();
  if (fromArg) return sanitizePathSegment(fromArg, fromArg);
  try {
    const data = await chrome.storage.local.get(["output_dir", "batch_output_dir"]);
    const stored = String(data.output_dir || data.batch_output_dir || "").trim();
    if (stored) return sanitizePathSegment(stored, stored);
  } catch {
    // ignore
  }
  try {
    const person = await getActivePerson();
    return sanitizePathSegment(outputDirFromPerson(person), "Applications");
  } catch {
    return "Applications";
  }
}

function joinDownloadPath(...parts) {
  return parts
    .map((part) => String(part || "").replace(/^\/+|\/+$/g, "").replace(/\\/g, "/"))
    .filter(Boolean)
    .join("/");
}

function buildJdTxtContent({ jobTitle, companyName, jdLink, jdText }) {
  return [
    `Job Title: ${jobTitle || ""}`,
    `Company: ${companyName || ""}`,
    `JD Link: ${jdLink || ""}`,
    "",
    "---",
    "",
    jdText || ""
  ].join("\n");
}

function enforceHeaderStructure(html) {
  if (/<h1[\s\S]*?<\/h1>/i.test(html) && /class\s*=\s*["'][^"']*contact[^"']*["']/i.test(html)) {
    return html;
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return html;
  const bodyContent = bodyMatch[1];

  const blocks = Array.from(
    bodyContent.matchAll(/<(p|div|h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi)
  ).map((m) => ({ full: m[0], text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }));

  const meaningful = blocks.filter((b) => b.text);
  if (!meaningful.length) return html;

  const nameText = meaningful[0].text;
  const contactText = meaningful[1]?.text || "";

  let updatedBody = bodyContent;
  updatedBody = updatedBody.replace(meaningful[0].full, "");
  if (meaningful[1]) updatedBody = updatedBody.replace(meaningful[1].full, "");

  const headerHtml = `<div class="top"><h1>${nameText}</h1><p class="contact">${contactText}</p></div>`;
  const rebuilt = `${headerHtml}${updatedBody}`;

  return html.replace(/<body[^>]*>[\s\S]*?<\/body>/i, (m) =>
    m.replace(bodyMatch[1], rebuilt)
  );
}

function splitCombinedRoleHeadlines(html) {
  // Convert:
  // Senior Software Engineer | Uniqcli | Aug 2022 - Present | Chicago Ridge, United States
  // into:
  // Uniqcli Aug 2022 - Present
  // Senior Software Engineer Chicago Ridge, United States
  const pattern =
    /(^|>)([^<\n|]+?)\s*\|\s*([^<\n|]+?)\s*\|\s*([A-Za-z]{3}\s+\d{4}\s*-\s*(?:Present|[A-Za-z]{3}\s+\d{4}))\s*\|\s*([^<\n]+?)(?=<|$)/gim;

  return html.replace(pattern, (_m, prefix, title, company, dates, location) => {
    const c = company.trim();
    const d = dates.trim();
    const t = title.trim();
    const l = location.trim();
    return `${prefix}<p class="role-company">${c} ${d}</p><p class="role-meta">${t} ${l}</p>`;
  });
}

function boldSkillsSection(html) {
  const headingPattern = /<h[1-6][^>]*>\s*SKILLS\s*<\/h[1-6]>/i;
  if (!headingPattern.test(html)) return html;

  return html.replace(
    /(<h[1-6][^>]*>\s*SKILLS\s*<\/h[1-6]>\s*)([\s\S]*?)(?=<h[1-6][^>]*>|\s*$)/i,
    (_m, heading, sectionBody) => {
      const updated = sectionBody
        .replace(/<li([^>]*)>([\s\S]*?)<\/li>/gi, (_li, attrs, content) => {
          if (/<strong[\s>]/i.test(content)) return `<li${attrs}>${content}</li>`;
          return `<li${attrs}><strong>${content.trim()}</strong></li>`;
        })
        .replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (_p, attrs, content) => {
          const textOnly = content.replace(/<[^>]+>/g, "").trim();
          if (!textOnly) return `<p${attrs}>${content}</p>`;
          if (/<strong[\s>]/i.test(content)) return `<p${attrs}>${content}</p>`;
          return `<p${attrs}><strong>${content.trim()}</strong></p>`;
        });
      return `${heading}${updated}`;
    }
  );
}

/** Keep bullets as authored — do not pad or truncate GPT content. */
function enforceBulletLengthAndSentence(html) {
  return html;
}

function enforceA4PrintCss(html) {
  const css = `
@page { size: A4; margin: 10mm; }
html, body { width: 210mm; }
body {
  font-family: "Times New Roman", Times, serif !important;
  font-size: 10.8pt !important;
  line-height: 1.18 !important;
}
h1 {
  text-align: center !important;
  font-size: 22.5pt !important;
  margin: 0 0 3px 0 !important;
}
.top, .header, .contact {
  text-align: center !important;
}
.top { margin-bottom: 5px !important; }
.top .contact { margin: 0 0 2px 0 !important; }
h2, .section-title {
  margin-top: 9px !important;
  margin-bottom: 4px !important;
  padding-bottom: 2px !important;
}
h3, .role-company {
  margin-top: 7px !important;
  margin-bottom: 2px !important;
}
.role-meta {
  margin-top: 0 !important;
  margin-bottom: 6px !important;
}
p, li {
  margin-top: 0 !important;
  margin-bottom: 2.6px !important;
  line-height: 1.18 !important;
  text-align: justify !important;
  text-justify: inter-word !important;
  text-align-last: left !important;
}
ul { margin-top: 0 !important; margin-bottom: 6px !important; }
li { margin-bottom: 3px !important; }
h2 + p, h2 + ul, h2 + div, h2 + h3 { margin-top: 3px !important; }
h3 + p, h3 + ul, .role-meta + p { margin-top: 3px !important; }
.role-meta + ul { margin-top: 10px !important; }
a, a:visited {
  color: #000 !important;
  text-decoration: underline !important;
}
`;
  if (/<style[\s\S]*@page\s*\{[\s\S]*size\s*:\s*A4/i.test(html)) {
    return html.replace(/<\/head>/i, `<style>${css}</style></head>`);
  }

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}<style>${css}</style>`);
  }

  return `<!doctype html><html><head><style>${css}</style></head><body>${html}</body></html>`;
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      finish(new Error("Timed out waiting for render tab."));
    }, timeoutMs);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    // data: URLs often finish loading before the listener is attached.
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab?.status === "complete") finish();
      })
      .catch((err) => finish(err instanceof Error ? err : new Error(String(err))));
  });
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function debuggerAttach(debuggee) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(debuggee, "1.3", () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function debuggerDetach(debuggee) {
  return new Promise((resolve) => {
    chrome.debugger.detach(debuggee, () => resolve());
  });
}

function debuggerCommand(debuggee, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

/**
 * Render HTML → PDF via a background tab + debugger.
 * Times out if Chrome's "Allow debugger" prompt is ignored.
 */
async function htmlToPdfBase64Once(html, { active = false } = {}) {
  // active:false by default — stealing focus here breaks ChatGPT's composer
  // between jobs. The last retry falls back to a visible tab.
  const tab = await chrome.tabs.create({ url: "about:blank", active });
  if (!tab.id) throw new Error("Failed to create render tab.");
  const tabId = tab.id;
  const debuggee = { tabId };

  const printParams = {
    printBackground: true,
    paperWidth: 8.27,
    paperHeight: 11.69,
    marginTop: 0.4,
    marginBottom: 0.4,
    marginLeft: 0.35,
    marginRight: 0.35,
    preferCSSPageSize: true
  };

  try {
    await withTimeout(waitForTabComplete(tabId, 10000), 12000, "Timed out opening blank render tab.");
    await withTimeout(
      debuggerAttach(debuggee),
      15000,
      "PDF debugger attach timed out. Click Allow on Chrome's debugger permission prompt, then retry."
    );
    try {
      await debuggerCommand(debuggee, "Page.enable");

      let loaded = false;
      try {
        const frameTree = await debuggerCommand(debuggee, "Page.getFrameTree");
        const frameId = frameTree?.frameTree?.frame?.id;
        if (frameId) {
          await debuggerCommand(debuggee, "Page.setDocumentContent", {
            frameId,
            html: String(html || "")
          });
          loaded = true;
        }
      } catch {
        loaded = false;
      }

      if (!loaded) {
        // Fallback for environments where setDocumentContent is blocked.
        await setStatus("PDF fallback: loading HTML via data URL…");
        await chrome.tabs.update(tabId, {
          url: `data:text/html;charset=utf-8,${encodeURIComponent(String(html || ""))}`
        });
        await withTimeout(waitForTabComplete(tabId, 15000), 18000, "Timed out loading resume HTML for PDF.");
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      await setStatus("Printing PDF…");
      const result = await withTimeout(
        debuggerCommand(debuggee, "Page.printToPDF", printParams),
        45000,
        "Page.printToPDF timed out."
      );
      if (!result?.data) throw new Error("PDF generation returned empty data.");
      return result.data;
    } finally {
      await debuggerDetach(debuggee);
    }
  } finally {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // tab may already be closed
    }
  }
}

/** Render HTML → PDF, retrying transient debugger/attach failures automatically. */
async function htmlToPdfBase64(html, { attempts = 3 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const lastTry = attempt === attempts;
      await setStatus(
        attempt === 1
          ? "Generating PDF… (click Allow if Chrome asks about debugging)"
          : `Generating PDF… retry ${attempt}/${attempts}${lastTry ? " (visible tab)" : ""}`
      );
      return await htmlToPdfBase64Once(html, { active: lastTry });
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      // A debuggee already attached (DevTools open, or a previous run left it
      // attached) is the common transient case — back off and try again.
      if (attempt < attempts) {
        await setStatus(`PDF attempt ${attempt} failed (${msg}). Retrying…`);
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || "PDF generation failed."));
}

// MV3 service workers have no URL.createObjectURL / Blob URL support,
// so all downloads use data: URLs (see downloadTextFile / downloadBase64File above).

function buildJobFolderName(jobMeta = {}) {
  const companyPart = String(jobMeta.companyName || "").trim() || "Company";
  const titlePart = String(jobMeta.jobTitle || "").trim() || "untitled-job";
  const csvRow = jobMeta.csvRow;
  if (csvRow != null && csvRow !== "" && !Number.isNaN(Number(csvRow))) {
    return sanitizePathSegment(`${Number(csvRow)} - ${companyPart} - ${titlePart}`, "untitled-job");
  }
  return sanitizePathSegment(`${companyPart} - ${titlePart}`, "untitled-job");
}

/** First-name token for files like Name_Resume.pdf / Name_Cover Letter.pdf */
function outputNameToken(jobMeta = {}, resumeData = {}) {
  const prefix = String(jobMeta.resumeFilePrefix || "").trim();
  if (prefix) {
    const cleaned = prefix.replace(/_?(Resume|resume)$/i, "").replace(/_+$/, "");
    if (cleaned) return sanitizePathSegment(cleaned, "Applicant");
  }
  const full = String(resumeData?.name || jobMeta.personName || "Applicant").trim();
  const first = full.split(/\s+/)[0] || "Applicant";
  return sanitizePathSegment(first, "Applicant");
}

async function autoDownloadResumeFiles(rawText, resumeData, jobMeta = {}) {
  // Style comes from the selected Brightstar template; content comes from resume JSON.
  const templateId = jobMeta.templateId || "times-classic";
  const outputDir = await resolveOutputDir(jobMeta.outputDir);
  const jobFolder = buildJobFolderName(jobMeta);
  const jobDir = joinDownloadPath(outputDir, jobFolder);
  const nameToken = outputNameToken(jobMeta, resumeData);
  const resumePdfName = `${nameToken}_Resume.pdf`;

  const jdTxt = buildJdTxtContent({
    jobTitle: jobMeta.jobTitle || "",
    companyName: jobMeta.companyName || "",
    jdLink: jobMeta.jdLink || "",
    jdText: jobMeta.jdText || ""
  });

  const saved = { jd: false, pdf: false, pdfError: "", resumePdfName, nameToken };

  await setStatus(`Saving jd.txt → Downloads / ${jobDir}`);
  try {
    await downloadTextFile(jdTxt, "text/plain", joinDownloadPath(jobDir, "jd.txt"));
    saved.jd = true;
  } catch (err) {
    throw new Error(`Failed to save jd.txt: ${String(err?.message || err)}`);
  }

  // Persist JSON snapshot immediately so progress is visible even if PDF hangs.
  try {
    await chrome.storage.local.set({
      last_response: String(rawText || "").slice(0, 200000),
      last_resume_json: resumeData,
      last_output_dir: jobDir
    });
  } catch {
    // ignore
  }

  let html = "";
  try {
    await setStatus("Building resume HTML…");
    html = resumeJsonToHtml(resumeData, templateId);
  } catch (err) {
    throw new Error(`Resume HTML render failed: ${String(err?.message || err)}`);
  }

  await setStatus(
    `Saving ${resumePdfName}… (Allow debugger if Chrome prompts — do not ignore the dialog)`
  );
  try {
    const pdfBase64 = await htmlToPdfBase64(html);
    await setStatus(`Downloading ${resumePdfName}…`);
    await downloadBase64File(pdfBase64, "application/pdf", joinDownloadPath(jobDir, resumePdfName));
    saved.pdf = true;
    await setLastGeneratedDocs({
      resume: { fileName: resumePdfName, mimeType: "application/pdf", base64: pdfBase64 },
      folderName: jobDir,
      jobDir,
      csvRow: jobMeta.csvRow,
      jdLink: jobMeta.jdLink || ""
    }).catch(() => {});
  } catch (err) {
    saved.pdfError = `${resumePdfName} failed: ${String(err?.message || err)}`;
    throw new Error(saved.pdfError);
  }

  return { jobDir, resumeFilePrefix: `${nameToken}_Resume`, nameToken, resumePdfName, saved };
}

function coverLetterTextToParagraphs(raw) {
  let s = String(raw || "");

  // If ChatGPT returned HTML anyway, convert block boundaries to newlines, then strip tags.
  if (/<\/?[a-z][^>]*>/i.test(s)) {
    s = s
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*(p|div|h[1-6]|li|section|article)\s*>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  // Strip ChatGPT message-toolbar labels that innerText captures around the
  // reply (e.g. a leading "Edit", "Copy", "Share"). Remove them line by line
  // from the very start so the letter opens with the real salutation.
  let prevLabel;
  do {
    prevLabel = s;
    s = s.replace(
      /^\s*(?:edit|copy code|copy|share|regenerate(?: response)?|read aloud|good response|bad response|continue|stop generating)\s*(?:\r?\n)+/i,
      ""
    );
  } while (s !== prevLabel);

  // Strip markdown code fences / links ChatGPT sometimes injects.
  s = s.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "");
  s = s.replace(/\[([^\]]*)\]\(([^)]+)\)/g, "$1");
  s = s.replace(/https?:\/\/[^\s)]+/gi, (url) => {
    // Keep bare URLs out of the letter body — signature already has LinkedIn.
    if (/linkedin\.com/i.test(url) || /mailto:/i.test(url)) return "";
    return url;
  });

  return s
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

function cleanCoverLetterParagraphs(paragraphs, name) {
  const nameLc = String(name || "").toLowerCase().trim();
  const firstNameLc = nameLc.split(/\s+/)[0] || "";
  const closingRe = /^(sincerely|regards|best regards|kind regards|warm regards|best|respectfully|thank you)\b[,.]?$/i;
  const uiLabelRe =
    /^(edit|copy code|copy|share|regenerate( response)?|read aloud|good response|bad response|continue|stop generating)$/i;

  return paragraphs.filter((p) => {
    const lc = p.toLowerCase().trim();
    if (!lc) return false;
    if (uiLabelRe.test(lc)) return false; // ChatGPT message-toolbar button labels
    if (closingRe.test(lc)) return false; // local signature adds this
    if (nameLc && lc === nameLc) return false; // trailing full-name line
    if (firstNameLc && lc === firstNameLc) return false; // trailing first-name line
    if (/^(email|phone|linkedin|mobile|tel)\s*:/i.test(p)) return false; // contact echoes
    // Drop accidental JSON / resume dumps into the letter body.
    if (/^\s*\{/.test(p) && /"experience"|"technicalSummary"/i.test(p)) return false;
    if (/^["']?name["']?\s*:/i.test(p)) return false;
    return true;
  });
}

function looksLikeCoverLetterBody(text) {
  const s = String(text || "").trim();
  if (s.length < 80) return false;
  // Resume JSON dumped into the "letter" slot.
  if (/"experience"\s*:/.test(s) && /"technicalSummary"|"certifications"\s*:/.test(s)) return false;
  if (/^\s*\{/.test(s) && /"name"\s*:/.test(s)) return false;
  if (/dear\s+/i.test(s) || /hiring\s+(manager|team)/i.test(s)) return true;
  // Plain multi-paragraph letter without salutation still OK if long enough.
  const paras = s.split(/\n\s*\n+/).filter((p) => p.trim().length > 40);
  if (paras.length >= 2 && s.length >= 180) return true;
  return s.length >= 220 && !/"experience"\s*:/.test(s);
}

/** Read only the newest assistant turn — used so cover letters are not the prior JSON. */
async function readLatestAssistantPlainText(tabId) {
  if (typeof tabId !== "number") return "";
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const blocks = document.querySelectorAll(
          [
            "[data-message-author-role='assistant']",
            "[data-message-author-role=assistant]",
            "[data-turn='assistant']",
            "section[data-turn='assistant']",
            '[data-testid="assistant-message"]',
            '[data-testid="assistant"]',
            '[class*="assistant-message"]',
            '[class*="font-claude-message"]'
          ].join(", ")
        );
        if (!blocks.length) return "";
        const last = blocks[blocks.length - 1];
        return (last.innerText || last.textContent || "").trim().slice(0, 20000);
      }
    });
    return String(results?.[0]?.result || "").trim();
  } catch {
    return "";
  }
}

/** Prefer person-profile contact over ChatGPT-mangled JSON fields. */
async function finalizeResumeData(resumeData) {
  let data = sanitizeResumeData(resumeData) || resumeData;
  if (!data || typeof data !== "object") return data;
  try {
    const contact = await getAutofillContact();
    data = {
      ...data,
      name: contact.name || data.name,
      email: contact.email || data.email,
      phone: contact.phone || data.phone,
      linkedin: contact.linkedin || data.linkedin,
      location: contact.location || data.location
    };
  } catch {
    // keep sanitized data
  }
  return sanitizeResumeData(data);
}

// Replace every markdown link `[text](url)` with its destination URL.
function stripMarkdownLink(value) {
  return String(value || "")
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_match, _text, url) => url)
    .trim();
}

function buildCoverLetterHtml(rawText, contact = {}) {
  const esc = (v) =>
    String(v || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const name = String(contact.name || "").trim() || "Applicant";
  const title = String(contact.signatureTitle || contact.headline || "").trim();
  const email = stripMarkdownLink(contact.email || "")
    .replace(/^mailto:/i, "")
    .trim();
  let phone = String(contact.phone || "")
    .replace(/^\+1\s*/i, "")
    .trim();
  let linkedin = stripMarkdownLink(contact.linkedin || "").trim();
  if (linkedin && !/^https?:\/\//i.test(linkedin)) linkedin = `https://${linkedin}`;
  if (linkedin && !/\/$/.test(linkedin)) linkedin = `${linkedin}/`;

  const paragraphs = cleanCoverLetterParagraphs(coverLetterTextToParagraphs(rawText), name);
  const bodyHtml = paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n");

  const signatureLines = [
    `<p>Sincerely,</p>`,
    `<p class="cl-name-sign">${esc(name)}</p>`,
    title ? `<p class="cl-sign-title">${esc(title)}</p>` : "",
    email ? `<p class="cl-sign-line">✉️ <a href="mailto:${esc(email)}">${esc(email)}</a></p>` : "",
    phone ? `<p class="cl-sign-line">📞 ${esc(phone)}</p>` : "",
    linkedin ? `<p class="cl-sign-line">🌐 <a href="${esc(linkedin)}">${esc(linkedin)}</a></p>` : ""
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 18mm; }
  body {
    font-family: "Times New Roman", Times, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif;
    font-size: 11pt;
    line-height: 1.45;
    color: #000;
    margin: 0;
  }
  p { margin: 0 0 12px 0; text-align: justify; }
  a, a:visited { color: #000; text-decoration: underline; }
  .signature { margin-top: 6px; }
  .signature p { margin: 0 0 2px 0; text-align: left; }
  .signature .cl-name-sign { font-weight: 700; margin-top: 10px; }
  .signature .cl-sign-title { margin-bottom: 4px; }
  .signature .cl-sign-line { font-size: 10.5pt; }
</style>
</head>
<body>
  ${bodyHtml}
  <div class="signature">
    ${signatureLines.join("\n    ")}
  </div>
</body>
</html>`;
}

async function autoDownloadCoverLetterPdf(
  rawText,
  jobDir,
  contact = {},
  nameToken = "Applicant",
  jobMeta = {}
) {
  const plain = String(rawText || "").trim();
  const token = sanitizePathSegment(nameToken || "Applicant", "Applicant");
  const coverPdfName = `${token}_Cover Letter.pdf`;
  try {
    const html = buildCoverLetterHtml(rawText, contact);
    const pdfBase64 = await htmlToPdfBase64(html);
    await chrome.storage.local.set({
      last_cover_letter_response: plain.slice(0, 100000)
    }).catch(() => {});
    await downloadBase64File(
      pdfBase64,
      "application/pdf",
      joinDownloadPath(jobDir, coverPdfName)
    );
    await setLastGeneratedDocs({
      coverLetter: { fileName: coverPdfName, mimeType: "application/pdf", base64: pdfBase64 },
      folderName: jobDir,
      jobDir,
      csvRow: jobMeta.csvRow,
      jdLink: jobMeta.jdLink || ""
    }).catch(() => {});
    return { pdf: true, coverPdfName };
  } catch (err) {
    throw new Error(
      `${coverPdfName} failed (Allow debugger if Chrome prompts): ${String(err?.message || err)}`
    );
  }
}

/** Pause between finished jobs so ChatGPT is less likely to rate-limit.
 * Each job = new chat + resume + cover letter (2–3 sends). Overridable via storage. */
const DEFAULT_JOB_GAP_SEC = 45;
const MIN_JOB_GAP_SEC = 15;
const MAX_JOB_GAP_SEC = 180;
const DEFAULT_HARD_PAUSE_HITS = 3;
const CHATGPT_PACING_KEY = "chatgpt_pacing";

/** Minimum wait after a rate-limit modal before we probe “cleared”. */
const RATE_LIMIT_BASE_WAIT_MS = 60 * 1000;
/** Cap how long we sit on one rate-limit encounter. */
const RATE_LIMIT_MAX_WAIT_MS = 8 * 60 * 1000;
/** Quiet time after a hit before the next Send (overlaps with the wait above). */
const RATE_LIMIT_AFTER_HIT_MS = 45 * 1000;
/** How often to re-check whether the rate-limit UI is gone. */
const RATE_LIMIT_PROBE_MS = 12 * 1000;
/** Brief settle after the UI clears before sending again. */
const RATE_LIMIT_CLEAR_SETTLE_MS = 4 * 1000;
/** Gap before cover-letter send in the same chat. */
const COVER_LETTER_GAP_MS = 6 * 1000;

/** Timestamp of the last ChatGPT rate-limit detection (ms). */
let lastRateLimitHitAt = 0;
/** Escalate job gaps after repeated rate limits in one batch. */
let rateLimitHitsThisBatch = 0;
/** Cached pacing prefs (refreshed at batch start). */
let pacingCache = {
  jobGapSeconds: DEFAULT_JOB_GAP_SEC,
  hardPauseAfterHits: DEFAULT_HARD_PAUSE_HITS
};

function clampNumber(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

async function getChatGptPacing() {
  try {
    const data = await chrome.storage.local.get(CHATGPT_PACING_KEY);
    const raw = data[CHATGPT_PACING_KEY] || {};
    return {
      jobGapSeconds: clampNumber(
        raw.jobGapSeconds,
        MIN_JOB_GAP_SEC,
        MAX_JOB_GAP_SEC,
        DEFAULT_JOB_GAP_SEC
      ),
      hardPauseAfterHits: clampNumber(raw.hardPauseAfterHits, 2, 10, DEFAULT_HARD_PAUSE_HITS)
    };
  } catch {
    return {
      jobGapSeconds: DEFAULT_JOB_GAP_SEC,
      hardPauseAfterHits: DEFAULT_HARD_PAUSE_HITS
    };
  }
}

async function refreshPacingCache() {
  pacingCache = await getChatGptPacing();
  return pacingCache;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Human-readable remaining wait (seconds under ~2 min). */
function formatWaitLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 120) return `${s}s`;
  return `${Math.ceil(s / 60)}m`;
}

/**
 * Gap between jobs: user base + escalate after rate-limit hits + ±15% jitter
 * so sends are less metronomic.
 */
function currentJobGapMs() {
  const hits = rateLimitHitsThisBatch;
  let base = (pacingCache.jobGapSeconds || DEFAULT_JOB_GAP_SEC) * 1000;
  if (hits >= 3) base = Math.max(base, 90 * 1000);
  else if (hits >= 1) base = Math.max(base, Math.round(base * 1.75));
  const factor = 0.85 + Math.random() * 0.3;
  return Math.round(base * factor);
}

/** After too many ChatGPT rate limits in one batch, pause for a human cool-down. */
async function maybeHardPauseForRateLimit(detail = "") {
  const limit = pacingCache.hardPauseAfterHits || DEFAULT_HARD_PAUSE_HITS;
  if (rateLimitHitsThisBatch < limit) return false;
  const msg =
    `ChatGPT rate-limited ${rateLimitHitsThisBatch}× this batch — paused so the account can cool down. ` +
    `Wait a few minutes, then click Start.${detail ? ` (${detail})` : ""}`;
  await setBatchState("paused");
  await setStatus(msg);
  await chrome.storage.local.set({ generation_running: false });
  await trySlackAlert({
    title: "Batch paused — ChatGPT rate limit ⛔",
    message: msg
  }).catch(() => {});
  return true;
}

/**
 * Detect ChatGPT's "Too many requests" / temporary access limit UI.
 * Also clicks "Got it" when present so the modal does not block the composer.
 */
async function detectChatGptRateLimit(tabId) {
  if (typeof tabId !== "number") return { limited: false };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const hay = `${document.body?.innerText || ""}`.slice(0, 40000);
        const limited =
          /too many requests/i.test(hay) ||
          /making requests too quickly/i.test(hay) ||
          /temporarily limited access(?: to your conversations)?/i.test(hay) ||
          (/please wait a few minutes/i.test(hay) && /trying again/i.test(hay));

        // Headings / toast nodes often lack role=dialog.
        const nodes = Array.from(
          document.querySelectorAll(
            '[role="dialog"], [role="alertdialog"], [data-testid*="modal"], h2, h3, [class*="toast"], [class*="Toast"], [class*="modal"]'
          )
        );
        const nodeHit = nodes.some((el) => {
          const t = `${el.innerText || el.textContent || ""}`;
          return /too many requests/i.test(t) || /making requests too quickly/i.test(t);
        });

        if (!limited && !nodeHit) return { limited: false, dismissed: false };

        let dismissed = false;
        const buttons = Array.from(document.querySelectorAll("button"));
        for (const btn of buttons) {
          const label = `${btn.textContent || ""} ${btn.getAttribute("aria-label") || ""}`.trim();
          if (/^got it$/i.test(label) || /^ok$/i.test(label) || /^dismiss$/i.test(label)) {
            try {
              btn.click();
              dismissed = true;
              break;
            } catch {
              // ignore
            }
          }
        }
        return { limited: true, dismissed };
      }
    });
    return results?.[0]?.result || { limited: false };
  } catch {
    return { limited: false };
  }
}

/**
 * Detect Claude overload / capacity / "try again later" UI.
 * Clicks Retry / Try again when present.
 */
async function detectClaudeCapacityLimit(tabId) {
  if (typeof tabId !== "number") return { limited: false };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const hay = `${document.body?.innerText || ""}`.slice(0, 40000);
        const limited =
          /\bat (?:full )?capacity\b/i.test(hay) ||
          /\boverloaded\b/i.test(hay) ||
          /\bhigh demand\b/i.test(hay) ||
          /\bunable to (?:process|complete) (?:your )?(?:request|message)\b/i.test(hay) ||
          (/\btry again (?:later|in a (?:few |couple )?(?:minutes?|moments?))\b/i.test(hay) &&
            /\b(error|issue|problem|unavailable|capacity)\b/i.test(hay)) ||
          /\bClaude is (?:experiencing|having) (?:high|elevated) (?:traffic|load|demand)\b/i.test(hay);

        if (!limited) return { limited: false, dismissed: false };

        let dismissed = false;
        for (const btn of document.querySelectorAll("button")) {
          const label = `${btn.textContent || ""} ${btn.getAttribute("aria-label") || ""}`.trim();
          if (/^(retry|try again|reload|refresh)$/i.test(label) || /^try again$/i.test(label)) {
            try {
              btn.click();
              dismissed = true;
              break;
            } catch {
              /* ignore */
            }
          }
        }
        return { limited: true, dismissed };
      }
    });
    return results?.[0]?.result || { limited: false };
  } catch {
    return { limited: false };
  }
}

/** Wait briefly when Claude reports capacity / overload, then resume polling. */
async function waitOutClaudeCapacityLimit(tabId, { maxWaitMs = 3 * 60 * 1000 } = {}) {
  let hit = await detectClaudeCapacityLimit(tabId);
  if (!hit.limited) return false;

  lastRateLimitHitAt = Date.now();
  rateLimitHitsThisBatch += 1;
  if (await maybeHardPauseForRateLimit("detected while waiting for Claude")) {
    throw new Error("__RATE_LIMIT_PAUSE__");
  }

  const deadline = Date.now() + maxWaitMs;
  await setStatus("Claude capacity / overload — waiting before retry…");
  while (Date.now() < deadline) {
    if (batchControl.skipCurrent || batchControl.stop) throw new Error("__SKIP__");
    await sleep(8000);
    hit = await detectClaudeCapacityLimit(tabId);
    if (!hit.limited) {
      await setStatus("Claude capacity cleared — continuing…");
      return true;
    }
    await setStatus(
      `Claude still overloaded (~${formatWaitLeft(deadline - Date.now())} wait budget left)…`
    );
    await chrome.storage.local.set({ generation_heartbeat: Date.now() }).catch(() => {});
  }
  throw new Error(
    "Claude is still at capacity after waiting. Pause the batch a few minutes, then Retry errors."
  );
}

/** Wait out the mandatory quiet window after a prior rate-limit hit. */
async function enforcePostRateLimitCooldown() {
  if (!lastRateLimitHitAt) return;
  const elapsed = Date.now() - lastRateLimitHitAt;
  const left = RATE_LIMIT_AFTER_HIT_MS - elapsed;
  if (left <= 0) return;
  const until = Date.now() + left;
  while (Date.now() < until) {
    if (batchControl.skipCurrent || batchControl.stop) throw new Error("__SKIP__");
    await setStatus(
      `Post rate-limit cooldown (~${formatWaitLeft(until - Date.now())} left). Leave ChatGPT open…`
    );
    await sleep(Math.min(5000, until - Date.now()));
    await chrome.storage.local.set({ generation_heartbeat: Date.now() }).catch(() => {});
  }
}

/**
 * If ChatGPT is rate-limiting, wait (with status updates). Clicking "Got it"
 * only closes the UI — we still wait a short minimum, then resume as soon as
 * the limit banner stays gone (adaptive, not a fixed 5–10 min sit).
 */
async function waitOutChatGptRateLimit(tabId, { maxWaitMs = RATE_LIMIT_MAX_WAIT_MS } = {}) {
  await enforcePostRateLimitCooldown();

  let hit = await detectChatGptRateLimit(tabId);
  if (!hit.limited) return false;

  lastRateLimitHitAt = Date.now();
  rateLimitHitsThisBatch += 1;

  if (await maybeHardPauseForRateLimit("detected while waiting for ChatGPT")) {
    throw new Error("__RATE_LIMIT_PAUSE__");
  }

  const started = Date.now();
  await setStatus(
    `ChatGPT rate limit — waiting ~${formatWaitLeft(RATE_LIMIT_BASE_WAIT_MS)}, then probing (Got it only closes the dialog)…`
  );

  while (Date.now() - started < maxWaitMs) {
    if (batchControl.skipCurrent || batchControl.stop) {
      throw new Error("__SKIP__");
    }

    const remaining = Math.max(0, maxWaitMs - (Date.now() - started));
    const slice = Math.min(RATE_LIMIT_PROBE_MS, remaining);
    const until = Date.now() + slice;
    while (Date.now() < until) {
      if (batchControl.skipCurrent || batchControl.stop) throw new Error("__SKIP__");
      await sleep(Math.min(5000, until - Date.now()));
      await chrome.storage.local.set({ generation_heartbeat: Date.now() }).catch(() => {});
      const elapsed = Date.now() - started;
      const minLeft = Math.max(0, RATE_LIMIT_BASE_WAIT_MS - elapsed);
      await setStatus(
        minLeft > 0
          ? `ChatGPT rate limit — min wait (~${formatWaitLeft(minLeft)}), then probe…`
          : `ChatGPT rate limit — probing if clear (~${formatWaitLeft(remaining)} budget left)…`
      );
      await detectChatGptRateLimit(tabId);
    }

    // After half the min wait, start trusting a clear UI (faster resume).
    const earlyProbeAt = Math.round(RATE_LIMIT_BASE_WAIT_MS * 0.5);
    if (Date.now() - started < earlyProbeAt) {
      continue;
    }

    hit = await detectChatGptRateLimit(tabId);
    if (!hit.limited) {
      // Do NOT reset lastRateLimitHitAt here — that used to stack another
      // full after-hit cooldown on top of the wait we already did.
      await setStatus("Rate limit looks clear — brief settle, then continuing…");
      await sleep(RATE_LIMIT_CLEAR_SETTLE_MS);
      return true;
    }

    // Still limited — keep waiting until full base min, then keep probing.
    if (Date.now() - started < RATE_LIMIT_BASE_WAIT_MS) {
      continue;
    }
  }

  throw new Error(
    "ChatGPT rate limit still active after waiting. Pause the batch a few minutes, then Retry errors."
  );
}

async function focusTabForInput(tabId) {
  // ChatGPT's ProseMirror composer only accepts execCommand/paste insertion
  // when its tab is the active, focused tab. Bring it to the foreground first.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && typeof tab.windowId === "number") {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
    // Give the page a moment to regain focus before we type into it.
    await new Promise((resolve) => setTimeout(resolve, 250));
  } catch {
    // Best-effort focusing; injection below still attempts insertion.
  }
}

/** True when the tab shows an empty composer and zero assistant messages. */
async function readChatReadiness(tabId, provider) {
  const p = normalizeAiProvider(provider || AI_PROVIDERS.CHATGPT);
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [p],
      func: (site) => {
        const claude = site === "claude";
        const input = claude
          ? document.querySelector('div[contenteditable="true"][data-testid]') ||
            document.querySelector("div.ProseMirror[contenteditable='true']") ||
            document.querySelector('div[contenteditable="true"]')
          : document.querySelector("#prompt-textarea") ||
            document.querySelector("div.ProseMirror[contenteditable='true']") ||
            document.querySelector("textarea[placeholder*='Message']");
        const assistantBlocks = claude
          ? document.querySelectorAll(
              '[data-testid="assistant-message"], [data-testid="assistant"], [data-is-streaming="true"]'
            ).length
          : document.querySelectorAll("[data-message-author-role='assistant']").length;
        const userBlocks = claude
          ? document.querySelectorAll('[data-testid="user-message"], [data-testid="user"]').length
          : document.querySelectorAll("[data-message-author-role='user']").length;
        return {
          hasInput: Boolean(input && input.offsetParent !== null),
          assistantBlocks,
          userBlocks
        };
      }
    });
    return results?.[0]?.result || { hasInput: false, assistantBlocks: -1, userBlocks: -1 };
  } catch {
    return { hasInput: false, assistantBlocks: -1, userBlocks: -1 };
  }
}

/**
 * Hard-guarantee a blank chat before each job. Clicking "New chat"
 * control silently no-ops on some builds, and the poller then harvests the
 * PREVIOUS job's resume JSON — wrong resume, saved under the new company.
 * Navigating the tab is deterministic; the in-page click stays as a fallback.
 */
async function ensureFreshChat(tabId, provider) {
  const p = normalizeAiProvider(provider || (await getStoredAiProvider()));
  const label = aiProviderLabel(p);
  const base = aiProviderNewChatUrl(p);

  try {
    await chrome.tabs.update(tabId, { url: base });
    await withTimeout(waitForTabComplete(tabId, 30000), 32000, `Timed out loading a new ${label} chat.`);
  } catch {
    return false;
  }

  // The composer mounts after load; assistant blocks must be gone.
  for (let i = 0; i < 40; i += 1) {
    const state = await readChatReadiness(tabId, p);
    if (state.hasInput && state.assistantBlocks === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function chatgptSendPrompt(tabId, prompt, startNewChat) {
  // Navigate to a blank chat first; only fall back to the in-page "New chat"
  // click when navigation did not produce an empty conversation.
  let needsInPageNewChat = Boolean(startNewChat);
  if (startNewChat) {
    await setStatus("Opening a fresh ChatGPT chat…");
    needsInPageNewChat = !(await ensureFreshChat(tabId, AI_PROVIDERS.CHATGPT));
  }

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await focusTabForInput(tabId);
    // Do not send while ChatGPT is rate-limiting — wait it out first.
    await enforcePostRateLimitCooldown();
    await waitOutChatGptRateLimit(tabId);
    if (attempt > 0) {
      await setStatus("Retrying ChatGPT Send…");
      // Fresh focus + short pause helps when the first click hit mic instead of Send.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    try {
      return await chatgptSendPromptOnce(tabId, prompt, attempt === 0 ? needsInPageNewChat : false);
    } catch (err) {
      lastError = err;
      const msg = String(err?.message || err);
      if (!/did not accept Send|did not appear in the ChatGPT input/i.test(msg) || attempt === 1) {
        throw err;
      }
    }
  }
  throw lastError || new Error("ChatGPT Send failed.");
}

async function chatgptSendPromptOnce(tabId, prompt, needsInPageNewChat) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [prompt, Boolean(needsInPageNewChat)],
    func: async (fullPrompt, shouldStartNewChat) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const clickIfExists = (selectors) => {
        for (const selector of selectors) {
          if (selector.startsWith("text:")) {
            const wanted = selector.slice(5).toLowerCase();
            const btn = Array.from(document.querySelectorAll("button")).find((b) =>
              (b.textContent || "").toLowerCase().includes(wanted)
            );
            if (btn) {
              btn.click();
              return true;
            }
            continue;
          }
          const el = document.querySelector(selector);
          if (el instanceof HTMLElement) {
            el.click();
            return true;
          }
        }
        return false;
      };

      const findInput = () => {
        const selectors = [
          "#prompt-textarea",
          "div.ProseMirror[contenteditable='true']",
          "div[contenteditable='true'][data-placeholder]",
          "textarea[placeholder*='Message']",
          "textarea[name='prompt-textarea']",
          "textarea",
          "div[contenteditable='true']"
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el instanceof HTMLElement && el.offsetParent !== null) return el;
        }
        return null;
      };

      const firePointerClick = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const opts = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1, pointerType: "mouse" }));
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1, pointerType: "mouse" }));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));
        if (typeof el.click === "function") el.click();
        return true;
      };

      const setInputValue = (el, text) => {
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          el.focus();
          const prototype =
            el instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
          if (descriptor && typeof descriptor.set === "function") {
            descriptor.set.call(el, text);
          } else {
            el.value = text;
          }
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
        if (el.isContentEditable) {
          el.focus();

          // Clear existing content first.
          try {
            document.execCommand("selectAll", false);
            document.execCommand("delete", false);
          } catch {
            // ignore
          }

          // 1) Preferred: simulate paste (ProseMirror handles this and enables Send).
          let inserted = false;
          try {
            const dt = new DataTransfer();
            dt.setData("text/plain", text);
            const pasteEvent = new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData: dt
            });
            inserted = el.dispatchEvent(pasteEvent) === false ||
              (el.innerText || el.textContent || "").trim().length > 0;
            // dispatchEvent returns false if prevented; ChatGPT often prevents default and inserts.
            inserted = (el.innerText || el.textContent || "").trim().length > 20;
          } catch {
            inserted = false;
          }

          // 2) insertText — also updates ProseMirror / enables Send.
          if (!inserted) {
            try {
              inserted = document.execCommand("insertText", false, text);
            } catch {
              inserted = false;
            }
            inserted = inserted || (el.innerText || el.textContent || "").trim().length > 20;
          }

          // 3) beforeinput + insertText InputEvent
          if (!inserted) {
            try {
              el.dispatchEvent(
                new InputEvent("beforeinput", {
                  bubbles: true,
                  cancelable: true,
                  inputType: "insertText",
                  data: text
                })
              );
              el.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  cancelable: true,
                  inputType: "insertText",
                  data: text
                })
              );
              inserted = (el.innerText || el.textContent || "").trim().length > 20;
            } catch {
              inserted = false;
            }
          }

          // 4) Last resort: DOM write (may leave Send disabled — we force-click later).
          if (!inserted && !(el.innerText || el.textContent || "").trim()) {
            el.innerHTML = "";
            for (const line of String(text).split("\n")) {
              const p = document.createElement("p");
              p.textContent = line || "\u00a0";
              el.appendChild(p);
            }
            el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
          }
        }
      };

      const inputHasText = (el) => {
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          return (el.value || "").trim().length > 0;
        }
        return (el.innerText || el.textContent || "").trim().length > 0;
      };

      const buttonMeta = (btn) => {
        const testid = String(btn.getAttribute("data-testid") || "").toLowerCase();
        const label = `${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("title") || ""} ${btn.textContent || ""}`.toLowerCase();
        return { testid, label, blob: `${testid} ${label}` };
      };

      const isNonSendControl = (btn) => {
        const { blob } = buttonMeta(btn);
        return /stop|speech|speak|dictat|voice|mic|audio|listen|record|attach|upload|photo|image|file|plus|model|search|tool|gpt|canvas|deep.?research/.test(
          blob
        );
      };

      const looksLikeSendControl = (btn) => {
        if (!(btn instanceof HTMLButtonElement) || isNonSendControl(btn)) return false;
        const { testid, label } = buttonMeta(btn);
        if (/send/.test(testid) || /send/.test(label)) return true;
        // Up-arrow send glyph (exclude paperclip / plus / mic paths when labeled).
        const path = Array.from(btn.querySelectorAll("path"))
          .map((p) => p.getAttribute("d") || "")
          .join(" ")
          .toLowerCase();
        if (path && /m12\s+5|m4\s+12|l12\s+5|arrow/.test(path) && /send|submit|arrow/.test(`${label} ${testid} arrow`)) {
          return true;
        }
        return false;
      };

      const findSendButton = () => {
        const selectors = [
          "button[data-testid='send-button']",
          "button[data-testid='composer-send-button']",
          "button[data-testid*='send']",
          "#composer-submit-button",
          "button[aria-label='Send prompt']",
          "button[aria-label*='Send prompt']",
          "button[aria-label='Send message']",
          "button[aria-label*='Send message']",
          "button[aria-label='Send']",
          "button[aria-label*='Send']"
        ];
        for (const selector of selectors) {
          const btn = document.querySelector(selector);
          if (btn instanceof HTMLButtonElement && !isNonSendControl(btn)) return btn;
        }

        const composer =
          document.querySelector("#prompt-textarea")?.closest("form") ||
          document.querySelector("form:has(#prompt-textarea)") ||
          document.querySelector("form:has(div.ProseMirror)") ||
          document.querySelector("[class*='composer']") ||
          document.body;

        const buttons = Array.from(composer.querySelectorAll("button")).filter(
          (b) => b instanceof HTMLButtonElement
        );
        const byLook = buttons.find((b) => looksLikeSendControl(b));
        if (byLook) return byLook;

        // Last resort: enabled icon button in the composer that is not speech/attach.
        // Do NOT pick the last SVG blindly — ChatGPT often shows mic there until Send enables.
        const iconButtons = buttons.filter((b) => {
          if (isNonSendControl(b)) return false;
          if (!b.querySelector("svg")) return false;
          return !b.disabled && b.getAttribute("aria-disabled") !== "true";
        });
        return iconButtons.length === 1 ? iconButtons[0] : null;
      };

      const isSendEnabled = (btn) => {
        if (!(btn instanceof HTMLButtonElement)) return false;
        if (isNonSendControl(btn)) return false;
        if (btn.disabled) return false;
        if (btn.getAttribute("aria-disabled") === "true") return false;
        if (btn.hasAttribute("disabled")) return false;
        return true;
      };

      const clickSendButton = ({ force = false } = {}) => {
        const btn = findSendButton();
        if (!btn) return false;
        if (!force && !isSendEnabled(btn)) return false;
        if (force && (btn.disabled || btn.getAttribute("aria-disabled") === "true")) {
          btn.disabled = false;
          btn.removeAttribute("disabled");
          btn.setAttribute("aria-disabled", "false");
        }
        firePointerClick(btn);
        return true;
      };

      const submitComposerForm = (el) => {
        const form = el?.closest?.("form");
        if (!(form instanceof HTMLFormElement)) return false;
        try {
          if (typeof form.requestSubmit === "function") {
            form.requestSubmit();
            return true;
          }
        } catch {
          // fall through
        }
        try {
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          return true;
        } catch {
          return false;
        }
      };

      const pressEnterToSend = (el) => {
        const opts = {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          composed: true
        };
        el.dispatchEvent(new KeyboardEvent("keydown", opts));
        el.dispatchEvent(new KeyboardEvent("keypress", opts));
        el.dispatchEvent(new KeyboardEvent("keyup", opts));
      };

      const sendMessage = (el, { force = false } = {}) => {
        if (clickSendButton({ force })) return true;
        if (submitComposerForm(el)) return true;
        pressEnterToSend(el);
        if (clickSendButton({ force })) return true;
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true,
            ctrlKey: true,
            metaKey: true
          })
        );
        return clickSendButton({ force });
      };

      const countUserBlocks = () =>
        document.querySelectorAll("[data-message-author-role='user']").length;

      const isGenerating = () => {
        const stopBtn =
          document.querySelector("button[data-testid='stop-button']") ||
          document.querySelector("button[aria-label='Stop streaming']") ||
          document.querySelector("button[aria-label='Stop generating']") ||
          document.querySelector("button[aria-label*='Stop']");
        return Boolean(stopBtn && stopBtn.offsetParent !== null);
      };

      const promptWasSent = (el, usersBefore) => {
        if (isGenerating()) return true;
        if (countUserBlocks() > usersBefore) return true;
        return false;
      };

      const composerLooksCleared = (el) => {
        const text = (el?.innerText || el?.textContent || el?.value || "").trim();
        return text.length < 40;
      };

      const getAssistantBlocks = () =>
        Array.from(document.querySelectorAll("[data-message-author-role='assistant']"));

      const scorePayload = (text) => {
        const t = String(text || "");
        let score = t.length;
        if (t.includes('"experience"')) score += 100000;
        if (t.includes('"certifications"')) score += 50000;
        if (t.includes('"profile"')) score += 25000;
        return score;
      };

      const readAssistantBlock = (block) => {
        if (!block) return "";
        const candidates = [];
        for (const pre of block.querySelectorAll("pre")) {
          const text = (pre.innerText || pre.textContent || "").trim();
          if (text) candidates.push(text);
        }
        for (const code of block.querySelectorAll("pre code")) {
          const text = (code.innerText || code.textContent || "").trim();
          if (text) candidates.push(text);
        }
        if (candidates.length) {
          candidates.sort((a, b) => scorePayload(b) - scorePayload(a));
          return candidates[0];
        }
        return (block.innerText || block.textContent || "").trim();
      };

      if (shouldStartNewChat) {
        clickIfExists([
          "button[data-testid='new-chat-button']",
          "a[href='/']",
          "text:new chat"
        ]);
        await sleep(1200);
      }

      const blocks = getAssistantBlocks();
      const blocksBefore = blocks.length;
      const latestBefore = blocks.length ? readAssistantBlock(blocks[blocks.length - 1]) : "";
      const usersBefore = countUserBlocks();

      let input = null;
      for (let i = 0; i < 40; i += 1) {
        input = findInput();
        if (input) break;
        await sleep(500);
      }
      if (!input) {
        throw new Error("Cannot find ChatGPT message input box.");
      }

      let filled = false;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        input.focus();
        await sleep(150);
        setInputValue(input, fullPrompt);
        await sleep(500);
        input = findInput() || input;
        if (inputHasText(input)) {
          filled = true;
          break;
        }
      }
      if (!filled) {
        throw new Error(
          "Prompt text did not appear in the ChatGPT input. Keep the ChatGPT tab visible and try again."
        );
      }

      // Wait for the real Send control (not the mic) to enable after ProseMirror paste.
      let sent = false;
      let clickedSend = false;
      for (let i = 0; i < 48; i += 1) {
        input = findInput() || input;
        if (promptWasSent(input, usersBefore) || (clickedSend && composerLooksCleared(input))) {
          sent = true;
          break;
        }
        const btn = findSendButton();
        if (btn && isSendEnabled(btn)) {
          if (sendMessage(input, { force: false })) clickedSend = true;
          await sleep(500);
          if (promptWasSent(findInput() || input, usersBefore) || composerLooksCleared(findInput() || input)) {
            sent = true;
            break;
          }
        } else {
          // Nudge the editor so ChatGPT swaps mic → Send.
          input.focus();
          input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: " " }));
          await sleep(200);
          // Re-assert prompt if ChatGPT wiped/partialled the composer.
          if (!inputHasText(input) || (input.innerText || input.textContent || "").trim().length < 40) {
            setInputValue(input, fullPrompt);
            await sleep(350);
          }
        }
        if (i > 0 && i % 10 === 0) {
          if (sendMessage(input, { force: false })) clickedSend = true;
          await sleep(450);
          if (promptWasSent(findInput() || input, usersBefore) || (clickedSend && composerLooksCleared(findInput() || input))) {
            sent = true;
            break;
          }
        }
        await sleep(250);
      }

      // Last resorts: form submit + force-click Send (never speech).
      if (!sent) {
        for (let round = 0; round < 3; round += 1) {
          input = findInput() || input;
          if (!inputHasText(input)) {
            setInputValue(input, fullPrompt);
            await sleep(400);
          }
          input.focus();
          if (submitComposerForm(input)) clickedSend = true;
          if (sendMessage(input, { force: true })) clickedSend = true;
          await sleep(700);
          const afterRound = findInput() || input;
          if (promptWasSent(afterRound, usersBefore) || (clickedSend && composerLooksCleared(afterRound))) {
            sent = true;
            break;
          }
        }
      }

      const after = findInput() || input;
      if (!(promptWasSent(after, usersBefore) || (clickedSend && composerLooksCleared(after)))) {
        throw new Error(
          "Prompt was typed but ChatGPT did not accept Send. Keep the ChatGPT tab focused (close/minimize the extension popup) and try again."
        );
      }

      // First message creates /c/<id> — wait so cooldown cleanup can target it.
      for (let i = 0; i < 24; i += 1) {
        if (/\/c\/[a-zA-Z0-9_-]+/.test(location.pathname)) break;
        await sleep(250);
      }

      return { blocksBefore, latestBefore };
    }
  });

  if (!results?.length) throw new Error("No response from content script.");
  if (results[0].result === undefined && results[0].error) {
    throw new Error(String(results[0].error.message || results[0].error));
  }
  return results[0].result || { blocksBefore: 0, latestBefore: "" };
}

async function claudeSendPrompt(tabId, prompt, startNewChat) {
  let needsInPageNewChat = Boolean(startNewChat);
  if (startNewChat) {
    await setStatus("Opening a fresh Claude chat…");
    needsInPageNewChat = !(await ensureFreshChat(tabId, AI_PROVIDERS.CLAUDE));
  }

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await focusTabForInput(tabId);
    if (attempt > 0) {
      await setStatus("Retrying Claude Send…");
      await sleep(400);
    }
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        args: [prompt, attempt === 0 ? needsInPageNewChat : false],
        func: async (fullPrompt, shouldStartNewChat) => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const wantLen = String(fullPrompt || "").length;
          const enoughFilled = (text) => {
            const n = String(text || "").trim().length;
            if (n < 40) return false;
            if (wantLen <= 0) return n > 20;
            const minNeed = Math.min(Math.floor(wantLen * 0.9), Math.max(wantLen - 200, 40));
            return n >= minNeed;
          };

          const firePointerClick = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const opts = { bubbles: true, cancelable: true, view: window };
            el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1, pointerType: "mouse" }));
            el.dispatchEvent(new MouseEvent("mousedown", opts));
            el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1, pointerType: "mouse" }));
            el.dispatchEvent(new MouseEvent("mouseup", opts));
            el.dispatchEvent(new MouseEvent("click", opts));
            if (typeof el.click === "function") el.click();
            return true;
          };

          const findInput = () => {
            const candidates = [
              document.querySelector('div[contenteditable="true"][data-testid]'),
              document.querySelector("div.ProseMirror[contenteditable='true']"),
              document.querySelector('div[contenteditable="true"][enterkeyhint]'),
              document.querySelector('fieldset div[contenteditable="true"]'),
              document.querySelector('div[contenteditable="true"]')
            ].filter(Boolean);
            return (
              candidates.find((el) => el instanceof HTMLElement && el.offsetParent !== null) || null
            );
          };

          /** Remove ProseMirror text and Claude PASTED chips so retries do not stack. */
          const clearComposer = (el) => {
            if (!(el instanceof HTMLElement)) return;
            el.focus();
            try {
              document.execCommand("selectAll", false);
              document.execCommand("delete", false);
            } catch {
              /* ignore */
            }
            try {
              el.innerHTML = "";
              el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
            } catch {
              /* ignore */
            }

            const roots = [el.closest("form"), el.closest("fieldset"), el.parentElement, document.body].filter(
              Boolean
            );
            const seen = new Set();
            for (const root of roots) {
              if (seen.has(root)) continue;
              seen.add(root);
              for (const node of root.querySelectorAll(
                '[data-testid*="paste" i], [class*="paste" i], [aria-label*="paste" i]'
              )) {
                const label = `${node.getAttribute?.("aria-label") || ""} ${node.textContent || ""}`.trim();
                if (/^pasted$/i.test(label) || /paste/i.test(node.getAttribute?.("data-testid") || "")) {
                  try {
                    node.remove();
                  } catch {
                    /* ignore */
                  }
                }
              }
              for (const node of root.querySelectorAll("button, span, div, a")) {
                const t = `${node.textContent || ""}`.trim();
                if (t !== "PASTED" && t !== "Pasted") continue;
                const chip = node.closest("[class*='chip'], [class*='badge'], [class*='pill'], button, div") || node;
                try {
                  chip.remove();
                } catch {
                  /* ignore */
                }
              }
            }
          };

          /**
           * Prefer insertText so Claude does not wrap the prompt as a PASTED chip.
           * ClipboardEvent paste is fallback only.
           */
          const setInputValue = (el, text) => {
            if (!(el instanceof HTMLElement)) return false;
            clearComposer(el);
            el.focus();

            let inserted = false;
            try {
              inserted = Boolean(document.execCommand("insertText", false, text));
            } catch {
              inserted = false;
            }
            inserted = inserted || enoughFilled(el.innerText || el.textContent || "");

            if (!inserted) {
              try {
                el.dispatchEvent(
                  new InputEvent("beforeinput", {
                    bubbles: true,
                    cancelable: true,
                    inputType: "insertText",
                    data: text
                  })
                );
                el.dispatchEvent(
                  new InputEvent("input", {
                    bubbles: true,
                    cancelable: true,
                    inputType: "insertText",
                    data: text
                  })
                );
              } catch {
                /* ignore */
              }
              inserted = enoughFilled(el.innerText || el.textContent || "");
            }

            if (!inserted) {
              try {
                const dt = new DataTransfer();
                dt.setData("text/plain", text);
                el.dispatchEvent(
                  new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt })
                );
              } catch {
                /* ignore */
              }
              inserted = enoughFilled(el.innerText || el.textContent || "");
            }

            if (!inserted) {
              el.innerHTML = "";
              for (const line of String(text).split("\n")) {
                const p = document.createElement("p");
                p.textContent = line || "\u00a0";
                el.appendChild(p);
              }
              el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
              inserted = enoughFilled(el.innerText || el.textContent || "");
            }
            return inserted;
          };

          const findSendButton = () => {
            const selectors = [
              'button[aria-label="Send Message"]',
              'button[aria-label*="Send Message"]',
              'button[aria-label="Send message"]',
              'button[aria-label*="Send message"]',
              'button[data-testid="send-button"]',
              'button[aria-label="Send"]',
              'button[aria-label*="Send"]'
            ];
            for (const selector of selectors) {
              const btn = document.querySelector(selector);
              if (!(btn instanceof HTMLButtonElement)) continue;
              const label = `${btn.getAttribute("aria-label") || ""}`.toLowerCase();
              if (/stop|mic|voice|attach|upload/.test(label)) continue;
              return btn;
            }
            return null;
          };

          const isSendEnabled = (btn) =>
            btn instanceof HTMLButtonElement &&
            !btn.disabled &&
            btn.getAttribute("aria-disabled") !== "true";

          const countUser = () =>
            document.querySelectorAll(
              '[data-testid="user-message"], [data-testid="user"], [data-role="user"]'
            ).length;

          const isGenerating = () => {
            const stop =
              document.querySelector('button[aria-label*="Stop"]') ||
              document.querySelector('button[aria-label*="stop"]') ||
              document.querySelector('[data-is-streaming="true"]');
            return Boolean(
              stop && (stop.offsetParent !== null || stop.getAttribute?.("data-is-streaming") === "true")
            );
          };

          const composerEmpty = () => {
            const el = findInput();
            const n = (el?.innerText || el?.textContent || "").trim().length;
            return n < 40;
          };

          const findCautionBanner = () => {
            const hay = `${document.body?.innerText || ""}`.slice(0, 20000);
            if (!/Use caution before running this prompt|Malicious conversation content/i.test(hay)) {
              return null;
            }
            const nodes = Array.from(
              document.querySelectorAll(
                '[role="dialog"], [role="alertdialog"], [role="alert"], [class*="banner"], [class*="Banner"], [class*="warning"], [class*="Warning"], [class*="caution"], div, section'
              )
            );
            return (
              nodes.find((el) => {
                if (!(el instanceof HTMLElement) || el.offsetParent === null) return false;
                const t = `${el.innerText || el.textContent || ""}`;
                if (t.length > 1200) return false;
                return /Use caution before running this prompt|Malicious conversation content/i.test(t);
              }) || null
            );
          };

          const dismissCautionBanner = () => {
            const banner = findCautionBanner();
            if (!banner) return { present: false, dismissed: false };
            const scope = banner.closest('[role="dialog"], [role="alertdialog"], form, section, div') || banner;
            const buttons = Array.from(scope.querySelectorAll("button, a[role='button'], [role='button']"));
            for (const btn of buttons) {
              const label = `${btn.textContent || ""} ${btn.getAttribute("aria-label") || ""}`.trim();
              if (
                /^(continue|proceed|accept|run anyway|i understand|allow|ok|dismiss|got it)$/i.test(label) ||
                /continue|proceed|run anyway|accept|allow/i.test(label)
              ) {
                firePointerClick(btn);
                return { present: true, dismissed: true };
              }
            }
            // Broader page search for dismiss CTAs near the warning.
            for (const btn of document.querySelectorAll("button")) {
              const label = `${btn.textContent || ""} ${btn.getAttribute("aria-label") || ""}`.trim();
              if (/continue|proceed|run anyway|i understand|accept and continue/i.test(label)) {
                firePointerClick(btn);
                return { present: true, dismissed: true };
              }
            }
            return { present: true, dismissed: false };
          };

          if (shouldStartNewChat) {
            const newBtn = Array.from(document.querySelectorAll("a, button")).find((el) =>
              /new chat/i.test(`${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`)
            );
            if (newBtn instanceof HTMLElement) {
              firePointerClick(newBtn);
              await sleep(1200);
            }
          }

          let input = null;
          for (let i = 0; i < 40; i += 1) {
            input = findInput();
            if (input) break;
            await sleep(500);
          }
          if (!input) throw new Error("Cannot find Claude message input box.");

          // Do not re-paste while Claude is already generating.
          if (isGenerating()) {
            return {
              blocksBefore: document.querySelectorAll(
                '[data-testid="assistant-message"], [data-testid="assistant"], [class*="font-claude-message"]'
              ).length,
              latestBefore: "",
              alreadyGenerating: true
            };
          }

          const usersBefore = countUser();
          clearComposer(input);
          await sleep(150);
          input = findInput() || input;

          let filled = enoughFilled(input.innerText || input.textContent || "");
          if (!filled) {
            // Single insert attempt — never loop 4 blind pastes (creates PASTED chips).
            filled = setInputValue(input, fullPrompt);
            await sleep(500);
            input = findInput() || input;
            filled = filled || enoughFilled(input.innerText || input.textContent || "");
          }
          if (!filled) {
            // One recovery: clear again + one more insert.
            clearComposer(input);
            await sleep(120);
            filled = setInputValue(findInput() || input, fullPrompt);
            await sleep(500);
            input = findInput() || input;
            filled = filled || enoughFilled(input.innerText || input.textContent || "");
          }
          if (!filled) {
            throw new Error(
              "Prompt text did not appear in the Claude input. Keep the Claude tab visible and try again."
            );
          }

          // Dismiss Claude's "malicious conversation content" caution before Send.
          let caution = dismissCautionBanner();
          if (caution.dismissed) await sleep(400);
          caution = { present: Boolean(findCautionBanner()), dismissed: caution.dismissed };
          if (caution.present) {
            caution = dismissCautionBanner();
            await sleep(350);
          }
          if (findCautionBanner() && !isSendEnabled(findSendButton())) {
            throw new Error(
              "Claude blocked the prompt as potentially malicious. Dismiss the caution banner in the Claude tab, then retry — or shorten the prompt."
            );
          }

          const sendAccepted = () =>
            isGenerating() || countUser() > usersBefore || composerEmpty();

          let sent = false;
          for (let i = 0; i < 40; i += 1) {
            if (sendAccepted()) {
              sent = true;
              break;
            }
            if (findCautionBanner()) {
              dismissCautionBanner();
              await sleep(300);
            }
            const btn = findSendButton();
            if (btn && isSendEnabled(btn)) {
              firePointerClick(btn);
              await sleep(500);
              if (sendAccepted()) {
                sent = true;
                break;
              }
            } else {
              input = findInput() || input;
              input?.focus();
              // Nudge composer so Send enables — do NOT re-paste the full prompt.
              input?.dispatchEvent(
                new InputEvent("input", { bubbles: true, inputType: "insertText", data: " " })
              );
              await sleep(250);
            }
            await sleep(250);
          }

          if (!sent) {
            const btn = findSendButton();
            if (btn) {
              btn.disabled = false;
              btn.removeAttribute("disabled");
              firePointerClick(btn);
              await sleep(700);
            }
          }

          if (!sendAccepted()) {
            if (findCautionBanner()) {
              throw new Error(
                "Claude blocked the prompt as potentially malicious. Dismiss the caution banner in the Claude tab, then retry."
              );
            }
            throw new Error(
              "Prompt was typed but Claude did not accept Send. Keep the Claude tab focused and try again."
            );
          }

          // First message creates /chat/<uuid> — wait so cleanup can target it later.
          for (let i = 0; i < 20; i += 1) {
            if (/\/chat\/[a-f0-9-]+/i.test(location.pathname)) break;
            await sleep(250);
          }

          return {
            blocksBefore: document.querySelectorAll(
              '[data-testid="assistant-message"], [data-testid="assistant"], [class*="font-claude-message"]'
            ).length,
            latestBefore: ""
          };
        }
      });
      if (!results?.length) throw new Error("No response from Claude page script.");
      if (results[0].result === undefined && results[0].error) {
        throw new Error(String(results[0].error.message || results[0].error));
      }
      return results[0].result || { blocksBefore: 0, latestBefore: "" };
    } catch (err) {
      lastError = err;
      const msg = String(err?.message || err);
      // Do not retry paste loops when Claude blocked as malicious — user must dismiss.
      if (/malicious|blocked the prompt/i.test(msg)) throw err;
      if (!/did not accept Send|did not appear in the Claude input/i.test(msg) || attempt === 1) {
        throw err;
      }
    }
  }
  throw lastError || new Error("Claude Send failed.");
}

async function aiSendPrompt(tabId, prompt, startNewChat) {
  const provider = await getStoredAiProvider();
  if (provider === AI_PROVIDERS.CLAUDE) {
    return claudeSendPrompt(tabId, prompt, startNewChat);
  }
  return chatgptSendPrompt(tabId, prompt, startNewChat);
}

/** Read the current Claude/ChatGPT conversation id from the tab URL. */
async function readAiConversationId(tabId, provider) {
  const p = normalizeAiProvider(provider || (await getStoredAiProvider()));
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [p],
      func: (site) => {
        const href = String(location.href || "");
        const pathName = String(location.pathname || "");
        if (site === "claude") {
          return (pathName.match(/\/chat\/([a-f0-9-]+)/i) || href.match(/\/chat\/([a-f0-9-]+)/i) || [])[1] || "";
        }
        return (pathName.match(/\/c\/([a-zA-Z0-9_-]+)/) || href.match(/\/c\/([a-zA-Z0-9_-]+)/) || [])[1] || "";
      }
    });
    const fromPage = String(results?.[0]?.result || "").trim();
    if (fromPage) return fromPage;
    const tab = await chrome.tabs.get(tabId);
    const url = String(tab?.url || "");
    if (p === AI_PROVIDERS.CLAUDE) {
      return (url.match(/\/chat\/([a-f0-9-]+)/i) || [])[1] || "";
    }
    return (url.match(/\/c\/([a-zA-Z0-9_-]+)/) || [])[1] || "";
  } catch {
    return "";
  }
}

/**
 * Remove the conversation used for a finished job so history stays clean.
 * Prefer API delete (Claude needs JSON body = uuid). UI is fallback.
 * Intended to run during inter-job cooldown, not mid file-save.
 */
async function deleteCurrentAiConversation(tabId, { chatId = "" } = {}) {
  const provider = await getStoredAiProvider();
  const label = aiProviderLabel(provider);
  let targetChatId = String(chatId || "").trim();
  if (!targetChatId) {
    targetChatId = await readAiConversationId(tabId, provider);
  }
  if (!targetChatId) {
    try {
      const stored = await chrome.storage.local.get(["last_ai_chat_id", "last_ai_provider"]);
      if (normalizeAiProvider(stored.last_ai_provider) === provider) {
        targetChatId = String(stored.last_ai_chat_id || "").trim();
      }
    } catch {
      // ignore
    }
  }
  await focusTabForInput(tabId);
  await setStatus(
    targetChatId
      ? `Removing finished ${label} chat (${targetChatId.slice(0, 8)}…)…`
      : `Removing finished ${label} chat…`
  );

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [provider, targetChatId],
    func: async (site, knownChatId) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const clickMatching = (re, roots = null) => {
        const scope = roots || document;
        const nodes = Array.from(
          scope.querySelectorAll("button, a, [role='menuitem'], div[role='button'], [role='option']")
        );
        const hit = nodes.find((el) =>
          re.test(`${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`.trim())
        );
        if (hit instanceof HTMLElement) {
          hit.click();
          return true;
        }
        return false;
      };

      const apiJson = async (path, opts = {}) => {
        const res = await fetch(`https://claude.ai/api${path}`, {
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          ...opts
        });
        let data = null;
        const text = await res.text();
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }
        return { ok: res.ok || res.status === 204 || res.status === 404, status: res.status, data };
      };

      if (site === "claude") {
        const chatId =
          String(knownChatId || "").trim() ||
          (location.pathname.match(/\/chat\/([a-f0-9-]+)/i) || [])[1] ||
          "";

        if (chatId) {
          try {
            const orgsRes = await apiJson("/organizations");
            const orgs = Array.isArray(orgsRes.data)
              ? orgsRes.data
              : Array.isArray(orgsRes.data?.data)
                ? orgsRes.data.data
                : orgsRes.data
                  ? [orgsRes.data]
                  : [];
            for (const org of orgs) {
              const orgId = org?.uuid || org?.id;
              if (!orgId) continue;
              // Claude web expects DELETE body = JSON string of the conversation uuid.
              const del = await apiJson(`/organizations/${orgId}/chat_conversations/${chatId}`, {
                method: "DELETE",
                body: JSON.stringify(chatId)
              });
              if (del.ok) return { ok: true, via: "api", chatId };
            }
          } catch {
            // fall through to UI
          }
        }

        // UI: open chat header / sidebar menu → Delete → confirm.
        const menuSelectors = [
          'button[aria-label*="Chat menu"]',
          'button[aria-label*="chat menu"]',
          'button[data-testid="chat-menu"]',
          'button[aria-label*="More"]',
          'button[aria-haspopup="menu"]'
        ];
        for (const selector of menuSelectors) {
          const btn = document.querySelector(selector);
          if (btn instanceof HTMLElement && btn.offsetParent !== null) {
            btn.click();
            await sleep(450);
            break;
          }
        }
        // Sidebar row for this chat (hover reveals ⋯).
        if (chatId) {
          const link = document.querySelector(`a[href*="/chat/${chatId}"]`);
          if (link instanceof HTMLElement) {
            link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            await sleep(250);
            const row = link.closest("div") || link.parentElement;
            if (row) {
              const more = row.querySelector("button");
              if (more instanceof HTMLElement) more.click();
              await sleep(400);
            }
          }
        }
        clickMatching(/delete/i);
        await sleep(400);
        clickMatching(/^delete$/i);
        await sleep(500);
        const stillThere = chatId ? Boolean(document.querySelector(`a[href*="/chat/${chatId}"]`)) : true;
        return { ok: !stillThere || Boolean(chatId), via: "ui", chatId };
      }

      // ChatGPT — hide/delete via backend API, then verify sidebar (UI fallback).
      const origin = location.origin.includes("openai.com")
        ? "https://chat.openai.com"
        : "https://chatgpt.com";
      const convId =
        String(knownChatId || "").trim() ||
        (location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/) || [])[1] ||
        "";

      const sidebarLink = (id) => {
        if (!id) return null;
        return (
          document.querySelector(`a[href="/c/${id}"]`) ||
          document.querySelector(`a[href*="/c/${id}"]`) ||
          document.querySelector(`a[href*="${id}"]`)
        );
      };

      const firePointerClick = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const opts = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1, pointerType: "mouse" }));
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1, pointerType: "mouse" }));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));
        if (typeof el.click === "function") el.click();
        return true;
      };

      const chatgptDeleteViaApi = async (id) => {
        if (!id) return { ok: false, error: "missing-id" };
        let token = "";
        let accountId = "";
        for (const sessionUrl of [`${origin}/api/auth/session`, "/api/auth/session"]) {
          try {
            const session = await fetch(sessionUrl, { credentials: "include" }).then((r) => r.json());
            token = session?.accessToken || session?.access_token || "";
            accountId =
              session?.account?.id || session?.user?.id || session?.chatgpt_account_id || "";
            if (token) break;
          } catch {
            // try next
          }
        }
        if (!token) return { ok: false, error: "no-token" };
        const headers = {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        };
        if (accountId) headers["ChatGPT-Account-ID"] = String(accountId);

        // Soft-delete only: is_visible=false. Do NOT treat archive as success —
        // archived chats still clutter history and look "not deleted".
        const verifyGone = async (status) => {
          await sleep(600);
          const still = Boolean(sidebarLink(id));
          if (!still || status === 404) {
            return { ok: true, status, verified: !still };
          }
          return { ok: false, error: "api-ok-still-in-sidebar", status };
        };

        try {
          const patch = await fetch(`${origin}/backend-api/conversation/${id}`, {
            method: "PATCH",
            credentials: "include",
            headers,
            body: JSON.stringify({ is_visible: false })
          });
          if (patch.ok || patch.status === 204 || patch.status === 404) {
            const checked = await verifyGone(patch.status);
            if (checked.ok) return checked;
          } else if (patch.status) {
            // continue to DELETE attempt
          }

          // Some accounts accept hard DELETE when PATCH leaves the row visible.
          const del = await fetch(`${origin}/backend-api/conversation/${id}`, {
            method: "DELETE",
            credentials: "include",
            headers
          });
          if (del.ok || del.status === 204 || del.status === 404) {
            return await verifyGone(del.status);
          }
          return {
            ok: false,
            error: `api-status-patch-${patch.status}-del-${del.status}`,
            status: del.status || patch.status
          };
        } catch (err) {
          return { ok: false, error: String(err?.message || err || "api-failed") };
        }
      };

      const chatgptDeleteViaUi = async (id) => {
        let opened = false;
        if (id) {
          const link = sidebarLink(id);
          if (link instanceof HTMLElement) {
            link.scrollIntoView({ block: "nearest" });
            link.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
            link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
            link.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
            await sleep(350);
            const row =
              link.closest('[data-testid*="history"]') ||
              link.closest("[data-testid]") ||
              link.closest("li") ||
              link.closest("div.group") ||
              link.closest("div[class*='group']") ||
              link.parentElement;
            const optionsBtn =
              row?.querySelector('button[data-testid="history-item-options"]') ||
              row?.querySelector('button[aria-label*="Open conversation options" i]') ||
              row?.querySelector('button[aria-label*="Conversation options" i]') ||
              row?.querySelector('button[aria-label*="Options" i]') ||
              row?.querySelector('button[aria-label*="More" i]') ||
              [...(row?.querySelectorAll("button") || [])].find((b) =>
                /options|more|menu/i.test(
                  `${b.getAttribute("aria-label") || ""} ${b.getAttribute("data-testid") || ""}`
                )
              ) ||
              row?.querySelector("button");
            if (optionsBtn instanceof HTMLElement) {
              firePointerClick(optionsBtn);
              opened = true;
              await sleep(500);
            }
          }
        }
        if (!opened) {
          for (const selector of [
            'button[data-testid="conversation-options-button"]',
            'button[aria-label*="Open conversation options" i]',
            'button[aria-label*="Conversation options" i]',
            'button[aria-label*="More actions" i]',
            'button[aria-label*="More options" i]',
            'button[data-testid="history-item-options"]'
          ]) {
            const btn = document.querySelector(selector);
            if (btn instanceof HTMLElement && btn.offsetParent !== null) {
              firePointerClick(btn);
              opened = true;
              await sleep(500);
              break;
            }
          }
        }
        const clickedDelete =
          clickMatching(/delete chat|delete conversation|^delete$/i) || clickMatching(/delete/i);
        if (!clickedDelete) return { ok: false, error: "no-delete-menu" };
        await sleep(550);
        clickMatching(/^delete$/i) ||
          clickMatching(/delete chat|confirm|yes,?\s*delete/i) ||
          clickMatching(/^confirm$/i);
        await sleep(1000);
        const stillThere = id ? Boolean(sidebarLink(id)) : true;
        return { ok: id ? !stillThere : opened, error: stillThere && id ? "still-in-sidebar" : "" };
      };

      if (convId) {
        let lastErr = "";
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) await sleep(700 * attempt);
          const api = await chatgptDeleteViaApi(convId);
          if (api.ok) {
            await sleep(400);
            return { ok: true, via: "api", chatId: convId, attempt: attempt + 1 };
          }
          lastErr = api.error || lastErr;
          const ui = await chatgptDeleteViaUi(convId);
          if (ui.ok) return { ok: true, via: "ui", chatId: convId, attempt: attempt + 1 };
          lastErr = ui.error || api.error || lastErr;
        }
        return {
          ok: false,
          via: "failed",
          chatId: convId,
          error: lastErr || "chatgpt-delete-failed"
        };
      }

      const uiOnly = await chatgptDeleteViaUi("");
      return {
        ok: Boolean(uiOnly.ok),
        via: uiOnly.ok ? "ui" : "failed",
        chatId: "",
        error: uiOnly.error || "missing-chat-id"
      };
    }
  });

  const detail = results?.[0]?.result || { ok: false };
  if (!detail?.ok) {
    // Do not open another chat when delete failed — that is how Recents pile up.
    throw new Error(
      `${label} chat cleanup did not confirm${detail?.error ? ` (${detail.error})` : ""}.`
    );
  }
  // Leave a blank chat so the next job does not reopen the deleted URL.
  try {
    await ensureFreshChat(tabId, provider);
  } catch {
    // ignore
  }
  try {
    await chrome.storage.local.remove(["last_ai_chat_id", "last_ai_provider"]);
  } catch {
    // ignore
  }
  await setStatus(`Removed finished ${label} chat (${detail.via || "ok"}).`);
  return detail;
}

/**
 * Inter-job cooldown: delete the finished AI chat first, then wait out the rest
 * of the configured gap. Keeps cleanup off the critical save/apply path.
 */
async function resolveAiTabForCleanup(preferredTabId = null) {
  if (typeof preferredTabId === "number") {
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (tab?.id) return tab.id;
    } catch {
      // tab closed — fall through
    }
  }
  try {
    const provider = await getStoredAiProvider();
    const tab = await getOpenAiTab(provider);
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

async function cooldownBeforeNextJob({
  aiTabId = null,
  aiChatId = "",
  reason = "next job"
} = {}) {
  const gapMs = currentJobGapMs();
  const started = Date.now();
  const tabId = await resolveAiTabForCleanup(aiTabId);
  let chatId = String(aiChatId || "").trim();
  if (!chatId) {
    try {
      const stored = await chrome.storage.local.get(["last_ai_chat_id"]);
      chatId = String(stored.last_ai_chat_id || "").trim();
    } catch {
      // ignore
    }
  }
  if (typeof tabId === "number") {
    try {
      await setStatus("Cooling down — removing finished AI chat…");
      await deleteCurrentAiConversation(tabId, { chatId });
    } catch (err) {
      await setStatus(`Cooling down — chat cleanup skipped: ${String(err?.message || err)}`);
    }
  } else if (chatId) {
    await setStatus("Cooling down — chat cleanup skipped (no AI tab open).");
  }
  const left = Math.max(0, gapMs - (Date.now() - started));
  if (left <= 0) return;
  await setStatus(`Cooling down ${Math.round(left / 1000)}s before ${reason}…`);
  const end = Date.now() + left;
  while (Date.now() < end) {
    if (batchControl?.stop) break;
    await chrome.storage.local.set({ generation_heartbeat: Date.now() }).catch(() => {});
    await sleep(Math.min(5000, Math.max(0, end - Date.now())));
  }
}

async function chatgptPollState(tabId, { harvestJson = false } = {}) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [Boolean(harvestJson)],
    func: (shouldHarvestJson) => {
      const isGenerating = () => {
        const stopBtn =
          document.querySelector("button[data-testid='stop-button']") ||
          document.querySelector("button[aria-label='Stop streaming']") ||
          document.querySelector("button[aria-label='Stop generating']") ||
          document.querySelector('button[aria-label*="Stop"]') ||
          document.querySelector('[data-is-streaming="true"]');
        if (stopBtn && (stopBtn.offsetParent !== null || stopBtn.getAttribute?.("data-is-streaming") === "true")) {
          return true;
        }
        return false;
      };

      const scorePayload = (text) => {
        const t = String(text || "");
        let score = t.length;
        if (t.includes('"experience"')) score += 100000;
        if (t.includes('"name"')) score += 50000;
        if (t.includes('"profile"')) score += 25000;
        if (t.includes('"skills"')) score += 15000;
        if (t.includes('"certifications"')) score += 10000;
        if (/^\s*\{/.test(t) && t.includes("}")) score += 20000;
        return score;
      };

      const collectTextCandidates = () => {
        const out = [];
        const seen = new Set();
        const push = (t, maxLen = 500000) => {
          let text = String(t || "")
            .replace(/\uFEFF/g, "")
            .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/\u00A0/g, " ")
            .trim();
          if (text.length > maxLen) text = text.slice(0, maxLen);
          if (text.length < 40) return;
          const fp = `${text.length}:${text.slice(0, 60)}:${text.slice(-30)}`;
          if (seen.has(fp)) return;
          seen.add(fp);
          out.push(text);
        };

        // Deep scan: last 20 assistant turns (retries push good JSON out of last-3).
        // Includes ChatGPT + Claude message roots.
        const blocks = document.querySelectorAll(
          "[data-message-author-role='assistant'], [data-message-author-role=assistant], [data-turn='assistant'], section[data-turn='assistant'], [data-testid='assistant-message'], [data-testid='assistant'], [data-is-streaming], [class*='assistant-message'], [class*='font-claude-message']"
        );
        if (blocks.length) {
          const start = Math.max(0, blocks.length - 20);
          for (let bi = start; bi < blocks.length; bi += 1) {
            const block = blocks[bi];
            for (const el of block.querySelectorAll(
              "pre code, pre, code, [class*='language-json'], [class*='markdown'], [class*='prose'], [class*='code'], [class*='artifact'], [data-message-content], .cm-content"
            )) {
              push(el.innerText || el.textContent || "");
            }
            push(block.innerText || block.textContent || "");
          }
        }

        // Page-wide JSON code blocks
        for (const el of document.querySelectorAll(
          "main pre, main pre code, [class*='language-json'], [class*='artifact'] pre, [class*='Artifact'] pre, [data-testid*='code'] pre, .monaco-editor .view-lines, .cm-content"
        )) {
          const t = el.innerText || el.textContent || "";
          if (t.includes('"experience"') || t.includes('"name"')) push(t);
        }
        return out;
      };

      const extractBalancedObjects = (str) => {
        const objects = [];
        // Cap work — huge ChatGPT transcripts must not freeze the poller.
        const input = String(str || "").slice(0, 400000);
        let depth = 0;
        let startIdx = -1;
        let inString = false;
        let escaped = false;
        for (let i = 0; i < input.length; i += 1) {
          const ch = input[i];
          if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
          }
          if (ch === '"') {
            inString = true;
            continue;
          }
          if (ch === "{") {
            if (depth === 0) startIdx = i;
            depth += 1;
          } else if (ch === "}") {
            if (depth > 0) {
              depth -= 1;
              if (depth === 0 && startIdx >= 0) {
                objects.push(input.slice(startIdx, i + 1));
                startIdx = -1;
                // Enough candidates — stop early
                if (objects.length >= 8) break;
              }
            }
          }
        }
        return objects;
      };

      const normalizeCandidate = (text) => {
        let t = String(text || "")
          .replace(/^\uFEFF/, "")
          .replace(/[\u201C\u201D]/g, '"')
          .replace(/[\u2018\u2019]/g, "'")
          .replace(/\u00A0/g, " ")
          .trim();
        if (/^```/m.test(t)) {
          t = t.replace(/^```(?:json|JSON)?\s*\r?\n?/, "").replace(/\r?\n?```\s*$/, "").trim();
        }
        t = t.replace(/^(json|JSON)\s*\r?\n/, "");
        if (/\]\(/.test(t)) t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
        // Escape literal newlines/tabs inside JSON strings (DOM/ChatGPT common).
        {
          let out = "";
          let inString = false;
          let escaped = false;
          for (let i = 0; i < t.length; i += 1) {
            const ch = t[i];
            const code = ch.charCodeAt(0);
            if (inString) {
              if (escaped) {
                out += ch;
                escaped = false;
                continue;
              }
              if (ch === "\\") {
                out += ch;
                escaped = true;
                continue;
              }
              if (ch === '"') {
                out += ch;
                inString = false;
                continue;
              }
              if (ch === "\n") {
                out += "\\n";
                continue;
              }
              if (ch === "\r") {
                out += "\\r";
                continue;
              }
              if (ch === "\t") {
                out += "\\t";
                continue;
              }
              if (code < 32) {
                out += `\\u${code.toString(16).padStart(4, "0")}`;
                continue;
              }
              out += ch;
              continue;
            }
            if (ch === '"') inString = true;
            out += ch;
          }
          t = out;
        }
        return t;
      };

      const closeTruncated = (text) => {
        let str = String(text || "");
        const brace = str.indexOf("{");
        if (brace < 0) return null;
        str = str.slice(brace);
        const scan = (input) => {
          const stack = [];
          let inString = false;
          let escaped = false;
          for (let i = 0; i < input.length; i += 1) {
            const ch = input[i];
            if (inString) {
              if (escaped) escaped = false;
              else if (ch === "\\") escaped = true;
              else if (ch === '"') inString = false;
              continue;
            }
            if (ch === '"') inString = true;
            else if (ch === "{" || ch === "[") stack.push(ch);
            else if (ch === "}" || ch === "]") {
              if (stack.length) stack.pop();
            }
          }
          return { stack, inString };
        };
        let { stack, inString } = scan(str);
        if (!stack.length && !inString) return null;
        if (inString) {
          let bs = 0;
          for (let i = str.length - 1; i >= 0 && str[i] === "\\"; i -= 1) bs += 1;
          if (bs % 2 === 1) str += "\\";
          str += '"';
        }
        let repaired = str.replace(/\s+$/, "");
        for (let pass = 0; pass < 4; pass += 1) {
          const before = repaired;
          repaired = repaired.replace(/,\s*$/, "");
          repaired = repaired
            .replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, "")
            .replace(/\{\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, "{")
            .replace(/:\s*$/, "");
          const top = scan(repaired).stack;
          if (top[top.length - 1] === "{") {
            repaired = repaired.replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/, "");
          }
          repaired = repaired.replace(/,\s*$/, "");
          if (repaired === before) break;
        }
        ({ stack, inString } = scan(repaired));
        if (inString) {
          repaired += '"';
          repaired = repaired.replace(/,\s*$/, "");
          ({ stack } = scan(repaired));
        }
        repaired = repaired.replace(/,\s*$/, "");
        ({ stack } = scan(repaired));
        for (let i = stack.length - 1; i >= 0; i -= 1) {
          repaired += stack[i] === "{" ? "}" : "]";
        }
        return repaired;
      };

      const scoreObj = (obj) => {
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return -1;
        const jobs = Array.isArray(obj.experience) ? obj.experience.length : 0;
        const certs = Array.isArray(obj.certifications) ? obj.certifications.length : 0;
        const skills = Array.isArray(obj.skills) ? obj.skills.length : 0;
        const bullets = Array.isArray(obj.experience)
          ? obj.experience.reduce(
              (n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.length : 0),
              0
            )
          : 0;
        const profileLen = String(obj.profile || "").length;
        if (!obj.name && jobs < 1) return -1;
        return (
          jobs * 10000 +
          bullets * 50 +
          certs * 20 +
          skills * 10 +
          profileLen +
          (obj.name ? 500 : 0)
        );
      };

      /** Parse every {...} in text and return the richest resume-shaped object. */
      const parseBestObject = (raw) => {
        const normalized = normalizeCandidate(raw);
        let best = null;
        let bestScore = -1;
        const looseFix = (s) => {
          let t = String(s || "");
          for (let i = 0; i < 8; i += 1) {
            const n = t.replace(/,\s*([}\]])/g, "$1");
            if (n === t) break;
            t = n;
          }
          return t;
        };
        const tryParse = (s) => {
          try {
            return JSON.parse(s);
          } catch {
            try {
              return JSON.parse(looseFix(s));
            } catch {
              return null;
            }
          }
        };
        const consider = (obj) => {
          if (!obj || typeof obj !== "object") return;
          const s = scoreObj(obj);
          if (s > bestScore) {
            best = obj;
            bestScore = s;
          }
        };
        for (const slice of extractBalancedObjects(normalized)) {
          consider(tryParse(slice));
        }
        {
          const start = normalized.indexOf("{");
          const end = normalized.lastIndexOf("}");
          if (start >= 0 && end > start) consider(tryParse(normalized.slice(start, end + 1)));
        }
        if (!best || bestScore < 10000) {
          const closed = closeTruncated(normalized);
          if (closed) consider(tryParse(closed));
        }
        return best;
      };

      const harvestBestJsonText = () => {
        let best = "";
        let bestScore = -1;
        for (const candidate of collectTextCandidates()) {
          if (candidate.includes('"name"') && candidate.includes('"experience"')) {
            const directScore = scorePayload(candidate);
            if (directScore > bestScore) {
              best = candidate;
              bestScore = directScore;
            }
          }
          for (const obj of extractBalancedObjects(normalizeCandidate(candidate))) {
            if (!obj.includes('"name"')) continue;
            if (!(obj.includes('"experience"') || obj.includes('"profile"'))) continue;
            const s = scorePayload(obj);
            if (s > bestScore) {
              best = obj;
              bestScore = s;
            }
          }
        }
        return best;
      };

      const readAssistantBlock = (block) => {
        if (!block) return "";
        const candidates = [];
        for (const pre of block.querySelectorAll("pre")) {
          const text = (pre.innerText || pre.textContent || "").trim();
          if (text) candidates.push(text);
        }
        for (const code of block.querySelectorAll("pre code, code")) {
          const text = (code.innerText || code.textContent || "").trim();
          if (text && text.length > 40) candidates.push(text);
        }
        for (const el of block.querySelectorAll("[class*='code'], [class*='Code'], [data-message-content]")) {
          const text = (el.innerText || el.textContent || "").trim();
          if (text.includes('"experience"') || (text.startsWith("{") && text.includes('"name"'))) {
            candidates.push(text);
          }
        }
        if (candidates.length) {
          candidates.sort((a, b) => scorePayload(b) - scorePayload(a));
          return candidates[0];
        }
        return (block.innerText || block.textContent || "").trim();
      };

      const blocks = Array.from(
        document.querySelectorAll(
          [
            "[data-message-author-role='assistant']",
            "[data-turn='assistant']",
            "section[data-turn='assistant']",
            '[data-testid="assistant-message"]',
            '[data-testid="assistant"]',
            '[data-is-streaming]',
            '[class*="assistant-message"]',
            '[class*="font-claude-message"]'
          ].join(", ")
        )
      );
      if (blocks.length) {
        blocks[blocks.length - 1].scrollIntoView({ block: "end", inline: "nearest" });
      }

      let latest = "";
      if (blocks.length) {
        if (shouldHarvestJson) {
          // Resume mode: score many assistant blocks — retries push the good JSON out of last-3.
          const start = Math.max(0, blocks.length - 20);
          for (let bi = start; bi < blocks.length; bi += 1) {
            const text = readAssistantBlock(blocks[bi]);
            if (scorePayload(text) > scorePayload(latest)) latest = text;
          }
        } else {
          // Cover-letter mode: ALWAYS take the newest assistant turn (never prefer older JSON).
          latest = (blocks[blocks.length - 1].innerText || blocks[blocks.length - 1].textContent || "").trim();
        }
      }
      if (shouldHarvestJson) {
        const harvested = harvestBestJsonText();
        if (scorePayload(harvested) > scorePayload(latest)) {
          latest = harvested;
        }
      }

      // Parse on-page so background gets a structured object (avoids huge-string IPC issues).
      // ALWAYS keep the raw `latest` text — never replace it with a partial parse.
      // A schema stub can parse first while the full resume JSON is still in the reply.
      let resumeData = null;
      if (shouldHarvestJson && latest) {
        let bestObj = null;
        let bestObjScore = -1;
        for (const raw of [latest, ...collectTextCandidates()].filter(Boolean)) {
          const obj = parseBestObject(raw);
          if (!obj) continue;
          const s = scoreObj(obj);
          if (s > bestObjScore) {
            bestObj = obj;
            bestObjScore = s;
          }
        }
        resumeData = bestObj;
      }

      // Large tailored resumes are ~15–30KB JSON. Shipping 200KB of raw page
      // text + the object through executeScript routinely times out the poller —
      // which is exactly when the user can SEE the JSON but files never generate.
      // Persist into extension storage HERE so recognition survives return timeouts.
      const recognizedWell =
        resumeData &&
        Array.isArray(resumeData.experience) &&
        resumeData.experience.length >= 1 &&
        scoreObj(resumeData) >= 15000;

      if (recognizedWell && resumeData) {
        try {
          const jobs = resumeData.experience.length;
          const bullets = Array.isArray(resumeData.experience)
            ? resumeData.experience.reduce(
                (n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.length : 0),
                0
              )
            : 0;
          const profile = String(resumeData.profile || "").trim();
          const skills = Array.isArray(resumeData.skills) ? resumeData.skills.length : 0;
          const certs = Array.isArray(resumeData.certifications)
            ? resumeData.certifications.length
            : 0;
          const edu = Array.isArray(resumeData.education) ? resumeData.education.length : 0;
          const looksComplete =
            Boolean(String(resumeData.name || "").trim()) &&
            bullets >= 4 &&
            (profile.length >= 40 ||
              (Array.isArray(resumeData.technicalSummary) &&
                resumeData.technicalSummary.filter(Boolean).length >= 3)) &&
            (skills >= 1 ||
              certs >= 1 ||
              edu >= 1 ||
              (jobs >= 3 && bullets >= 8 && profile.length >= 60) ||
              (jobs >= 2 && bullets >= 10));
          chrome.storage.local.set({
            chatgpt_harvested_resume: resumeData,
            chatgpt_harvested_at: Date.now(),
            chatgpt_harvested_jobs: jobs,
            chatgpt_json_ready: Boolean(looksComplete),
            chatgpt_json_ready_at: looksComplete ? Date.now() : 0,
            last_resume_json: resumeData
          });
        } catch {
          // storage may be temporarily unavailable
        }
      }

      // When recognizedWell, do NOT blank latest to "" — that left background
      // holding a mid-stream truncated lastText while the full JSON was on screen.
      // Prefer a compact serialized object (or a short slice) for IPC.
      let latestOut = String(latest || "").slice(0, 120000);
      if (recognizedWell && resumeData) {
        try {
          latestOut = JSON.stringify(resumeData);
        } catch {
          latestOut = latestOut.slice(0, 8000);
        }
      }

      return {
        blockCount: blocks.length,
        latest: latestOut,
        resumeData: resumeData || null,
        jobCount: Array.isArray(resumeData?.experience) ? resumeData.experience.length : 0,
        generating: isGenerating(),
        harvestedJson: shouldHarvestJson,
        recognizedWell: Boolean(recognizedWell)
      };
    }
  });

  if (!results?.length) throw new Error("No response from content script.");
  if (results[0].result === undefined && results[0].error) {
    throw new Error(String(results[0].error.message || results[0].error));
  }
  return results[0].result || { blockCount: 0, latest: "", resumeData: null, generating: false };
}

function looksSettledAssistantText(text, { expectResumeJson = false } = {}) {
  const t = String(text || "").trim();
  if (!t) return false;

  if (/<!doctype html|<html[\s>]/i.test(t) && /<\/html>/i.test(t)) return true;

  if (expectResumeJson) {
    // Clarifying questions / refusals are NOT done.
    if (/please provide|need (more )?info|could you (share|provide)|clarif/i.test(t) && !t.includes('"experience"')) {
      return false;
    }
    const data = extractResumeJson(t);
    if (isUsableResumeJson(data)) return true;
    // Incomplete JSON that still looks open — keep waiting.
    if (/^\s*[{`]/.test(t) || t.includes('"name"')) return false;
    // Long non-JSON prose: not settled for resume mode.
    return false;
  }

  if (!(t.includes('"experience"') && t.includes('"certifications"'))) {
    if (/<!doctype html|<html[\s>]/i.test(t)) return /<\/html>/i.test(t);
    return t.length > 200;
  }
  const end = t.lastIndexOf("}");
  if (end < 0) return false;
  const after = t.slice(end + 1).replace(/```/g, "").trim();
  return after.length === 0;
}

async function automateChatGpt(tabId, prompt, options = {}) {
  const provider = await getStoredAiProvider();
  const providerLabel = aiProviderLabel(provider);
  const startNewChat = options.newChat !== false;
  const label = options.statusLabel || `Waiting for ${providerLabel} response...`;
  const expectResumeJson = Boolean(options.expectResumeJson);

  const { blocksBefore, latestBefore } = await aiSendPrompt(tabId, prompt, startNewChat);

  // Active polling budget (rate-limit cooldowns do NOT count against this).
  const timeoutMs = expectResumeJson ? 12 * 60 * 1000 : 4 * 60 * 1000;
  // Consecutive no-growth polls (≈1s each) after streaming stops before we give
  // up on the current answer and let the caller re-prompt.
  const SETTLE_HITS = 4;
  /** Extra pause after stream ends so the full JSON finishes painting into the
   * DOM before we harvest — guards against grabbing a truncated mid-stream tail. */
  const POST_STREAM_DELAY_MS = 2500;
  const start = Date.now();
  let pausedMs = 0;
  let lastText = "";
  let sawGeneration = false;
  let stableHits = 0;
  let lastLen = 0;
  let lastJobCount = 0;
  let postStreamDelayDone = false;

  // Ignore any previous job's harvested JSON / ready flag.
  if (expectResumeJson) {
    await chrome.storage.local
      .set({
        chatgpt_harvested_resume: null,
        chatgpt_harvested_at: 0,
        chatgpt_harvested_jobs: 0,
        chatgpt_json_ready: false,
        chatgpt_json_ready_at: 0
      })
      .catch(() => {});
  }

  while (Date.now() - start - pausedMs < timeoutMs) {
    await sleep(1000);
    await chrome.storage.local.set({ generation_heartbeat: Date.now() }).catch(() => {});

    if (batchControl.skipCurrent) {
      throw new Error("__SKIP__");
    }

    // Mid-reply rate-limit / capacity banner: cool down, then keep polling for JSON.
    if (provider === AI_PROVIDERS.CHATGPT) {
      try {
        const rate = await detectChatGptRateLimit(tabId);
        if (rate.limited) {
          const pauseStart = Date.now();
          await waitOutChatGptRateLimit(tabId);
          pausedMs += Date.now() - pauseStart;
          continue;
        }
      } catch (rateErr) {
        if (String(rateErr?.message || rateErr) === "__SKIP__") throw rateErr;
        if (String(rateErr?.message || rateErr) === "__RATE_LIMIT_PAUSE__") throw rateErr;
        // ignore transient detection errors
      }
    } else if (provider === AI_PROVIDERS.CLAUDE) {
      try {
        const cap = await detectClaudeCapacityLimit(tabId);
        if (cap.limited) {
          const pauseStart = Date.now();
          await waitOutClaudeCapacityLimit(tabId);
          pausedMs += Date.now() - pauseStart;
          continue;
        }
      } catch (capErr) {
        if (String(capErr?.message || capErr) === "__SKIP__") throw capErr;
        if (String(capErr?.message || capErr) === "__RATE_LIMIT_PAUSE__") throw capErr;
      }
    }

    // Ready flag from content.js = JSON complete on page → generate files now.
    if (expectResumeJson) {
      try {
        const stored = await chrome.storage.local.get([
          "chatgpt_json_ready",
          "chatgpt_json_ready_at",
          "chatgpt_harvested_resume",
          "chatgpt_harvested_at"
        ]);
        const readyAt = Number(stored.chatgpt_json_ready_at || stored.chatgpt_harvested_at || 0);
        const harvested = stored.chatgpt_harvested_resume;
        if (readyAt >= start && (isUsableResumeJson(harvested) || isMinimallySaveableResume(harvested))) {
          lastUsableResumeData = harvested;
          await setStatus(
            `Resume JSON ready flag set (${harvested.experience?.length || 0} jobs). Saving jd.txt + resume + cover letter…`
          );
          return JSON.stringify(harvested);
        }
      } catch {
        // ignore
      }
    }

    if (expectResumeJson && batchControl.forceProceed && isUsableResumeJson(lastUsableResumeData)) {
      batchControl.forceProceed = false;
      await setStatus(`Force-save: using harvested JSON. Saving…`);
      return JSON.stringify(lastUsableResumeData);
    }

    let state = { latest: "", resumeData: null, generating: false, blockCount: 0, jobCount: 0 };
    try {
      state = await withTimeout(
        chatgptPollState(tabId, { harvestJson: expectResumeJson }),
        8000,
        `${providerLabel} page poll timed out (harvest too slow).`
      );
    } catch (pollErr) {
      await setStatus(`${label} (poll warning: ${String(pollErr?.message || pollErr)})`);
      // Still allow force-save / storage harvest on next loop — do not block forever.
      continue;
    }
    if (state.generating) {
      sawGeneration = true;
      postStreamDelayDone = false;
    }

    // Stream just finished → wait for DOM settle, then harvest (user's requested delay).
    if (expectResumeJson && sawGeneration && !state.generating && !postStreamDelayDone) {
      postStreamDelayDone = true;
      await setStatus(`${label} — stream finished, waiting ${POST_STREAM_DELAY_MS / 1000}s for JSON to settle…`);
      const settlePauseStart = Date.now();
      await new Promise((r) => setTimeout(r, POST_STREAM_DELAY_MS));
      pausedMs += Date.now() - settlePauseStart;
      await chrome.storage.local.set({ generation_heartbeat: Date.now() }).catch(() => {});
      const settled = await waitForJsonReadyFlag(tabId, { since: start, timeoutMs: 8000 });
      if (isUsableResumeJson(settled) || isMinimallySaveableResume(settled)) {
        await setStatus(
          `Resume JSON recognized after settle (${settled.experience?.length || 0} jobs). Saving jd.txt + resume + cover letter…`
        );
        return JSON.stringify(settled);
      }
      // Re-poll once after the delay so `state` below is fresh.
      try {
        state = await withTimeout(
          chatgptPollState(tabId, { harvestJson: true }),
          8000,
          `${providerLabel} page poll timed out (harvest too slow).`
        );
      } catch {
        // keep previous state
      }
    }

    // Keep the richest raw text seen for resume JSON — never shrink away a full reply.
    // For cover letters / plain text, ALWAYS prefer the newest assistant turn after
    // our send (a short letter must replace the previous huge JSON message).
    if (state.latest) {
      if (!expectResumeJson) {
        if (state.blockCount > blocksBefore) {
          lastText = state.latest;
        } else if (
          !lastText ||
          (state.latest.length >= lastText.length && !/"experience"\s*:/.test(state.latest))
        ) {
          lastText = state.latest;
        }
      } else if (
        !lastText ||
        state.latest.length >= lastText.length ||
        (state.latest.includes('"experience"') && !lastText.includes('"experience"')) ||
        // Recognized full object serialized — always replace truncated mid-stream text.
        (state.recognizedWell && state.resumeData && state.latest.startsWith("{"))
      ) {
        lastText = state.latest;
      }
    }

    // Structured object already harvested — prefer it over any stale lastText.
    if (expectResumeJson && state.recognizedWell && state.resumeData) {
      lastUsableResumeData = state.resumeData;
      if (
        isUsableResumeJson(state.resumeData) ||
        isMinimallySaveableResume(state.resumeData)
      ) {
        await chrome.storage.local
          .set({
            last_resume_json: state.resumeData,
            chatgpt_harvested_resume: state.resumeData,
            chatgpt_harvested_at: Date.now(),
            chatgpt_json_ready: true,
            chatgpt_json_ready_at: Date.now()
          })
          .catch(() => {});
        await setStatus(
          `Resume JSON recognized (${state.resumeData.name || "ok"}, ${
            state.resumeData.experience?.length || 0
          } jobs). Saving jd.txt + resume + cover letter…`
        );
        return JSON.stringify(state.resumeData);
      }
    }

    const elapsedSec = Math.round((Date.now() - start - pausedMs) / 1000);
    let parsed = null;
    if (expectResumeJson) {
      // Recognize from BOTH the structured poll parse and a fresh parse of raw text.
      // The page often contains a small schema example AND the real resume JSON;
      // taking only the first object used to miss the complete reply the user can see.
      const fromPoll = state.resumeData && typeof state.resumeData === "object" ? state.resumeData : null;
      const fromText = extractResumeJson(lastText);
      let fromStorage = null;
      try {
        const stored = await chrome.storage.local.get([
          "chatgpt_harvested_resume",
          "chatgpt_harvested_at",
          "last_resume_json"
        ]);
        const stamp = Number(stored.chatgpt_harvested_at || 0);
        if (stamp >= start && isUsableResumeJson(stored.chatgpt_harvested_resume)) {
          fromStorage = stored.chatgpt_harvested_resume;
        } else if (stamp >= start && isUsableResumeJson(stored.last_resume_json)) {
          fromStorage = stored.last_resume_json;
        }
      } catch {
        // ignore
      }
      const fromHarvest = isUsableResumeJson(lastUsableResumeData) ? lastUsableResumeData : null;
      const rank = (obj) => {
        if (!obj || typeof obj !== "object") return -1;
        const jobs = Array.isArray(obj.experience) ? obj.experience.length : 0;
        const bullets = Array.isArray(obj.experience)
          ? obj.experience.reduce(
              (n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.length : 0),
              0
            )
          : 0;
        return (
          (isUsableResumeJson(obj) ? 1000000 : 0) +
          (isRichResumeJson(obj) ? 500000 : 0) +
          (resumeJsonLooksComplete(obj) ? 250000 : 0) +
          jobs * 10000 +
          bullets * 50 +
          String(obj.profile || "").length
        );
      };
      parsed = [fromPoll, fromText, fromStorage, fromHarvest].reduce(
        (best, cur) => (rank(cur) > rank(best) ? cur : best),
        null
      );
    }
    const usable = expectResumeJson && isUsableResumeJson(parsed);
    const softOk = expectResumeJson && !usable && isMinimallySaveableResume(parsed);
    const rich = usable && isRichResumeJson(parsed);
    const looksComplete = usable && resumeJsonLooksComplete(parsed);
    if (usable || softOk) {
      lastUsableResumeData = parsed;
      await chrome.storage.local
        .set({
          last_resume_json: parsed,
          chatgpt_harvested_resume: parsed,
          chatgpt_harvested_at: Date.now(),
          chatgpt_json_ready: true,
          chatgpt_json_ready_at: Date.now()
        })
        .catch(() => {});
    }

    if (elapsedSec > 0 && elapsedSec % 2 === 0) {
      const waitHint = expectResumeJson
        ? usable || softOk
          ? `, JSON ready (${parsed?.experience?.length || "?"} jobs)${
              state.generating ? " — GPT still busy, saving anyway" : " — saving files"
            }`
          : parsed
            ? `, waiting: ${describeResumeGaps(parsed) || "almost ready"} (jobs=${state.jobCount || 0})`
            : lastText.includes('"experience"')
              ? ", JSON visible — settling…"
              : ", waiting for JSON"
        : "";
      await setStatus(
        `${label} (${elapsedSec}s${state.generating ? ", streaming" : ""}${waitHint})`
      );
    }

    // Nothing arrived at all: Send never registered. Fail fast instead of
    // burning the whole timeout — the caller retries with a fresh chat.
    // Cover letters should fail even sooner (same-chat follow-up).
    const sendFailSec = expectResumeJson ? 120 : 45;
    if (!sawGeneration && !state.generating && state.blockCount <= blocksBefore && elapsedSec > sendFailSec) {
      throw new Error(
        `${providerLabel} never started a reply (Send did not register). Keep that tab focused and retry.`
      );
    }

    // Recognized resume JSON → generate files (jd + resume PDF + cover letter).
    // ChatGPT often keeps the stop/thinking UI after the JSON object is already
    // complete on the page — do not wait for stream end in that case.
    if (
      expectResumeJson &&
      usable &&
      (rich ||
        looksComplete ||
        !state.generating ||
        state.recognizedWell ||
        postStreamDelayDone)
    ) {
      await setStatus(
        `Resume JSON recognized (${parsed.name || "ok"}, ${parsed.experience?.length || 0} jobs)${
          state.generating ? " while GPT still busy" : ""
        }. Saving jd.txt + resume + cover letter…`
      );
      return JSON.stringify(parsed);
    }
    // Soft acceptance only after stream settles (avoid mid-stream thin repairs).
    if (expectResumeJson && softOk && (!state.generating || postStreamDelayDone)) {
      await setStatus(
        `Resume JSON accepted (soft bar, ${parsed.experience?.length || 0} jobs). Saving files…`
      );
      return JSON.stringify(parsed);
    }

    const isFreshText = Boolean(lastText) && lastText !== (latestBefore || "");
    const isNewBlock = state.blockCount > blocksBefore;
    if (!isFreshText && !isNewBlock && !(expectResumeJson && (lastText.length > 200 || usable))) continue;

    if (state.generating) {
      if (lastText.length > lastLen + 80 || (state.jobCount || 0) > (lastJobCount || 0)) {
        lastLen = Math.max(lastLen, lastText.length);
        lastJobCount = state.jobCount || 0;
        stableHits = 0;
      } else if (expectResumeJson && usable) {
        // JSON not growing while stop button still shows → treat as done.
        stableHits += 1;
        if (stableHits >= 3) {
          await setStatus(
            `Resume JSON stable while GPT still busy (${parsed.experience?.length || 0} jobs). Saving files…`
          );
          return JSON.stringify(parsed);
        }
      }
      continue;
    }

    if (!(sawGeneration || (isNewBlock && Date.now() - start > 8000) || (expectResumeJson && elapsedSec > 15))) {
      continue;
    }

    if (lastText.length > lastLen + 40) {
      lastLen = lastText.length;
      stableHits = 0;
      continue;
    }
    if (lastText.length > lastLen) lastLen = lastText.length;

    stableHits += 1;

    if (expectResumeJson) {
      if (stableHits >= 1 && usable) {
        await setStatus(
          `Resume JSON recognized (${parsed.name || "ok"}, ${parsed.experience?.length || 0} jobs). Saving jd.txt + resume + cover letter…`
        );
        return JSON.stringify(parsed);
      }
      // Settled without a usable parse — deep harvest, never stub-trigger a retry loop.
      if (stableHits >= SETTLE_HITS) {
        const rescued = await waitForJsonReadyFlag(tabId, { since: start, timeoutMs: 10000 });
        if (isUsableResumeJson(rescued) || isMinimallySaveableResume(rescued)) {
          await setStatus(
            `Resume JSON rescued from page (${rescued.experience?.length || 0} jobs). Saving files…`
          );
          return JSON.stringify(rescued);
        }
        if (isUsableResumeJson(lastUsableResumeData) || isMinimallySaveableResume(lastUsableResumeData)) {
          return JSON.stringify(lastUsableResumeData);
        }
        const repaired = extractResumeJson(lastText);
        if (isUsableResumeJson(repaired) || isMinimallySaveableResume(repaired)) {
          return JSON.stringify(repaired);
        }
        // Truncated mid-stream text looks like JSON in the preview but will not
        // parse — keep waiting rather than returning poison to the caller.
        const openBraces = (String(lastText).match(/\{/g) || []).length;
        const closeBraces = (String(lastText).match(/\}/g) || []).length;
        if (
          /"name"|"experience"/.test(lastText) &&
          (openBraces > closeBraces || !repaired) &&
          stableHits < SETTLE_HITS + 20
        ) {
          await setStatus(
            `${label} — JSON visible but incomplete/unparsed; harvesting (${stableHits}s settled)…`
          );
          continue;
        }
        return lastText;
      }
      continue;
    }

    if (!expectResumeJson) {
      // Prefer the newest assistant turn — poller used to keep returning resume JSON.
      const plain = await readLatestAssistantPlainText(tabId);
      if (plain && looksLikeCoverLetterBody(plain)) return plain;
      if (
        plain &&
        plain.length > 120 &&
        !/"experience"\s*:/.test(plain) &&
        (sawGeneration || state.blockCount > blocksBefore || elapsedSec > 20)
      ) {
        if (stableHits >= 2 || looksSettledAssistantText(plain, { expectResumeJson: false })) {
          return plain;
        }
      }

      // Still stuck on the previous resume JSON turn — keep waiting for the letter.
      if (/"experience"\s*:/.test(lastText) && /"name"\s*:/.test(lastText)) {
        if (state.blockCount > blocksBefore && plain && looksLikeCoverLetterBody(plain)) return plain;
        if (elapsedSec > 90 && !state.generating) {
          throw new Error(
            "Cover letter reply did not appear after the resume JSON. Prompt may still be sitting in the composer — focus the AI tab and click Send, or Skip/Retry."
          );
        }
        continue;
      }
      if (stableHits >= 2 && looksSettledAssistantText(lastText, { expectResumeJson })) {
        return lastText;
      }
      if (stableHits >= 5 && sawGeneration && looksLikeCoverLetterBody(lastText)) {
        return lastText;
      }
      if (stableHits >= 8 && sawGeneration && lastText.length > 80) {
        return lastText;
      }
      continue;
    }
  }

  if (expectResumeJson && isUsableResumeJson(extractResumeJson(lastText))) {
    lastUsableResumeData = extractResumeJson(lastText);
    return lastText;
  }
  if (expectResumeJson) {
    const rescued = await waitForJsonReadyFlag(tabId, { since: start, timeoutMs: 10000 });
    if (isUsableResumeJson(rescued) || isMinimallySaveableResume(rescued)) {
      return JSON.stringify(rescued);
    }
    for (let i = 0; i < 4; i += 1) {
      const deep = await tryRecognizeResumeOnPage(tabId);
      if (isUsableResumeJson(deep) || isMinimallySaveableResume(deep)) {
        return JSON.stringify(deep);
      }
      await sleep(1200);
    }
  }
  if (expectResumeJson && (isUsableResumeJson(lastUsableResumeData) || isMinimallySaveableResume(lastUsableResumeData))) {
    return JSON.stringify(lastUsableResumeData);
  }

  if (!expectResumeJson) {
    const plain = await readLatestAssistantPlainText(tabId);
    if (looksLikeCoverLetterBody(plain)) return plain;
    if (looksLikeCoverLetterBody(lastText)) return lastText;
    if (plain && plain.length > 80 && !/"experience"\s*:/.test(plain)) return plain;
  }

  throw new Error(
    expectResumeJson
      ? `Timed out waiting to recognize complete resume JSON from ${providerLabel} (JSON may be on screen — click Save JSON now).`
      : `Timed out waiting for cover letter / ${providerLabel} response.`
  );
}

/**
 * One ChatGPT chat per job:
 *  1) new chat → resume prompt (JD inside)
 *  2) save jd.txt + [Name]_Resume.pdf
 *  3) same chat → cover letter prompt
 *  4) save [Name]_Cover Letter.pdf
 */
async function saveResumeAndCoverLetter(tabId, output, resumeData, jobMeta, { runCoverLetter = true } = {}) {
  resumeData = await finalizeResumeData(resumeData);
  await setStatus("Saving jd.txt + resume PDF…");
  const { jobDir: savedDir, nameToken, resumePdfName, saved } = await autoDownloadResumeFiles(
    output,
    resumeData,
    jobMeta
  );

  const parts = [];
  if (saved?.jd) parts.push("jd.txt");
  if (saved?.pdf) parts.push(resumePdfName || saved.resumePdfName || "Resume.pdf");
  let status = `Saved to Downloads / ${savedDir} (${parts.join(" + ") || "partial"})`;
  if (saved?.pdfError && !saved?.pdf) {
    status += ` — ${saved.pdfError}`;
  }

  if (runCoverLetter && typeof tabId === "number") {
    try {
      // Brief pause so the AI finishes any post-JSON UI before the CL prompt.
      await sleep(COVER_LETTER_GAP_MS);
      const provider = await getStoredAiProvider();
      if (provider === AI_PROVIDERS.CHATGPT) {
        await waitOutChatGptRateLimit(tabId).catch(() => {});
      }
      await setStatus(`Same chat: sending cover letter prompt (${aiProviderLabel(provider)})…`);
      const coverPrompt = await buildCoverLetterPrompt({
        jdText: jobMeta.jdText || "",
        jobTitle: jobMeta.jobTitle || "",
        companyName: jobMeta.companyName || "",
        roleTrack,
        sessionRoleTrack
      });
      // IMPORTANT: same chat as resume (one chat per position).
      let coverOutput = "";
      const pickCover = async (reply) => {
        let text = String(reply || "").trim();
        if (looksLikeCoverLetterBody(text)) return text;
        // Stale JSON often comes back from the poller — read the newest turn only.
        const latest = await readLatestAssistantPlainText(tabId);
        if (looksLikeCoverLetterBody(latest)) return latest;
        return text;
      };

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const prompt =
            attempt === 1
              ? coverPrompt
              : attempt === 2
                ? "Stop. Do NOT return JSON or resume content. Write ONLY a plain-text cover letter body for this job: start with Dear Hiring Manager, then 3–4 short paragraphs. No markdown links, no email/URL lines, no signature block."
                : "IMPORTANT: Ignore the resume JSON above. Reply with ONLY the cover letter plain text starting with Dear Hiring Manager, — nothing else.";
          const reply = await automateChatGpt(tabId, prompt, {
            newChat: false,
            expectResumeJson: false,
            statusLabel:
              attempt === 1
                ? "Waiting for cover letter (same chat)…"
                : `Retrying cover letter (attempt ${attempt}/3)…`
          });
          coverOutput = await pickCover(reply);
          if (looksLikeCoverLetterBody(coverOutput)) break;
          await setStatus("Cover letter looked wrong (JSON/stale reply). Retrying…");
          await sleep(1000);
        } catch (attemptErr) {
          if (attempt === 3) throw attemptErr;
          await setStatus(
            `Cover letter attempt ${attempt} failed (${String(attemptErr?.message || attemptErr)}). Retrying…`
          );
          await sleep(1000);
        }
      }
      if (!looksLikeCoverLetterBody(coverOutput)) {
        // Soft-fail: resume files already saved; do not mark the whole row as failed.
        throw new Error(
          "Cover letter response was unusable (got JSON/resume text or empty). Resume PDF was saved — use Retry on this row for the letter."
        );
      }

      const token = nameToken || outputNameToken(jobMeta, resumeData);
      const coverPdfName = `${token}_Cover Letter.pdf`;
      await setStatus(`Saving ${coverPdfName}…`);
      const contact = await getAutofillContact();
      // Always use person-profile contact for the signature — never ChatGPT-mangled JSON fields.
      const cl = await autoDownloadCoverLetterPdf(
        coverOutput,
        savedDir,
        {
          name: contact.name || resumeData?.name || "Applicant",
          signatureTitle:
            contact.signatureTitle || resumeData?.headline || "Salesforce Professional",
          headline: resumeData?.headline || contact.signatureTitle || "",
          location: contact.location || resumeData?.location || "",
          email: contact.email || resumeData?.email || "",
          phone: contact.phone || resumeData?.phone || "",
          linkedin: contact.linkedin || resumeData?.linkedin || ""
        },
        token,
        jobMeta
      );
      if (cl.pdf) status = `${status} + ${cl.coverPdfName || coverPdfName}`;
    } catch (coverErr) {
      status = `${status}; cover letter failed: ${String(coverErr?.message || coverErr)}`;
    }
  } else if (runCoverLetter) {
    status = `${status}. Cover letter skipped: open a ChatGPT or Claude tab.`;
  }

  let spreadsheetUrl = String(jobMeta.spreadsheetUrl || "").trim();
  let sheetsWebAppUrl = String(jobMeta.sheetsWebAppUrl || "").trim();
  if (!spreadsheetUrl || !sheetsWebAppUrl) {
    const sheetCfg = await getSheetConfig();
    if (!spreadsheetUrl) spreadsheetUrl = String(sheetCfg.spreadsheetUrl || "").trim();
    if (!sheetsWebAppUrl) sheetsWebAppUrl = String(sheetCfg.webAppUrl || "").trim();
  }
  if (spreadsheetUrl && sheetsWebAppUrl) {
    const manualBid = jobMeta.bidSource === "one-off" || jobMeta.oneOff === true;
    await setStatus(manualBid ? "Recording Applied on Google Sheet..." : "Appending row to Google Sheet...");
    try {
      if (manualBid) {
        const sheetResult = await markJobAppliedOnSpreadsheet({
          spreadsheetUrl,
          webAppUrl: sheetsWebAppUrl,
          jobNo: jobMeta.csvRow != null ? jobMeta.csvRow : jobMeta.jobNo || "",
          jobTitle: jobMeta.jobTitle,
          companyName: jobMeta.companyName,
          jdLink: jobMeta.jdLink,
          salary: jobMeta.salary || ""
        });
        const label = sheetResult.status || formatAppliedStatus();
        status = `${status} Sheet: ${label}.`;
      } else {
        const sheetResult = await appendJobToSpreadsheet({
          spreadsheetUrl,
          webAppUrl: sheetsWebAppUrl,
          jobNo: jobMeta.csvRow != null ? jobMeta.csvRow : jobMeta.jobNo || "",
          jobTitle: jobMeta.jobTitle,
          companyName: jobMeta.companyName,
          jdLink: jobMeta.jdLink,
          salary: jobMeta.salary || ""
        });
        status = sheetResult.duplicate
          ? `${status} (already on Google Sheet — not re-appended)`
          : `${status} and appended to Google Sheet`;
      }
    } catch (sheetErr) {
      status = `${status}, but sheet append failed: ${String(sheetErr?.message || sheetErr)}`;
    }
  }

  return { savedDir, status };
}

async function runGenerationPipeline({ jobMeta, jsonText }) {
  // Strict manual path: parse the pasted JSON, render + save, then cover letter.
  const data = extractResumeJson(jsonText);
  if (!data) {
    throw new Error(
      "Pasted text is not valid resume JSON. Copy the full JSON object (starting with { and ending with })."
    );
  }
  const rawText = JSON.stringify(data, null, 2);
  const tab = await getOpenChatGptTab();
  await chrome.storage.local.set({ last_response: rawText });
  return saveResumeAndCoverLetter(tab?.id, rawText, data, jobMeta || {}, {
    runCoverLetter: true
  });
}

async function getQueue() {
  const data = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
}

async function setQueue(queue) {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

async function setBatchState(state) {
  await chrome.storage.local.set({ [BATCH_STATE_KEY]: state });
}

async function updateQueueJob(csvRow, patch) {
  const queue = await getQueue();
  const next = queue.map((j) => (Number(j.csvRow) === Number(csvRow) ? { ...j, ...patch } : j));
  await setQueue(next);
  return next.find((j) => Number(j.csvRow) === Number(csvRow));
}

async function rememberApplyHistory(csvRow, entry) {
  const data = await chrome.storage.local.get(APPLY_HISTORY_KEY);
  const map = data[APPLY_HISTORY_KEY] && typeof data[APPLY_HISTORY_KEY] === "object" ? data[APPLY_HISTORY_KEY] : {};
  map[String(csvRow)] = { ...(map[String(csvRow)] || {}), ...entry, updatedAt: Date.now() };
  await chrome.storage.local.set({ [APPLY_HISTORY_KEY]: map });
}

function mergeApplyHistoryIntoJobs(jobs, hist = {}) {
  return (Array.isArray(jobs) ? jobs : []).map((job) => {
    const remembered = hist[String(job.csvRow)] || {};
    return {
      ...job,
      resumeName: job.resumeName || remembered.resumeName || "",
      coverName: job.coverName || remembered.coverName || ""
    };
  });
}

async function hydrateQueueFromDisk() {
  const data = await chrome.storage.local.get([QUEUE_KEY, ALL_US_JOBS_KEY, APPLY_HISTORY_KEY]);
  const queue = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
  const allUs = Array.isArray(data[ALL_US_JOBS_KEY]) ? data[ALL_US_JOBS_KEY] : [];
  const hist = data[APPLY_HISTORY_KEY] && typeof data[APPLY_HISTORY_KEY] === "object" ? data[APPLY_HISTORY_KEY] : {};
  const nextQueue = mergeApplyHistoryIntoJobs(await hydrateJobsWithFolders(queue), hist);
  const nextAll = mergeApplyHistoryIntoJobs(await hydrateJobsWithFolders(allUs), hist);
  const changed =
    nextQueue.some((j, i) => j.jobDir && j.jobDir !== queue[i]?.jobDir) ||
    nextAll.some((j, i) => j.jobDir && j.jobDir !== allUs[i]?.jobDir) ||
    nextQueue.some((j, i) => (j.resumeName || "") !== (queue[i]?.resumeName || "")) ||
    nextQueue.some((j, i) => (j.coverName || "") !== (queue[i]?.coverName || ""));
  if (changed) {
    await chrome.storage.local.set({
      [QUEUE_KEY]: nextQueue,
      [ALL_US_JOBS_KEY]: nextAll
    });
    for (const job of nextQueue) {
      if (job?.csvRow != null && job.jobDir) {
        await rememberApplyHistory(job.csvRow, {
          jobDir: job.jobDir,
          jdLink: job.jdLink || "",
          resumeName: job.resumeName || "",
          coverName: job.coverName || ""
        });
      }
    }
  }
  return { queue: nextQueue, allUsJobs: nextAll };
}

async function pickTemplateId(jobMeta = {}, person = {}) {
  if (jobMeta.templateId) return jobMeta.templateId;
  const stored = await chrome.storage.local.get("selected_template_id");
  return stored.selected_template_id || person.templateId || DEFAULT_TEMPLATE_ID;
}

/**
 * Fully automatic — ONE new ChatGPT chat per position:
 * resume (with JD) → save files → cover letter in the same chat → save CL.
 */
async function runAutoJob(jobMeta) {
  // Duplicate / coverage first — never spend ChatGPT time on a job link we already bid.
  const preSkipReason = await getPreGenerateSkipReason(jobMeta);
  if (preSkipReason) {
    throw new Error(`__DUPLICATE_SKIP__:${preSkipReason}`);
  }

  const jdLink = String(jobMeta.jdLink || "").trim();
  if (jdLink) {
    if (batchControl.skipCurrent || batchControl.stop) throw new Error("__SKIP__");
    await setStatus(
      `Row ${jobMeta.csvRow != null ? `${jobMeta.csvRow}: ` : ""}checking if job posting is still active…`
    );
    const inactiveProbe = await probeJobLinkInactive(jdLink);
    await closeApplyTab(inactiveProbe.tabId).catch(() => false);
    if (inactiveProbe.unavailable) {
      throw new Error(`__INACTIVE_SKIP__:${inactiveProbe.detail || "inactive job"}`);
    }
  }

  const provider = await getStoredAiProvider();
  const providerLabel = aiProviderLabel(provider);
  const tab = await ensureAiTab(provider);
  if (!tab || typeof tab.id !== "number") {
    throw new Error(`Open ${providerLabel} in a browser tab first.`);
  }

  const person = await getActivePerson();
  const sessionRoleTrack = await getSessionRoleTrack();
  const personRoleTrack = resolveRoleTrackForPerson(person);
  const roleTrack = resolveEffectiveRoleTrack(person, sessionRoleTrack);
  const trackStatus = formatRoleTrackStatus(roleTrack, {
    sessionOverride: sessionRoleTrack,
    personTrack: personRoleTrack
  });
  const experienceRules = await activatePersonExperienceRules(person);
  if (experienceRules?.roles?.length) {
    await setStatus(
      `Validating experience employers for ${person.name || person.label}: ${formatRequiredEmployersList(experienceRules)}`
    );
  } else {
    await setStatus(
      `Warning: no required employers configured for ${person.name || person.label} — incomplete experience may be saved. Add them in the person editor.`
    );
  }

  const profileId = jobMeta.profileId || person.id;
  const prompt = await buildPrompt(profileId, jobMeta.jdText || "", {
    jobTitle: jobMeta.jobTitle || "",
    companyName: jobMeta.companyName || "",
    masterResume: person.masterResume || "",
    roleTrack,
    sessionRoleTrack
  });

  await setStatus(
    `Row ${jobMeta.csvRow != null ? jobMeta.csvRow + " · " : ""}${jobMeta.companyName}: Track ${trackStatus} · opening ONE new ${providerLabel} chat…`
  );

  if (batchControl.skipCurrent || batchControl.stop) {
    throw new Error("__SKIP__");
  }

  // Step A: new chat + resume JSON (JD is already inside the prompt via {JD}).
  // After ChatGPT finishes, wait for the page "JSON ready" flag (set by the
  // content script after a settle delay) and generate files — do NOT spam
  // "not usable / retry" prompts when complete JSON is already on screen.
  lastUsableResumeData = null;
  const rowLabel = jobMeta.csvRow != null ? `${jobMeta.csvRow} · ` : "";
  let rawOutput = "";
  let resumeData = null;
  const promptStartedAt = Date.now();

  for (let attempt = 1; attempt <= MAX_JSON_ATTEMPTS; attempt += 1) {
    const isFirst = attempt === 1;

    // Before any follow-up prompt: settle + harvest. Never re-prompt if ready.
    if (!isFirst) {
      await setStatus(
        `Row ${rowLabel}${jobMeta.companyName}: waiting for JSON ready flag (no re-prompt yet)…`
      );
      const already = await waitForJsonReadyFlag(tab.id, {
        since: promptStartedAt,
        timeoutMs: 8000
      });
      if (isUsableResumeJson(already)) {
        resumeData = already;
        rawOutput = JSON.stringify(already);
        await setStatus(
          `Row ${rowLabel}${jobMeta.companyName}: JSON ready (${already.experience?.length || 0} jobs). Saving files…`
        );
        break;
      }
      // Still nothing usable — only then one clean re-prompt.
      const gapHint = describeResumeGaps(resumeData || already);
      await setStatus(
        `Row ${rowLabel}${jobMeta.companyName}: no ready JSON yet — one re-prompt (${attempt}/${MAX_JSON_ATTEMPTS})${
          gapHint ? ` [${gapHint}]` : ""
        }…`
      );
    }

    const retryPrompt = isFirst ? prompt : buildJsonRetryPrompt(resumeData);
    rawOutput = await automateChatGpt(tab.id, retryPrompt, {
      newChat: isFirst,
      expectResumeJson: true,
      statusLabel: isFirst
        ? `Chat 1/1 · resume JSON (${jobMeta.companyName || "job"})…`
        : `Same chat · retry resume JSON (${jobMeta.companyName || "job"})…`
    });

    if (batchControl.skipCurrent || batchControl.stop) {
      throw new Error("__SKIP__");
    }

    resumeData = extractResumeJson(rawOutput);
    if (
      !isUsableResumeJson(resumeData) &&
      !isMinimallySaveableResume(resumeData) &&
      (isUsableResumeJson(lastUsableResumeData) || isMinimallySaveableResume(lastUsableResumeData))
    ) {
      resumeData = lastUsableResumeData;
    }
    if (!isUsableResumeJson(resumeData) && !isMinimallySaveableResume(resumeData)) {
      await setStatus(
        `Row ${rowLabel}${jobMeta.companyName}: post-reply settle — checking JSON ready flag…`
      );
      const harvested = await waitForJsonReadyFlag(tab.id, {
        since: promptStartedAt,
        timeoutMs: 10000
      });
      if (isUsableResumeJson(harvested) || isMinimallySaveableResume(harvested)) {
        resumeData = harvested;
      }
    }
    // JSON markers on screen but still unusable → harvest harder, do NOT re-prompt
    // (re-prompts push the good JSON up the chat and make recognition worse).
    if (!isUsableResumeJson(resumeData) && !isMinimallySaveableResume(resumeData)) {
      const deep = await tryRecognizeResumeOnPage(tab.id);
      if (isUsableResumeJson(deep) || isMinimallySaveableResume(deep)) resumeData = deep;
    }
    if (isUsableResumeJson(resumeData) || isMinimallySaveableResume(resumeData)) break;

    // Missing fixed employers: allow a targeted re-prompt (do not treat as "JSON visible → done").
    const missingCos = missingExperienceCompanies(resumeData);
    if (missingCos.length && attempt < MAX_JSON_ATTEMPTS) {
      await setStatus(
        `Row ${rowLabel}${jobMeta.companyName}: experience missing ${missingCos.join(", ")} — re-prompting…`
      );
      continue;
    }

    // Only skip further re-prompt when there is resume-shaped JSON but the gap is
    // not a missing-employer issue (parse/stub problems harvest better than re-prompt).
    const pageHasJsonMarkers = /"experience"|"profile"|"technicalSummary"/.test(
      String(rawOutput || "")
    );
    if (pageHasJsonMarkers) {
      await setStatus(
        `Row ${rowLabel}${jobMeta.companyName}: JSON visible — skipping re-prompt, final harvest…`
      );
      break;
    }
  }

  if (!isUsableResumeJson(resumeData) && !isMinimallySaveableResume(resumeData)) {
    const lastChance = await waitForJsonReadyFlag(tab.id, {
      since: promptStartedAt,
      timeoutMs: 10000
    });
    if (isUsableResumeJson(lastChance) || isMinimallySaveableResume(lastChance)) {
      resumeData = lastChance;
    }
  }
  if (
    !isUsableResumeJson(resumeData) &&
    !isMinimallySaveableResume(resumeData) &&
    (isUsableResumeJson(lastUsableResumeData) || isMinimallySaveableResume(lastUsableResumeData))
  ) {
    resumeData = lastUsableResumeData;
  }
  if (!isUsableResumeJson(resumeData) && !isMinimallySaveableResume(resumeData)) {
    try {
      const stored = await chrome.storage.local.get([
        "chatgpt_harvested_resume",
        "last_resume_json"
      ]);
      if (isUsableResumeJson(stored.chatgpt_harvested_resume) || isMinimallySaveableResume(stored.chatgpt_harvested_resume)) {
        resumeData = stored.chatgpt_harvested_resume;
      } else if (isUsableResumeJson(stored.last_resume_json) || isMinimallySaveableResume(stored.last_resume_json)) {
        resumeData = stored.last_resume_json;
      }
    } catch {
      // ignore
    }
  }
  // JSON visibly on screen but still not accepted — keep deep-harvesting before ERROR.
  if (!isUsableResumeJson(resumeData) && !isMinimallySaveableResume(resumeData)) {
    await setStatus(
      `Row ${rowLabel}${jobMeta.companyName}: JSON still not accepted — final deep harvest…`
    );
    for (let i = 0; i < 5; i += 1) {
      const deep = await tryRecognizeResumeOnPage(tab.id);
      if (isUsableResumeJson(deep) || isMinimallySaveableResume(deep)) {
        resumeData = deep;
        break;
      }
      const fromRaw = extractResumeJson(rawOutput);
      if (isUsableResumeJson(fromRaw) || isMinimallySaveableResume(fromRaw)) {
        resumeData = fromRaw;
        break;
      }
      await sleep(1500);
    }
  }

  if (!isUsableResumeJson(resumeData) && !isMinimallySaveableResume(resumeData)) {
    throw new Error(describeUnusableResume(rawOutput, resumeData));
  }

  // ChatGPT drops JD-required Salesforce products even when the prompt forbids
  // it, and a person's saved prompt may predate that rule — enforce it here.
  {
    const jd = jobMeta.jdText || "";
    const required = jdRequiredSkills(jd, roleTrack);
    if (required.length) {
      resumeData = enforceJdSkills(resumeData, jd, roleTrack);
      await setStatus(`JD skills enforced (${trackStatus}): ${required.map((p) => p.name).join(", ")}`);

      const gaps = rolesMissingJdSkills(resumeData, jd, { roles: 2, minBullets: 2, roleTrack });
      if (gaps.length && !batchControl.skipCurrent && !batchControl.stop) {
        await setStatus(
          `Row ${rowLabel}${jobMeta.companyName}: ${gaps
            .map((g) => `${g.company} proves ${g.covered}/${g.need}`)
            .join(", ")} — one re-prompt for JD-skill bullets…`
        );
        try {
          const bulletsRaw = await automateChatGpt(
            tab.id,
            buildJdSkillsRetryPrompt(resumeData, jd, { roles: 2, minBullets: 3, roleTrack }),
            {
              newChat: false,
              expectResumeJson: true,
              statusLabel: `Same chat · JD-skill bullets (${jobMeta.companyName || "job"})…`
            }
          );
          const improved = enforceJdSkills(extractResumeJson(bulletsRaw), jd, roleTrack);
          if (isUsableResumeJson(improved) || isMinimallySaveableResume(improved)) {
            const before = rolesMissingJdSkills(resumeData, jd, { roles: 2, minBullets: 2, roleTrack }).length;
            const after = rolesMissingJdSkills(improved, jd, { roles: 2, minBullets: 2, roleTrack }).length;
            if (after <= before && totalExperienceBullets(improved) >= totalExperienceBullets(resumeData) * 0.8) {
              resumeData = improved;
              await setStatus(
                after === 0
                  ? "JD-skill bullets added to both recent roles."
                  : `JD-skill bullets improved (${before} → ${after} roles short).`
              );
            } else {
              await setStatus("Re-prompt was weaker than the original — keeping the first resume.");
            }
          }
        } catch (err) {
          await setStatus(`JD-skill re-prompt skipped (${err?.message || "failed"}). Keeping resume.`);
        }
      }
    }
  }

  // Local ATS badge: deterministic keyword weave, then up to 2 ChatGPT retries until ≥90.
  const atsJd = jobMeta.jdText || "";
  const atsTitle = jobMeta.jobTitle || jobMeta.title || "";
  let atsEvaluation = evaluateAtsScore(resumeData, { jdText: atsJd, jobTitle: atsTitle, roleTrack });
  {
    let boostPass = 0;
    while (atsEvaluation.score < ATS_TARGET_SCORE && boostPass < 2) {
      const boosted = boostResumeForAts(resumeData, { jdText: atsJd, jobTitle: atsTitle, roleTrack });
      if (!boosted.changed || boosted.evaluation.score < atsEvaluation.score) break;
      resumeData = boosted.data;
      atsEvaluation = boosted.evaluation;
      boostPass += 1;
      await setStatus(
        `ATS boost applied → ${atsEvaluation.score}/100 (${atsEvaluation.grade}).`
      );
      if (atsEvaluation.score >= ATS_TARGET_SCORE) break;
    }
  }
  const maxAtsRetries = 2;
  for (
    let atsAttempt = 1;
    atsAttempt <= maxAtsRetries &&
    atsEvaluation.score < ATS_TARGET_SCORE &&
    !batchControl.skipCurrent &&
    !batchControl.stop;
    atsAttempt += 1
  ) {
    if (!atsEvaluation.missingKeywords?.length && !atsEvaluation.missingProducts?.length) break;
    await setStatus(
      `Row ${rowLabel}${jobMeta.companyName}: ATS ${atsEvaluation.score}/100 — re-prompt ${atsAttempt}/${maxAtsRetries} for ${ATS_TARGET_SCORE}+…`
    );
    try {
      const atsRaw = await automateChatGpt(
        tab.id,
        buildAtsScoreRetryPrompt(resumeData, atsEvaluation, { jdText: atsJd, jobTitle: atsTitle, roleTrack }),
        {
          newChat: false,
          expectResumeJson: true,
          statusLabel: `Same chat · ATS keyword boost (${jobMeta.companyName || "job"})…`
        }
      );
      let improved = enforceJdSkills(extractResumeJson(atsRaw), atsJd, roleTrack);
      const improvedBoost = boostResumeForAts(improved, { jdText: atsJd, jobTitle: atsTitle, roleTrack });
      if (improvedBoost.changed) improved = improvedBoost.data;
      const improvedEval = improvedBoost.evaluation;
      if (
        (isUsableResumeJson(improved) || isMinimallySaveableResume(improved)) &&
        improvedEval.score >= atsEvaluation.score
      ) {
        resumeData = improved;
        atsEvaluation = improvedEval;
        await setStatus(
          `ATS re-prompt ${atsAttempt} → ${atsEvaluation.score}/100 (${atsEvaluation.grade}).`
        );
      } else {
        await setStatus(`ATS re-prompt ${atsAttempt} did not improve score — keeping prior resume.`);
        break;
      }
    } catch (err) {
      await setStatus(`ATS re-prompt skipped (${err?.message || "failed"}). Keeping resume.`);
      break;
    }
  }
  if (jobMeta.csvRow != null) {
    await updateQueueJob(jobMeta.csvRow, {
      atsScore: atsEvaluation.score,
      atsGrade: atsEvaluation.grade,
      atsEvaluation
    });
  }
  await setStatus(
    `JSON accepted (${resumeData.name || "ok"}) · ATS ${atsEvaluation.score}/100 (${atsEvaluation.grade}). Saving jd.txt + PDF…`
  );

  // Save JD + resume immediately (before cover letter), same chat continues after.
  const enrichedMeta = {
    ...jobMeta,
    templateId: await pickTemplateId(jobMeta, person),
    resumeFilePrefix: jobMeta.resumeFilePrefix || person.resumeFilePrefix || "Resume"
  };

  const result = await saveResumeAndCoverLetter(
    tab.id,
    JSON.stringify(resumeData, null, 2),
    resumeData,
    enrichedMeta,
    { runCoverLetter: true }
  );

  // Confirm at least jd.txt landed in Downloads.
  try {
    const found = await chrome.downloads.search({
      query: [result.savedDir.split("/").pop() || "jd.txt"],
      limit: 5,
      orderBy: ["-startTime"]
    });
    if (!found?.length) {
      await setStatus(
        `${result.status} — WARNING: Chrome Downloads may have blocked files. Check the Downloads shelf / allow downloads.`
      );
    }
  } catch {
    // ignore
  }

  // Capture conversation id now; chat is deleted later during inter-job cooldown.
  let aiChatId = await readAiConversationId(tab.id, provider);
  if (!aiChatId) {
    for (let i = 0; i < 10 && !aiChatId; i += 1) {
      await sleep(400);
      aiChatId = await readAiConversationId(tab.id, provider);
    }
  }
  if (aiChatId) {
    await chrome.storage.local
      .set({ last_ai_chat_id: aiChatId, last_ai_provider: provider })
      .catch(() => {});
  }

  return { ...result, atsEvaluation, aiTabId: tab.id, aiChatId, aiProvider: provider };
}

async function runBatchLoop(outputDir) {
  batchControl = { pauseAfterCurrent: false, skipCurrent: false, stop: false, forceProceed: false };
  rateLimitHitsThisBatch = 0;
  await refreshPacingCache();
  await setBatchState("running");
  await chrome.storage.local.set({
    generation_running: true,
    batch_output_dir: outputDir || (await resolveOutputDir()),
    generation_heartbeat: Date.now()
  });
  startKeepAlive();

  try {
    await setStatus(
      `${aiProviderLabel(await getStoredAiProvider())} pacing: ~${pacingCache.jobGapSeconds}s between jobs (hard-pause after ${pacingCache.hardPauseAfterHits} rate limits).`
    );
    const dedupe = await dedupeQueueAgainstSheet({ notifySlack: true });
    if (dedupe.skipped > 0) {
      await setStatus(
        `Skipped ${dedupe.skipped} duplicate(s) before generate. Continuing with remaining jobs…`
      );
    } else if (dedupe.error) {
      await setStatus(
        `Sheet duplicate check failed (${dedupe.error}). Continuing with in-queue dedupe…`
      );
    }

    while (!batchControl.stop) {
      if (batchControl.pauseAfterCurrent) {
        batchControl.pauseAfterCurrent = false;
        await setBatchState("paused");
        await setStatus("Batch paused. Click Start/Resume to continue.");
        await chrome.storage.local.set({ generation_running: false });
        return;
      }

      const queue = await getQueue();
      const activePerson = await getActivePerson().catch(() => null);
      const batchAutoApply = await isBatchAutoApplyEnabled();

      // Hosted Dice/Indeed/Workday/Greenhouse/Jobgether jobs: apply already-built rows that are not Applied yet (no ChatGPT).
      // Gated by job type, not the visible source filter — except All channel (build only).
      // Only the active person's rows (profileId / Applications-* folder).
      const backlog = batchAutoApply
        ? queue.find((j) => isHostedApplyBacklogJob(j, activePerson))
        : null;
      if (backlog) {
        const backlogBoard = isIndeedHostedApplyJob(backlog)
          ? "Indeed"
          : isWorkdayJob(backlog)
            ? "Workday"
            : isGreenhouseJob(backlog)
              ? "Greenhouse"
              : isAshbyJob(backlog)
                ? "Ashby"
                : isLeverJob(backlog)
                  ? "Lever"
                  : isJobgetherJob(backlog)
                    ? "Jobgether"
                    : "Dice";
        if (batchControl.skipCurrent) {
          batchControl.skipCurrent = false;
          await updateQueueJob(backlog.csvRow, {
            applied: false,
            applyAttempted: true,
            applyAttempts: Number(backlog.applyAttempts || 0) + 1,
            error: `Skipped during ${backlogBoard} apply backlog`
          });
          continue;
        }
        await setStatus(
          `${backlogBoard} auto-apply: row ${backlog.csvRow} — ${backlog.company} / ${backlog.title}`
        );
        const applyRes = await runHostedInterleavedApply({
          csvRow: backlog.csvRow,
          jobTitle: backlog.title,
          companyName: backlog.company,
          company: backlog.company,
          title: backlog.title,
          jdLink: backlog.jdLink || "",
          salary: backlog.salary || "",
          jobDir: backlog.jobDir || "",
          profileId: activePerson?.id || backlog.profileId || "",
          applyAttempts: hostedApplyAttemptCount(backlog)
        }, backlogBoard);
        if (batchControl.stop) break;
        if (applyRes?.needsPause) {
          await pauseAfterFailedHostedApply(applyRes, backlog.csvRow);
          return;
        }
        if (String(applyRes?.status || "") !== "submitted") {
          // Exhausted or unavailable — continue to next work item.
          await setStatus(
            `Cooling down ${Math.round(currentJobGapMs() / 1000)}s before next job…`
          );
          await sleep(currentJobGapMs());
          continue;
        }
        await setStatus(
          `Cooling down ${Math.round(currentJobGapMs() / 1000)}s before next job…`
        );
        await sleep(currentJobGapMs());
        continue;
      }

      // Fresh rows first, then rows that errored but still have retries left.
      // Rows at the attempt ceiling become "failed" and are never re-picked, so
      // the loop always terminates.
      const next =
        queue.find((j) => j.status === "pending" && !isJobMarkedInactive(j)) ||
        queue.find(
          (j) =>
            j.status === "error" &&
            Number(j.attempts || 0) < MAX_JOB_ATTEMPTS &&
            !isJobMarkedInactive(j)
        );
      if (!next) {
        const done = queue.filter((j) => j.status === "done").length;
        const failedJobs = queue.filter((j) => j.status === "failed" || j.status === "error");
        const failed = failedJobs.length;
        const skipped = queue.filter((j) => j.status === "skipped").length;
        await setBatchState("idle");
        let statusMsg = failed
          ? `Batch complete — ${done} saved, ${failed} failed (use Start to retry failed rows).`
          : "Batch complete — no pending US jobs left.";

        try {
          const cfg = await chrome.storage.local.get(["slack_webhook_url"]);
          if (String(cfg.slack_webhook_url || "").trim()) {
            await setStatus("Notifying Slack…");
            await trySlackBatchComplete({
              done,
              failed,
              skipped,
              total: queue.length,
              outputDir: outputDir || (await resolveOutputDir()),
              errors: failedJobs.map((j) => ({
                csvRow: j.csvRow,
                company: j.company,
                title: j.title,
                error: j.error || j.status,
                status: j.status
              }))
            });
            statusMsg = `${statusMsg} Slack notified.`;
          }
        } catch (slackErr) {
          statusMsg = `${statusMsg} Slack notify failed: ${String(slackErr?.message || slackErr)}`;
        }

        await setStatus(statusMsg);
        await chrome.storage.local.set({ generation_running: false });
        return;
      }

      if (!String(next.jdText || "").trim()) {
        await updateQueueJob(next.csvRow, {
          status: "error",
          error: "Empty job description in CSV"
        });
        continue;
      }

      // Validate duplicates BEFORE ChatGPT — do not build a resume we will skip.
      const preSkipReason = await getPreGenerateSkipReason({
        csvRow: next.csvRow,
        companyName: next.company,
        company: next.company,
        jdLink: next.jdLink || ""
      });
      if (preSkipReason) {
        await markJobSkippedAsDuplicate(next.csvRow, preSkipReason);
        await setStatus(
          `Row ${next.csvRow}: skipped before generate (${preSkipReason}). Continuing…`
        );
        continue;
      }

      await updateQueueJob(next.csvRow, { status: "running", error: "" });
      await setStatus(`Batch: generating row ${next.csvRow} — ${next.company} / ${next.title}`);

      // Cool down before opening a new chat if ChatGPT already rate-limited us.
      try {
        const provider = await getStoredAiProvider();
        const tab = await ensureAiTab(provider);
        if (tab?.id && provider === AI_PROVIDERS.CHATGPT) {
          await waitOutChatGptRateLimit(tab.id);
        }
      } catch (preErr) {
        const preMsg = String(preErr?.message || preErr);
        if (preMsg === "__RATE_LIMIT_PAUSE__") {
          await updateQueueJob(next.csvRow, {
            status: "pending",
            error: "AI rate limit — batch paused for cool-down"
          });
          return;
        }
        if (preMsg === "__SKIP__") {
          batchControl.skipCurrent = false;
          await updateQueueJob(next.csvRow, { status: "skipped", error: "" });
          continue;
        }
        if (/rate limit/i.test(preMsg)) {
          await updateQueueJob(next.csvRow, {
            status: "pending",
            error: "Waiting for AI rate limit to clear"
          });
          await setBatchState("paused");
          await setStatus(
            "Batch paused: AI rate limit. Wait a few minutes, then click Start / Retry errors."
          );
          await chrome.storage.local.set({ generation_running: false });
          return;
        }
      }

      const jobMeta = {
        csvRow: next.csvRow,
        jobTitle: next.title,
        companyName: next.company,
        jdLink: next.jdLink || "",
        jdText: next.jdText || "",
        salary: next.salary || "",
        outputDir: outputDir || (await resolveOutputDir())
      };

      try {
        if (batchControl.skipCurrent) {
          batchControl.skipCurrent = false;
          await updateQueueJob(next.csvRow, { status: "skipped", error: "" });
          continue;
        }

        const result = await runAutoJob(jobMeta);

        if (batchControl.skipCurrent) {
          batchControl.skipCurrent = false;
          await updateQueueJob(next.csvRow, { status: "skipped", error: "Skipped during run" });
          continue;
        }

        await updateQueueJob(next.csvRow, {
          status: "done",
          jobDir: result.savedDir,
          profileId: activePerson?.id || next.profileId || "",
          atsScore: result.atsEvaluation?.score ?? null,
          atsGrade: result.atsEvaluation?.grade || "",
          atsEvaluation: result.atsEvaluation || null,
          error: ""
        });
        await rememberApplyHistory(next.csvRow, {
          jobDir: result.savedDir,
          jdLink: next.jdLink || "",
          status: "done",
          title: next.title,
          company: next.company
        });
        await setStatus(`Done row ${next.csvRow}. ${result.status}`);

        // Hosted Dice, Indeed, Workday, Greenhouse, and Jobgether jobs: generate → auto-apply+submit → close tab → next.
        // All channel: generate files only — no auto-apply.
        const hostedApplyBoard = batchAutoApply
          ? isIndeedHostedApplyJob(next)
            ? "Indeed"
            : isWorkdayJob(next)
              ? "Workday"
              : isGreenhouseJob(next)
                ? "Greenhouse"
                : isAshbyJob(next)
                  ? "Ashby"
                  : isLeverJob(next)
                    ? "Lever"
                    : isJobgetherJob(next)
                      ? "Jobgether"
                      : isDiceJob(next)
                        ? "Dice"
                        : ""
          : "";
        if (hostedApplyBoard && !batchControl.stop) {
          const applyRes = await runHostedInterleavedApply({
            csvRow: next.csvRow,
            jobTitle: next.title,
            companyName: next.company,
            company: next.company,
            title: next.title,
            jdLink: next.jdLink || "",
            salary: next.salary || "",
            jobDir: result.savedDir || "",
            profileId: activePerson?.id || next.profileId || "",
            applyAttempts: hostedApplyAttemptCount(next)
          }, hostedApplyBoard);
          if (applyRes?.needsPause) {
            await pauseAfterFailedHostedApply(applyRes, next.csvRow);
            return;
          }
        }

        if (batchControl.stop) {
          await cooldownBeforeNextJob({
            aiTabId: result?.aiTabId,
            aiChatId: result?.aiChatId || "",
            reason: "stop"
          });
          break;
        }

        await cooldownBeforeNextJob({
          aiTabId: result?.aiTabId,
          aiChatId: result?.aiChatId || "",
          reason: "next job (rate-limit protection)"
        });
      } catch (err) {
        const msg = String(err?.message || err);
        if (msg.startsWith("__DUPLICATE_SKIP__:")) {
          const reason = msg.slice("__DUPLICATE_SKIP__:".length) || "duplicate job link";
          await markJobSkippedAsDuplicate(next.csvRow, reason);
          await setStatus(
            `Row ${next.csvRow}: skipped before generate (${reason}). Continuing…`
          );
          continue;
        }
        if (msg.startsWith("__INACTIVE_SKIP__:")) {
          const reason = msg.slice("__INACTIVE_SKIP__:".length) || "inactive job";
          await markJobSkippedAsInactive(next.csvRow, reason, {
            csvRow: next.csvRow,
            jobTitle: next.title,
            companyName: next.company,
            jdLink: next.jdLink || ""
          });
          await setStatus(`Row ${next.csvRow}: inactive job — skipped before generate. Continuing…`);
          continue;
        }
        if (msg === "__RATE_LIMIT_PAUSE__") {
          await updateQueueJob(next.csvRow, {
            status: "pending",
            error: "ChatGPT rate limit — batch paused for cool-down"
          });
          return;
        }
        if (msg === "__SKIP__" || batchControl.skipCurrent) {
          batchControl.skipCurrent = false;
          await updateQueueJob(next.csvRow, { status: "skipped", error: "" });
          continue;
        }
        if (batchControl.stop) {
          await cooldownBeforeNextJob({
            aiTabId: null,
            aiChatId: "",
            reason: "stop"
          });
          break;
        }

        // Only a global blocker (no ChatGPT tab / signed out) pauses the batch.
        // Anything row-specific must not stop the remaining jobs.
        if (/Open (ChatGPT|Claude|AI) in a browser tab first/i.test(msg) || /No (ChatGPT|Claude) tab open/i.test(msg)) {
          await updateQueueJob(next.csvRow, {
            status: "pending",
            error: "Waiting for an AI tab"
          });
          await setBatchState("paused");
          await setStatus(`Batch paused: ${msg}`);
          await chrome.storage.local.set({ generation_running: false });
          await trySlackAlert({
            title: "Batch paused ⛔",
            message: msg,
            csvRow: next.csvRow,
            company: next.company,
            jobTitle: next.title
          });
          return;
        }

        // Rate limit: keep pending (do not burn attempts) and cool down.
        if (/rate limit|too many requests|requests too quickly|temporarily limited/i.test(msg)) {
          lastRateLimitHitAt = Date.now();
          rateLimitHitsThisBatch += 1;
          await updateQueueJob(next.csvRow, {
            status: "pending",
            error: "ChatGPT rate limit — will retry after cooldown"
          });
          if (await maybeHardPauseForRateLimit(msg.slice(0, 120))) {
            return;
          }
          await setStatus(
            `Row ${next.csvRow}: ChatGPT rate limit. Waiting ~${formatWaitLeft(RATE_LIMIT_BASE_WAIT_MS)}, then continuing…`
          );
          await sleep(RATE_LIMIT_BASE_WAIT_MS);
          continue;
        }

        const attempts = Number(next.attempts || 0) + 1;
        const exhausted = attempts >= MAX_JOB_ATTEMPTS;
        await updateQueueJob(next.csvRow, {
          status: exhausted ? "failed" : "error",
          attempts,
          error: msg.slice(0, 240)
        });
        await setStatus(
          exhausted
            ? `Row ${next.csvRow} failed after ${attempts} attempts: ${msg}. Moving to the next job…`
            : `Row ${next.csvRow} error (attempt ${attempts}/${MAX_JOB_ATTEMPTS}): ${msg}. Continuing…`
        );
        await trySlackJobStatus({
          outcome: exhausted ? "failed" : "error",
          csvRow: next.csvRow,
          company: next.company,
          jobTitle: next.title,
          jdLink: next.jdLink || "",
          message: msg,
          attempts,
          maxAttempts: MAX_JOB_ATTEMPTS,
          progress: await queueSlackProgress()
        });
        await cooldownBeforeNextJob({
          aiTabId: null,
          aiChatId: "",
          reason: "next job after error"
        });
        continue;
      }

      if (batchControl.pauseAfterCurrent) {
        batchControl.pauseAfterCurrent = false;
        await setBatchState("paused");
        await setStatus("Batch paused after current job. Click Start to resume.");
        await chrome.storage.local.set({ generation_running: false });
        return;
      }
    }

    await setBatchState("idle");
    await setStatus("Batch stopped.");
  } finally {
    isRunning = false;
    stopKeepAlive();
    await chrome.storage.local.set({ generation_running: false });
    if (!batchControl.stop) {
      const state = (await chrome.storage.local.get(BATCH_STATE_KEY))[BATCH_STATE_KEY];
      if (state === "running") await setBatchState("idle");
    } else {
      await setBatchState("idle");
    }
  }
}

async function revealJobFiles({ csvRow, jobDir, jdLink }) {
  const located = await locateJobFolder({ csvRow, jobDir, jdLink }).catch(() => null);
  let filenamePrefix = located?.jobDir || jobDir || "";
  if (!filenamePrefix && csvRow != null) {
    const hist = (await chrome.storage.local.get(APPLY_HISTORY_KEY))[APPLY_HISTORY_KEY] || {};
    filenamePrefix = hist[String(csvRow)]?.jobDir || "";
  }
  if (!filenamePrefix) {
    const queue = await getQueue();
    const job = queue.find((j) => Number(j.csvRow) === Number(csvRow));
    filenamePrefix = job?.jobDir || "";
  }
  if (!filenamePrefix) {
    throw new Error("No saved folder for this job yet. Generate it first.");
  }

  if (csvRow != null && filenamePrefix) {
    await updateQueueJob(csvRow, { jobDir: filenamePrefix, hasFiles: true }).catch(() => {});
    await rememberApplyHistory(csvRow, { jobDir: filenamePrefix, jdLink: jdLink || "" }).catch(() => {});
  }

  await persistJobContextForAutofill({ csvRow, jobDir: filenamePrefix, jdLink: jdLink || "" });
  await resolveUploadDocs({ csvRow, jobDir: filenamePrefix, jdLink: jdLink || "" }).catch(() => null);

  const results = await chrome.downloads.search({
    filenameRegex: filenamePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\//g, "[\\\\/]") + ".*",
    limit: 20,
    orderBy: ["-startTime"]
  });

  if (!results?.length) {
    // Fallback: search by path segment
    const segment = filenamePrefix.split("/").pop();
    const loose = await chrome.downloads.search({
      query: [segment],
      limit: 20,
      orderBy: ["-startTime"]
    });
    if (!loose?.length) {
      throw new Error(`No downloads found under ${filenamePrefix}`);
    }
    await chrome.downloads.show(loose[0].id);
    return { shown: loose[0].filename };
  }

  await chrome.downloads.show(results[0].id);
  return { shown: results[0].filename };
}

async function autofillActiveTab(tabId = null) {
  if (!(await isAutofillEnabled())) {
    throw new Error("Autofill is disabled. Turn it on in Apply assist.");
  }
  return startAutofillOnTab(tabId);
}

async function findActiveIndeedTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const active = tabs[0];
  if (active?.id && isIndeedUrl(active.url)) return active;
  const all = await chrome.tabs.query({ url: ["https://*.indeed.com/*", "https://indeed.com/*"] });
  const focused = all.find((t) => t.active) || all[0];
  if (!focused?.id) {
    throw new Error("Open an Indeed job tab first (select a listing so the details pane is visible).");
  }
  return focused;
}

async function scrapeIndeedJobFromTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ["content/autofill.js"]
    });
  } catch {
    // Already injected.
  }
  await sleep(200);
  const result = await chrome.tabs.sendMessage(tabId, { type: "scrape_job_page" });
  if (!result?.ok || !result.jobData) {
    throw new Error(result?.error || "Could not read the selected Indeed job.");
  }
  return result.jobData;
}

async function enqueueIndeedGrabbedJob(raw) {
  const data = await chrome.storage.local.get([
    ALL_US_JOBS_KEY,
    QUEUE_KEY,
    REMOVED_JOB_IDENTITIES_KEY
  ]);
  const previousAll = Array.isArray(data[ALL_US_JOBS_KEY]) ? data[ALL_US_JOBS_KEY] : [];
  const previousQueue = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
  const removedIdentities = new Set(
    Array.isArray(data[REMOVED_JOB_IDENTITIES_KEY])
      ? data[REMOVED_JOB_IDENTITIES_KEY].map(String)
      : []
  );
  const nextRow =
    previousAll.reduce((max, job) => Math.max(max, Number(job?.csvRow || 0)), 0) + 1;
  const hosted = Boolean(raw.applyOnIndeed || raw.indeedApplyOnSite || raw.hostedApply);
  let candidate = normalizeIndeedCapturedJob(
    {
      title: raw.jobTitle || raw.title || "",
      company: raw.companyName || raw.company || "",
      jdLink: raw.jdLink || raw.applyLink || "",
      jdText: raw.jdText || "",
      location: raw.jobLocation || raw.location || "",
      salary: raw.salaryRaw || [raw.salaryMin, raw.salaryMax].filter(Boolean).join(" - "),
      remoteRestrictedTo: /remote/i.test(String(raw.workArrangement || raw.jobLocation || ""))
        ? "United States"
        : "",
      isRemote: /remote/i.test(String(raw.workArrangement || raw.jobLocation || "")),
      applyOnIndeed: hosted,
      indeedApplyOnSite: hosted,
      hostedApply: hosted,
      externalApply: !hosted,
      applyEvidence: hosted ? "hosted" : "unknown",
      source: "indeed"
    },
    nextRow
  );
  if (!candidate.title || !candidate.jdLink) {
    throw new Error("Indeed page is missing a job title or link. Select a job in the results pane first.");
  }
  if (!candidate.jdText || candidate.jdText.length < 40) {
    throw new Error("Indeed job description looks empty. Wait for the details pane to finish loading.");
  }
  if (removedIdentities.has(jobIdentity(candidate))) {
    throw new Error("That job was previously removed from the queue.");
  }
  const prior = previousAll.find((j) => jobIdentity(j) === jobIdentity(candidate));
  if (prior) {
    candidate = {
      ...prior,
      ...candidate,
      csvRow: prior.csvRow,
      status: prior.status === "done" || prior.applied ? prior.status : "pending",
      attempts: prior.attempts || 0,
      jobDir: prior.jobDir || "",
      applied: Boolean(prior.applied)
    };
  }
  const incoming = prior
    ? previousAll.map((j) => (jobIdentity(j) === jobIdentity(candidate) ? candidate : j))
    : [...previousAll, candidate];
  const merged = mergeParsedJobs(previousAll, previousQueue, incoming);
  const filtered = filterJobsByChannel(merged.allUsJobs, "indeed");
  await chrome.storage.local.set({
    [ALL_US_JOBS_KEY]: merged.allUsJobs,
    [QUEUE_KEY]: filtered,
    [JOB_CHANNEL_FILTER_KEY]: "indeed",
    csv_file_name: "Indeed selected job",
    csv_total_rows: merged.allUsJobs.length
  });
  return {
    job: filtered.find((j) => jobIdentity(j) === jobIdentity(candidate)) || candidate,
    duplicated: Boolean(prior)
  };
}

/** Grab selected Indeed job → resume/sheet → optional full auto-apply. */
async function runIndeedGrabAndApply({ autoApply = true } = {}) {
  if (isRunning) throw new Error("Pause the generation/apply batch before grabbing an Indeed job.");
  isRunning = true;
  startKeepAlive();
  const setGrab = (status, message) =>
    chrome.storage.local
      .set({ indeed_grab_status: { status, message, updatedAt: Date.now() } })
      .catch(() => {});
  await chrome.storage.local.set({ generation_running: true });
  await setGrab("running", autoApply ? "Grabbing → resume → auto-apply…" : "Grabbing into queue…");
  try {
    const tab = await findActiveIndeedTab();
    await setStatus("Indeed: reading the selected job…");
    const scraped = await scrapeIndeedJobFromTab(tab.id);
    const { job, duplicated } = await enqueueIndeedGrabbedJob(scraped);
    const hosted = isIndeedHostedApplyJob(job) || isExplicitlyHostedIndeedJob(scraped);
    await setStatus(
      duplicated
        ? `Indeed: refreshed ${job.title} @ ${job.company} (already in queue)`
        : `Indeed: grabbed ${job.title} @ ${job.company}`
    );

    if (job.status === "done" && job.applied) {
      await setStatus(`Indeed: ${job.company} / ${job.title} already applied.`);
      await setGrab("idle", `Already applied — ${job.company} / ${job.title}`);
      return { ok: true, job, skipped: true, reason: "already-applied" };
    }

    let result = null;
    if (job.status !== "done" || !job.jobDir) {
      const preSkipReason = await getPreGenerateSkipReason({
        csvRow: job.csvRow,
        companyName: job.company,
        company: job.company,
        jdLink: job.jdLink || ""
      });
      if (preSkipReason) {
        await markJobSkippedAsDuplicate(job.csvRow, preSkipReason);
        await setStatus(`Indeed: skipped before generate — ${preSkipReason}`);
        await setGrab("idle", `Skipped — ${preSkipReason}`);
        return { ok: true, job, skipped: true, reason: preSkipReason };
      }

      await updateQueueJob(job.csvRow, { status: "running", error: "" });
      const person = await getActivePerson();
      try {
        result = await runAutoJob({
          csvRow: job.csvRow,
          jobTitle: job.title,
          companyName: job.company,
          jdLink: job.jdLink,
          jdText: job.jdText || "",
          salary: job.salary || "",
          outputDir: await resolveOutputDir(),
          templateId: await pickTemplateId({}, person),
          resumeFilePrefix: person.resumeFilePrefix || "Resume",
          profileId: person.id,
          bidSource: "indeed-grab"
        });
      } catch (genErr) {
        const genMsg = String(genErr?.message || genErr);
        if (genMsg.startsWith("__DUPLICATE_SKIP__:")) {
          const reason = genMsg.slice("__DUPLICATE_SKIP__:".length) || "duplicate job link";
          await markJobSkippedAsDuplicate(job.csvRow, reason);
          await setStatus(`Indeed: skipped before generate — ${reason}`);
          await setGrab("idle", `Skipped — ${reason}`);
          return { ok: true, job, skipped: true, reason };
        }
        if (genMsg.startsWith("__INACTIVE_SKIP__:")) {
          const reason = genMsg.slice("__INACTIVE_SKIP__:".length) || "inactive job";
          await markJobSkippedAsInactive(job.csvRow, reason, {
            csvRow: job.csvRow,
            jobTitle: job.title,
            companyName: job.company,
            jdLink: job.jdLink || ""
          });
          await setStatus(`Indeed: inactive job — skipped before generate.`);
          await setGrab("idle", `Inactive — ${job.company} / ${job.title}`);
          return { ok: true, job, skipped: true, reason, inactive: true };
        }
        throw genErr;
      }
      await updateQueueJob(job.csvRow, {
        status: "done",
        jobDir: result.savedDir,
        profileId: person.id,
        atsScore: result.atsEvaluation?.score ?? null,
        atsGrade: result.atsEvaluation?.grade || "",
        atsEvaluation: result.atsEvaluation || null,
        error: ""
      });
      await setStatus(`Indeed: resume saved for ${job.company} / ${job.title}.`);
      if (result?.aiTabId) {
        if (autoApply) {
          // Clean chat now; don't burn the full inter-job gap before Apply.
          try {
            await deleteCurrentAiConversation(result.aiTabId, { chatId: result.aiChatId || "" });
          } catch (cleanupErr) {
            await setStatus(
              `Indeed: files ready; chat cleanup skipped: ${String(cleanupErr?.message || cleanupErr)}`
            );
          }
        } else {
          await cooldownBeforeNextJob({
            aiTabId: result.aiTabId,
            aiChatId: result.aiChatId || "",
            reason: "next action"
          });
        }
      }
    }

    if (!autoApply) {
      await setGrab("idle", `Queued — ${job.company} / ${job.title}`);
      return { ok: true, job, result, applied: false };
    }
    if (!hosted) {
      await setStatus(
        `Indeed: files ready for ${job.company} — external ATS (not Apply-on-Indeed). Use Apply manually.`
      );
      await setGrab("idle", `External ATS — ${job.company} / ${job.title}`);
      return { ok: true, job, result, applied: false, external: true };
    }

    const applyRes = await runHostedInterleavedApply(
      {
        csvRow: job.csvRow,
        jobTitle: job.title,
        companyName: job.company,
        company: job.company,
        jdLink: job.jdLink,
        jobDir: result?.savedDir || job.jobDir || "",
        applyAttempts: job.applyAttempts || 0
      },
      "Indeed"
    );
    await setGrab(
      "idle",
      applyRes?.status === "applied"
        ? `Applied — ${job.company} / ${job.title}`
        : `Finished — ${job.company} / ${job.title}`
    );
    return { ok: true, job, result, applyRes, applied: applyRes?.status === "applied" };
  } catch (err) {
    await setGrab("error", String(err?.message || err));
    throw err;
  } finally {
    isRunning = false;
    stopKeepAlive();
    await chrome.storage.local.set({ generation_running: false });
    const latest = (await chrome.storage.local.get("indeed_grab_status")).indeed_grab_status;
    if (latest?.status === "running") {
      await setGrab("idle", "Select a job on Indeed, then grab it.");
    }
  }
}

/** Ensure the CSV poll alarm matches current settings. */
async function syncCsvSourceAlarm() {
  const settings = await getCsvSourceSettings();
  const need =
    settings.urlEnabled ||
    settings.pinEnabled ||
    settings.nativeEnabled;
  try {
    await chrome.alarms.clear(CSV_SOURCE_ALARM);
  } catch {
    // ignore
  }
  if (!need) return { scheduled: false };
  const minutes = clampPollMinutes(settings.pollMinutes);
  await chrome.alarms.create(CSV_SOURCE_ALARM, { periodInMinutes: minutes });
  return { scheduled: true, minutes };
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error("Offscreen API unavailable in this Chrome build.");
  }
  try {
    const contexts = await chrome.runtime.getContexts?.({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    if (Array.isArray(contexts) && contexts.length) return;
  } catch {
    // getContexts may be missing — try create and ignore "already exists"
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DOM_SCRAPING"],
      justification: "Read pinned jobs CSV via File System Access API"
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/already|exists/i.test(msg)) throw err;
  }
}

async function readPinnedCsvViaOffscreen() {
  await ensureOffscreenDocument();
  // Brief settle so the offscreen listener is registered.
  await new Promise((r) => setTimeout(r, 50));
  const result = await chrome.runtime.sendMessage({ type: "offscreen_read_pinned_csv" });
  if (result == null) {
    throw new Error("Offscreen CSV reader did not respond.");
  }
  return result;
}

async function fetchCsvFromUrl(url) {
  const target = String(url || "").trim();
  if (!target) throw new Error("CSV URL is empty.");
  const res = await fetch(target, { cache: "no-store" });
  if (!res.ok) throw new Error(`CSV URL HTTP ${res.status}`);
  const text = await res.text();
  if (!String(text || "").trim()) throw new Error("CSV URL returned empty body.");
  let fileName = "jobs_url.csv";
  try {
    fileName = decodeURIComponent(target.split("?")[0].split("/").pop() || fileName);
  } catch {
    // keep default
  }
  return { text, fileName };
}

let nativePort = null;
let nativeWatchPath = "";

function disconnectNativePort() {
  try {
    nativePort?.disconnect();
  } catch {
    // ignore
  }
  nativePort = null;
}

function connectNativeHost({ path = "" } = {}) {
  if (!chrome.runtime.connectNative) {
    throw new Error("Native Messaging not available.");
  }
  disconnectNativePort();
  nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  nativePort.onMessage.addListener((msg) => {
    handleNativeCsvMessage(msg).catch(async (err) => {
      await saveCsvSourceSettings({
        lastStatus: `Native message error: ${String(err?.message || err)}`
      }).catch(() => {});
    });
  });
  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message || "disconnected";
    nativePort = null;
    saveCsvSourceSettings({ lastStatus: `Native host: ${err}` }).catch(() => {});
  });
  if (path) {
    nativeWatchPath = path;
    nativePort.postMessage({ type: "watch", path });
  } else {
    nativePort.postMessage({ type: "ping" });
  }
  return nativePort;
}

async function handleNativeCsvMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  const type = String(msg.type || "");
  if (type === "csv_update" && msg.text) {
    await ingestCsvText({
      text: msg.text,
      fileName: msg.fileName || "jobs_native.csv",
      source: "native",
      autoStart: false,
      force: false
    });
    return;
  }
  if (type === "file" || type === "job_docs" || type === "job_folders") {
    return;
  }
  if (type === "status" || type === "pong") {
    await saveCsvSourceSettings({
      lastStatus: msg.watching
        ? `Native watching ${msg.watching}`
        : msg.error
          ? `Native: ${msg.error}`
          : "Native host connected"
    });
    return;
  }
  if (type === "error") {
    await saveCsvSourceSettings({ lastStatus: `Native: ${msg.error || "error"}` });
  }
}

/**
 * Parse CSV text, merge with existing queue by job identity, sheet-dedupe, optionally auto-start.
 */
async function ingestCsvText({
  text,
  fileName = "jobs.csv",
  source = "manual",
  autoStart = false,
  force = false
} = {}) {
    const body = String(text || "");
  if (!body.trim()) throw new Error("CSV text is empty.");

  const fp = await fingerprintText(body);
  const settings = await getCsvSourceSettings();
  if (!force && settings.lastFingerprint && settings.lastFingerprint === fp) {
    await saveCsvSourceSettings({
      lastStatus: `Unchanged (${source}) — fingerprint match`,
      lastIngestAt: Date.now(),
      lastSource: source
    });
    return {
      ok: true,
      unchangedFile: true,
      added: 0,
      pending: 0,
      fileName,
      source
    };
  }

  const parsed = parseJobsCsv(body);
  const data = await chrome.storage.local.get([
    ALL_US_JOBS_KEY,
    QUEUE_KEY,
    JOB_CHANNEL_FILTER_KEY,
    REMOVED_JOB_IDENTITIES_KEY,
    "batch_output_dir"
  ]);
  const previousAll = Array.isArray(data[ALL_US_JOBS_KEY]) ? data[ALL_US_JOBS_KEY] : [];
  const previousQueue = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
  const removedIdentities = new Set(
    Array.isArray(data[REMOVED_JOB_IDENTITIES_KEY])
      ? data[REMOVED_JOB_IDENTITIES_KEY].map(String)
      : []
  );
  const reviewableJobs = parsed.usJobs.filter(
    (job) => !removedIdentities.has(jobIdentity(job))
  );
  const merged = mergeParsedJobs(previousAll, previousQueue, reviewableJobs);
  const channel = normalizeChannelFilter(data[JOB_CHANNEL_FILTER_KEY] || DEFAULT_CHANNEL_FILTER);
  const filtered = filterJobsByChannel(merged.allUsJobs, channel);

  await chrome.storage.local.set({
    [ALL_US_JOBS_KEY]: merged.allUsJobs,
    [QUEUE_KEY]: filtered,
    [JOB_CHANNEL_FILTER_KEY]: channel,
    csv_file_name: fileName,
    csv_total_rows: parsed.totalRows,
    csv_dropped_non_us: parsed.droppedNonUs
  });

  let dedupe = { checked: false, skipped: 0 };
  try {
    dedupe = await dedupeQueueAgainstSheet({ notifySlack: merged.added > 0 });
  } catch (err) {
    dedupe = { checked: false, skipped: 0, error: String(err?.message || err) };
  }

  try {
    await hydrateQueueFromDisk();
  } catch {
    /* native host optional */
  }

  const queue = await getQueue();
  const pending = queue.filter(
    (j) => j.status === "pending" || j.status === "error" || j.status === "failed"
  ).length;

  const status = `CSV (${source}): +${merged.added} new · ${pending} pending · sheet skipped ${dedupe.skipped || 0}. Review jobs, then click Start.`;
  await saveCsvSourceSettings({
    lastFingerprint: fp,
    lastIngestAt: Date.now(),
    lastSource: source,
    lastStatus: status
  });
  await setStatus(status);

  let started = false;
  if (autoStart && pending > 0 && !isRunning) {
    const person = await getActivePerson().catch(() => null);
    if (person?.promptTemplate?.includes("{JD}")) {
      isRunning = true;
      started = true;
      const outputDir = await resolveOutputDir(data.batch_output_dir);
      (async () => {
        await recoverInterruptedBatch("CSV auto-source starting batch…", {
          retryFailed: true
        }).catch(() => {});
        isRunning = true;
        await runBatchLoop(outputDir);
      })().catch(async (err) => {
        isRunning = false;
        stopKeepAlive();
        await setBatchState("idle");
        await chrome.storage.local.set({ generation_running: false });
        await setStatus(`Batch failed after CSV ingest: ${String(err?.message || err)}`);
      });
    }
  }

  return {
    ok: true,
    unchangedFile: false,
    added: merged.added,
    updated: merged.updated,
    unchanged: merged.unchanged,
    pending,
    skippedSheet: dedupe.skipped || 0,
    totalUs: merged.allUsJobs.length,
    fileName,
    source,
    started,
    dedupeError: dedupe.error || ""
  };
}

async function pollCsvSources({ reason = "poll", force = false } = {}) {
  const settings = await getCsvSourceSettings();
  const errors = [];

  if (settings.urlEnabled && settings.url) {
    try {
      const { text, fileName } = await fetchCsvFromUrl(settings.url);
      const result = await ingestCsvText({
        text,
        fileName,
        source: "url",
        autoStart: false,
        force
      });
      if (!result.unchangedFile) return { ok: true, via: "url", result, reason };
    } catch (err) {
      errors.push(`url: ${String(err?.message || err)}`);
    }
  }

  if (settings.pinEnabled) {
    try {
      const pinned = await readPinnedCsvViaOffscreen();
      if (pinned?.ok && pinned.text) {
        const result = await ingestCsvText({
          text: pinned.text,
          fileName: pinned.fileName || settings.pinFileName || "jobs.csv",
          source: "pinned",
          autoStart: false,
          force
        });
        if (!result.unchangedFile) return { ok: true, via: "pinned", result, reason };
      } else if (pinned?.reason === "permission") {
        errors.push("pinned: permission needed — open the bot and click Refresh CSV");
      } else if (pinned?.reason === "no_handle") {
        errors.push("pinned: no file pinned");
      } else if (pinned?.error) {
        errors.push(`pinned: ${pinned.error}`);
      }
    } catch (err) {
      errors.push(`pinned: ${String(err?.message || err)}`);
    }
  }

  if (settings.nativeEnabled) {
    try {
      if (!nativePort) connectNativeHost({ path: nativeWatchPath || "" });
      nativePort?.postMessage({
        type: "read",
        path: nativeWatchPath || undefined
      });
      await saveCsvSourceSettings({
        lastStatus: `Native read requested (${reason})`
      });
      return { ok: true, via: "native", reason };
    } catch (err) {
      errors.push(`native: ${String(err?.message || err)}`);
    }
  }

  if (errors.length) {
    await saveCsvSourceSettings({ lastStatus: errors.join(" · ") });
    return { ok: false, errors, reason };
  }
  await saveCsvSourceSettings({
    lastStatus: `No CSV changes (${reason})`
  });
  return { ok: true, unchanged: true, reason };
}

// Kick native host / alarm on SW start when enabled.
(async () => {
  try {
    await syncCsvSourceAlarm();
    const settings = await getCsvSourceSettings();
    if (settings.nativeEnabled) {
      connectNativeHost({});
    }
  } catch {
    // best-effort
  }
})();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;

  if (type === "open_app_window") {
    openBotAppWindow()
      .then((result) => safeSendResponse(sendResponse, result))
      .catch((err) =>
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) })
      );
    return true;
  }

  if (type === "indeed_grab_and_apply" || type === "indeed_grab_only") {
    if (isRunning) {
      safeSendResponse(sendResponse, {
        ok: false,
        error: "Pause the generation/apply batch before grabbing an Indeed job."
      });
      return false;
    }
    safeSendResponse(sendResponse, { ok: true, started: true });
    runIndeedGrabAndApply({ autoApply: type === "indeed_grab_and_apply" })
      .then((result) => {
        const job = result?.job;
        const label = job ? job.company + " / " + job.title : "Indeed job";
        if (result?.skipped) {
          setStatus("Indeed: " + label + " already applied.");
          return;
        }
        if (result?.external) {
          setStatus("Indeed: files ready for " + label + " (external ATS — apply manually).");
          return;
        }
        if (result?.applied) {
          setStatus("Indeed: applied — " + label);
          return;
        }
        if (type === "indeed_grab_only") {
          setStatus("Indeed: queued " + label + ". Review then Start if needed.");
          return;
        }
        setStatus("Indeed: finished " + label);
      })
      .catch((err) => setStatus("Indeed grab failed: " + String(err?.message || err)));
    return false;
  }

  if (type === "offscreen_read_pinned_csv") {
    // Handled by offscreen.js when that document is the receiver.
    // If this SW somehow gets it (no offscreen), fall through as not handled.
    return false;
  }

  if (type === "ingest_csv_text") {
    (async () => {
      try {
        const result = await ingestCsvText({
          text: message.text,
          fileName: message.fileName || "jobs.csv",
          source: message.source || "manual",
          autoStart: message.autoStart === true,
          force: Boolean(message.force)
        });
        safeSendResponse(sendResponse, result);
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "csv_source_refresh") {
    (async () => {
      try {
        const result = await pollCsvSources({
          reason: "refresh",
          force: Boolean(message.force)
        });
        safeSendResponse(sendResponse, result);
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "csv_source_save") {
    (async () => {
      try {
        const patch = message.settings || {};
        const next = await saveCsvSourceSettings({
          pollMinutes: clampPollMinutes(patch.pollMinutes),
          url: String(patch.url || "").trim(),
          urlEnabled: Boolean(patch.urlEnabled),
          pinEnabled: Boolean(patch.pinEnabled),
          pinFileName: String(patch.pinFileName || "").trim(),
          nativeEnabled: Boolean(patch.nativeEnabled),
          lastStatus: "Settings saved"
        });
        const alarm = await syncCsvSourceAlarm();
        if (next.nativeEnabled) {
          try {
            connectNativeHost({ path: String(message.nativePath || "").trim() });
          } catch (err) {
            next.lastStatus = `Native connect failed: ${String(err?.message || err)}`;
            await saveCsvSourceSettings({ lastStatus: next.lastStatus });
          }
        } else {
          disconnectNativePort();
        }
        safeSendResponse(sendResponse, { ok: true, settings: next, alarm });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "csv_source_get") {
    (async () => {
      try {
        const settings = await getCsvSourceSettings();
        safeSendResponse(sendResponse, {
          ok: true,
          settings,
          nativeConnected: Boolean(nativePort),
          extensionId: chrome.runtime.id
        });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "dedupe_queue_against_sheet") {
    (async () => {
      try {
        const result = await dedupeQueueAgainstSheet({
          notifySlack: message?.notifySlack !== false
        });
        await hydrateQueueFromDisk().catch(() => {});
        safeSendResponse(sendResponse, result);
      } catch (err) {
        safeSendResponse(sendResponse, {
          ok: false,
          checked: false,
          skipped: 0,
          error: String(err?.message || err)
        });
      }
    })();
    return true;
  }

  if (type === "remove_queue_job") {
    (async () => {
      try {
        if (isRunning) {
          throw new Error("Pause generation before removing a job.");
        }
        const csvRow = Number(message.csvRow);
        if (!Number.isFinite(csvRow)) throw new Error("Missing CSV row.");
        const data = await chrome.storage.local.get([
          QUEUE_KEY,
          ALL_US_JOBS_KEY,
          REMOVED_JOB_IDENTITIES_KEY
        ]);
        const queue = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
        const allJobs = Array.isArray(data[ALL_US_JOBS_KEY]) ? data[ALL_US_JOBS_KEY] : [];
        const target =
          queue.find((job) => Number(job.csvRow) === csvRow) ||
          allJobs.find((job) => Number(job.csvRow) === csvRow);
        if (!target) throw new Error(`Row ${csvRow} was not found.`);
        if (target.status === "running" || target.status === "done" || target.applied) {
          throw new Error("Only unprocessed jobs can be removed from the batch.");
        }
        const identity = jobIdentity(target);
        const removed = new Set(
          Array.isArray(data[REMOVED_JOB_IDENTITIES_KEY])
            ? data[REMOVED_JOB_IDENTITIES_KEY].map(String)
            : []
        );
        if (identity) removed.add(identity);
        const matchesTarget = (job) =>
          Number(job.csvRow) === csvRow || (identity && jobIdentity(job) === identity);
        const nextQueue = queue.filter((job) => !matchesTarget(job));
        const nextAll = allJobs.filter((job) => !matchesTarget(job));
        await chrome.storage.local.set({
          [QUEUE_KEY]: nextQueue,
          [ALL_US_JOBS_KEY]: nextAll,
          [REMOVED_JOB_IDENTITIES_KEY]: [...removed],
          generation_status: `Removed row ${csvRow} from the review batch.`
        });
        safeSendResponse(sendResponse, {
          ok: true,
          csvRow,
          removedIdentity: identity,
          queue: nextQueue,
          allJobs: nextAll
        });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "clear_job_queue") {
    (async () => {
      try {
        isRunning = false;
                batchControl.stop = true;
        batchControl.skipCurrent = true;
        stopKeepAlive();
        await chrome.storage.local.set({
          [QUEUE_KEY]: [],
          all_us_jobs: [],
          [BATCH_STATE_KEY]: "idle",
          generation_running: false,
          generation_status: "Job list cleared.",
          csv_file_name: "",
          csv_total_rows: 0,
          csv_dropped_non_us: 0,
          chatgpt_harvested_resume: null,
          chatgpt_json_ready: false,
          chatgpt_json_ready_at: 0,
          last_resume_json: null,
          [REMOVED_JOB_IDENTITIES_KEY]: [],
        });
        safeSendResponse(sendResponse, { ok: true });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "reset_generation_state") {
    (async () => {
      try {
        isRunning = false;
                batchControl.stop = true;
        stopKeepAlive();
        const tab = await getOpenChatGptTab();
        if (tab?.id) {
          await chrome.tabs.reload(tab.id);
        }
        await chrome.storage.local.set({
          generation_status: "Reset complete. Job list cleared.",
          generation_running: false,
          last_response: "",
          [BATCH_STATE_KEY]: "idle",
          [QUEUE_KEY]: [],
          all_us_jobs: [],
          csv_file_name: "",
          csv_total_rows: 0,
          csv_dropped_non_us: 0,
          [REMOVED_JOB_IDENTITIES_KEY]: [],
        });
        safeSendResponse(sendResponse, { ok: true });
      } catch (err) {
        isRunning = false;
        stopKeepAlive();
        await chrome.storage.local.set({ generation_running: false });
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "send_prompt") {
    (async () => {
      try {
        const tab = await getOpenChatGptTab();
        if (!tab || typeof tab.id !== "number") {
          safeSendResponse(sendResponse, {
            ok: false,
            error: "Open ChatGPT in a browser tab first."
          });
          return;
        }
        await chatgptSendPrompt(tab.id, message.prompt || "", true);
        try {
          await chrome.tabs.update(tab.id, { active: true });
        } catch {
          // focusing the tab is best-effort
        }
        safeSendResponse(sendResponse, { ok: true });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "hydrate_job_dirs") {
    (async () => {
      try {
        const result = await hydrateQueueFromDisk();
        safeSendResponse(sendResponse, { ok: true, ...result });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "reveal_job_files") {
    (async () => {
      try {
        const result = await revealJobFiles({
          csvRow: message.csvRow,
          jobDir: message.jobDir,
          jdLink: message.jdLink || ""
        });
        safeSendResponse(sendResponse, { ok: true, ...result });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "autofill_active_tab") {
    (async () => {
      try {
        const result = await autofillActiveTab(message.tabId || null);
        const statusText = result.statusText || formatAutofillSummary(result);
        await setStatus(`${statusText} on the current page.`);
        safeSendResponse(sendResponse, { ok: true, ...result, statusText });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "autofill_multi_step") {
    (async () => {
      try {
        if (!(await isAutofillEnabled())) {
          safeSendResponse(sendResponse, {
            ok: false,
            error: "Autofill is disabled. Turn it on in Apply assist."
          });
          return;
        }
        const stored = await chrome.storage.local.get([
          "last_apply_csv_row",
          "last_apply_job_dir",
          "last_apply_jd_link",
          "allowSubmitOnAssist"
        ]);
        const allowSubmit = Boolean(
          message.allowSubmitOnAssist ?? stored.allowSubmitOnAssist
        );
        const tab =
          message.tabId != null
            ? await chrome.tabs.get(message.tabId).catch(() => null)
            : (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
        const tabUrl = tab?.url || stored.last_apply_jd_link || "";
        const result = await startMultiStepApplyOnTab(message.tabId || tab?.id || null, {
          autoSubmit: allowSubmit,
          assistMode: !allowSubmit,
          applyHint: {
            csvRow: stored.last_apply_csv_row,
            jobDir: stored.last_apply_job_dir,
            jdLink: stored.last_apply_jd_link || tabUrl
          }
        });
        const filled = Number(result.filled || result.filledCount || 0);
        const metricsBits = [
          filled ? `${filled} filled` : "",
          result.bankHits ? `${result.bankHits} bank` : "",
          result.aiHits ? `${result.aiHits} AI` : "",
          result.unmatchedAfterSecondPass != null
            ? `${result.unmatchedAfterSecondPass} unmatched`
            : "",
          result.fillRate ? `${result.fillRate}% fill` : ""
        ]
          .filter(Boolean)
          .join(" · ");
        const msg =
          result.detail ||
          `Apply assist filled ${filled} field(s) across ${result.steps || 1} step(s).`;
        await setStatus(metricsBits ? `${msg} (${metricsBits})` : msg);
        safeSendResponse(sendResponse, { ok: true, filled, ...result, status: msg });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "apply_job_url") {
    startKeepAlive();
    (async () => {
      const jobMeta = {
        ...(message.job && typeof message.job === "object" ? message.job : {}),
        jdLink: message.url || message.job?.jdLink || ""
      };
      let responded = false;
      const reply = (payload) => {
        if (responded) return;
        responded = true;
        safeSendResponse(sendResponse, payload);
      };
      try {
        const queueSnap = await getQueue().catch(() => []);
        const prior = (queueSnap || []).find((j) => Number(j.csvRow) === Number(jobMeta.csvRow));
        if (isJobMarkedInactive(prior || jobMeta)) {
          const detail = prior?.error || jobMeta.error || "inactive job";
          reply({ ok: false, applied: false, started: false, error: detail });
          await setStatus(`Row ${jobMeta.csvRow}: inactive job — apply skipped.`);
          return;
        }
        if (!(await isAutofillEnabled())) {
          const href = String(message.url || jobMeta.jdLink || "").trim();
          if (!href) {
            reply({ ok: false, applied: false, started: false, error: "Missing job URL." });
            await setStatus("Apply skipped — no job link.");
            return;
          }
          const located = await locateJobFolder({
            csvRow: jobMeta.csvRow,
            jobDir: jobMeta.jobDir || "",
            jdLink: jobMeta.jdLink,
            company: jobMeta.companyName || jobMeta.company || "",
            title: jobMeta.jobTitle || jobMeta.title || ""
          }).catch(() => null);
          if (located?.jobDir) {
            jobMeta.jobDir = located.jobDir;
            if (jobMeta.csvRow != null && jobMeta.csvRow !== "") {
              await updateQueueJob(jobMeta.csvRow, { jobDir: located.jobDir, hasFiles: true }).catch(() => {});
            }
          }
          await persistJobContextForAutofill(jobMeta);
          const sheet = await markQueueJobAppliedOnSheet(jobMeta);
          const appliedDate = sheet?.appliedDate || formatApplicationDateTime();
          const sheetFailed = Boolean(sheet?.error);
          const sheetLabel = sheetFailed
            ? `Sheet Applied failed: ${sheet.error}`
            : sheet?.skipped
              ? ""
              : `Sheet: ${sheet.status || (appliedDate ? `Applied ${appliedDate}` : "Applied")}`;
          if (!sheetFailed && jobMeta.csvRow != null && jobMeta.csvRow !== "") {
            await updateQueueJob(jobMeta.csvRow, {
              applied: true,
              appliedDate,
              jobDir: jobMeta.jobDir || "",
              hasFiles: Boolean(jobMeta.jobDir)
            }).catch(() => {});
          }
          const sheetStatus = sheetFailed
            ? sheetLabel || "Sheet update failed."
            : sheetLabel
              ? `${sheetLabel}. Opening job link…`
              : "Marked Applied. Opening job link…";
          reply({
            ok: !sheetFailed,
            applied: !sheetFailed,
            started: false,
            openedOnly: true,
            autofillSkipped: true,
            appliedDate: sheetFailed ? "" : appliedDate,
            jobDir: jobMeta.jobDir || "",
            status: sheetStatus
          });
          if (sheetFailed) {
            await setStatus(sheetStatus);
            return;
          }
          await setStatus(sheetStatus);
          try {
            const result = await openJobAndApply(href, {
              openOnly: true,
              csvRow: jobMeta.csvRow,
              jobDir: jobMeta.jobDir || "",
              jdLink: jobMeta.jdLink || href
            });
            await setStatus(
              sheetLabel
                ? `${sheetLabel}. ${result?.detail || "Opened job link."}`
                : result?.detail ||
                  `Row ${jobMeta.csvRow}: marked Applied and opened job link.`
            );
          } catch (err) {
            await setStatus(
              `${sheetLabel || "Marked Applied"}. Job link failed: ${String(err?.message || err)}`
            );
          }
          return;
        }
        const folderPromise = locateJobFolder({
          csvRow: jobMeta.csvRow,
          jobDir: jobMeta.jobDir || "",
          jdLink: jobMeta.jdLink,
          company: jobMeta.companyName || jobMeta.company || "",
          title: jobMeta.jobTitle || jobMeta.title || ""
        }).catch(() => null);
        await persistJobContextForAutofill(jobMeta);
        const sheet = await markQueueJobAppliedOnSheet(jobMeta);
        const appliedDate = sheet?.appliedDate || formatApplicationDateTime();
        const sheetFailed = Boolean(sheet?.error);
        const sheetLabel = sheetFailed
          ? `Sheet Applied failed: ${sheet.error}`
          : sheet?.skipped
            ? ""
            : `Sheet: ${sheet.status || (appliedDate ? `Applied ${appliedDate}` : "Applied")}`;
        if (!sheetFailed && jobMeta.csvRow != null && jobMeta.csvRow !== "") {
          await updateQueueJob(jobMeta.csvRow, {
            applied: true,
            appliedDate,
            jobDir: jobMeta.jobDir || "",
            hasFiles: Boolean(jobMeta.jobDir)
          }).catch(() => {});
        }
        await setStatus(
          sheetLabel
            ? `${sheetLabel}. Opening job and running Auto Apply…`
            : "Sheet marked Applied. Opening job and running Auto Apply…"
        );
        reply({
          ok: !sheetFailed,
          started: true,
          applied: !sheetFailed,
          appliedDate: sheetFailed ? "" : appliedDate,
          jobDir: jobMeta.jobDir || "",
          status: sheetLabel
            ? `${sheetLabel}. Opening job and running Auto Apply…`
            : "Sheet marked Applied. Opening job and running Auto Apply…"
        });

        const located = await folderPromise;
        if (located?.jobDir) {
          jobMeta.jobDir = located.jobDir;
          if (jobMeta.csvRow != null && jobMeta.csvRow !== "") {
            await updateQueueJob(jobMeta.csvRow, { jobDir: located.jobDir, hasFiles: true }).catch(() => {});
            await rememberApplyHistory(jobMeta.csvRow, {
              jobDir: located.jobDir,
              jdLink: jobMeta.jdLink || ""
            }).catch(() => {});
          }
        }
        await persistJobContextForAutofill(jobMeta);

        const result = await openJobAndApply(message.url, {
          multiStep: message.multiStep !== false,
          autoSubmit:
            message.autoSubmit === true ||
            isGreenhouseJob({ jdLink: jobMeta.jdLink || message.url || "" }) ||
            isAshbyJob({ jdLink: jobMeta.jdLink || message.url || "" }) ||
            isLeverJob({ jdLink: jobMeta.jdLink || message.url || "" }) ||
            isWorkdayJob({ jdLink: jobMeta.jdLink || message.url || "" }) ||
            isJobgetherJob({ jdLink: jobMeta.jdLink || message.url || "" }),
          csvRow: jobMeta.csvRow,
          jobDir: jobMeta.jobDir || "",
          jdLink: jobMeta.jdLink || message.url || ""
        });
        if (result?.status === "submitted" && result?.tabId) {
          await closeApplyTab(result.tabId).catch(() => false);
        }
        if (jobMeta.csvRow != null && jobMeta.csvRow !== "") {
          const docsPatch = {
            jobDir: result.uploadFolder || jobMeta.jobDir || "",
            hasFiles: true
          };
          if (result.uploadResumeName) docsPatch.resumeName = result.uploadResumeName;
          if (result.uploadCoverName) docsPatch.coverName = result.uploadCoverName;
          await rememberApplyHistory(jobMeta.csvRow, {
            ...docsPatch,
            jdLink: jobMeta.jdLink || ""
          }).catch(() => {});
          await updateQueueJob(jobMeta.csvRow, docsPatch).catch(() => {});
        }
        const filled = Number(result.filled || result.filledCount || 0);
        const files = [result.uploadResumeName, result.uploadCoverName].filter(Boolean).join(" + ");
        let msg = result.detail || "";
        if (!msg) {
          if (result.status === "submitted") {
            msg = `Apply assist: submitted application` +
              (result.uploaded ? ` (uploaded ${files || `${result.uploaded} file(s)`})` : "") +
              `.`;
          } else {
            msg =
              `Apply assist: filled ${filled} field(s)` +
              (result.uploaded
                ? `, uploaded ${files || `${result.uploaded} file(s)`}`
                : "") +
              `. Review and submit.`;
          }
        }
        if (sheetLabel) msg = `${msg} ${sheetLabel}.`;
        await setStatus(msg);
      } catch (err) {
        const msg = `Apply assist failed: ${String(err?.message || err)}`;
        await setStatus(msg);
        reply({ ok: false, applied: false, appliedDate: "", error: msg });
      } finally {
        if (!isRunning) stopKeepAlive();
      }
    })();
    return true;
  }

  if (type === "profile_learn_capture") {
    (async () => {
      try {
        const result = await handleProfileLearnCapture(message);
        safeSendResponse(sendResponse, result);
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "qa_learn_capture") {
    (async () => {
      try {
        const result = await handleQaLearnCapture(message);
        safeSendResponse(sendResponse, result);
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "easy_apply_answer_questions") {
    (async () => {
      try {
        const answers = await answerQuestionsFromBank(message.questions || [], {
          choice: false,
          site: message.site || "",
          jobMeta: message.jobMeta || null
        });
        safeSendResponse(sendResponse, { ok: true, answers });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, answers: [], error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "easy_apply_choice_answers") {
    (async () => {
      try {
        const answers = await answerQuestionsFromBank(message.questions || [], {
          choice: true,
          site: message.site || ""
        });
        safeSendResponse(sendResponse, { ok: true, answers });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, answers: [], error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "batch_pause") {
    batchControl.pauseAfterCurrent = true;
    setStatus("Pause requested — will pause after the current job finishes writing files.");
    safeSendResponse(sendResponse, { ok: true, status: "Pause requested." });
    return false;
  }

  if (type === "batch_skip") {
    batchControl.skipCurrent = true;
    setStatus("Skip requested for current job.");
    safeSendResponse(sendResponse, { ok: true, status: "Skip requested." });
    return false;
  }

  if (type === "batch_stop") {
    batchControl.stop = true;
    batchControl.skipCurrent = true;
    setStatus("Stop requested — batch will halt.");
    setBatchState("idle");
    safeSendResponse(sendResponse, { ok: true, status: "Stop requested." });
    return false;
  }

  if (type === "force_save_chatgpt_resume") {
    (async () => {
      try {
        const tab = await getOpenChatGptTab();
        if (!tab?.id) throw new Error("Open the ChatGPT tab that has the resume JSON.");

        const person = await getActivePerson();
        await activatePersonExperienceRules(person);

        await setStatus("Force-save: collecting resume JSON…");

        let data = message.resumeData && typeof message.resumeData === "object" ? message.resumeData : null;

        if (!isUsableResumeJson(data)) {
          const stored = await chrome.storage.local.get([
            "chatgpt_harvested_resume",
            "last_resume_json"
          ]);
          if (isUsableResumeJson(stored.chatgpt_harvested_resume)) {
            data = stored.chatgpt_harvested_resume;
          } else if (isUsableResumeJson(stored.last_resume_json)) {
            data = stored.last_resume_json;
          }
        }

        if (!isUsableResumeJson(data)) {
          const state = await withTimeout(
            chatgptPollState(tab.id, { harvestJson: true }),
            20000,
            "Timed out reading ChatGPT page."
          );
          data = state.resumeData;
          if (!isUsableResumeJson(data)) data = extractResumeJson(state.latest);
        }

        if (!isUsableResumeJson(data)) {
          throw new Error(
            `Could not find full resume JSON (${describeResumeGaps(data) || "empty"}). On ChatGPT click "Brightstar: Save resume JSON" (bottom-right), or copy the JSON and use Ctrl+Shift+V.`
          );
        }

        lastUsableResumeData = data;
        await chrome.storage.local.set({ last_resume_json: data, chatgpt_harvested_resume: data });

        // Abort any stuck poller waiting on this job.
        batchControl.forceProceed = true;
        batchControl.skipCurrent = false;

        const queue = await getQueue();
        const job =
          queue.find((j) => j.status === "running") ||
          queue.find((j) => j.status === "pending" || j.status === "error");
        if (!job) throw new Error("No queue job to attach files to. Upload CSV / Start batch first.");

        await setStatus(
          `Force-save: writing files for row ${job.csvRow} (${data.experience?.length || 0} jobs)…`
        );

        // Always save directly — do not wait for a stuck poller.
        const result = await saveResumeAndCoverLetter(
          tab.id,
          JSON.stringify(data, null, 2),
          data,
          {
            csvRow: job.csvRow,
            jobTitle: job.title,
            companyName: job.company,
            jdLink: job.jdLink || "",
            jdText: job.jdText || "",
            salary: job.salary || "",
            outputDir: outputDirFromPerson(person),
            templateId: await pickTemplateId({}, person),
            resumeFilePrefix: person.resumeFilePrefix
          },
          { runCoverLetter: true }
        );

        await updateQueueJob(job.csvRow, {
          status: "done",
          jobDir: result.savedDir,
          atsScore: result.atsEvaluation?.score ?? null,
          atsGrade: result.atsEvaluation?.grade || "",
          atsEvaluation: result.atsEvaluation || null,
          error: ""
        });
        batchControl.forceProceed = false;
        // If a poller is still waiting on this same job, skip it so the batch advances.
        batchControl.skipCurrent = true;
        await setStatus(`Force-saved row ${job.csvRow}. ${result.status}`);
        safeSendResponse(sendResponse, { ok: true, status: result.status, savedDir: result.savedDir });
      } catch (err) {
        await setStatus(`Force-save failed: ${String(err?.message || err)}`);
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "batch_status") {
    (async () => {
      const data = await chrome.storage.local.get([BATCH_STATE_KEY, QUEUE_KEY, "generation_status"]);
      safeSendResponse(sendResponse, {
        ok: true,
        state: data[BATCH_STATE_KEY] || "idle",
        queue: data[QUEUE_KEY] || [],
        status: data.generation_status || ""
      });
    })();
    return true;
  }

  if (type === "retry_job") {
    (async () => {
      try {
                const csvRow = Number(message.csvRow);
        if (!Number.isFinite(csvRow)) throw new Error("Missing csvRow.");
        const queue = await getQueue();
        const job = queue.find((j) => Number(j.csvRow) === csvRow);
        if (!job) throw new Error(`Row ${csvRow} not found in queue.`);
        if (job.status !== "error" && job.status !== "failed" && job.status !== "skipped") {
          // Allow retry from any non-done state except currently running.
          if (job.status === "running") {
            throw new Error(`Row ${csvRow} is already running.`);
          }
        }
        await updateQueueJob(csvRow, {
          status: "pending",
          attempts: 0,
          error: "",
          jobDir: job.jobDir || ""
        });
        const outputDir = await resolveOutputDir(message.outputDir);
        if (isRunning) {
          safeSendResponse(sendResponse, {
            ok: true,
            status: `Row ${csvRow} reset to pending — will run after the current job.`
          });
          return;
        }
        isRunning = true;
        safeSendResponse(sendResponse, {
          ok: true,
          started: true,
          status: `Retrying row ${csvRow}…`
        });
        runBatchLoop(outputDir).catch(async (err) => {
          isRunning = false;
          stopKeepAlive();
          await setBatchState("idle");
          await chrome.storage.local.set({ generation_running: false });
          await setStatus(`Retry failed: ${String(err?.message || err)}`);
        });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "retry_error_jobs") {
    (async () => {
      try {
                const queue = await getQueue();
        const targets = queue.filter(
          (j) => j.status === "error" || j.status === "failed" || j.status === "skipped"
        );
        if (!targets.length) {
          safeSendResponse(sendResponse, { ok: false, error: "No error jobs to retry." });
          return;
        }
        const next = queue.map((j) =>
          j.status === "error" || j.status === "failed" || j.status === "skipped"
            ? { ...j, status: "pending", attempts: 0, error: "" }
            : j
        );
        await setQueue(next);
        const outputDir = await resolveOutputDir(message.outputDir);
        if (isRunning) {
          safeSendResponse(sendResponse, {
            ok: true,
            status: `Reset ${targets.length} error job(s) to pending — they will run after the current job.`
          });
          return;
        }
        isRunning = true;
        safeSendResponse(sendResponse, {
          ok: true,
          started: true,
          status: `Retrying ${targets.length} error job(s)…`
        });
        runBatchLoop(outputDir).catch(async (err) => {
          isRunning = false;
          stopKeepAlive();
          await setBatchState("idle");
          await chrome.storage.local.set({ generation_running: false });
          await setStatus(`Retry errors failed: ${String(err?.message || err)}`);
        });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "batch_start" || type === "batch_resume") {
    (async () => {
            if (isRunning) {
        safeSendResponse(sendResponse, { ok: false, error: "Generation already in progress." });
        return;
      }
      isRunning = true;
      safeSendResponse(sendResponse, { ok: true, started: true, status: "Batch started…" });
      // Clear leftover "running" rows from a killed service worker, and give
      // rows that hit the attempt ceiling a fresh set of attempts.
      await recoverInterruptedBatch("Starting batch…", { retryFailed: true }).catch(() => {});
      isRunning = true;
      await runBatchLoop(await resolveOutputDir(message.outputDir));
    })().catch(async (err) => {
      isRunning = false;
      stopKeepAlive();
      await setBatchState("idle");
      await chrome.storage.local.set({ generation_running: false });
      const msg = String(err?.message || err);
      await setStatus(`Batch failed: ${msg}`);
      await trySlackAlert({
        title: "Batch failed ❌",
        message: msg
      });
    });
    return true;
  }

  if (type === "run_one_off") {
        if (isRunning) {
      safeSendResponse(sendResponse, { ok: false, error: "Generation already in progress." });
      return false;
    }
    isRunning = true;
    startKeepAlive();
    chrome.storage.local.set({ generation_running: true });
    safeSendResponse(sendResponse, { ok: true, started: true });
    (async () => {
      try {
                const meta = { ...(message.jobMeta || {}), bidSource: "one-off" };
        const preSkipReason = await getPreGenerateSkipReason(meta);
        if (preSkipReason) {
          if (meta.csvRow != null && meta.csvRow !== "") {
            await markJobSkippedAsDuplicate(meta.csvRow, preSkipReason);
          }
          await chrome.storage.local.set({ generation_running: false });
          await setStatus(
            `Skipped duplicate — ${preSkipReason}: ${meta.companyName || ""} / ${meta.jobTitle || ""}`
          );
          return;
        }
        const { spreadsheetUrl, webAppUrl } = await getSheetConfig();
        const link = normalizeJobLink(meta.jdLink || "");
        if (link && spreadsheetUrl && webAppUrl) {
          try {
            const keys = await fetchExistingSheetDedupKeys({ spreadsheetUrl, webAppUrl });
            const linkHit = buildKnownLinkSet(keys.links).has(link);
            if (linkHit) {
              await chrome.storage.local.set({ generation_running: false });
              await setStatus(
                `Skipped duplicate — same job link already on Google Sheet: ${meta.companyName || ""} / ${meta.jobTitle || ""}`
              );
              await trySlackDuplicates(
                [
                  {
                    csvRow: meta.csvRow,
                    company: meta.companyName,
                    title: meta.jobTitle,
                    jdLink: meta.jdLink
                  }
                ],
                keys.links.length
              );
              return;
            }
          } catch (dupErr) {
            await setStatus(
              `Sheet duplicate check failed (${String(dupErr?.message || dupErr)}); continuing one-off…`
            );
          }
        }

        const result = await runAutoJob(meta);
        await chrome.storage.local.set({ generation_running: false });
        await setStatus(result.status);
      } catch (err) {
        await chrome.storage.local.set({ generation_running: false });
        const msg = String(err?.message || err);
        if (msg.startsWith("__DUPLICATE_SKIP__:")) {
          const reason = msg.slice("__DUPLICATE_SKIP__:".length) || "duplicate job link";
          const meta = message.jobMeta || {};
          if (meta.csvRow != null && meta.csvRow !== "") {
            await markJobSkippedAsDuplicate(meta.csvRow, reason);
          }
          await setStatus(
            `Skipped duplicate — ${reason}: ${meta.companyName || ""} / ${meta.jobTitle || ""}`
          );
          return;
        }
        if (msg.startsWith("__INACTIVE_SKIP__:")) {
          const reason = msg.slice("__INACTIVE_SKIP__:".length) || "inactive job";
          const meta = message.jobMeta || {};
          if (meta.csvRow != null && meta.csvRow !== "") {
            await markJobSkippedAsInactive(meta.csvRow, reason, meta);
          }
          await setStatus(
            `Skipped inactive job — ${meta.companyName || ""} / ${meta.jobTitle || ""}`
          );
          return;
        }
        await setStatus(`Generation failed: ${msg}`);
        const meta = message.jobMeta || {};
        await trySlackJobStatus({
          outcome: "failed",
          company: meta.companyName,
          jobTitle: meta.jobTitle,
          jdLink: meta.jdLink || "",
          message: msg
        });
      } finally {
        isRunning = false;
        stopKeepAlive();
      }
    })();
    return false;
  }

  if (type === "save_from_json") {
    if (isRunning) {
      safeSendResponse(sendResponse, { ok: false, error: "Generation already in progress." });
      return undefined;
    }

    isRunning = true;
    startKeepAlive();
    chrome.storage.local.set({ generation_running: true });
    setStatus("Rendering resume from pasted JSON...");
    safeSendResponse(sendResponse, { ok: true, started: true });

    (async () => {
      try {
        const result = await runGenerationPipeline({
          jobMeta: { ...(message.jobMeta || {}), bidSource: "one-off" },
          jsonText: message.jsonText || ""
        });
        await chrome.storage.local.set({ generation_running: false });
        await setStatus(result.status);
      } catch (err) {
        await chrome.storage.local.set({ generation_running: false });
        await setStatus(`Generation failed: ${String(err?.message || err)}`);
      } finally {
        isRunning = false;
        stopKeepAlive();
      }
    })();
    return false;
  }

  return undefined;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-window-app") {
    openBotAppWindow().catch((err) =>
      setStatus(`Could not open window app: ${String(err?.message || err)}`)
    );
    return;
  }
  if (command === "autofill-page") {
    isAutofillEnabled()
      .then((enabled) => {
        if (!enabled) {
          return setStatus("Autofill is disabled. Turn it on in Apply assist.");
        }
        return autofillActiveTab()
          .then((r) =>
            setStatus(r.statusText || formatAutofillSummary(r) || `Autofilled ${r.filled || 0} field(s).`)
          )
          .catch((err) => setStatus(`Autofill failed: ${String(err?.message || err)}`));
      })
      .catch((err) => setStatus(`Autofill failed: ${String(err?.message || err)}`));
  }
  if (command === "auto-apply-page") {
    (async () => {
      try {
        if (!(await isAutofillEnabled())) {
          await setStatus("Autofill is disabled. Turn it on in Apply assist.");
          return;
        }
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const { allowSubmitOnAssist } = await chrome.storage.local.get(["allowSubmitOnAssist"]);
        const allowSubmit = Boolean(allowSubmitOnAssist);
        const r = await startMultiStepApplyOnTab(tab?.id || null, {
          autoSubmit: allowSubmit,
          assistMode: !allowSubmit
        });
        await setStatus(
          r.detail ||
            (r.status === "submitted"
              ? "Application submitted."
              : `Apply assist filled ${r.filled || 0} field(s). Review and submit.`)
        );
      } catch (err) {
        await setStatus(`Apply assist failed: ${String(err?.message || err)}`);
      }
    })();
  }
});
