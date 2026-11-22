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
 * Batch order (user decision 2026-11-22): sites where the bot finishes the application by
 * itself first, hand-offs (no adapter → pause for a human) as a separate group at the end.
 * Lower tier runs first. Queue order is kept inside a tier.
 */
export const BATCH_PRIORITY_KEY = "batch_priority_order";
/** "self_submit_first" (default) | "queue" (old behaviour: stored queue order). */
export const DEFAULT_BATCH_PRIORITY = "self_submit_first";

export function normalizeBatchPriority(value) {
  return String(value || "").trim().toLowerCase() === "queue" ? "queue" : DEFAULT_BATCH_PRIORITY;
}

const BOARD_TIER = Object.freeze({
  Workday: 1,
  Greenhouse: 2,
  Lever: 3,
  Ashby: 4,
  Dice: 5,
  Indeed: 6, // hosted Apply on Indeed
  Jobgether: 6 // opens the employer ATS directly; submits where that ATS has an adapter
});
export const HANDOFF_TIER = 8;
export const NEVER_APPLY_TIER = 9;

/** Priority tier of one queue row (1 = Workday … 6 = other adapter boards, 8 = hand-off, 9 = LinkedIn). */
export function batchPriorityTier(j = {}) {
  if (isNeverBatchApplyJob(j)) return NEVER_APPLY_TIER;
  const board = resolveBatchApplyBoard(j, { allSources: true });
  if (BOARD_TIER[board]) return BOARD_TIER[board];
  return HANDOFF_TIER;
}

/** True when the row's site needs a human to finish (no auto-submit adapter). */
export function isHandoffGroupJob(j = {}) {
  return batchPriorityTier(j) >= HANDOFF_TIER;
}

/**
 * First row matching `predicate`, preferring the lowest tier (stable: queue order inside a tier).
 * order "queue" keeps the old first-match behaviour.
 */
export function pickPriorityJob(queue, predicate, { order = DEFAULT_BATCH_PRIORITY } = {}) {
  const list = Array.isArray(queue) ? queue : [];
  if (normalizeBatchPriority(order) === "queue") return list.find((j) => predicate(j)) || null;
  let best = null;
  let bestTier = Infinity;
  for (const j of list) {
    if (!predicate(j)) continue;
    const tier = batchPriorityTier(j);
    if (tier < bestTier) {
      best = j;
      bestTier = tier;
      if (tier === 1) break;
    }
  }
  return best;
}

/** Pending / retry counts per group, for status lines ("12 self-submit · 30 hand-off"). */
export function summarizePriorityGroups(queue, predicate) {
  const out = { selfSubmit: 0, handoff: 0, neverApply: 0 };
  for (const j of Array.isArray(queue) ? queue : []) {
    if (!predicate(j)) continue;
    const tier = batchPriorityTier(j);
    if (tier >= NEVER_APPLY_TIER) out.neverApply += 1;
    else if (tier >= HANDOFF_TIER) out.handoff += 1;
    else out.selfSubmit += 1;
  }
  return out;
}

/**
 * autoSubmit flag the batch passes to the runner for this board. The runner still applies the
 * adapter policy; this only withholds it where the product forbids submit outright.
 */
export function batchApplyAutoSubmitForBoard(board = "") {
  return String(board || "") !== "Indeed external";
}
