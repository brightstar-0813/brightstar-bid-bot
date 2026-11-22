/**
 * Standalone styled-resume export: resume text/JSON + template → PDF and/or DOCX.
 *
 * Deliberately has no job context (title / company / JD), no person profile, no queue row,
 * and no Google Sheet write. The job-bound Export PDF path (`exportStyledResumePdf`) is separate.
 * Pure helpers only — no chrome.* — so they run under `node --test`.
 */
import { personOutputNameToken } from "./resume-profile.js";

/** Folder under Downloads. Flat on purpose; Chrome uniquifies repeat names. */
export const STANDALONE_EXPORT_DIR = "StyledResumes";

export const STANDALONE_FORMAT = Object.freeze({
  PDF: "pdf",
  DOCX: "docx",
  BOTH: "both"
});

const FILE_SPECS = Object.freeze({
  pdf: { ext: "pdf", mimeType: "application/pdf" },
  docx: {
    ext: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
});

/** Unknown / missing values fall back to PDF (the common case). */
export function normalizeStandaloneFormat(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === STANDALONE_FORMAT.DOCX) return STANDALONE_FORMAT.DOCX;
  if (v === STANDALONE_FORMAT.BOTH) return STANDALONE_FORMAT.BOTH;
  return STANDALONE_FORMAT.PDF;
}

/** @returns {Array<"pdf"|"docx">} */
export function standaloneFormats(format) {
  const f = normalizeStandaloneFormat(format);
  if (f === STANDALONE_FORMAT.BOTH) return ["pdf", "docx"];
  return [f];
}

/** Safe file token from the resume's own name (never a profile / job). */
export function standaloneNameToken(resumeData) {
  return personOutputNameToken({ name: String(resumeData?.name || "").trim() });
}

/**
 * Where each file goes, relative to Downloads.
 * @param {object} resumeData
 * @param {{ format?: string }} [opts]
 * @returns {{ dir: string, nameToken: string, files: Array<{ format: string, fileName: string, path: string, mimeType: string }> }}
 */
export function buildStandaloneExportPlan(resumeData, { format } = {}) {
  const nameToken = standaloneNameToken(resumeData);
  const files = standaloneFormats(format).map((fmt) => {
    const spec = FILE_SPECS[fmt];
    const fileName = `${nameToken}_Resume.${spec.ext}`;
    return {
      format: fmt,
      fileName,
      path: `${STANDALONE_EXPORT_DIR}/${fileName}`,
      mimeType: spec.mimeType
    };
  });
  return { dir: STANDALONE_EXPORT_DIR, nameToken, files };
}

/** Chunked so large DOCX/PDF byte arrays never blow the argument limit of String.fromCharCode. */
export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Human status line for a finished export. */
export function standaloneStatusLine(plan) {
  const names = (plan?.files || []).map((f) => f.fileName).join(" + ");
  return `Saved ${names} → Downloads / ${plan?.dir || STANDALONE_EXPORT_DIR}`;
}
