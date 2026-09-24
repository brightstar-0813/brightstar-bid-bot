import test from "node:test";
import assert from "node:assert/strict";

import {
  getRoleTrack,
  jdRequiredSkills,
  resolveEffectiveRoleTrack,
  resolveRoleTrackForPerson,
  isRoleTrackLockedForPerson,
  isTrackDefaultPrompt,
  normalizeRoleTrackId
} from "../role-tracks.js";
import { enforceJdSkills, rolesMissingJdSkills } from "../resume-json.js";
import {
  resolvePromptTemplateForTrack,
  resolveCoverLetterTemplateForTrack,
  resolveResumePromptForVersion
} from "../profiles.js";
import { PROMPT as dmarioPrompt } from "../prompts/dmario-lewis.js";
import { PROMPT as deSeniorPrompt } from "../prompts/de-senior.js";
import { PROMPT as davidDePrompt } from "../prompts/david-oliveira-de.js";
import { PROMPT as sfSeniorPrompt } from "../prompts/sf-senior.js";
import { PROMPT as sfTestPrompt } from "../prompts/sf-test.js";
import { PROMPT as aiV2Prompt } from "../prompts/ai-v2.js";
import { ATS_RECRUITER_PASS } from "../role-tracks.js";

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
  // Draft / unset id only — saved profiles lock their setup track.
  const person = { roleTrack: "sf" };
  assert.equal(resolveEffectiveRoleTrack(person, ""), "sf");
  assert.equal(resolveEffectiveRoleTrack(person, "de"), "de");
  assert.equal(resolveEffectiveRoleTrack(person, "fs"), "fs");
});

test("resolveEffectiveRoleTrack ignores session override for built-in profiles", () => {
  const sfBuiltin = { id: "dmario-lewis", roleTrack: "sf", builtin: true };
  const deBuiltin = { id: "david-oliveira-de", roleTrack: "de", builtin: true };
  assert.equal(resolveEffectiveRoleTrack(sfBuiltin, "de"), "sf");
  assert.equal(resolveEffectiveRoleTrack(sfBuiltin, "fs"), "sf");
  assert.equal(resolveEffectiveRoleTrack(deBuiltin, "sf"), "de");
  assert.equal(resolveEffectiveRoleTrack(deBuiltin, "ai"), "de");
});

test("resolveEffectiveRoleTrack ignores session override for saved custom profiles", () => {
  const custom = { id: "custom-jane", roleTrack: "de", builtin: false };
  assert.equal(resolveEffectiveRoleTrack(custom, "sf"), "de");
  assert.equal(resolveEffectiveRoleTrack(custom, "ai"), "de");
});

test("isRoleTrackLockedForPerson locks built-ins and saved customs", () => {
  assert.equal(isRoleTrackLockedForPerson({ builtin: true, roleTrack: "sf" }), true);
  assert.equal(isRoleTrackLockedForPerson({ id: "custom-1", builtin: false, roleTrack: "de" }), true);
  assert.equal(isRoleTrackLockedForPerson({ roleTrack: "fs" }), false);
  assert.equal(isRoleTrackLockedForPerson({ id: "", roleTrack: "ai" }), false);
});

test("resolveRoleTrackForPerson infers sf for built-in Salesforce profiles", () => {
  assert.equal(resolveRoleTrackForPerson({ id: "dmario-lewis" }), "sf");
  assert.equal(resolveRoleTrackForPerson({ id: "sandeep-mahankali" }), "sf");
  assert.equal(resolveRoleTrackForPerson({ roleTrack: "de" }), "de");
});

