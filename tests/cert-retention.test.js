import test from "node:test";
import assert from "node:assert/strict";

import { certificationsFromSourceText, mergeMissingCertifications } from "../resume-text.js";

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
