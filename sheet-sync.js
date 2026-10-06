import { csvRowFromFolderName, folderFitsJob } from "./job-folder.js";
import { normalizeJobLink } from "./sheets.js";

export const SHEET_SYNC_MISSING_FOLDER =
  "Resume folder not found under the output folder. Copy the job folder into Downloads, then Sync with sheet again.";

export function sheetStatusLooksApplied(status) {
  return /^\s*applied\b/i.test(String(status || "").trim());
}

export function sheetStatusLooksInactive(status) {
  return /^\s*inactive\b/i.test(String(status || "").trim());
}

export function sheetStatusLooksReady(status) {
  return /^\s*ready\b/i.test(String(status || "").trim());
}

export function isDuplicateSkipError(error) {
  return /duplicate|already on google sheet|already earlier in this csv/i.test(
    String(error || "")
  );
}

function jobLinkKey(job) {
  return normalizeJobLink(job?.jdLink || job?.url || job?.link || "");
}

/**
 * Pick the Downloads folder for a queue job from native-host / Chrome download scan results.
 */
export function matchFolderForJob(job, folders = []) {
  const list = Array.isArray(folders) ? folders : [];
  const n = Number(job?.csvRow);
  const hasRow = Number.isFinite(n) && n > 0;
  const existing = String(job?.jobDir || "").trim();
  if (existing) {
    const byDir = list.find((f) => String(f?.jobDir || "") === existing);
    if (byDir) return byDir;
  }
  const byRowAndFit = hasRow
    ? list.find((f) => Number(f.csvRow) === n && folderFitsJob(f.jobDir, job))
    : null;
  if (byRowAndFit) return byRowAndFit;
  const byRow = hasRow ? list.find((f) => Number(f.csvRow) === n) : null;
  if (byRow) return byRow;
  return list.find((f) => folderFitsJob(f.jobDir || "", job)) || null;
}

function folderHasResume(folder) {
  if (!folder) return false;
  if (folder.hasResume === true) return true;
  const name = String(folder.resumeName || "").trim();
  if (name && /resume/i.test(name) && !/cover/i.test(name)) return true;
  return false;
}

function indexSheetRowsByLink(sheetRows = []) {
  const map = new Map();
  for (const row of sheetRows || []) {
    const key = normalizeJobLink(row?.link || row?.jdLink || "");
    if (!key) continue;
    map.set(key, row);
  }
  return map;
}

/**
 * Map one queue job + matching sheet row + optional local folder into a queue patch.
 * Returns null when the row should stay unchanged (no sheet match, or running).
 *
 * @returns {{ patch: object, kind: "applied"|"ready"|"missing"|"inactive"|"unchanged" } | null}
 */
export function reconcileQueueJobWithSheet(job, sheetRow, folder = null) {
  if (!job) return null;
  if (String(job.status || "") === "running") {
    return { patch: null, kind: "unchanged" };
  }
  if (!sheetRow) return { patch: null, kind: "unchanged" };

  const sheetStatus = String(sheetRow.status || "").trim();
  const alreadyApplied = Boolean(job.applied);

  if (sheetStatusLooksInactive(sheetStatus)) {
    return {
      kind: "inactive",
      patch: {
        status: "skipped",
        applied: false,
        inactive: true,
        hasFiles: Boolean(job.hasFiles || job.jobDir || folder?.jobDir),
        jobDir: job.jobDir || folder?.jobDir || "",
        error: sheetStatus || "inactive job"
      }
    };
  }

  if (sheetStatusLooksApplied(sheetStatus) || alreadyApplied) {
    const folderDir = folder?.jobDir || job.jobDir || "";
    return {
      kind: "applied",
      patch: {
        status: "done",
        applied: true,
        inactive: false,
        hasFiles: Boolean(job.hasFiles || folderDir || folderHasResume(folder)),
        jobDir: folderDir,
        resumeName: job.resumeName || folder?.resumeName || "",
        coverName: job.coverName || folder?.coverName || "",
        error: isDuplicateSkipError(job.error) ? "" : job.error || "",
        companySheetSkipLocked: true
      }
    };
  }

  if (sheetStatusLooksReady(sheetStatus)) {
    if (alreadyApplied) {
      return {
        kind: "applied",
        patch: {
          status: "done",
          applied: true,
          inactive: false,
          hasFiles: Boolean(job.hasFiles || job.jobDir || folder?.jobDir),
          jobDir: job.jobDir || folder?.jobDir || "",
          error: isDuplicateSkipError(job.error) ? "" : job.error || ""
        }
      };
    }
    const hasResume = folderHasResume(folder) || Boolean(job.hasFiles && job.jobDir);
    const jobDir = folder?.jobDir || job.jobDir || "";
    if (hasResume && jobDir) {
      return {
        kind: "ready",
        patch: {
          status: "done",
          applied: false,
          inactive: false,
          hasFiles: true,
          jobDir,
          resumeName: job.resumeName || folder?.resumeName || "",
          coverName: job.coverName || folder?.coverName || "",
          error: "",
          companySheetSkipLocked: false
        }
      };
    }
    return {
      kind: "missing",
      patch: {
        status: "skipped",
        applied: false,
        inactive: false,
        hasFiles: Boolean(job.hasFiles),
        jobDir: job.jobDir || "",
        error: SHEET_SYNC_MISSING_FOLDER,
        companySheetSkipLocked: false
      }
    };
  }

  return { patch: null, kind: "unchanged" };
}

