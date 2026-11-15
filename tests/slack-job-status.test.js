import test from "node:test";
import assert from "node:assert/strict";
import { buildSlackJobStatusText } from "../slack.js";
import { isHandoffBoard } from "../batch-apply-policy.js";

const base = { csvRow: 12, company: "Acme", jobTitle: "Salesforce Dev", personLabel: "Avash Chapagain" };

test("applied message names the site and status", () => {
  const t = buildSlackJobStatusText({ ...base, outcome: "applied", board: "Dice", message: "Submitted by the bot — sheet marked Applied" });
  assert.match(t, /Applied ✅/);
  assert.match(t, /• Job: #12 Acme \/ Salesforce Dev/);
  assert.match(t, /• Site: Dice/);
  assert.match(t, /• Status: Submitted by the bot/);
  assert.doesNotMatch(t, /Error/);
});

test("hand-off message is calm and lists unanswered questions", () => {
  const t = buildSlackJobStatusText({
    ...base,
    outcome: "handoff",
    board: "Builtin",
    message: "Fill done — finish and submit",
    unansweredLabels: ["Years of Apex", "Clearance"]
  });
  assert.match(t, /Needs hand-off 🖐️/);
  assert.match(t, /• Site: Builtin/);
  assert.match(t, /• Waiting on: Fill done/);
  assert.match(t, /• Unanswered: Years of Apex · Clearance/);
  assert.match(t, /Batch paused/);
  assert.doesNotMatch(t, /error|retrying|Attempt/i);
});

test("error and skipped keep their meaning", () => {
  const e = buildSlackJobStatusText({ ...base, outcome: "error", message: "CAPTCHA", attempts: 1, maxAttempts: 2 });
  assert.match(e, /Job error — retrying ⚠️/);
  assert.match(e, /• Error: CAPTCHA/);
  assert.match(e, /• Attempt: 1\/2/);
  const s = buildSlackJobStatusText({ ...base, outcome: "skipped", message: "Not applied — moved on" });
  assert.match(s, /Job skipped ⏭️/);
  assert.match(s, /• Status: Not applied — moved on/);
});

test("hand-off boards are the ones without an auto-submit adapter", () => {
  for (const b of ["Jobright", "Builtin", "Himalayas", "Other", "Indeed external"]) {
    assert.equal(isHandoffBoard(b), true, b);
  }
  for (const b of ["LinkedIn", "Dice", "Greenhouse", "Workday", "Lever", "Ashby", "Jobgether", "Indeed", ""]) {
    assert.equal(isHandoffBoard(b), false, b);
  }
});
