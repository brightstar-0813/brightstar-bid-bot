import { plainTextToResumeData, isStyledExportResume } from "../resume-text.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Full Michael paste lives inline — shortened only for maintainability in smoke; key patterns covered.
const sample = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "_michael-fixture.txt"), "utf8");

const data = plainTextToResumeData(sample);
const errors = [];

if (!isStyledExportResume(data)) errors.push("not styled-exportable");
if (!/michael/i.test(data.name || "")) errors.push(`bad name: ${data.name}`);

const cats = (data.skills || []).map((s) => s.category);
if (cats.length < 10) errors.push(`too few skill rows: ${cats.length}`);
for (const need of ["Salesforce Clouds", "Salesforce AI", "Enterprise Systems"]) {
  if (!cats.includes(need)) errors.push(`missing skill category: ${need}`);
}

const jobs = data.experience || [];
if (jobs.length < 4) errors.push(`too few jobs: ${jobs.length}`);

function assertJob(companyRe, checks) {
  const job = jobs.find((j) => companyRe.test(j.company || ""));
  if (!job) {
    errors.push(`missing job: ${companyRe}`);
    return;
  }
  for (const [field, re, label] of checks) {
    if (!re.test(job[field] || "")) errors.push(`${label || companyRe} bad ${field}: ${job[field]}`);
  }
  const blob = (job.bullets || []).join("\n");
  if (/\bInc\.?\b/.test(blob) && /(Intrado|Smart Park|Clibase)/i.test(blob)) {
    errors.push(`${companyRe} company names leaked into bullets`);
  }
  if ((job.bullets || []).some((b) => /^(Dec|Jun|Sep) 20/i.test(b))) {
    errors.push(`${companyRe} dates leaked into bullets`);
  }
}

const expectedBullets = {
  intrado: 16,
  smart: 16,
  clibase: 11,
  appit: 7
};

assertJob(/intrado/i, [
  ["title", /senior salesforce application systems analyst/i, "Intrado"],
  ["dates", /2024/i, "Intrado"],
  ["location", /longmont|colorado/i, "Intrado"],
  ["project", /enterprise customer/i, "Intrado"]
]);
assertJob(/smart park/i, [
  ["title", /salesforce developer \/ crm systems engineer/i, "Smart Park"],
  ["dates", /2021.*2024/i, "Smart Park"],
  ["project", /reservation/i, "Smart Park"]
]);
assertJob(/clibase/i, [
  ["title", /salesforce developer \/ crm platform developer/i, "Clibase"],
  ["location", /imus|cavite|philippines/i, "Clibase"]
]);
assertJob(/^app it$/i, [
  ["title", /junior salesforce developer/i, "App It"],
  ["dates", /2016.*2018/i, "App It"],
  ["location", /hong kong/i, "App It"]
]);

const intrado = jobs.find((j) => /intrado/i.test(j.company || ""));
const smart = jobs.find((j) => /smart park/i.test(j.company || ""));
const clibase = jobs.find((j) => /clibase/i.test(j.company || ""));
const appit = jobs.find((j) => /^app it$/i.test(j.company || ""));

if ((intrado?.bullets || []).length !== expectedBullets.intrado) {
  errors.push(`Intrado bullet count: ${(intrado?.bullets || []).length} != ${expectedBullets.intrado}`);
}
if ((smart?.bullets || []).length !== expectedBullets.smart) {
  errors.push(`Smart Park bullet count: ${(smart?.bullets || []).length} != ${expectedBullets.smart}`);
}
if ((clibase?.bullets || []).length !== expectedBullets.clibase) {
  errors.push(`Clibase bullet count: ${(clibase?.bullets || []).length} != ${expectedBullets.clibase}`);
}
if ((appit?.bullets || []).length !== expectedBullets.appit) {
  errors.push(`App It bullet count: ${(appit?.bullets || []).length} != ${expectedBullets.appit}`);
}

const totalBullets = jobs.reduce((n, j) => n + (j.bullets || []).length, 0);
if (totalBullets !== 50) errors.push(`total bullets ${totalBullets} != 50`);

const edu = (data.education || [])[0];
if (!edu) errors.push("missing education");
else {
  if (!/hong kong/i.test(edu.school || "")) errors.push(`edu school: ${edu.school}`);
  if (!/bachelor|computer science/i.test(edu.degree || "")) errors.push(`edu degree: ${edu.degree}`);
  if (!/honou?rs/i.test(edu.details || "")) errors.push(`edu details: ${edu.details}`);
}

console.log(
  JSON.stringify(
    {
      ok: errors.length === 0,
      errors,
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
