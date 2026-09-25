import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyEmptyProfileKey,
  classifyPasswordMatchSource,
  choiceAnswerMatchesOptions,
  isPasswordFieldLabel,
  isShortGenericAnswer,
  shouldOverwriteQaRecord
} from "../autofill-classify.js";

test("classifyEmptyProfileKey marks addressLine2 optional when empty", () => {
  assert.equal(classifyEmptyProfileKey("addressLine2", { required: false }), "optional");
  assert.equal(classifyEmptyProfileKey("selfIdentifyLanguage", { required: true }), "optional");
  assert.equal(classifyEmptyProfileKey("phone", { required: true }), "unmatched");
  assert.equal(classifyEmptyProfileKey("phone", { required: false }), "unmatched");
});

test("password labels and credential match sources", () => {
  assert.equal(isPasswordFieldLabel("Choose Password:"), true);
  assert.equal(isPasswordFieldLabel("Retype Password:"), true);
  assert.equal(isPasswordFieldLabel("Home Phone:"), false);
  assert.equal(classifyPasswordMatchSource(true), "credential");
  assert.equal(classifyPasswordMatchSource(false), "optional");
});

test("choiceAnswerMatchesOptions skips non-matching answers", () => {
  const opts = ["Employee Referral", "Job Board", "Other"];
  assert.equal(choiceAnswerMatchesOptions("Job Board", opts), true);
  assert.equal(choiceAnswerMatchesOptions("LinkedIn", opts), false);
  assert.equal(choiceAnswerMatchesOptions("Yes", ["Yes", "No"]), true);
  assert.equal(choiceAnswerMatchesOptions("No", ["Non-Hispanic", "Hispanic"]), false);
  assert.equal(choiceAnswerMatchesOptions("Anything", []), true);
});

test("isShortGenericAnswer detects yes/no/na", () => {
  assert.equal(isShortGenericAnswer("Yes"), true);
  assert.equal(isShortGenericAnswer("N/A"), true);
  assert.equal(isShortGenericAnswer("Employee Referral"), false);
});

test("shouldOverwriteQaRecord protects user/ai from weak scraped writes", () => {
  const userRec = { source: "user", answer: "Employee Referral" };
  assert.equal(
    shouldOverwriteQaRecord(userRec, { source: "scraped", answer: "Other", silent: true }),
    false
  );
  assert.equal(
    shouldOverwriteQaRecord(userRec, { source: "user", answer: "Updated referral", silent: false }),
    true
  );
  assert.equal(
    shouldOverwriteQaRecord(null, { source: "scraped", answer: "Yes", silent: true }),
    true
  );
});
