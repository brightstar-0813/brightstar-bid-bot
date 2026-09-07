# Architecture reference

Loaded on demand from [SKILL.md](../SKILL.md) (skills.sh / agentskills `references/` layout). Prefer live code if this drifts.

## Runtime shape

```
popup.js / side panel / app window
        │  chrome.runtime messages
        ▼
background.js  (service worker, type: module)
        │
        ├── AI tab: content.js | content-claude.js
        ├── Apply tab: content/autofill.js (+ autofill-panel.js)
        ├── downloads / alarms / offscreen / nativeMessaging
        └── modules: autofill-runner, ats/adapters, ai-provider,
                     role-tracks, sheets, slack, indeed, profiles, …
```

## Typical job pipeline

1. CSV / Indeed grab → US filter → host-based source (Dice / Indeed / LI / Etc)
2. Queue review → user **Start**
3. Ensure AI tab → fresh chat → resume prompt + JD → poll JSON → PDFs + `jd.txt`
4. Same chat → cover letter → sheet append (Ready) → optional Slack on failures only
5. If hosted auto-apply board: open apply URL → autofill → Submit when allowed → mark Applied
6. Cooldown → delete AI chat → next pending row

## Submit policy (source of truth)

`ats/adapters.js`:

- `autoSubmitAllowed` — site may ever auto-submit
- `alwaysAutoSubmit` — submit even without caller flag (Greenhouse / Ashby / Lever style)
- `resolveEffectiveAutoSubmit(site, callerFlag)` — single decision point
- `isEmployerAts` / `isEmployerAtsHost` — aggregator redirect targets (e.g. Jobgether → Workday)

Indeed hosted vs external: `indeed.js` (`hostedApply` / `externalApply` / apply evidence). External = never submit.

## Messaging habits

- Background ↔ content: typed message actions; tolerate missing receivers (tab closed / SW sleep).
- Use keep-alive / alarms patterns already in `background.js` for long batches.
- Autofill: prefer multi-frame broadcast + merge results; application UIs often iframe.

## Storage

- Person profiles, queue, settings: `chrome.storage.local`
- Optional native host for CSV watch + reading PDFs from disk (`native-host/`)
- Job docs map / last generated docs: used by apply to find resume + cover PDFs

## Tests

| Area | File |
|------|------|
| Adapters / submit policy | `tests/adapters.test.js` |
| Indeed hosted detection | `tests/indeed.test.js` |
| Greenhouse helpers | `tests/greenhouse.test.js` |
| Role tracks | `tests/role-tracks.test.js` |
| ATS score | `tests/ats-score.test.js` |
| Autofill junk | `tests/autofill-junk.test.js` |
| Q&A store | `tests/qa-store.test.js` |
| AI provider | `tests/ai-provider.test.js` |

`npm run check` is syntax-only (`node --check` on key entry files). `npm test` runs `node --test tests`.

## Common pitfalls

- Editing fill logic only in the runner — DOM must change in `content/autofill.js`.
- Adding a host to adapters but forgetting `manifest.json` matches.
- Treating LinkedIn / Etc like Dice for auto-submit.
- Assuming sheet write success is required for a successful job row.
- Blocking the batch on one unusable JSON when deep harvest already found valid JSON.
- Committing `.env` or personal Q&A dumps with secrets.
