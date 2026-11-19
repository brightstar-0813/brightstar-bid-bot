import test from "node:test";
import assert from "node:assert/strict";
import {
  compareLatestOrder,
  ensureQueueDisplayOrder,
  jobPostedAt,
  queueStatusSortKey,
  sortQueueByRules,
  sortQueueForDisplay
} from "../queue-sort.js";

test("rule sort: done, done+applied, pending, then skipped/error", () => {
  const sorted = sortQueueByRules([
    { csvRow: 10, status: "skipped", title: "skip" },
    { csvRow: 20, status: "pending", title: "pend" },
    { csvRow: 30, status: "error", title: "err" },
    { csvRow: 40, status: "done", title: "ready" },
    { csvRow: 50, status: "done", applied: true, title: "applied" }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.title),
    ["ready", "applied", "pend", "err", "skip"]
  );
});

test("first arrange stamps displayOrder from rules + newest post date", () => {
  const { jobs, changed } = ensureQueueDisplayOrder([
    { csvRow: 1, status: "done", datePosted: "2026-10-10", title: "old-post" },
    { csvRow: 2, status: "done", datePosted: "2026-10-21", title: "new-post" },
    { csvRow: 3, status: "pending", datePosted: "2026-10-22", title: "pend" }
  ]);
  assert.equal(changed, true);
  assert.deepEqual(
    jobs.map((j) => j.title),
    ["new-post", "old-post", "pend"]
  );
  assert.deepEqual(
    jobs.map((j) => j.displayOrder),
    [1, 2, 3]
  );
});

test("badge/status change does not reshuffle frozen displayOrder", () => {
  const frozen = [
    { csvRow: 1, status: "done", displayOrder: 1, title: "first" },
    { csvRow: 2, status: "done", displayOrder: 2, title: "second" },
    { csvRow: 3, status: "pending", displayOrder: 3, title: "third" }
  ];
  // Mark the top Done job Applied — old logic would move it below other Done rows.
  const afterApply = frozen.map((j) =>
    j.csvRow === 1 ? { ...j, applied: true, status: "done" } : j
  );
  const sorted = sortQueueForDisplay(afterApply);
  assert.deepEqual(
    sorted.map((j) => j.title),
    ["first", "second", "third"]
  );
  assert.equal(ensureQueueDisplayOrder(afterApply).changed, false);
});

test("new jobs without displayOrder append after frozen ones", () => {
  const { jobs, changed } = ensureQueueDisplayOrder([
    { csvRow: 1, status: "done", displayOrder: 1, title: "kept" },
    { csvRow: 2, status: "pending", title: "new-pend", datePosted: "2026-10-21" },
    { csvRow: 3, status: "done", title: "new-done", datePosted: "2026-10-20" }
  ]);
  assert.equal(changed, true);
  assert.deepEqual(
    jobs.map((j) => j.title),
    ["kept", "new-done", "new-pend"]
  );
  assert.deepEqual(
    jobs.map((j) => j.displayOrder),
    [1, 2, 3]
  );
});

test("post date beats sheet/generate order in rule sort", () => {
  assert.ok(
    compareLatestOrder(
      { csvRow: 1, sheetRow: 999, datePosted: "2026-10-01" },
      { csvRow: 2, sheetRow: 10, datePosted: "2026-10-21" }
    ) > 0,
    "older post with newer sheet row sorts after newer post"
  );
});

test("jobPostedAt reads datePosted / postedAt", () => {
  assert.equal(jobPostedAt({ datePosted: "2026-10-21" }), Date.parse("2026-10-21"));
  assert.equal(jobPostedAt({ postedAt: 1_700_000_000_000 }), 1_700_000_000_000);
});

test("queueStatusSortKey ranks done ahead of done+applied", () => {
  assert.ok(
    queueStatusSortKey({ status: "done" }) <
      queueStatusSortKey({ status: "done", applied: true })
  );
  assert.ok(
    queueStatusSortKey({ status: "done", applied: true }) <
      queueStatusSortKey({ status: "pending" })
  );
  assert.ok(queueStatusSortKey({ status: "pending" }) < queueStatusSortKey({ status: "skipped" }));
});
