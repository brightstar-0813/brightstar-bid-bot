/**
 * Fill human-style templates from profile + JD + resume (no signature block).
 */

import {
  EMAIL_TEMPLATES,
  classifyContactRole,
  pickPrimaryContact,
  selectTemplateForRole
} from "./prompts/email-templates.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function pickSkills(resumeJson, jdText = "", limit = 3) {
  const skills = [];
  const raw = resumeJson?.skills;
  if (Array.isArray(raw)) {
    for (const s of raw) {
      if (typeof s === "string") skills.push(clean(s));
      else if (s && typeof s === "object") {
        const items = s.items || s.skills || s.list;
        if (Array.isArray(items)) skills.push(...items.map(clean));
        else if (s.name) skills.push(clean(s.name));
      }
      if (skills.length >= limit) break;
    }
  }
  const filtered = [...new Set(skills.filter(Boolean))];
  if (filtered.length >= 2) return filtered.slice(0, limit);
  const jdBits = String(jdText || "").match(
    /\b(Salesforce|React|Python|Java|AWS|Azure|Kubernetes|SQL|Lightning|Apex|Node\.?js|TypeScript|DevOps|CI\/CD)\b/gi
  );
  if (jdBits) filtered.push(...jdBits.map(clean));
  return [...new Set(filtered)].slice(0, limit);
}

export function pickRecentEmployer(resumeJson, person = {}) {
  const exp = resumeJson?.experience;
  if (Array.isArray(exp) && exp[0]) {
    return clean(exp[0].company || exp[0].employer || exp[0].name) || clean(person.currentCompany);
  }
  return clean(person.currentCompany) || "my recent role";
}

export function pickAchievement(resumeJson) {
  const exp = resumeJson?.experience;
  if (Array.isArray(exp)) {
    for (const job of exp) {
      const bullets = job?.bullets || job?.highlights || job?.achievements;
      if (Array.isArray(bullets) && bullets[0]) return clean(bullets[0]).slice(0, 180);
    }
  }
  return "delivering reliable results on complex projects";
}

export function pickCompanyReason(jdText, company) {
  const text = String(jdText || "");
  const m = text.match(
    /(?:about\s+(?:us|the\s+company)|our\s+mission|we\s+(?:are|build|help))[:\s]+([^\n.]{20,120})/i
  );
  if (m) return clean(m[1]);
  if (company) return `the work ${company} is doing in this space`;
  return "your team's mission and product focus";
}

export function pickKeyRequirement(jdText, skills = []) {
  if (skills[0]) return skills[0];
  const m = String(jdText || "").match(/(?:requirements?|qualifications?)[:\s]+([^\n]{15,100})/i);
  if (m) return clean(m[1]);
  return "the core skills listed in the role";
}

export function pickYears(person = {}, resumeJson = null) {
  const fromPerson = Number(person.yearsExperience || person.years);
  if (Number.isFinite(fromPerson) && fromPerson > 0) return String(Math.round(fromPerson));
  const exp = resumeJson?.experience;
  if (Array.isArray(exp) && exp.length) return String(Math.min(20, Math.max(3, exp.length * 2 + 2)));
  return "several";
}

/**
 * @param {{
 *   contacts?: Array<object>,
 *   person?: object,
 *   job?: { title?: string, company?: string, jdText?: string },
 *   resumeJson?: object|null,
 *   templateId?: number
 * }} opts
 */
export function composeEmailBid(opts = {}) {
  const contacts = Array.isArray(opts.contacts) ? opts.contacts : [];
  const person = opts.person || {};
  const job = opts.job || {};
  const resumeJson = opts.resumeJson || null;

  const primary = pickPrimaryContact(contacts);
  const kind = classifyContactRole(primary?.role);
  const template =
    (opts.templateId && EMAIL_TEMPLATES[opts.templateId]) || selectTemplateForRole(kind);

  const skills = pickSkills(resumeJson, job.jdText, 3);
  const title = clean(job.title) || clean(person.title) || "the open role";
  const company = clean(job.company) || "your company";
  const yourName = clean(person.name || person.fullName) || "Candidate";
  const greetingName = clean(primary?.name)?.split(/\s+/)[0] || "there";
  const specialty = clean(person.headline || person.trackLabel || skills[0]) || "software engineering";
  const recentCompany = pickRecentEmployer(resumeJson, person);
  const achievement = pickAchievement(resumeJson);
  const companyReason = pickCompanyReason(job.jdText, company);
  const keyReq = pickKeyRequirement(job.jdText, skills);
  const years = pickYears(person, resumeJson);
  const proTitle = clean(person.title || resumeJson?.headline) || title;

  /** @type {Record<string, string>} */
  const map = {
    "[Name]": greetingName,
    "[Role Title]": title,
    "[Company]": company,
    "[Your Name]": yourName,
    "[specialty or industry]": specialty,
    "[two relevant skills]": skills.slice(0, 2).join(" and ") || specialty,
    "[current or recent company]": recentCompany,
    "[relevant responsibility or achievement]": achievement,
    "[specific product, mission, project, or business area]": companyReason,
    "[number]": years,
    "[professional area]": specialty,
    "[skill 1]": skills[0] || specialty,
    "[skill 2]": skills[1] || skills[0] || "delivery",
    "[skill 3]": skills[2] || skills[1] || "collaboration",
    "[key requirement]": keyReq,
    "[specific reason]": companyReason,
    "[Technical Title]": proTitle,
    "[platforms, applications, or systems]": skills[0] ? `${skills[0]} systems` : "modern platforms",
    "[brief technical achievement with an outcome]": achievement,
    "[specific requirement]": keyReq,
    "[Key Skill]": skills[0] || specialty,
    "[requirement 1]": skills[0] || keyReq,
    "[requirement 2]": skills[1] || "cross-team delivery",
    "[company]": recentCompany,
    "[relevant responsibility]": achievement,
    "[specific task or result]": achievement,
    "[Team Name]": company,
    "[field]": specialty,
    "[specialty]": specialty,
    "[specific strength]": skills[0] || "ownership of end-to-end delivery",
    "[short example showing ownership and impact]": achievement
  };

  let subject = template.subject;
  let body = template.body;
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    subject = subject.split(key).join(map[key]);
    body = body.split(key).join(map[key]);
  }
  subject = subject.replace(/\[[^\]]+\]/g, "").replace(/\s{2,}/g, " ").trim();
  body = body
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\n*(?:Best regards|Sincerely),?\s*\n(?:[^\n]*\n){0,4}\s*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const toEmails = [
    ...new Set(
      contacts
        .map((c) => clean(c.email).toLowerCase())
        .filter((e) => EMAIL_RE.test(e))
    )
  ].slice(0, 8);

  return {
    templateId: template.id,
    templateName: template.name,
    roleKind: kind,
    primaryName: greetingName,
    subject,
    body,
    toEmails
  };
}

export { EMAIL_RE };
