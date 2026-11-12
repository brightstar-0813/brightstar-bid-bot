import test from "node:test";
import assert from "node:assert/strict";
import { extractSpreadsheetGid, extractSpreadsheetId } from "../sheets.js";
import { captureRowToJob, captureRowsToJobs } from "../sheet-jobs.js";

test("extractSpreadsheetGid reads ?gid= and #gid=", () => {
  assert.equal(
    extractSpreadsheetGid(
      "https://docs.google.com/spreadsheets/d/1UCHuLKjnEDvH-Q8NYBvspmyts0evq2lfT5ZQF_djmcE/edit?gid=1039755249#gid=1039755249"
    ),
    "1039755249"
  );
  assert.equal(
    extractSpreadsheetGid(
      "https://docs.google.com/spreadsheets/d/abc123/edit#gid=42"
    ),
    "42"
  );
  assert.equal(extractSpreadsheetGid("https://docs.google.com/spreadsheets/d/abc123/edit"), "");
  assert.equal(extractSpreadsheetGid(""), "");
});

test("extractSpreadsheetId still works on capture URLs with gid", () => {
  assert.equal(
    extractSpreadsheetId(
      "https://docs.google.com/spreadsheets/d/1UCHuLKjnEDvH-Q8NYBvspmyts0evq2lfT5ZQF_djmcE/edit?gid=1039755249#gid=1039755249"
    ),
    "1UCHuLKjnEDvH-Q8NYBvspmyts0evq2lfT5ZQF_djmcE"
  );
});

test("captureRowToJob maps Role/Link/JD and Jobgether board flags", () => {
  const job = captureRowToJob(
    {
      row: 4,
      title: "Senior Salesforce Developer",
      company: "",
      link: "https://jobgether.com/jobs/abc",
      jdText: "Need Apex and LWC. Salary $160k - $180k per year.",
      salary: ""
    },
    0
  );
  assert.equal(job.title, "Senior Salesforce Developer");
  assert.equal(job.company, "Company");
  assert.equal(job.jdLink, "https://jobgether.com/jobs/abc");
  assert.match(job.jdText, /Apex and LWC/);
  assert.equal(job.csvRow, 4);
  assert.equal(job.sheetRow, 4);
  assert.equal(job.isJobgether, true);
  assert.equal(job.isDice, false);
  assert.equal(job.source, "jobgether");
  assert.equal(job.status, "pending");
  assert.match(job.salary, /160/);
});

test("captureRowsToJobs drops empty rows and labels the sheet", () => {
  const result = captureRowsToJobs(
    [
      { row: 2, title: "A", company: "Acme", link: "https://dice.com/job/1", jdText: "JD", salary: "" },
      { row: 3, title: "", company: "", link: "", jdText: "" },
      {
        row: 5,
        title: "B",
        company: "Beta",
        link: "https://www.dice.com/job-detail/xyz",
        jdText: "More",
        salary: "120k"
      }
    ],
    { sheetName: "US-SF-Jobs" }
  );
  assert.equal(result.totalRows, 3);
  assert.equal(result.droppedEmpty, 1);
  assert.equal(result.usJobs.length, 2);
  assert.equal(result.sheetLabel, "Sheet: US-SF-Jobs");
  assert.equal(result.usJobs[0].isDice, true);
  assert.equal(result.usJobs[1].salary, "120k");
});
