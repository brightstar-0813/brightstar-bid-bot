import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const code = readFileSync(fileURLToPath(new URL("../chatgpt-dom-harvest.js", import.meta.url)), "utf8");
const sandbox = {};
runInContext(code, createContext(sandbox));
const { domTextLooksIncomplete, shouldDeepScroll, stitchViewportChunks, isComposerOrUserNode } =
  sandbox.__brightstarDomHarvest;

const head = [
  "{",
  '  "name": "D\'Mario Lewis",',
  '  "experience": [',
  "    {",
  '      "company": "Culligan",'
].join("\n");

const tail = [
  '      "company": "Culligan",',
  '      "bullets": [',
  '        "Supported software development"',
  "      ]",
  "    }",
  "  ]",
  "}"
].join("\n");

test("stitches overlapping viewports into one resume string", () => {
  const stitched = stitchViewportChunks([head, tail]);
  assert.match(stitched, /"name"/);
  assert.match(stitched, /"bullets"/);
  assert.equal(stitched.split('"company": "Culligan"').length - 1, 1);
  assert.equal(stitched.includes("Supported software development"), true);
});

test("does not splice a viewport that shares no lines", () => {
  const other = ['      "bullets": [', '        "Unrelated"', "      ]"].join("\n");
  const stitched = stitchViewportChunks([head, other]);
  assert.match(stitched, /"name"/);
  assert.equal(stitched.includes("Unrelated"), false);
});

test("flags a bullets-only viewport and a few characters", () => {
  const bulletsOnly = [
    '      "bullets": [',
    '        "Supported software development, testing, debugging, and technical documentation"',
    "      ]"
  ].join("\n");
  assert.equal(domTextLooksIncomplete(bulletsOnly), true);
  assert.equal(domTextLooksIncomplete("{"), true);
  assert.equal(domTextLooksIncomplete("x"), true);
});

test("does not flag a payload that already has name and experience", () => {
  const full = JSON.stringify({
    name: "D'Mario Lewis",
    experience: [{ company: "Culligan", bullets: ["Supported software development"] }]
  });
  assert.equal(domTextLooksIncomplete(full), false);
  assert.equal(shouldDeepScroll(full, 2), false);
});

test("scrolls a bullets-only fragment only when a canvas scroller exists", () => {
  const bulletsOnly = [
    '      "bullets": [',
    '        "Supported software development, testing, debugging, and technical documentation"',
    "      ]"
  ].join("\n");
  assert.equal(shouldDeepScroll(bulletsOnly, 1), true);
  assert.equal(shouldDeepScroll(bulletsOnly, 0), false);
  assert.equal(shouldDeepScroll("{", 0), false);
});

test("treats the composer and user turns as off-limits", () => {
  const composer = {
    closest(sel) {
      return String(sel).includes("#prompt-textarea") ? { id: "prompt-textarea" } : null;
    }
  };
  const userTurn = {
    closest(sel) {
      return String(sel).includes("user") ? { id: "user" } : null;
    }
  };
  const canvas = { closest() { return null; } };
  assert.equal(isComposerOrUserNode(composer), true);
  assert.equal(isComposerOrUserNode(userTurn), true);
  assert.equal(isComposerOrUserNode(canvas), false);
});
