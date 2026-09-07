---
name: brightstar-auto-apply
description: >-
  Best practices and change approach for Brightstar Bid bot (Chrome MV3 extension:
  CSV/Indeed job batch, ChatGPT/Claude resume generation, ATS autofill, hosted
  auto-submit). Use when editing this repo, adding ATS adapters, autofill,
  batch/queue, role tracks, prompts, profiles, sheets/Slack, or debugging apply flows.
---

# Brightstar Auto-Apply — Project Skill

Read this before changing code in this repo. Prefer small, layered edits that respect the ownership map and submit-safety rules below.

## What this product is

Chrome MV3 extension that:

1. Builds tailored resume + cover letter PDFs via an open **ChatGPT or Claude** tab
2. Queues US jobs from CSV / Indeed grab
3. Autofills application forms; **auto-submits only on allowed hosted paths**

Master resume is text/PDF/DOCX — never ChatGPT JSON. Resume prompts must request **JSON only**.

## Ownership map (edit here first)

| Concern | Primary files |
|---------|----------------|
| Batch orchestration, downloads, sheet/Slack, keep-alive | `background.js` |
| Apply orchestration, tab/docs resolve, multi-frame fill | `autofill-runner.js` |
| DOM fill, field heuristics, click Apply/Submit | `content/autofill.js` |
| In-page apply panel UI | `content/autofill-panel.js` |
| ATS host identity + submit policy | `ats/adapters.js` |
| ChatGPT / Claude content scripts | `content.js`, `content-claude.js` |
| Provider URLs / preference | `ai-provider.js` |
| Tracks (SF/DE/FS/AI), skill catalogs, default prompts | `role-tracks.js`, `prompts/*` |
| ATS match scoring | `ats-score.js` |
| Indeed scrape / hosted vs external | `indeed.js` |
| Popup / queue UI | `popup.js` |
| Profiles / person form | `profiles.js`, `person-profile-form.js`, `profile-editor.js` |
| Q&A bank | `qa-store.js`, `qa-editor.js` |
| Manifest matches / permissions | `manifest.json` |

Thin adapters, thick DOM: put host quirks needed by the service worker in `ats/adapters.js`; keep fill logic in `content/autofill.js`.

## Hard safety invariants

Never break these without an explicit product decision:

1. **Manual Apply / Auto Apply assist stops before Submit** unless the caller + adapter allow submit.
2. **External Indeed / external company ATS links are capture-only** — files OK, never auto-submit.
3. **Hosted Dice / Apply-on-Indeed** (and adapter `autoSubmitAllowed` sites on interleaved batch) may submit after confirmed fill.
4. Resolve submit with `resolveEffectiveAutoSubmit(site, autoSubmitCaller)` from `ats/adapters.js` — do not invent parallel flags.
5. Sheet **dedupe is by job link only** (normalized URL), never company name.
6. CSV upload / refresh **never auto-starts generation** — user must click **Start** after reviewing the queue.
7. Bad CSV rows: retry once → mark `failed` → continue batch (do not halt the whole run).
8. Do not commit `.env` / secrets. `OPENAI_API_KEY` is optional for leftover Q&A only.
9. After code changes, remind the user to **Reload** the unpacked extension on `chrome://extensions`.

## Change approach

### Before coding

1. Name the layer: batch | AI harvest | PDF/output | autofill DOM | adapter policy | UI | integrations.
2. Find the nearest existing pattern (same ATS, same track, same message type) and extend it.
3. Check whether `manifest.json` content_script `matches` need the new host.

### Adding an ATS site

1. Add entry to `ATS_ADAPTERS` in `ats/adapters.js` (`hostPatterns`, `autoSubmitAllowed`, `stepBudget`, flags).
2. Add host to `manifest.json` content_script matches for `content/autofill.js` (and panel if needed).
3. Extend DOM handling in `content/autofill.js` only as needed; reuse generic field fill.
4. Wire hosted backlog / interleaved apply in `background.js` only if the board should auto-apply like Dice.
5. Add/extend `tests/adapters.test.js` (and site-specific tests when behavior is non-trivial).
6. Default new external/employer links to **no auto-submit** unless product says otherwise.

### Autofill / apply changes

1. Prefer heuristics that work across frames; use `sendMessageToAllFrames` patterns in `autofill-runner.js`.
2. Keep blockers (sign-in, CAPTCHA, required blanks) as safe pauses with the tab left open.
3. Do not click Submit unless `autoSubmit` is explicitly true for that run.
4. Junk / placeholder detection: see `autofill-junk.js`.

### Batch / AI generation changes

1. One job → one fresh AI chat; never harvest the previous job’s JSON.
2. Prefer deep DOM recognition over re-prompt spam when JSON is already on the page.
3. Downloads count as saved only when Chrome reports complete.
4. Respect AI provider toggle (`ai-provider.js`) — ChatGPT and Claude paths must both keep working.

### Tracks / prompts / scoring

1. New track: `ROLE_TRACK_IDS` + catalogs + default prompts in `role-tracks.js`, plus `prompts/*`.
2. Built-in SF presets keep embedded prompts when track is SF; other tracks use track templates.
3. ATS score stays local and track-aware (`ats-score.js`).

## Verification checklist

After substantive edits, run what applies:

```bash
npm run check
npm test
```

- Touching adapters / autofill / indeed → relevant `tests/*.test.js`
- Touching batch/apply policy → mentally walk: Dice hosted, Indeed hosted, Indeed external, manual Apply
- UI-only → load unpacked + smoke the changed panel/popup path

## Output & sheet conventions

- Folder: `Downloads/Applications-{Prefix}/[N] - [Company] - [Title]/`
- Files only: `jd.txt`, `{Name}_Resume.pdf`, `{Name}_Cover Letter.pdf`
- Sheet status: build → **Ready**; confirmed submit / manual Apply / successful one-off → **Applied M/D/YYYY**
- Sheet/Slack failures must not fail file generation

## Communication when shipping a change

In the reply, briefly state: layer touched, submit-safety impact (yes/no), and how to reload/test.

## Deeper reference

- Architecture and message flow: [reference.md](reference.md)
