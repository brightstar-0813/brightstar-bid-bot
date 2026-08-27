/**
 * Heuristics for rejecting polluted Q&A bank entries and learn-mode captures.
 */

const JUNK_ANSWER_RE =
  /format paragraph|heading dropdown|we want to hear from you|choose file|drag and drop|drop your resume|upload file|upload your resume|autofill from resume|parsing your resume|select type or paste your resume|remove file|bold|italic|underline|bullet list|numbered list|align left|align center|align right|insert link|insert image|undo|redo|strikethrough|subscript|superscript|clear formatting|paragraph style|font size|font family/i;

const JUNK_QUESTION_RE =
  /^(first name|last name|legal first name|legal last name|email|e mail|phone|mobile phone|name)\*?$/i;

const JUNK_QUESTION_CONTAINS_RE =
  /upload your resume|autofill from resume|drop your resume|choose file|drag and drop|upload file|select type or paste your resume|add resume|paste your resume here|format paragraph|heading dropdown|find any email|paste any linkedin profile url|embed content from social networks|parsing your resume|autofill completed|remove file|resume here to autofill/i;

const YES_NO_QUESTION_RE =
  /\b(yes or no|yes\/no|do you|are you|have you|will you|can you|did you|is this|agree|consent|authorized|eligible|willing)\b/i;

const PHONE_ANSWER_RE = /^[\d\s().+-]{7,20}$/;

/** @param {string} text */
export function isJunkAutofillAnswer(text, { questionLabel = "" } = {}) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (JUNK_ANSWER_RE.test(t)) return true;
  const q = String(questionLabel || "").trim();
  if (q && YES_NO_QUESTION_RE.test(q) && t.length > 500) return true;
  if (q && !/\b(phone|mobile|cell|telephone|contact number)\b/i.test(q) && PHONE_ANSWER_RE.test(t)) {
    return true;
  }
  return false;
}

/** @param {string} label */
export function isJunkQuestionLabel(label) {
  const raw = String(label || "").trim();
  if (!raw || raw.length < 3) return true;
  const compact = raw.replace(/\s+/g, " ");
  if (JUNK_QUESTION_RE.test(compact)) return true;
  if (JUNK_QUESTION_CONTAINS_RE.test(compact)) return true;
  if (compact.length > 280 && /upload|resume|autofill|parsing|drop your/i.test(compact)) return true;
  return false;
}

/** @param {object} record */
export function isJunkQaRecord(record) {
  if (!record) return true;
  return (
    isJunkQuestionLabel(record.question) ||
    isJunkAutofillAnswer(record.answer, { questionLabel: record.question })
  );
}

/** @param {string} answer */
export function normalizeChoiceAnswerValue(answer) {
  const t = String(answer || "").trim().toLowerCase();
  if (!t) return "";
  if (["y", "yes", "true", "1", "agree", "i agree", "accepted", "accept"].includes(t)) return "Yes";
  if (["n", "no", "false", "0", "decline", "disagree", "i do not agree"].includes(t)) return "No";
  return String(answer || "").trim();
}
