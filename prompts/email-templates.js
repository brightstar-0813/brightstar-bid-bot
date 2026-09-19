/**
 * Hiring-focused contact roles and human email templates (no signature block).
 */

/** @typedef {"recruiter"|"hr"|"cto"|"hiring_manager"|"team_lead"|"unknown"} ContactRoleKind */

export const EMAIL_TEMPLATES = {
  1: {
    id: 1,
    name: "Recruiter / TA",
    bestFor: "Recruiters and talent acquisition",
    subject: "Application for [Role Title] | [Your Name]",
    body: `Hi [Name],

I recently learned about the [Role Title] opportunity at [Company] and wanted to introduce myself directly.

I bring [number] years of experience in [professional area], with hands-on expertise in [skill 1], [skill 2], and [skill 3]. My background closely matches the position's focus on [key requirement].

[Company] stands out to me because of [specific reason]. I've attached my resume for your reference — please let me know if my experience fits this role or another suitable opening.

Thank you for your time.`
  },
  2: {
    id: 2,
    name: "HR focused",
    bestFor: "HR and people operations",
    subject: "Interest in the [Role Title] Opportunity at [Company]",
    body: `Hi [Name],

I'm reaching out to express my interest in the [Role Title] position at [Company].

My experience in [specialty or industry] aligns closely with the role, particularly in [two relevant skills]. At [current or recent company], I've worked on [relevant responsibility or achievement], which prepared me to contribute from day one.

I've attached my resume for your review and would welcome a brief conversation about fit.

Thank you for your time.`
  },
  3: {
    id: 3,
    name: "CTO / technical leader",
    bestFor: "CTO, VP Engineering, technical director",
    subject: "Experienced [Technical Title] Interested in Joining [Company]",
    body: `Hi [Name],

I'm contacting you regarding the [Role Title] opening at [Company].

I have [number] years of experience designing, building, and supporting [platforms, applications, or systems]. My core strengths include [skill 1], [skill 2], and [skill 3].

In my recent work, I [brief technical achievement with an outcome]. The technical challenges in this role, especially [specific requirement], closely match the work I enjoy.

I've attached my resume and would appreciate the chance to discuss your team's priorities.`
  },
  4: {
    id: 4,
    name: "Hiring manager",
    bestFor: "Manager responsible for the open role",
    subject: "[Role Title] Candidate with Experience in [Key Skill]",
    body: `Hi [Name],

I'm interested in joining your team as a [Role Title].

The role caught my attention because it requires experience in [requirement 1] and [requirement 2], both central to my recent work. At [company], I was responsible for [relevant responsibility], including [specific task or result].

I've attached my resume and would welcome a conversation about the problems your team is working to solve.`
  },
  5: {
    id: 5,
    name: "Team lead",
    bestFor: "Team lead or delivery lead",
    subject: "Interested in Contributing to Your [Team Name] Team",
    body: `Hi [Name],

I'm reaching out because I'm interested in the [Role Title] opportunity on your team.

My background includes [number] years in [field], with a focus on [specialty]. One strength I would bring is [specific strength] — for example, I recently [short example showing ownership and impact].

I've attached my resume and would be glad to discuss how my experience might support your current priorities.`
  }
};

/**
 * @param {string} role
 * @returns {ContactRoleKind}
 */
export function classifyContactRole(role) {
  const r = String(role || "").toLowerCase();
  if (/\brecruit|\btalent\b|\bta\b|\bstaffer|\bsourcing\b/.test(r)) return "recruiter";
  if (/\bhr\b|\bhuman resources|\bpeople ops|\bpeople partner|\bpeople operations/.test(r)) {
    return "hr";
  }
  if (/\bcto\b|\bchief technology|\bvp\s*eng|\bvice president.*eng|\bhead of eng|\bengineering director/.test(r)) {
    return "cto";
  }
  if (/\blead\b|\bteam lead|\btech lead|\bengineering manager|\bdelivery manager/.test(r)) {
    return "team_lead";
  }
  if (/\bhiring manager|\bmanager\b|\bdirector\b|\bhead of\b/.test(r)) return "hiring_manager";
  return "unknown";
}

/**
 * Prefer hiring-related contacts over executives.
 * @param {Array<object>} contacts
 */
export function pickPrimaryContact(contacts) {
  const list = Array.isArray(contacts) ? contacts : [];
  const rank = (c) => {
    const kind = classifyContactRole(c?.role);
    const order = { recruiter: 0, hr: 1, hiring_manager: 2, team_lead: 3, cto: 4, unknown: 5 };
    return (order[kind] ?? 5) - Number(c?.confidence || 0) * 0.1;
  };
  return [...list].sort((a, b) => rank(a) - rank(b))[0] || null;
}

/**
 * @param {ContactRoleKind|string} kind
 */
export function selectTemplateForRole(kind) {
  const k = String(kind || "");
  if (k === "recruiter") return EMAIL_TEMPLATES[1];
  if (k === "hr") return EMAIL_TEMPLATES[2];
  if (k === "cto") return EMAIL_TEMPLATES[3];
  if (k === "hiring_manager") return EMAIL_TEMPLATES[4];
  if (k === "team_lead") return EMAIL_TEMPLATES[5];
  return EMAIL_TEMPLATES[1];
}
