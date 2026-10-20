import test from "node:test";
import assert from "node:assert/strict";
import { compareLatestOrder, sortQueueForDisplay } from "../queue-sort.js";

test("latest jobs sort above older ones by csvRow before sync", () => {
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

test("higher sheetRow (newer append) sorts first after sync", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 285, sheetJobNo: 145, sheetRow: 63, status: "done", title: "a" },
    { csvRow: 293, sheetJobNo: 200, sheetRow: 120, status: "pending", title: "b" },
    { csvRow: 10, sheetJobNo: 199, sheetRow: 119, status: "done", title: "c" }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.sheetRow),
    [120, 119, 63]
  );
});

test("running job stays above other latest rows", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 99, sheetRow: 200, status: "done" },
    { csvRow: 1, sheetRow: 50, status: "running" }
  ]);
  assert.equal(sorted[0].status, "running");
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
