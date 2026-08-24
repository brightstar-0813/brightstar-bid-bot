import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIndeedSearchUrl,
  isExplicitlyHostedIndeedJob,
  isIndeedUrl,
  isSalesforceRelevantJob,
  normalizeIndeedCapturedJob
} from "../indeed.js";
import { filterJobsByChannel, isIndeedJob, normalizeChannelFilter } from "../csv.js";
import { jobIdentity, mergeParsedJobs } from "../csv-source.js";

test("Indeed URLs and channel classification are strict", () => {
  assert.equal(isIndeedUrl("https://www.indeed.com/viewjob?jk=abc"), true);
  assert.equal(isIndeedUrl("https://indeed.example.com/viewjob?jk=abc"), false);
  assert.equal(isIndeedJob({ jdLink: "https://www.indeed.com/viewjob?jk=abc" }), true);
  assert.equal(normalizeChannelFilter("indeed"), "indeed");
  assert.equal(
    filterJobsByChannel(
      [
        { source: "indeed", jdLink: "https://www.indeed.com/viewjob?jk=1" },
        { source: "dice", jdLink: "https://www.dice.com/jobs/1" }
      ],
      "indeed"
    ).length,
    1
  );
});

test("search URL keeps capture on Indeed and applies query", () => {
  const url = new URL(
    buildIndeedSearchUrl({
      searchUrl: "https://www.indeed.com/jobs?l=Remote",
      query: "Salesforce Architect"
    })
  );
  assert.equal(url.hostname, "www.indeed.com");
  assert.equal(url.searchParams.get("q"), "Salesforce Architect");
  assert.throws(
    () => buildIndeedSearchUrl({ searchUrl: "https://example.com/jobs", query: "Salesforce" }),
    /indeed\.com/i
  );
});

test("Salesforce relevance accepts platform skills and rejects generic sales", () => {
  assert.equal(isSalesforceRelevantJob({ title: "Salesforce Technical Architect" }), true);
  assert.equal(
    isSalesforceRelevantJob({ title: "CRM Developer", description: "Build Apex and LWC solutions" }),
    true
  );
  assert.equal(isSalesforceRelevantJob({ title: "Sales Account Executive" }), false);
});

test("hosted apply must be explicit and external redirects always lose", () => {
  assert.equal(isExplicitlyHostedIndeedJob({}), false);
  assert.equal(isExplicitlyHostedIndeedJob({ applyOnIndeed: true }), true);
  assert.equal(
    isExplicitlyHostedIndeedJob({ applyOnIndeed: true, externalApply: true }),
    false
  );
});

test("normalization preserves a conservative hosted-apply gate", () => {
  const external = normalizeIndeedCapturedJob(
    {
      title: "Salesforce Developer",
      company: "Acme",
      url: "https://www.indeed.com/viewjob?jk=abc",
      description: "Apex",
      externalApply: true
    },
    9
  );
  assert.equal(external.csvRow, 9);
  assert.equal(external.source, "indeed");
  assert.equal(external.hostedApply, false);
  assert.equal(external.externalApply, true);
});

test("merge deduplicates captured URLs while preserving completed state", () => {
  const prior = {
    csvRow: 4,
    title: "Salesforce Developer",
    company: "Acme",
    source: "indeed",
    jdLink: "https://www.indeed.com/viewjob?jk=abc",
    status: "done",
    jobDir: "Applications/4"
  };
  const refreshed = { ...prior, csvRow: 12, status: "pending", jobDir: "" };
  assert.equal(jobIdentity(prior), jobIdentity(refreshed));
  const merged = mergeParsedJobs([prior], [prior], [refreshed]);
  assert.equal(merged.added, 0);
  assert.equal(merged.allUsJobs[0].status, "done");
  assert.equal(merged.allUsJobs[0].jobDir, "Applications/4");
});
