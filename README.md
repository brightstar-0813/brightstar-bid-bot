# Resume GPT Builder (Chrome Extension)

This extension injects a selected profile's resume prompt + JD into your already-open ChatGPT tab, then auto-downloads a PDF.

## What it does

- Pick a profile (built-in or ones you add in the UI)
- Add new profiles with a name + full prompt content
- Paste JD into a text field (or load from clipboard)
- Uses the open ChatGPT web page (no API key)
- Auto-downloads: `firstname.pdf`

## Setup

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this extension folder

## Use

1. Open `https://chatgpt.com` and make sure you are logged in
2. Click the extension icon
3. Select a **Profile** (or add one under **+ Add new profile**)
4. Paste the JD into the text field (or click **Paste from clipboard**)
5. Click **Send to Open ChatGPT Tab**
6. Popup can be closed while it runs; reopen it to check status
7. Wait for auto-download of `.pdf`

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
- After code changes, click **Reload** on the extension card in `chrome://extensions`.
- Custom profiles can be removed with **Delete selected profile**.
