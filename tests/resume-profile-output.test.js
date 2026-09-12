import test from "node:test";
import assert from "node:assert/strict";

import {
  isGenericApplicationsDir,
  isGenericResumeFilePrefix,
  joinDownloadsRelativeDirs,
  normalizeDownloadsRelativeDir,
  normalizeResumeFilePrefix,
  outputDirFromPerson,
  personOutputNameToken,
  resolveOutputDirForPerson,
  resumeFilePrefixFromName
} from "../resume-profile.js";

test("resumeFilePrefixFromName uses last name token", () => {
  assert.equal(resumeFilePrefixFromName("Ada Lovelace"), "Lovelace_Resume");
  assert.equal(resumeFilePrefixFromName("Madonna"), "Madonna_Resume");
  assert.equal(resumeFilePrefixFromName(""), "Applicant_Resume");
});

test("bare Resume is generic; Lewis_Resume is not", () => {
  assert.equal(isGenericResumeFilePrefix(""), true);
  assert.equal(isGenericResumeFilePrefix("Resume"), true);
  assert.equal(isGenericResumeFilePrefix("_Resume"), true);
  assert.equal(isGenericResumeFilePrefix("Lewis_Resume"), false);
  assert.equal(isGenericResumeFilePrefix("Garcia"), false);
});

test("normalizeResumeFilePrefix upgrades bare Resume from person name", () => {
  assert.equal(normalizeResumeFilePrefix("Resume", "Sandeep Kumar"), "Kumar_Resume");
  assert.equal(normalizeResumeFilePrefix("Lewis_Resume", "Other"), "Lewis_Resume");
  assert.equal(normalizeResumeFilePrefix("", "Maria Garcia"), "Garcia_Resume");
});

test("outputDirFromPerson matches built-in and custom naming", () => {
  assert.equal(outputDirFromPerson({ resumeFilePrefix: "Lewis_Resume" }), "Applications-Lewis");
  assert.equal(
    outputDirFromPerson({ resumeFilePrefix: "Resume", name: "Sandeep Kumar" }),
    "Applications-Kumar"
  );
  assert.equal(outputDirFromPerson({ name: "Ada Lovelace" }), "Applications-Lovelace");
});

test("personOutputNameToken prefers configured prefix over JSON-ish fallbacks", () => {
  assert.equal(
    personOutputNameToken({ resumeFilePrefix: "Garcia_Resume", name: "Wrong Name" }),
    "Garcia"
  );
  assert.equal(personOutputNameToken({ resumeFilePrefix: "Resume", name: "Pat Lee" }), "Lee");
});

test("normalizeDownloadsRelativeDir rejects absolute paths", () => {
  assert.equal(
    normalizeDownloadsRelativeDir("C:/Users/me/Downloads/Applications-Pat"),
    "Applications-Pat"
  );
  assert.equal(
    normalizeDownloadsRelativeDir("C:/Users/me/Downloads/BrightstarBids/Lewis"),
    "BrightstarBids/Lewis"
  );
  assert.equal(
    normalizeDownloadsRelativeDir("D:\\Work\\JobHunting\\Applications-Custom\\x"),
    "Applications-Custom/x"
  );
  assert.equal(normalizeDownloadsRelativeDir("/tmp/foo", "Applications"), "Applications");
  assert.equal(normalizeDownloadsRelativeDir("Applications-Pat/extra"), "Applications-Pat/extra");
  assert.equal(normalizeDownloadsRelativeDir("Applications"), "Applications");
});

test("join and resolve support shared root + person folder", () => {
  assert.equal(joinDownloadsRelativeDirs("BrightstarBids", "Applications-Lewis"), "BrightstarBids/Applications-Lewis");
  assert.equal(
    joinDownloadsRelativeDirs("BrightstarBids", "BrightstarBids/Lewis"),
    "BrightstarBids/Lewis"
  );
  assert.equal(
    resolveOutputDirForPerson(
      { resumeFilePrefix: "Lewis_Resume", outputDir: "" },
      { saveRoot: "BrightstarBids" }
    ),
    "BrightstarBids/Applications-Lewis"
  );
  assert.equal(
    resolveOutputDirForPerson({ outputDir: "TeamA/Lewis" }, { saveRoot: "BrightstarBids" }),
    "BrightstarBids/TeamA/Lewis"
  );
});

test("outputDirFromPerson prefers custom outputDir", () => {
  assert.equal(
    outputDirFromPerson({ outputDir: "TeamA/Lewis", resumeFilePrefix: "Lewis_Resume" }),
    "TeamA/Lewis"
  );
});

test("isGenericApplicationsDir detects bare Applications only", () => {
  assert.equal(isGenericApplicationsDir("Applications"), true);
  assert.equal(isGenericApplicationsDir("Applications-Lewis"), false);
  assert.equal(isGenericApplicationsDir("BrightstarBids/Lewis"), false);
  assert.equal(isGenericApplicationsDir(""), true);
});
