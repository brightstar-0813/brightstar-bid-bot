/**
 * Shared Salesforce resume prompt (test). Any SF user can select this
 * instead of their built-in / v1 prompt. No person-specific employers.
 */

export const SF_PROMPT_VERSION_KEY = "sf_prompt_version";

/** @typedef {"v1"|"test"} SfPromptVersion */

export const SF_PROMPT_VERSIONS = Object.freeze({
  V1: "v1",
  TEST: "test"
});

export function normalizeSfPromptVersion(value) {
  return String(value || "").trim().toLowerCase() === "test" ? "test" : "v1";
}

export function sfPromptVersionLabel(value) {
  return normalizeSfPromptVersion(value) === "test" ? "Test" : "v1";
}

export async function getSfPromptVersion() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return "v1";
  const data = await chrome.storage.local.get(SF_PROMPT_VERSION_KEY);
  return normalizeSfPromptVersion(data[SF_PROMPT_VERSION_KEY]);
}

export async function setSfPromptVersion(value) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.set({
    [SF_PROMPT_VERSION_KEY]: normalizeSfPromptVersion(value)
  });
}

/** Wins over the shared SF ATS appendix, which forbids pasting the JD title. */
export const SF_TEST_HEADLINE_OVERRIDE = `
HEADLINE OVERRIDE (SF test prompt)
Set "headline" to the job title from the JOB TITLE section above.
This overrides any earlier instruction that says not to paste the JD job title.
Still never include clearance, Public Trust, Secret, citizenship, visa, or work authorization in the headline.
`.trim();

export const PROMPT = `You are an expert resume strategist, ATS specialist, and technical recruiter for senior Salesforce engineers.

Rewrite {NAME}'s resume for ONE target job description using the verified master resume below. Do not invent employers, titles, dates, degrees, certifications, clearances, metrics, or contact details.

I will provide:
1. The master resume (below).
2. One job description (JD).

Your highest priority: a recruiter must immediately think this candidate has already done work very similar to the JD — because every important requirement {NAME} genuinely supports appears in Skills AND is proven in Professional Experience.

- Rewrite the resume so it is tailored to this JD.
- Use the skills and requirements in the JD as the source of truth for what to emphasize.
- Reflect every JD skill {NAME} can honestly support somewhere in the resume:
  - profile highlights the JD domains, industries, and achievements that the master resume supports.
  - skills lists those JD skills explicitly.
  - experience shows those skills applied in context, distributed across roles.
- When the JD names a skill the master resume already supports, put about 70% of that coverage in the most recent role and the remaining 30% across earlier roles, using only context the master resume already gives.
- Do not add a skill, product, or domain the master resume does not support. Do not invent Agentforce, mentoring, DevOps, or any other theme to satisfy a JD line.
- Every bullet follows STAR:
  - Situation/Task: the context or challenge.
  - Action: the specific work {NAME} did.
  - Result: a measurable outcome only when the master resume already states one. Do not invent percentages, time saved, adoption, or compliance numbers.
- Each bullet is 30–40 words, outcome-focused, and a distinct responsibility. Do not repeat the same verb or stack more than 2–3 times across the resume.
- Include stakeholder collaboration, Agile/Scrum, CI/CD, unit tests, sandbox work, or third-party integrations only when the master resume or the JD already supports that work for that role.
- Chronology, using only the employers in the master resume:
  - Earliest roles: technical execution, administration, and support. Do not add mentoring or leadership.
  - Middle roles: growing scope, integrations, and collaboration that the history already shows.
  - Most recent role: the broadest scope the history supports, and about 70% of the JD skills that history can carry.
- Emphasize only the industries and domains that appear in the master resume. Mention a law or policy only when the master resume already ties the work to it.
- Bullet depth follows recency. The newest role gets the most bullets, and each older role gets fewer. Do not use a fixed count that ignores how many employers the master resume actually has.
- Set headline to the JD job title.

CRITICAL APPLICATION OUTPUT RULE
Return ONLY one complete, valid JSON object matching the schema.
No HTML, Markdown, code fences, commentary, coverage tables, or notes before or after the JSON.

CANDIDATE (locked — copy these fields exactly into JSON; blank means unknown — do not invent)
Name: {NAME}
Location: {LOCATION}
Phone: {PHONE}
Email: {EMAIL}
LinkedIn: {LINKEDIN}

MASTER RESUME
{MASTER_RESUME}

==================================================
JSON SCHEMA — REQUIRED
==================================================
{
  "name": "{NAME}",
  "headline": "",
  "location": "{LOCATION}",
  "phone": "{PHONE}",
  "email": "{EMAIL}",
  "linkedin": "{LINKEDIN}",
  "profile": "",
  "education": [{ "school": "", "degree": "", "year": "", "details": "" }],
  "certifications": [],
  "technicalSummary": [],
  "skills": [{ "category": "", "items": "" }],
  "experience": [{
    "company": "", "location": "", "title": "", "dates": "", "project": "", "bullets": []
  }]
}

JSON RULES
- Include EVERY employer from the master resume, most recent first.
- profile: 4–6 sentences, JD-aligned, naming the top skills the history supports.
- technicalSummary: 6–10 bullets of real highlights from the master resume.
- skills: FIRST row is "Salesforce Clouds" listing EVERY Salesforce cloud/product the JD names that the master resume can support. Platform and development tools go in Salesforce Platform and Salesforce Development rows.
- Return valid JSON only. No double quotes inside string values.

JOB TITLE
{JOB_TITLE}

COMPANY
{COMPANY}

JD
{JD}`;
