import test from "node:test";
import assert from "node:assert/strict";

import {
  isZipHiringBanner,
  pickZipJobTitle,
  zipCleanDocumentTitle,
  zipCompanyFromCueText,
  zipBestCompanyCandidate,
  zipCompanyCandidatesFromText,
  zipCompanyFromPageText,
  zipLooksLikeCompanyName,
  zipLooksLikeJobTitle,
  zipTitleFromJd,
  zipTitleScore,
  ZIP_COMPANY_SCORE
} from "../zip-title.js";

const PAGE_TITLE =
  "Salesforce Data Architect & Technical Lead | Remote USA | Federal Program | Citizens/GC Only";
const JD_BANNER = "WE ARE HIRING: SALESFORCE DATA ARCHITECT & SALESFORCE TECHNICAL LEAD";
const JD = [
  JD_BANNER,
  "Location: Remote within the United States",
  "Eligibility: U.S. Citizens or Green Card holders only",
  "Candidates must be eligible for a Public Trust Tier 2/MBI background investigation",
  "Project: U.S. Federal Government Program"
].join("\n");

test("ZipRecruiter hiring banners are not job titles", () => {
  assert.equal(isZipHiringBanner(JD_BANNER), true);
  assert.equal(isZipHiringBanner("We're hiring: Salesforce Developer"), true);
  assert.equal(isZipHiringBanner("Now hiring Salesforce Architect"), true);
  assert.equal(isZipHiringBanner(PAGE_TITLE), false);
  assert.equal(zipLooksLikeJobTitle(JD_BANNER), false);
  assert.equal(zipLooksLikeJobTitle(PAGE_TITLE), true);
  assert.equal(zipLooksLikeJobTitle("WE ARE HIRING: SA"), false);
});

test("ZipRecruiter pipe listing titles beat JD WE ARE HIRING lines", () => {
  assert.ok(zipTitleScore(PAGE_TITLE) > zipTitleScore(JD_BANNER));
  assert.equal(zipTitleFromJd(JD), "");
  assert.equal(
    pickZipJobTitle({
      heading: PAGE_TITLE,
      jdText: JD,
      onSearch: true
    }),
    PAGE_TITLE
  );
  assert.equal(
    pickZipJobTitle({
      heading: "",
      pageTitle: `${PAGE_TITLE} | ZipRecruiter`,
      jdText: JD,
      schemaTitle: JD_BANNER,
      onSearch: true
    }),
    PAGE_TITLE
  );
  assert.equal(pickZipJobTitle({ jdText: JD, onSearch: true }), "");
});

test("zipCleanDocumentTitle strips the ZipRecruiter suffix", () => {
  assert.equal(zipCleanDocumentTitle(`${PAGE_TITLE} | ZipRecruiter`), PAGE_TITLE);
  assert.equal(zipCleanDocumentTitle("213 Jobs in United States | ZipRecruiter"), "213 Jobs in United States");
});

test("ZipRecruiter chrome copy is not a job title", () => {
  assert.equal(zipLooksLikeJobTitle("See more jobs at HRC Global Services"), false);
  assert.equal(zipLooksLikeJobTitle("1-Click Apply"), false);
});

test("See more jobs at is the posting company, not a related Learn more about widget", () => {
  assert.equal(zipCompanyFromCueText("See more jobs at TMS LLC"), "TMS LLC");
  assert.equal(zipLooksLikeCompanyName("TMS LLC"), true);
  assert.equal(zipLooksLikeCompanyName("See more jobs at TMS LLC"), true);

  const blob = [
    "Salesforce Technical Architect - Genesys Cloud | Remote | Independent Visa Required",
    "OR · Remote",
    "TMS LLC",
    "See more jobs at TMS LLC",
    "Full-time",
    "Posted 4 days ago",
    "Job description",
    "Role: Salesforce Technical Architect (Genesys Cloud)",
    "Location: Boston, MA - Remote",
    "Rate: $90/hr. on C2C",
    "",
    "NVS",
    "• Staffing and Recruiting · 11-50 employees",
    "Learn more about NVS"
  ].join("\n");

  assert.equal(
    zipCompanyFromPageText(
      blob,
      "Salesforce Technical Architect - Genesys Cloud | Remote | Independent Visa Required"
    ),
    "TMS LLC"
  );
});

