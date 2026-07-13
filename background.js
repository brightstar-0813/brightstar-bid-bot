import { extractName, toResumeHtml } from "./renderer.js";

let isRunning = false;

async function getOpenChatGptTab() {
  const tabs = await chrome.tabs.query({});
  const match = tabs.find(
    (tab) =>
      typeof tab.url === "string" &&
      (tab.url.startsWith("https://chatgpt.com/") || tab.url.startsWith("https://chat.openai.com/"))
  );
  return match || null;
}

async function setStatus(status) {
  await chrome.storage.local.set({ generation_status: status });
}

async function downloadDataUrl(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(downloadId);
      }
    );
  });
}

function extractHtmlFromResponse(responseText) {
  const trimmed = (responseText || "").trim();
  const htmlMatch = trimmed.match(/<!doctype html[\s\S]*<\/html>/i) || trimmed.match(/<html[\s\S]*<\/html>/i);
  if (htmlMatch) return htmlMatch[0];
  return "";
}

function stripTagsToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectResumeName(rawText, html) {
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  if (h1) {
    const clean = h1.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (clean) return extractName(clean);
  }
  return extractName(rawText);
}

function enforceHeaderStructure(html) {
  if (/<h1[\s\S]*?<\/h1>/i.test(html) && /class\s*=\s*["'][^"']*contact[^"']*["']/i.test(html)) {
    return html;
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return html;
  const bodyContent = bodyMatch[1];

  const blocks = Array.from(
    bodyContent.matchAll(/<(p|div|h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi)
  ).map((m) => ({ full: m[0], text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }));

  const meaningful = blocks.filter((b) => b.text);
  if (!meaningful.length) return html;

  const nameText = meaningful[0].text;
  const contactText = meaningful[1]?.text || "";

  let updatedBody = bodyContent;
  updatedBody = updatedBody.replace(meaningful[0].full, "");
  if (meaningful[1]) updatedBody = updatedBody.replace(meaningful[1].full, "");

  const headerHtml = `<div class="top"><h1>${nameText}</h1><p class="contact">${contactText}</p></div>`;
  const rebuilt = `${headerHtml}${updatedBody}`;

  return html.replace(/<body[^>]*>[\s\S]*?<\/body>/i, (m) =>
    m.replace(bodyMatch[1], rebuilt)
  );
}

function splitCombinedRoleHeadlines(html) {
  // Convert:
  // Senior Software Engineer | Uniqcli | Aug 2022 - Present | Chicago Ridge, United States
  // into:
  // Uniqcli Aug 2022 - Present
  // Senior Software Engineer Chicago Ridge, United States
  const pattern =
    /(^|>)([^<\n|]+?)\s*\|\s*([^<\n|]+?)\s*\|\s*([A-Za-z]{3}\s+\d{4}\s*-\s*(?:Present|[A-Za-z]{3}\s+\d{4}))\s*\|\s*([^<\n]+?)(?=<|$)/gim;

  return html.replace(pattern, (_m, prefix, title, company, dates, location) => {
    const c = company.trim();
    const d = dates.trim();
    const t = title.trim();
    const l = location.trim();
    return `${prefix}<p class="role-company">${c} ${d}</p><p class="role-meta">${t} ${l}</p>`;
  });
}

function boldSkillsSection(html) {
  const headingPattern = /<h[1-6][^>]*>\s*SKILLS\s*<\/h[1-6]>/i;
  if (!headingPattern.test(html)) return html;

  return html.replace(
    /(<h[1-6][^>]*>\s*SKILLS\s*<\/h[1-6]>\s*)([\s\S]*?)(?=<h[1-6][^>]*>|\s*$)/i,
    (_m, heading, sectionBody) => {
      const updated = sectionBody
        .replace(/<li([^>]*)>([\s\S]*?)<\/li>/gi, (_li, attrs, content) => {
          if (/<strong[\s>]/i.test(content)) return `<li${attrs}>${content}</li>`;
          return `<li${attrs}><strong>${content.trim()}</strong></li>`;
        })
        .replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (_p, attrs, content) => {
          const textOnly = content.replace(/<[^>]+>/g, "").trim();
          if (!textOnly) return `<p${attrs}>${content}</p>`;
          if (/<strong[\s>]/i.test(content)) return `<p${attrs}>${content}</p>`;
          return `<p${attrs}><strong>${content.trim()}</strong></p>`;
        });
      return `${heading}${updated}`;
    }
  );
}

function normalizeBulletSentence(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return clean;

  const sentence = clean.split(/(?<=[.!?])\s+/)[0].trim();
  let oneSentence = sentence.replace(/[.!?]+$/, "");

  if (oneSentence.length < 170) {
    oneSentence +=
      ", while ensuring production reliability, maintainable architecture, and stable delivery across real-world business workflows";
  }

  if (oneSentence.length > 250) {
    oneSentence = oneSentence.slice(0, 250).replace(/\s+\S*$/, "");
  }

  return `${oneSentence}.`;
}

function enforceBulletLengthAndSentence(html) {
  return html.replace(/<li([^>]*)>([\s\S]*?)<\/li>/gi, (_m, attrs, inner) => {
    const content = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!content) return `<li${attrs}>${inner}</li>`;
    const normalized = normalizeBulletSentence(content);
    return `<li${attrs}>${normalized}</li>`;
  });
}

function enforceA4PrintCss(html) {
  const css = `
@page { size: A4; margin: 10mm; }
html, body { width: 210mm; }
body {
  font-family: "Times New Roman", Times, serif !important;
  font-size: 10.8pt !important;
  line-height: 1.18 !important;
}
h1 {
  text-align: center !important;
  font-size: 22.5pt !important;
  margin: 0 0 3px 0 !important;
}
.top, .header, .contact {
  text-align: center !important;
}
.top { margin-bottom: 5px !important; }
.top .contact { margin: 0 0 2px 0 !important; }
h2, .section-title {
  margin-top: 9px !important;
  margin-bottom: 4px !important;
  padding-bottom: 2px !important;
}
h3, .role-company {
  margin-top: 7px !important;
  margin-bottom: 2px !important;
}
.role-meta {
  margin-top: 0 !important;
  margin-bottom: 6px !important;
}
p, li {
  margin-top: 0 !important;
  margin-bottom: 2.6px !important;
  line-height: 1.18 !important;
  text-align: justify !important;
  text-justify: inter-word !important;
}
ul { margin-top: 0 !important; margin-bottom: 6px !important; }
li { margin-bottom: 3px !important; }
h2 + p, h2 + ul, h2 + div, h2 + h3 { margin-top: 3px !important; }
h3 + p, h3 + ul, .role-meta + p { margin-top: 3px !important; }
.role-meta + ul { margin-top: 10px !important; }
a, a:visited {
  color: #1155cc !important;
  text-decoration: underline !important;
}
`;
  if (/<style[\s\S]*@page\s*\{[\s\S]*size\s*:\s*A4/i.test(html)) {
    return html.replace(/<\/head>/i, `<style>${css}</style></head>`);
  }

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}<style>${css}</style>`);
  }

  return `<!doctype html><html><head><style>${css}</style></head><body>${html}</body></html>`;
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Timed out waiting for render tab."));
    }, timeoutMs);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function debuggerAttach(debuggee) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(debuggee, "1.3", () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function debuggerDetach(debuggee) {
  return new Promise((resolve) => {
    chrome.debugger.detach(debuggee, () => resolve());
  });
}

function debuggerCommand(debuggee, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

async function htmlToPdfBase64(html) {
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab.id) throw new Error("Failed to create render tab.");
  const tabId = tab.id;

  try {
    await waitForTabComplete(tabId);
    const debuggee = { tabId };
    await debuggerAttach(debuggee);
    try {
      await debuggerCommand(debuggee, "Page.enable");
      const result = await debuggerCommand(debuggee, "Page.printToPDF", {
        printBackground: true,
        paperWidth: 8.27,
        paperHeight: 11.69,
        marginTop: 0.4,
        marginBottom: 0.4,
        marginLeft: 0.35,
        marginRight: 0.35,
        preferCSSPageSize: true
      });
      if (!result?.data) throw new Error("PDF generation failed.");
      return result.data;
    } finally {
      await debuggerDetach(debuggee);
    }
  } finally {
    await chrome.tabs.remove(tabId);
  }
}

async function autoDownloadResumeFiles(rawText) {
  const suppliedHtml = extractHtmlFromResponse(rawText);
  const baseHtml = suppliedHtml || toResumeHtml(rawText);
  const normalizedHtml = enforceBulletLengthAndSentence(
    boldSkillsSection(splitCombinedRoleHeadlines(enforceHeaderStructure(baseHtml)))
  );
  const html = enforceA4PrintCss(normalizedHtml);
  const first = detectResumeName(rawText, html);
  const pdfBase64 = await htmlToPdfBase64(html);
  const pdfUrl = `data:application/pdf;base64,${pdfBase64}`;

  await chrome.storage.local.set({
    last_response: rawText,
    last_html: html,
    last_plain_text: stripTagsToText(html)
  });
  await downloadDataUrl(pdfUrl, `${first}.pdf`);
}

async function automateChatGpt(tabId, prompt) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [prompt],
    func: async (fullPrompt) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const clickIfExists = (selectors) => {
        for (const selector of selectors) {
          if (selector.startsWith("text:")) {
            const wanted = selector.slice(5).toLowerCase();
            const btn = Array.from(document.querySelectorAll("button")).find((b) =>
              (b.textContent || "").toLowerCase().includes(wanted)
            );
            if (btn) {
              btn.click();
              return true;
            }
            continue;
          }
          const el = document.querySelector(selector);
          if (el instanceof HTMLElement) {
            el.click();
            return true;
          }
        }
        return false;
      };

      const findInput = () => {
        const selectors = [
          "#prompt-textarea",
          "textarea[placeholder*='Message']",
          "textarea",
          "div[contenteditable='true'][id*='prompt']",
          "div[contenteditable='true']"
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el instanceof HTMLElement) return el;
        }
        return null;
      };

      const setInputValue = (el, text) => {
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          el.focus();
          const prototype =
            el instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
          if (descriptor && typeof descriptor.set === "function") {
            descriptor.set.call(el, text);
          } else {
            el.value = text;
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
        if (el.isContentEditable) {
          el.focus();
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.deleteContents();
          range.collapse(true);
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
          try {
            document.execCommand("insertText", false, text);
          } catch {
            el.textContent = text;
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      };

      const clickSendButton = () => {
        const selectors = [
          "button[data-testid='send-button']",
          "button[aria-label*='Send']",
          "button[aria-label*='send']"
        ];
        for (const selector of selectors) {
          const btn = document.querySelector(selector);
          if (btn instanceof HTMLButtonElement && !btn.disabled) {
            btn.click();
            return true;
          }
        }
        const btnByText = Array.from(document.querySelectorAll("button")).find((b) => {
          const text = (b.textContent || "").trim().toLowerCase();
          return text === "send" && b instanceof HTMLButtonElement && !b.disabled;
        });
        if (btnByText instanceof HTMLButtonElement) {
          btnByText.click();
          return true;
        }
        return false;
      };

      const sendMessage = (el) => {
        if (clickSendButton()) return true;
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
            cancelable: true
          })
        );
        el.dispatchEvent(
          new KeyboardEvent("keypress", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
            cancelable: true
          })
        );
        el.dispatchEvent(
          new KeyboardEvent("keyup", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
            cancelable: true
          })
        );
        return clickSendButton();
      };

      const isGenerating = () => {
        return Boolean(
          document.querySelector("button[aria-label*='Stop']") ||
            Array.from(document.querySelectorAll("button")).some((b) =>
              (b.textContent || "").toLowerCase().includes("stop generating")
            )
        );
      };

      const getLatestAssistant = () => {
        const blocks = document.querySelectorAll("[data-message-author-role='assistant']");
        if (!blocks.length) return "";
        const last = blocks[blocks.length - 1];
        return (last.textContent || "").trim();
      };

      const scrollToLatest = () => {
        const blocks = document.querySelectorAll("[data-message-author-role='assistant']");
        if (blocks.length) {
          blocks[blocks.length - 1].scrollIntoView({ block: "end", inline: "nearest" });
          window.scrollTo(0, document.body.scrollHeight);
          return;
        }
        const main = document.querySelector("main");
        if (main instanceof HTMLElement) {
          main.scrollTop = main.scrollHeight;
        }
        window.scrollTo(0, document.body.scrollHeight);
      };

      clickIfExists(["button[data-testid='new-chat-button']", "text:new chat"]);
      await sleep(500);

      let input = null;
      for (let i = 0; i < 30; i += 1) {
        input = findInput();
        if (input) break;
        await sleep(500);
      }
      if (!input) {
        throw new Error("Cannot find ChatGPT message input box.");
      }

      setInputValue(input, fullPrompt);
      await sleep(250);
      const sent = sendMessage(input);
      if (!sent) {
        throw new Error("Could not trigger send in ChatGPT input.");
      }

      const timeoutMs = 6 * 60 * 1000;
      const start = Date.now();
      let lastText = "";

      while (Date.now() - start < timeoutMs) {
        await sleep(1500);
        scrollToLatest();
        const latest = getLatestAssistant();
        if (latest) lastText = latest;
        if (lastText && !isGenerating()) {
          scrollToLatest();
          return lastText;
        }
      }
      throw new Error("Timed out waiting for ChatGPT response.");
    }
  });

  if (!results?.length) {
    throw new Error("No response from content script.");
  }
  return results[0].result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "reset_generation_state") {
    if (isRunning) {
      sendResponse({ ok: false, error: "Cannot reset while generation is in progress." });
      return undefined;
    }

    (async () => {
      try {
        const tab = await getOpenChatGptTab();
        if (tab?.id) {
          await chrome.tabs.reload(tab.id);
        }
        await chrome.storage.local.set({
          generation_status: "Reset complete. Ready for next run.",
          generation_running: false,
          last_response: ""
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();

    return true;
  }

  if (message?.type !== "start_generation") return undefined;

  if (isRunning) {
    sendResponse({ ok: false, error: "Generation already in progress." });
    return undefined;
  }

  isRunning = true;
  chrome.storage.local.set({ generation_running: true });
  setStatus("Looking for open ChatGPT tab...");

  (async () => {
    try {
      const tab = await getOpenChatGptTab();
      if (!tab || typeof tab.id !== "number") {
        throw new Error("Open ChatGPT in a browser tab first.");
      }

      await setStatus("Sending prompt and waiting for response...");
      const output = await automateChatGpt(tab.id, message.prompt);
      if (!output) throw new Error("Empty model response.");

      await chrome.storage.local.set({
        last_response: output,
        generation_running: false
      });
      await setStatus("Generating PDF...");
      await autoDownloadResumeFiles(output);
      await setStatus("Resume generated and downloaded: .pdf");
      sendResponse({ ok: true });
    } catch (err) {
      await chrome.storage.local.set({ generation_running: false });
      await setStatus(`Generation failed: ${String(err?.message || err)}`);
      sendResponse({ ok: false, error: String(err?.message || err) });
    } finally {
      isRunning = false;
    }
  })();

  return true;
});
