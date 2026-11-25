import test from "node:test";
import assert from "node:assert/strict";

import {
  certificationsFromSourceText,
  extractMasterCertifications,
  mergeMissingCertifications
} from "../resume-text.js";
import { enforceMasterCertifications } from "../ai-answers.js";
import {
  SHIRA_LEFF_MASTER,
  VICTOR_HOLANDA_SF_MASTER,
  VICTOR_HOLANDA_DE_MASTER
} from "../prompts/builtin-master-resumes.js";

const SOURCE = `Michael Haries Namuco Ibea
Senior Salesforce Developer

Certifications
- AWS Data Analytics Specialty — Amazon Web Services (AWS)
- SnowPro Core Certification — Snowflake
- AWS Big Data Specialty — Amazon Web Services (AWS)
- AWS Cloud Practitioner — Amazon Web Services (AWS)
- Datorama Certified Consultant — Datorama, a Salesforce company
- Data Science Foundations: Fundamentals — Lynda.com
- Domo Certified Consultant — Domo
`;

test("certificationsFromSourceText reads every line under the Certifications heading", () => {
  const certs = certificationsFromSourceText(SOURCE);
  assert.equal(certs.length, 7);
  assert.match(certs[4], /^Datorama Certified Consultant/);
  assert.match(certs[6], /^Domo Certified Consultant/);
});

test("certificationsFromSourceText is empty without a certifications section", () => {
  assert.deepEqual(certificationsFromSourceText("Jane Doe\nSummary\nBuilds things."), []);
  assert.deepEqual(certificationsFromSourceText(""), []);
});

test("a draft that kept only two certifications gets the other five back", () => {
  const sourceCerts = certificationsFromSourceText(SOURCE);
  const draft = {
    name: "Michael Haries Namuco Ibea",
    certifications: ["Datorama Certified Consultant", "Domo Certified Consultant"]
  };
  const merged = mergeMissingCertifications(draft, sourceCerts);
  assert.equal(merged.data.certifications.length, 7);
  assert.equal(merged.added.length, 5);
  // The two the model kept are not duplicated.
  assert.equal(
    merged.data.certifications.filter((c) => /Datorama Certified Consultant/.test(c)).length,
    1
  );
  assert.ok(merged.data.certifications.some((c) => /Amazon Web Services/.test(c)));
});

test("nothing is added when the draft already has every source certification", () => {
  const sourceCerts = certificationsFromSourceText(SOURCE);
  const draft = { certifications: [...sourceCerts] };
  const merged = mergeMissingCertifications(draft, sourceCerts);
  assert.deepEqual(merged.added, []);
  assert.equal(merged.data, draft);
});

test("name matching: a shortened label does not hide a different certification", () => {
  const merged = mergeMissingCertifications(
    { certifications: ["AWS"] },
    ["AWS Certified Cloud Practitioner — Amazon Web Services (AWS)"]
  );
  assert.equal(merged.added.length, 1);
  assert.equal(merged.data.certifications.length, 2);
});

test("object-shaped certifications from the model are matched by name", () => {
  const merged = mergeMissingCertifications(
    { certifications: [{ name: "Domo Certified Consultant" }] },
    ["Domo Certified Consultant — Domo", "SnowPro Core Certification — Snowflake"]
  );
  assert.equal(merged.added.length, 1);
  assert.equal(merged.added[0], "SnowPro Core Certification — Snowflake");
});

test("a draft without a certifications field receives the source list", () => {
  const merged = mergeMissingCertifications({ name: "X" }, ["SnowPro Core Certification — Snowflake"]);
  assert.deepEqual(merged.data.certifications, ["SnowPro Core Certification — Snowflake"]);
});

test("None. masters never yield a literal None certification", () => {
  const extracted = extractMasterCertifications("Name\nCERTIFICATIONS\nNone.\n");
  assert.equal(extracted.hasSection, true);
  assert.equal(extracted.explicitEmpty, true);
  assert.deepEqual(extracted.certifications, []);
  assert.deepEqual(certificationsFromSourceText("Name\nCERTIFICATIONS\nNone.\n"), []);
});

test("DMario-style disclaimer is not glued onto the SCA bullet", () => {
  const master = `DMario
CERTIFICATIONS
- Salesforce Certified Administrator (SCA)
No developer-track, architect-track, or consultant-track Salesforce certification.
`;
  const certs = certificationsFromSourceText(master);
  assert.deepEqual(certs, ["Salesforce Certified Administrator (SCA)"]);
});

test("Platform Developer I does not suppress Platform Developer II", () => {
  const merged = mergeMissingCertifications(
    { certifications: ["Salesforce Certified Platform Developer I"] },
    [
      "Salesforce Certified Platform Developer I",
      "Salesforce Certified Platform Developer II"
    ]
  );
  assert.equal(merged.added.length, 1);
  assert.match(merged.added[0], /Developer II/);
});

test("built-in Victor SF master locks six Salesforce credentials", () => {
  const out = enforceMasterCertifications(
    { name: "Victor", certifications: ["Made Up"] },
    VICTOR_HOLANDA_SF_MASTER
  );
  assert.equal(out.certifications.length, 6);
  assert.ok(out.certifications.every((c) => /Salesforce Certified/i.test(c)));
});

test("built-in Victor DE master clears invented certs (explicit None)", () => {
  const out = enforceMasterCertifications(
    { name: "Victor", certifications: ["AWS Solutions Architect"] },
    VICTOR_HOLANDA_DE_MASTER
  );
  assert.deepEqual(out.certifications, []);
});

test("built-in Shira master keeps every DE credential including Teaching Certificate", () => {
  const certs = certificationsFromSourceText(SHIRA_LEFF_MASTER);
  assert.ok(certs.length >= 7);
  assert.ok(certs.some((c) => /SnowPro/i.test(c)));
  assert.ok(certs.some((c) => /Teaching Certificate/i.test(c)));
  const locked = enforceMasterCertifications({ certifications: ["Domo Certified Consultant"] }, SHIRA_LEFF_MASTER);
  assert.equal(locked.certifications.length, certs.length);
});
