import test from "node:test";
import assert from "node:assert/strict";
import { buildRows, computeCounters, planCommand } from "../dashboard-bridge-core.js";

test("computeCounters matches popup counters", () => {
  const c = computeCounters([
    { status: "pending" }, { status: "done", applied: true, jobDir: "a" }, { status: "done", jobDir: "b" },
    { status: "skipped" }, { status: "error" }, { status: "failed" }, { status: "running" }
  ]);
  assert.deepEqual(c, { queue: 7, pending: 1, done: 2, applied: 1, skipped: 1, error: 2, running: 1, built: 2 });
});

test("buildRows: running first, limit, safe links, actions", () => {
  const q = [
    { csvRow: 1, status: "pending", company: "A", title: "T", jdLink: "https://www.dice.com/job/1" },
    { csvRow: 2, status: "running", company: "B", jdLink: "javascript:alert(1)" },
    { csvRow: 3, status: "done", applied: true }
  ];
  const rows = buildRows(q, (r) => (r === 1 ? ["apply"] : []), 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].row, 2);
  assert.equal(rows[0].link, "");
  assert.equal(rows[1].source, "dice.com");
  assert.deepEqual(rows[1].actions, ["apply"]);
  assert.equal(buildRows(q)[2].status, "applied");
  const order = buildRows([
    { csvRow: 1, status: "done", applied: true }, { csvRow: 2, status: "skipped" }, { csvRow: 3, status: "pending" },
    { csvRow: 4, status: "done" }, { csvRow: 5, status: "error" }
  ]).map((r) => r.row);
  assert.deepEqual(order, [4, 3, 5, 2, 1]);
});

test("planCommand maps to the popup's own controls", () => {
  assert.deepEqual(planCommand("start"), { kind: "click", selector: "#batchStart" });
  assert.deepEqual(planCommand("resume"), { kind: "click", selector: "#batchStart" });
  assert.deepEqual(planCommand("filter", { value: "dice" }), { kind: "click", selector: '.channel-btn[data-filter="dice"]' });
  assert.deepEqual(planCommand("batchMode", { value: "apply" }), { kind: "click", selector: "#batchModeApply" });
  assert.deepEqual(planCommand("autoSubmit", { value: "off" }), { kind: "toggle", selector: "#allowSubmitToggle", value: false });
  assert.equal(planCommand("rowMarkApplied", { row: "12" }).row, 12);
  assert.equal(planCommand("loadSheet").kind, "loadSheet");
});

test("sheet link and capture tab go into the bot's own fields and Save", () => {
  const url = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0";
  assert.deepEqual(planCommand("sheetUrl", { value: url }), { kind: "input", selector: "#jobsSheetSourceUrl", value: url, save: "#saveJobsSheetUrlBtn" });
  assert.equal(planCommand("captureTab", { value: " US-SF-Jobs " }).value, "US-SF-Jobs");
  assert.throws(() => planCommand("sheetUrl", { value: "https://evil.example.com/spreadsheets/d/1AbCdEfGhIjKlMnOp" }), /Google Sheets/);
  assert.throws(() => planCommand("captureTab", { value: "  " }));
});

test("planCommand refuses LinkedIn, bad input and unknown commands", () => {
  assert.throws(() => planCommand("filter", { value: "linkedin" }), /LinkedIn/);
  assert.throws(() => planCommand("filter", { value: 'x"]' }), /bad filter/);
  assert.throws(() => planCommand("autoSubmit", { value: "maybe" }));
  assert.throws(() => planCommand("rowRemove", { row: "0" }));
  assert.throws(() => planCommand("evalScript"), /unknown/);
});

import { slackKindAllowed, buildSlackAlertLines } from "../slack.js";

test("slack_level: default sends only alerts that need a person; 'all' sends everything", () => {
  for (const level of [undefined, "", "action"]) {
    assert.equal(slackKindAllowed(level, "alert"), true);
    assert.equal(slackKindAllowed(level, "job"), false);
    assert.equal(slackKindAllowed(level, "batch"), false);
    assert.equal(slackKindAllowed(level, "duplicates"), false);
  }
  assert.equal(slackKindAllowed("all", "job"), true);
  const lines = buildSlackAlertLines({ title: "Batch paused ⛔", message: "m", footer: "👉 Open Mission Control: https://x.ts.net" });
  assert.equal(lines.at(-1), "👉 Open Mission Control: https://x.ts.net");
});
