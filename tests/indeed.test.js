import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIndeedSearchUrl,
  isExplicitlyHostedIndeedJob,
  isIndeedCaptureEligible,
  isIndeedUrl,
  isPostedWithinDays,
  isSalesforceRelevantJob,
  isUsRemoteIndeedJob,
  mergeIndeedApplyEvidence,
  normalizeIndeedCapturedJob,
  parseIndeedPostedAt
} from "../indeed.js";
import {
  filterJobsByChannel,
  isIndeedJob,
  isUnitedStatesJob,
  isWorkdayJob,
  normalizeChannelFilter
} from "../csv.js";
import { jobIdentity, mergeParsedJobs } from "../csv-source.js";

test("Indeed URLs and channel classification are strict", () => {
  assert.equal(isIndeedUrl("https://www.indeed.com/viewjob?jk=abc"), true);
  assert.equal(isIndeedUrl("https://indeed.example.com/viewjob?jk=abc"), false);
  assert.equal(isIndeedJob({ jdLink: "https://www.indeed.com/viewjob?jk=abc" }), true);
  assert.equal(
    isIndeedJob({ jdLink: "https://boards.greenhouse.io/acme", source: "indeed" }),
    false
  );
  assert.equal(normalizeChannelFilter("indeed"), "indeed");
  assert.equal(
    filterJobsByChannel(
      [
        { source: "indeed", jdLink: "https://www.indeed.com/viewjob?jk=1" },
        { source: "dice", jdLink: "https://www.dice.com/jobs/1" },
        { source: "dice", jdLink: "https://jobs.lever.co/acme/1", isDice: true }
      ],
      "indeed"
    ).length,
    1
  );
  assert.equal(
    filterJobsByChannel(
      [{ source: "dice", jdLink: "https://jobs.lever.co/acme/1", isDice: true }],
      "dice"
    ).length,
    0
  );
  assert.equal(
    filterJobsByChannel(
      [{ source: "dice", jdLink: "https://jobs.lever.co/acme/1", isDice: true }],
      "etc"
    ).length,
    1
  );
});

test("Workday URLs and channel filter", () => {
  assert.equal(
    isWorkdayJob({ jdLink: "https://company.wd1.myworkdayjobs.com/en-US/careers/job/123" }),
    true
  );
  assert.equal(normalizeChannelFilter("workday"), "workday");
  assert.equal(normalizeChannelFilter("wd"), "workday");
  const jobs = [
    { jdLink: "https://company.wd1.myworkdayjobs.com/en-US/careers/job/1" },
    { jdLink: "https://www.dice.com/jobs/1" },
    { jdLink: "https://boards.greenhouse.io/acme/1" },
    { jdLink: "https://jobs.lever.co/acme/1" }
  ];
  assert.equal(filterJobsByChannel(jobs, "workday").length, 1);
  // Greenhouse is its own channel; Lever remains Etc
  assert.equal(filterJobsByChannel(jobs, "etc").length, 1);
});

test("search URL forces Salesforce US remote jobs from the last 7 days", () => {
  const url = new URL(
    buildIndeedSearchUrl({
      searchUrl: "https://www.indeed.com/jobs?l=New+York",
      query: "Salesforce Architect"
    })
  );
  assert.equal(url.hostname, "www.indeed.com");
  assert.equal(url.searchParams.get("q"), "Salesforce Architect");
  assert.equal(url.searchParams.get("l"), "Remote");
  assert.equal(url.searchParams.get("fromage"), "7");
  assert.match(String(url.searchParams.get("sc") || ""), /attr\(DSQF7\)/i);
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

test("US remote and 7-day gates reject onsite and stale posts", () => {
  const now = Date.parse("2026-08-24T12:00:00Z");
  assert.equal(
    isUsRemoteIndeedJob({
      title: "Salesforce Developer",
      location: "Remote",
      remoteRestrictedTo: "United States"
    }),
    true
  );
  assert.equal(
    isUsRemoteIndeedJob({
      title: "Salesforce Developer",
      location: "Austin, TX",
      jdText: "Onsite only in the office"
    }),
    false
  );
  assert.equal(
    isUsRemoteIndeedJob({
      title: "Salesforce Developer",
      location: "Remote - India"
    }),
    false
  );
  assert.equal(parseIndeedPostedAt("3 days ago", now), now - 3 * 24 * 60 * 60 * 1000);
  assert.equal(isPostedWithinDays({ postedText: "2 days ago" }, 7, now), true);
  assert.equal(isPostedWithinDays({ postedText: "30+ days ago" }, 7, now), false);
  assert.equal(
    isIndeedCaptureEligible(
      {
        title: "Salesforce Developer",
        location: "Remote",
        remoteRestrictedTo: "United States",
        postedText: "1 day ago",
        fromageFiltered: true
      },
      { now }
    ),
    true
  );
  assert.equal(
    isIndeedCaptureEligible(
      {
        title: "Sales Account Executive",
        location: "Remote",
        postedText: "1 day ago"
      },
      { now }
    ),
    false
  );
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
  assert.equal(external.remoteRestrictedTo, "");
  assert.equal(isUnitedStatesJob(external), false);

  const remote = normalizeIndeedCapturedJob(
    {
      title: "Salesforce Developer",
      company: "Acme",
      url: "https://www.indeed.com/viewjob?jk=def",
      description: "Apex remote United States",
      location: "Remote",
      isRemote: true,
      applyOnIndeed: true
    },
    10
  );
  assert.equal(remote.remoteRestrictedTo, "United States");
  assert.equal(isUnitedStatesJob(remote), true);
});

test("a weak refresh cannot erase prior hosted-apply evidence", () => {
  const merged = mergeIndeedApplyEvidence(
    { applyOnIndeed: true, hostedApply: true, externalApply: false },
    { applyEvidence: "unknown", applyOnIndeed: false, hostedApply: false, externalApply: false }
  );
  assert.equal(merged.applyEvidence, "hosted");
  assert.equal(merged.hostedApply, true);
  assert.equal(merged.externalApply, false);

  const explicitExternal = mergeIndeedApplyEvidence(
    { applyOnIndeed: true, hostedApply: true, externalApply: false },
    { applyEvidence: "external", externalApply: true }
  );
  assert.equal(explicitExternal.externalApply, true);
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
