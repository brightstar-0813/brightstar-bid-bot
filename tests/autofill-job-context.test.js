import test from "node:test";
import assert from "node:assert/strict";
import { pickAutofillJobMeta } from "../autofill-job-context.js";

const queue = [
  { csvRow: 27, company: "MyComputerCareer", title: "Salesforce Administrator- Remote", jdLink: "https://himalayas.app/companies/mycomputercareer/jobs/sa?utm_source=api", jdText: "About MyComputerCareer" },
  { csvRow: 38, company: "Yoga Alliance", title: "Salesforce Developer", jdLink: "https://jobgether.com/offer/abc-salesforce-developer", jdText: "Who We Are: Yoga Alliance" }
];

// Real case 2026-11-15: batch applied row 38 while last_* still described row 27.
test("active batch row wins over stale last_* context", () => {
  const meta = pickAutofillJobMeta({
    last_job_title: "Salesforce Administrator- Remote",
    last_company_name: "MyComputerCareer",
    last_jd_text: "About MyComputerCareer",
    last_jd_link: "https://himalayas.app/companies/mycomputercareer/jobs/sa?utm_source=api",
    last_apply_csv_row: 38,
    last_apply_jd_link: "https://jobgether.com/offer/abc-salesforce-developer",
    job_queue: queue
  });
  assert.equal(meta.companyName, "Yoga Alliance");
  assert.equal(meta.jobTitle, "Salesforce Developer");
  assert.match(meta.jdText, /Yoga Alliance/);
  assert.equal(meta.jdLink, "https://jobgether.com/offer/abc-salesforce-developer");
});

test("active_apply_job csvRow is used when present", () => {
  const meta = pickAutofillJobMeta({
    last_company_name: "MyComputerCareer",
    last_jd_link: queue[0].jdLink,
    active_apply_job: { csvRow: 38 },
    job_queue: queue
  });
  assert.equal(meta.companyName, "Yoga Alliance");
});

test("matching last_* context is kept (query string ignored)", () => {
  const meta = pickAutofillJobMeta({
    last_job_title: "Custom title",
    last_company_name: "MyComputerCareer",
    last_jd_text: "Fresh JD from the page",
    last_jd_link: "https://himalayas.app/companies/mycomputercareer/jobs/sa",
    last_apply_csv_row: 27,
    job_queue: queue
  });
  assert.equal(meta.jobTitle, "Custom title");
  assert.equal(meta.jdText, "Fresh JD from the page");
});

test("missing fields fall back to the active row", () => {
  const meta = pickAutofillJobMeta({ last_apply_csv_row: 38, last_jd_link: queue[1].jdLink, job_queue: queue });
  assert.equal(meta.companyName, "Yoga Alliance");
  assert.match(meta.jdText, /Yoga Alliance/);
});

test("no active row keeps stored context", () => {
  const meta = pickAutofillJobMeta({ last_company_name: "Acme", last_jd_text: "JD", job_queue: queue });
  assert.equal(meta.companyName, "Acme");
  assert.equal(meta.jdText, "JD");
});
