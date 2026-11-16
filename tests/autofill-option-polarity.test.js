import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

// content/autofill.js is one IIFE (also injected alone), so the pure block is cut out and run here.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "content/autofill.js"), "utf8");
const m = /\/\/ @pure-begin option-polarity[^\n]*\n([\s\S]*?)\/\/ @pure-end option-polarity/.exec(src);
assert.ok(m, "option-polarity block not found in content/autofill.js");
const sandbox = {};
vm.runInNewContext(`${m[1]}\nthis.optionPolarityConflict = optionPolarityConflict;`, sandbox);
const conflict = sandbox.optionPolarityConflict;

// Inputs mimic normalizeLoose output: lower case, punctuation → spaces.
const loose = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

test("disability: 'No, I do not have…' never matches the Yes option (MongoDB Greenhouse)", () => {
  const want = loose("No, I do not have a disability");
  assert.equal(conflict(loose("Yes, I have a disability, or have had one in the past"), want), true);
  assert.equal(conflict(loose("No, I do not have a disability and have not had one in the past"), want), false);
});

test("leading Yes/No must agree", () => {
  assert.equal(conflict(loose("Yes, I am a veteran"), loose("No, I am not a veteran")), true);
  assert.equal(conflict(loose("Yes, I have a disability"), loose("Yes, I have a disability, or have had one")), false);
});

test("negated answer vs affirmative option conflict", () => {
  assert.equal(conflict(loose("Hispanic or Latino"), loose("Not Hispanic or Latino")), true);
  assert.equal(conflict(loose("I am not a protected veteran"), loose("I am not a protected veteran")), false);
  assert.equal(conflict(loose("I identify as one or more of the classifications of a protected veteran"), loose("I identify as a protected veteran")), false);
  assert.equal(conflict(loose("I don't wish to answer"), loose("Prefer not to say")), false);
});
