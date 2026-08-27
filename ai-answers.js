/**
 * Generate application answers with OpenAI (single pass).
 * Callers must try profile + Q&A bank first; this is last resort.
 */

import { chatCompletion, DEFAULT_OPENAI_MODEL } from "./openai.js";

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function parseCertificationList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item == null) return "";
        if (typeof item === "string") return item.trim();
        if (typeof item === "object") {
          return String(item.name || item.title || item.certification || "").trim();
        }
        return String(item).trim();
      })
      .filter(Boolean);
  }
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (raw.length > 400) return certificationsFromText(raw);
  return raw
    .split(/\n|;/)
    .map((row) => row.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter((row) => row.length >= 8);
}

/** Pull credential names out of a master resume or prompt blob. */
export function certificationsFromText(text) {
  const raw = String(text || "");
  if (!raw) return [];
  const jsonBlock = raw.match(/"certifications"\s*:\s*\[([\s\S]*?)\]/);
  if (jsonBlock) {
    const fromJson = [...jsonBlock[1].matchAll(/"([^"]+)"/g)]
      .map((m) => m[1].trim())
      .filter((row) => /\b(certified|architect|administrator|developer|consultant|builder)\b/i.test(row));
    if (fromJson.length) return fromJson;
  }
  const found = [];
  const re =
    /(?:^|\n)\s*[-•*]?\s*((?:Salesforce|AWS|Google|Microsoft)[^\n]{6,140}?(?:Certified|Architect|Administrator|Developer|Consultant|Builder|Designer|Associate|Professional)[^\n]{0,60})/gi;
  let match;
  while ((match = re.exec(raw))) {
    const row = String(match[1] || "")
      .replace(/[",]+$/g, "")
      .trim();
    if (row) found.push(row);
  }
  return found;
}

export function isCertificationQuestion(label) {
  return /\b(certif(?:ied|ication|ications)?|credentials you (currently )?hold)\b/i.test(
    String(label || "")
  );
}

function certListHas(certs, pattern) {
  return (certs || []).some((row) => pattern.test(String(row || "")));
}

/**
 * Factual leftover answers for "which certs do you hold?" prompts.
 * Never invents credentials that are not in the supplied list.
 */
export function answerCertificationQuestion(label, certifications = []) {
  const certs = parseCertificationList(certifications);
  if (!certs.length) return "";
  const q = String(label || "");
  const asksAppArch = /application architect/i.test(q);
  const asksAdmin = /\badministrator\b/i.test(q);
  const hasAppArch = certListHas(certs, /application architect/i);
  const hasAdmin = certListHas(certs, /certified administrator\b|\badministrator\b/i);

  if (asksAppArch && asksAdmin) {
    if (hasAppArch && hasAdmin) {
      return "I currently hold both: Salesforce Certified Application Architect and Salesforce Certified Administrator.";
    }
    if (hasAppArch) return "I currently hold Salesforce Certified Application Architect.";
    if (hasAdmin) return "I currently hold Salesforce Certified Administrator.";
    return "";
  }

  const relevant = /salesforce/i.test(q) ? certs.filter((row) => /salesforce/i.test(row)) : certs;
  const list = (relevant.length ? relevant : certs).slice(0, 12);
  if (!list.length) return "";
  if (list.length === 1) return `I currently hold ${list[0]}.`;
  return `I currently hold: ${list.join("; ")}.`;
}

/** Reject bank/AI leftovers that do not actually answer the prompt (e.g. architecture blurbs on cert questions). */
export function bankAnswerFitsQuestion(questionLabel, answer) {
  const q = String(questionLabel || "");
  const a = String(answer || "").trim();
  if (!a) return false;
  if (!isCertificationQuestion(q)) return true;
  if (!/\b(certif|credential|administrator|architect|platform developer|app builder|consultant)\b/i.test(a)) {
    return false;
  }
  if (/stakeholder|business objectives|adaptable for future/i.test(a) && !/\bcertified\b/i.test(a)) {
    return false;
  }
  if (/application architect/i.test(q) && /\badministrator\b/i.test(q)) {
    const mentionsArch = /application architect/i.test(a);
    const mentionsAdmin = /\badministrator\b/i.test(a);
    const mentionsBoth = /\bboth\b/i.test(a);
    if (!(mentionsBoth || (mentionsArch && mentionsAdmin))) return false;
  }
  return true;
}

export function compactApplicantContext(applicantInfo = {}) {
  const keys = [
    "firstName",
    "lastName",
    "preferredName",
    "email",
    "phone",
    "city",
    "state",
    "country",
    "cityCountryOfResidence",
    "yearsExperience",
    "relevantExperience",
    "englishLevel",
    "highestDegree",
    "schoolName",
    "fieldOfStudy",
    "workAuthorized",
    "needsSponsorship",
    "postEmploymentRestrictions",
    "salaryExpectation",
    "earliestStartDate",
    "whyInterested",
    "linkedinUrl",
    "gender",
    "hispanicLatino",
    "raceEthnicity",
    "veteranStatus",
    "disabilityStatus"
  ];
  const out = {};
  for (const key of keys) {
    const value = applicantInfo[key];
    if (value != null && String(value).trim()) out[key] = String(value).trim();
  }
  const certs = parseCertificationList(applicantInfo.certifications);
  if (certs.length) out.certifications = certs;
  return out;
}

const COMPLEX_RE =
  /\b(tell|describe|explain|share|summarize|walk)\b|\bwhy (are you|do you|this role|this company|this position|this job)\b|\b(most challenging|about yourself|motivation|cover letter|relevant experience)\b/i;

/** JD-specific essays — always AI per job, never stored in the Q&A bank. */
export function isComplexQuestion(q) {
  const label = String(q?.label || "");
  if (q?.multiline && COMPLEX_RE.test(label)) return true;
  if (label.length > 220 && COMPLEX_RE.test(label)) return true;
  if (q?.multiline && label.length > 160) return true;
  return false;
}

/** Store almost everything except long role-specific essays. */
export function shouldBankAnswer(q, answer, fieldType = "") {
  const a = String(answer || "").trim();
  if (!a) return false;
  const type = String(fieldType || q?.fieldType || "text").toLowerCase();
  if (["select", "combobox", "checkbox", "radio", "choice"].includes(type)) return true;
  if (a.length > 400) return false;
  if (isComplexQuestion(q) && a.length > 160) return false;
  return true;
}

function buildAutofillContext({
  jobMeta = {},
  resumeText = "",
  applicationBrief = null,
  certifications = []
} = {}) {
  const certs = parseCertificationList(certifications);
  if (applicationBrief && typeof applicationBrief === "object") {
    return {
      jobTitle: jobMeta.jobTitle || applicationBrief.jobTitle || "",
      companyName: jobMeta.companyName || applicationBrief.companyName || "",
      certifications: certs,
      applicationBrief: {
        roleSummary: applicationBrief.roleSummary || "",
        topSkills: applicationBrief.topSkills || [],
        keyExperiences: applicationBrief.keyExperiences || [],
        workAuth: applicationBrief.workAuth || "",
        location: applicationBrief.location || ""
      }
    };
  }
  return {
    jobTitle: jobMeta.jobTitle || "",
    companyName: jobMeta.companyName || "",
    certifications: certs,
    jobDescriptionExcerpt: String(jobMeta.jdText || "").trim().slice(0, 3500),
    resumeExcerpt: String(resumeText || "").trim().slice(0, 4000)
  };
}

function answersFromJson(raw, list) {
  const text = typeof raw === "string" ? raw : raw?.content || "";
  const obj = parseJsonObject(text);
  const rows = Array.isArray(obj?.answers) ? obj.answers : [];
  const byId = new Map();
  for (const row of rows) {
    const id = String(row?.id || "").trim();
    const answer = String(row?.answer || "").trim();
    if (!id || !answer) continue;
    byId.set(id, answer);
  }
  return list
    .map((q) => ({ id: q.id, answer: byId.get(q.id) || "" }))
    .filter((row) => row.answer);
}

/**
 * @returns {Promise<{ answers: Array<{ id: string, answer: string }>, usage: object }>}
 */
export async function generateHumanizedApplicationAnswers({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  questions,
  applicantInfo,
  jobMeta = {},
  resumeText = "",
  applicationBrief = null
}) {
  const list = (questions || []).filter((q) => q?.id && q?.label).slice(0, 10);
  if (!list.length) return { answers: [], usage: null };

  const profile = compactApplicantContext(applicantInfo);
  const certs = parseCertificationList(applicantInfo?.certifications);
  const hasCertQuestion = list.some((q) => isCertificationQuestion(q.label));
  const result = await chatCompletion({
    apiKey,
    model,
    jsonMode: true,
    temperature: hasCertQuestion ? 0.2 : 0.65,
    maxTokens: 1800,
    messages: [
      {
        role: "system",
        content:
          "You answer US job-application form questions for a real candidate. " +
          "Return ONLY valid JSON: {\"answers\":[{\"id\":\"...\",\"answer\":\"...\"}]}. " +
          "Keep each answer to 1-2 sentences max (a short phrase for tiny fields). " +
          "For yes/no style answers use Title Case exactly: \"Yes\" or \"No\" (never lowercase). " +
          "If the question requires a specific opening phrase, begin the answer with that phrase exactly. " +
          "Ground answers in the candidate resume/profile/brief; prefer real roles, employers, tools, and skills. " +
          "Do not invent employers, degrees, visas, certifications, or tools that contradict the resume/profile. " +
          "Certification/credential questions must name only credentials listed in candidateProfile.certifications (or the resume excerpt). " +
          "If the prompt offers options such as \"Application Architect, Administrator, or both\", answer with those options from the listed credentials — never a generic architecture, stakeholder, or collaboration paragraph. " +
          "If the resume lacks a specific story the question asks for, give a cautious brief answer based on transferable experience — do not fabricate a detailed false project. " +
          "If the profile and resume do not support a confident answer (especially work authorization, sponsorship, or other compliance facts), OMIT that id from answers rather than guessing."
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            ...buildAutofillContext({
              jobMeta,
              resumeText,
              applicationBrief,
              certifications: certs
            }),
            candidateProfile: profile,
            questions: list.map((q) => ({
              id: q.id,
              question: q.label,
              preferLonger: Boolean(q.multiline)
            }))
          },
          null,
          2
        )
      }
    ]
  });

  const drafted = answersFromJson(result.content, list).filter((row) => {
    const q = list.find((item) => item.id === row.id);
    return bankAnswerFitsQuestion(q?.label || "", row.answer);
  });

  return {
    answers: drafted,
    usage: result.usage
  };
}

