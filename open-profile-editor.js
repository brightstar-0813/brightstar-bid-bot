/**
 * Open the single canonical profile editor from popup, panel, or background.
 */

export function profileEditorUrl({ profileId = "", tab = "apply", presetId = "" } = {}) {
  const url = new URL(chrome.runtime.getURL("profile-editor.html"));
  if (profileId) url.searchParams.set("profileId", profileId);
  if (tab) url.searchParams.set("tab", tab);
  if (presetId) url.searchParams.set("preset", presetId);
  return url.toString();
}

export async function openProfileEditor({ profileId = "", tab = "apply", presetId = "" } = {}) {
  const href = profileEditorUrl({ profileId, tab, presetId });
  try {
    const win = await chrome.windows.create({
      url: href,
      type: "popup",
      width: 980,
      height: 860,
      focused: true
    });
    if (win?.id != null) await chrome.windows.update(win.id, { focused: true });
    return { ok: true, windowId: win?.id ?? null };
  } catch {
    await chrome.tabs.create({ url: href, active: true });
    return { ok: true, windowId: null };
  }
}
