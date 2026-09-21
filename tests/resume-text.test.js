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