function pickClosestOption(answer, options = []) {
  const want = String(answer || "").trim();
  if (!want || !options.length) return "";
  const wantNorm = want.toLowerCase();
  for (const opt of options) {
    if (String(opt).trim().toLowerCase() === wantNorm) return opt;
  }
  for (const opt of options) {
    const optNorm = String(opt).trim().toLowerCase();
    if (optNorm.includes(wantNorm) || wantNorm.includes(optNorm)) return opt;
  }
  if (/^yes\b/i.test(want)) {
    const yesOpt = options.find((o) => /^yes\b/i.test(String(o).trim()));
    if (yesOpt) return yesOpt;
  }
  if (/^no\b/i.test(want)) {
    const noOpt = options.find((o) => /^no\b/i.test(String(o).trim()));
    if (noOpt) return noOpt;
  }
  return "";
}

/**
 * @returns {Promise<{ answers: Array<{ id: string, answer: string }>, usage: object }>}
 */
export async function generateConstrainedChoiceAnswers({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  questions,
  applicantInfo,
  jobMeta = {},
  resumeText = "",
  applicationBrief = null
}) {
  const list = (questions || [])
    .filter((q) => q?.id && q?.label && Array.isArray(q.options) && q.options.length)
    .slice(0, 12);
  if (!list.length) return { answers: [], usage: null };

  const profile = compactApplicantContext(applicantInfo);
  const result = await chatCompletion({
    apiKey,
    model,
    jsonMode: true,
    temperature: 0.2,
    maxTokens: 1200,
    messages: [
      {
        role: "system",
        content:
          "You answer US job-application CHOICE questions for a real candidate. " +
          "Each question includes an options array — you MUST set answer to EXACTLY one string from that question's options (character-for-character). " +
          "Never invent an option. For yes/no style questions prefer honest answers grounded in the profile/resume only. " +
          "If the profile and resume do not support a confident answer for a question, OMIT that id from answers — do not guess Yes/No or invent compliance facts. " +
          'Return ONLY JSON: {"answers":[{"id":"...","answer":"..."}]}.'
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            ...buildAutofillContext({
              jobMeta,
              resumeText,
              applicationBrief,
              certifications: parseCertificationList(applicantInfo?.certifications)
            }),
            candidateProfile: profile,
            questions: list.map((q) => ({
              id: q.id,
              question: q.label,
              options: q.options
            }))
          },
          null,
          2
        )
      }
    ]
  });

  const drafted = answersFromJson(result.content, list);
  const answers = drafted
    .map((row) => {
      const q = list.find((item) => item.id === row.id);
      const matched = pickClosestOption(row.answer, q?.options || []);
      return { id: row.id, answer: matched };
    })
    .filter((row) => row.answer);

  return { answers, usage: result.usage };
}

