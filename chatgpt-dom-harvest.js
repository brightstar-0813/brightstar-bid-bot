/**
 * Read resume JSON from a ChatGPT canvas or virtualized code panel.
 * Classic script: content.js and chrome.scripting.executeScript share
 * globalThis.__brightstarDomHarvest. No import/export (injected files are classic).
 */
(function (root) {
  const TEXT_CAP = 400000;
  const MAX_SCROLL_STEPS = 20;
  const MAX_OVERLAP_LINES = 200;
  const USER_SELECTOR = [
    "[data-message-author-role='user']",
    "[data-message-author-role=user]",
    "[data-message-role='user']",
    "[data-message-role=user]",
    "[data-turn='user']",
    "[data-testid*='user-message']"
  ].join(", ");
  const ASSISTANT_SELECTOR = [
    "[data-message-author-role='assistant']",
    "[data-message-author-role=assistant]",
    "[data-message-role='assistant']",
    "[data-message-role=assistant]",
    "[data-turn='assistant']",
    "section[data-turn='assistant']",
    "[data-testid='assistant-message']",
    "[data-testid='assistant']",
    "[data-is-streaming]",
    "[class*='assistant-message']",
    "[class*='font-claude-message']"
  ].join(", ");
  const TURN_SELECTOR = "article[data-testid^='conversation-turn'], [data-testid^='conversation-turn']";
  const SKIP_SELECTOR = [
    "#prompt-textarea",
    "textarea",
    "[data-testid='composer']",
    "[data-testid*='composer']",
    USER_SELECTOR
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
      const turns = el.querySelectorAll(ASSISTANT_SELECTOR);
      if (turns.length > 1) return true;
    }
    return false;
  }

  function looksLikeJsonFragment(text) {
    const t = String(text || "");
    if (!t.includes("{") && !t.includes('"')) return false;
    const complete =
      (t.includes('"name"') || t.includes('"Name"')) &&
      (t.includes('"experience"') || t.includes('"Experience"'));
    if (complete) return false;
    return (
      t.includes('"bullets"') ||
      t.includes('"Bullets"') ||
      t.includes('"company"') ||
      t.includes('"title"') ||
      /^\s*\{/.test(t)
    );
  }

  function looksLikeCodeScroller(el) {
    if (!el || isPageScroller(el) || isComposerOrUserNode(el)) return false;
    const cls = `${el.className || ""} ${el.getAttribute?.("data-testid") || ""}`;
    if (/monaco-scrollable|cm-scroller|view-lines|cm-content|canvas|Canvas|ProseMirror/i.test(cls)) {
      return true;
    }
    const sh = Number(el.scrollHeight) || 0;
    const ch = Number(el.clientHeight) || 0;
    if (sh <= ch + 80 || ch < 40) return false;
    return looksLikeJsonFragment(elementText(el));
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

  function docRoot(doc) {
    if (doc && typeof doc.querySelectorAll === "function") return doc;
    if (typeof document !== "undefined") return document;
    return null;
  }

  function queryAll(doc, selector) {
    const root = docRoot(doc);
    if (!root) return [];
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function isUserElement(el) {
    if (!el || typeof el.getAttribute !== "function") return false;
    const role = `${el.getAttribute("data-message-author-role") || ""} ${el.getAttribute("data-message-role") || ""} ${el.getAttribute("data-turn") || ""}`.toLowerCase();
    if (/\buser\b/.test(role)) return true;
    const testid = String(el.getAttribute("data-testid") || "").toLowerCase();
    return testid.includes("user-message") || testid === "user";
  }

  function plainText(el) {
    if (!el) return "";
    return tidyChunk(el.innerText || el.textContent || "");
  }

  function readElementProse(el, { stripCode = false } = {}) {
    if (!el || typeof el.cloneNode !== "function") return plainText(el);
    let clone;
    try {
      clone = el.cloneNode(true);
    } catch {
      return elementText(el);
    }
    if (clone && typeof clone.querySelectorAll === "function") {
      clone.querySelectorAll(USER_SELECTOR).forEach((node) => {
        try {
          node.remove();
        } catch {
          /* ignore */
        }
      });
      clone.querySelectorAll("#prompt-textarea, textarea, [data-testid*='composer']").forEach((node) => {
        try {
          node.remove();
        } catch {
          /* ignore */
        }
      });
      if (stripCode) {
        clone.querySelectorAll("pre, code, button, [data-is-streaming]").forEach((node) => {
          try {
            node.remove();
          } catch {
            /* ignore */
          }
        });
      }
    }
    return plainText(clone);
  }

  function proseLooksLikeLetter(text) {
    const s = String(text || "")
      .replace(/The\s*ChatGPT can make mistakes\.?/gi, "")
      .replace(/ChatGPT can make mistakes\.?/gi, "")
      .replace(/Check important info\.?/gi, "")
      .replace(/Latest\s*response/gi, "")
      .replace(/Thinking\s*effort/gi, "")
      .replace(/(^|[\s,])Instant\b/g, "$1")
      .trim();
    if (/ChatGPT can make mistakes|Check important info|Latest response|Thinking effort/i.test(s)) return false;
    if (/"experience"\s*:/.test(s) && /"technicalSummary"|"certifications"\s*:/.test(s)) return false;
    if (/^\s*\{/.test(s) && /"name"\s*:/.test(s)) return false;
    if (/OUTPUT RULES|MASTER RESUME|Return PLAIN TEXT only|Do NOT return JSON/i.test(s)) return false;
    let paras = s
      .split(/\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 40 && !/^dear\s+/i.test(p));
    if (paras.length < 2) {
      paras = s
        .split(/(?<=[.!?])\s+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 40 && !/^dear\s+/i.test(p));
    }
    const bodyLen = paras.reduce((n, p) => n + p.length, 0);
    if (paras.length < 2 || bodyLen < 160) return false;
    return /thank you|consideration|welcome the opportunity|i would welcome|happy to discuss/i.test(s.slice(-600));
  }

  function remainderAfterKnownTurns(turn) {
    if (!turn || typeof turn.cloneNode !== "function") return "";
    let clone;
    try {
      clone = turn.cloneNode(true);
    } catch {
      return "";
    }
    if (!clone || typeof clone.querySelectorAll !== "function") return "";
    clone.querySelectorAll(`${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`).forEach((node) => {
      try {
        node.remove();
      } catch {
        /* ignore */
      }
    });
    return readElementProse(clone, { stripCode: false });
  }

  /**
   * Assistant turns on the current ChatGPT UI.
   * A conversation turn that also contains the user prompt is kept:
   * the user bubble is stripped when the text is read.
   */
  function assistantTurnNodes(doc) {
    const seen = new Set();
    const out = [];
    const add = (el) => {
      if (!el || seen.has(el) || isUserElement(el)) return;
      seen.add(el);
      out.push(el);
    };
    for (const el of queryAll(doc, ASSISTANT_SELECTOR)) add(el);
    for (const turn of queryAll(doc, TURN_SELECTOR)) {
      const assistant = typeof turn.querySelector === "function" ? turn.querySelector(ASSISTANT_SELECTOR) : null;
      if (assistant) add(assistant);
      else add(turn);
    }
    return out;
  }

  function collectAssistantTexts(doc) {
    const texts = [];
    const push = (raw) => {
      const t = tidyChunk(raw);
      if (t.length > 40) texts.push(t.slice(0, 400000));
    };
    const assistants = queryAll(doc, ASSISTANT_SELECTOR).filter((el) => !isUserElement(el));
    for (const el of assistants) push(readElementProse(el, { stripCode: false }));
    for (const turn of queryAll(doc, TURN_SELECTOR)) {
      const assistant =
        typeof turn.querySelector === "function" ? turn.querySelector(ASSISTANT_SELECTOR) : null;
      if (!assistant) push(readElementProse(turn, { stripCode: false }));
      else push(remainderAfterKnownTurns(turn));
    }
    const hasResume = texts.some(
      (t) => t.includes('"experience"') || t.includes('"Experience"') || t.includes('"name"') || t.includes('"Name"')
    );
    if (!hasResume) push(mainTextExcludingUser(doc));
    return texts;
  }

  function mainTextExcludingUser(doc) {
    const root = docRoot(doc);
    if (!root) return "";
    const main =
      (typeof root.querySelector === "function" && root.querySelector("main")) || root.body || root;
    return readElementProse(main, { stripCode: false });
  }

  function pageHasResumeMarkers(doc) {
    return collectAssistantTexts(doc).some((t) =>
      /"experience"|"Experience"|"name"|"Name"|"bullets"|"Bullets"/.test(t)
    );
  }

  function countChatBlocks(doc) {
    const root = docRoot(doc);
    if (!root) return { assistantBlocks: 0, userBlocks: 0 };
    let assistantBlocks = queryAll(root, ASSISTANT_SELECTOR).filter((el) => !isUserElement(el)).length;
    const userBlocks = queryAll(root, USER_SELECTOR).length;
    if (assistantBlocks < 1) {
      assistantBlocks = assistantTurnNodes(root).filter(
        (el) => readElementProse(el, { stripCode: false }).length > 40
      ).length;
    }
    return { assistantBlocks, userBlocks };
  }

  /**
   * Newest letter-like assistant prose, else the newest non-empty reply.
   * Prefers a finished letter over a shorter retry that is still streaming,
   * and over the resume JSON turn.
   */
  function readNewestAssistantProse(doc) {
    const promptEcho = /OUTPUT RULES|MASTER RESUME|Return PLAIN TEXT only|Do NOT return JSON/i;
    const pieces = [];
    const turns = queryAll(doc, TURN_SELECTOR);
    if (turns.length) {
      for (const turn of turns) {
        const assistant =
          typeof turn.querySelector === "function" ? turn.querySelector(ASSISTANT_SELECTOR) : null;
        if (assistant) pieces.push(readElementProse(assistant, { stripCode: true }));
        const rest = remainderAfterKnownTurns(turn);
        if (rest) pieces.push(rest);
        if (!assistant) pieces.push(readElementProse(turn, { stripCode: true }));
      }
    } else {
      for (const el of assistantTurnNodes(doc)) pieces.push(readElementProse(el, { stripCode: true }));
    }
    if (!pieces.some((t) => proseLooksLikeLetter(t))) {
      const mainText = mainTextExcludingUser(doc);
      if (mainText) pieces.push(mainText);
    }
    const tailOf = (text) => {
      const t = tidyChunk(text);
      if (t.length <= 20000) return t;
      return t.slice(-60000);
    };
    let bestLetter = "";
    let newest = "";
    for (const raw of pieces) {
      const text = tidyChunk(raw);
      if (!text) continue;
      // A turn that also contains the cover prompt still has the letter at the end.
      // Do not drop that whole turn.
      if (promptEcho.test(text)) {
        newest = tailOf(text);
        continue;
      }
      newest = text;
      if (proseLooksLikeLetter(text) && text.length >= bestLetter.length) bestLetter = text;
    }
    if (bestLetter) return bestLetter.slice(0, 20000);
    return tailOf(newest);
  }

  const api = {
    domTextLooksIncomplete,
    shouldDeepScroll,
    stitchViewportChunks,
    isComposerOrUserNode,
    looksLikeCodeScroller,
    looksLikeJsonFragment,
    collectFullResumeDomText,
    collectAssistantTexts,
    pageHasResumeMarkers,
    countChatBlocks,
    readNewestAssistantProse,
    proseLooksLikeLetter
  };
  root.__brightstarDomHarvest = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
