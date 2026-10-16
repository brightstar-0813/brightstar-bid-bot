import test from "node:test";
import assert from "node:assert/strict";

import { tabAlreadyOnJob, toAbsoluteHttpUrl } from "../autofill-runner.js";

test("toAbsoluteHttpUrl adds https when the scheme is missing", () => {
  assert.equal(
    toAbsoluteHttpUrl("boards.greenhouse.io/acme/jobs/1"),
    "https://boards.greenhouse.io/acme/jobs/1"
  );
  assert.equal(toAbsoluteHttpUrl("https://dice.com/job-detail/x"), "https://dice.com/job-detail/x");
});

test("tabAlreadyOnJob keeps the job and its apply step, not a parent board", () => {
  const job = "https://boards.greenhouse.io/acme/jobs/99";
  assert.equal(tabAlreadyOnJob(job, job), true);
  assert.equal(tabAlreadyOnJob("https://boards.greenhouse.io/acme/jobs/99/application", job), true);
  assert.equal(tabAlreadyOnJob("https://boards.greenhouse.io/acme", job), false);
  assert.equal(tabAlreadyOnJob("https://www.indeed.com/jobs?q=salesforce", "https://www.indeed.com/viewjob?jk=abc"), false);
});
