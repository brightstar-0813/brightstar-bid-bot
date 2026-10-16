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
  BUILTIN_PROFILES,
  profileMenuLabel,
  resolvePromptTemplateForTrack,
  resolveCoverLetterTemplateForTrack,
  resolveResumePrompt
} from "../profiles.js";
import { PROMPT as sfSeniorPrompt } from "../prompts/sf-senior.js";
import { PROMPT as sfTestPrompt } from "../prompts/sf-test.js";
import { PROMPT as resumeV3Prompt } from "../prompts/resume-v3.js";
import { effectiveResumePromptId, normalizeResumePromptId } from "../prompts/resume-catalog.js";
import { ATS_RECRUITER_PASS, profileStoryBlock } from "../role-tracks.js";

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
  const deBuiltin = { id: "raquel-oliveira-de", roleTrack: "de", builtin: true };
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
  assert.equal(resolveRoleTrackForPerson({ id: "raquel-oliveira" }), "sf");
  assert.equal(resolveRoleTrackForPerson({ roleTrack: "de" }), "de");
});

test("resolveRoleTrackForPerson infers de for built-in data-engineering profiles", () => {
  assert.equal(resolveRoleTrackForPerson({ id: "raquel-oliveira-de" }), "de");
  assert.equal(resolveRoleTrackForPerson({ id: "jessel-tampus-de" }), "de");
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

test("profile menu label puts the track acronym beside the name", () => {
  const byId = (id) => BUILTIN_PROFILES.find((p) => p.id === id);
  assert.equal(profileMenuLabel(byId("dmario-lewis")), "D'Mario Lewis (SF)");
  assert.equal(profileMenuLabel(byId("sandeep-mahankali")), "Sandeep Mahankali (SF)");
  assert.equal(profileMenuLabel(byId("raquel-oliveira")), "Raquel Silva (SF)");
  assert.equal(profileMenuLabel(byId("raquel-oliveira-de")), "Raquel Silva De Oliveira (DE)");
  assert.equal(profileMenuLabel(byId("jessel-tampus-de")), "Jessel Tampus (DE)");
  assert.equal(
    profileMenuLabel({ label: "Jane Doe (custom)", name: "Jane Doe", roleTrack: "fs", builtin: false }),
    "Jane Doe (FS)"
  );
  assert.equal(profileMenuLabel({ name: "Ada Lovelace", roleTrack: "ai" }), "Ada Lovelace (AI)");
});

test("built-in resume profiles keep career facts and no resume prompt", () => {
  const resumes = BUILTIN_PROFILES.filter((p) => p.kind !== "coverLetter");
  assert.ok(resumes.length >= 8);
  for (const person of resumes) {
    assert.equal(String(person.promptTemplate || "").trim(), "");
    assert.match(person.masterResume, new RegExp(person.requiredExperience[0], "i"));
    assert.match(person.masterResume, /EDUCATION/i);
    assert.doesNotMatch(person.masterResume, /SEVEN GATES|FIXED COMPANY HISTORY/);
  }
});

test("resolvePromptTemplateForTrack is the track senior prompt for every track", () => {
  const person = { id: "dmario-lewis", promptTemplate: "Custom {JD}", roleTrack: "sf" };
  for (const id of ["sf", "de", "fs", "ai"]) {
    assert.equal(resolvePromptTemplateForTrack(person, id), getRoleTrack(id).prompt);
  }
});

test("resolveResumePrompt defaults to the track senior prompt", () => {
  const person = { id: "dmario-lewis", promptTemplate: "Custom {JD} xyz", roleTrack: "sf" };
  assert.equal(resolveResumePrompt(person, "sf", "track"), sfSeniorPrompt);
  assert.equal(resolveResumePrompt(person, "sf", "v1"), sfSeniorPrompt);
  assert.equal(resolveResumePrompt(person, "de", "track"), getRoleTrack("de").prompt);
  assert.equal(resolveResumePrompt(person, "fs"), getRoleTrack("fs").prompt);
  assert.equal(resolveResumePrompt(person, "ai", ""), getRoleTrack("ai").prompt);
});

test("resolveResumePrompt uses v3 on every track and vector only on SF", () => {
  const person = { id: "raquel-oliveira-de", promptTemplate: "", roleTrack: "de" };
  assert.equal(resolveResumePrompt(person, "de", "v3"), resumeV3Prompt);
  assert.equal(resolveResumePrompt(person, "ai", "v3"), resumeV3Prompt);
  assert.equal(resolveResumePrompt(person, "sf", "vector"), sfTestPrompt);
  assert.equal(resolveResumePrompt(person, "sf", "test"), sfTestPrompt);
  assert.equal(resolveResumePrompt(person, "de", "vector"), getRoleTrack("de").prompt);
  assert.equal(resolveResumePrompt(person, "fs", "test"), getRoleTrack("fs").prompt);
  assert.match(sfTestPrompt, /\{JD\}/);
  assert.match(sfTestPrompt, /\{MASTER_RESUME\}/);
  assert.match(resumeV3Prompt, /\{JD\}/);
  assert.match(resumeV3Prompt, /\{MASTER_RESUME\}/);
  assert.doesNotMatch(resumeV3Prompt, /Becton|Cognizant|Secure Haven|EPAM|Centre Technologies/i);
});

test("resolveResumePrompt uses a saved custom prompt only when Custom is selected", () => {
  const custom = "Custom resume prompt {JD} {NAME} {MASTER_RESUME} with unique xyz123 content";
  const person = { id: "custom-jane", promptTemplate: custom, roleTrack: "de" };
  assert.equal(resolveResumePrompt(person, "de", "custom"), custom);
  assert.equal(resolveResumePrompt(person, "de", "track"), getRoleTrack("de").prompt);
  assert.equal(
    resolveResumePrompt({ id: "custom-jane", promptTemplate: "", roleTrack: "de" }, "de", "custom"),
    getRoleTrack("de").prompt
  );
});

test("normalizeResumePromptId maps the old menu onto the shared catalog", () => {
  assert.equal(normalizeResumePromptId("v1"), "track");
  assert.equal(normalizeResumePromptId(""), "track");
  assert.equal(normalizeResumePromptId("test"), "vector");
  assert.equal(normalizeResumePromptId("v3"), "v3");
  assert.equal(effectiveResumePromptId("vector", "ai"), "track");
  assert.equal(effectiveResumePromptId("custom", "sf", { customReady: false }), "track");
});

test("ATS recruiter pass requires exact JD spellings in recent-role bullets", () => {
  assert.match(ATS_RECRUITER_PASS, /exact spelling/i);
  assert.match(ATS_RECRUITER_PASS, /two most recent roles/i);
  assert.match(ATS_RECRUITER_PASS, /years already stated on the master resume/i);
  assert.match(ATS_RECRUITER_PASS, /Do not invent a number/i);
  assert.match(ATS_RECRUITER_PASS, /hands-on background/i);
  assert.match(ATS_RECRUITER_PASS, /external systems/i);
  assert.match(ATS_RECRUITER_PASS, /life-like account/i);
  assert.match(ATS_RECRUITER_PASS, /new professional summary/i);
  assert.match(ATS_RECRUITER_PASS, /failed draft/i);
  assert.match(ATS_RECRUITER_PASS, /Do not copy or paraphrase the summary/i);
  assert.doesNotMatch(ATS_RECRUITER_PASS, /life story/i);
  assert.doesNotMatch(ATS_RECRUITER_PASS, /6–7 sentences/);
  assert.doesNotMatch(ATS_RECRUITER_PASS, /assigned voice/i);
  assert.doesNotMatch(ATS_RECRUITER_PASS, /how the work took hold/i);
  assert.match(ATS_RECRUITER_PASS, /not an employer-by-employer chronology/i);
  assert.match(ATS_RECRUITER_PASS, /at most one employer/i);
  assert.match(ATS_RECRUITER_PASS, /No first-person pronouns/);
  assert.match(ATS_RECRUITER_PASS, /No personal name/);
  assert.match(ATS_RECRUITER_PASS, /exact product and tool names/i);
  assert.match(ATS_RECRUITER_PASS, /Banned openings/);
  assert.match(ATS_RECRUITER_PASS, /has been the thread/);
  assert.match(ATS_RECRUITER_PASS, /has not let go/);
  assert.match(ATS_RECRUITER_PASS, /the pattern still holds/);
  assert.doesNotMatch(ATS_RECRUITER_PASS, /life-like story/i);
  assert.doesNotMatch(ATS_RECRUITER_PASS, /talks about a lifelong pull/);
  assert.doesNotMatch(ATS_RECRUITER_PASS, /deepens respect for the technology/);
  for (const id of ["sf", "de", "fs", "ai"]) {
    assert.match(getRoleTrack(id).atsAppendix, /ATS \+ RECRUITER PASS/);
    assert.match(getRoleTrack(id).prompt, /new professional summary/i);
    assert.match(getRoleTrack(id).prompt, /years already stated/i);
    assert.match(getRoleTrack(id).prompt, /hands-on tools/i);
    assert.match(getRoleTrack(id).prompt, /external systems/i);
    assert.match(getRoleTrack(id).prompt, /life-like account/i);
    assert.match(getRoleTrack(id).prompt, /failed draft/i);
    assert.doesNotMatch(getRoleTrack(id).prompt, /assigned profile voice/i);
    assert.doesNotMatch(getRoleTrack(id).prompt, /life story/i);
    assert.doesNotMatch(getRoleTrack(id).prompt, /how the work took hold/i);
  }
  assert.match(getRoleTrack("de").prompt, /experience, not in profile/);
});

test("profile summary block names this job's tools and lands after the ATS pass", async () => {
  const block = profileStoryBlock("Deliveroo", "Senior Data Engineer");
  assert.match(block, /PROFILE SUMMARY/);
  assert.match(block, /Senior Data Engineer at Deliveroo/);
  assert.match(block, /has not let go/);
  assert.match(block, /failed draft/);
  assert.match(block, /life-like account/);
  assert.match(block, /years already stated on the master resume/);
  assert.match(block, /external systems/);
  assert.doesNotMatch(block, /Voice id:/);
  assert.match(
    profileStoryBlock("Deliveroo", "Senior Data Engineer", {
      jdText: "Required: Service Cloud and Apex",
      roleTrack: "sf"
    }),
    /Service Cloud/
  );
  assert.doesNotMatch(block, /how the work took hold/);

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {}
      }
    }
  };
  const { buildPrompt } = await import("../profiles.js");
  const prompt = await buildPrompt("dmario-lewis", "Salesforce Service Cloud role.", {
    strongHumanizeMode: "off",
    companyName: "Deliveroo",
    jobTitle: "Senior Data Engineer",
    roleTrack: "sf"
  });
  assert.match(prompt, /PROFILE SUMMARY/);
  assert.match(prompt, /has been the thread/);
  assert.match(prompt, /Service Cloud/);
  assert.match(prompt, /Do not copy or paraphrase the summary/);
  assert.match(prompt, /life-like account/);
  assert.doesNotMatch(prompt, /how the work took hold/);
  assert.doesNotMatch(prompt, /life story/i);
  assert.doesNotMatch(prompt, /Voice id:/);
  const summaryAt = prompt.lastIndexOf("PROFILE SUMMARY");
  const passAt = prompt.lastIndexOf("ATS + RECRUITER PASS");
  assert.ok(summaryAt > passAt);
});

