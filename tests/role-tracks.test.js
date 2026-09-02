import test from "node:test";
import assert from "node:assert/strict";

import {
  getRoleTrack,
  jdRequiredSkills,
  resolveEffectiveRoleTrack,
  resolveRoleTrackForPerson,
  isTrackDefaultPrompt,
  normalizeRoleTrackId
} from "../role-tracks.js";
import { enforceJdSkills, rolesMissingJdSkills } from "../resume-json.js";
import {
  resolvePromptTemplateForTrack,
  resolveCoverLetterTemplateForTrack
} from "../profiles.js";
import { PROMPT as dmarioPrompt } from "../prompts/dmario-lewis.js";
import { PROMPT as deSeniorPrompt } from "../prompts/de-senior.js";

test("normalizeRoleTrackId defaults invalid values to sf", () => {
  assert.equal(normalizeRoleTrackId(""), "sf");
  assert.equal(normalizeRoleTrackId("de"), "de");
  assert.equal(normalizeRoleTrackId("unknown"), "sf");
});

test("jdRequiredSkills returns track-specific catalog matches", () => {
  const sfJd = "Service Cloud Apex SOQL integration architecture";
  const deJd = "Snowflake dbt Airflow Kafka data pipeline warehouse";
  const fsJd = "React TypeScript Node.js Kubernetes AWS";
  const aiJd = "LLM evaluation RAG Python prompt engineering";

  assert.ok(jdRequiredSkills(sfJd, "sf").some((p) => p.name === "Service Cloud"));
  assert.ok(jdRequiredSkills(deJd, "de").some((p) => p.name === "Snowflake"));
  assert.ok(jdRequiredSkills(fsJd, "fs").some((p) => p.name === "React"));
  assert.ok(jdRequiredSkills(aiJd, "ai").some((p) => p.name === "LLM evaluation"));
});

test("resolveEffectiveRoleTrack prefers session override", () => {
  const person = { roleTrack: "sf" };
  assert.equal(resolveEffectiveRoleTrack(person, ""), "sf");
  assert.equal(resolveEffectiveRoleTrack(person, "de"), "de");
  assert.equal(resolveEffectiveRoleTrack(person, "fs"), "fs");
});

test("resolveRoleTrackForPerson infers sf for built-in Salesforce profiles", () => {
  assert.equal(resolveRoleTrackForPerson({ id: "dmario-lewis" }), "sf");
  assert.equal(resolveRoleTrackForPerson({ roleTrack: "de" }), "de");
});

test("enforceJdSkills adds DE tools to skills rows", () => {
  const jd = "Senior Data Engineer with Snowflake, dbt, and Apache Airflow";
  const resume = {
    skills: [{ category: "General", items: "Python, SQL" }],
    experience: [{ company: "Acme", bullets: ["Built pipelines."] }]
  };
  const out = enforceJdSkills(resume, jd, "de");
  const allItems = out.skills.map((r) => r.items).join(" ");
  assert.match(allItems, /Snowflake/i);
  assert.match(allItems, /dbt/i);
  assert.match(allItems, /Airflow/i);
});

test("isTrackDefaultPrompt detects shipped track templates", () => {
  const sfPrompt = getRoleTrack("sf").prompt;
  assert.equal(isTrackDefaultPrompt(sfPrompt), true);
  assert.equal(isTrackDefaultPrompt("custom prompt {JD} {NAME} {MASTER_RESUME}"), false);
});

test("rolesMissingJdSkills uses track catalog", () => {
  const jd = "React Node.js TypeScript full stack";
  const resume = {
    experience: [
      { company: "A", bullets: ["General software work."] },
      { company: "B", bullets: ["More general work."] }
    ]
  };
  const gaps = rolesMissingJdSkills(resume, jd, { roleTrack: "fs", roles: 2, minBullets: 2 });
  assert.ok(gaps.length > 0);
});

test("resolvePromptTemplateForTrack keeps built-in SF prompt on SF track", () => {
  const person = { id: "dmario-lewis", promptTemplate: dmarioPrompt, roleTrack: "sf" };
  assert.equal(resolvePromptTemplateForTrack(person, "sf"), dmarioPrompt);
});

test("resolvePromptTemplateForTrack uses DE template for built-in when track is DE", () => {
  const person = { id: "edrwin-revolorio", promptTemplate: dmarioPrompt, roleTrack: "sf" };
  assert.equal(resolvePromptTemplateForTrack(person, "de"), deSeniorPrompt);
});

test("resolvePromptTemplateForTrack keeps custom non-default prompt on matching track", () => {
  const custom = "Custom resume prompt {JD} {NAME} {MASTER_RESUME} with unique xyz123 content";
  const person = { id: "custom-jane", promptTemplate: custom, roleTrack: "de" };
  assert.equal(resolvePromptTemplateForTrack(person, "de"), custom);
});

test("resolveCoverLetterTemplateForTrack switches when session track differs", () => {
  const person = {
    id: "custom-jane",
    roleTrack: "sf",
    coverLetterPrompt: getRoleTrack("sf").coverLetterPrompt
  };
  const fsCover = resolveCoverLetterTemplateForTrack(person, "fs");
  assert.equal(fsCover, getRoleTrack("fs").coverLetterPrompt);
});
