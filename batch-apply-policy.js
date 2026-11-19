/**
 * Batch "apply after each build" policy.
 *
 * Batch mode (popup "Batch mode" switch, storage `batch_run_mode`):
 * - "generate": build files only — the batch never applies, on any source.
 * - "apply":    build job N → apply job N → build job N+1, on any channel (All included).
 * Unset (profiles that never chose) resolves to what the bot used to do for the current
 * channel: Dice / Greenhouse → "apply", everything else → "generate".
 * Submit still goes through ats/adapters.js `resolveEffectiveAutoSubmit` in the runner, so sites
 * without an adapter (Builtin, Himalayas, Jobright, employer pages, …) are filled and
 * then pause the batch for a human / agent to finish. External Indeed is never auto-submitted.
 * LinkedIn rows are never applied by the batch at all.
 */
import {
  isDiceJob,
  isIndeedJob,
  isWorkdayJob,
  isGreenhouseJob,
  isAshbyJob,
  isLeverJob,
  isJobgetherJob,
  isLinkedInJob,
  isJobrightJob,
  isBuiltinJob,
  isHimalayasJob
} from "./csv.js";
import { isExplicitlyHostedIndeedJob } from "./indeed.js";

export const BATCH_RUN_MODE_KEY = "batch_run_mode";
/** Legacy boolean from the first iteration of this feature (true → "apply"). */
export const BATCH_APPLY_ALL_SOURCES_KEY = "batch_apply_all_sources";

/**
 * @param {{ mode?: string, legacyAllSources?: boolean, channel?: string }} input
 * @returns {"generate"|"apply"}
 */
export function resolveBatchRunMode({ mode = "", legacyAllSources = false, channel = "" } = {}) {
  const m = String(mode || "").trim().toLowerCase();
  if (m === "generate" || m === "apply") return m;
  if (legacyAllSources === true) return "apply";
  const ch = String(channel || "").trim().toLowerCase();
  return ch === "dice" || ch === "greenhouse" ? "apply" : "generate";
}

/** Boards the batch may auto-apply + submit without the all-sources opt-in. */
export function isLegacyBatchApplyJob(j = {}) {
  return isDiceJob(j) || isGreenhouseJob(j);
}

/**
 * LinkedIn is never applied by the batch (product decision 2026-11-14): no apply tab, no
 * hand-off pause. Rows can still be built in Generate mode; the Manual Bid scraper is separate.
 */
export function isNeverBatchApplyJob(j = {}) {
  return isLinkedInJob(j);
}

/** Should this row be applied by the batch right after (or after) its build? */
export function isBatchApplyJob(j = {}, { allSources = false } = {}) {
  if (isNeverBatchApplyJob(j)) return false;
  if (isLegacyBatchApplyJob(j)) return true;
  if (!allSources) return false;
  return Boolean(String(j?.jdLink || "").trim());
}

/**
 * Board label for a batch apply row. Adapter-backed boards first (same order as before), then
 * — only with allSources — a label for boards that have no adapter.
 */
export function resolveBatchApplyBoard(j = {}, { allSources = false } = {}) {
  if (isNeverBatchApplyJob(j)) return "";
  if (isDiceJob(j)) return "Dice";
  if (isIndeedJob(j) && isExplicitlyHostedIndeedJob(j)) return "Indeed";
  if (isWorkdayJob(j)) return "Workday";
  if (isGreenhouseJob(j)) return "Greenhouse";
  if (isAshbyJob(j)) return "Ashby";
  if (isLeverJob(j)) return "Lever";
  if (isJobgetherJob(j)) return "Jobgether";
  if (!allSources || !String(j?.jdLink || "").trim()) return "";
  if (isIndeedJob(j)) return "Indeed external";
  if (isJobrightJob(j)) return "Jobright";
  if (isBuiltinJob(j)) return "Builtin";
  if (isHimalayasJob(j)) return "Himalayas";
  return "Other";
}

/** Boards without an auto-submit adapter: a batch pause there is an expected hand-off, not an error. */
const HANDOFF_BOARDS = new Set(["Indeed external", "Jobright", "Builtin", "Himalayas", "Other"]);

export function isHandoffBoard(board = "") {
  return HANDOFF_BOARDS.has(String(board || "").trim());
}

/**
 * autoSubmit flag the batch passes to the runner for this board. The runner still applies the
 * adapter policy; this only withholds it where the product forbids submit outright.
 */
export function batchApplyAutoSubmitForBoard(board = "") {
  return String(board || "") !== "Indeed external";
}
