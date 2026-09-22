import test from "node:test";
import assert from "node:assert/strict";

import {
  buildJobFolderName,
  csvRowFromFolderName,
  folderFitsJob,
  isDatePrefixedFolder,
  isLegacyRowPrefixedFolder,
  isRowDatePrefixedFolder,
  jobDirMatchesCsvRow,
  normalizeCsvRow
} from "../job-folder.js";

const JOB = {
  companyName: "Socium",
  jobTitle: "Senior Salesforce Developer",
  savedAt: new Date(2026, 8, 21)
};

test("folder name leads with the sheet row", () => {
  assert.equal(
    buildJobFolderName({ ...JOB, csvRow: 16 }),
    "16_9-21_Socium-Senior Salesforce Developer"
  );
  assert.equal(
    buildJobFolderName({ ...JOB, csvRow: "16" }),
    "16_9-21_Socium-Senior Salesforce Developer"
  );
  assert.equal(buildJobFolderName({ ...JOB, jobNo: 7 }), "7_9-21_Socium-Senior Salesforce Developer");
});

test("jobs with no sheet row keep the plain date form", () => {
  assert.equal(buildJobFolderName(JOB), "9-21_Socium-Senior Salesforce Developer");
  assert.equal(buildJobFolderName({ ...JOB, csvRow: "" }), "9-21_Socium-Senior Salesforce Developer");
  assert.equal(buildJobFolderName({ ...JOB, csvRow: "n/a" }), "9-21_Socium-Senior Salesforce Developer");
  assert.equal(buildJobFolderName({ ...JOB, csvRow: 0 }), "9-21_Socium-Senior Salesforce Developer");
});

test("normalizeCsvRow only accepts positive numbers", () => {
  assert.equal(normalizeCsvRow(16), 16);
  assert.equal(normalizeCsvRow(" 16 "), 16);
  assert.equal(normalizeCsvRow(""), "");
  assert.equal(normalizeCsvRow(null), "");
  assert.equal(normalizeCsvRow("abc"), "");
  assert.equal(normalizeCsvRow(-2), "");
});

test("prefix detectors stay distinct", () => {
  const withRow = "16_9-21_Socium-Senior Salesforce Developer";
  const dateOnly = "9-21_Socium-Senior Salesforce Developer";
  assert.equal(isRowDatePrefixedFolder(withRow), true);
  assert.equal(isRowDatePrefixedFolder(dateOnly), false);
  assert.equal(isDatePrefixedFolder(dateOnly), true);
  assert.equal(isDatePrefixedFolder(withRow), false);
  assert.equal(isLegacyRowPrefixedFolder("13 - Socium - Title"), true);
});

test("csvRowFromFolderName reads new and legacy prefixes", () => {
  assert.equal(csvRowFromFolderName("Applications/16_9-21_Socium-Dev"), 16);
  assert.equal(csvRowFromFolderName("Applications\\16_9-21_Socium-Dev"), 16);
  assert.equal(csvRowFromFolderName("Applications/13 - Socium - Dev"), 13);
  assert.equal(csvRowFromFolderName("Applications/9-21_Socium-Dev"), "");
});

test("jobDirMatchesCsvRow rejects a folder naming another row", () => {
  assert.equal(jobDirMatchesCsvRow("Applications/16_9-21_Socium-Dev", 16), true);
  assert.equal(jobDirMatchesCsvRow("Applications/16_9-21_Socium-Dev", 17), false);
  assert.equal(jobDirMatchesCsvRow("Applications/13 - Socium - Dev", 13), true);
  assert.equal(jobDirMatchesCsvRow("Applications/14 - Other - Dev", 13), false);
  // Folders saved before the row prefix carry no row — don't reject them.
  assert.equal(jobDirMatchesCsvRow("Applications/9-21_Socium-Dev", 16), true);
  // No row to match against means anything fits.
  assert.equal(jobDirMatchesCsvRow("Applications/16_9-21_Socium-Dev", ""), true);
  assert.equal(jobDirMatchesCsvRow("", 16), false);
});

test("folderFitsJob accepts the row-prefixed form", () => {
  const dir = "Applications/16_9-21_Socium-Senior Salesforce Developer";
  assert.equal(folderFitsJob(dir, { companyName: "Socium", jobTitle: "Senior Salesforce Developer" }), true);
  assert.equal(folderFitsJob(dir, { companyName: "Acme" }), false);
  assert.equal(folderFitsJob(dir, {}), true);
});
