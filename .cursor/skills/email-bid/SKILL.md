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

1. Mailbox: **email + password** Connect for SMTP when the network allows it. If Connect TLS-times-out (common), use **Open in Outlook / Gmail** web compose (HTTPS) — attach resume in the browser, then Send. Personal Outlook.com often cannot use password SMTP.  
2. Job fields (title, company, link, JD) + Fill from tab  
3. **Find contacts** via AI engine → To checklist (check/uncheck)  
4. Subject + body — **AI writes a short human cover-letter email** for this job (resume-grounded); local variants are the fallback. No signature block.  
5. Attachments: last generated resume/cover **or** custom PDF  
6. **Confirm & Send** (SMTP when connected) or **Open in Outlook / Gmail** (downloads resume to `Downloads/EmailBid` and best-effort auto-attach)  
7. Progress on **bottom status bar**; sheet **Applied** + **Bid mode = Email bid** on successful SMTP send **or** Open in Outlook/Gmail handoff (upsert by job link — no pre-send Ready row)  

Does **not** auto-run after batch/manual generate.

## Compose / send rules

- Short, role-specific; 2–3 resume-backed strengths  
- Do not claim JD buzzwords absent from resume  
- Prefer personalized copy per primary contact; To list may include several checked recipients  
- End with a short closing greeting (Warm regards / Thank you / Best regards) — no name/phone/LinkedIn block  
- Status reports who was emailed + confidence  

## AI chat cleanup

After **Confirm & Send** or **Open in Outlook / Gmail**, delete the ChatGPT/Claude
conversations from the last Email Bid (contacts + draft) when **Delete AI chat after job**
is on. Also sweeps Recents titles like "Find hiring contacts" / "Write hiring outreach email".
Cleanup is deferred if a batch/generate is running.

## Ownership

| Concern | Files |
|---------|--------|
| Orchestration | `email-bid.js` |
| Templates / roles | `prompts/email-templates.js`, `prompts/email-compose.js`, `email-compose.js` |
| Contact harvest | `email-contacts.js`, `prompts/email-contacts.js` |
| SMTP send | `email-send.js`, `native-host/csv_watcher.py` |
| UI | `email-bid-ui.js`, `popup.html`, `popup.css` (wired from `popup.js`) |
| SW messages | `background.js` (`email_bid_prepare`, `email_bid_send`, `email_bid_record_sheet`, `email_bid_cleanup_chats`) |
