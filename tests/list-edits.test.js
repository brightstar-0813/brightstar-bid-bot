import test from "node:test";
import assert from "node:assert/strict";

import { applyPathEdits, LIST_EDITS_KEY } from "../templates/shared.js";

const data = () => ({
  name: "Jane Doe",
  certifications: ["Cert A", "Cert B", "Cert C"],
  technicalSummary: ["Built APIs", "Ran migrations"],
  experience: [{ title: "Engineer", bullets: ["One", "Two", "Three"] }]
});

test("list edits add, remove and reorder certifications in the order shown", () => {
  const edits = {
    [LIST_EDITS_KEY]: {
      certifications: ["Cert C", "Cert A", "Cert NEW"]
    }
  };
  const next = applyPathEdits(data(), edits);
  assert.deepEqual(next.certifications, ["Cert C", "Cert A", "Cert NEW"]);
});

test("list edits can grow a list beyond its stored length", () => {
  const edits = {
    [LIST_EDITS_KEY]: {
      certifications: ["Cert A", "Cert B", "Cert C", "Cert D", "Cert E"]
    }
  };
  assert.equal(applyPathEdits(data(), edits).certifications.length, 5);
});

test("an emptied list item is dropped instead of saved as a blank line", () => {
  const edits = { [LIST_EDITS_KEY]: { technicalSummary: ["Built APIs", "   "] } };
  assert.deepEqual(applyPathEdits(data(), edits).technicalSummary, ["Built APIs"]);
});

test("nested bullet lists are replaced by their prefix", () => {
  const edits = {
    [LIST_EDITS_KEY]: { "experience.0.bullets": ["Three", "One", "New bullet"] }
  };
  const next = applyPathEdits(data(), edits);
  assert.deepEqual(next.experience[0].bullets, ["Three", "One", "New bullet"]);
});

test("plain path edits still apply alongside list edits", () => {
  const edits = {
    name: "Jane Q. Doe",
    [LIST_EDITS_KEY]: { certifications: ["Cert A"] }
  };
  const next = applyPathEdits(data(), edits);
  assert.equal(next.name, "Jane Q. Doe");
  assert.deepEqual(next.certifications, ["Cert A"]);
});

test("the input resume object is not mutated", () => {
  const original = data();
  applyPathEdits(original, { [LIST_EDITS_KEY]: { certifications: ["Only"] } });
  assert.deepEqual(original.certifications, ["Cert A", "Cert B", "Cert C"]);
});

test("object-shaped list items are updated by index rather than flattened", () => {
  const withObjects = { certifications: [{ name: "Cert A" }, { name: "Cert B" }] };
  const next = applyPathEdits(withObjects, { [LIST_EDITS_KEY]: { certifications: ["Cert A2"] } });
  assert.equal(next.certifications.length, 2);
  assert.equal(next.certifications[0], "Cert A2");
});

test("without list edits applyPathEdits behaves as before", () => {
  const next = applyPathEdits(data(), { "certifications.1": "Cert B2" });
  assert.deepEqual(next.certifications, ["Cert A", "Cert B2", "Cert C"]);
});
