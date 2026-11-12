import test from "node:test";
import assert from "node:assert/strict";
import {
  applyQueueJobTiming,
  formatQueueDuration,
  resolveQueueDurationMs
} from "../queue-timing.js";

test("formatQueueDuration matches compact Xm Ys style", () => {
  assert.equal(formatQueueDuration(0), "0s");
  assert.equal(formatQueueDuration(42000), "42s");
  assert.equal(formatQueueDuration(162000), "2m 42s");
  assert.equal(formatQueueDuration(3661000), "1h 01m");
});

test("applyQueueJobTiming stamps start when entering running", () => {
  const now = 1_000_000;
  const next = applyQueueJobTiming({ status: "pending" }, { status: "running", error: "" }, now);
  assert.equal(next.status, "running");
  assert.equal(next.startedAt, now);
  assert.equal(next.durationMs, 0);
  assert.equal(next.finishedAt, 0);
});

test("applyQueueJobTiming freezes duration when leaving running", () => {
  const started = 1_000_000;
  const ended = started + 162_000;
  const next = applyQueueJobTiming(
    { status: "running", startedAt: started, durationMs: 0 },
    { status: "done", jobDir: "Applications/x" },
    ended
  );
  assert.equal(next.status, "done");
  assert.equal(next.finishedAt, ended);
  assert.equal(next.durationMs, 162_000);
  assert.equal(formatQueueDuration(next.durationMs), "2m 42s");
});

test("resolveQueueDurationMs is live while running", () => {
  const started = 1_000_000;
  const job = { status: "running", startedAt: started };
  assert.equal(resolveQueueDurationMs(job, started + 5000), 5000);
  assert.equal(resolveQueueDurationMs({ status: "done", durationMs: 9000 }, started + 5000), 9000);
});
