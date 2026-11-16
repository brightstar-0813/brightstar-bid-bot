import assert from "node:assert/strict";
import test from "node:test";
import { canFetchJdFromLink, cleanJobPageText, isUsableJdText } from "../jd-from-page.js";

test("JD links: http(s) yes, LinkedIn and junk no", () => {
  assert.equal(canFetchJdFromLink("https://www.skipthedrive.com/job/onetrust-salesforce-administrator-1489139/"), true);
  assert.equal(canFetchJdFromLink("https://www.glassdoor.com/job-listing/j?jl=1010321163263"), true);
  assert.equal(canFetchJdFromLink("https://www.linkedin.com/jobs/view/123"), false);
  assert.equal(canFetchJdFromLink("https://linkedin.com/jobs/view/123"), false);
  assert.equal(canFetchJdFromLink("javascript:alert(1)"), false);
  assert.equal(canFetchJdFromLink(""), false);
});

test("page text is collapsed and capped", () => {
  assert.equal(cleanJobPageText("  Senior   Dev \n\n\n  Remote\t US  "), "Senior Dev\nRemote US");
  assert.equal(cleanJobPageText("x".repeat(20000)).length, 12000);
});

test("usable JD: long posting yes, short or closed notice no", () => {
  const posting = "We are hiring a Salesforce Administrator. ".repeat(20);
  assert.equal(isUsableJdText(posting), true);
  assert.equal(isUsableJdText("Sign in to continue"), false);
  assert.equal(isUsableJdText(`This job is no longer available. ${"Browse other jobs. ".repeat(30)}`), false);
});