test("resolveResumePrompt ignores Vector on a non-SF track", () => {
  const person = { id: "raquel-oliveira-de", promptTemplate: "", roleTrack: "de" };
  assert.equal(resolveResumePrompt(person, "de", "test"), getRoleTrack("de").prompt);
  assert.equal(resolveResumePrompt(person, "de", "v1"), getRoleTrack("de").prompt);
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

test("humanize appendix does not ask for invented metrics", async () => {
  const { buildStrongHumanizeAppendix } = await import("../prompts/humanize-resume.js");
  const text = buildStrongHumanizeAppendix("sf");
  assert.doesNotMatch(text, /Include realistic numbers/);
  assert.match(text, /Do not invent metrics/);
});

test("vector headline override is the last headline instruction", async () => {
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {}
      }
    }
  };
  const { buildPrompt } = await import("../profiles.js");
  const { SF_TEST_HEADLINE_OVERRIDE } = await import("../prompts/sf-test.js");
  const prompt = await buildPrompt("dmario-lewis", "Salesforce Service Cloud role.", {
    resumePromptId: "vector",
    strongHumanizeMode: "off",
    jobTitle: "Salesforce Architect",
    roleTrack: "sf"
  });
  const passAt = prompt.lastIndexOf("ATS + RECRUITER PASS");
  const overrideAt = prompt.lastIndexOf("HEADLINE OVERRIDE");
  assert.ok(passAt > 0);
  assert.ok(overrideAt > passAt);
  assert.ok(prompt.trimEnd().endsWith(SF_TEST_HEADLINE_OVERRIDE.trim()));
});

