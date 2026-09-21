import test from "node:test";
import assert from "node:assert/strict";

import { plainTextToResumeData } from "../resume-text.js";
import { resumeJsonToHtml } from "../templates/index.js";

function resumeWithEducation(eduBody) {
  return `DAVID LEANDRO DE OLIVEIRA
SENIOR SALESFORCE SPECIALIST
Paulista, Pernambuco, Brazil | davidoliveira2308l@gmail.com

SUMMARY
Senior Salesforce Specialist with 9 years of experience.

EXPERIENCE
Intrado
Senior Salesforce Engineer
Jun 2024 – Present
Colorado, United States | Remote
Did Salesforce work.

EDUCATION
${eduBody}

SKILLS
Salesforce Clouds: Sales Cloud, Service Cloud
`;
}

test("blank-line education paste keeps school, degree, city, and dates together", () => {
  const data = plainTextToResumeData(
    resumeWithEducation(`Bachelor of Science in Computer Science

Federal University of Pernambuco

Recife, Brazil

Mar 2013 – Aug 2017`)
  );
  assert.equal(data.education.length, 1);
  const edu = data.education[0];
  assert.match(edu.school, /Pernambuco/i);
  assert.match(edu.degree, /Bachelor of Science in Computer Science/i);
  assert.match(edu.details, /Recife,\s*Brazil/i);
  assert.match(edu.year, /2013/);
  assert.match(edu.year, /2017/);
});

test("consecutive education lines still parse school, city, and year", () => {
  const data = plainTextToResumeData(
    resumeWithEducation(`Bachelor of Science in Computer Science
Federal University of Pernambuco
Recife, Brazil
Mar 2013 – Aug 2017`)
  );
  assert.equal(data.education.length, 1);
  const edu = data.education[0];
  assert.match(edu.school, /Pernambuco/i);
  assert.match(edu.degree, /Bachelor/i);
  assert.equal(edu.details, "Recife, Brazil");
  assert.match(edu.year, /Mar 2013/);
});

test("two schools separated by blank lines stay two entries", () => {
  const data = plainTextToResumeData(
    resumeWithEducation(`Massachusetts Institute of Technology

Bachelor of Science

Cambridge, MA

2010 - 2014

Stanford University

Master of Science

Stanford, CA

2014 - 2016`)
  );
  assert.equal(data.education.length, 2);
  assert.match(data.education[0].school, /Massachusetts/i);
  assert.match(data.education[0].details, /Cambridge/i);
  assert.match(data.education[1].school, /Stanford/i);
  assert.match(data.education[0].year, /2010/);
  assert.match(data.education[1].year, /2014/);
});

test("Harvard Rule HTML includes education location and year from blank-line paste", () => {
  const data = plainTextToResumeData(
    resumeWithEducation(`Bachelor of Science in Computer Science

Federal University of Pernambuco

Recife, Brazil

Mar 2013 – Aug 2017`)
  );
  const html = resumeJsonToHtml(data, "harvard-rule");
  assert.match(html, /edu-degree/);
  assert.match(html, /Federal University of Pernambuco/);
  assert.match(html, /Recife, Brazil/);
  assert.match(html, /edu-year/);
  assert.match(html, /2013/);
  assert.match(html, /2017/);
});

function resumeWithSkills(skillsBody) {
  return `STEVEN AVON
SENIOR SALESFORCE ARCHITECT
New York, NY | steven@example.com

SUMMARY
Salesforce architect with 12 years across Service Cloud and Genesys CTI.

EXPERIENCE
Acme Corp
Salesforce Architect
Jan 2020 – Present
New York, NY | Remote
Led the Genesys integration.

TECHNICAL SKILLS
${skillsBody}
`;
}

function skillsOf(skillsBody) {
  return plainTextToResumeData(resumeWithSkills(skillsBody)).skills;
}

const TWO_ROWS = [
  ["Salesforce Clouds", "Service Cloud, Sales Cloud"],
  ["Automation", "Record-Triggered Flows, Screen Flows"]
];

function assertTwoRows(skills) {
  assert.deepEqual(
    skills.map((r) => [r.category, r.items]),
    TWO_ROWS
  );
}

