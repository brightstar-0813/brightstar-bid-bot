import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCustomQaEngine } from "../autofill-runner.js";

test("normalizeCustomQaEngine maps Custom Q&A engines", () => {
  assert.equal(normalizeCustomQaEngine("codex"), "codex");
  assert.equal(normalizeCustomQaEngine("chatgpt"), "chatgpt");
  assert.equal(normalizeCustomQaEngine("agent"), "chatgpt");
  assert.equal(normalizeCustomQaEngine("claude"), "chatgpt");
  assert.equal(normalizeCustomQaEngine("openai"), "openai");
  assert.equal(normalizeCustomQaEngine("openai-api"), "openai");
  assert.equal(normalizeCustomQaEngine(""), "");
  assert.equal(normalizeCustomQaEngine("nope"), "");
});
