import test from "node:test";
import assert from "node:assert/strict";

import { contactSizeClass } from "../templates/orange-banner.js";
import { resumeJsonToHtml } from "../templates/index.js";

const base = {
  name: "Michael Haries Namuco Ibea",
  headline: "Salesforce Systems & Automation Engineer",
  phone: "9488036855",
  email: "michaelhariesibea3@gmail.com",
  linkedin: "https://linkedin.com/in/michael-haries-ibea-0baa0a417/",
  location: "Trece Martires, Cavite, Philippines",
  profile: "Salesforce Systems and automation engineer with ten years of experience in platforms."
};

test("contact line stays on one row: nowrap, no clipping", () => {
  const html = resumeJsonToHtml(base, "orange-banner");
  const css = html.match(/\.contact \{[^}]*\}/)[0];
  assert.match(css, /white-space: nowrap/);
  assert.doesNotMatch(css, /overflow: hidden/);
});

test("LinkedIn URL sits on its own row, shown in full", () => {
  const html = resumeJsonToHtml(base, "orange-banner");
  const rows = [...html.matchAll(/<p class="contact[^"]*">([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  assert.equal(rows.length, 2);
  const [main, li] = rows;
  assert.doesNotMatch(main, /LI:/);
  assert.match(li, /^<span class="tag">LI:<\/span>/);
  assert.match(li, />linkedin\.com\/in\/michael-haries-ibea-0baa0a417</);
  assert.match(li, /href="https:\/\/linkedin\.com\/in\/michael-haries-ibea-0baa0a417\/"/);
});

test("without a LinkedIn value there is only the one contact row", () => {
  const html = resumeJsonToHtml({ ...base, linkedin: "" }, "orange-banner");
  assert.equal([...html.matchAll(/<p class="contact[^"]*">/g)].length, 1);
});

test("size tiers are by visible length: default up to 130 chars, then step down", () => {
  assert.equal(contactSizeClass("x".repeat(130)), "");
  assert.equal(contactSizeClass("x".repeat(131)), "fit-8");
  assert.equal(contactSizeClass("x".repeat(147)), "fit-7");
  assert.equal(contactSizeClass("x".repeat(161)), "fit-65");
  assert.equal(contactSizeClass(""), "");
});

test("typical phone/email/location row keeps the default size", () => {
  const html = resumeJsonToHtml(base, "orange-banner");
  assert.match(html, /<p class="contact ">/);
});

test("a very long phone/email/location row gets the size class on its own paragraph", () => {
  const long = {
    ...base,
    location: "Greater Metropolitan Area of the San Francisco Bay Area, Northern California, United States of America, North America"
  };
  assert.match(resumeJsonToHtml(long, "orange-banner"), /<p class="contact fit-65">/);
});
