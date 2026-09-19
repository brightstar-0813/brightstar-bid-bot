---
name: email-bid
description: >-
  Brightstar Email Bid section: discover hiring contacts (recruiter, HR, CTO,
  lead, hiring manager), personalize Outlook/Gmail outreach, attach resume,
  confirm To then send. Use when editing Email Bid UI/send/contacts in this bot.
---

# Email Bid (integrated in Brightstar Bid bot)

Product reference: ChatGPT + Outlook job-outreach session. Lives as a **first-class
section inside this extension** (not a separate extension) — same active profile,
AI engine, sheet append, status bar.

## Goal

Email-apply for a job by contacting **hiring-related** people:

- Recruiters / talent acquisition / job posters  
- HR / people ops  
- Hiring managers / team **leads**  
- CTO / engineering directors (when the role is technical)  

CEO/founder only if no hiring contacts exist and the company is small.

## Contact discovery (hard rule)

Prefer **hiring** roles only. Do not default to CEO blasts.

Priority:

1. Recruiter / TA / job poster  
2. HR / recruiting manager  
3. Hiring manager / team lead  
4. CTO / VP Eng / functional director  

Label each email: **verified** | **public** | **inferred** (corporate pattern).
Never invent addresses; never present inferred as confirmed.

## UX (comfortable + complete)

Independent **Email Bid** panel in the popup/side panel:

1. Job fields (title, company, link, JD) + Fill from tab  
2. Mailbox: **email + password** Connect for SMTP when the network allows it. If Connect TLS-times-out (common), use **Open in Outlook / Gmail** web compose (HTTPS) — attach resume in the browser, then Send. Personal Outlook.com often cannot use password SMTP.  
3. **Find contacts** via AI engine → To checklist (check/uncheck)  
4. Subject + body (human template; **no signature block** — mailbox signature)  
5. Attachments: last generated resume/cover **or** custom PDF  
6. **Confirm & Send** → separate SMTP sends (or one multi-To if user prefers list)  
7. Progress on **bottom status bar**; sheet Ready→Applied on successful send  

Does **not** auto-run after batch/manual generate.

## Compose / send rules

- Short, role-specific; 2–3 resume-backed strengths  
- Do not claim JD buzzwords absent from resume  
- Prefer personalized copy per primary contact; To list may include several checked recipients  
- Status reports who was emailed + confidence  

## Ownership

| Concern | Files |
|---------|--------|
| Orchestration | `email-bid.js` |
| Templates / roles | `prompts/email-templates.js`, `email-compose.js` |
| Contact harvest | `email-contacts.js`, `prompts/email-contacts.js` |
| SMTP send | `email-send.js`, `native-host/csv_watcher.py` |
| UI | `email-bid-ui.js`, `popup.html`, `popup.css` (wired from `popup.js`) |
| SW messages | `background.js` (`email_bid_prepare`, `email_bid_send`) |
