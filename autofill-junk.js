/**
 * Heuristics for rejecting polluted Q&A bank entries and learn-mode captures.
 */

const JUNK_ANSWER_RE =
  /format paragraph|heading dropdown|we want to hear from you|choose file|drag and drop|drop your resume|upload file|upload your resume|autofill from resume|parsing your resume|select type or paste your resume|remove file|bold|italic|underline|bullet list|numbered list|align left|align center|align right|insert link|insert image|undo|redo|strikethrough|subscript|superscript|clear formatting|paragraph style|font size|font family/i;

const JUNK_QUESTION_RE =
  /^(first name|last name|legal first name|legal last name|email|e mail|phone|mobile phone|name)\*?$/i;

const JUNK_QUESTION_CONTAINS_RE =
  /upload your resume|autofill from resume|drop your resume|choose file|drag and drop|upload file|select type or paste your resume|add resume|paste your resume here|format paragraph|heading dropdown|find any email|paste any linkedin profile url|embed content from social networks|parsing your resume|autofill completed|remove file|resume here to autofill/i;

/** Section blurbs / EEO disclaimers mistaken for fillable questions. */
const INSTRUCTIONAL_FIELD_LABEL_RE =
  /\b(we invite (you|applicants)|invite applicants to share|demographic background|voluntary (self[- ]?identification|survey)|equal employment opportunity|eeo statement|responses may be used|used to identify areas of improvement|choose not to (self[- ]?)?identify|prefer not to (self[- ]?)?identify|this information will not|will not affect (your|the) (application|candidacy))\b/i;

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

/** Rate / wage wording that SENSITIVE_PROFILE_QUESTION_RE misses (AI invented "$40/hour"). */
const PAY_RATE_QUESTION_RE =
  /\b(wage|wages|(hourly|pay|bill|billing|expected|desired|target|contract|asking)\s+rate|rate\s+(expectation|requirement)s?|per hour)\b/i;

/** @param {string} label */
export function isSensitiveProfileQuestion(label) {
  const l = String(label || "").trim();
  return SENSITIVE_PROFILE_QUESTION_RE.test(l) || PAY_RATE_QUESTION_RE.test(l);
}

/**
 * Identity / contact / profile-mapped questions must use exact applicantInfo only —
 * never Codex, AI tab, OpenAI leftovers, or Q&A-bank fiction.
 * Applies to Dice, Greenhouse, panel, and any future auto-apply board.
 */
export function shouldExcludeFromAiAndBank(label) {
  return isSensitiveProfileQuestion(label);
}

/**
 * Remove ChatGPT "canvas"/document wrappers and chat chrome from an AI answer before it is
 * typed into a form, e.g. `<WritingBlock id="5332" variant="document">Dear …</WritingBlock>`.
 */
export function stripAiMarkup(text) {
  let s = String(text || "");
  s = s.replace(/<\/?\s*(WritingBlock|Document|Canvas|textdoc|artifact)\b[^>]*>/gi, "");
  s = s.replace(/【[^】]*】/g, ""); // citation marks
  s = s.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "");
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---- Q&A bank gate (what may be saved / kept) ------------------------------------------
// Built from real junk found in the banks on 2026-11-15.

/** Empty dropdown / unanswered placeholders. */
const PLACEHOLDER_ANSWER_RE =
  /^(?:-+|—+|-+\s*no answer\s*-+|no answer|not answered|select(?: one| an option| an item| a value)?\.{0,3}|please select\.{0,3}|choose(?: one| an option)?\.{0,3}|none selected|open dropdown.*)$/i;

/** Page buttons / nav text captured as an "answer". */
const UI_TEXT_ANSWER_RE =
  /^(?:save(?: job)?|saved|create (?:job )?alert|apply(?: now)?|easy apply|quick apply|submit|next|back|continue|cancel|close|ok|learn more|view (?:all )?jobs?|share|report|sign in|sign up|log in)$/i;

