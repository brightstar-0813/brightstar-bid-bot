/**
 * Contact research prompt — hiring roles only (recruiter, HR, CTO, lead, HM).
 */

export function buildEmailContactsPrompt({ company, title, jdLink, jdText, posterHint } = {}) {
  const co = String(company || "").trim() || "the company";
  const role = String(title || "").trim() || "the open role";
  const link = String(jdLink || "").trim();
  const jd = String(jdText || "").trim().slice(0, 6000);
  const poster = String(posterHint || "").trim();

  return `You are helping with targeted job outreach. Find hiring-related contacts only.

Company: ${co}
Role: ${role}
Job link: ${link || "(none)"}
Job poster hint: ${poster || "(none)"}
JD excerpt:
"""
${jd || "(not provided — use company + role + public web knowledge)"}
"""

TARGET ROLES (priority order — do NOT chase CEOs/founders unless no hiring contacts exist):
1. Recruiter / Talent Acquisition / job poster
2. HR / Recruiting Manager / People Ops
3. Hiring manager for this function
4. Team lead / Engineering manager / delivery lead
5. CTO / VP Engineering / relevant technical director (for engineering roles)

Rules:
- Prefer publicly listed work emails. If you only infer from a known corporate pattern, set confidence lower and note "inferred" in evidence.
- Never invent a random address.
- Return 3–6 best contacts max.
- Output JSON only, no markdown fences:

{"contacts":[{"name":"","role":"","email":"","source":"company_site|linkedin|job_post|inferred_pattern|other","confidence":0.0,"evidence":""}]}`;
}
