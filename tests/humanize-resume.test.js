import test from "node:test";
import assert from "node:assert/strict";

import {
  ANTI_AI_RESUME_SITES,
  buildStrongHumanizeAppendix,
  humanizeRulesForTrack,
  isAntiAiResumeSite,
  normalizeStrongHumanizeMode,
  shouldApplyStrongHumanize,
  strongHumanizeModeLabel,
  US_RESUME_STYLE_RULES
} from "../prompts/humanize-resume.js";

test("normalizeStrongHumanizeMode defaults to auto", () => {
  assert.equal(normalizeStrongHumanizeMode(""), "auto");
  assert.equal(normalizeStrongHumanizeMode("AUTO"), "auto");
  assert.equal(normalizeStrongHumanizeMode("on"), "on");
  assert.equal(normalizeStrongHumanizeMode("always"), "on");
  assert.equal(normalizeStrongHumanizeMode("off"), "off");
  assert.equal(normalizeStrongHumanizeMode("never"), "off");
});

test("isAntiAiResumeSite detects Greenhouse Ashby Lever", () => {
  assert.equal(isAntiAiResumeSite("greenhouse"), true);
  assert.equal(isAntiAiResumeSite("https://boards.greenhouse.io/acme/jobs/1"), true);
  assert.equal(isAntiAiResumeSite("https://jobs.ashbyhq.com/acme"), true);
  assert.equal(isAntiAiResumeSite("https://jobs.lever.co/acme"), true);
  assert.equal(isAntiAiResumeSite("https://www.dice.com/job-detail/1"), false);
  assert.equal(ANTI_AI_RESUME_SITES.has("greenhouse"), true);
});

test("shouldApplyStrongHumanize respects off auto on", () => {
  const gh = { jdLink: "https://boards.greenhouse.io/acme/1" };
  const dice = { jdLink: "https://www.dice.com/job-detail/abc" };
  assert.equal(shouldApplyStrongHumanize("off", gh), false);
  assert.equal(shouldApplyStrongHumanize("on", dice), true);
  assert.equal(shouldApplyStrongHumanize("auto", gh), true);
  assert.equal(shouldApplyStrongHumanize("auto", dice), false);
  assert.equal(shouldApplyStrongHumanize("auto", { site: "ashby" }), true);
});

test("humanize appendix keeps JSON-only constraint and US style", () => {
  const appendix = buildStrongHumanizeAppendix("sf");
  assert.match(appendix, /STRONG HUMANIZE/);
  assert.match(appendix, /GPTZero/);
  assert.match(appendix, /Salesforce Developer/);
  assert.match(appendix, /ONLY one complete valid resume JSON/);
  assert.match(appendix, /US RESUME STYLE/);
  assert.ok(US_RESUME_STYLE_RULES.includes("US senior resume"));
});

test("humanize rules are track-aware for the role line", () => {
  assert.match(humanizeRulesForTrack("de"), /Data Engineer/);
  assert.match(humanizeRulesForTrack("fs"), /Full Stack Developer/);
  assert.match(humanizeRulesForTrack("ai"), /AI \/ ML Engineer/);
  assert.equal(strongHumanizeModeLabel("auto"), "Auto (Greenhouse+)");
});
