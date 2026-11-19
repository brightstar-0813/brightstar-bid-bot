/* Sync theme before paint — mirrors chrome.storage via localStorage. */
(() => {
  try {
    const id = localStorage.getItem("brightstar_ui_theme") || "midnight-gold";
    document.documentElement.setAttribute("data-theme", id);
  } catch {
    document.documentElement.setAttribute("data-theme", "midnight-gold");
  }
})();
