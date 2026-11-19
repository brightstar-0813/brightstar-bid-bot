/**
 * MAIN-world helper for ATS pages (iCIMS / ASP.NET) that store actions in
 * javascript: URLs. Page CSP blocks those navigations, but __doPostBack from
 * an allowed chrome-extension script still works.
 */
(() => {
  if (window.__brightstarPageBridge) return;
  window.__brightstarPageBridge = true;

  // The content script waits for this marker before dispatching commands, so
  // nothing is sent into the void while this file is still loading.
  const markReady = () => {
    try {
      document.documentElement.setAttribute("data-brightstar-bridge-ready", "1");
    } catch {
      /* ignore */
    }
  };

  document.addEventListener(
    "__brightstar_page_cmd",
    (event) => {
      const d = event.detail || {};
      try {
        if (d.cmd === "postback" && typeof window.__doPostBack === "function") {
          window.__doPostBack(String(d.target || ""), String(d.argument || ""));
        }
      } catch {
        /* ignore */
      }
    },
    true
  );

  markReady();
})();