/**
 * Apply sheet statuses onto local queue rows (active person only).
 * Jobs not on the sheet are left as-is. Running rows are skipped.
 */
export function reconcileQueueWithSheetRows({
  queue = [],
  allUsJobs = [],
  sheetRows = [],
  folders = [],
  person = null,
  belongsToPerson = null
} = {}) {
  const byLink = indexSheetRowsByLink(sheetRows);
  const counts = {
    ready: 0,
    applied: 0,
    inactive: 0,
    missing: 0,
    unchanged: 0,
    matched: 0
  };

  const owns = (job) => {
    if (typeof belongsToPerson === "function") return belongsToPerson(job, person);
    return true;
  };

  function patched(job, { count }) {
    if (!owns(job)) {
      if (count) counts.unchanged += 1;
      return job;
    }
    const key = jobLinkKey(job);
    const sheetRow = key ? byLink.get(key) : null;
    const folder = matchFolderForJob(job, folders);
    const result = reconcileQueueJobWithSheet(job, sheetRow, folder);
    if (!result || result.kind === "unchanged" || !result.patch) {
      if (count) counts.unchanged += 1;
      return job;
    }
    if (count) {
      counts.matched += 1;
      if (result.kind === "ready") counts.ready += 1;
      else if (result.kind === "applied") counts.applied += 1;
      else if (result.kind === "inactive") counts.inactive += 1;
      else if (result.kind === "missing") counts.missing += 1;
    }
    return { ...job, ...result.patch };
  }

  return {
    queue: (Array.isArray(queue) ? queue : []).map((job) => patched(job, { count: true })),
    allUsJobs: (Array.isArray(allUsJobs) ? allUsJobs : []).map((job) =>
      patched(job, { count: false })
    ),
    counts
  };
}

export function formatSheetSyncStatus({ sheetName = "", counts = {}, nativeHost = true } = {}) {
  const tab = String(sheetName || "").trim() || "sheet";
  const ready = Number(counts.ready || 0);
  const applied = Number(counts.applied || 0);
  const inactive = Number(counts.inactive || 0);
  const missing = Number(counts.missing || 0);
  let msg = `Synced ${tab}: ${ready} ready to apply, ${applied} applied, ${inactive} inactive, ${missing} missing folders.`;
  if (!nativeHost) {
    msg += " Native host is off — copied folders may be invisible until it is connected.";
  }
  return msg;
}

/** csvRow encoded in 19_10-6_Company-Title (also used by native-host listing). */
export function csvRowFromListedFolder(folder) {
  if (folder?.csvRow != null && String(folder.csvRow).trim() !== "") {
    const n = Number(folder.csvRow);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return csvRowFromFolderName(folder?.jobDir || folder?.name || folder?.folder || "") || null;
}
