# Capture tab vs person bid tab

Loaded from [SKILL.md](../SKILL.md) when editing Apps Script or sheet ingest.

## Capture / jobs-source tab

Typical name: `US-SF-Jobs` (configurable via full sheet URL + `gid=`).

| Col | Header aliases |
|-----|----------------|
| Role | title, job title, role, position |
| Company | company, employer, organization |
| Link | link, url, job link, job url |
| JD | jd, job description, description |
| Salary | salary, compensation, pay |

- Written by the **capture bot** (separate process), not by Brightstar `append`.
- Brightstar reads with **`listCaptureJobs`** only (`resolveExistingSheet_` by gid or name; **never creates** the tab).
- Must **not** call `ensureSheetLayout_`, `dropJdColumnIfPresent_`, or `trimColumnsPastBidMode_`.

## Person bid tab

Typical name: `{Firstname}-{TRACK}` (e.g. `Lewis-SF`) from active person `sheetTabName`.

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| No | Date | Title | Company | Link | Salary | Status | Bid mode |

- Brightstar **append** / **markApplied** / **listLinks** / **listRows** (Sync).
- `listRows` / writes intentionally normalize layout (including dropping a stray JD column on **bid** tabs).

## Action matrix

| Action | Person bid tab | Capture tab |
|--------|----------------|-------------|
| `listCaptureJobs` | Avoid (wrong shape; OK if read-only but unused) | **Required** for batch ingest |
| `listRows` / Sync | Yes | **Forbidden** (mutates / drops JD) |
| `listLinks` | Yes (dedupe) | **Forbidden** (layout mutate) |
| `append` / `markApplied` | Yes (Ready / Applied) | **Forbidden** via this Web App |

## Redeploy vs capture-bot append

- Redeploying the Brightstar Web App publishes new `doPost` actions (including `listCaptureJobs`).
- Capture-bot appends that use **their own** Sheets writer are unaffected.
- Risk only if capture (or a tool) POSTs this Web App’s `append`/`listRows` at the capture tab — that path still runs bid layout mutation. Do not wire capture writes through this script.

## Extension flow (quick)

```
jobs_sheet_source_url + sheets_web_app_url
  (+ sheetName / jobs_sheet_source_tab / default US-SF-Jobs if no gid)
  → fetchCaptureSheetJobs (listCaptureJobs)
  → captureRowsToJobs
  → ingestSheetJobs → all_us_jobs + job_queue
  → dedupeQueueAgainstSheet (person tab)
  → user Start → append Ready on person tab
```

## Related code

- `apps-script/Code.gs` — `listCaptureJobs`, `collectCaptureJobRows_`, `resolveExistingSheet_`
- `sheets.js` — `extractSpreadsheetGid`, `fetchCaptureSheetJobs`
- `sheet-jobs.js` — mapper
- `background.js` — `ingestSheetJobs` (gid preferred; tab-name fallback)
- `popup.js` — source toggle + Capture tab + Load from sheet
