---
name: brightstar-auto-apply
description: >-
  Guides safe changes to Brightstar Bid bot (Chrome MV3): CSV/Indeed batch,
  ChatGPT/Claude resume harvest, ATS autofill, hosted auto-submit policy.
  Use when the user wants to edit this repo, or mentions adapters, autofill,
  batch/queue, Greenhouse/Workday/Dice/Indeed apply, role tracks, prompts,
  profiles, Google Sheet, Slack, manifest matches, or submit-safety.
compatibility: Cursor (Agent Skills / skills.sh layout)
metadata:
  author: brightstar
  version: "1.1"
  ecosystem: https://www.skills.sh/
---

# Brightstar Auto-Apply

Procedural knowledge for this repo. Goal: **predictable change process** — same layering and submit-safety checks every run.

Progressive disclosure (per [Agent Skills](https://www.skills.sh/) / agentskills spec):

1. This file — activate and follow first
2. Deeper detail only when needed: [references/architecture.md](references/architecture.md)

## Product in one screen

1. Build resume + cover letter PDFs via open **ChatGPT or Claude** tab
2. Queue US jobs from CSV / Indeed grab
3. Autofill forms; **auto-submit only on allowed hosted paths**

Master resume = text/PDF/DOCX (never ChatGPT JSON). Resume prompts must ask for **JSON only**.
Prefer short control labels and live status text over long instructional hints in popup/panel UI.

## Ownership map

| Concern | Primary files |
|---------|----------------|
| Batch, downloads, sheet/Slack, keep-alive | `background.js` |
| Apply orchestration, docs, multi-frame | `autofill-runner.js` |
| DOM fill / Apply / Submit clicks | `content/autofill.js` |
| In-page apply panel | `content/autofill-panel.js` |
| ATS host + submit policy | `ats/adapters.js` |
| AI content scripts | `content.js`, `content-claude.js` |
| AI provider preference | `ai-provider.js` |
| Tracks + default prompts | `role-tracks.js`, `prompts/*` |
| SF enterprise project bank | `prompts/sf-enterprise-projects.txt` (+ `.js` export); injected via `{SF_PROJECT_BANK}` in `profiles.js` `buildPrompt` |
| Strong humanize (anti-AI resume voice) | `prompts/humanize-resume.js` (+ AI engine toggle) |
| ATS score | `ats-score.js` |
| Indeed hosted vs external | `indeed.js` |
| Popup / queue UI | `popup.js` |
| Profiles | `profiles.js`, `person-profile-form.js`, `profile-editor.js` |
| Q&A bank | `qa-store.js`, `qa-editor.js` |
| OpenAI leftover / Custom Q&A | `ai-answers.js`, `openai.js`, `autofill-runner.js` (`answerCustomQaAsk`, `runCustomOpenAiQaOnTab`), popup Ask panel |
| Host matches / permissions | `manifest.json` |

**Thin adapters, thick DOM:** SW-facing host quirks → `ats/adapters.js`; fill logic → `content/autofill.js`.

## Hard safety invariants

Do not change without an explicit product decision:

1. Manual Apply / Auto Apply assist **stops before Submit** unless caller + adapter allow it.
2. **External Indeed / external company ATS** = capture-only (files OK, never auto-submit).
3. **Dice** may auto-apply+submit in batch / queue Apply. **All other ATS** (Greenhouse, Workday, Ashby, Lever, Jobgether, Indeed, …) = generate files + **in-page Autofill panel** only (Q&A bank, uploads, fill; submit only when the user runs panel/popup Auto Apply with submit allowed).
4. Submit decision: only `resolveEffectiveAutoSubmit(site, autoSubmitCaller)` in `ats/adapters.js`.
5. Sheet dedupe = **job link only** (normalized), never company name. **Generate** skips if the link is already on the sheet (Ready or Applied). **Apply** only skips when the sheet status is Applied — a Ready row from the just-finished build must not block submit.
6. CSV upload/refresh **never auto-starts** generation — user clicks **Start** after review.
7. Bad row: retry once → `failed` → continue batch.
8. Never commit `.env` / secrets.
9. After code changes, remind: **Reload** unpacked extension on `chrome://extensions`.
10. **PDF output:** custom people must get `LastName_Resume` (never bare `Resume`) and `Applications-{Token}` under Downloads. Source of truth is the active person (`resume-profile.js` + `syncActivePersonOutputContext`); do not freeze batch on generic `Applications` or absolute paths (Chrome saves those as `download`).
11. **Custom profile parity:** Save-as-mine keeps rich / FIXED COMPANY HISTORY prompts (`resetEeo` ≠ `resetPrompts`); person template + sheet config are isolated; `last_resume_json` is scoped by `profileId`; queue rows get `profileId` on ingest/Start.

## Change workflow

### Before coding

1. Name the layer: `batch` | `ai-harvest` | `pdf-output` | `autofill-dom` | `adapter-policy` | `ui` | `integrations`.
2. Extend the nearest existing pattern (same ATS / track / message type).
3. Check `manifest.json` content_script `matches` for new hosts.

### Adding an ATS site

1. `ATS_ADAPTERS` in `ats/adapters.js` (`hostPatterns`, `autoSubmitAllowed`, `stepBudget`, flags).
2. Host matches in `manifest.json` for `content/autofill.js` (+ panel if needed).
3. DOM only as needed in `content/autofill.js`; reuse generic fill.
4. Wire interleaved/hosted backlog in `background.js` only if it should auto-apply like Dice.
5. Tests: `tests/adapters.test.js` (+ site tests when non-trivial).
6. Default new external/employer links to **no auto-submit**.

### Autofill / apply

1. Multi-frame: follow `sendMessageToAllFrames` patterns in `autofill-runner.js`.
2. Blockers (sign-in, CAPTCHA, required blanks) → safe pause, leave tab open.
3. Click Submit only when `autoSubmit` is true for that run.
4. Junk/placeholders: `autofill-junk.js`.

### Batch / AI generation

1. One job → one fresh AI chat; never harvest prior job JSON.
2. Prefer deep DOM recognition over re-prompt spam when JSON is on page.
3. Download counts only when Chrome reports complete.
4. Keep ChatGPT **and** Claude paths working (`ai-provider.js`).

### Tracks / prompts / scoring

1. New track: `ROLE_TRACK_IDS` + catalogs + defaults in `role-tracks.js` + `prompts/*`.
2. Built-in SF presets keep embedded SF prompts; other tracks use track templates.
3. ATS score stays local and track-aware (`ats-score.js`).

## Verify

```bash
npm run check
npm test
```

- Adapters / autofill / indeed → relevant `tests/*.test.js`
- Submit policy → walk: Dice hosted, Indeed hosted, Indeed external, manual Apply
- UI-only → reload unpacked + smoke the changed path

## Output & sheet

- Folder: `Downloads/Applications-{Prefix}/[N] - [Company] - [Title]/`
- Files: `jd.txt`, `{Name}_Resume.pdf`, `{Name}_Cover Letter.pdf` only
- Sheet: build → **Ready**; confirmed submit / manual Apply / successful one-off → **Applied M/D/YYYY**
- Sheet/Slack failure must not fail file generation

## When shipping

State: layer touched, submit-safety impact (yes/no), reload/test steps.

## References

- Runtime, pipeline, pitfalls: [references/architecture.md](references/architecture.md)
- Ecosystem: discover/install skills via [skills.sh](https://www.skills.sh/) (`npx skills add <owner/repo>`)