test("skills table copied out of a PDF re-pairs one-cell-per-line into categories", () => {
  const skills = skillsOf(`Category
Technologies / Skills
Salesforce Clouds
Service Cloud, Sales Cloud, Experience Cloud, Data Cloud
Genesys & Contact Center
Genesys Cloud CX, Open CTI, IVR, ACD, Skill-Based Routing
DevOps & CI/CD
Git, Salesforce CLI/SFDX, Change Sets`);

  assert.deepEqual(
    skills.map((r) => r.category),
    ["Salesforce Clouds", "Genesys & Contact Center", "DevOps & CI/CD"]
  );
  // The "Category" / "Technologies / Skills" header cells never become data.
  for (const row of skills) {
    assert.doesNotMatch(row.items, /Technologies \/ Skills/i);
    assert.doesNotMatch(row.items, /^Category,/i);
  }
  assert.match(skills[0].items, /^Service Cloud, Sales Cloud/);
  assert.equal(skills[2].items, "Git, Salesforce CLI/SFDX, Change Sets");
});

test("cell-per-line skills separated by blank lines still pair up", () => {
  assertTwoRows(
    skillsOf(`Salesforce Clouds

Service Cloud, Sales Cloud

Automation

Record-Triggered Flows, Screen Flows`)
  );
});

test("skills parse the same from tab, markdown, colon, pipe, dash, and spaced columns", () => {
  assertTwoRows(
    skillsOf("Category\tTechnologies / Skills\nSalesforce Clouds\tService Cloud, Sales Cloud\nAutomation\tRecord-Triggered Flows, Screen Flows")
  );
  assertTwoRows(
    skillsOf(`| Category | Technologies / Skills |
| --- | --- |
| Salesforce Clouds | Service Cloud, Sales Cloud |
| Automation | Record-Triggered Flows, Screen Flows |`)
  );
  assertTwoRows(
    skillsOf(`Salesforce Clouds: Service Cloud, Sales Cloud
Automation: Record-Triggered Flows, Screen Flows`)
  );
  assertTwoRows(
    skillsOf(`Salesforce Clouds | Service Cloud, Sales Cloud
Automation | Record-Triggered Flows, Screen Flows`)
  );
  assertTwoRows(
    skillsOf(`Salesforce Clouds – Service Cloud, Sales Cloud
Automation - Record-Triggered Flows, Screen Flows`)
  );
  assertTwoRows(
    skillsOf(`Salesforce Clouds    Service Cloud, Sales Cloud
Automation          Record-Triggered Flows, Screen Flows`)
  );
  assertTwoRows(
    skillsOf(`• Salesforce Clouds: Service Cloud, Sales Cloud
- Automation: Record-Triggered Flows, Screen Flows`)
  );
});

test("an items cell wrapped across lines knits back into one row", () => {
  const skills = skillsOf(`Integration Technologies: REST/SOAP APIs, Apex Callouts, JSON/XML, Named
Credentials, OAuth, Platform Events
Security & Data: OWD, Role Hierarchies`);

  assert.equal(skills.length, 2);
  assert.equal(
    skills[0].items,
    "REST/SOAP APIs, Apex Callouts, JSON/XML, Named Credentials, OAuth, Platform Events"
  );
  assert.equal(skills[1].category, "Security & Data");
});

test("an uncategorized comma list stays one Skills row", () => {
  const skills = skillsOf(`Apex, Lightning Web Components, SOQL, Flow Builder
Genesys Cloud CX, Open CTI, IVR, ACD`);

  assert.equal(skills.length, 1);
  assert.equal(skills[0].category, "Skills");
  assert.equal(
    skills[0].items,
    "Apex, Lightning Web Components, SOQL, Flow Builder, Genesys Cloud CX, Open CTI, IVR, ACD"
  );
});

test("cell-per-line skills render as real table rows, not one keyword dump", () => {
  const data = plainTextToResumeData(
    resumeWithSkills(`Salesforce Clouds
Service Cloud, Sales Cloud
Automation
Record-Triggered Flows, Screen Flows`)
  );
  // Table templates get two real rows...
  const table = resumeJsonToHtml(data, "ats-modern");
  assert.match(table, /<td class="skill-cat">Salesforce Clouds<\/td>/);
  assert.match(table, /<td class="skill-cat">Automation<\/td>/);
  assert.doesNotMatch(table, /Technologies \/ Skills<\/td>/);

  // ...and inline templates get two labelled lines.
  const inline = resumeJsonToHtml(data, "harvard-rule");
  assert.match(inline, /<span class="skill-cat">Salesforce Clouds:<\/span>/);
  assert.match(inline, /<span class="skill-cat">Automation:<\/span>/);
});
