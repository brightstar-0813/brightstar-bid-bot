import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAtsScore } from "../ats-score.js";

const jd = `
Salesforce Technical Architect
Design Service Cloud solutions using Apex, Lightning Web Components, SOQL, and MuleSoft.
Lead integrations, data migration, security, and enterprise architecture.
`;

const strongResume = {
  name: "Candidate",
  email: "candidate@example.com",
  headline: "Salesforce Technical Architect",
  profile:
    "Salesforce architect delivering enterprise Service Cloud integrations, security, and data migration.",
  technicalSummary: ["Apex", "Lightning Web Components", "SOQL", "MuleSoft"],
  skills: [
    { category: "Salesforce Clouds", items: "Service Cloud" },
    { category: "Development", items: "Apex, LWC, SOQL, MuleSoft" }
  ],
  experience: [
    {
      company: "Acme",
      title: "Salesforce Technical Architect",
      bullets: [
        "Led Service Cloud architecture and MuleSoft integrations.",
        "Built Apex, Lightning Web Components, and SOQL data migration services."
      ]
    }
  ],
  education: [{ school: "University" }]
};

test("ATS score rewards JD keyword and Salesforce product coverage", () => {
  const strong = evaluateAtsScore(strongResume, {
    jdText: jd,
    jobTitle: "Salesforce Technical Architect"
  });
  const weak = evaluateAtsScore(
    {
      name: "Candidate",
      email: "candidate@example.com",
      profile: "Experienced technology professional.",
      skills: [{ category: "General", items: "Communication" }],
      experience: [{ company: "Acme", bullets: ["Worked with business teams."] }]
    },
    { jdText: jd, jobTitle: "Salesforce Technical Architect" }
  );

  assert.ok(strong.score >= 80, `expected strong score, received ${strong.score}`);
  assert.ok(strong.score > weak.score);
  assert.equal(strong.missingProducts.length, 0);
  assert.ok(weak.missingProducts.includes("Service Cloud"));
});

test("ATS scoring is deterministic for identical inputs", () => {
  const first = evaluateAtsScore(strongResume, {
    jdText: jd,
    jobTitle: "Salesforce Technical Architect"
  });
  const second = evaluateAtsScore(strongResume, {
    jdText: jd,
    jobTitle: "Salesforce Technical Architect"
  });
  assert.equal(first.score, second.score);
  assert.deepEqual(first.components, second.components);
  assert.deepEqual(first.missingKeywords, second.missingKeywords);
});
