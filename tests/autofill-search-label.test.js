import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "content/autofill.js"), "utf8");
const m = /\/\/ @pure-begin search-label[^\n]*\n([\s\S]*?)\/\/ @pure-end search-label/.exec(src);
assert.ok(m, "search-label block not found in content/autofill.js");
const sandbox = {};
vm.runInNewContext(`${m[1]}\nthis.isSiteSearchLabel = isSiteSearchLabel;`, sandbox);
const isSearch = sandbox.isSiteSearchLabel;


test("site job-search buttons are not Submit (Indeed 'Search')", () => {
  for (const t of ["Search", "search", "Find jobs", "Search jobs", " Find ", "🔍 Search"]) {
    assert.equal(isSearch(t), true, t);
  }
});

test("real form actions are not search buttons", () => {
  for (const t of ["Submit", "Submit application", "Search and apply", "Next", "Apply now", "Continue", ""]) {
    assert.equal(isSearch(t), false, t);
  }
});
