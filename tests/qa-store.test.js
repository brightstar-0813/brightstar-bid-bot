import test from "node:test";
import assert from "node:assert/strict";

import { normalizeQuestion, questionSimilarity } from "../qa-store.js";

test("normalizeQuestion strips noise and punctuation", () => {
  assert.equal(normalizeQuestion("First Name*"), "first name");
  assert.equal(normalizeQuestion("(Required) Email:"), "email");
  assert.equal(normalizeQuestion("1. Why this role?"), "why this role");
});

test("questionSimilarity scores near duplicates higher", () => {
  const a = normalizeQuestion("Are you authorized to work in the United States?");
  const b = normalizeQuestion("Are you legally authorized to work in the US?");
  const c = normalizeQuestion("What is your desired salary?");
  assert.ok(questionSimilarity(a, b) > 0.5);
  assert.ok(questionSimilarity(a, c) < 0.4);
});
