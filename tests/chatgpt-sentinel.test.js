const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { sha3_512, solvePow } = require("../chatgpt-sentinel.js");

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

test("sha3-512 matches node crypto", () => {
  assert.equal(hex(sha3_512("abc")), crypto.createHash("sha3-512").update("abc").digest("hex"));
  assert.equal(hex(sha3_512("")), crypto.createHash("sha3-512").update("").digest("hex"));
});

test("solvePow meets an easy difficulty", () => {
  const token = solvePow("seed-1", "ff", "Mozilla/5.0");
  assert.equal(token.startsWith("gAAAAAB"), true);
  assert.equal(token.length > 20, true);
});