test("resolveRoleTrackForPerson infers de for built-in David DE profile", () => {
  assert.equal(resolveRoleTrackForPerson({ id: "david-oliveira-de" }), "de");
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

test("resolvePromptTemplateForTrack keeps built-in DE prompt on DE track", () => {
  const person = {
    id: "david-oliveira-de",
    promptTemplate: davidDePrompt,
    roleTrack: "de"
  };
  assert.equal(resolvePromptTemplateForTrack(person, "de"), davidDePrompt);
  assert.equal(resolvePromptTemplateForTrack(person, "sf"), sfSeniorPrompt);
});

test("resolvePromptTemplateForTrack keeps custom non-default prompt on matching track", () => {
  const custom = "Custom resume prompt {JD} {NAME} {MASTER_RESUME} with unique xyz123 content";
  const person = { id: "custom-jane", promptTemplate: custom, roleTrack: "de" };
  assert.equal(resolvePromptTemplateForTrack(person, "de"), custom);
});

test("resolveResumePromptForVersion keeps built-in SF prompt on v1", () => {
  const person = { id: "dmario-lewis", promptTemplate: dmarioPrompt, roleTrack: "sf" };
  assert.equal(resolveResumePromptForVersion(person, "sf", "v1"), dmarioPrompt);
  assert.equal(resolveResumePromptForVersion(person, "sf"), dmarioPrompt);
});

test("resolveResumePromptForVersion uses the shared test prompt for built-in and custom SF", () => {
  const builtin = { id: "dmario-lewis", promptTemplate: dmarioPrompt, roleTrack: "sf" };
  const customPrompt = "Custom SF prompt {JD} {NAME} {MASTER_RESUME} unique xyz123";
  const custom = { id: "custom-sf", promptTemplate: customPrompt, roleTrack: "sf" };
  assert.equal(resolveResumePromptForVersion(builtin, "sf", "test"), sfTestPrompt);
  assert.equal(resolveResumePromptForVersion(custom, "sf", "test"), sfTestPrompt);
  assert.equal(resolveResumePromptForVersion(custom, "sf", "v1"), customPrompt);
  assert.doesNotMatch(sfTestPrompt, /ChowNow|Bluebeam|Hilmar/);
  assert.match(sfTestPrompt, /\{JD\}/);
  assert.match(sfTestPrompt, /\{MASTER_RESUME\}/);
});

test("resolveResumePromptForVersion uses the shared v2 prompt for any person", () => {
  const builtin = { id: "dmario-lewis", promptTemplate: dmarioPrompt, roleTrack: "sf" };
  const custom = {
    id: "custom-sf",
    promptTemplate: "Custom SF prompt {JD} {NAME} {MASTER_RESUME}",
    roleTrack: "sf"
  };
  const dePerson = {
    id: "david-oliveira-de",
    promptTemplate: davidDePrompt,
    roleTrack: "de"
  };
  assert.equal(resolveResumePromptForVersion(builtin, "sf", "v2"), aiV2Prompt);
  assert.equal(resolveResumePromptForVersion(custom, "sf", "v2"), aiV2Prompt);
  assert.equal(resolveResumePromptForVersion(dePerson, "de", "v2"), aiV2Prompt);
  assert.match(aiV2Prompt, /\{JD\}/);
  assert.match(aiV2Prompt, /\{MASTER_RESUME\}/);
  assert.match(aiV2Prompt, /\{NAME\}/);
  assert.doesNotMatch(aiV2Prompt, /Jos[eé]|Azumo|Accenture|Let's Delivery|ADVERSE|Florian[oó]polis|silvajoser/i);
});

test("ATS recruiter pass requires exact JD spellings in recent-role bullets", () => {
  assert.match(ATS_RECRUITER_PASS, /exact spelling/i);
  assert.match(ATS_RECRUITER_PASS, /two most recent roles/i);
  assert.match(ATS_RECRUITER_PASS, /6–7 sentences/);
  for (const id of ["sf", "de", "fs", "ai"]) {
    assert.match(getRoleTrack(id).atsAppendix, /ATS \+ RECRUITER PASS/);
  }
});

test("resolveResumePromptForVersion ignores the SF test setting on a non-SF track", () => {
  const person = {
    id: "david-oliveira-de",
    promptTemplate: davidDePrompt,
    roleTrack: "de"
  };
  assert.equal(resolveResumePromptForVersion(person, "de", "test"), davidDePrompt);
  assert.equal(resolveResumePromptForVersion(person, "de", "v1"), davidDePrompt);
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

test("ATS appendices use evidence match and forbid keyword-dump sections", () => {
  for (const id of ["sf", "de", "fs", "ai"]) {
    const appendix = getRoleTrack(id).atsAppendix || "";
    assert.match(appendix, /ATS EVIDENCE MATCH/i);
    assert.doesNotMatch(appendix, /KEYWORD DENSITY/i);
    assert.match(appendix, /JD Keywords/i);
    assert.match(appendix, /HARD FORBIDDEN/i);
    assert.match(appendix, /full-sentence/i);
    assert.match(appendix, /EXACT JD spellings/i);
  }
});
