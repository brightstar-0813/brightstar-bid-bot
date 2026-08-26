import test from "node:test";
import assert from "node:assert/strict";

import {
  filterJobsByChannel,
  isGreenhouseJob,
  isJobgetherJob,
  isWorkdayJob,
  normalizeChannelFilter
} from "../csv.js";
import {
  detectCompensationStyle,
  formatCompensationExpectation,
  DEFAULT_ANNUAL_COMPENSATION,
  DEFAULT_HOURLY_COMPENSATION
} from "../compensation-format.js";
import { extractGreenhouseSecurityCode } from "../ms-graph-mail.js";

test("Greenhouse URLs and channel filter", () => {
  assert.equal(
    isGreenhouseJob({ jdLink: "https://boards.greenhouse.io/acme/jobs/123" }),
    true
  );
  assert.equal(
    isGreenhouseJob({
      jdLink: "https://job-boards.greenhouse.io/embed/job_app?for=ifit&token=4283955009"
    }),
    true
  );
  assert.equal(
    isGreenhouseJob({ jdLink: "https://www.dice.com/job-detail/abc" }),
    false
  );
  assert.equal(normalizeChannelFilter("greenhouse"), "greenhouse");
  assert.equal(normalizeChannelFilter("gh"), "greenhouse");

  const jobs = [
    { jdLink: "https://company.wd1.myworkdayjobs.com/en-US/careers/job/1" },
    { jdLink: "https://www.dice.com/jobs/1" },
    { jdLink: "https://boards.greenhouse.io/acme/1" },
    { jdLink: "https://jobs.lever.co/acme/1" }
  ];
  assert.equal(filterJobsByChannel(jobs, "greenhouse").length, 1);
  assert.equal(filterJobsByChannel(jobs, "workday").length, 1);
  // Etc excludes Greenhouse
  assert.equal(filterJobsByChannel(jobs, "etc").length, 1);
  assert.equal(
    isGreenhouseJob({ jdLink: "https://boards.greenhouse.io/acme/1" }) &&
      !isWorkdayJob({ jdLink: "https://boards.greenhouse.io/acme/1" }),
    true
  );
});

test("Jobgether aggregator URLs stay in Etc and are detected", () => {
  assert.equal(isJobgetherJob({ jdLink: "https://jobgether.com/offer/abc123" }), true);
  assert.equal(isJobgetherJob({ jdLink: "https://www.jobgether.com/jobs/x" }), true);
  assert.equal(isJobgetherJob({ jdLink: "https://boards.greenhouse.io/acme/1" }), false);
  const jobs = [
    { jdLink: "https://jobgether.com/offer/1" },
    { jdLink: "https://www.dice.com/job-detail/1" },
    { jdLink: "https://company.wd1.myworkdayjobs.com/en-US/job/1" }
  ];
  assert.equal(filterJobsByChannel(jobs, "etc").length, 1);
  assert.equal(filterJobsByChannel(jobs, "workday").length, 1);
  assert.equal(isJobgetherJob(jobs[0]), true);
});

test("compensation style detection and formatting", () => {
  assert.equal(detectCompensationStyle("Desired Compensation *"), "annual");
  assert.equal(detectCompensationStyle("Expected hourly rate"), "hourly");
  assert.equal(detectCompensationStyle("Enter a number only"), "number");

  assert.equal(
    formatCompensationExpectation("", "Desired Compensation"),
    DEFAULT_ANNUAL_COMPENSATION
  );
  assert.equal(
    formatCompensationExpectation("", "Hourly rate"),
    DEFAULT_HOURLY_COMPENSATION
  );
  assert.equal(formatCompensationExpectation("", "Amount (number only)", {}), "120000");
  assert.equal(
    formatCompensationExpectation("$120000/yr", "Desired Compensation"),
    "$120000/yr"
  );
  assert.equal(
    formatCompensationExpectation("60", "Hourly pay"),
    "$60 per hour"
  );
  assert.equal(
    formatCompensationExpectation("120000", "Annual salary"),
    "$120000/yr"
  );
});

test("Greenhouse security code extraction from email body", () => {
  const sample = `
Hi D'mario,

Copy and paste this code into the security code field on your application:

0wPbvHmX

After you enter the code, resubmit your application.
`;
  assert.equal(extractGreenhouseSecurityCode(sample), "0wPbvHmX");

  const html = `
<p>Copy and paste this code into the security code field on your application:</p>
<p style="font-size:24px"><b>Ab12Cd34</b></p>
`;
  assert.equal(extractGreenhouseSecurityCode(html), "Ab12Cd34");

  assert.equal(extractGreenhouseSecurityCode("no code here"), "");
});
