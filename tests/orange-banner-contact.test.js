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

const contactOf = (html) => html.match(/<p class="contact[^"]*">([\s\S]*?)<\/p>/)[1];

test("contact line stays on one row: nowrap, no clipping", () => {
  const html = resumeJsonToHtml(base, "orange-banner");
  const css = html.match(/\.contact \{[^}]*\}/)[0];
  assert.match(css, /white-space: nowrap/);
  assert.doesNotMatch(css, /overflow: hidden/);
});

test("LinkedIn shows the slug only, since the LI: tag already says LinkedIn", () => {
  const html = resumeJsonToHtml(base, "orange-banner");
  const contact = contactOf(html);
  assert.match(contact, />in\/michael-haries-ibea-0baa0a417</);
  // Visible text only: the href keeps the full URL on purpose.
  assert.doesNotMatch(contact.replace(/href="[^"]*"/g, ""), /linkedin\.com\/in\//);
  // The link still points at the full profile URL.
  assert.match(contact, /href="https:\/\/linkedin\.com\/in\/michael-haries-ibea-0baa0a417\/"/);
});

test("short contact values keep the default size; long ones step down", () => {
  assert.equal(contactSizeClass(contactOf(resumeJsonToHtml(base, "orange-banner"))), "");
  const long = { ...base, email: "christopher.alexander.vanderbilt2024@gmail.com", location: "San Francisco Bay Area, California, United States" };
  assert.equal(contactSizeClass(contactOf(resumeJsonToHtml(long, "orange-banner"))), "fit-7");
  const huge = { ...long, location: "Greater Metropolitan Area of San Francisco Bay, California, United States" };
  assert.equal(contactSizeClass(contactOf(resumeJsonToHtml(huge, "orange-banner"))), "fit-65");
  assert.equal(contactSizeClass(""), "");
});

test("the size class is applied to the contact paragraph", () => {
  const long = { ...base, email: "christopher.alexander.vanderbilt2024@gmail.com", location: "San Francisco Bay Area, California, United States" };
  assert.match(resumeJsonToHtml(long, "orange-banner"), /<p class="contact fit-7">/);
});