/**
 * Classify inventory rows for a single mixed AI pass.
 * @param {Array<{ id: string, label: string, type?: string, options?: string[], required?: boolean, multiline?: boolean }>} fields
 */
export function partitionFormInventory(fields = []) {
  const list = (fields || []).filter((f) => f?.id && f?.label);
  const choice = [];
  const freeText = [];
  for (const f of list) {
    const type = String(f.type || f.fieldType || "").toLowerCase();
    const hasOptions = Array.isArray(f.options) && f.options.length > 0;
    if (
      hasOptions ||
      type === "select" ||
      type === "radio" ||
      type === "checkbox" ||
      type === "combobox" ||
      type === "choice"
    ) {
      choice.push({
        ...f,
        options: hasOptions ? f.options : f.options || []
      });
    } else {
      freeText.push(f);
    }
  }
  return { choice, freeText };
}

/**
 * Answer a full page form inventory in one constrained pass (choices + free text).
 * Prefer calling after profile aliases + Q&A bank; this is last resort for leftovers.
 *
 * @returns {Promise<{ answers: Array<{ id: string, answer: string, kind: "choice"|"text" }>, usage: object }>}
 */
export async function generateFormInventoryAnswers({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  fields,
  applicantInfo,
  jobMeta = {},
  resumeText = "",
  applicationBrief = null
}) {
  const { choice, freeText } = partitionFormInventory(fields);
  const choiceReady = choice.filter((q) => Array.isArray(q.options) && q.options.length);
  const textReady = freeText.filter((q) => q?.id && q?.label).slice(0, 12);
  const choiceSlice = choiceReady.slice(0, 14);
  if (!choiceSlice.length && !textReady.length) return { answers: [], usage: null };

  const profile = compactApplicantContext(applicantInfo);
  const certs = parseCertificationList(applicantInfo?.certifications);
  const hasCertQuestion = textReady.some((q) => isCertificationQuestion(q.label));

  const result = await chatCompletion({
    apiKey,
    model,
    jsonMode: true,
    temperature: hasCertQuestion ? 0.2 : 0.45,
    maxTokens: 2200,
    messages: [
      {
        role: "system",
        content:
          "You fill a US job-application form inventory for a real candidate. " +
          'Return ONLY JSON: {"answers":[{"id":"...","answer":"..."}]}. ' +
          "For CHOICE fields you MUST set answer to EXACTLY one string from that field's options. " +
          "For free-text fields keep answers to 1-2 sentences (short phrase for tiny fields). " +
          'Yes/no free-text answers must be Title Case "Yes" or "No". ' +
          "Ground answers in candidateProfile / resume; do not invent employers, visas, or certifications. " +
          "Certification questions may only list credentials from candidateProfile.certifications. " +
          "If the profile and resume do not support a confident answer, OMIT that id from answers — do not guess Yes/No or invent compliance facts."
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            ...buildAutofillContext({
              jobMeta,
              resumeText,
              applicationBrief,
              certifications: certs
            }),
            candidateProfile: profile,
            choiceFields: choiceSlice.map((q) => ({
              id: q.id,
              question: q.label,
              options: q.options,
              required: Boolean(q.required)
            })),
            textFields: textReady.map((q) => ({
              id: q.id,
              question: q.label,
              preferLonger: Boolean(q.multiline),
              required: Boolean(q.required)
            }))
          },
          null,
          2
        )
      }
    ]
  });

  const drafted = answersFromJson(result.content, [...choiceSlice, ...textReady]);
  const answers = [];
  for (const row of drafted) {
    const choiceQ = choiceSlice.find((q) => q.id === row.id);
    if (choiceQ) {
      const matched = pickClosestOption(row.answer, choiceQ.options || []);
      if (matched) answers.push({ id: row.id, answer: matched, kind: "choice" });
      continue;
    }
    const textQ = textReady.find((q) => q.id === row.id);
    if (textQ && bankAnswerFitsQuestion(textQ.label, row.answer)) {
      answers.push({ id: row.id, answer: row.answer, kind: "text" });
    }
  }

  return { answers, usage: result.usage };
}

