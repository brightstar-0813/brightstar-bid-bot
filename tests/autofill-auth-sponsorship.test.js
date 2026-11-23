import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "content/autofill.js"), "utf8");
const m = /\/\/ @pure-begin auth-without-sponsorship[^\n]*\n([\s\S]*?)\/\/ @pure-end auth-without-sponsorship/.exec(src);
assert.ok(m, "auth-without-sponsorship block not found in content/autofill.js");
const sandbox = {};
vm.runInNewContext(`${m[1]}\nthis.fn = isAuthorizedWithoutSponsorship;`, sandbox);
const fn = sandbox.fn;

test("authorized-without-sponsorship questions are work authorization (PanCAN #86)", () => {
  for (const q of [
    "are you legally authorized to work in the us without the need for sponsorship?",
    "are you eligible to work in the united states without requiring visa sponsorship",
    "are you authorized to work in the u.s. without sponsorship now or in the future?",
  ]) {
    assert.equal(fn(q), true, q);
  }
});

test("real sponsorship questions stay sponsorship", () => {
  for (const q of [
    "will you now or in the future require sponsorship for employment visa status?",
    "do you need visa sponsorship to work in the us?",
    "are you legally authorized to work in the united states?",
    "",
  ]) {
    assert.equal(fn(q), false, q);
  }
});
