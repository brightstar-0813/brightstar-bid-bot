import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "content/autofill.js"), "utf8");
const m = /\/\/ @pure-begin job-gone-url[^\n]*\n([\s\S]*?)\/\/ @pure-end job-gone-url/.exec(src);
assert.ok(m, "job-gone-url block not found in content/autofill.js");
const sandbox = { URL };
vm.runInNewContext(`${m[1]}\nthis.jobGoneFromUrl = jobGoneFromUrl;`, sandbox);
const gone = sandbox.jobGoneFromUrl;

test("Workable dead job redirect (?not_found=true) is a closed job", () => {
  assert.equal(gone("https://apply.workable.com/hunt-st/?not_found=true"), true);
});

test("Greenhouse board ?error=true is a closed job, other hosts are not", () => {
  assert.equal(gone("https://job-boards.greenhouse.io/acme?error=true"), true);
  assert.equal(gone("https://example.com/careers?error=true"), false);
});

test("Himalayas board root (/jobs) after a listing redirect is a closed job", () => {
  assert.equal(gone("https://himalayas.app/jobs"), true);
  assert.equal(gone("https://himalayas.app/jobs/"), true);
  assert.equal(gone("https://himalayas.app/companies/humana/jobs/software-engineer"), false);
  assert.equal(gone("https://himalayas.app/jobs/salesforce-developer"), false);
});

test("live postings and junk are not closed", () => {
  assert.equal(gone("https://apply.workable.com/hunt-st/j/ABC123/apply/"), false);
  assert.equal(gone("https://job-boards.greenhouse.io/mongodb/jobs/7991447"), false);
  assert.equal(gone(""), false);
  assert.equal(gone("not a url"), false);
});
