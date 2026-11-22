/**
 * Mission Control bridge — pure helpers (no DOM, no chrome.*), unit-tested.
 *
 * The bridge (dashboard-bridge.js, loaded in popup.html) syncs this window's state to the local
 * Mission Control server (http://127.0.0.1:8787) and runs commands the user queued there by
 * pressing this window's own controls. It never writes queue/batch storage itself and never
 * changes submit policy; it only clicks what a person could click.
 */

export const BRIDGE_ROW_LIMIT = 500; // whole queue in practice: the dashboard tiles and job-board / ATS tables count from these rows

export function isGoogleSheetUrl(url) {
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]{10,}/.test(String(url || "")) && String(url).length <= 500;
}

/** LinkedIn is never selected (apply-control CLAUDE.md rule 11; isNeverBatchApplyJob). */
export const NEVER_FILTERS = new Set(["linkedin"]);

export const BATCH_BUTTONS = {
  start: "#batchStart",
  resume: "#batchStart", // the popup has no separate Resume button; Start resumes a paused batch
  pause: "#batchPause",
  skip: "#batchSkip",
  stop: "#batchStop"
};

export const ROW_BUTTONS = {
  rowApply: ".apply-action button",
  rowMarkApplied: 'button[aria-label="Mark applied"]',
  rowRemove: 'button[aria-label="Remove"]'
};

/** Same numbers as popup updateCsvSummaryFromQueue. */
export function computeCounters(queue) {
  const q = Array.isArray(queue) ? queue : [];
  const c = { queue: q.length, pending: 0, done: 0, applied: 0, skipped: 0, error: 0, running: 0, built: 0 };
  for (const j of q) {
    const s = String(j?.status || "");
    if (s === "pending") c.pending += 1;
    else if (s === "done") c.done += 1;
    else if (s === "skipped") c.skipped += 1;
    else if (s === "error" || s === "failed") c.error += 1;
    else if (s === "running") c.running += 1;
    if (j?.applied) c.applied += 1;
    if (j?.jobDir) c.built += 1; // resume + cover letter saved on disk for this row
  }
  return c;
}

export function hostLabel(link) {
  try {
    const h = new URL(String(link || "")).hostname.replace(/^www\./, "");
    return h || "";
  } catch {
    return "";
  }
}

function safeLink(link) {
  const s = String(link || "").trim();
  return /^https?:\/\//i.test(s) ? s.slice(0, 600) : "";
}

/**
 * Rows for the dashboard: running row first, then queue order. `actions(csvRow)` returns the
 * row buttons that are present and enabled in the popup DOM right now.
 */
export function rowPriority(j) {
  const s = String(j?.status || "");
  if (s === "running") return 0;
  if (s === "paused") return 1;
  if (j?.applied) return 7;
  if (s === "done") return 2; // built, waiting to be applied
  if (s === "pending") return 3;
  if (s === "error" || s === "failed") return 4;
  if (s === "skipped") return 6;
  return 5;
}

export function buildRows(queue, actions = () => [], limit = BRIDGE_ROW_LIMIT) {
  const q = Array.isArray(queue) ? queue : [];
  // stable: actionable rows first, queue order inside each group
  const ordered = q.map((j, i) => [j, i]).sort((a, b) => rowPriority(a[0]) - rowPriority(b[0]) || a[1] - b[1]).map(([j]) => j);
  return ordered.slice(0, limit).map((j) => ({
    key: Number(j.csvRow),
    row: Number(j.csvRow),
    company: String(j.company || "").slice(0, 120),
    title: String(j.title || "").slice(0, 160),
    source: hostLabel(j.jdLink),
    status: j.applied ? "applied" : String(j.status || ""),
    error: j.error ? String(j.error).slice(0, 200) : "",
    link: safeLink(j.jdLink),
    actions: actions(Number(j.csvRow))
  }));
}

/**
 * Turn a dashboard command into one UI step. Throws on anything the bridge must not do.
 * @returns {{ kind: "click"|"toggle"|"select"|"input"|"row"|"loadSheet"|"noop", selector?: string, value?: any, row?: number }}
 */
export function planCommand(cmd, args = {}) {
  const value = args?.value;
  switch (cmd) {
    case "start": case "resume": case "pause": case "skip": case "stop":
      return { kind: "click", selector: BATCH_BUTTONS[cmd] };
    case "loadSheet":
      return { kind: "loadSheet", selector: "#loadSheetJobsBtn" };
    case "filter": {
      const f = String(value || "").toLowerCase();
      if (!/^[a-z]{2,20}$/.test(f)) throw new Error("bad filter");
      if (NEVER_FILTERS.has(f)) throw new Error("LinkedIn filter is never used");
      return { kind: "click", selector: `.channel-btn[data-filter="${f}"]` };
    }
    case "batchMode":
      if (value === "generate") return { kind: "click", selector: "#batchModeGenerate" };
      if (value === "apply") return { kind: "click", selector: "#batchModeApply" };
      throw new Error("batch mode must be generate or apply");
    case "autoSubmit":
    case "autofill": {
      const on = value === true || value === "on" || value === "true";
      const off = value === false || value === "off" || value === "false";
      if (!on && !off) throw new Error("value must be on or off");
      return { kind: "toggle", selector: cmd === "autoSubmit" ? "#allowSubmitToggle" : "#autofillEnabledToggle", value: on };
    }
    case "person":
      if (!/^[\w.-]{1,80}$/.test(String(value || ""))) throw new Error("bad person id");
      return { kind: "select", selector: "#profileSelect", value: String(value) };
    case "captureTab":
      if (!String(value || "").trim() || String(value).length > 100) throw new Error("bad capture tab");
      return { kind: "input", selector: "#jobsSheetSourceTab", value: String(value).trim(), save: "#saveJobsSheetUrlBtn" };
    case "sheetUrl": {
      const url = String(value || "").trim();
      if (!isGoogleSheetUrl(url)) throw new Error("not a Google Sheets link (https://docs.google.com/spreadsheets/…)");
      return { kind: "input", selector: "#jobsSheetSourceUrl", value: url, save: "#saveJobsSheetUrlBtn" };
    }
    case "rowApply": case "rowMarkApplied": case "rowRemove": {
      const row = Number(args?.row);
      if (!Number.isInteger(row) || row < 1) throw new Error("bad row");
      return { kind: "row", selector: ROW_BUTTONS[cmd], row };
    }
    case "refresh":
      return { kind: "noop" };
    default:
      throw new Error(`unknown command ${cmd}`);
  }
}
