import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { extractCoverLetterText, looksLikeCoverLetterBody } from "../cover-letter-harvest.js";

const harvestCode = readFileSync(fileURLToPath(new URL("../chatgpt-dom-harvest.js", import.meta.url)), "utf8");
const harvestSandbox = {};
runInContext(harvestCode, createContext(harvestSandbox));
const { readNewestAssistantProse } = harvestSandbox.__brightstarDomHarvest;

const culligan = [
  "At Culligan International, I design Salesforce solutions supporting dental and commercial selling, product and client operations, and revenue control aligned with the work this role with Revenue Cloud covers.",
  "Over more than 15 years as a Salesforce Engineer and Architect, I have owned discovery, delivery, customer work, revenue operations, and enterprise CRM architecture, translating business requirements into solutions that teams can use and maintain.",
  "I would welcome the chance to discuss my experience at Culligan further. Thank you for your time and consideration."
].join("\n\n");

const taproot = [
  "As a Taproot Solutions architect, I lead technical architecture and hands-on delivery for a healthcare Salesforce engineering role using Health Cloud, Service Cloud, Data Cloud, and Experience Cloud.",
  "I design patient and provider data models, build Apex services, Lightning Web Components, and Flow automations, and architect the CRM integrations that keep clinical operations in sync.",
  "I would welcome the opportunity to discuss how that Salesforce architecture and delivery experience can help the team. Thank you for your time and exploration."
].join("\n\n");

const resumeJson = JSON.stringify({
  name: "D'Mario Lewis",
  experience: [{ company: "Culligan", title: "Architect", bullets: ["Revenue Cloud"] }],
  technicalSummary: ["Apex", "LWC"],
  certifications: ["PD1"]
});

test("accepts a finished letter that does not start with Dear", () => {
  assert.equal(looksLikeCoverLetterBody(culligan), true);
  assert.equal(extractCoverLetterText(culligan), culligan);
  assert.equal(looksLikeCoverLetterBody(taproot), true);
  assert.match(extractCoverLetterText(taproot), /^As a Taproot Solutions/);
});

test("keeps the letter and drops a leading resume JSON object", () => {
  const mixed = `${resumeJson}\n\n${culligan}`;
  const letter = extractCoverLetterText(mixed);
  assert.match(letter, /^At Culligan International/);
  assert.equal(/"experience"\s*:/.test(letter), false);
  assert.equal(/"technicalSummary"\s*:/.test(letter), false);
  assert.equal(letter.includes("D'Mario Lewis"), false);
});

test("still accepts a Dear Hiring Manager letter", () => {
  const dear = [
    "Dear Hiring Manager,",
    "I am writing to apply for the Salesforce Architect role and to outline how my delivery work maps to the team's Revenue Cloud and integration needs.",
    "Thank you for your time and consideration."
  ].join("\n\n");
  const letter = extractCoverLetterText(`${resumeJson}\n\n${dear}`);
  assert.match(letter, /^Dear Hiring Manager,/);
  assert.equal(/"experience"\s*:/.test(letter), false);
});

function matchSelector(el, selector) {
  const sel = String(selector || "").trim();
  if (!sel) return false;
  let rest = sel;
  const tag = rest.match(/^[a-z]+/i);
  if (tag && !rest.startsWith("[")) {
    if (String(el.tagName || "").toLowerCase() !== tag[0].toLowerCase()) return false;
    rest = rest.slice(tag[0].length);
    if (!rest) return true;
  }
  const attr = rest.match(/^\[([^\]=~|^$*]+)([~|^$*]?=)['"]?([^'"\]]+)['"]?\]$/);
  if (!attr) return false;
  const actual = el.getAttribute(attr[1]);
  if (actual == null) return false;
  if (attr[2] === "=") return actual === attr[3];
  if (attr[2] === "^=") return String(actual).startsWith(attr[3]);
  if (attr[2] === "*=") return String(actual).includes(attr[3]);
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
      return node({
        role,
        roleAttr,
        testid,
        text,
        tag,
        children: el.children.map((child) => child.cloneNode(true))
      });
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

