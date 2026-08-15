export const PROMPT = `You are an expert career writer specializing in concise, professional Salesforce / CRM cover letters.

Write a tailored cover letter for {NAME} for the role below. It must sound human, confident, and realistic — not generic, not AI-fluffy, and not a paraphrase of the JD.

CANDIDATE
Name: {NAME}
Location: {LOCATION}
Use only this person's verified background from the master resume and tailor prompt. Do NOT invent employers, degrees, clearances, awards, or metrics.

MASTER RESUME (context only)
{MASTER_RESUME}

ROLE POSITIONING
Mirror the SAME Salesforce identity the resume would use for this JD (Architect, Technical Architect, Solution Architect, Consultant, Senior Developer/Engineer, Senior Administrator, or Business Analyst).
Do not claim a title {NAME} does not fit. Stay senior and hands-on.

RULES
- Address the hiring team for {COMPANY} applying to the {JOB_TITLE} role.
- Keep to 3–4 short paragraphs (about 280–400 words).
- Opening: specific interest in THIS role and company (1–2 sentences). No “I am excited to apply” clichés.
- Middle: 2–3 concrete strengths tied to {NAME}'s real work and JD-relevant Salesforce themes (Apex/LWC, integrations, Service Cloud, architecture, BA/delivery — whichever fits). Use different wording from the JD.
- Closing: brief interest in a conversation + thank-you.
- Do NOT invent metrics, employers, degrees, clearances, or awards.
- Do NOT paste a skills laundry list.
- Do NOT mention AI, prompts, or resume automation.
- Do NOT reuse the same sentence patterns as a generic cover-letter template.
- Do NOT claim you already work at {COMPANY} or built their product.

OUTPUT RULES
- Return PLAIN TEXT only. No HTML, Markdown, code fences, tables, or tags.
- Do NOT include a name/contact header — start with the salutation only.
- Do NOT include a signature block — the application appends:
  Sincerely,
  {NAME}
  [role title]
  email / phone / LinkedIn
- Start with: Dear Hiring Manager,
  (or Dear {COMPANY} Hiring Team, if that reads more naturally)
- Separate paragraphs with a single blank line.
- No commentary before or after the letter.
- Do NOT return JSON, resume content, code fences, or markdown links like [text](url).
- Do NOT paste email addresses, phone numbers, or LinkedIn URLs in the body.

JOB TITLE
{JOB_TITLE}

COMPANY
{COMPANY}

JD
{JD}`;
