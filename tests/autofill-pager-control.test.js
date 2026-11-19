import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "content/autofill.js"), "utf8");
const m = /\/\/ @pure-begin pager-control[^\n]*\n([\s\S]*?)\/\/ @pure-end pager-control/.exec(src);
assert.ok(m, "pager-control block not found in content/autofill.js");
const sandbox = {};
vm.runInNewContext(
  `${m[1]}\nthis.isPagerControl = isPagerControl; this.PAGER_ANCESTOR_SEL = PAGER_ANCESTOR_SEL;`,
  sandbox
);
const { isPagerControl, PAGER_ANCESTOR_SEL } = sandbox;

/** Minimal element: closest() answers from the list of ancestor descriptions. */
function el(ancestors) {
  return {
    closest(sel) {
      assert.equal(sel, PAGER_ANCESTOR_SEL);
      const parts = sel.split(",").map((p) => p.trim());
      return ancestors.find((a) => parts.includes(a)) || null;
    }
  };
}

test("Workday job-search pager 'next' is not a form step (Leidos 2026-11-19)", () => {
  assert.equal(isPagerControl(el(['nav[aria-label*="pagination" i]'])), true);
  assert.equal(isPagerControl(el(["ul.pagination"])), true);
  assert.equal(isPagerControl(el(['[data-uxi-widget-type="paginationControl"]'])), true);
});

test("wizard buttons outside a pager stay form steps", () => {
  assert.equal(isPagerControl(el([])), false);
  assert.equal(isPagerControl(el(["form", "main"])), false);
});

test("never throws on odd nodes", () => {
  assert.equal(isPagerControl(null), false);
  assert.equal(isPagerControl({}), false);
  assert.equal(
    isPagerControl({
      closest() {
        throw new Error("bad selector");
      }
    }),
    false
  );
});

test("pager selector does not catch generic 'pagination' class names on forms", () => {
  assert.equal(/\[class\*=/.test(PAGER_ANCESTOR_SEL), false);
});
