# Resume GPT Builder (Chrome Extension)

This extension injects a selected profile's resume prompt + JD into your already-open ChatGPT tab, then auto-downloads a PDF and JD text into a job folder.

## What it does

- Pick a profile (built-in or ones you add in the UI)
- Fill job title, company name, JD link, and JD text
- Add new profiles with a name + full prompt content
- Uses the open ChatGPT web page (no API key)
- Saves into:
  - `Downloads / [output folder] / [job title] / jd.txt`
  - `Downloads / [output folder] / [job title] / firstname.pdf`

## Setup

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this extension folder

## Use

1. Open `https://chatgpt.com` and make sure you are logged in
2. Click the extension icon
3. Select a **Profile** (or add one under **+ Add new profile**)
4. Fill **Job title**, **Company name**, and optional **JD link**
5. Paste the JD into the text field (or click **Paste from clipboard**)
6. Set **Output directory** (folder name under your Chrome Downloads folder)
7. Click **Send to Open ChatGPT Tab**
8. Popup can be closed while it runs; reopen it to check status
9. Files appear under `Downloads / [output folder] / [job title] /`

## Add a profile in the UI

1. Open the popup
2. Click **+ Add new profile**
3. Enter **Profile name**
4. Paste the full **Prompt content** (must include `{JD}`)
5. Click **Save profile**

Custom profiles are stored in Chrome extension storage (not as files). Built-in profiles stay in `prompts/`.

## Built-in prompt files

- `prompts/charlyton.js`

To ship another built-in prompt with the extension:

1. Add `prompts/your-id.js` exporting `PROMPT`
2. Register it in `BUILTIN_PROFILES` inside `profiles.js`

## Notes

- Keep ChatGPT tab open while it runs.
- Popup can be closed while generation runs in background.
- Output path is relative to Chrome's **Downloads** folder (Chrome extensions cannot write to an arbitrary absolute disk path).
- After code changes, click **Reload** on the extension card in `chrome://extensions`.
- Custom profiles can be removed with **Delete selected profile**.
