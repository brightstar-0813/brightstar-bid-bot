import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSheetRowTsv,
  defaultSheetTabNameForPerson,
  sanitizeSheetTabName,
  truncateSheetJd
} from "../sheets.js";

test("sanitizeSheetTabName strips illegal Google Sheets characters", () => {
  assert.equal(sanitizeSheetTabName("Dmario / Lewis?"), "Dmario Lewis");
  assert.equal(sanitizeSheetTabName("A\\B*C[D]"), "A B C D");
});

test("sanitizeSheetTabName trims and caps length", () => {
  const long = "x".repeat(120);
  assert.equal(sanitizeSheetTabName(long).length, 100);
  assert.equal(sanitizeSheetTabName("  Hello  "), "Hello");
});

test("defaultSheetTabNameForPerson prefers label then name", () => {
  assert.equal(defaultSheetTabNameForPerson({ label: "D'mario Lewis" }), "D'mario Lewis");
  assert.equal(defaultSheetTabNameForPerson({ name: "Edrwin" }), "Edrwin");
  assert.equal(defaultSheetTabNameForPerson({}), "Profile");
});

test("buildSheetRowTsv puts JD before Status (Status last)", () => {
  const row = buildSheetRowTsv({
    jobNo: "12",
    jobTitle: "SF Architect",
    companyName: "Acme",
    jdLink: "https://example.com/job",
    salary: "150k",
    status: "Ready",
    jdText: "Build Lightning apps",
    includeDate: false
  });
  assert.equal(
    row,
    "12\t\tSF Architect\tAcme\thttps://example.com/job\t150k\tBuild Lightning apps\tReady"
  );
});

test("truncateSheetJd caps long descriptions", () => {
  const long = "a".repeat(50000);
  const out = truncateSheetJd(long, 100);
  assert.equal(out.length, 100);
  assert.ok(out.endsWith("…"));
});