test("first-pass Salesforce bank ranks catalog products from the JD", async () => {
  const { resolveSfProjectBankForJd } = await import("../profiles.js");
  const excerpt = resolveSfProjectBankForJd(
    "Build with Service Cloud, Data Cloud, and Agentforce."
  );
  assert.match(excerpt, /Agentforce/);
  assert.match(excerpt, /Data Cloud/);
  const first = excerpt.split(/(?=^\d+\.\s+)/m).map((part) => part.trim()).filter(Boolean)[0];
  assert.match(first, /Service Cloud|Data Cloud|Agentforce/);
  assert.ok(excerpt.length <= 5500);
});

test("first prompt includes hands-on JD match and the track bank", async () => {
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {}
      }
    }
  };
  const { buildPrompt } = await import("../profiles.js");
  const deJd = "Senior Data Engineer. Snowflake, dbt, and Apache Airflow pipelines.";
  const dePrompt = await buildPrompt("david-oliveira-de", deJd, {
    resumePromptId: "track",
    strongHumanizeMode: "off",
    roleTrack: "de",
    jobTitle: "Senior Data Engineer"
  });
  assert.match(dePrompt, /HANDS-ON JD MATCH/);
  assert.match(dePrompt, /ENTERPRISE DATA ENGINEERING PROJECTS REFERENCE LIBRARY/);
  assert.match(dePrompt, /Snowflake|dbt|Airflow/);
  assert.match(dePrompt, /never paste bank company names/i);
  assert.doesNotMatch(dePrompt, /ENTERPRISE SALESFORCE PROJECTS REFERENCE LIBRARY/);

  const sfPrompt = await buildPrompt("dmario-lewis", "Salesforce Service Cloud role.", {
    resumePromptId: "track",
    strongHumanizeMode: "off",
    roleTrack: "sf",
    jobTitle: "Salesforce Architect"
  });
  assert.match(sfPrompt, /HANDS-ON JD MATCH/);
  assert.match(sfPrompt, /ENTERPRISE SALESFORCE PROJECTS REFERENCE LIBRARY/);
  assert.doesNotMatch(sfPrompt, /ENTERPRISE DATA ENGINEERING PROJECTS REFERENCE LIBRARY/);

  for (const track of ["fs", "ai"]) {
    const prompt = await buildPrompt("dmario-lewis", "Build production software for this role.", {
      resumePromptId: "track",
      strongHumanizeMode: "off",
      roleTrack: track,
      jobTitle: "Senior Engineer"
    });
    assert.match(prompt, /HANDS-ON JD MATCH/);
    assert.doesNotMatch(prompt, /ENTERPRISE DATA ENGINEERING PROJECTS REFERENCE LIBRARY/);
    assert.doesNotMatch(prompt, /ENTERPRISE SALESFORCE PROJECTS REFERENCE LIBRARY/);
  }
});

test("DE bank excerpt prefers warehouse projects for a Snowflake JD", async () => {
  const { resolveDeProjectBankForJd } = await import("../profiles.js");
  const excerpt = resolveDeProjectBankForJd(
    "Senior Data Engineer building Snowflake, dbt, and Apache Airflow pipelines."
  );
  const first = excerpt.split(/(?=^\d+\.\s+)/m).map((part) => part.trim()).filter(Boolean)[0];
  assert.match(first, /Siemens|WesTrac|JetBlue|Symend|SD Worx/);
  assert.ok(excerpt.length <= 5500);
});
