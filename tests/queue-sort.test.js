import test from "node:test";
import assert from "node:assert/strict";
import { compareLatestOrder, queueStatusSortKey, sortQueueForDisplay } from "../queue-sort.js";

test("status tiers: done+applied, done, pending, then skipped/error", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 10, status: "skipped", title: "skip" },
    { csvRow: 20, status: "pending", title: "pend" },
    { csvRow: 30, status: "error", title: "err" },
    { csvRow: 40, status: "done", title: "ready" },
    { csvRow: 50, status: "done", applied: true, title: "applied" }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.title),
    ["applied", "ready", "pend", "err", "skip"]
  );
});

test("done+applied group sorts latest first", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 145, sheetRow: 63, status: "done", applied: true, title: "old" },
    { csvRow: 293, sheetRow: 120, status: "done", applied: true, title: "new" },
    { csvRow: 285, sheetRow: 100, status: "done", applied: true, title: "mid" }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.title),
    ["new", "mid", "old"]
  );
});

test("done (not applied) stays above pending even when pending is newer", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 293, sheetRow: 120, status: "pending", title: "pend" },
    { csvRow: 10, sheetRow: 50, status: "done", title: "ready" }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.title),
    ["ready", "pend"]
  );
});

test("running job stays above other status groups", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 99, sheetRow: 200, status: "done", applied: true },
    { csvRow: 1, sheetRow: 50, status: "running" }
  ]);
  assert.equal(sorted[0].status, "running");
});

test("latest jobs sort above older ones within the same status", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 145, status: "done", title: "a" },
    { csvRow: 293, status: "done", title: "b" },
    { csvRow: 285, status: "done", title: "c" }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.csvRow),
    [293, 285, 145]
  );
});

test("compareLatestOrder prefers sheetJobNo over csvRow when sheetRow missing", () => {
  assert.ok(
    compareLatestOrder(
      { csvRow: 285, sheetJobNo: 145 },
      { csvRow: 10, sheetJobNo: 200 }
    ) > 0,
    "higher sheetJobNo comes first"
  );
});

test("queueStatusSortKey ranks done+applied ahead of done", () => {
  assert.ok(
    queueStatusSortKey({ status: "done", applied: true }) <
      queueStatusSortKey({ status: "done" })
  );
  assert.ok(queueStatusSortKey({ status: "done" }) < queueStatusSortKey({ status: "pending" }));
  assert.ok(queueStatusSortKey({ status: "pending" }) < queueStatusSortKey({ status: "skipped" }));
});
