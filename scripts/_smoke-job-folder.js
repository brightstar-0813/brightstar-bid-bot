import {
  buildJobFolderName,
  csvRowFromFolderName,
  formatJobFolderDate,
  folderFitsJob,
  isDatePrefixedFolder,
  isLegacyRowPrefixedFolder,
  isRowDatePrefixedFolder,
  jobDirMatchesCsvRow
} from "../job-folder.js";

const errors = [];

const job = {
  companyName: "Socium",
  jobTitle: "Senior Salesforce Developer",
  savedAt: new Date(2026, 8, 21)
};

const name = buildJobFolderName({ ...job, csvRow: 16 });
if (name !== "16_9-21_Socium-Senior Salesforce Developer") {
  errors.push(`unexpected folder name: ${name}`);
}

const noRow = buildJobFolderName(job);
if (noRow !== "9-21_Socium-Senior Salesforce Developer") {
  errors.push(`unexpected row-less folder name: ${noRow}`);
}

if (isLegacyRowPrefixedFolder("13 - Socium - Senior Salesforce Developer")) {
  // legacy ok
} else {
  errors.push("legacy detect failed");
}
if (!isRowDatePrefixedFolder(name)) errors.push("row+date prefix detect failed");
if (isRowDatePrefixedFolder(noRow)) errors.push("row-less folder should not read as row-prefixed");
if (!isDatePrefixedFolder(noRow)) errors.push("date prefix detect failed");
if (csvRowFromFolderName(`Applications/${name}`) !== 16) errors.push("csvRow parse failed");
if (csvRowFromFolderName(`Applications/${noRow}`) !== "") errors.push("row-less csvRow parse failed");
if (!folderFitsJob(`Applications/${name}`, { companyName: "Socium", jobTitle: "Senior Salesforce Developer" })) {
  errors.push("folderFitsJob failed");
}
if (!jobDirMatchesCsvRow(`Applications/${name}`, 16)) errors.push("row folder csvRow match failed");
if (jobDirMatchesCsvRow(`Applications/${name}`, 17)) errors.push("row folder csvRow should reject");
if (!jobDirMatchesCsvRow(`Applications/${noRow}`, 16)) errors.push("legacy date folder should still match");
if (!jobDirMatchesCsvRow("Applications/13 - Socium - Title", 13)) errors.push("legacy csvRow match failed");
if (jobDirMatchesCsvRow("Applications/14 - Other - Title", 13)) errors.push("legacy csvRow should reject");

console.log(JSON.stringify({ ok: errors.length === 0, errors, name, today: formatJobFolderDate() }, null, 2));
if (errors.length) process.exitCode = 1;
