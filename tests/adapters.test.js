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
  isGreenhouseJob,
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

  assert.equal(resolveEffectiveAutoSubmit("greenhouse", false), true);
  assert.equal(resolveEffectiveAutoSubmit("ashby", false), true);
  assert.equal(resolveEffectiveAutoSubmit("lever", false), true);
  assert.equal(resolveEffectiveAutoSubmit("workday", false), false);
  assert.equal(resolveEffectiveAutoSubmit("workday", true), true);
  assert.equal(resolveEffectiveAutoSubmit("generic", true), false);

  assert.ok(stepBudgetForSite("workday", 12) >= 16);
  assert.ok(getAdapter("greenhouse")?.emailOtp);
});

test("Ashby and Lever channel filters", () => {
  assert.equal(isAshbyJob({ jdLink: "https://jobs.ashbyhq.com/acme/role" }), true);
  assert.equal(isLeverJob({ jdLink: "https://jobs.lever.co/acme/abc" }), true);
  assert.equal(isAshbyJob({ jdLink: "https://boards.greenhouse.io/acme/1" }), false);
  assert.equal(normalizeChannelFilter("ashby"), "ashby");
  assert.equal(normalizeChannelFilter("lever"), "lever");

  const jobs = [
    { jdLink: "https://boards.greenhouse.io/acme/1" },
    { jdLink: "https://jobs.ashbyhq.com/acme/1" },
    { jdLink: "https://jobs.lever.co/acme/1" },
    { jdLink: "https://www.dice.com/job-detail/1" },
    { jdLink: "https://careers.example.com/1" }
  ];
  assert.equal(filterJobsByChannel(jobs, "ashby").length, 1);
  assert.equal(filterJobsByChannel(jobs, "lever").length, 1);
  assert.equal(filterJobsByChannel(jobs, "greenhouse").length, 1);
  // Etc excludes Ashby / Lever / Greenhouse / Dice
  assert.equal(filterJobsByChannel(jobs, "etc").length, 1);
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
