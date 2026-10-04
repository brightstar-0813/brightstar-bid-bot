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

test("cell-per-line skills render as separate labelled rows, not one keyword dump", () => {
  const data = plainTextToResumeData(
    resumeWithSkills(`Salesforce Clouds
Service Cloud, Sales Cloud
Automation
Record-Triggered Flows, Screen Flows`)
  );
  // The default template keeps each category on its own single-column line.
  const modern = resumeJsonToHtml(data, "ats-modern");
  assert.match(modern, /<span class="skill-cat"[^>]*>Salesforce Clouds:<\/span>/);
  assert.match(modern, /data-bs-path="skills\.0\.items"[^>]*>Service Cloud, Sales Cloud/);
  assert.match(modern, /<span class="skill-cat"[^>]*>Automation:<\/span>/);
  // No table markup — Workday and Taleo cannot rebuild table rows.
  assert.doesNotMatch(modern, /<table/);

  // ...and inline templates get the same two labelled lines.
  const inline = resumeJsonToHtml(data, "harvard-rule");
  assert.match(inline, /<span class="skill-cat"[^>]*>Salesforce Clouds:<\/span>/);
  assert.match(inline, /<span class="skill-cat"[^>]*>Automation:<\/span>/);
});

test("preview HTML annotates editable paths and applyPathEdits round-trips", async () => {
  const { applyPathEdits } = await import("../templates/shared.js");
  const { sampleResumeForPerson } = await import("../templates/preview-sample.js");
  const data = sampleResumeForPerson({ name: "D'Mario Lewis" });
  const html = resumeJsonToHtml(data, "ats-modern");
  assert.match(html, /data-bs-path="name"/);
  assert.match(html, /data-bs-path="profile"/);
  assert.match(html, /data-bs-path="experience\.0\.bullets\.0"/);
  assert.match(html, /data-bs-path="skills\.0\.category"/);
  assert.match(html, /data-bs-path="technicalSummary\.0"/);

  const edited = applyPathEdits(data, {
    profile: "Edited professional summary for ATS.",
    "experience.0.bullets.0": "Edited first bullet with Capgemini keywords.",
    "skills.0.items": "Apex, LWC, Capgemini"
  });
  assert.equal(edited.profile, "Edited professional summary for ATS.");
  assert.equal(edited.experience[0].bullets[0], "Edited first bullet with Capgemini keywords.");
  assert.equal(edited.skills[0].items, "Apex, LWC, Capgemini");
  assert.equal(edited.name, data.name);
  assert.equal(edited.experience[0].company, data.experience[0].company);

  const again = resumeJsonToHtml(edited, "ats-modern");
  assert.match(again, /Edited professional summary for ATS\./);
  assert.match(again, /Edited first bullet with Capgemini keywords\./);
});

test("Orange Banner puts company above the title and uses orange section bars", () => {
  const html = resumeJsonToHtml(
    {
      name: "Jordan Taylor",
      headline: "Software Engineer | Enterprise Integration",
      phone: "555-0100",
      email: "jose@example.com",
      linkedin: "https://linkedin.com/in/example",
      location: "Boston, MA",
      profile: "Software specialist with experience designing reliable applications.",
      technicalSummary: ["Builds maintainable services."],
      experience: [
        {
          company: "Example Partners",
          title: "Senior Software Specialist",
          location: "Boston, MA",
          dates: "2021 – Present",
          bullets: ["Designed and delivered applications."]
        }
      ],
      skills: [{ items: "JavaScript, Python, APIs" }],
      education: [
        {
          school: "Example University",
          degree: "Bachelor of Science, Computer Science",
          location: "Boston, MA",
          year: "2014 – 2018",
          details: "Concentration in software engineering and accessible systems."
        }
      ]
    },
    "orange-banner"
  );
  assert.match(html, /class="page-bar"/);
  assert.match(html, /class="bar"><span>Experience<\/span>/);
  assert.match(html, /class="bar"><span>Education<\/span>/);
  assert.match(html, /About me/);
  assert.match(html, /Areas of expertise/);
  assert.match(html, /JavaScript • Python • APIs/);
  assert.match(html, /P:<\/span>/);
  assert.match(html, /LI:<\/span>/);
  assert.match(html, /Example Partners/);
  assert.match(html, /Senior Software Specialist/);
  assert.match(html, /Concentration in software engineering/);
  const companyAt = html.indexOf("Example Partners");
  const titleAt = html.indexOf("Senior Software Specialist");
  assert.ok(companyAt > -1 && titleAt > companyAt);
});
