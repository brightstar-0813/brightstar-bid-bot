import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSheetRowTsv,
  defaultSheetTabNameForPerson,
  resolveBidModeLabel,
  resolveSheetTabNameForPerson,
  sanitizeSheetTabName,
  BID_MODE_AUTO,
  BID_MODE_MANUAL,
  BID_MODE_EMAIL,
  BID_MODE_PROFILE
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

test("buildSheetRowTsv ends with Bid mode after Status and has no JD column", () => {
  const row = buildSheetRowTsv({
    jobNo: "12",
    jobTitle: "SF Architect",
    companyName: "Acme",
    jdLink: "https://example.com/job",
    salary: "150k",
    status: "Ready",
    bidMode: "Auto bid",
    includeDate: false
  });
  assert.equal(row, "12\t\tSF Architect\tAcme\thttps://example.com/job\t150k\tReady\tAuto bid");
});

test("resolveBidModeLabel maps sources to sheet labels", () => {
  assert.equal(resolveBidModeLabel("batch"), BID_MODE_AUTO);
  assert.equal(resolveBidModeLabel("indeed-grab"), BID_MODE_AUTO);
  assert.equal(resolveBidModeLabel(""), BID_MODE_AUTO);
  assert.equal(resolveBidModeLabel("one-off"), BID_MODE_MANUAL);
  assert.equal(resolveBidModeLabel("Manual bid"), BID_MODE_MANUAL);
  assert.equal(resolveBidModeLabel("email-bid"), BID_MODE_EMAIL);
  assert.equal(resolveBidModeLabel("Email bid"), BID_MODE_EMAIL);
  assert.equal(resolveBidModeLabel("profile-apply"), BID_MODE_PROFILE);
  assert.equal(resolveBidModeLabel("profile"), BID_MODE_PROFILE);
  assert.equal(resolveBidModeLabel("Profile apply"), BID_MODE_PROFILE);
  assert.equal(resolveBidModeLabel("one-click"), BID_MODE_PROFILE);
});
