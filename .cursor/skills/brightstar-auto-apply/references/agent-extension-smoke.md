# Agent extension smoke (Chrome DevTools MCP)

How coding agents install and debug this unpacked MV3 extension via
[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp).

Project MCP config: [`.cursor/mcp.json`](../../../mcp.json) enables
`--categoryExtensions` (off by default) and `--isolated` (temp Chrome profile).

## Prerequisites

1. MCP server `chrome-devtools` is enabled in Cursor (Settings → MCP).
2. After changing `mcp.json`, reload MCP / restart the agent session.
3. Extension tools need a **pipe-launched** Chrome from the MCP server.
   Do **not** use `--autoConnect` / `--browserUrl` for extension load until
   Chrome 149+ (those modes cannot load extensions on older Chrome).
4. If tools like `install_extension` are missing, the category flag is not active.

## Standard loop (after code changes)

1. **Install or reload**
   - First time: `install_extension` with absolute path to this repo root
     (`${workspaceFolder}` / the unpacked extension directory that contains `manifest.json`).
   - Later edits: `reload_extension` with the extension id from `list_extensions`
     (replaces manual Reload on `chrome://extensions` for agent-driven checks).
2. **Identify**: `list_extensions` → note id + `serviceWorkerId` if exposed.
3. **Open UI**: `trigger_extension_action` (popup / action).
4. **Snapshot**: `take_snapshot` on the popup page → confirm queue / Start / status labels render.
5. **Service worker** (optional): `evaluate_script` with `serviceWorkerId` (omit `pageId`)
   to read `chrome.storage.local` keys or call a safe diagnostic — never trigger
   live batch Start / sheet writes / Slack from smoke unless the user asked.
6. **Content script** (optional): `navigate_page` to a public ATS apply URL the user
   provides, then `take_snapshot` for autofill panel / injected UI. Prefer fixture
   or already-open tabs the user designates.

## Safe smoke scope (defaults)

| Do | Do not |
|----|--------|
| Install / reload / list extensions | Auto-submit applications |
| Open popup; snapshot UI chrome | Start CSV batch against real jobs |
| Check content script presence on a designated host | Harvest ChatGPT/Claude or write the sheet |
| Read-only SW `evaluate_script` diagnostics | Disable submit-safety or change adapters “just to pass” |

Submit policy still applies: only exercise Apply/Submit paths when the user
explicitly requests a live apply smoke, and only on adapters that allow it.

## Last verified (isolated Chrome, not the daily profile)

2026-09-18, extension **1.8.0** (pre–Email Bid UI):

- `install_extension` on this repo → id `nbgkamipkhgnnefaonpgdfmkbafpldgm`
- Popup snapshot: status **Ready.**, queue **IDLE** / empty, **Start** present, **Allow auto submit** unchecked
- After `trigger_extension_action`, `list_pages` shows `sw-1` for `background.js`. The worker is not listed until something wakes it.
- `evaluate_script` on `sw-1` returned name + version `1.8.0`. No service-worker console errors.
- `https://www.dice.com/` (page id on the Dice line, not the first page) had `[data-brightstar-autofill-panel]`

**Email Bid:** removed from this extension (separate project). Do not expect Email Bid / mailbox UI in popup smoke.

`list_console_messages` still requires `pageId` even when filtering by `serviceWorkerId`.
`new_page` reprints every open page; the first number is often `about:blank`.

Unit tests (`npm test`) remain the source of truth for adapters, Indeed hosted
detection, and junk classification. This MCP path covers **integration UI** that Node tests cannot see.
