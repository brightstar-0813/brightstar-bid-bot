/**
 * UI theme catalog + apply/persist helpers (popup, Q&A editor, preview).
 */

export const UI_THEME_KEY = "ui_theme";
export const UI_THEME_LOCAL_KEY = "brightstar_ui_theme";
export const DEFAULT_THEME = "midnight-gold";

/** @type {{ id: string, label: string, blurb: string }[]} */
export const THEMES = [
  {
    id: "midnight-gold",
    label: "Midnight Gold",
    blurb: "Signature navy boardroom with gold accents"
  },
  {
    id: "daylight-slate",
    label: "Daylight Slate",
    blurb: "Light international HQ — cool slate & steel"
  },
  {
    id: "ocean-executive",
    label: "Ocean Executive",
    blurb: "Deep maritime navy with aqua clarity"
  },
  {
    id: "graphite-chrome",
    label: "Graphite Chrome",
    blurb: "Monochrome enterprise — charcoal & platinum"
  },
  {
    id: "jade-boardroom",
    label: "Jade Boardroom",
    blurb: "Global finance charcoal with jade accents"
  }
];

const THEME_IDS = new Set(THEMES.map((t) => t.id));

export function normalizeTheme(id) {
  const key = String(id || "").trim().toLowerCase();
  return THEME_IDS.has(key) ? key : DEFAULT_THEME;
}

export function applyThemeToDocument(themeId, doc = document) {
  const id = normalizeTheme(themeId);
  doc.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem(UI_THEME_LOCAL_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

export async function loadAndApplyTheme() {
  try {
    const data = await chrome.storage.local.get(UI_THEME_KEY);
    return applyThemeToDocument(data[UI_THEME_KEY]);
  } catch {
    return applyThemeToDocument(DEFAULT_THEME);
  }
}

export async function setTheme(themeId) {
  const id = applyThemeToDocument(themeId);
  try {
    await chrome.storage.local.set({ [UI_THEME_KEY]: id });
  } catch {
    /* ignore */
  }
  return id;
}

export function watchThemeChanges(onChange) {
  if (!chrome?.storage?.onChanged) return () => {};
  const handler = (changes, area) => {
    if (area !== "local" || !changes[UI_THEME_KEY]) return;
    const next = applyThemeToDocument(changes[UI_THEME_KEY].newValue);
    if (typeof onChange === "function") onChange(next);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
