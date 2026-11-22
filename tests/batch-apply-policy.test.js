import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveBatchRunMode,
  isBatchApplyJob,
  resolveBatchApplyBoard,
  batchApplyAutoSubmitForBoard
} from "../batch-apply-policy.js";

const job = (jdLink, extra = {}) => ({ jdLink, ...extra });

test("batch mode: explicit choice wins", () => {
  assert.equal(resolveBatchRunMode({ mode: "generate", channel: "dice" }), "generate");
  assert.equal(resolveBatchRunMode({ mode: "apply", channel: "all" }), "apply");
  assert.equal(resolveBatchRunMode({ mode: "generate", legacyAllSources: true }), "generate");
});

test("batch mode: unset keeps old per-channel behaviour", () => {
  assert.equal(resolveBatchRunMode({ channel: "dice" }), "apply");
  assert.equal(resolveBatchRunMode({ channel: "greenhouse" }), "apply");
  assert.equal(resolveBatchRunMode({ channel: "all" }), "generate");
  assert.equal(resolveBatchRunMode({ channel: "linkedin" }), "generate");
  assert.equal(resolveBatchRunMode({}), "generate");
});

test("batch mode: legacy all-sources flag maps to apply", () => {
  assert.equal(resolveBatchRunMode({ legacyAllSources: true, channel: "all" }), "apply");
});

test("legacy: only Dice + Greenhouse rows are batch-applied", () => {
  assert.equal(isBatchApplyJob(job("https://www.dice.com/job-detail/abc")), true);
  assert.equal(isBatchApplyJob(job("https://job-boards.greenhouse.io/acme/jobs/1")), true);
  assert.equal(isBatchApplyJob(job("https://www.linkedin.com/jobs/view/1")), false);
  assert.equal(isBatchApplyJob(job("https://acme.wd5.myworkdayjobs.com/x/job/1")), false);
});

test("LinkedIn is never batch-applied, in any mode", () => {
  const li = job("https://www.linkedin.com/jobs/view/1");
  assert.equal(isBatchApplyJob(li), false);
  assert.equal(isBatchApplyJob(li, { allSources: true }), false);
  assert.equal(resolveBatchApplyBoard(li, { allSources: true }), "");
});

test("allSources: any other row with a link is batch-applied", () => {
  const o = { allSources: true };
  assert.equal(isBatchApplyJob(job("https://builtin.com/job/x/1"), o), true);
  assert.equal(isBatchApplyJob(job("https://careers.example.com/1"), o), true);
  assert.equal(isBatchApplyJob(job(""), o), false);
});

test("board resolution keeps adapter boards and labels the rest only with allSources", () => {
  assert.equal(resolveBatchApplyBoard(job("https://www.dice.com/job-detail/abc")), "Dice");
  assert.equal(resolveBatchApplyBoard(job("https://acme.wd5.myworkdayjobs.com/x/job/1")), "Workday");
  assert.equal(resolveBatchApplyBoard(job("https://www.linkedin.com/jobs/view/1")), "");
  const o = { allSources: true };
  assert.equal(resolveBatchApplyBoard(job("https://jobright.ai/jobs/info/1"), o), "Jobright");
  assert.equal(resolveBatchApplyBoard(job("https://builtin.com/job/x/1"), o), "Builtin");
  assert.equal(resolveBatchApplyBoard(job("https://himalayas.app/companies/x/jobs/y"), o), "Himalayas");
  assert.equal(resolveBatchApplyBoard(job("https://careers.example.com/1"), o), "Other");
});

test("Indeed: hosted keeps Indeed board, external is labelled and never auto-submits", () => {
  const hosted = job("https://www.indeed.com/viewjob?jk=1", { indeedApplyOnSite: true });
  const external = job("https://www.indeed.com/viewjob?jk=2", { externalApply: true });
  assert.equal(resolveBatchApplyBoard(hosted, { allSources: true }), "Indeed");
  assert.equal(resolveBatchApplyBoard(external, { allSources: true }), "Indeed external");
  assert.equal(resolveBatchApplyBoard(external), "");
  assert.equal(batchApplyAutoSubmitForBoard("Indeed external"), false);
  assert.equal(batchApplyAutoSubmitForBoard("Indeed"), true);
  assert.equal(batchApplyAutoSubmitForBoard("Other"), true);
});

import {
  batchPriorityTier,
  pickPriorityJob,
  isHandoffGroupJob,
  summarizePriorityGroups,
  normalizeBatchPriority
} from "../batch-apply-policy.js";

const row = (csvRow, jdLink, extra = {}) => ({ csvRow, jdLink, status: "pending", ...extra });

test("priority tiers: Workday, Greenhouse, Lever, Ashby, Dice, then hand-offs, LinkedIn last", () => {
  assert.equal(batchPriorityTier(row(1, "https://acme.wd5.myworkdayjobs.com/x/job/a_R1")), 1);
  assert.equal(batchPriorityTier(row(1, "https://job-boards.greenhouse.io/acme/jobs/1")), 2);
  assert.equal(batchPriorityTier(row(1, "https://jobs.lever.co/acme/1")), 3);
  assert.equal(batchPriorityTier(row(1, "https://jobs.ashbyhq.com/acme/1")), 4);
  assert.equal(batchPriorityTier(row(1, "https://www.dice.com/job-detail/1")), 5);
  assert.equal(batchPriorityTier(row(1, "https://jobgether.com/offer/1")), 6);
  assert.equal(batchPriorityTier(row(1, "https://builtin.com/job/x/1")), 8);
  assert.equal(batchPriorityTier(row(1, "https://himalayas.app/companies/a/jobs/b")), 8);
  assert.equal(batchPriorityTier(row(1, "https://www.linkedin.com/jobs/view/1")), 9);
  assert.equal(isHandoffGroupJob(row(1, "https://builtin.com/job/x/1")), true);
  assert.equal(isHandoffGroupJob(row(1, "https://www.dice.com/job-detail/1")), false);
});

test("pickPriorityJob: lowest tier wins, queue order inside a tier, 'queue' keeps old behaviour", () => {
  const queue = [
    row(10, "https://builtin.com/job/x/10"),
    row(11, "https://www.dice.com/job-detail/11"),
    row(12, "https://www.dice.com/job-detail/12"),
    row(13, "https://acme.wd5.myworkdayjobs.com/x/job/a_R13", { status: "done" })
  ];
  const pending = (j) => j.status === "pending";
  assert.equal(pickPriorityJob(queue, pending).csvRow, 11);
  assert.equal(pickPriorityJob(queue, pending, { order: "queue" }).csvRow, 10);
  assert.equal(pickPriorityJob(queue, (j) => j.status === "done").csvRow, 13);
  assert.equal(pickPriorityJob(queue, () => false), null);
  assert.deepEqual(summarizePriorityGroups(queue, pending), { selfSubmit: 2, handoff: 1, neverApply: 0 });
  assert.equal(normalizeBatchPriority(""), "self_submit_first");
  assert.equal(normalizeBatchPriority("queue"), "queue");
});
