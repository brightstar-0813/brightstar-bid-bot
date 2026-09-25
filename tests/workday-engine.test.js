import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "content/workday-engine.js"), "utf8");
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(src, sandbox);
const eng = sandbox.globalThis.BrightstarWorkdayEngine;

test("workday-engine classifies My Information heading over Review nav noise", () => {
  const det = eng.classifyPageFromText({
    url: "https://acme.wd5.myworkdayjobs.com/en-US/Careers/apply",
    heading: "My Information",
    bodyText: "My Information My Experience Review Personal Information",
    progressLabels: ["My Information", "My Experience", "Review"]
  });
  assert.equal(det.pageType, "CONTACT_INFORMATION");
  assert.ok(det.confidence >= 0.55);
});

test("workday-engine unknown layout asks user", () => {
  const det = eng.classifyPageFromText({
    url: "https://example.com/x",
    heading: "Step X",
    bodyText: "mystery",
    progressLabels: []
  });
  assert.equal(det.pageType, "UNKNOWN");
  assert.equal(det.applicationState, "NEEDS_USER");
});

test("workday-engine maps first name and blocks submit without auth", () => {
  const mapped = eng.mapLabelToProfileKey("First Name");
  assert.equal(mapped.key, "firstName");
  assert.equal(
    eng.evaluatePolicy(
      { type: "FILL", category: "CONTACT", confidence: 1 },
      { submissionAuthorized: false }
    ),
    "ALLOW"
  );
  assert.equal(
    eng.evaluatePolicy(
      { type: "CLICK", value: "Submit Application", confidence: 1 },
      { submissionAuthorized: false }
    ),
    "BLOCK"
  );
  assert.equal(
    eng.evaluatePolicy(
      { type: "FILL", category: "DEMOGRAPHIC", confidence: 1 },
      { demographicPreference: "always_ask" }
    ),
    "REQUIRE_USER"
  );
});
