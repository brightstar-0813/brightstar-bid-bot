import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSheetRowTsv,
  defaultSheetTabNameForPerson,
  resolveSheetTabNameForPerson,
  sanitizeSheetTabName
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

test("defaultSheetTabNameForPerson uses Firstname-TRACK", () => {
  assert.equal(
    defaultSheetTabNameForPerson({ label: "Sandeep Mahankali", name: "Sandeep Mahankali", roleTrack: "sf" }),
    "Sandeep-SF"
  );
  assert.equal(
    defaultSheetTabNameForPerson({ name: "David Leandro de Oliveira", roleTrack: "de" }),
    "David-DE"
  );
  assert.equal(defaultSheetTabNameForPerson({ name: "Edrwin" }), "Edrwin-SF");
  assert.equal(defaultSheetTabNameForPerson({}), "Profile-SF");
});

test("resolveSheetTabNameForPerson keeps explicit tabs, regenerates full-name leftovers", () => {
  assert.equal(
    resolveSheetTabNameForPerson({
      label: "Sandeep Mahankali",
      name: "Sandeep Mahankali",
      roleTrack: "sf",
      sheetTabName: "Sandeep-SF"
    }),
    "Sandeep-SF"
  );
  assert.equal(
    resolveSheetTabNameForPerson({
      label: "Sandeep Mahankali",
      name: "Sandeep Mahankali",
      roleTrack: "sf",
      sheetTabName: "Sandeep Mahankali"
    }),
    "Sandeep-SF"
  );
  assert.equal(
    resolveSheetTabNameForPerson({
      label: "Jane Doe",
      name: "Jane Doe",
      roleTrack: "fs",
      sheetTabName: "Team-Jane"
    }),
    "Team-Jane"
  );
});

test("buildSheetRowTsv ends with Status and has no JD column", () => {
  const row = buildSheetRowTsv({
    jobNo: "12",
    jobTitle: "SF Architect",
    companyName: "Acme",
    jdLink: "https://example.com/job",
    salary: "150k",
    status: "Ready",
    includeDate: false
  });
  assert.equal(row, "12\t\tSF Architect\tAcme\thttps://example.com/job\t150k\tReady");
});