test("Learn more about still wins when that is the only company cue", () => {
  const blob = [
    "Salesforce / HubSpot Administrator - Revenue Systems (SaaS) - Remote",
    "New York, NY · Remote",
    "YO AI Labs",
    "• Computing Infrastructure Providers · 201 - 500 employees",
    "Learn more about YO AI Labs",
    "Job description",
    "We are seeking experienced Salesforce / HubSpot Administrators"
  ].join("\n");
  assert.equal(zipCompanyFromPageText(blob), "YO AI Labs");
});

// The real ZipRecruiter panel: poster header, JD, then a related-company card.
const ZIP_PANEL = [
  "TMS LLC",
  "Salesforce Technical Architect - Genesys Cloud | Remote | Independent Visa Required",
  "OR \u00b7 Remote",
  "TMS LLC",
  "See more jobs at TMS LLC",
  "Full-time",
  "Posted 4 days ago",
  "Job description",
  "Job Description",
  "Role: Salesforce Technical Architect (Genesys Cloud)",
  "Location: Boston, MA - Remote",
  "Rate: $90/hr. on C2C",
  "Contract Duration: 12 Months",
  "NVS",
  "\u00b7 Staffing and Recruiting \u00b7 11-50 employees",
  "Learn more about NVS"
].join("\n");

const ZIP_TITLE_ON_PANEL =
  "Salesforce Technical Architect - Genesys Cloud | Remote | Independent Visa Required";

test("company candidates are scored by where they sit relative to the JD", () => {
  const cands = zipCompanyCandidatesFromText(ZIP_PANEL, ZIP_TITLE_ON_PANEL);
  const tms = cands.filter((c) => c.name === "TMS LLC");
  const nvs = cands.filter((c) => c.name === "NVS");
  assert.ok(tms.length > 0, "poster cue is a candidate");
  assert.ok(nvs.length > 0, "related widget is still seen, just outranked");
  assert.equal(Math.max(...tms.map((c) => c.score)), ZIP_COMPANY_SCORE.headerCue);
  assert.ok(
    Math.max(...nvs.map((c) => c.score)) <= ZIP_COMPANY_SCORE.bodyLearn,
    "names below the JD stay low-confidence"
  );
  assert.equal(zipBestCompanyCandidate(cands).name, "TMS LLC");
});

test("a JD-only blob cannot promote the related company above a listing card", () => {
  // When the detail root starts at the JD, there is no header to trust.
  const jdOnly = ZIP_PANEL.slice(ZIP_PANEL.indexOf("Job description"));
  const best = zipBestCompanyCandidate(zipCompanyCandidatesFromText(jdOnly, ZIP_TITLE_ON_PANEL));
  assert.equal(best?.name, "NVS");
  assert.ok(best.score < ZIP_COMPANY_SCORE.card, "a card match still wins over it");
});

test("pay, dates and listing chrome are not company names", () => {
  for (const junk of [
    "$101K - $132K/yr",
    "$90/hr. on C2C",
    "Posted 4 days ago",
    "Estimated pay",
    "1-click apply",
    "New",
    "Alpharetta, GA",
    "OR \u00b7 Remote",
    "213 jobs"
  ]) {
    assert.equal(zipLooksLikeCompanyName(junk), false, junk);
  }
  assert.equal(zipLooksLikeCompanyName("TMS LLC"), true);
  assert.equal(zipLooksLikeCompanyName("Arclin USA LLC"), true);
  assert.equal(zipLooksLikeCompanyName("Compeer Financial"), true);
});

test("zipBestCompanyCandidate keeps the first name on a score tie", () => {
  const best = zipBestCompanyCandidate([
    { name: "TMS LLC", score: 80, source: "card:header:line" },
    { name: "NVS", score: 80, source: "card:header:line" }
  ]);
  assert.equal(best.name, "TMS LLC");
});
