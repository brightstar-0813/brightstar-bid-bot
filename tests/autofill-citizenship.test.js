import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCitizenshipLabel,
  citizenshipToken,
  expandCitizenshipCandidates,
  pickCitizenshipOption
} from "../autofill-citizenship.js";

test("normalizeCitizenshipLabel collapses U.S. spacing", () => {
  assert.equal(normalizeCitizenshipLabel("U.S. Citizen"), "us citizen");
  assert.equal(normalizeCitizenshipLabel("US Citizen"), "us citizen");
});

test("citizenshipToken maps profile values", () => {
  assert.equal(citizenshipToken("US Citizen"), "us_citizen");
  assert.equal(citizenshipToken("Permanent Resident"), "permanent_resident");
  assert.equal(citizenshipToken("Non-citizen authorized to work"), "work_auth");
  assert.equal(citizenshipToken("Yes"), "us_citizen");
});

test("expandCitizenshipCandidates puts status labels before Yes", () => {
  const c = expandCitizenshipCandidates("US Citizen");
  assert.ok(c.includes("U.S. Citizen"));
  assert.ok(c.includes("Yes"));
  assert.ok(c.indexOf("U.S. Citizen") < c.indexOf("Yes"));
});

test("pickCitizenshipOption prefers U.S. Citizen over Yes/No mixups", () => {
  const options = [
    "Yes",
    "No",
    "U.S. Citizen",
    "Lawful Permanent Resident",
    "Employment Authorization Document (EAD)",
    "Visa Holder"
  ];
  assert.equal(pickCitizenshipOption("US Citizen", options), "U.S. Citizen");
});

test("pickCitizenshipOption uses Yes when menu is only Yes/No", () => {
  assert.equal(pickCitizenshipOption("US Citizen", ["Yes", "No"]), "Yes");
});
