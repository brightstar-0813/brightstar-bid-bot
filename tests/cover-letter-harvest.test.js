import test from "node:test";
import assert from "node:assert/strict";
import { extractCoverLetterText, looksLikeCoverLetterBody } from "../cover-letter-harvest.js";

const culligan = [
  "At Culligan International, I design Salesforce solutions supporting dental and commercial selling, product and client operations, and revenue control aligned with the work this role with Revenue Cloud covers.",
  "Over more than 15 years as a Salesforce Engineer and Architect, I have owned discovery, delivery, customer work, revenue operations, and enterprise CRM architecture, translating business requirements into solutions that teams can use and maintain.",
  "I would welcome the chance to discuss my experience at Culligan further. Thank you for your time and consideration."
].join("\n\n");

const taproot = [
  "As a Taproot Solutions architect, I lead technical architecture and hands-on delivery for a healthcare Salesforce engineering role using Health Cloud, Service Cloud, Data Cloud, and Experience Cloud.",
  "I design patient and provider data models, build Apex services, Lightning Web Components, and Flow automations, and architect the CRM integrations that keep clinical operations in sync.",
  "I would welcome the opportunity to discuss how that Salesforce architecture and delivery experience can help the team. Thank you for your time and exploration."
].join("\n\n");

const resumeJson = JSON.stringify({
  name: "D'Mario Lewis",
  experience: [{ company: "Culligan", title: "Architect", bullets: ["Revenue Cloud"] }],
  technicalSummary: ["Apex", "LWC"],
  certifications: ["PD1"]
});

test("accepts a finished letter that does not start with Dear", () => {
  assert.equal(looksLikeCoverLetterBody(culligan), true);
  assert.equal(extractCoverLetterText(culligan), culligan);
  assert.equal(looksLikeCoverLetterBody(taproot), true);
  assert.match(extractCoverLetterText(taproot), /^As a Taproot Solutions/);
});

test("keeps the letter and drops a leading resume JSON object", () => {
  const mixed = `${resumeJson}\n\n${culligan}`;
  const letter = extractCoverLetterText(mixed);
  assert.match(letter, /^At Culligan International/);
  assert.equal(/"experience"\s*:/.test(letter), false);
  assert.equal(/"technicalSummary"\s*:/.test(letter), false);
  assert.equal(letter.includes("D'Mario Lewis"), false);
});

test("still accepts a Dear Hiring Manager letter", () => {
  const dear = [
    "Dear Hiring Manager,",
    "I am writing to apply for the Salesforce Architect role and to outline how my delivery work maps to the team's Revenue Cloud and integration needs.",
    "Thank you for your time and consideration."
  ].join("\n\n");
  const letter = extractCoverLetterText(`${resumeJson}\n\n${dear}`);
  assert.match(letter, /^Dear Hiring Manager,/);
  assert.equal(/"experience"\s*:/.test(letter), false);
});

test("rejects resume JSON that has no letter after it", () => {
  assert.equal(extractCoverLetterText(resumeJson), "");
  assert.equal(looksLikeCoverLetterBody(resumeJson), false);
  assert.equal(extractCoverLetterText(""), "");
});
