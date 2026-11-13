---
name: sheet-batch-source
description: >-
  Brightstar Jobs queue batch from Google Sheet capture tabs (US-SF-Jobs Role/
  Company/Link/JD/Salary): listCaptureJobs read path, CSV|Sheet toggle, person-tab
  Ready/Applied writes, Apps Script redeploy without breaking capture-bot appends.
  Use when editing sheet ingest, jobs sheet URL, ingest_sheet_jobs, listCaptureJobs,
  capture vs bid tabs, or sheet-jobs mapping.
compatibility: Cursor (Agent Skills / skills.sh layout)
metadata:
  author: brightstar
  version: "1.0"
  ecosystem: https://www.skills.sh/
---

# Sheet batch source (capture tab → Jobs queue)

Sibling of [brightstar-auto-apply](../brightstar-auto-apply/SKILL.md). Follow that skill for
submit-safety and overall batch; use **this** skill for Google Sheet **job ingest**.

Progressive disclosure:

1. This file — hard rules and ownership
2. Deeper Apps Script / column detail: [references/capture-vs-bid.md](references/capture-vs-bid.md)

## Product in one screen

1. Capture bot (separate) **appends** jobs to a capture tab (e.g. `US-SF-Jobs`)
2. Brightstar popup **Load from sheet** reads that tab into `all_us_jobs` / `job_queue`
3. User reviews channel filter → **Start** (never auto-start on load)
4. Ready / Applied / Bid mode write only to the **active person’s bid tab** (`Lewis-SF`, …)

## Ownership map

| Concern | Primary files |
|---------|----------------|
| Apps Script read action | `apps-script/Code.gs` (`listCaptureJobs`, `collectCaptureJobRows_`, `resolveExistingSheet_`) |
| Client fetch + gid parse | `sheets.js` (`extractSpreadsheetGid`, `fetchCaptureSheetJobs`) |
| Row → queue job mapping | `sheet-jobs.js` (`captureRowsToJobs`, `captureRowToJob`) |
| SW ingest + message | `background.js` (`ingestSheetJobs`, `ingest_sheet_jobs`) |
| CSV \| Sheet UI | `popup.html`, `popup.js` (`job_batch_source`, `jobs_sheet_source_url`) |
| Person bid writes / Sync | `sheets.js` append/markApplied/listRows; `sheet-sync.js` |
| Tests | `tests/sheet-jobs.test.js` |

Storage keys: `job_batch_source` (`csv` \| `sheet`), `jobs_sheet_source_url`, `jobs_sheet_source_tab` (capture tab name; UI field + load fallback).

## Hard safety invariants

Do not change without an explicit product decision:

1. **Two tab kinds — never conflate**
   - **Capture / jobs-source:** Role \| Company \| Link \| **JD** \| Salary (read-only from Brightstar)
   - **Person bid:** No \| Date \| Title \| Company \| Link \| Salary \| Status \| Bid mode (append / markApplied / Sync)
2. **Capture reads use only `listCaptureJobs`.** Never run `listRows`, `listLinks`, `append`, or `markApplied` against a capture tab via this Web App.
3. **`ensureSheetLayout_` / `dropJdColumnIfPresent_` must not run on capture tabs** — they delete the JD column and force bid-tracking headers.
4. **Capture-bot append is outside this Web App** (own writer / Sheets API). Redeploying Brightstar Apps Script for `listCaptureJobs` must stay **additive** on the read path and must not retarget capture writes through `append`.
5. **Ready / Applied** still go to the person tab from `getSheetConfig()` / `sheetTabName` — never write bid status onto the capture tab from batch.
6. **Dedupe** before generate/apply uses the **person** tab links (`dedupeQueueAgainstSheet`), not the capture tab.
7. **Load / refresh from sheet never auto-starts** batch — same as CSV (user clicks **Start**).
8. Jobs sheet URL should prefer **`gid=`** (`extractSpreadsheetGid`). If gid is missing, Load uses **Capture tab** name: message `sheetName` → stored `jobs_sheet_source_tab` → default `US-SF-Jobs`. Never use Output folder / person `sheetTabName` for capture reads.
9. After Apps Script edits: **Save → Deploy → Manage deployments → Edit → Version: New** so `listCaptureJobs` is live. Extension reload alone is not enough for script changes.
10. After extension code changes: remind **Reload** unpacked extension.

## Change workflow

### Before coding

1. Layer: `integrations` (sheet) or `batch` (queue ingest) or `ui` (toggle / URL).
2. Prefer extending `listCaptureJobs` / `sheet-jobs.js` / `ingestSheetJobs` — do not invent a second Sheets API path in the extension.
3. If touching `ensureSheetLayout_` or `listRows`, re-read [references/capture-vs-bid.md](references/capture-vs-bid.md).

### Adding a capture-column alias

1. Apps Script: column index helper in `Code.gs` (`title` already accepts `role`; JD via `jdTextColumnIndex_`).
2. Client: `fetchCaptureSheetJobs` field map in `sheets.js` if the JSON key changes.
3. Mapper: `sheet-jobs.js` if queue shape changes.
4. Tests: `tests/sheet-jobs.test.js`.

### UI

- Keep **CSV \| Google Sheet** source toggle; CSV controls stay in CSV mode; sheet URL + **Capture tab** + **Load from sheet** in sheet mode.
- Reuse Setup **Web App URL** (`sheets_web_app_url`); do not require a second deploy URL for reads.
- Short status only — no long instructional copy in the popup.
- Capture tab field (placeholder `US-SF-Jobs`) persists as `jobs_sheet_source_tab` and is sent as `sheetName` on Load.

## Verify

```bash
npm run check
npm test -- ./tests/sheet-jobs.test.js
```

Manual: redeploy Apps Script → paste capture URL (with gid, or without gid + Capture tab `US-SF-Jobs`) → Load from sheet → confirm JD column still on capture tab → Start → Ready on person tab only.

## When shipping

State: layer touched, whether Apps Script redeploy is required, capture-tab safety (yes/no), reload steps.

## Continuous updates

When this feature evolves, **update this skill in the same PR/change**:

- New Apps Script actions or column layouts → invariants + ownership map
- New storage keys / messages → ownership map
- New failure modes (redeploy hints, gid missing) → hard rules or reference

Parent skill [brightstar-auto-apply](../brightstar-auto-apply/SKILL.md) should keep a one-line pointer here; detailed sheet-ingest rules live in **this** file.
