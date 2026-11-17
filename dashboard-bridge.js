/**
 * Mission Control bridge (popup / app window). See dashboard-bridge-core.js for the rules.
 * Syncs every 2 s with http://127.0.0.1:8787/bot/sync (local only; the server refuses requests
 * that arrive through its public proxy). Server down → quiet back-off, the bot works as before.
 * Off switch: chrome.storage.local `dashboard_bridge_enabled = false`.
 */
import { BRIDGE_ROW_LIMIT, buildRows, computeCounters, planCommand, ROW_BUTTONS } from "./dashboard-bridge-core.js";

const SYNC_URL_DEFAULT = "http://127.0.0.1:8787/bot/sync";
const ctx = new URLSearchParams(location.search).get("ctx") || "popup";
const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let botId = null;
let results = [];
let failures = 0;
let busy = false;

async function getBotId() {
  const { dashboard_bot_id: id } = await chrome.storage.local.get("dashboard_bot_id");
  let base = id;
  if (!base) {
    base = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
    await chrome.storage.local.set({ dashboard_bot_id: base });
  }
  return `${base}-${ctx}`;
}

function rowEl(row) {
  return document.querySelector(`.queue-item[data-csv-row="${Number(row)}"]`);
}

function rowActions(row) {
  const el = rowEl(row);
  if (!el) return [];
  const out = [];
  const ok = (sel) => { const b = el.querySelector(sel); return b && !b.disabled && !b.hidden; };
  if (ok(ROW_BUTTONS.rowApply)) out.push("apply");
  if (ok(ROW_BUTTONS.rowMarkApplied)) out.push("markApplied");
  if (ok(ROW_BUTTONS.rowRemove)) out.push("remove");
  return out;
}

async function buildState() {
  const s = await chrome.storage.local.get([
    "job_queue", "batch_state", "batch_run_mode", "job_channel_filter", "job_batch_source",
    "jobs_sheet_source_tab"
  ]);
  const queue = Array.isArray(s.job_queue) ? s.job_queue : [];
  const sel = $("#profileSelect");
  const opt = sel?.selectedOptions?.[0];
  const now = $("#queueNowWorking");
  const startBtn = $("#batchStart");
  return {
    ctx,
    person: sel?.value || "",
    personLabel: (opt?.textContent || sel?.value || "").trim(),
    persons: sel ? Array.from(sel.options, (o) => ({ id: o.value, label: o.textContent.trim() })).filter((p) => p.id) : [],
    status: ($("#status")?.textContent || "").trim().slice(0, 400),
    nowWorking: now && !now.hidden ? now.textContent.trim().replace(/\s+/g, " ").slice(0, 200) : "",
    counters: computeCounters(queue),
    batch: {
      state: s.batch_state || "idle",
      running: s.batch_state === "running",
      paused: s.batch_state === "paused",
      canStart: Boolean(startBtn && !startBtn.disabled)
    },
    batchMode: s.batch_run_mode || null,
    filter: s.job_channel_filter || "dice",
    filters: Array.from(document.querySelectorAll(".channel-btn[data-filter]"))
      .filter((b) => !b.hidden && b.dataset.filter !== "linkedin")
      .map((b) => ({ id: b.dataset.filter, label: b.textContent.trim().replace(/\s+/g, " ") })),
    autoSubmit: Boolean($("#allowSubmitToggle")?.checked),
    autofill: Boolean($("#autofillEnabledToggle")?.checked),
    source: s.job_batch_source || "",
    sheetName: s.jobs_sheet_source_tab || "",
    captureTab: s.jobs_sheet_source_tab || "",
    rows: buildRows(queue, rowActions, BRIDGE_ROW_LIMIT),
    rowsTotal: queue.length,
    ts: Date.now()
  };
}

function clickEl(el, what) {
  if (!el) throw new Error(`${what} not found in the bot window`);
  if (el.disabled) throw new Error(`${what} is disabled right now`);
  el.click();
}

/** The confirm dialog an action opened (ui-dialog.js) — the user already confirmed in the dashboard. */
async function confirmDialogIfAny(before) {
  await sleep(250);
  const btn = Array.from(document.querySelectorAll(".ui-dialog-host .ui-dialog-confirm")).find((b) => !before.has(b));
  if (btn) btn.click();
}

async function run(cmd, args) {
  const plan = planCommand(cmd, args);
  const before = new Set(document.querySelectorAll(".ui-dialog-host .ui-dialog-confirm"));
  switch (plan.kind) {
    case "noop": return "ok";
    case "click": clickEl($(plan.selector), plan.selector); break;
    case "loadSheet": {
      const sheetRadio = $("#batchSourceSheet");
      if (sheetRadio && !sheetRadio.checked) { sheetRadio.click(); await sleep(200); }
      clickEl($(plan.selector), "Load from sheet");
      break;
    }
    case "toggle": {
      const el = $(plan.selector);
      if (!el) throw new Error(`${plan.selector} not found`);
      if (el.checked !== plan.value) el.click();
      break;
    }
    case "select": {
      const el = $(plan.selector);
      if (!el) throw new Error("person select not found");
      if (!Array.from(el.options).some((o) => o.value === plan.value)) throw new Error("unknown person");
      el.value = plan.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      break;
    }
    case "input": {
      const el = $(plan.selector);
      if (!el) throw new Error("capture tab field not found");
      el.value = plan.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      break;
    }
    case "row": {
      const el = rowEl(plan.row);
      if (!el) throw new Error(`row ${plan.row} is not in the current queue view`);
      clickEl(el.querySelector(plan.selector), `that row action`);
      break;
    }
    default: throw new Error("unsupported");
  }
  await confirmDialogIfAny(before);
  await sleep(1200);
  return ($("#status")?.textContent || "").trim().slice(0, 300) || "ok";
}

async function syncOnce() {
  const { dashboard_bridge_enabled: enabled, dashboard_sync_url: url } =
    await chrome.storage.local.get(["dashboard_bridge_enabled", "dashboard_sync_url"]);
  if (enabled === false) return 10000;
  const body = { botId, person: $("#profileSelect")?.value || "", state: await buildState(), results };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  let res;
  try {
    res = await fetch(url || SYNC_URL_DEFAULT, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal
    });
  } finally { clearTimeout(t); }
  if (!res.ok) throw new Error(`sync ${res.status}`);
  results = [];
  const { commands = [] } = await res.json();
  for (const c of commands) {
    try { results.push({ id: c.id, ok: true, message: await run(c.cmd, c.args || {}) }); }
    catch (e) { results.push({ id: c.id, ok: false, message: String(e?.message || e) }); }
  }
  return commands.length ? 200 : 2000;
}

async function loop() {
  botId = await getBotId();
  for (;;) {
    let wait = 2000;
    if (!busy) {
      busy = true;
      try { wait = await syncOnce(); failures = 0; }
      catch { failures += 1; wait = Math.min(30000, 2000 * 2 ** Math.min(failures, 4)); }
      finally { busy = false; }
    }
    await sleep(document.hidden && failures ? Math.max(wait, 10000) : wait);
  }
}

loop();
