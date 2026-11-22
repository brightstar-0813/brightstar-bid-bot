import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "content/autofill.js"), "utf8");
const m = /\/\/ @pure-begin bookmark-label[^\n]*\n([\s\S]*?)\/\/ @pure-end bookmark-label/.exec(src);
assert.ok(m, "bookmark-label block not found in content/autofill.js");
const sandbox = {};
vm.runInNewContext(`${m[1]}\nthis.isBookmarkSaveLabel = isBookmarkSaveLabel;`, sandbox);
const isBookmark = sandbox.isBookmarkSaveLabel;

test("job-board bookmark labels are not Submit (Himalayas 'Save')", () => {
  for (const t of ["Save", "Saved", "Save job", "Save this job", "Unsave", "Bookmark", " Save ", "♡ Save"]) {
    assert.equal(isBookmark(t), true, t);
  }
});

test("real form actions are not bookmarks", () => {
  for (const t of ["Save and Continue", "Save & Next", "Submit", "Submit application", "Save application", "Apply now", ""]) {
    assert.equal(isBookmark(t), false, t);
  }
});
