import test from "node:test";
import assert from "node:assert/strict";

import { getAllTemplates, resumeJsonToHtml } from "../templates/index.js";
import { contactLine, contactRows } from "../templates/shared.js";

const base = {
  name: "Michael Haries Namuco Ibea",
  headline: "Senior Salesforce Developer",
  phone: "9488036855",
  email: "michaelhariesibea3@gmail.com",
  location: "Trece Martires, Cavite, Philippines",
  linkedin: "https://www.linkedin.com/in/michael-haries-ibea-0baa0a417/",
  profile: "Senior Salesforce Developer with ten years of experience.",
  experience: [],
  skills: [],
  education: []
};

// Templates with a shared one-line contact row. executive-navy keeps a stacked
// sidebar (62mm column is too narrow for one row) and orange-banner has its own test.
const SHARED_ROW_TEMPLATES = getAllTemplates()
  .map((t) => t.id)
  .filter((id) => id !== "executive-navy" && id !== "orange-banner");

const rowsOf = (html) =>
  [...html.matchAll(/<span class="contact-row"[^>]*>([\s\S]*?)<\/span>(?=\s*(?:<span class="contact-row"|<\/p>|<\/div>))/g)].map(
    (m) => m[1]
  );

for (const id of SHARED_ROW_TEMPLATES) {
  test(`${id}: phone, email, location, and LinkedIn share one contact row`, () => {
    const rows = rowsOf(resumeJsonToHtml(base, id));
    assert.equal(rows.length, 1, `${id} should render exactly one contact row`);
    assert.match(rows[0], /9488036855[\s\S]*michaelhariesibea3@gmail\.com[\s\S]*Trece Martires/);
    assert.match(rows[0], />linkedin\.com\/in\/michael-haries-ibea-0baa0a417</);
  });

  test(`${id}: no LinkedIn means a single contact row`, () => {
    const rows = rowsOf(resumeJsonToHtml({ ...base, linkedin: "" }, id));
    assert.equal(rows.length, 1);
    assert.doesNotMatch(rows[0], /linkedin/i);
  });
}

test("contact row never wraps (nowrap on the single row)", () => {
  const html = contactLine(base);
  assert.equal([...html.matchAll(/white-space:nowrap/g)].length, 1);
});

test("very long rows step the font down so they still fit the page", () => {
  const long = {
    ...base,
    email: "christopher.alexander.vanderbilt2024@gmail.com",
    location: "Greater Metropolitan Area of San Francisco Bay, California, United States"
  };
  const html = contactLine(long);
  assert.match(html, /font-size:\d+%/);
  // Typical data keeps the template's own size.
  assert.doesNotMatch(contactLine(base), /font-size:/);
});

test("link colour tints only anchors, not the P/E/L text spans", () => {
  const { main, linkedin } = contactRows(base, { linkColor: "#123456" });
  assert.match(main, /<a style="color:#123456" href="mailto:/);
  assert.doesNotMatch(main, /<span[^>]*style=/);
  assert.match(linkedin, /<a style="color:#123456" href="https:\/\/www\.linkedin\.com/);
});
