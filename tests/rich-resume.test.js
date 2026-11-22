import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeRichHtml } from "../resume-rich.js";
import { applyPathEdits } from "../templates/shared.js";
import { resumeJsonToHtml } from "../templates/index.js";
import { buildResumeDocx, resumeDocxFileName, resumeDocumentXml } from "../resume-docx.js";

test("bold, font, and size survive applyPathEdits and render, and a script does not", () => {
  const raw =
    '<b>Bold</b> <span style="font-family:Calibri;font-size:11pt;color:red">Cloud</span><script>alert(1)</script>';
  const next = applyPathEdits(
    { name: "Ada Lovelace", email: "ada@example.com" },
    {
      profile: raw,
      email: "<b>ada@example.com</b><script>alert(1)</script>"
    }
  );
  assert.match(next.profile, /<b>Bold<\/b>/);
  assert.match(next.profile, /font-family:Calibri/);
  assert.match(next.profile, /font-size:11pt/);
  assert.doesNotMatch(next.profile, /script/i);
  assert.doesNotMatch(next.profile, /color/i);
  assert.equal(next.email, "ada@example.com");

  const html = resumeJsonToHtml(
    {
      ...next,
      headline: "Engineer",
      experience: [
        {
          company: "Acme",
          title: "Engineer",
          dates: "2020",
          bullets: ["Shipped the platform for the team."]
        }
      ]
    },
    "ats-modern"
  );
  assert.match(html, /<b>Bold<\/b>/);
  assert.match(html, /font-family:Calibri/);
  assert.match(html, /font-size:11pt/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /alert\(1\)/);
});

test("a poster font size snaps into the allowed set", () => {
  const html = sanitizeRichHtml('<span style="font-size:48pt">Hi</span>');
  assert.match(html, /font-size:14pt/);
  assert.doesNotMatch(html, /48pt/);
});

test("docx contains the same resume text and the emphasis", () => {
  const resume = {
    name: "Ada Lovelace",
    headline: "Engineer",
    profile: '<b>Built</b> <span style="font-family:Calibri;font-size:11pt">Service Cloud</span>',
    experience: [
      {
        company: "Acme",
        title: "Engineer",
        bullets: ["Shipped Apex for the service desk."]
      }
    ]
  };
  const xml = resumeDocumentXml(resume);
  assert.match(xml, /Ada Lovelace/);
  assert.match(xml, /Built/);
  assert.match(xml, /Service Cloud/);
  assert.match(xml, /Shipped Apex for the service desk/);
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /Calibri/);
  assert.match(xml, /w:sz w:val="22"/);
  const bytes = buildResumeDocx(resume);
  const packed = new TextDecoder().decode(bytes);
  assert.ok(bytes[0] === 0x50 && bytes[1] === 0x4b);
  assert.match(packed, /Ada Lovelace/);
  assert.match(packed, /Service Cloud/);
  assert.equal(resumeDocxFileName(resume), "Lovelace_Resume.docx");
});