/** Tracking / meta / script names captured as a "question". */
const NOISE_QUESTION_RE =
  /^(?:expv\d*\s*\d+|pmd\b|og[:\s]|twitter\b|fb[:\s]|meta\b|no section \d+ question \d+)|\b(?:navigator|nodetype|vendor search handler|leave this page|data-[a-z-]+)\b|=>|&&|\|\||function\s*\(/i;

/** Cookie banners, consent, generic widget chrome — never reusable answers. */
const CONSENT_WIDGET_QUESTION_RE =
  /\b(?:cookies?|cookie settings|targeting|strictly necessary|i agree|terms(?: of (?:use|service))?|privacy polic(?:y|ies)|consent to|permission to text)\b|^(?:checkbox label|switch label(?: label)?|toggle|radio|label|field|input|text|textbox)$/i;

/** Job-board "report this job" options (Jobgether) captured as questions. */
const REPORT_JOB_OPTION_RE =
  /\b(?:fake job|offer is expired|is an advertisement|offensive|discriminatory|it is inaccurate|not fully remote|remote location is not correct|don'?t show this again)\b/i;

/** Repeating employment-history fields: the first employer's value is wrong for the next one. */
const HISTORY_SECTION_QUESTION_RE =
  /^(?:company name|employer(?: name)?|position|job title|title|responsibilities|duties|start date|end date|from|to|reason for leaving|currently working here|supervisor|company (?:website|phone(?: number)?))\b/i;

function normForCompare(s) {
  return String(s || "").toLowerCase().replace(/\(required\)|\*/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * May this question/answer pair be stored in (or kept in) the Q&A bank?
 * Central gate used by qa-store saveQa for every source (scraped, user, codex, AI).
 */
export function isBankableQa(question, answer) {
  const q = cleanAutofillLabelText(question);
  const a = String(answer || "").trim();
  if (!q || !a) return false;
  if (isJunkQuestionLabel(q) || isSensitiveProfileQuestion(q) || isTrackingNoiseLabel(q)) return false;
  if (isJunkAutofillAnswer(a, { questionLabel: q })) return false;
  if (NOISE_QUESTION_RE.test(q) || CONSENT_WIDGET_QUESTION_RE.test(q)) return false;
  if (REPORT_JOB_OPTION_RE.test(q) || REPORT_JOB_OPTION_RE.test(a)) return false;
  if (HISTORY_SECTION_QUESTION_RE.test(q)) return false;
  if (PLACEHOLDER_ANSWER_RE.test(a) || UI_TEXT_ANSWER_RE.test(a)) return false;
  if (/<\/?[a-z][^>]*>/i.test(a)) return false; // markup (e.g. <WritingBlock>)
  if (/^[a-z]{1,3}\d$/i.test(a)) return false; // cryptic tokens like "ah0", "bc1"
  if (normForCompare(q) === normForCompare(a)) return false; // option label echoed as answer
  if (EXTRA_NOISE_QUESTION_RE.test(q) || GLUED_SENSITIVE_RE.test(q)) return false;
  if (BROKEN_ANSWER_RE.test(a)) return false;
  if (/^https?:\/\//i.test(a)) return false; // links are profile data or page chrome
  // "Please specify" / "If other, please specify" have no context of their own — never reuse.
  if (/^(?:if (?:other|yes|no)[,.]?\s*)?(?:please )?(?:specify|explain|describe|other)\.?$/i.test(q)) return false;
  // Yes/No answer to an open "which / what / list" question = mis-filled control.
  if (/^(?:yes|no)$/i.test(a) && /^(?:which|what|list|name|describe)\b/i.test(q)) return false;
  // Pure numbers for non-numeric questions = dropdown option ids ("United States → 1").
  if (/^\d+$/.test(a) && !/\b(how many|years?|number|count|gpa|percent|%|rate|age|hours?)\b/i.test(q)) return false;
  // Answer that starts with the question text (label + option list glued together).
  if (normForCompare(a).startsWith(normForCompare(q)) && normForCompare(q).length > 6) return false;
  return true;
}

/** More page chrome / parser garbage / volatile fields seen in the banks. */
const EXTRA_NOISE_QUESTION_RE =
  /\b(?:\d+ results? (?:are|is) available|select (?:resume|file)|upload|link to this job|don['’]?t show this again|section \d+ question \d+|login|username|user name|person ?profile|gdpr|leg\.?\s*interest|consent|acknowledge note|county|date available|available to start|availability date)\b|\bv=[\w-]{8,}|(?:company|school|summary|field of study|degree|title) start date$/i;

/** Sensitive words glued to option text ("GenderDecline to answerFemaleMale"). */
const GLUED_SENSITIVE_RE = /gender|ethnic|veteran|disabilit|hispanic|latin[oa]/i;

/** Broken / empty-looking answers. */
const BROKEN_ANSWER_RE = /^\?|undefined|\bnull\b|^\[object |^NaN$/i;

/** ChatGPT/Codex page source mistaken for an application answer. */
export function isPageScriptAnswer(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/oai-epic-native-launch|sessionStorage\s*\.\s*(get|set)Item|localStorage\s*\.\s*(get|set)Item/i.test(t)) {
    return true;
  }
  if (/^\s*(?:\(\)\s*=>|function\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)/.test(t) && /[{};]/.test(t)) {
    return true;
  }
  return false;
}

/** @param {string} text */
export function isJunkAutofillAnswer(text, { questionLabel = "" } = {}) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (isPageScriptAnswer(t)) return true;
  if (/^continue in this same conversation\b/i.test(t)) return true;
  if (JUNK_ANSWER_RE.test(t)) return true;
  const q = String(questionLabel || "").trim();
  if (q && YES_NO_QUESTION_RE.test(q) && t.length > 500) return true;
  if (q && !/\b(phone|mobile|cell|telephone|contact number)\b/i.test(q) && PHONE_ANSWER_RE.test(t)) {
    return true;
  }
  return false;
}

/** Placeholder / search-chrome mistaken for the real field label. */
export function isPlaceholderFieldLabel(label) {
  const raw = cleanAutofillLabelText(label);
  if (!raw) return true;
  if (/^(search|select\.\.\.?|please select|choose|filter)$/i.test(raw)) return true;
  return /^(type here|type your response|enter text|write here|your answer)\b/i.test(raw);
}

/** Widget ids / CSS tokens scraped as if they were the question. */
export function isDomChromeQuestionLabel(label) {
  const raw = cleanAutofillLabelText(label);
  if (!raw) return true;
  if (isPlaceholderFieldLabel(raw)) return true;
  if (/\bfield\d+\b/i.test(raw) && /[a-f0-9]{8}/i.test(raw)) return true;
  if (/\b[a-f0-9]{8}\s+[a-f0-9]{4}\s+[a-f0-9]{4}\s+[a-f0-9]{4}\s+[a-f0-9]{8,12}\b/i.test(raw)) {
    return true;
  }
  if (
    /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/i.test(raw) &&
    raw.length < 96
  ) {
    return true;
  }
  return false;
}

/** Survey intros and policy blurbs — not answerable fields. */
export function isInstructionalFieldLabel(label) {
  const raw = cleanAutofillLabelText(label);
  if (!raw) return true;
  if (INSTRUCTIONAL_FIELD_LABEL_RE.test(raw)) return true;
  // Long paragraph without a question mark and without a short field-name shape.
  if (raw.length > 140 && !/[?]/.test(raw) && !/^(gender|race|ethnicity|veteran|disability)\b/i.test(raw)) {
    if (/\b(applicant|hiring|survey|demographic|voluntary|opportunity)\b/i.test(raw)) return true;
  }
  return false;
}

/** @param {string} label */
export function isJunkQuestionLabel(label) {
  const raw = cleanAutofillLabelText(label);
  if (!raw || raw.length < 3) return true;
  if (isBareChoiceOptionLabel(raw)) return true;
  if (isTrackingNoiseLabel(raw)) return true;
  if (isPlaceholderFieldLabel(raw) || isDomChromeQuestionLabel(raw)) return true;
  if (isInstructionalFieldLabel(raw)) return true;
  const compact = raw.replace(/\s+/g, " ");
  if (JUNK_QUESTION_RE.test(compact)) return true;
  if (JUNK_QUESTION_CONTAINS_RE.test(compact)) return true;
  if (compact.length > 280 && /upload|resume|autofill|parsing|drop your/i.test(compact)) return true;
  // Script text, inbox chrome, and doubled widget labels are not application questions.
  if (/[{}<>]|https?:|\/mail\/|\.html\b|\.assign\(|function\s*\(/i.test(compact)) return true;
  if (/select a conversation|buy microsoft 365|olkerror/i.test(compact)) return true;
  if (/([A-Za-z]{4,})\1/.test(compact.replace(/\s+/g, ""))) return true;
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
