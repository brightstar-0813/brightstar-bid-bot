import test from "node:test";
import assert from "node:assert/strict";
import { compareLatestOrder, sortQueueForDisplay } from "../queue-sort.js";

test("within the same status, higher csvRow comes first before sync", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 1, status: "pending", title: "a" },
    { csvRow: 9, status: "pending", title: "b" },
    { csvRow: 3, status: "pending", title: "c" }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.csvRow),
    [9, 3, 1]
  );
});

test("within the same status, higher sheetRow comes first after sync", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 1, sheetRow: 86, status: "done", title: "a" },
    { csvRow: 23, sheetRow: 108, status: "done", title: "b" },
    { csvRow: 2, sheetRow: 87, status: "done", title: "c" }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.sheetRow),
    [108, 87, 86]
  );
});

test("status groups still put done before pending", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 99, status: "pending" },
    { csvRow: 1, status: "done" },
    { csvRow: 50, status: "skipped" }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.status),
    ["done", "pending", "skipped"]
  );
});

test("compareLatestOrder uses csvRow when either side lacks sheetRow", () => {
  assert.ok(
    compareLatestOrder({ csvRow: 9, sheetRow: 86 }, { csvRow: 20 }) > 0,
    "higher csvRow wins when peer has no sheetRow"
  );
});