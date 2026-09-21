import test from "node:test";
import assert from "node:assert/strict";

import {
  isZipHiringBanner,
  pickZipJobTitle,
  zipCleanDocumentTitle,
  zipLooksLikeJobTitle,
  zipTitleFromJd,
  zipTitleScore
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
