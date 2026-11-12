/**
 * Map capture Google Sheet rows (Role | Company | Link | JD | Salary) into the
 * same job shape as parseJobsCsv, for Jobs queue batch ingest.
 */

import {
  extractSalaryFromText,
  isAshbyJob,
  isBuiltinJob,
  isDiceJob,
  isGreenhouseJob,
  isHimalayasJob,
  isIndeedJob,
  isJobgetherJob,
  isJobrightJob,
  isLeverJob,
  isLinkedInJob,
  isWorkdayJob
} from "./csv.js";

function inferSourceFromFlags(flags) {
  if (flags.linkedIn) return "linkedin";
  if (flags.dice) return "dice";
  if (flags.indeed) return "indeed";
  if (flags.jobright) return "jobright";
  if (flags.workday) return "workday";
  if (flags.builtin) return "builtin";
  if (flags.himalayas) return "himalayas";
  if (flags.greenhouse) return "greenhouse";
  if (flags.ashby) return "ashby";
  if (flags.lever) return "lever";
  if (flags.jobgether) return "jobgether";
  return "sheet";
}

/**
 * @param {{ row?: number, title?: string, company?: string, link?: string, jdText?: string, salary?: string }} row
 * @param {number} indexZeroBased
 */
export function captureRowToJob(row, indexZeroBased = 0) {
  const title = String(row?.title || "").trim();
  const company = String(row?.company || "").trim();
  const jdLink = String(row?.link || "").trim();
  const jdText = String(row?.jdText || "").trim();
  let salary = String(row?.salary || "").trim();
  if (!salary) salary = extractSalaryFromText(jdText);

  const sheetRow = Number(row?.row);
  const csvRow =
    Number.isFinite(sheetRow) && sheetRow > 0 ? sheetRow : Number(indexZeroBased) + 1;

  const linkedIn = isLinkedInJob({ jdLink });
  const dice = isDiceJob({ jdLink });
  const indeed = isIndeedJob({ jdLink });
  const jobright = isJobrightJob({ jdLink });
  const workday = isWorkdayJob({ jdLink });
  const builtin = isBuiltinJob({ jdLink });
  const himalayas = isHimalayasJob({ jdLink });
  const greenhouse = isGreenhouseJob({ jdLink });
  const ashby = isAshbyJob({ jdLink });
  const lever = isLeverJob({ jdLink });
  const jobgether = isJobgetherJob({ jdLink });
  const flags = {
    linkedIn,
    dice,
    indeed,
    jobright,
    workday,
    builtin,
    himalayas,
    greenhouse,
    ashby,
    lever,
    jobgether
  };

  return {
    csvRow,
    sheetRow: Number.isFinite(sheetRow) && sheetRow > 0 ? sheetRow : null,
    title: title || "Untitled",
    company: company || "Company",
    jdLink,
    jdText,
    location: "",
    remoteRestrictedTo: "",
    salary,
    datePosted: "",
    postedAt: null,
    firstSeenAt: null,
    source: inferSourceFromFlags(flags),
    isLinkedIn: linkedIn,
    isDice: dice,
    isIndeed: indeed,
    isJobright: jobright,
    isWorkday: workday,
    isBuiltin: builtin,
    isHimalayas: himalayas,
    isGreenhouse: greenhouse,
    isAshby: ashby,
    isLever: lever,
    isJobgether: jobgether,
    status: "pending"
  };
}

/**
 * @param {Array<{ row?: number, title?: string, company?: string, link?: string, jdText?: string, salary?: string }>} rows
 * @returns {{
 *   totalRows: number,
 *   usJobs: ReturnType<typeof captureRowToJob>[],
 *   droppedEmpty: number,
 *   sheetLabel: string
 * }}
 */
export function captureRowsToJobs(rows = [], { sheetName = "" } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const usJobs = [];
  let droppedEmpty = 0;

  for (let i = 0; i < list.length; i += 1) {
    const row = list[i] || {};
    const title = String(row.title || "").trim();
    const company = String(row.company || "").trim();
    const link = String(row.link || "").trim();
    const jdText = String(row.jdText || "").trim();
    if (!title && !company && !link && !jdText) {
      droppedEmpty += 1;
      continue;
    }
    usJobs.push(captureRowToJob(row, i));
  }

  const tab = String(sheetName || "").trim();
  return {
    totalRows: list.length,
    usJobs,
    droppedEmpty,
    sheetLabel: tab ? `Sheet: ${tab}` : "Sheet: jobs"
  };
}
