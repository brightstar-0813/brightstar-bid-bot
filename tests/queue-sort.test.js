import test from "node:test";
import assert from "node:assert/strict";
import {
  compareLatestOrder,
  jobPostedAt,
  queueStatusSortKey,
  sortQueueForDisplay
} from "../queue-sort.js";

test("status tiers: done, done+applied, pending, then skipped/error", () => {
  const sorted = sortQueueForDisplay([
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

test("within a status group, newer date_posted ranks above older posts", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 1, sheetRow: 200, status: "done", datePosted: "2026-10-10", title: "old-post" },
    { csvRow: 2, sheetRow: 50, status: "done", datePosted: "2026-10-21", title: "new-post" },
    { csvRow: 3, sheetRow: 180, status: "done", datePosted: "2026-10-18", title: "mid-post" }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.title),
    ["new-post", "mid-post", "old-post"]
  );
});

test("post date beats sheet/generate order when both differ", () => {
  assert.ok(
    compareLatestOrder(
      { csvRow: 1, sheetRow: 999, datePosted: "2026-10-01" },
      { csvRow: 2, sheetRow: 10, datePosted: "2026-10-21" }
    ) > 0,
    "older post with newer sheet row sorts after newer post"
  );
});

test("same post date uses firstSeenAt before sheet row", () => {
  const sorted = sortQueueForDisplay([
    {
      csvRow: 1,
      status: "done",
      datePosted: "2026-10-20",
      firstSeenAt: Date.parse("2026-10-20T09:00:00.000Z"),
      title: "earlier"
    },
    {
      csvRow: 2,
      status: "done",
      datePosted: "2026-10-20",
      firstSeenAt: Date.parse("2026-10-20T21:00:00.000Z"),
      title: "later"
    }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.title),
    ["later", "earlier"]
  );
});

test("done (not applied) stays above done+applied and pending", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 293, status: "pending", datePosted: "2026-10-21", title: "pend" },
    { csvRow: 50, status: "done", applied: true, datePosted: "2026-10-21", title: "applied" },
    { csvRow: 10, status: "done", datePosted: "2026-10-01", title: "ready" }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.title),
    ["ready", "applied", "pend"]
  );
});

test("running sits with pending, below done groups", () => {
  const sorted = sortQueueForDisplay([
    { csvRow: 99, status: "done", applied: true, datePosted: "2026-10-21" },
    { csvRow: 1, status: "running", datePosted: "2026-10-01" },
    { csvRow: 2, status: "done", datePosted: "2026-10-05" }
  ]);
  assert.deepEqual(
    sorted.map((j) => j.status),
    ["done", "done", "running"]
  );
  assert.equal(sorted[0].applied, undefined);
  assert.equal(sorted[1].applied, true);
});

test("without post date, falls back to sheet/csv latest", () => {
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
  assert.equal(queueStatusSortKey({ status: "error" }), queueStatusSortKey({ status: "skipped" }));
});