test("keeps a finished letter on a turn that also contains the user prompt", () => {
  const resume = JSON.stringify({
    name: "D'Mario Lewis",
    experience: [{ company: "Culligan", title: "Architect", bullets: ["Revenue Cloud"] }],
    technicalSummary: ["Apex"],
    certifications: ["PD1"]
  });
  const doc = node({
    tag: "div",
    children: [
      node({
        tag: "article",
        testid: "conversation-turn-1",
        children: [node({ role: "assistant", children: [node({ tag: "pre", text: resume })] })]
      }),
      node({
        tag: "article",
        testid: "conversation-turn-2",
        children: [
          node({
            role: "user",
            roleAttr: "data-message-role",
            text: "IMPORTANT: Ignore the resume JSON above. Reply with ONLY the cover letter plain text starting with Dear Hiring Manager, — nothing else."
          }),
          node({ text: culligan })
        ]
      })
    ]
  });
  const prose = readNewestAssistantProse(doc);
  const letter = extractCoverLetterText(prose);
  assert.match(letter, /^At Culligan International/);
  assert.equal(/"experience"\s*:/.test(letter), false);
  assert.equal(looksLikeCoverLetterBody(letter), true);
});

test("keeps the real letter that follows the cover prompt's Dear Hiring Manager line", () => {
  const page = [
    "OUTPUT RULES",
    "- Return PLAIN TEXT only. No HTML, Markdown, code fences, tables, or tags.",
    "- Start with: Dear Hiring Manager,",
    "- Do NOT return JSON, resume content, code fences, or markdown links.",
    "",
    "IMPORTANT: Ignore the resume JSON above. Reply with ONLY the cover letter plain text starting with Dear Hiring Manager, — nothing else.",
    "",
    "Dear Hiring Manager,",
    "",
    "The Sr. Salesforce Marketing Cloud Technical Business Analyst role at Smart Caliber Technology aligns closely with the work I have built across Data Cloud, customer architecture, and hands-on delivery.",
    "",
    "At Culligan International, I work as a Senior Salesforce Engineer and Technical Architect supporting customer acquisition, sales, service, and operational processes.",
    "",
    "Thank you for your time and consideration."
  ].join("\n");
  const letter = extractCoverLetterText(page);
  assert.match(letter, /^Dear Hiring Manager,\n\nThe Sr\. Salesforce Marketing Cloud/);
  assert.equal(/OUTPUT RULES/.test(letter), false);
  assert.equal(/Ignore the resume JSON above/.test(letter), false);
  assert.equal(looksLikeCoverLetterBody(letter), true);
});

test("does not treat a salutation glued to ChatGPT footer chrome as a finished letter", () => {
  const partial =
    "Dear Shimento, Inc. Hiring Team,TheChatGPT can make mistakes. Check important info.Latest responseThinking effortInstant";
  assert.equal(looksLikeCoverLetterBody(partial), false);
  assert.equal(extractCoverLetterText(partial), "");
});

test("strips footer chrome from a finished letter instead of saving the salutation early", () => {
  const finished = [
    "Dear Shimento, Inc. Hiring Team,",
    "The Salesforce CPQ role at Shimento aligns with the hands-on Sales Cloud, Apex, and Lightning work I have delivered across customer acquisition and quoting.",
    "At Culligan International I design Sales Cloud processes, Apex, Lightning Web Components, and Revenue Cloud quoting workflows that keep opportunities and orders in sync.",
    "I would welcome the opportunity to discuss how that experience could support Shimento, Inc. Thank you for your consideration.",
    "ChatGPT can make mistakes. Check important info. Latest response Thinking effort Instant"
  ].join("\n\n");
  const letter = extractCoverLetterText(finished);
  assert.match(letter, /^Dear Shimento, Inc\. Hiring Team,/);
  assert.match(letter, /Thank you for your consideration/);
  assert.equal(/ChatGPT can make mistakes/.test(letter), false);
  assert.equal(/Thinking effort/.test(letter), false);
  assert.equal(looksLikeCoverLetterBody(letter), true);
});

test("rejects resume JSON that has no letter after it", () => {
  assert.equal(extractCoverLetterText(resumeJson), "");
  assert.equal(looksLikeCoverLetterBody(resumeJson), false);
  assert.equal(extractCoverLetterText(""), "");
});
