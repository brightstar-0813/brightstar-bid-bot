# Resume GPT Builder (Chrome Extension)

This extension reads JD text from your clipboard, injects it into your resume prompt template, sends it in your already-open ChatGPT tab, and lets you export results.

## What it does

- Reads JD from clipboard
- Uses the open ChatGPT web page (no API key)
- Shows generated resume text
- Auto-downloads:
  - `firstname.pdf`

## Setup

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select folder: `e:\script\chrome-extension-resume-bot`

## Use

1. Click extension icon
2. Open `https://chatgpt.com` and make sure you are logged in
3. Copy JD text
4. Click **Send to Open ChatGPT Tab**
5. Popup can be closed while it runs; reopen it to check status
6. Wait for auto-download of `.pdf`

## Notes

- Keep ChatGPT tab open while it runs.
- Popup can be closed while generation runs in background.