/**
 * Humanized first-person summaries for repeating Work Experience form fields.
 * One short paragraph per role — not a bullet dump.
 */
export async function generateRoleSummaries({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  jobs = [],
  jobMeta = {}
} = {}) {
  const list = (jobs || [])
    .map((job, index) => ({
      index: Number.isInteger(job?.index) ? job.index : index,
      company: String(job?.company || "").trim(),
      title: String(job?.title || "").trim(),
      dates: String(job?.dates || "").trim(),
      current: Boolean(job?.current),
      bullets: Array.isArray(job?.bullets) ? job.bullets.filter(Boolean).slice(0, 6) : [],
      existing: String(job?.summary || "").trim()
    }))
    .filter((job) => job.company || job.title);
  if (!list.length) return { summaries: [], usage: null };

  const result = await chatCompletion({
    apiKey,
    model,
    jsonMode: true,
    temperature: 0.55,
    maxTokens: 2200,
    messages: [
      {
        role: "system",
        content:
          "You write short human job-application role summaries. " +
          'Return ONLY JSON: {"summaries":[{"index":0,"summary":"..."}]}. ' +
          "Each summary is 2-4 sentences in first person, natural and specific, not a bullet list. " +
          "Use past tense for previous roles and present tense for the current role. " +
          "Ground every sentence in the provided bullets, tools, and employer. " +
          "Do not invent employers, titles, or technologies. Do not copy the job description. " +
          "Keep each summary under 700 characters."
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            targetJobTitle: jobMeta.jobTitle || "",
            targetCompany: jobMeta.companyName || "",
            jobDescriptionExcerpt: String(jobMeta.jdText || "").trim().slice(0, 1800),
            roles: list.map((job) => ({
              index: job.index,
              company: job.company,
              title: job.title,
              dates: job.dates,
              current: job.current,
              bullets: job.bullets
            }))
          },
          null,
          2
        )
      }
    ]
  });

  const obj = parseJsonObject(result.content);
  const rows = Array.isArray(obj?.summaries) ? obj.summaries : [];
  const byIndex = new Map();
  for (const row of rows) {
    const index = Number(row?.index);
    const summary = String(row?.summary || "").trim();
    if (!Number.isInteger(index) || !summary) continue;
    byIndex.set(index, summary.slice(0, 900));
  }

  const summaries = list.map((job) => ({
    index: job.index,
    summary: byIndex.get(job.index) || job.existing
  }));

  return { summaries, usage: result.usage };
}
