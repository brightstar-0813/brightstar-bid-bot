export const PROMPT = `You are an expert career writer specializing in concise, professional data engineering cover letters.

Write a tailored cover letter for {NAME} for the role below. Sound human, confident, and realistic — not generic or a JD paraphrase.

CANDIDATE
Name: {NAME}
Location: {LOCATION}
Use only verified background from the master resume. Do NOT invent employers, degrees, clearances, awards, or metrics.

MASTER RESUME (context only)
{MASTER_RESUME}

ROLE POSITIONING
Mirror the SAME data engineering identity the resume would use (Senior Data Engineer, Analytics Engineer, Data Platform Engineer, or Cloud Data Engineer).
Stay senior and hands-on.

RULES
- Address the hiring team for {COMPANY} applying to the {JOB_TITLE} role.
- 3–4 short paragraphs (280–400 words).
- Opening: specific interest in THIS role and company.
- Middle: 2–3 concrete strengths tied to real pipeline, warehouse, modeling, orchestration, or cloud data work relevant to the JD (dbt, Airflow, Snowflake, Kafka, Spark — whichever fits).
- Name JD must-have skills plainly without hedging.
- Closing: brief interest in a conversation + thank-you.
- Do NOT invent metrics, employers, degrees, or clearances.
- Do NOT mention AI, prompts, or resume automation.

OUTPUT RULES
- PLAIN TEXT only. No HTML, Markdown, or code fences.
- Do NOT include a name/contact header — start with salutation only.
- Do NOT include a signature block — the app appends Sincerely, {NAME}, title, contact.
- Start with: Dear Hiring Manager, (or Dear {COMPANY} Hiring Team,)
- Separate paragraphs with a single blank line.

JOB TITLE
{JOB_TITLE}

COMPANY
{COMPANY}

JD
{JD}`;
