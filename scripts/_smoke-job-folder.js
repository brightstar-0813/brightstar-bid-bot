import {
  buildJobFolderName,
  formatJobFolderDate,
  folderFitsJob,
  isDatePrefixedFolder,
  isLegacyRowPrefixedFolder,
  jobDirMatchesCsvRow
} from "../job-folder.js";

const errors = [];

const name = buildJobFolderName({
  companyName: "Socium",
  jobTitle: "Senior Salesforce Developer",
  savedAt: new Date(2026, 8, 15)
});
if (name !== "9-15_Socium-Senior Salesforce Developer") {
  errors.push(`unexpected folder name: ${name}`);
}
if (isLegacyRowPrefixedFolder("13 - Socium - Senior Salesforce Developer")) {
  // legacy ok
} else {
  errors.push("legacy detect failed");
}
if (!isDatePrefixedFolder(name)) errors.push("date prefix detect failed");
if (!folderFitsJob(`Applications/${name}`, { companyName: "Socium", jobTitle: "Senior Salesforce Developer" })) {
  errors.push("folderFitsJob failed");
}
if (!jobDirMatchesCsvRow(`Applications/${name}`, 13)) errors.push("date folder csvRow match failed");
if (!jobDirMatchesCsvRow("Applications/13 - Socium - Title", 13)) errors.push("legacy csvRow match failed");
if (jobDirMatchesCsvRow("Applications/14 - Other - Title", 13)) errors.push("legacy csvRow should reject");

console.log(JSON.stringify({ ok: errors.length === 0, errors, name, today: formatJobFolderDate() }, null, 2));
if (errors.length) process.exitCode = 1;
