import test from "node:test";
import assert from "node:assert/strict";

import {
  isJunkAutofillAnswer,
  isJunkQuestionLabel,
  isJunkQaRecord,
  normalizeChoiceAnswerValue
} from "../autofill-junk.js";

test("isJunkAutofillAnswer rejects polluted answers", () => {
  assert.equal(isJunkAutofillAnswer(""), true);
  assert.equal(isJunkAutofillAnswer("Format Paragraph"), true);
  assert.equal(isJunkAutofillAnswer("Choose file"), true);
  assert.equal(isJunkAutofillAnswer("5208604529", { questionLabel: "Why are you interested?" }), true);
  assert.equal(isJunkAutofillAnswer("Yes", { questionLabel: "Are you authorized to work in the US?" }), false);
  assert.equal(
    isJunkAutofillAnswer("a".repeat(600), { questionLabel: "Are you willing to relocate?" }),
    true
  );
});

test("isJunkQuestionLabel rejects upload chrome and profile duplicates", () => {
  assert.equal(isJunkQuestionLabel("First Name*"), true);
  assert.equal(isJunkQuestionLabel("Autofill from resumeUpload your resume here"), true);
  assert.equal(isJunkQuestionLabel("Are you legally authorized to work in the United States?"), false);
});

test("isJunkQaRecord combines question and answer checks", () => {
  assert.equal(
    isJunkQaRecord({
      question: "Upload your resume here",
      answer: "5208604529"
    }),
    true
  );
  assert.equal(
    isJunkQaRecord({
      question: "Desired Salary",
      answer: "$100000"
    }),
    false
  );
});

test("normalizeChoiceAnswerValue maps common variants", () => {
  assert.equal(normalizeChoiceAnswerValue("y"), "Yes");
  assert.equal(normalizeChoiceAnswerValue("TRUE"), "Yes");
  assert.equal(normalizeChoiceAnswerValue("I agree"), "Yes");
  assert.equal(normalizeChoiceAnswerValue("n"), "No");
  assert.equal(normalizeChoiceAnswerValue("Decline"), "No");
  assert.equal(normalizeChoiceAnswerValue("United States"), "United States");
});
