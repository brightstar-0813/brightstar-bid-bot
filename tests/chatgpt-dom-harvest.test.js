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

function matchSelector(el, selector) {
  const sel = String(selector || "").trim();
  if (!sel || sel === "*") return true;
  let rest = sel;
  const tag = rest.match(/^[a-z]+/i);
  if (tag && !rest.startsWith("[")) {
    if (String(el.tagName || "").toLowerCase() !== tag[0].toLowerCase()) return false;
    rest = rest.slice(tag[0].length);
    if (!rest) return true;
  }
  const attr = rest.match(/^\[([^\]=~|^$*]+)([~|^$*]?=)['"]?([^'"\]]+)['"]?\]$/);
  if (!attr) return false;
  const name = attr[1];
  const op = attr[2];
  const value = attr[3];
  const actual = el.getAttribute(name);
  if (actual == null) return false;
  if (op === "=") return actual === value;
  if (op === "^=") return String(actual).startsWith(value);
  if (op === "*=") return String(actual).includes(value);
  return false;
}

function matchesAny(el, selector) {
  return String(selector || "")
    .split(",")
    .some((part) => matchSelector(el, part));
}

function flattenText(el) {
  const own = String(el._text || "");
  const kids = (el.children || []).map((child) => flattenText(child)).filter(Boolean);
  return [own, ...kids].filter(Boolean).join("\n");
}

function node({ role = "", roleAttr = "data-message-author-role", testid = "", text = "", tag = "div", children = [] } = {}) {
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    _text: text,
    children,
    parent: null,
    getAttribute(name) {
      if (role && name === roleAttr) return role;
      if (name === "data-testid") return testid || null;
      return null;
    },
    closest() {
      return null;
    },
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const out = [];
      for (const child of el.children) {
        if (matchesAny(child, selector)) out.push(child);
        out.push(...child.querySelectorAll(selector));
      }
      return out;
    },
    cloneNode() {
      const copy = node({
        role,
        roleAttr,
        testid,
        text,
        tag,
        children: el.children.map((child) => child.cloneNode(true))
      });
      return copy;
    },
    remove() {
      if (!el.parent) return;
      el.parent.children = el.parent.children.filter((child) => child !== el);
    }
  };
  Object.defineProperty(el, "innerText", { get() { return flattenText(el); } });
  Object.defineProperty(el, "textContent", { get() { return flattenText(el); } });
  for (const child of children) child.parent = el;
  return el;
}

function turn(testid, children) {
  return node({ testid, tag: "article", children });
}

function buildDoc(children) {
  const main = node({ tag: "main", children });
  const doc = node({ tag: "div", children: [main] });
  doc.body = main;
  const orig = doc.querySelectorAll.bind(doc);
  doc.querySelector = (selector) => {
    if (selector === "main") return main;
    return orig(selector)[0] || null;
  };
  return doc;
}

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

test("treats an overflow JSON fragment as a code scroller", () => {
  sandbox.document = { body: null, documentElement: null, scrollingElement: null };
  const fragment = {
    className: "overflow-y-auto",
    tagName: "DIV",
    scrollHeight: 2000,
    clientHeight: 400,
    innerText: '{ "company": "HexArmor", "bullets": ["Supported delivery"] }',
    get textContent() {
      return this.innerText;
    },
    getAttribute() {
      return "";
    },
    closest() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  assert.equal(sandbox.__brightstarDomHarvest.looksLikeJsonFragment(fragment.innerText), true);
  assert.equal(sandbox.__brightstarDomHarvest.looksLikeCodeScroller(fragment), true);
  const monaco = {
    className: "monaco-scrollable-element",
    tagName: "DIV",
    scrollHeight: 100,
    clientHeight: 100,
    innerText: "",
    textContent: "",
    getAttribute() {
      return "";
    },
    closest() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  assert.equal(sandbox.__brightstarDomHarvest.looksLikeCodeScroller(monaco), true);
});

test("reads a resume turn that has no data-message-author-role", () => {
  const json = JSON.stringify({
    name: "D'Mario Lewis",
    experience: [{ company: "Culligan", bullets: ["Supported software development and delivery"] }]
  });
  const doc = buildDoc([
    turn("conversation-turn-1", [
      node({ role: "user", roleAttr: "data-message-role", text: "Rewrite this resume" }),
      node({ text: json })
    ])
  ]);
  const texts = sandbox.__brightstarDomHarvest.collectAssistantTexts(doc);
  assert.equal(texts.some((t) => t.includes('"experience"') && t.includes("Culligan")), true);
  assert.equal(sandbox.__brightstarDomHarvest.pageHasResumeMarkers(doc), true);
  const counts = sandbox.__brightstarDomHarvest.countChatBlocks(doc);
  assert.equal(counts.userBlocks > 0, true);
  assert.equal(counts.assistantBlocks > 0, true);
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
