# Session workflow summary

Derived from `c:\Users\Administrator\Downloads\session.txt` (ChatGPT + Outlook).

## User intent

Email-apply jobs by messaging company **CEO / VP / recruiter** (and hiring
managers), with a tailored resume, via **Outlook**.

## Agent behavior that worked

1. Connect Outlook (not “build SMTP client ID UI”).
2. Ask for / accept: JD, company, title, LinkedIn link, tailored resume PDF.
3. Find contacts from public sources; prefer recruiter → HM → relevant leaders;
   use CEO sparingly.
4. Label emails as public/verified vs pattern-inferred.
5. Send **separate personalized** Outlook emails with resume attached.
6. Keep claims resume-grounded.
7. Optional: convert signature image → HTML for rendering.
8. Honor connector safety blocks; never bypass.

## Anti-patterns from the session guidance

- Same email body to many executives at one company in one blast  
- Inventing emails or treating inferred addresses as confirmed  
- Claiming JD buzzwords (Cursor, Certinia, etc.) not on the resume  
- Over-targeting CEO when recruiter/HM exists  
