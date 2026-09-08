import test from "node:test";
import assert from "node:assert/strict";

import {
  isJunkAutofillAnswer,
  isJunkQuestionLabel,
  isJunkQaRecord,
  isSensitiveProfileQuestion,
  normalizeChoiceAnswerValue,
  cleanAutofillLabelText,
  isBareChoiceOptionLabel,
  isTrackingNoiseLabel
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
  assert.equal(isJunkQuestionLabel("Yes"), true);
  assert.equal(isJunkQuestionLabel("No"), true);
  assert.equal(isJunkQuestionLabel("udff em"), true);
  assert.equal(isJunkQuestionLabel("cd buttonfeatures"), true);
});

test("cleanAutofillLabelText strips char counters", () => {
  assert.equal(
    cleanAutofillLabelText("* 2/1000 How many years of experience do you have with Apex?"),
    "How many years of experience do you have with Apex?"
  );
  assert.equal(cleanAutofillLabelText("1/1000 years"), "years");
});

test("isBareChoiceOptionLabel and isTrackingNoiseLabel", () => {
  assert.equal(isBareChoiceOptionLabel("Yes"), true);
  assert.equal(isBareChoiceOptionLabel("Are you authorized?"), false);
  assert.equal(isTrackingNoiseLabel("fbp"), true);
  assert.equal(isTrackingNoiseLabel("audff zp"), true);
  assert.equal(isTrackingNoiseLabel("zip"), false);
  assert.equal(isTrackingNoiseLabel("How many years of Apex experience?"), false);
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
      answer: "150000"
    }),
    false
  );
});

test("isSensitiveProfileQuestion flags identity fields", () => {
  assert.equal(isSensitiveProfileQuestion("Email Address"), true);
  assert.equal(isSensitiveProfileQuestion("Why do you want this role?"), false);
});

test("normalizeChoiceAnswerValue canonicalizes yes/no", () => {
  assert.equal(normalizeChoiceAnswerValue("y"), "Yes");
  assert.equal(normalizeChoiceAnswerValue("false"), "No");
  assert.equal(normalizeChoiceAnswerValue("Maybe"), "Maybe");
});
