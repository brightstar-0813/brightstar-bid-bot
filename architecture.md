# Workday Application Assistant — Architecture

## Product decision (authoritative)

**All day-to-day apply workflows — including Workday — run inside the Brightstar Bid Chrome extension**, on the employer’s real Workday tab.

| Surface | Role |
|---------|------|
| Chrome extension (popup, queue, autofill panel, `content/autofill.js`) | **Primary product** |
| Employer Workday career site (open tab) | Where the application is filed |
| `content/workday-engine.js` | Page classify + field policy (ALLOW / REQUIRE_USER / BLOCK) |

There is **no** separate Next.js app or Playwright worker in the supported product path.

## Runtime pipeline (extension)

```
PROFILE (profiles.js / applicant info)
  → WORKDAY PAGE DETECT (workday-engine + detectWorkdayWizardState)
  → FIELD DISCOVERY / FILL (content/autofill.js)
  → POLICY (workday-engine) — skip consequential autofill; use Q&A / panel
  → VALIDATE / advance
  → USER ENABLES “Allow auto submit” (Workday defaults off)
  → SUBMIT
  → sheet Applied
```

Hard rules:

- Never invent qualifications or demographics.
- Never bypass CAPTCHA / MFA / bot protection.
- Workday submit only when the user enables **Allow auto submit**.
- Uncertain → stop → ask user → continue.

## Key files

- [`content/workday-engine.js`](content/workday-engine.js) — classify / map / policy
- [`content/autofill.js`](content/autofill.js) — DOM fill + Workday wizard
- [`content/autofill-panel.js`](content/autofill-panel.js) — in-page Autofill UI
- [`ats/adapters.js`](ats/adapters.js) — host + submit policy
