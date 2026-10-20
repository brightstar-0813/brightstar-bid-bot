import { plainTextToResumeData, isStyledExportResume } from "../resume-text.js";

const sample = `DAVID LEANDRO DE OLIVEIRA
SENIOR SALESFORCE SPECIALIST

Paulista, Pernambuco, Brazil | +55 61 8212 1297 | davidoliveira2308l@gmail.com | www.linkedin.com/in/davidleandro

PROFESSIONAL SUMMARY

Senior Salesforce Specialist with 9 years of experience delivering and supporting enterprise CRM solutions across public safety, financial services, banking, and technology consulting. Hands-on expertise in Sales Cloud, Service Cloud, Salesforce configuration, Apex, Lightning Web Components, Flow, SOQL, enterprise integrations, and production support.

TECHNICAL SKILLS
Category	Technologies / Skills
Salesforce Clouds	Sales Cloud, Service Cloud, Experience Cloud, Data Cloud, Agentforce
Salesforce Configuration	Objects, Fields, Record Types, Page Layouts, Lightning Record Pages
Sales Management	Lead and Opportunity Management, Account Planning, Forecasting
Service Management	Case Management, Service Console, Email-to-Case, Web-to-Case
Salesforce Development	Apex, Triggers, Batch Apex, Queueable Apex, Lightning Web Components
Automation	Record-Triggered Flow, Screen Flow, Scheduled Flow, Subflows
Security and Access	Role Hierarchy, Profiles, Permission Sets, Permission Set Groups
Integrations and APIs	REST APIs, SOAP APIs, Apex Callouts, Named Credentials, OAuth
Data Architecture	Standard and Custom Data Models, External IDs, Matching Rules
DevOps and Releases	Salesforce CLI, Git, GitHub, CI/CD, Change Sets
Testing and Support	Unit Testing, Integration Testing, UAT, Defect Triage
Delivery and Consulting	Requirements Gathering, Process Analysis, Solution Design
Industry Experience	Public Safety, Emergency Technology, Financial Services, Banking
PROFESSIONAL EXPERIENCE
Intrado

Senior Salesforce Engineer
Jun 2024 – Present
Colorado, United States | Remote

Enterprise Public-Safety Customer and Service Operations

Own Salesforce enhancements supporting enterprise account management, sales operations, customer onboarding, and service processes for public-safety and emergency-technology customers.
Collaborate directly with sales, service, operations, product, and integration stakeholders to examine business challenges, gather requirements, define acceptance criteria, and recommend scalable Salesforce solutions.
Configure Sales Cloud processes across Accounts, Contacts, Leads, Opportunities, Products, and related customer records.
S&P Global

Salesforce Developer
Dec 2022 – May 2024
New York, New York, United States | Remote

Enterprise Sales and Client-Service Platform

Delivered Salesforce solutions supporting institutional customer relationships, sales pipelines, account coverage, service requests, and data-driven workflows.
Worked directly with business analysts, sales operations, service teams, and product stakeholders to map current processes.
EDUCATION

Bachelor of Science in Computer Science
Federal University of Pernambuco
Recife, Brazil
Mar 2013 – Aug 2017
`;

const data = plainTextToResumeData(sample);
const errors = [];

if (!isStyledExportResume(data)) errors.push("not styled-exportable");
if (!/david/i.test(data.name || "")) errors.push(`bad name: ${data.name}`);
if (!/salesforce specialist/i.test(data.headline || "")) errors.push(`bad headline: ${data.headline}`);
if (!/9 years/i.test(data.profile || "")) errors.push("profile missing summary");
if (/Category\s+Technologies/i.test((data.skills || []).map((s) => s.items).join(" "))) {
  errors.push("skills still contain header mash");
}

const cats = (data.skills || []).map((s) => s.category);
if (cats.length < 8) errors.push(`too few skill rows: ${cats.length}`);
if (cats.length === 1 && /^Skills$/i.test(cats[0])) errors.push("skills collapsed to one Skills cell");
for (const need of ["Salesforce Clouds", "Automation", "Integrations and APIs"]) {
  if (!cats.includes(need)) errors.push(`missing skill category: ${need}`);
}

const jobs = data.experience || [];
if (jobs.length < 2) errors.push(`too few jobs: ${jobs.length}`);

const intrado = jobs.find((j) => /intrado/i.test(j.company || ""));
if (!intrado) errors.push("missing Intrado company");
else {
  if (!/senior salesforce engineer/i.test(intrado.title || "")) {
    errors.push(`Intrado bad title: ${intrado.title}`);
  }
  if (!/2024/i.test(intrado.dates || "")) errors.push(`Intrado bad dates: ${intrado.dates}`);
  if (!/colorado/i.test(intrado.location || "")) {
    errors.push(`Intrado bad location: ${intrado.location}`);
  }
  if (!/public-safety/i.test(intrado.project || "")) {
    errors.push(`Intrado bad project: ${intrado.project}`);
  }
  const blob = (intrado.bullets || []).join("\n");
  if (/^Intrado$/m.test(blob) || /Senior Salesforce Engineer/i.test(blob) && (intrado.bullets || []).some((b) => /^Senior Salesforce Engineer$/i.test(b))) {
    errors.push("Intrado metadata leaked into bullets");
  }
  if ((intrado.bullets || []).some((b) => /^Jun 2024/i.test(b) || /^Colorado/i.test(b))) {
    errors.push("Intrado date/location leaked into bullets");
  }
  if ((intrado.bullets || []).length < 2) errors.push("Intrado too few duty bullets");
}

const sp = jobs.find((j) => /s&p|s & p/i.test(j.company || ""));
if (!sp) errors.push("missing S&P Global company");
else if (!/salesforce developer/i.test(sp.title || "")) errors.push(`S&P bad title: ${sp.title}`);

const edu = (data.education || [])[0];
if (!edu) errors.push("missing education");
else {
  if (!/pernambuco/i.test(edu.school || "")) errors.push(`edu school: ${edu.school}`);
  if (!/bachelor|computer science/i.test(edu.degree || "")) errors.push(`edu degree: ${edu.degree}`);
  if (!/2013/i.test(edu.year || "")) errors.push(`edu year: ${edu.year}`);
}

console.log(
  JSON.stringify(
    {
      ok: errors.length === 0,
      errors,
      name: data.name,
      headline: data.headline,
      skillCats: cats,
      jobs: jobs.map((j) => ({
        company: j.company,
        title: j.title,
        dates: j.dates,
        location: j.location,
        project: j.project,
        bullets: (j.bullets || []).length
      })),
      edu
    },
    null,
    2
  )
);

if (errors.length) process.exitCode = 1;
