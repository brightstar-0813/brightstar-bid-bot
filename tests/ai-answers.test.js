import test from "node:test";
import assert from "node:assert/strict";

import {
  answerCertificationQuestion,
  bankAnswerFitsQuestion,
  compactApplicantContext,
  buildCustomQaPayload,
  normalizeSkillList,
  normalizeRecentRoles
} from "../ai-answers.js";

const CERTS = [
  "Salesforce Certified Administrator",
  "Salesforce Certified Application Architect",
  "Salesforce Certified Platform App Builder"
];

test("answerCertificationQuestion returns Yes/No from profile certs", () => {
  assert.equal(
    answerCertificationQuestion(
      "Do you hold any current Salesforce Platform Developer certifications?",
      CERTS
    ),
    "No"
  );
  assert.equal(
    answerCertificationQuestion(
      "Do you hold any current Salesforce Platform App Builder certifications?",
      CERTS
    ),
    "Yes"
  );
  assert.equal(
    answerCertificationQuestion("Do you hold any Salesforce certifications?", CERTS),
    "Yes"
  );
  assert.equal(
    answerCertificationQuestion("Do you hold any Salesforce certifications?", []),
    "No"
  );
});

test("bankAnswerFitsQuestion accepts Yes/No for hold-cert prompts", () => {
  assert.equal(
    bankAnswerFitsQuestion("Do you hold any current Salesforce Platform Developer certifications?", "No"),
    true
  );
  assert.equal(
    bankAnswerFitsQuestion("Do you hold any current Salesforce Platform Developer certifications?", "Yes"),
    true
  );
});

test("compactApplicantContext includes role, skills, and certs", () => {
  const ctx = compactApplicantContext({
    firstName: "Edrwin",
    currentEmployer: "Accenture",
    currentJobTitle: "Salesforce Developer",
    workAuthorized: "yes",
    needsSponsorship: "no",
    certifications: CERTS,
    skills: ["Apex", "LWC", "Flow"],
    recentRoles: [{ company: "Accenture", title: "SF Dev", current: true }]
  });
  assert.equal(ctx.currentEmployer, "Accenture");
  assert.equal(ctx.currentJobTitle, "Salesforce Developer");
  assert.deepEqual(ctx.certifications, CERTS);
  assert.ok(ctx.skills.includes("Apex"));
  assert.equal(ctx.recentRoles[0].company, "Accenture");
});

test("buildCustomQaPayload exposes knownFacts for grounding", () => {
  const payload = buildCustomQaPayload({
    question: "Do you require sponsorship?",
    applicantInfo: {
      firstName: "Edrwin",
      needsSponsorship: "no",
      workAuthorized: "yes",
      certifications: CERTS,
      currentJobTitle: "Developer",
      currentEmployer: "Accenture"
    },
    resumeText: "Resume body with Apex experience"
  });
  assert.equal(payload.knownFacts.needsSponsorship, "no");
  assert.ok(payload.knownFacts.certifications.length >= 3);
  assert.match(payload.knownFacts.currentRole, /Accenture/);
  assert.equal(payload.candidateProfile.firstName, "Edrwin");
  assert.ok(String(payload.resumeExcerpt || "").includes("Apex"));
});

test("normalizeSkillList and normalizeRecentRoles flatten resume shapes", () => {
  assert.deepEqual(normalizeSkillList(["Apex", "Apex", "LWC"]).slice(0, 2), ["Apex", "LWC"]);
  assert.deepEqual(
    normalizeSkillList([{ category: "Core", items: ["Flow", "SOQL"] }]),
    ["Flow", "SOQL"]
  );
  assert.equal(
    normalizeRecentRoles([{ company: "Capgemini", title: "Consultant", bullets: ["a", "b"] }])[0]
      .company,
    "Capgemini"
  );
});
