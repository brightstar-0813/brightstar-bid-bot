import test from "node:test";
import assert from "node:assert/strict";
import { isCompensationQuestion, parsePostedPay, standardPayAnswer } from "../standard-answers.js";
import { shouldExcludeFromAiAndBank, stripAiMarkup } from "../autofill-junk.js";

test("compensation questions include rate/wage wording, not skill ratings", () => {
  for (const q of ["What is your expected hourly rate?", "Desired salary", "Pay rate (USD)", "Rate expectation per hour", "What are your wage requirements?", "Expected compensation"]) {
    assert.equal(isCompensationQuestion(q), true, q);
  }
  for (const q of ["Rate your Apex proficiency from 1 to 5", "Years of Salesforce experience", "Start date"]) {
    assert.equal(isCompensationQuestion(q), false, q);
  }
});

test("rate questions are never answered by AI or the Q&A bank", () => {
  assert.equal(shouldExcludeFromAiAndBank("What is your expected hourly rate?"), true);
  assert.equal(shouldExcludeFromAiAndBank("Pay rate (USD)"), true);
});

test("posted range → lowest value; converts units", () => {
  assert.deepEqual(parsePostedPay("$120,000–$130,000"), { min: 120000, max: 130000, unit: "yearly" });
  assert.equal(standardPayAnswer({ label: "Desired salary", postedPay: "$120,000–$130,000" }).amount, 120000);
  assert.equal(standardPayAnswer({ label: "Expected hourly rate", postedPay: "$120,000–$130,000" }).amount, 58);
  assert.equal(standardPayAnswer({ label: "Desired salary", postedPay: "$55 - $65/hr" }).amount, 114400);
  assert.equal(standardPayAnswer({ label: "Hourly rate", postedPay: "$55 - $65/hr" }).text, "$55/hour");
});

test("no posted pay → $150,000/year (≈ $72/hour, $12,500/month)", () => {
  assert.equal(standardPayAnswer({ label: "Desired salary" }).text, "$150,000/year");
  assert.equal(standardPayAnswer({ label: "Expected hourly rate" }).text, "$72/hour");
  assert.equal(standardPayAnswer({ label: "Monthly salary expectation" }).text, "$12,500/month");
});
test("AI answers lose ChatGPT canvas wrappers", () => {
  const raw = '<WritingBlock id="53532" variant="document">Dear Hiring Manager,\n\nI am excited…</WritingBlock>';
  assert.equal(stripAiMarkup(raw), "Dear Hiring Manager,\n\nI am excited…");
  assert.equal(stripAiMarkup("Yes 【4:0†source】"), "Yes");
});
