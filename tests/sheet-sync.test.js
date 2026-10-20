import test from "node:test";
import assert from "node:assert/strict";
import {
  SHEET_SYNC_MISSING_FOLDER,
  csvRowFromListedFolder,
  formatSheetSyncStatus,
  matchFolderForJob,
  reconcileQueueJobWithSheet,
  reconcileQueueWithSheetRows,
  sheetStatusLooksApplied,
  sheetStatusLooksInactive,
  sheetStatusLooksReady
} from "../sheet-sync.js";
import { csvRowFromFolderName } from "../job-folder.js";

const builtinLink = "https://builtin.com/job/salesforce-technical-lead/11462197";
const job = {
  csvRow: 19,
  title: "Salesforce Technical Lead",
  company: "American Society for the Prevention of Cruelty to Animals",
  jdLink: builtinLink,
  status: "pending",
  applied: false
};
const readyRow = {
  jobNo: "19",
  title: job.title,
  company: job.company,
  link: builtinLink,
  status: "Ready",
  bidMode: "Auto bid"
};
const folder = {
  csvRow: 19,
  jobDir: "Lewis-SF/19_10-6_American Society for the Prevention of Cruelty to Animals-Salesforce Technical Lead",
  hasResume: true,
  hasCover: true,
  resumeName: "Lewis_Resume.pdf",
  coverName: "Lewis_Cover Letter.pdf"
};

test("sheet status helpers", () => {
  assert.equal(sheetStatusLooksReady("Ready"), true);
  assert.equal(sheetStatusLooksApplied("Applied 10/6/2026 2:06 AM"), true);
  assert.equal(sheetStatusLooksInactive("inactive job"), true);
  assert.equal(sheetStatusLooksApplied("Ready"), false);
});

test("csvRowFromFolderName reads 19_10-6_ prefixes", () => {
  assert.equal(
    csvRowFromFolderName("Lewis-SF/19_10-6_American Society-Salesforce Technical Lead"),
    19
  );
  assert.equal(csvRowFromListedFolder({ jobDir: folder.jobDir, csvRow: null }), 19);
});

test("Ready plus resume folder becomes done and applyable", () => {
  const result = reconcileQueueJobWithSheet(job, readyRow, folder);
  assert.equal(result.kind, "ready");
  assert.equal(result.patch.status, "done");
  assert.equal(result.patch.applied, false);
  assert.equal(result.patch.hasFiles, true);
  assert.equal(result.patch.jobDir, folder.jobDir);
  assert.equal(result.patch.error, "");
});

test("Ready without a folder keeps Apply off and is not a sheet-duplicate skip", () => {
  const skipped = {
    ...job,
    status: "skipped",
    error: "Duplicate — same job link already in Google Sheet (or earlier in this CSV)"
  };
  const result = reconcileQueueJobWithSheet(skipped, readyRow, null);
  assert.equal(result.kind, "missing");
  assert.equal(result.patch.status, "skipped");
  assert.equal(result.patch.error, SHEET_SYNC_MISSING_FOLDER);
  assert.equal(result.patch.companySheetSkipLocked, false);
});

test("Applied on the sheet marks the queue row done and applied", () => {
  const result = reconcileQueueJobWithSheet(job, { ...readyRow, status: "Applied 10/5/2026 4:27 PM" }, folder);
  assert.equal(result.kind, "applied");
  assert.equal(result.patch.status, "done");
  assert.equal(result.patch.applied, true);
});

test("inactive job on the sheet stays unapplyable", () => {
  const result = reconcileQueueJobWithSheet(job, { ...readyRow, status: "inactive job" }, null);
  assert.equal(result.kind, "inactive");
  assert.equal(result.patch.inactive, true);
  assert.equal(result.patch.applied, false);
});

test("local Applied wins over a Ready sheet cell", () => {
  const result = reconcileQueueJobWithSheet({ ...job, applied: true, status: "done" }, readyRow, folder);
  assert.equal(result.kind, "applied");
  assert.equal(result.patch.applied, true);
});

test("running rows and jobs missing from the sheet are left alone", () => {
  assert.equal(reconcileQueueJobWithSheet({ ...job, status: "running" }, readyRow, folder).kind, "unchanged");
  assert.equal(reconcileQueueJobWithSheet(job, null, folder).kind, "unchanged");
});

test("matchFolderForJob uses the row-date folder name", () => {
  const hit = matchFolderForJob(job, [folder]);
  assert.equal(hit.jobDir, folder.jobDir);
});

test("reconcileQueueWithSheetRows counts only the queue and patches allUsJobs", () => {
  const pending = { ...job, status: "pending" };
  const extra = {
    csvRow: 22,
    title: "Principal Software Development Engineer",
    company: "Lumen Technologies",
    jdLink: "https://himalayas.app/companies/lumen-technologies/jobs/prm",
    status: "pending"
  };
  const { queue, allUsJobs, counts } = reconcileQueueWithSheetRows({
    queue: [pending],
    allUsJobs: [pending, extra],
    sheetRows: [readyRow],
    folders: [folder]
  });
  assert.equal(queue[0].status, "done");
  assert.equal(allUsJobs[0].status, "done");
  assert.equal(allUsJobs[1].status, "pending");
  assert.equal(counts.ready, 1);
  assert.equal(counts.applied, 0);
  assert.equal(counts.missing, 0);
});

test("formatSheetSyncStatus mentions native host when it is off", () => {
  const msg = formatSheetSyncStatus({
    sheetName: "Lewis-SF",
    counts: { ready: 12, applied: 40, inactive: 3, missing: 2 },
    nativeHost: false
  });
  assert.match(msg, /^Synced Lewis-SF: 12 ready to apply, 40 applied, 3 inactive, 2 missing folders\./);
  assert.match(msg, /Native host is off/);
});
