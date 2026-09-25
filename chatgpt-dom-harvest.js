/**
 * Read resume JSON from a ChatGPT canvas or virtualized code panel.
 * Classic script: content.js and chrome.scripting.executeScript share
 * globalThis.__brightstarDomHarvest. No import/export (injected files are classic).
 */
(function (root) {
  const TEXT_CAP = 400000;
  const MAX_SCROLL_STEPS = 20;
  const MAX_OVERLAP_LINES = 200;
  const SKIP_SELECTOR = [
    "#prompt-textarea",
    "textarea",
    "[data-testid='composer']",
    "[data-testid*='composer']",
    "[data-message-author-role='user']",
    "[data-turn='user']",
    "[data-testid*='user-message']"
  ].join(", ");
  const PANEL_SELECTOR = [
    "[data-testid*='canvas']",
    "[class*='Canvas']",
    ".ProseMirror",
    ".monaco-editor .view-lines",
    ".cm-content",
    ".cm-scroller"
  ].join(", ");
  const SCROLLER_SELECTOR = [
    ".monaco-scrollable-element",
    ".monaco-editor .view-lines",
    ".cm-scroller",
    ".cm-content",
    "[data-testid*='canvas']",
    "[class*='Canvas']",
    ".ProseMirror"
  ].join(", ");

  let inflight = null;

  function normalizeQuotes(text) {
    return String(text || "")
      .replace(/\uFEFF/g, "")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\u00A0/g, " ")
      .replace(/\r\n/g, "\n");
  }

  function tidyChunk(text) {
    return normalizeQuotes(text)
      .replace(/^\n+/, "")
      .replace(/\s+$/g, "");
  }

  function isComposerOrUserNode(el) {
    if (!el || typeof el.closest !== "function") return false;
    if (el.closest(SKIP_SELECTOR)) return true;
    const form = typeof el.closest === "function" ? el.closest("form") : null;
    if (form && typeof form.querySelector === "function") {
      if (form.querySelector("#prompt-textarea, textarea, [data-testid*='composer']")) return true;
    }
    return false;
  }

  function elementText(el) {
    if (!el || isComposerOrUserNode(el)) return "";
    return tidyChunk(el.innerText || el.textContent || "");
  }

  /**
   * Short text, or a resume fragment that does not yet contain both keys.
   * A payload that already has "name" and "experience" is complete enough to parse.
   */
  function domTextLooksIncomplete(text) {
    const t = String(text || "").trim();
    const hasName = t.includes('"name"') || t.includes('"Name"');
    const hasExp = t.includes('"experience"') || t.includes('"Experience"');
    if (hasName && hasExp) return false;
    if (t.length < 80) return true;
    return (
      t.includes('"bullets"') ||
      t.includes('"Bullets"') ||
      hasExp ||
      hasName ||
      /^\s*\{/.test(t)
    );
  }

  /** Scroll only when a canvas/editor scroller exists and the mounted text is still a fragment. */
  function shouldDeepScroll(mountedText, scrollerCount) {
    if ((Number(scrollerCount) || 0) < 1) return false;
    return domTextLooksIncomplete(mountedText);
  }

  function stitchViewportChunks(chunks) {
    let acc = "";
    const list = Array.isArray(chunks) ? chunks : [];
    for (const raw of list) {
      const chunk = tidyChunk(raw);
      if (!chunk) continue;
      if (!acc) {
        acc = chunk;
      } else if (acc.includes(chunk)) {
        continue;
      } else {
        const accLines = acc.split("\n");
        const chunkLines = chunk.split("\n");
        const maxLines = Math.min(accLines.length, chunkLines.length, MAX_OVERLAP_LINES);
        let lineOverlap = 0;
        for (let n = maxLines; n >= 1; n -= 1) {
          let ok = true;
          for (let i = 0; i < n; i += 1) {
            if (accLines[accLines.length - n + i] !== chunkLines[i]) {
              ok = false;
              break;
            }
          }
          if (ok) {
            lineOverlap = n;
            break;
          }
        }
        if (lineOverlap > 0) {
          const nextLines = chunkLines.slice(lineOverlap);
          if (nextLines.length) acc = accLines.concat(nextLines).join("\n");
        }
      }
      if (acc.length >= TEXT_CAP) {
        acc = acc.slice(0, TEXT_CAP);
        break;
      }
    }
    return acc.slice(0, TEXT_CAP);
  }

  function scoreText(text) {
    const s = String(text || "");
    let n = s.length;
    if (s.includes('"experience"') || s.includes('"Experience"')) n += 100000;
    if (s.includes('"name"') || s.includes('"Name"')) n += 50000;
    if (s.includes('"bullets"') || s.includes('"Bullets"')) n += 10000;
    return n;
  }

  function richer(a, b) {
    return scoreText(b) > scoreText(a) ? b : a;
  }

  function isPageScroller(el) {
    if (!el || typeof document === "undefined") return true;
    if (el === document.body || el === document.documentElement || el === document.scrollingElement) {
      return true;
    }
    const tag = String(el.tagName || "").toUpperCase();
    if (tag === "MAIN" || tag === "BODY" || tag === "HTML") return true;
    if (typeof el.querySelectorAll === "function") {
      const turns = el.querySelectorAll(
        "[data-message-author-role='assistant'], [data-turn='assistant']"
      );
      if (turns.length > 1) return true;
    }
    return false;
  }

  function looksLikeCodeScroller(el) {
    if (!el || isPageScroller(el) || isComposerOrUserNode(el)) return false;
    const cls = `${el.className || ""} ${el.getAttribute?.("data-testid") || ""}`;
    return /monaco-scrollable|cm-scroller|view-lines|cm-content|canvas|Canvas|ProseMirror/i.test(cls);
  }

  function findScrollers() {
    if (typeof document === "undefined" || !document.querySelectorAll) return [];
    const seen = new Set();
    const nodes = [];
    const add = (el) => {
      if (!el || seen.has(el) || !looksLikeCodeScroller(el)) return;
      const sh = Number(el.scrollHeight) || 0;
      const ch = Number(el.clientHeight) || 0;
      if (sh <= ch + 80 || ch < 40) return;
      seen.add(el);
      nodes.push(el);
    };
    for (const el of document.querySelectorAll(SCROLLER_SELECTOR)) {
      add(el);
      let parent = el.parentElement;
      for (let i = 0; i < 4 && parent; i += 1) {
        add(parent);
        parent = parent.parentElement;
      }
    }
    nodes.sort((a, b) => (Number(b.scrollHeight) || 0) - (Number(a.scrollHeight) || 0));
    return nodes.slice(0, 2);
  }

  function readMountedPanelText() {
    if (typeof document === "undefined" || !document.querySelectorAll) return "";
    let best = "";
    for (const el of document.querySelectorAll(PANEL_SELECTOR)) {
      if (isComposerOrUserNode(el)) continue;
      best = richer(best, elementText(el));
    }
    return best;
  }

  function readScrollerText(scroller) {
    const view =
      (typeof scroller.querySelector === "function" &&
        scroller.querySelector(".view-lines, .cm-content, pre, code")) ||
      scroller;
    return elementText(view);
  }

  function afterScroll() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        setTimeout(resolve, 30);
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(finish);
      setTimeout(finish, 50);
    });
  }

  async function walkScroller(scroller, chunks) {
    const startTop = Number(scroller.scrollTop) || 0;
    const step = Math.max(40, Math.floor((Number(scroller.clientHeight) || 80) * 0.8));
    try {
      scroller.scrollTop = 0;
      let guard = 0;
      let lastTop = -1;
      while (guard < MAX_SCROLL_STEPS) {
        await afterScroll();
        const t = readScrollerText(scroller);
        if (t) chunks.push(t);
        const top = Number(scroller.scrollTop) || 0;
        const height = Number(scroller.scrollHeight) || 0;
        const view = Number(scroller.clientHeight) || 0;
        if (top === lastTop || top + view >= height - 2) break;
        lastTop = top;
        scroller.scrollTop = Math.min(height, top + step);
        guard += 1;
      }
      const height = Number(scroller.scrollHeight) || 0;
      const view = Number(scroller.clientHeight) || 0;
      if ((Number(scroller.scrollTop) || 0) + view < height - 2) {
        scroller.scrollTop = height;
        await afterScroll();
        const endText = readScrollerText(scroller);
        if (endText) chunks.push(endText);
      }
    } finally {
      scroller.scrollTop = startTop;
    }
  }

  async function collectFullResumeDomText() {
    if (inflight) return inflight;
    inflight = (async () => {
      const mounted = readMountedPanelText();
      const scrollers = findScrollers();
      if (!shouldDeepScroll(mounted, scrollers.length)) {
        return { text: mounted, scrolled: false, incomplete: domTextLooksIncomplete(mounted) };
      }
      const chunks = mounted ? [mounted] : [];
      for (const scroller of scrollers) {
        await walkScroller(scroller, chunks);
      }
      const stitched = stitchViewportChunks(chunks);
      const text = richer(mounted, stitched);
      return { text, scrolled: true, incomplete: domTextLooksIncomplete(text) };
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  const api = {
    domTextLooksIncomplete,
    shouldDeepScroll,
    stitchViewportChunks,
    isComposerOrUserNode,
    collectFullResumeDomText
  };
  root.__brightstarDomHarvest = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
