import test from "node:test";
import assert from "node:assert/strict";
import { responsesOutputText } from "../openai.js";

test("responsesOutputText prefers output_text", () => {
  assert.equal(responsesOutputText({ output_text: " Yes " }), "Yes");
});

test("responsesOutputText reads message content when output_text is empty", () => {
  assert.equal(
    responsesOutputText({
      output: [{ type: "message", content: [{ type: "output_text", text: "Salesforce Admin" }] }]
    }),
    "Salesforce Admin"
  );
});
