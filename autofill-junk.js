/**
 * Heuristics for rejecting polluted Q&A bank entries and learn-mode captures.
 */

const JUNK_ANSWER_RE =
  /format paragraph|heading dropdown|we want to hear from you|choose file|drag and drop|drop your resume|upload file|upload your resume|autofill from resume|parsing your resume|select type or paste your resume|remove file|bold|italic|underline|bullet list|numbered list|align left|align center|align right|insert link|insert image|undo|redo|strikethrough|subscript|superscript|clear formatting|paragraph style|font size|font family/i;

const JUNK_QUESTION_RE =
  /^(first name|last name|legal first name|legal last name|email|e mail|phone|mobile phone|name)\*?$/i;

const JUNK_QUESTION_CONTAINS_RE =
  /upload your resume|autofill from resume|drop your resume|choose file|drag and drop|upload file|select type or paste your resume|add resume|paste your resume here|format paragraph|heading dropdown|find any email|paste any linkedin profile url|embed content from social networks|parsing your resume|autofill completed|remove file|resume here to autofill/i;

/** Meta / analytics / fingerprint param names that leak into field inventories. */
const TRACKING_NOISE_LABEL_RE =
  /^(id|ev|dl|rl|if|ts|iw|sw|sh|ec|fbp|ler|cdl|aems|uid|uuid|sid|cid|gid|pid|tid|rid)$/i;

const TRACKING_NOISE_CONTAINS_RE =
  /\b(udff|audff|ncudff|cudff|buttonfeatures|formfeatures|pagefeatures|buttontext|pixel|fbclid|gclid|fbp|fbc)\b/i;

const YES_NO_QUESTION_RE =
  /\b(yes or no|yes\/no|do you|are you|have you|will you|can you|did you|is this|agree|consent|authorized|eligible|willing)\b/i;

const PHONE_ANSWER_RE = /^[\d\s().+-]{7,20}$/;

/** Identity / PII / secrets — never store in the exportable Q&A bank. */
const SENSITIVE_PROFILE_QUESTION_RE =
  /\b(password|otp|captcha|ssn|social security|credit card|card number|cvv|routing|account number|search|first name|last name|full name|middle name|legal name|email|e-mail|phone|mobile|telephone|address|street|city|state|province|zip|postal|country|linkedin|github|portfolio|website|date of birth|dob|birthday|salary|compensation|desired pay|expected pay|disability|veteran|military|\brace\b|ethnic|gender|\bsex\b|hispanic|latino|felony|conviction|criminal)\b/i;

/** Strip char counters / required markers that ATS UIs glue onto labels. */
export function cleanAutofillLabelText(text) {
  return String(text || "")
    .replace(/\b\d+\s*\/\s*\d{2,5}\b/g, " ")
    .replace(/\bcharacters?\s*(remaining|left)?\b/gi, " ")
    .replace(/^\s*[\u2022*·•]+\s*/, "")
    .replace(/\s*\*\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Radio/checkbox option chrome mistaken for the question. */
export function isBareChoiceOptionLabel(label) {
  return /^(yes|no|y|n|true|false|agree|disagree|i agree|i do not agree)$/i.test(
    cleanAutofillLabelText(label)
  );
}

/** Tracking / pixel / fingerprint field names (not real application questions). */
export function isTrackingNoiseLabel(label) {
  const raw = cleanAutofillLabelText(label);
  if (!raw) return true;
  if (TRACKING_NOISE_LABEL_RE.test(raw)) return true;
  if (TRACKING_NOISE_CONTAINS_RE.test(raw)) return true;
  if (/^cd\s+\w+/i.test(raw) && raw.length < 48) return true;
  // Cryptic short tokens like "ev", "dl", "audff zp"
  if (/^[a-z]{1,5}(\s+[a-z]{1,4}){0,2}$/i.test(raw) && !/[?]/.test(raw) && raw.length <= 12) {
    if (!/^(dob|ssn|url|zip|city|name|email|phone|race|sex)$/i.test(raw)) return true;
  }
  return false;
}

/** @param {string} label */
export function isSensitiveProfileQuestion(label) {
  return SENSITIVE_PROFILE_QUESTION_RE.test(String(label || "").trim());
}

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
  const raw = cleanAutofillLabelText(label);
  if (!raw || raw.length < 3) return true;
  if (isBareChoiceOptionLabel(raw)) return true;
  if (isTrackingNoiseLabel(raw)) return true;
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
