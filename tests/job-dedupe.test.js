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
