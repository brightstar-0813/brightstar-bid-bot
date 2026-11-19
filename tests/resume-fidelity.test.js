import test from "node:test";
import assert from "node:assert/strict";

import {
  findMissingLines,
  recoverMissingContent,
  resolveLosslessResume,
  sourceContentLines
} from "../resume-fidelity.js";
import { plainTextToResumeData, resolvePastedResume } from "../resume-text.js";
import { getAllTemplates, resumeJsonToHtml } from "../templates/index.js";
import { buildResumeDocx, resumeDocumentXml } from "../resume-docx.js";

const PASTE = `# Resume

# Alan Jeong
New York, United States | +1 (669) 223-1191 | imalanjeong@gmail.com | linkedin.com/in/alanjeong

## PROFESSIONAL SUMMARY
Senior finance professional with 20+ years of experience. Active Secret clearance. Open to relocation.

## SKILLS
**Financial Planning & Analysis:** FP&A, Annual Operating Plans, Budgeting and Forecasting
**Keywords:** Excel, Power Query, SQL

## PROFESSIONAL EXPERIENCE
**BNY** | New York
Vice President, FP&A (Public Trust Clearance)
2015 – Present
- Led annual budgeting and rolling forecasts for a $2B asset servicing division.
- Built Power BI dashboards that cut month-end reporting time by 40%.

## AWARDS
Chairman's Award 2019
Top Performer, EnTrust Global 2016

## LANGUAGES
English (native), Korean (fluent)

## EDUCATION

**BARUCH COLLEGE**
Master of Business Administration (MBA), Accounting and Finance
2008 – 2012
`;

const html = (data, id = "ats-modern") => resumeJsonToHtml(data, id);

test("name survives Markdown headings, bold, lowercase, and a Resume title line", () => {
  const body = "New York | imalanjeong@gmail.com\n\nSUMMARY\nSenior finance professional with 20+ years of experience.\n";
  for (const head of ["# Alan Jeong", "**Alan Jeong**", "# Resume\n\n**Alan Jeong**"]) {
    assert.equal(plainTextToResumeData(`${head}\n${body}`, { person: null }).name, "Alan Jeong", head);
  }
  assert.equal(plainTextToResumeData(`alan jeong\n${body}`, { person: null }).name, "alan jeong");
});

test("a headline or section title is never mistaken for the name", () => {
  const data = plainTextToResumeData(
    "Senior Software Engineer\nSUMMARY\nBuilds reliable systems for years and years.\n",
    { person: null }
  );
  assert.equal(data.name, "Resume");
});

test("default parsing is unchanged: no verbatim flag, extra sections not split out", () => {
  const data = resolvePastedResume(PASTE, { person: null });
  assert.equal(data.verbatim, undefined);
  assert.equal(data.additionalSections, undefined);
});

test("lossless resume keeps awards and languages as their own titled sections", () => {
  const { data, missing } = resolveLosslessResume(PASTE);
  assert.equal(data.name, "Alan Jeong");
  assert.deepEqual(missing, []);
  assert.deepEqual(
    data.additionalSections.map((s) => s.title),
    ["AWARDS", "LANGUAGES"]
  );
  assert.deepEqual(data.additionalSections[0].lines, [
    "Chairman's Award 2019",
    "Top Performer, EnTrust Global 2016"
  ]);
});

test("verbatim output is not rewritten by the bot's sanitizers", () => {
  const { data } = resolveLosslessResume(PASTE);
  assert.equal(data.verbatim, true);
  for (const id of getAllTemplates().map((t) => t.id)) {
    const out = html(data, id);
    for (const needle of [
      "Active Secret clearance",
      "Public Trust Clearance",
      "Open to relocation",
      "Keywords",
      "Chairman",
      "Korean"
    ]) {
      assert.ok(out.includes(needle), `${id} lost "${needle}"`);
    }
  }
});

test("finance and executive role titles land in the title field, not the project line", () => {
  const { data } = resolveLosslessResume(PASTE);
  assert.equal(data.experience[0].title, "Vice President, FP&A (Public Trust Clearance)");
  assert.equal(data.experience[0].project, "");
});

test("non-verbatim data still goes through the original sanitizers", () => {
  const base = { name: "Jane Doe", headline: "Engineer (Public Trust Clearance)", profile: "x".repeat(40) };
  assert.ok(!html(base).includes("Public Trust Clearance"));
  assert.ok(html({ ...base, verbatim: true }).includes("Public Trust Clearance"));
});

test("DOCX carries the extra sections and education city", () => {
  const { data } = resolveLosslessResume(PASTE);
  const xml = resumeDocumentXml(data);
  assert.match(xml, /AWARDS/);
  assert.match(xml, /Chairman/);
  assert.match(xml, /LANGUAGES/);
  assert.ok(buildResumeDocx(data).length > 1000);
  const withCity = resumeDocumentXml({
    name: "A B",
    education: [{ school: "MIT", degree: "BS", details: "Cambridge, MA", year: "2010" }]
  });
  assert.match(withCity, /Cambridge, MA/);
});

test("lines the parser cannot place are recovered verbatim, in order", () => {
  const source = "Jane Doe\n\nSUMMARY\nBuilds things well and fast.\n\nZebra Quest Medal 2020\nKite Flying League Captain\n";
  const data = { name: "Jane Doe", profile: "Builds things well and fast." };
  const missing = findMissingLines(source, data).map((l) => l.text);
  assert.deepEqual(missing, ["Zebra Quest Medal 2020", "Kite Flying League Captain"]);
  const recovered = recoverMissingContent(source, data);
  assert.equal(recovered.recovered, 2);
  assert.deepEqual(recovered.data.additionalSections[0].lines, missing);
  // Recovery is idempotent: a second pass finds nothing left to add.
  assert.equal(recoverMissingContent(source, recovered.data).recovered, 0);
});

test("section titles, Markdown rules, table separators, and Resume titles are not content", () => {
  const lines = sourceContentLines("# Resume\n\n## EDUCATION\n---\n| a | b |\n|---|---|\nReal line here\n");
  assert.deepEqual(
    lines.map((l) => l.text),
    ["a b", "Real line here"]
  );
});

test("JSON pastes are trusted as-is and marked verbatim", () => {
  const json = JSON.stringify({
    name: "Jane Doe",
    profile: "A long enough profile line to count as body text.",
    skills: [{ category: "Keywords", items: "x, y" }]
  });
  const { data, recovered } = resolveLosslessResume(json);
  assert.equal(recovered, 0);
  assert.equal(data.verbatim, true);
  assert.ok(html(data).includes("Keywords"));
});

test("empty paste resolves to nothing", () => {
  assert.equal(resolveLosslessResume("  ").data, null);
});
