import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeUsState,
  detectRequiredResidencyStates,
  detectRelocationRequired,
  detectNonUsListing,
  detectClosedListing,
  parseYesNo,
  prefilterJob
} from "../job-prefilter.js";

const MI = { candidateState: "Michigan", willingToRelocate: null };

test("state names and codes normalize to the code", () => {
  assert.equal(normalizeUsState("Michigan"), "MI");
  assert.equal(normalizeUsState("VA"), "VA");
  assert.equal(normalizeUsState("west virginia"), "WV");
  assert.equal(normalizeUsState("Calabarzon"), "");
});

test("residency: requirement wording names the state (Lewis queue rows 52, 79, 87, 108, 109)", () => {
  assert.deepEqual(
    detectRequiredResidencyStates({ title: "Sr. Salesforce Developer | Applicant Must Be Current WI Resident | No C2C" }),
    ["WI"]
  );
  assert.deepEqual(
    detectRequiredResidencyStates({ jdText: "100% remote. Candidates must be WI residents or willing to relocate to WI." }),
    ["WI"]
  );
  assert.deepEqual(
    detectRequiredResidencyStates({ jdText: "Candidate has to be a WI resident or relocate to WI before joining the position." }),
    ["WI"]
  );
  assert.deepEqual(
    detectRequiredResidencyStates({ title: "Senior Salesforce Developer - REMOTE (WI Resident/MUST Relocate to WI)" }),
    ["WI"]
  );
  assert.deepEqual(
    detectRequiredResidencyStates({ jdText: "In-person interview required; must live in Wisconsin or be willing to relocate." }),
    ["WI"]
  );
  assert.deepEqual(detectRequiredResidencyStates({ jdText: "Open to Texas residents only." }), ["TX"]);
});

test("residency: privacy / salary boilerplate is not a requirement", () => {
  for (const jdText of [
    "California residents should read our California privacy notice.",
    "If you are a California resident, live in or plan to work from Los Angeles County…",
    "Brightspeed’s Privacy Notice for California Residents",
    "The salary range for this role is currently for residents of the United States only.",
    "Remote within the US; residents in most states welcome."
  ]) {
    assert.deepEqual(detectRequiredResidencyStates({ jdText }), [], jdText);
  }
});

test("residency: lowercase words never read as state codes", () => {
  assert.deepEqual(
    detectRequiredResidencyStates({ jdText: "Applicants must be in or near the office; residents or visitors welcome." }),
    []
  );
});

test("relocation: required vs assistance / optional", () => {
  assert.equal(detectRelocationRequired({ title: "Developer (WI Resident/MUST Relocate to WI)" }), true);
  assert.equal(detectRelocationRequired({ jdText: "Relocation is required to Austin, TX." }), true);
  assert.equal(detectRelocationRequired({ jdText: "Candidate has to relocate to WI before joining the position." }), true);
  assert.equal(detectRelocationRequired({ jdText: "This position is not eligible for relocation assistance." }), false);
  assert.equal(detectRelocationRequired({ jdText: "Relocation Not Allowed" }), false);
  assert.equal(
    detectRelocationRequired({
      jdText: "The selected candidate must be currently located in, or willing to relocate to, one of the states supported by Tripoint."
    }),
    false
  );
});

test("non-US: title markers, Jobgether Remote-from lists, Arbeitnow country footer", () => {
  assert.match(detectNonUsListing({ title: "Salesforce Consultant / Trainer (m/f/d) – Core Cloud" }), /m\/f\/d/);
  assert.match(detectNonUsListing({ title: "Senior CRM Analyst (all genders)" }), /all genders/);
  assert.match(detectNonUsListing({ jdText: "Location: 100% Remote from LATAM\nAbout us" }), /LATAM/);
  assert.match(detectNonUsListing({ jdText: "Find more English Speaking Jobs in Germany on Arbeitnow" }), /Germany/);
});

test("non-US: US-inclusive or global wording stays in", () => {
  for (const jdText of [
    "Location: Remote from US, LATAM, or India",
    "Remote from: United States, Canada",
    "Location: Remote (US or Canada)",
    "remote from Wisconsin. In-person interview required",
    "Our teams are distributed globally, with teams in the U.S., Canada, the U.K.",
    "Remote from anywhere"
  ]) {
    assert.equal(detectNonUsListing({ jdText }), "", jdText);
  }
});

test("closed listing text", () => {
  assert.match(detectClosedListing({ jdText: "We are no longer accepting applications for this role." }), /closed/);
  assert.match(detectClosedListing({ jdText: "This job has expired." }), /closed/);
  assert.equal(detectClosedListing({ jdText: "Applications reviewed on a rolling basis." }), "");
});

test("yes/no answers", () => {
  assert.equal(parseYesNo("Yes"), true);
  assert.equal(parseYesNo("No"), false);
  assert.equal(parseYesNo(""), null);
});

test("prefilterJob: WI-only row skipped for a Michigan candidate, kept for a Wisconsin one", () => {
  const job = { title: "Salesforce developer", jdText: "Candidates must be WI residents or willing to relocate to WI." };
  const mi = prefilterJob(job, MI);
  assert.equal(mi.skip, true);
  assert.equal(mi.code, "state_residency");
  assert.match(mi.reason, /WI.*MI/);
  assert.equal(prefilterJob(job, { candidateState: "Wisconsin" }).skip, false);
});

test("prefilterJob: relocation required only when the candidate is not willing", () => {
  const job = { title: "Architect", jdText: "Relocation is required to Austin, TX." };
  assert.equal(prefilterJob(job, MI).code, "relocation_required");
  assert.equal(prefilterJob(job, { candidateState: "MI", willingToRelocate: true }).skip, false);
});

test("prefilterJob: ordinary US remote row is kept", () => {
  const res = prefilterJob(
    {
      title: "Senior Salesforce Engineer",
      jdText: "Remote, United States. Authorized to work in the United States or Canada. California residents should read our notice."
    },
    MI
  );
  assert.deepEqual(res, { skip: false, code: "", reason: "" });
});
