import test from "node:test";
import assert from "node:assert/strict";
import { dropTrailingSignoff } from "../cover-letter-harvest.js";

const body = [
  "I am excited to apply for the Salesforce Architect role at Monks, where I can lead cross-cloud design.",
  "I would welcome the opportunity to discuss how my experience could contribute to the CRM practice.",
  "Thank you for your time and consideration."
];

test("drops 'Sincerely, <name>' and the ChatGPT suggestion chips after it (#119)", () => {
  const paras = [...body, "Sincerely, Avash Chapagain", "Tailor my opening to Monks Add a concrete architecture outcome"];
  assert.deepEqual(dropTrailingSignoff(paras, "Avash Chapagain"), body);
});

test("drops a bare closing line", () => {
  assert.deepEqual(dropTrailingSignoff([...body, "Best regards,"], "Avash Chapagain"), body);
});

test("keeps a closing sentence that is part of the body", () => {
  assert.deepEqual(dropTrailingSignoff(body, "Avash Chapagain"), body);
});

test("keeps 'Sincerely' followed by something that is not the name", () => {
  const paras = [...body, "Sincerely hope to hear from you about next steps soon"];
  assert.deepEqual(dropTrailingSignoff(paras, "Avash Chapagain"), paras);
});

test("first-name-only signature", () => {
  assert.deepEqual(dropTrailingSignoff([...body, "Regards, Avash"], "Avash Chapagain"), body);
});

import { stripWritingBlockFence } from "../cover-letter-harvest.js";

test("strips ChatGPT ':::writing{…}' fences (#156)", () => {
  const raw = ':::writing{variant="document" id="62841"}\nDear Hiring Manager,\n\nBody text here.\n\nThank you for your consideration.\n:::';
  assert.equal(stripWritingBlockFence(raw), "Dear Hiring Manager,\n\nBody text here.\n\nThank you for your consideration.");
});

test("strips fences on joined first/last paragraphs", () => {
  assert.equal(stripWritingBlockFence(':::writing{variant="document" id="1"} Dear Hiring Manager,'), "Dear Hiring Manager,");
  assert.equal(stripWritingBlockFence("Thank you for your consideration. :::"), "Thank you for your consideration.");
});

test("leaves normal letters alone", () => {
  assert.equal(stripWritingBlockFence("Dear Hiring Manager,\n\nThanks."), "Dear Hiring Manager,\n\nThanks.");
});
