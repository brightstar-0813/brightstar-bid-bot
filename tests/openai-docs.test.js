import test from "node:test";
import assert from "node:assert/strict";

import { isOpenAiDocsFlag } from "../openai-docs.js";

test("OPENAI_DOCS is on only for the value 1", () => {
  assert.equal(isOpenAiDocsFlag("1"), true);
  assert.equal(isOpenAiDocsFlag(""), false);
  assert.equal(isOpenAiDocsFlag("0"), false);
  assert.equal(isOpenAiDocsFlag("true"), false);
  assert.equal(isOpenAiDocsFlag(undefined), false);
});
