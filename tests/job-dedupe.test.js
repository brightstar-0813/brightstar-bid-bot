import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCompanyName,
  titlesMatch,
  isSameJobByCompanyTitle,
  findAppliedSameJob
} from "../job-dedupe.js";

test("company names ignore legal suffixes and punctuation", () => {
  assert.equal(normalizeCompanyName("FormativGroup, LLC."), normalizeCompanyName("FormativGroup"));
  assert.equal(normalizeCompanyName("Xoriant Corporation"), normalizeCompanyName("Xoriant"));
});

test("FormativGroup: short title is the start of the long one (rows 75 vs 132)", () => {
  assert.equal(
    titlesMatch("Senior Salesforce Certified Developer", "Senior Salesforce Certified Developer - Government Cloud"),
    true
  );
  assert.equal(
    titlesMatch("Senior Salesforce Certified Developer – Government Cloud", "Senior Salesforce Certified Developer - Government Cloud"),
    true
  );
});

test("short or different titles do not match", () => {
  assert.equal(titlesMatch("Senior Salesforce Developer", "Senior Salesforce Developer - Marketing Cloud"), false);
  assert.equal(titlesMatch("Salesforce Business Analyst", "Salesforce Product Owner/Strategist"), false);
  assert.equal(titlesMatch("", "Anything"), false);
});

test("different companies with the same title are different jobs", () => {
  assert.equal(
    isSameJobByCompanyTitle(
      { company: "FormativGroup", title: "Senior Salesforce Certified Developer" },
      { company: "NeuraFlash", title: "Senior Salesforce Certified Developer" }
    ),
    false
  );
});

test("findAppliedSameJob only matches applied rows and skips the row itself", () => {
  const queue = [
    { csvRow: 75, applied: true, company: "FormativGroup", title: "Senior Salesforce Certified Developer - Government Cloud" },
    { csvRow: 132, applied: false, company: "FormativGroup", title: "Senior Salesforce Certified Developer" },
    { csvRow: 99, applied: false, company: "FormativGroup", title: "Senior Salesforce Solution Architect – Presales" }
  ];
  const hit = findAppliedSameJob(queue[1], queue, { excludeCsvRow: 132 });
  assert.equal(hit?.csvRow, 75);
  assert.equal(findAppliedSameJob(queue[2], queue, { excludeCsvRow: 99 }), null);
  assert.equal(findAppliedSameJob(queue[0], queue, { excludeCsvRow: 75 }), null);
});

import { extractRequisitionIds, isSameEmployer, findCoveringJob } from "../job-dedupe.js";

test("requisition ids from Workday links and JD text", () => {
  assert.deepEqual(
    extractRequisitionIds({
      jdLink: "https://myhrabc.wd5.myworkdayjobs.com/Global/job/Remote-Pennsylvania/Salesforce-Business-Analyst_R2618936?source=jobgether"
    }),
    ["R2618936"]
  );
  assert.deepEqual(
    extractRequisitionIds({ jdLink: "https://veradigm.wd12.myworkdayjobs.com/VR/job/Remote---US/Expert-Business-Analyst--Salesforce_JR11186" }),
    ["JR11186"]
  );
  assert.deepEqual(extractRequisitionIds({ jdText: "Req ID: 398253 · Plano, TX" }), ["398253"]);
  assert.deepEqual(extractRequisitionIds({ jdText: "job requisition id JR11186" }), ["JR11186"]);
  // Short numbers (years, zips) are not requisitions.
  assert.deepEqual(extractRequisitionIds({ jdText: "Req 2026 hiring plan" }), []);
});

test("same employer: equal names, or the old/parent name appears in the other JD", () => {
  assert.equal(isSameEmployer({ company: "Veradigm" }, { company: "Veradigm, Inc." }), true);
  assert.equal(
    isSameEmployer({ company: "Allscripts", jdText: "Veradigm is a healthcare technology company…" }, { company: "Veradigm" }),
    true
  );
  assert.equal(isSameEmployer({ company: "Allscripts", jdText: "Healthcare IT." }, { company: "Veradigm" }), false);
});

test("findCoveringJob: Allscripts row 96 is covered by applied Veradigm row 44 (same title)", () => {
  const queue = [
    { csvRow: 44, company: "Veradigm", title: "Expert Business Analyst, Salesforce", applied: true, status: "done" },
    { csvRow: 96, company: "Allscripts", title: "Expert Business Analyst, Salesforce", status: "pending" }
  ];
  const job = { ...queue[1], jdText: "At Veradigm, we believe…" };
  const hit = findCoveringJob(job, queue, { excludeCsvRow: 96 });
  assert.equal(hit?.row?.csvRow, 44);
  assert.match(hit.reason, /applied row 44/);
});

test("findCoveringJob: same requisition id at the same employer", () => {
  const queue = [
    {
      csvRow: 92,
      company: "AmerisourceBergen",
      title: "Salesforce Business Analyst",
      applied: true,
      jdLink: "https://myhrabc.wd5.myworkdayjobs.com/Global/job/X/Salesforce-Business-Analyst_R2618936"
    }
  ];
  const job = {
    csvRow: 300,
    company: "Cencora",
    title: "Business Analyst - Salesforce (USPAH)",
    jdText: "AmerisourceBergen is now Cencora. job requisition id R2618936"
  };
  const hit = findCoveringJob(job, queue, { excludeCsvRow: 300 });
  assert.match(hit?.reason || "", /requisition R2618936/);
});

test("findCoveringJob: built rows only count when includeBuilt (pre-generate)", () => {
  const queue = [{ csvRow: 47, company: "EverCommerce", title: "EverHealth - Sr Salesforce Administrator / Architect (Remote, US)", status: "done" }];
  const job = { csvRow: 218, company: "EverCommerce", title: "EverHealth - Sr Salesforce Administrator / Architect (Remote, US)" };
  assert.equal(findCoveringJob(job, queue, { excludeCsvRow: 218 }), null);
  assert.equal(findCoveringJob(job, queue, { excludeCsvRow: 218, includeBuilt: true })?.row?.csvRow, 47);
});
