import test from "node:test";
import assert from "node:assert/strict";

import {
  STANDALONE_EXPORT_DIR,
  buildStandaloneExportPlan,
  bytesToBase64,
  normalizeStandaloneFormat,
  standaloneFormats,
  standaloneNameToken,
  standaloneStatusLine
} from "../standalone-export.js";
import { buildResumeDocx } from "../resume-docx.js";
import { isStyledExportResume, resolvePastedResume } from "../resume-text.js";

const PASTE = `Jane Q Doe
Senior Engineer
jane@example.com | 555-123-4567

Summary
Builds reliable systems.

Experience
Acme Corp
Senior Engineer
Jan 2020 - Present
- Shipped the thing
- Cut latency by 40%

Skills
JavaScript, Node.js
`;

test("format falls back to pdf and expands both", () => {
  assert.equal(normalizeStandaloneFormat(""), "pdf");
  assert.equal(normalizeStandaloneFormat("nope"), "pdf");
  assert.equal(normalizeStandaloneFormat(" DOCX "), "docx");
  assert.deepEqual(standaloneFormats("both"), ["pdf", "docx"]);
  assert.deepEqual(standaloneFormats(undefined), ["pdf"]);
});

test("plan uses the resume name only: no job folder, no Company/Job fallback", () => {
  const plan = buildStandaloneExportPlan({ name: "Jane Q Doe" }, { format: "both" });
  assert.equal(plan.dir, STANDALONE_EXPORT_DIR);
  assert.equal(plan.nameToken, "Doe");
  assert.deepEqual(
    plan.files.map((f) => f.path),
    ["StyledResumes/Doe_Resume.pdf", "StyledResumes/Doe_Resume.docx"]
  );
  assert.ok(plan.files.every((f) => !/Company|Job|jd\.txt/i.test(f.path)));
  assert.equal(plan.files[0].mimeType, "application/pdf");
  assert.match(plan.files[1].mimeType, /wordprocessingml\.document$/);
});

test("name token never leaks path characters and falls back to Applicant", () => {
  assert.match(standaloneNameToken({ name: "../Evil/Name" }), /^[A-Za-z0-9]+$/);
  assert.equal(standaloneNameToken({}), "Applicant");
  const plan = buildStandaloneExportPlan({ name: "  " }, { format: "pdf" });
  assert.equal(plan.files[0].path, "StyledResumes/Applicant_Resume.pdf");
});

test("pasted text builds a styled resume with no profile, no job fields", () => {
  const data = resolvePastedResume(PASTE, { person: null });
  assert.ok(isStyledExportResume(data));
  assert.equal(data.name, "Jane Q Doe");
  assert.equal(data.email, "jane@example.com");
});

test("empty paste is not exportable", () => {
  assert.equal(resolvePastedResume("   ", { person: null }), null);
  assert.equal(isStyledExportResume(null), false);
  assert.equal(isStyledExportResume({ name: "Jane" }), false); // name but no body
});

test("bytesToBase64 round-trips large buffers", () => {
  const bytes = new Uint8Array(100000);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
  const back = Uint8Array.from(Buffer.from(bytesToBase64(bytes), "base64"));
  assert.equal(back.length, bytes.length);
  assert.deepEqual(back.subarray(0, 300), bytes.subarray(0, 300));
  assert.deepEqual(back.subarray(-300), bytes.subarray(-300));
});

test("DOCX bytes are a zip and encode to base64 for download", () => {
  const data = resolvePastedResume(PASTE, { person: null });
  const bytes = buildResumeDocx(data);
  assert.equal(bytes[0], 0x50); // P
  assert.equal(bytes[1], 0x4b); // K
  assert.ok(bytesToBase64(bytes).length > 100);
});

test("status line names every saved file", () => {
  const plan = buildStandaloneExportPlan({ name: "Jane Doe" }, { format: "both" });
  assert.equal(
    standaloneStatusLine(plan),
    "Saved Doe_Resume.pdf + Doe_Resume.docx → Downloads / StyledResumes"
  );
});
