import test from "node:test";
import assert from "node:assert/strict";

import {
  applySiteFromUrl,
  applySiteLabel,
  getAdapter,
  isEmployerAtsSite,
  isEmployerAtsHost,
  resolveEffectiveAutoSubmit,
  stepBudgetForSite
} from "../ats/adapters.js";
import {
  filterJobsByChannel,
  isAshbyJob,
  isBuiltinJob,
  isGreenhouseJob,
  isHimalayasJob,
  isLeverJob,
  normalizeChannelFilter
} from "../csv.js";
import { partitionFormInventory } from "../ai-answers.js";

test("adapter registry maps hosts and policies", () => {
  assert.equal(applySiteFromUrl("https://boards.greenhouse.io/acme/1"), "greenhouse");
  assert.equal(applySiteFromUrl("https://jobs.ashbyhq.com/acme/abc"), "ashby");
  assert.equal(applySiteFromUrl("https://jobs.lever.co/acme/1"), "lever");
  assert.equal(applySiteFromUrl("https://company.wd1.myworkdayjobs.com/en-US/job/1"), "workday");
  assert.equal(applySiteFromUrl("https://example.com/careers"), "generic");

  assert.equal(applySiteLabel("ashby"), "Ashby");
  assert.equal(isEmployerAtsSite("ashby"), true);
  assert.equal(isEmployerAtsSite("lever"), true);
  assert.equal(isEmployerAtsSite("dice"), false);
  assert.equal(isEmployerAtsHost("jobs.ashbyhq.com"), true);

  assert.equal(resolveEffectiveAutoSubmit("greenhouse", false), false);
  assert.equal(resolveEffectiveAutoSubmit("greenhouse", true), true);
  assert.equal(resolveEffectiveAutoSubmit("workday", false), false);
  assert.equal(resolveEffectiveAutoSubmit("workday", true), true);
  assert.equal(resolveEffectiveAutoSubmit("generic", true), false);
  assert.equal(resolveEffectiveAutoSubmit("ashby", false), false);
  assert.equal(resolveEffectiveAutoSubmit("ashby", true), true);
  assert.equal(resolveEffectiveAutoSubmit("lever", false), false);

  assert.ok(stepBudgetForSite("workday", 12) >= 16);
  assert.ok(getAdapter("greenhouse")?.emailOtp);
});

test("Ashby and Lever jobs belong to Other; Builtin and Himalayas have their own filters", () => {
  assert.equal(isAshbyJob({ jdLink: "https://jobs.ashbyhq.com/acme/role" }), true);
  assert.equal(isLeverJob({ jdLink: "https://jobs.lever.co/acme/abc" }), true);
  assert.equal(isBuiltinJob({ jdLink: "https://builtin.com/job/senior-engineer/1" }), true);
  assert.equal(isHimalayasJob({ jdLink: "https://himalayas.app/companies/acme/jobs/1" }), true);
  assert.equal(isAshbyJob({ jdLink: "https://boards.greenhouse.io/acme/1" }), false);
  assert.equal(normalizeChannelFilter("ashby"), "etc");
  assert.equal(normalizeChannelFilter("lever"), "etc");
  assert.equal(normalizeChannelFilter("builtin"), "builtin");
  assert.equal(normalizeChannelFilter("himalayas"), "himalayas");

  const jobs = [
    { jdLink: "https://boards.greenhouse.io/acme/1" },
    { jdLink: "https://jobs.ashbyhq.com/acme/1" },
    { jdLink: "https://jobs.lever.co/acme/1" },
    { jdLink: "https://www.dice.com/job-detail/1" },
    { jdLink: "https://builtin.com/job/1" },
    { jdLink: "https://himalayas.app/companies/acme/jobs/1" },
    { jdLink: "https://careers.example.com/1" }
  ];
  assert.equal(filterJobsByChannel(jobs, "ashby").length, 3);
  assert.equal(filterJobsByChannel(jobs, "lever").length, 3);
  assert.equal(filterJobsByChannel(jobs, "greenhouse").length, 1);
  assert.equal(filterJobsByChannel(jobs, "builtin").length, 1);
  assert.equal(filterJobsByChannel(jobs, "himalayas").length, 1);
  // Other includes Ashby, Lever, and unknown boards — not Builtin, Himalayas, Greenhouse, or Dice
  assert.equal(filterJobsByChannel(jobs, "etc").length, 3);
  assert.equal(
    isGreenhouseJob({ jdLink: "https://boards.greenhouse.io/acme/1" }) &&
      !isAshbyJob({ jdLink: "https://boards.greenhouse.io/acme/1" }),
    true
  );
});

test("form inventory partition separates choice vs free text", () => {
  const { choice, freeText } = partitionFormInventory([
    { id: "1", label: "Sponsorship?", type: "select", options: ["Yes", "No"] },
    { id: "2", label: "Why us?", type: "textarea", multiline: true },
    { id: "3", label: "Country", fieldType: "combobox", options: ["US", "CA"] },
    { id: "4", label: "" }
  ]);
  assert.equal(choice.length, 2);
  assert.equal(freeText.length, 1);
  assert.equal(freeText[0].id, "2");
});
