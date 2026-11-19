import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "content/autofill.js"), "utf8");
const m = /\/\/ @pure-begin phone-dial[^\n]*\n([\s\S]*?)\/\/ @pure-end phone-dial/.exec(src);
assert.ok(m, "phone-dial block not found in content/autofill.js");
const sandbox = {};
vm.runInNewContext(`${m[1]}\nthis.stripDialCode = stripDialCode; this.usNationalPhone = usNationalPhone;`, sandbox);
const { stripDialCode, usNationalPhone } = sandbox;

test("dial codes are dropped from phone-country option labels", () => {
  assert.equal(stripDialCode("United States +1"), "United States");
  assert.equal(stripDialCode("Albania+355"), "Albania");
  assert.equal(stripDialCode("United States of America (+1)"), "United States of America");
  assert.equal(stripDialCode("+1 United States"), "United States");
  assert.equal(stripDialCode("Bachelor's Degree"), "Bachelor's Degree");
  assert.equal(stripDialCode("+1"), "+1");
});

test("US phone becomes 10 national digits for fields with their own country picker", () => {
  assert.equal(usNationalPhone("+1 (703) 705-2182"), "7037052182");
  assert.equal(usNationalPhone("703-705-2182"), "7037052182");
  assert.equal(usNationalPhone("17037052182"), "7037052182");
  assert.equal(usNationalPhone("+55 81 92007-8168"), "");
  assert.equal(usNationalPhone(""), "");
});
