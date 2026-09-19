/**
 * Offscreen document: read pinned FileSystemFileHandle without opening the popup.
 */
import { readPinnedCsvText } from "./file-handle-db.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "offscreen_read_pinned_csv") return;
  (async () => {
    try {
      const result = await readPinnedCsvText({ interactive: false });
      sendResponse(result);
    } catch (err) {
      sendResponse({ ok: false, reason: "read_error", error: String(err?.message || err) });
    }
  })();
  return true;
});
