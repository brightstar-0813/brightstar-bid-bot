import test from "node:test";
import assert from "node:assert/strict";
import { defaultSheetTabNameForPerson, sanitizeSheetTabName } from "../sheets.js";

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
