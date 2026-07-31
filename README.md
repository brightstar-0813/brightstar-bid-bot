# Resume GPT Builder (Chrome Extension)

This extension injects a selected profile's resume prompt + JD into your already-open ChatGPT tab, then saves files and can append a row to Google Sheets.

## What it does

- Pick a resume profile (built-in or ones you add in the UI)
- Fill job title, company name, JD link, and JD text
- Saves into `Downloads / [output folder] / [company name - job title] /`:
    - `jd.txt`
    - `Matthew_Resume.pdf` (or profile-specific prefix such as `Steven_Resume.pdf`)
    - `Cover Letter.pdf` (generated next via the **CoverLetter** prompt)
- **Copy row for spreadsheet** — copies a tab-separated row to paste into Google Sheets
- Optionally appends to Google Sheets via Apps Script

## Setup

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this extension folder

## Use

1. Open `https://chatgpt.com` and make sure you are logged in
2. Click the extension icon
3. Select a **Profile** (default: **Matthew Dale Hoffman (Salesforce)**)
4. Fill **Job title**, **Company name**, and **JD link**
5. Paste the JD
6. Set **Output directory**
7. Click **Generate JSON in ChatGPT**
8. Paste the JSON into **Resume JSON**, then click **Render resume & cover letter**

If ChatGPT already returned JSON, paste it and click **Render resume & cover letter**.

## CoverLetter prompt

Built-in file: `prompts/cover-letter.js` (profile title: **CoverLetter**).

It runs automatically after JD + resume are saved. Supports placeholders:

- `{JD}`
- `{JOB_TITLE}`
- `{COMPANY}`

To override without editing the file: add a custom profile named **CoverLetter** (that one is used instead).

## Google Spreadsheet (one-time)

Chrome cannot write to a spreadsheet from the share/edit link alone. You need a tiny Apps Script web app once:

1. Open your spreadsheet
2. **Extensions → Apps Script**
3. In the extension popup, click **Copy Apps Script** (or open `apps-script/Code.gs`)
4. Paste into Apps Script → **Save**
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Authorize when prompted
7. Copy the **Web App URL** into the extension with the spreadsheet link

## Notes

- Keep ChatGPT tab open while it runs (resume and cover letter each start a new chat).
- Resume flow expects **JSON** from ChatGPT; the extension parses it and renders HTML/PDF locally.
- Output path is relative to Chrome's **Downloads** folder.
- After code changes, click **Reload** on the extension card in `chrome://extensions`.
- Matthew prompt source: `prompts/matthew-dale-hoffman-resume.txt` (shipped as built-in profile via `prompts/matthew-dale-hoffman.js`).
- Salesforce prompt source (Steven): `prompts/steven-avon-resume.txt` (also shipped as built-in profile via `prompts/steven-avon.js`).
