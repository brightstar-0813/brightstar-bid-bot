import { appendJobToSpreadsheet } from "./sheets.js";
import {
  buildCoverLetterPrompt,
  buildPrompt,
  getActivePerson,
  getAutofillContact
} from "./profiles.js";
import { resumeJsonToHtml, extractResumeJson, isUsableResumeJson, looksLikeSchemaPlaceholderResume } from "./resume-json.js";
import { DEFAULT_TEMPLATE_ID } from "./templates/index.js";

const QUEUE_KEY = "job_queue";
const BATCH_STATE_KEY = "batch_state";
const APPLY_HISTORY_KEY = "apply_history";

const JSON_RETRY_PROMPT = `Your previous reply was not usable (it looked like a schema stub or incomplete JSON). Return ONLY one complete valid resume JSON object with REAL tailored content.

Rules:
- No markdown, no code fences, no commentary before or after the JSON
- Start with { and end with }
- Include filled: name, headline, location, phone, email, linkedin, profile (4–6 real sentences), technicalSummary (6–10 real bullets), education, ALL certifications from the source list, skills (multiple categories), experience (all 4 employers with full bullet counts)
- NEVER output placeholder text such as "One summary paragraph", "One sentence bullet", "tailored to the JD", or "One realistic project name"
- Finish the entire JSON in one message. Do not ask clarifying questions.

Output JSON now.`;

function describeUnusableResume(rawText, data) {
  const preview = String(rawText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  if (!data || typeof data !== "object") {
    if (/^\s*\{/.test(String(rawText || "").trim())) {
      return `ChatGPT JSON was truncated/incomplete and could not be repaired. Preview: "${preview}${preview.length >= 160 ? "…" : ""}"`;
    }
    return `ChatGPT did not return resume JSON (got text/HTML instead). Preview: "${preview}${preview.length >= 160 ? "…" : ""}"`;
  }
  if (looksLikeSchemaPlaceholderResume(data)) {
    return `ChatGPT returned schema placeholder text instead of a filled resume (e.g. "One summary paragraph…"). Retry the job after reload. Preview: "${preview}${preview.length >= 160 ? "…" : ""}"`;
  }
  const missing = [];
  if (!String(data.name || "").trim()) missing.push("name");
  if (!String(data.profile || "").trim() || String(data.profile).length < 120) missing.push("profile");
  if (!Array.isArray(data.experience) || data.experience.length < 3) missing.push("experience(≥3)");
  const bullets = Array.isArray(data.experience)
    ? data.experience.reduce(
        (n, j) => n + (Array.isArray(j?.bullets) ? j.bullets.filter(Boolean).length : 0),
        0
      )
    : 0;
  if (bullets < 12) missing.push(`bullets(${bullets}<12)`);
  if (!Array.isArray(data.skills) || data.skills.length < 3) missing.push("skills");
  if (!Array.isArray(data.certifications) || data.certifications.length < 3) missing.push("certifications");
  if (missing.length) {
    return `Resume JSON incomplete (${missing.join(", ")}). Preview: "${preview}${preview.length >= 160 ? "…" : ""}"`;
  }
  return `Resume JSON not usable. Preview: "${preview}${preview.length >= 160 ? "…" : ""}"`;
}
let isRunning = false;
let keepAliveTimer = null;
let batchControl = {
  pauseAfterCurrent: false,
  skipCurrent: false,
  stop: false
};

function startKeepAlive() {
  stopKeepAlive();
  // MV3 service workers can sleep during long ChatGPT waits; ping storage periodically.
  keepAliveTimer = setInterval(() => {
    chrome.storage.local.set({ generation_heartbeat: Date.now() }).catch(() => {});
  }, 15000);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function safeSendResponse(sendResponse, payload) {
  try {
    sendResponse(payload);
  } catch {
    // Popup may have closed; status is already in storage.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  isRunning = false;
  stopKeepAlive();
  recoverInterruptedBatch("Ready.");
});

chrome.runtime.onStartup.addListener(() => {
  isRunning = false;
  stopKeepAlive();
  recoverInterruptedBatch("Ready.");
});

async function recoverInterruptedBatch(statusMessage = "Ready.") {
  try {
    const data = await chrome.storage.local.get([QUEUE_KEY, BATCH_STATE_KEY, "generation_running"]);
    const queue = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
    let changed = false;
    const next = queue.map((j) => {
      if (j.status === "running") {
        changed = true;
        return { ...j, status: "pending", error: "Interrupted — click Start to retry" };
      }
      return j;
    });
    const patch = {
      generation_running: false,
      generation_status: statusMessage,
      [BATCH_STATE_KEY]: "idle"
    };
    if (changed) patch[QUEUE_KEY] = next;
    await chrome.storage.local.set(patch);
  } catch {
    await chrome.storage.local.set({
      generation_running: false,
      generation_status: statusMessage,
      [BATCH_STATE_KEY]: "idle"
    });
  }
}

function isChatGptUrl(url) {
  return (
    typeof url === "string" &&
    (url.startsWith("https://chatgpt.com/") || url.startsWith("https://chat.openai.com/"))
  );
}

async function getOpenChatGptTab() {
  const tabs = await chrome.tabs.query({});
  const chatTabs = tabs.filter((tab) => isChatGptUrl(tab.url) && typeof tab.id === "number");
  if (!chatTabs.length) return null;

  // Prefer the ChatGPT tab the user is actually looking at, then the most
  // recently used one, so the prompt lands in the expected tab.
  chatTabs.sort((a, b) => {
    if (!!b.active !== !!a.active) return (b.active ? 1 : 0) - (a.active ? 1 : 0);
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });
  return chatTabs[0];
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
        saveAs: false,
        conflictAction: "uniquify"
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

/** data: URLs have size limits — keep JD downloads under a safe ceiling. */
function downloadTextFile(text, mimeType, filename) {
  let body = String(text || "");
  const maxChars = 400000;
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars)}\n\n---\n[Truncated for download size limit]\n`;
  }
  const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(body)}`;
  return downloadDataUrl(url, filename);
}

function downloadBase64File(base64, mimeType, filename) {
  const url = `data:${mimeType};base64,${base64}`;
  return downloadDataUrl(url, filename);
}

function sanitizePathSegment(value, fallback = "untitled") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

function joinDownloadPath(...parts) {
  return parts
    .map((part) => String(part || "").replace(/^\/+|\/+$/g, "").replace(/\\/g, "/"))
    .filter(Boolean)
    .join("/");
}

function buildJdTxtContent({ jobTitle, companyName, jdLink, jdText }) {
  return [
    `Job Title: ${jobTitle || ""}`,
    `Company: ${companyName || ""}`,
    `JD Link: ${jdLink || ""}`,
    "",
    "---",
    "",
    jdText || ""
  ].join("\n");
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

/** Keep bullets as authored — do not pad or truncate GPT content. */
function enforceBulletLengthAndSentence(html) {
  return html;
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
  color: #000 !important;
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
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      finish(new Error("Timed out waiting for render tab."));
    }, timeoutMs);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    // data: URLs often finish loading before the listener is attached.
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab?.status === "complete") finish();
      })
      .catch((err) => finish(err instanceof Error ? err : new Error(String(err))));
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
    // Give layout/fonts a brief moment after "complete".
    await new Promise((resolve) => setTimeout(resolve, 250));
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
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // tab may already be closed
    }
  }
}

// MV3 service workers have no URL.createObjectURL / Blob URL support,
// so all downloads use data: URLs (see downloadTextFile / downloadBase64File above).

function buildJobFolderName(jobMeta = {}) {
  const companyPart = String(jobMeta.companyName || "").trim() || "Company";
  const titlePart = String(jobMeta.jobTitle || "").trim() || "untitled-job";
  const csvRow = jobMeta.csvRow;
  if (csvRow != null && csvRow !== "" && !Number.isNaN(Number(csvRow))) {
    return sanitizePathSegment(`${Number(csvRow)} - ${companyPart} - ${titlePart}`, "untitled-job");
  }
  return sanitizePathSegment(`${companyPart} - ${titlePart}`, "untitled-job");
}

/** First-name token for files like Matthew_Resume.pdf / Matthew_Cover Letter.pdf */
function outputNameToken(jobMeta = {}, resumeData = {}) {
  const prefix = String(jobMeta.resumeFilePrefix || "").trim();
  if (prefix) {
    const cleaned = prefix.replace(/_?(Resume|resume)$/i, "").replace(/_+$/, "");
    if (cleaned) return sanitizePathSegment(cleaned, "Applicant");
  }
  const full = String(resumeData?.name || jobMeta.personName || "Applicant").trim();
  const first = full.split(/\s+/)[0] || "Applicant";
  return sanitizePathSegment(first, "Applicant");
}

async function autoDownloadResumeFiles(rawText, resumeData, jobMeta = {}) {
  // Developer Style (Times Classic) matches Matthew's Senior Developer master resume.
  const templateId = jobMeta.templateId || "times-classic";
  const outputDir = sanitizePathSegment(jobMeta.outputDir || "Resume Applications", "Resume Applications");
  const jobFolder = buildJobFolderName(jobMeta);
  const jobDir = joinDownloadPath(outputDir, jobFolder);
  const nameToken = outputNameToken(jobMeta, resumeData);
  const resumePdfName = `${nameToken}_Resume.pdf`;

  const jdTxt = buildJdTxtContent({
    jobTitle: jobMeta.jobTitle || "",
    companyName: jobMeta.companyName || "",
    jdLink: jobMeta.jdLink || "",
    jdText: jobMeta.jdText || ""
  });

  const saved = { jd: false, pdf: false, pdfError: "", resumePdfName, nameToken };

  await setStatus(`Saving jd.txt → Downloads / ${jobDir}`);
  try {
    await downloadTextFile(jdTxt, "text/plain", joinDownloadPath(jobDir, "jd.txt"));
    saved.jd = true;
  } catch (err) {
    throw new Error(`Failed to save jd.txt: ${String(err?.message || err)}`);
  }

  let html = "";
  try {
    html = resumeJsonToHtml(resumeData, templateId);
  } catch (err) {
    throw new Error(`Resume HTML render failed: ${String(err?.message || err)}`);
  }

  await setStatus(`Saving ${resumePdfName} → Downloads / ${jobDir}`);
  try {
    const pdfBase64 = await htmlToPdfBase64(html);
    await downloadBase64File(pdfBase64, "application/pdf", joinDownloadPath(jobDir, resumePdfName));
    saved.pdf = true;
  } catch (err) {
    saved.pdfError = `${resumePdfName} failed (Allow debugger if Chrome prompts): ${String(err?.message || err)}`;
    throw new Error(saved.pdfError);
  }

  try {
    await chrome.storage.local.set({
      last_response: String(rawText || "").slice(0, 200000),
      last_resume_json: resumeData,
      last_output_dir: jobDir
    });
  } catch {
    // ignore
  }

  return { jobDir, resumeFilePrefix: `${nameToken}_Resume`, nameToken, resumePdfName, saved };
}

function coverLetterTextToParagraphs(raw) {
  let s = String(raw || "");

  // If ChatGPT returned HTML anyway, convert block boundaries to newlines, then strip tags.
  if (/<\/?[a-z][^>]*>/i.test(s)) {
    s = s
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*(p|div|h[1-6]|li|section|article)\s*>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  // Strip markdown code fences if present.
  s = s.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "");

  return s
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

function cleanCoverLetterParagraphs(paragraphs, name) {
  const nameLc = String(name || "").toLowerCase().trim();
  const firstNameLc = nameLc.split(/\s+/)[0] || "";
  const closingRe = /^(sincerely|regards|best regards|kind regards|warm regards|best|respectfully|thank you)\b[,.]?$/i;

  return paragraphs.filter((p) => {
    const lc = p.toLowerCase().trim();
    if (!lc) return false;
    if (closingRe.test(lc)) return false; // local signature adds this
    if (nameLc && lc === nameLc) return false; // trailing full-name line
    if (firstNameLc && lc === firstNameLc) return false; // trailing first-name line
    if (/^(email|phone|linkedin|mobile|tel)\s*:/i.test(p)) return false; // contact echoes
    return true;
  });
}

// Replace every markdown link `[text](url)` with its destination URL.
function stripMarkdownLink(value) {
  return String(value || "")
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_match, _text, url) => url)
    .trim();
}

function buildCoverLetterHtml(rawText, contact = {}) {
  const esc = (v) =>
    String(v || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const name = String(contact.name || "Matthew Dale Hoffman").trim();
  const title = String(contact.signatureTitle || contact.headline || "Salesforce Developer").trim();
  const email = stripMarkdownLink(contact.email || "matthew.dale.hoffman0513@outlook.com")
    .replace(/^mailto:/i, "")
    .trim();
  let phone = String(contact.phone || "(254) 708-9742")
    .replace(/^\+1\s*/i, "")
    .trim();
  if (!phone) phone = "(254) 708-9742";
  let linkedin = stripMarkdownLink(
    contact.linkedin || "https://www.linkedin.com/in/hoffmantxstate/"
  ).trim();
  if (linkedin && !/^https?:\/\//i.test(linkedin)) linkedin = `https://${linkedin}`;
  if (linkedin && !/\/$/.test(linkedin)) linkedin = `${linkedin}/`;

  const paragraphs = cleanCoverLetterParagraphs(coverLetterTextToParagraphs(rawText), name);
  const bodyHtml = paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n");

  // No top header — signature matches:
  // Matthew Dale Hoffman / Salesforce Developer / ✉️ 📞 🌐
  const signatureLines = [
    `<p>Sincerely,</p>`,
    `<p class="cl-name-sign">${esc(name)}</p>`,
    `<p class="cl-sign-title">${esc(title)}</p>`,
    `<p class="cl-sign-line">✉️ <a href="mailto:${esc(email)}">${esc(email)}</a></p>`,
    `<p class="cl-sign-line">📞 ${esc(phone)}</p>`,
    `<p class="cl-sign-line">🌐 <a href="${esc(linkedin)}">${esc(linkedin)}</a></p>`
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 18mm; }
  body {
    font-family: "Times New Roman", Times, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif;
    font-size: 11pt;
    line-height: 1.45;
    color: #000;
    margin: 0;
  }
  p { margin: 0 0 12px 0; text-align: justify; }
  a, a:visited { color: #000; text-decoration: underline; }
  .signature { margin-top: 6px; }
  .signature p { margin: 0 0 2px 0; text-align: left; }
  .signature .cl-name-sign { font-weight: 700; margin-top: 10px; }
  .signature .cl-sign-title { margin-bottom: 4px; }
  .signature .cl-sign-line { font-size: 10.5pt; }
</style>
</head>
<body>
  ${bodyHtml}
  <div class="signature">
    ${signatureLines.join("\n    ")}
  </div>
</body>
</html>`;
}

async function autoDownloadCoverLetterPdf(rawText, jobDir, contact = {}, nameToken = "Applicant") {
  const plain = String(rawText || "").trim();
  const token = sanitizePathSegment(nameToken || "Applicant", "Applicant");
  const coverPdfName = `${token}_Cover Letter.pdf`;
  try {
    const html = buildCoverLetterHtml(rawText, contact);
    const pdfBase64 = await htmlToPdfBase64(html);
    await chrome.storage.local.set({
      last_cover_letter_response: plain.slice(0, 100000)
    }).catch(() => {});
    await downloadBase64File(
      pdfBase64,
      "application/pdf",
      joinDownloadPath(jobDir, coverPdfName)
    );
    return { pdf: true, coverPdfName };
  } catch (err) {
    throw new Error(
      `${coverPdfName} failed (Allow debugger if Chrome prompts): ${String(err?.message || err)}`
    );
  }
}

async function focusTabForInput(tabId) {
  // ChatGPT's ProseMirror composer only accepts execCommand/paste insertion
  // when its tab is the active, focused tab. Bring it to the foreground first.
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && typeof tab.windowId === "number") {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
    // Give the page a moment to regain focus before we type into it.
    await new Promise((resolve) => setTimeout(resolve, 250));
  } catch {
    // Best-effort focusing; injection below still attempts insertion.
  }
}

async function chatgptSendPrompt(tabId, prompt, startNewChat) {
  await focusTabForInput(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [prompt, startNewChat],
    func: async (fullPrompt, shouldStartNewChat) => {
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
          "div.ProseMirror[contenteditable='true']",
          "div[contenteditable='true'][data-placeholder]",
          "textarea[placeholder*='Message']",
          "textarea[name='prompt-textarea']",
          "textarea",
          "div[contenteditable='true']"
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el instanceof HTMLElement && el.offsetParent !== null) return el;
        }
        return null;
      };

      const firePointerClick = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const opts = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1, pointerType: "mouse" }));
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1, pointerType: "mouse" }));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));
        if (typeof el.click === "function") el.click();
        return true;
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
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
        if (el.isContentEditable) {
          el.focus();

          // Clear existing content first.
          try {
            document.execCommand("selectAll", false);
            document.execCommand("delete", false);
          } catch {
            // ignore
          }

          // 1) Preferred: simulate paste (ProseMirror handles this and enables Send).
          let inserted = false;
          try {
            const dt = new DataTransfer();
            dt.setData("text/plain", text);
            const pasteEvent = new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData: dt
            });
            inserted = el.dispatchEvent(pasteEvent) === false ||
              (el.innerText || el.textContent || "").trim().length > 0;
            // dispatchEvent returns false if prevented; ChatGPT often prevents default and inserts.
            inserted = (el.innerText || el.textContent || "").trim().length > 20;
          } catch {
            inserted = false;
          }

          // 2) insertText — also updates ProseMirror / enables Send.
          if (!inserted) {
            try {
              inserted = document.execCommand("insertText", false, text);
            } catch {
              inserted = false;
            }
            inserted = inserted || (el.innerText || el.textContent || "").trim().length > 20;
          }

          // 3) beforeinput + insertText InputEvent
          if (!inserted) {
            try {
              el.dispatchEvent(
                new InputEvent("beforeinput", {
                  bubbles: true,
                  cancelable: true,
                  inputType: "insertText",
                  data: text
                })
              );
              el.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  cancelable: true,
                  inputType: "insertText",
                  data: text
                })
              );
              inserted = (el.innerText || el.textContent || "").trim().length > 20;
            } catch {
              inserted = false;
            }
          }

          // 4) Last resort: DOM write (may leave Send disabled — we force-click later).
          if (!inserted && !(el.innerText || el.textContent || "").trim()) {
            el.innerHTML = "";
            for (const line of String(text).split("\n")) {
              const p = document.createElement("p");
              p.textContent = line || "\u00a0";
              el.appendChild(p);
            }
            el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
          }
        }
      };

      const inputHasText = (el) => {
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          return (el.value || "").trim().length > 0;
        }
        return (el.innerText || el.textContent || "").trim().length > 0;
      };

      const findSendButton = () => {
        const selectors = [
          "button[data-testid='send-button']",
          "button[data-testid='composer-send-button']",
          "#composer-submit-button",
          "button[aria-label='Send message']",
          "button[aria-label*='Send message']",
          "button[aria-label='Send']",
          "button[aria-label*='Send']",
          "button[aria-label*='send']",
          "form button[type='submit']"
        ];
        for (const selector of selectors) {
          const btn = document.querySelector(selector);
          if (btn instanceof HTMLButtonElement) return btn;
        }

        // Composer area: nearest button with an upward arrow SVG after the prompt box.
        const composer =
          document.querySelector("#prompt-textarea")?.closest("form") ||
          document.querySelector("form") ||
          document.querySelector("[class*='composer']") ||
          document.body;

        const buttons = Array.from(composer.querySelectorAll("button"));
        const byAria = buttons.find((b) => {
          const label = `${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""}`.toLowerCase();
          return label.includes("send") && !label.includes("stop");
        });
        if (byAria instanceof HTMLButtonElement) return byAria;

        // Black circular send control is usually the last enabled-looking icon button in the composer.
        const iconButtons = buttons.filter((b) => {
          const label = `${b.getAttribute("aria-label") || ""}`.toLowerCase();
          if (label.includes("stop") || label.includes("attach") || label.includes("dictat") || label.includes("voice") || label.includes("mic")) {
            return false;
          }
          return Boolean(b.querySelector("svg"));
        });
        const lastIcon = iconButtons[iconButtons.length - 1];
        if (lastIcon instanceof HTMLButtonElement) return lastIcon;

        return null;
      };

      const isSendEnabled = (btn) => {
        if (!(btn instanceof HTMLButtonElement)) return false;
        if (btn.disabled) return false;
        if (btn.getAttribute("aria-disabled") === "true") return false;
        if (btn.hasAttribute("disabled")) return false;
        const cls = btn.className || "";
        if (/\bdisabled\b/i.test(cls) && btn.disabled) return false;
        return true;
      };

      const clickSendButton = ({ force = false } = {}) => {
        const btn = findSendButton();
        if (!btn) return false;
        if (!force && !isSendEnabled(btn)) return false;
        // Remove disabled briefly if force (last resort after text is clearly present).
        if (force && btn.disabled) {
          btn.disabled = false;
          btn.removeAttribute("disabled");
          btn.setAttribute("aria-disabled", "false");
        }
        firePointerClick(btn);
        return true;
      };

      const pressEnterToSend = (el) => {
        const opts = {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          composed: true
        };
        el.dispatchEvent(new KeyboardEvent("keydown", opts));
        el.dispatchEvent(new KeyboardEvent("keypress", opts));
        el.dispatchEvent(new KeyboardEvent("keyup", opts));
      };

      const sendMessage = (el, { force = false } = {}) => {
        if (clickSendButton({ force })) return true;
        pressEnterToSend(el);
        if (clickSendButton({ force })) return true;
        // Some ChatGPT builds send on Ctrl/Meta+Enter
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true,
            ctrlKey: true,
            metaKey: true
          })
        );
        return clickSendButton({ force });
      };

      const composerLooksIdleAfterSend = (el) => {
        // After a successful send, the composer usually clears (or shrinks a lot).
        const text = (el.innerText || el.textContent || el.value || "").trim();
        return text.length < 30;
      };

      const getAssistantBlocks = () =>
        Array.from(document.querySelectorAll("[data-message-author-role='assistant']"));

      const scorePayload = (text) => {
        const t = String(text || "");
        let score = t.length;
        if (t.includes('"experience"')) score += 100000;
        if (t.includes('"certifications"')) score += 50000;
        if (t.includes('"profile"')) score += 25000;
        return score;
      };

      const readAssistantBlock = (block) => {
        if (!block) return "";
        const candidates = [];
        for (const pre of block.querySelectorAll("pre")) {
          const text = (pre.innerText || pre.textContent || "").trim();
          if (text) candidates.push(text);
        }
        for (const code of block.querySelectorAll("pre code")) {
          const text = (code.innerText || code.textContent || "").trim();
          if (text) candidates.push(text);
        }
        if (candidates.length) {
          candidates.sort((a, b) => scorePayload(b) - scorePayload(a));
          return candidates[0];
        }
        return (block.innerText || block.textContent || "").trim();
      };

      if (shouldStartNewChat) {
        clickIfExists([
          "button[data-testid='new-chat-button']",
          "a[href='/']",
          "text:new chat"
        ]);
        await sleep(1200);
      }

      const blocks = getAssistantBlocks();
      const blocksBefore = blocks.length;
      const latestBefore = blocks.length ? readAssistantBlock(blocks[blocks.length - 1]) : "";

      let input = null;
      for (let i = 0; i < 40; i += 1) {
        input = findInput();
        if (input) break;
        await sleep(500);
      }
      if (!input) {
        throw new Error("Cannot find ChatGPT message input box.");
      }

      let filled = false;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        input.focus();
        await sleep(150);
        setInputValue(input, fullPrompt);
        await sleep(500);
        input = findInput() || input;
        if (inputHasText(input)) {
          filled = true;
          break;
        }
      }
      if (!filled) {
        throw new Error(
          "Prompt text did not appear in the ChatGPT input. Keep the ChatGPT tab visible and try again."
        );
      }

      // Wait for Send to enable (ProseMirror needs a moment after paste).
      let sent = false;
      for (let i = 0; i < 40; i += 1) {
        const btn = findSendButton();
        if (btn && isSendEnabled(btn)) {
          sent = sendMessage(input, { force: false });
          if (sent) {
            await sleep(400);
            if (composerLooksIdleAfterSend(findInput() || input)) break;
            // Click registered but composer still full — try again / force.
            sent = false;
          }
        } else {
          // Nudge the editor so ChatGPT enables Send.
          input = findInput() || input;
          input.focus();
          input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: " " }));
          await sleep(250);
        }
        if (i > 0 && i % 8 === 0) {
          sent = sendMessage(input, { force: false });
          if (sent) {
            await sleep(400);
            if (composerLooksIdleAfterSend(findInput() || input)) break;
            sent = false;
          }
        }
        await sleep(250);
      }

      // Last resort: force-click the send control even if still marked disabled.
      if (!sent || !composerLooksIdleAfterSend(findInput() || input)) {
        input = findInput() || input;
        sent = sendMessage(input, { force: true });
        await sleep(600);
        if (!composerLooksIdleAfterSend(findInput() || input)) {
          // One more hard click on whatever send-looking button we find.
          clickSendButton({ force: true });
          await sleep(500);
        }
      }

      const after = findInput() || input;
      if (!composerLooksIdleAfterSend(after) && !document.querySelector("button[data-testid='stop-button']")) {
        throw new Error(
          "Prompt was typed but ChatGPT did not accept Send. Keep the ChatGPT tab focused (close/minimize the extension popup) and click Start again."
        );
      }

      return { blocksBefore, latestBefore };
    }
  });

  if (!results?.length) throw new Error("No response from content script.");
  if (results[0].result === undefined && results[0].error) {
    throw new Error(String(results[0].error.message || results[0].error));
  }
  return results[0].result || { blocksBefore: 0, latestBefore: "" };
}

async function chatgptPollState(tabId, { harvestJson = false } = {}) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [Boolean(harvestJson)],
    func: (shouldHarvestJson) => {
      const isGenerating = () => {
        const stopBtn =
          document.querySelector("button[data-testid='stop-button']") ||
          document.querySelector("button[aria-label='Stop streaming']") ||
          document.querySelector("button[aria-label='Stop generating']");
        if (stopBtn && stopBtn.offsetParent !== null) return true;
        return false;
      };

      const scorePayload = (text) => {
        const t = String(text || "");
        let score = t.length;
        if (t.includes('"experience"')) score += 100000;
        if (t.includes('"name"')) score += 50000;
        if (t.includes('"profile"')) score += 25000;
        if (t.includes('"skills"')) score += 15000;
        if (t.includes('"certifications"')) score += 10000;
        if (/^\s*\{/.test(t) && t.includes("}")) score += 20000;
        return score;
      };

      const collectTextCandidates = () => {
        const out = [];
        const push = (t) => {
          const text = String(t || "").trim();
          if (text.length > 40) out.push(text);
        };
        for (const el of document.querySelectorAll("pre, pre code, code, [data-testid*='code'], [class*='code'], [class*='Code']")) {
          push(el.innerText || el.textContent || "");
        }
        // Artifact / side panels / monaco-like editors
        for (const el of document.querySelectorAll(
          "[class*='artifact'], [class*='Artifact'], [class*='canvas'], [class*='Canvas'], [role='textbox'], .cm-content, .monaco-editor"
        )) {
          push(el.innerText || el.textContent || "");
        }
        const blocks = document.querySelectorAll("[data-message-author-role='assistant']");
        if (blocks.length) {
          const last = blocks[blocks.length - 1];
          push(last.innerText || last.textContent || "");
          for (const pre of last.querySelectorAll("pre, code")) {
            push(pre.innerText || pre.textContent || "");
          }
        }
        // Whole page fallback — find largest JSON-looking slice
        push(document.body?.innerText || "");
        return out;
      };

      const extractBalancedObjects = (str) => {
        const objects = [];
        let depth = 0;
        let startIdx = -1;
        let inString = false;
        let escaped = false;
        for (let i = 0; i < str.length; i += 1) {
          const ch = str[i];
          if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
          }
          if (ch === '"') {
            inString = true;
            continue;
          }
          if (ch === "{") {
            if (depth === 0) startIdx = i;
            depth += 1;
          } else if (ch === "}") {
            if (depth > 0) {
              depth -= 1;
              if (depth === 0 && startIdx >= 0) {
                objects.push(str.slice(startIdx, i + 1));
                startIdx = -1;
              }
            }
          }
        }
        return objects;
      };

      const harvestBestJsonText = () => {
        let best = "";
        let bestScore = -1;
        for (const candidate of collectTextCandidates()) {
          // Direct candidate
          const directScore = scorePayload(candidate);
          if (candidate.includes('"name"') && candidate.includes('"experience"') && directScore > bestScore) {
            best = candidate;
            bestScore = directScore;
          }
          // Balanced objects inside candidate
          for (const obj of extractBalancedObjects(candidate)) {
            const s = scorePayload(obj);
            if (obj.includes('"name"') && (obj.includes('"experience"') || obj.includes('"profile"')) && s > bestScore) {
              best = obj;
              bestScore = s;
            }
          }
        }
        return best;
      };

      const readAssistantBlock = (block) => {
        if (!block) return "";
        const candidates = [];
        for (const pre of block.querySelectorAll("pre")) {
          const text = (pre.innerText || pre.textContent || "").trim();
          if (text) candidates.push(text);
        }
        for (const code of block.querySelectorAll("pre code, code")) {
          const text = (code.innerText || code.textContent || "").trim();
          if (text && text.length > 40) candidates.push(text);
        }
        for (const el of block.querySelectorAll("[class*='code'], [class*='Code'], [data-message-content]")) {
          const text = (el.innerText || el.textContent || "").trim();
          if (text.includes('"experience"') || (text.startsWith("{") && text.includes('"name"'))) {
            candidates.push(text);
          }
        }
        if (candidates.length) {
          candidates.sort((a, b) => scorePayload(b) - scorePayload(a));
          return candidates[0];
        }
        return (block.innerText || block.textContent || "").trim();
      };

      const blocks = Array.from(
        document.querySelectorAll("[data-message-author-role='assistant']")
      );
      if (blocks.length) {
        blocks[blocks.length - 1].scrollIntoView({ block: "end", inline: "nearest" });
      }

      let latest = blocks.length ? readAssistantBlock(blocks[blocks.length - 1]) : "";
      if (shouldHarvestJson) {
        const harvested = harvestBestJsonText();
        if (scorePayload(harvested) > scorePayload(latest)) {
          latest = harvested;
        }
      }

      return {
        blockCount: blocks.length,
        latest,
        generating: isGenerating(),
        harvestedJson: shouldHarvestJson
      };
    }
  });

  if (!results?.length) throw new Error("No response from content script.");
  if (results[0].result === undefined && results[0].error) {
    throw new Error(String(results[0].error.message || results[0].error));
  }
  return results[0].result || { blockCount: 0, latest: "", generating: false };
}

function looksSettledAssistantText(text, { expectResumeJson = false } = {}) {
  const t = String(text || "").trim();
  if (!t) return false;

  if (/<!doctype html|<html[\s>]/i.test(t) && /<\/html>/i.test(t)) return true;

  if (expectResumeJson) {
    // Clarifying questions / refusals are NOT done.
    if (/please provide|need (more )?info|could you (share|provide)|clarif/i.test(t) && !t.includes('"experience"')) {
      return false;
    }
    const data = extractResumeJson(t);
    if (isUsableResumeJson(data)) return true;
    // Incomplete JSON that still looks open — keep waiting.
    if (/^\s*[{`]/.test(t) || t.includes('"name"')) return false;
    // Long non-JSON prose: not settled for resume mode.
    return false;
  }

  if (!(t.includes('"experience"') && t.includes('"certifications"'))) {
    if (/<!doctype html|<html[\s>]/i.test(t)) return /<\/html>/i.test(t);
    return t.length > 200;
  }
  const end = t.lastIndexOf("}");
  if (end < 0) return false;
  const after = t.slice(end + 1).replace(/```/g, "").trim();
  return after.length === 0;
}

async function automateChatGpt(tabId, prompt, options = {}) {
  const startNewChat = options.newChat !== false;
  const label = options.statusLabel || "Waiting for ChatGPT response...";
  const expectResumeJson = Boolean(options.expectResumeJson);

  const { blocksBefore, latestBefore } = await chatgptSendPrompt(tabId, prompt, startNewChat);

  const timeoutMs = 6 * 60 * 1000;
  const start = Date.now();
  let lastText = "";
  let sawGeneration = false;
  let stableHits = 0;
  let lastLen = 0;
  let usableHits = 0;

  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await chrome.storage.local.set({ generation_heartbeat: Date.now() }).catch(() => {});

    const state = await chatgptPollState(tabId, { harvestJson: expectResumeJson });
    if (state.generating) sawGeneration = true;
    if (state.latest) lastText = state.latest;

    const elapsedSec = Math.round((Date.now() - start) / 1000);
    const parsed = expectResumeJson ? extractResumeJson(lastText) : null;
    const usable = expectResumeJson && isUsableResumeJson(parsed);

    if (elapsedSec > 0 && elapsedSec % 4 === 0) {
      const waitHint = expectResumeJson
        ? usable
          ? ", full JSON ready"
          : looksLikeSchemaPlaceholderResume(parsed)
            ? ", waiting (schema stub — not saving yet)"
            : parsed?.name
              ? `, partial JSON (${parsed.name})`
              : ""
        : "";
      await setStatus(
        `${label} (${elapsedSec}s, ${lastText.length || 0} chars${state.generating ? ", streaming" : ""}${waitHint})`
      );
    }

    // Resume JSON mode: as soon as page has usable JSON, SAVE (don't require "fresh" heuristics).
    if (expectResumeJson && usable) {
      usableHits += 1;
      // Save immediately once not streaming, or after 2 consecutive usable polls.
      if (!state.generating || usableHits >= 2) {
        await setStatus(`Resume JSON found (${parsed.name || "ok"}). Writing jd.txt / resume files…`);
        return lastText;
      }
      continue;
    }

    const isFreshText = Boolean(lastText) && lastText !== (latestBefore || "");
    const isNewBlock = state.blockCount > blocksBefore;
    if (!isFreshText && !isNewBlock && !(expectResumeJson && lastText.length > 200)) continue;

    usableHits = 0;

    if (state.generating) {
      if (lastText.length > lastLen + 80) {
        lastLen = lastText.length;
        stableHits = 0;
      }
      continue;
    }

    if (!(sawGeneration || (isNewBlock && Date.now() - start > 8000) || (expectResumeJson && elapsedSec > 15))) {
      continue;
    }

    if (lastText.length > lastLen + 40) {
      lastLen = lastText.length;
      stableHits = 0;
      continue;
    }
    if (lastText.length > lastLen) lastLen = lastText.length;

    stableHits += 1;

    if (expectResumeJson) {
      // Still incomplete — keep waiting / harvesting.
      continue;
    }

    if (stableHits >= 2 && looksSettledAssistantText(lastText, { expectResumeJson })) {
      return lastText;
    }
    if (stableHits >= 5 && sawGeneration) {
      return lastText;
    }
  }

  if (expectResumeJson && isUsableResumeJson(extractResumeJson(lastText))) {
    return lastText;
  }

  throw new Error(
    expectResumeJson
      ? "Timed out waiting for complete resume JSON from ChatGPT."
      : "Timed out waiting for ChatGPT response."
  );
}

/**
 * One ChatGPT chat per job:
 *  1) new chat → resume prompt (JD inside)
 *  2) save jd.txt + [Name]_Resume.pdf
 *  3) same chat → cover letter prompt
 *  4) save [Name]_Cover Letter.pdf
 */
async function saveResumeAndCoverLetter(tabId, output, resumeData, jobMeta, { runCoverLetter = true } = {}) {
  await setStatus("Saving jd.txt + resume PDF…");
  const { jobDir: savedDir, nameToken, resumePdfName, saved } = await autoDownloadResumeFiles(
    output,
    resumeData,
    jobMeta
  );

  const parts = [];
  if (saved?.jd) parts.push("jd.txt");
  if (saved?.pdf) parts.push(resumePdfName || saved.resumePdfName || "Resume.pdf");
  let status = `Saved to Downloads / ${savedDir} (${parts.join(" + ") || "partial"})`;
  if (saved?.pdfError && !saved?.pdf) {
    status += ` — ${saved.pdfError}`;
  }

  if (runCoverLetter && typeof tabId === "number") {
    try {
      await setStatus("Same chat: sending cover letter prompt…");
      const coverPrompt = await buildCoverLetterPrompt({
        jdText: jobMeta.jdText || "",
        jobTitle: jobMeta.jobTitle || "",
        companyName: jobMeta.companyName || ""
      });
      // IMPORTANT: same chat as resume (one chat per position).
      const coverOutput = await automateChatGpt(tabId, coverPrompt, {
        newChat: false,
        expectResumeJson: false,
        statusLabel: "Waiting for cover letter (same chat)…"
      });
      if (!coverOutput) throw new Error("Empty cover letter response.");

      const token = nameToken || outputNameToken(jobMeta, resumeData);
      const coverPdfName = `${token}_Cover Letter.pdf`;
      await setStatus(`Saving ${coverPdfName}…`);
      const contact = await getAutofillContact();
      const cl = await autoDownloadCoverLetterPdf(
        coverOutput,
        savedDir,
        {
          name: resumeData?.name || contact.name || "Applicant",
          signatureTitle: contact.signatureTitle || resumeData?.headline || "",
          headline: resumeData?.headline || contact.signatureTitle || "",
          location: resumeData?.location || contact.location,
          email: resumeData?.email || contact.email || "",
          phone: resumeData?.phone || contact.phone || "",
          linkedin: resumeData?.linkedin || contact.linkedin || ""
        },
        token
      );
      if (cl.pdf) status = `${status} + ${cl.coverPdfName || coverPdfName}`;
    } catch (coverErr) {
      status = `${status}; cover letter failed: ${String(coverErr?.message || coverErr)}`;
    }
  } else if (runCoverLetter) {
    status = `${status}. Cover letter skipped: open a ChatGPT tab.`;
  }

  if (jobMeta.spreadsheetUrl || jobMeta.sheetsWebAppUrl) {
    await setStatus("Appending row to Google Sheet...");
    try {
      await appendJobToSpreadsheet({
        spreadsheetUrl: jobMeta.spreadsheetUrl,
        webAppUrl: jobMeta.sheetsWebAppUrl,
        jobTitle: jobMeta.jobTitle,
        companyName: jobMeta.companyName,
        jdLink: jobMeta.jdLink
      });
      status = `${status} and appended to Google Sheet`;
    } catch (sheetErr) {
      status = `${status}, but sheet append failed: ${String(sheetErr?.message || sheetErr)}`;
    }
  }

  return { savedDir, status };
}

async function runGenerationPipeline({ jobMeta, jsonText }) {
  // Strict manual path: parse the pasted JSON, render + save, then cover letter.
  const data = extractResumeJson(jsonText);
  if (!data) {
    throw new Error(
      "Pasted text is not valid resume JSON. Copy the full JSON object (starting with { and ending with })."
    );
  }
  const rawText = JSON.stringify(data, null, 2);
  const tab = await getOpenChatGptTab();
  await chrome.storage.local.set({ last_response: rawText });
  return saveResumeAndCoverLetter(tab?.id, rawText, data, jobMeta || {}, {
    runCoverLetter: true
  });
}

async function getQueue() {
  const data = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
}

async function setQueue(queue) {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

async function setBatchState(state) {
  await chrome.storage.local.set({ [BATCH_STATE_KEY]: state });
}

async function updateQueueJob(csvRow, patch) {
  const queue = await getQueue();
  const next = queue.map((j) => (Number(j.csvRow) === Number(csvRow) ? { ...j, ...patch } : j));
  await setQueue(next);
  return next.find((j) => Number(j.csvRow) === Number(csvRow));
}

async function rememberApplyHistory(csvRow, entry) {
  const data = await chrome.storage.local.get(APPLY_HISTORY_KEY);
  const map = data[APPLY_HISTORY_KEY] && typeof data[APPLY_HISTORY_KEY] === "object" ? data[APPLY_HISTORY_KEY] : {};
  map[String(csvRow)] = { ...(map[String(csvRow)] || {}), ...entry, updatedAt: Date.now() };
  await chrome.storage.local.set({ [APPLY_HISTORY_KEY]: map });
}

/**
 * Fully automatic — ONE new ChatGPT chat per position:
 * resume (with JD) → save files → cover letter in the same chat → save CL.
 */
async function runAutoJob(jobMeta) {
  const tab = await getOpenChatGptTab();
  if (!tab || typeof tab.id !== "number") {
    throw new Error("Open ChatGPT in a browser tab first.");
  }

  const person = await getActivePerson();
  const profileId = jobMeta.profileId || person.id;
  const prompt = await buildPrompt(profileId, jobMeta.jdText || "", {
    jobTitle: jobMeta.jobTitle || "",
    companyName: jobMeta.companyName || "",
    masterResume: person.masterResume || ""
  });

  await setStatus(
    `Row ${jobMeta.csvRow != null ? jobMeta.csvRow + " · " : ""}${jobMeta.companyName}: opening ONE new chat for this position…`
  );

  if (batchControl.skipCurrent || batchControl.stop) {
    throw new Error("__SKIP__");
  }

  // Step A: new chat + resume JSON (JD is already inside the prompt via {JD}).
  let rawOutput = await automateChatGpt(tab.id, prompt, {
    newChat: true,
    expectResumeJson: true,
    statusLabel: `Chat 1/1 · resume JSON (${jobMeta.companyName || "job"})…`
  });

  if (batchControl.skipCurrent || batchControl.stop) {
    throw new Error("__SKIP__");
  }

  let resumeData = extractResumeJson(rawOutput);
  if (!isUsableResumeJson(resumeData)) {
    await setStatus(
      `Row ${jobMeta.csvRow != null ? jobMeta.csvRow + " · " : ""}${jobMeta.companyName}: JSON incomplete — retry in same chat…`
    );
    rawOutput = await automateChatGpt(tab.id, JSON_RETRY_PROMPT, {
      newChat: false,
      expectResumeJson: true,
      statusLabel: `Same chat · retry resume JSON (${jobMeta.companyName || "job"})…`
    });
    resumeData = extractResumeJson(rawOutput);
  }

  if (!isUsableResumeJson(resumeData)) {
    throw new Error(describeUnusableResume(rawOutput, resumeData));
  }

  // Save JD + resume immediately (before cover letter), same chat continues after.
  const enrichedMeta = {
    ...jobMeta,
    templateId: jobMeta.templateId || person.templateId || DEFAULT_TEMPLATE_ID,
    resumeFilePrefix: jobMeta.resumeFilePrefix || person.resumeFilePrefix || "Resume"
  };

  const result = await saveResumeAndCoverLetter(
    tab.id,
    JSON.stringify(resumeData, null, 2),
    resumeData,
    enrichedMeta,
    { runCoverLetter: true }
  );

  // Confirm at least jd.txt landed in Downloads.
  try {
    const found = await chrome.downloads.search({
      query: [result.savedDir.split("/").pop() || "jd.txt"],
      limit: 5,
      orderBy: ["-startTime"]
    });
    if (!found?.length) {
      await setStatus(
        `${result.status} — WARNING: Chrome Downloads may have blocked files. Check the Downloads shelf / allow downloads.`
      );
    }
  } catch {
    // ignore
  }

  return result;
}

async function runBatchLoop(outputDir) {
  batchControl = { pauseAfterCurrent: false, skipCurrent: false, stop: false };
  await setBatchState("running");
  await chrome.storage.local.set({ generation_running: true });
  startKeepAlive();

  try {
    while (!batchControl.stop) {
      if (batchControl.pauseAfterCurrent) {
        batchControl.pauseAfterCurrent = false;
        await setBatchState("paused");
        await setStatus("Batch paused. Click Start/Resume to continue.");
        await chrome.storage.local.set({ generation_running: false });
        return;
      }

      const queue = await getQueue();
      const next = queue.find((j) => j.status === "pending" || j.status === "error");
      if (!next) {
        await setBatchState("idle");
        await setStatus("Batch complete — no pending US jobs left.");
        await chrome.storage.local.set({ generation_running: false });
        return;
      }

      if (!String(next.jdText || "").trim()) {
        await updateQueueJob(next.csvRow, {
          status: "error",
          error: "Empty job description in CSV"
        });
        continue;
      }

      await updateQueueJob(next.csvRow, { status: "running", error: "" });
      await setStatus(`Batch: generating row ${next.csvRow} — ${next.company} / ${next.title}`);

      const jobMeta = {
        csvRow: next.csvRow,
        jobTitle: next.title,
        companyName: next.company,
        jdLink: next.jdLink || "",
        jdText: next.jdText || "",
        outputDir: outputDir || "Resume Applications"
      };

      try {
        if (batchControl.skipCurrent) {
          batchControl.skipCurrent = false;
          await updateQueueJob(next.csvRow, { status: "skipped", error: "" });
          continue;
        }

        const result = await runAutoJob(jobMeta);

        if (batchControl.skipCurrent) {
          batchControl.skipCurrent = false;
          await updateQueueJob(next.csvRow, { status: "skipped", error: "Skipped during run" });
          continue;
        }

        await updateQueueJob(next.csvRow, {
          status: "done",
          jobDir: result.savedDir,
          error: ""
        });
        await rememberApplyHistory(next.csvRow, {
          jobDir: result.savedDir,
          jdLink: next.jdLink || "",
          status: "done",
          title: next.title,
          company: next.company
        });
        await setStatus(`Done row ${next.csvRow}. ${result.status}`);
      } catch (err) {
        const msg = String(err?.message || err);
        if (msg === "__SKIP__" || batchControl.skipCurrent) {
          batchControl.skipCurrent = false;
          await updateQueueJob(next.csvRow, { status: "skipped", error: "" });
          continue;
        }
        if (batchControl.stop) break;

        await updateQueueJob(next.csvRow, { status: "error", error: msg.slice(0, 240) });
        await setBatchState("paused");
        await setStatus(`Row ${next.csvRow} failed: ${msg}. Batch paused.`);
        await chrome.storage.local.set({ generation_running: false });
        return;
      }

      if (batchControl.pauseAfterCurrent) {
        batchControl.pauseAfterCurrent = false;
        await setBatchState("paused");
        await setStatus("Batch paused after current job. Click Start to resume.");
        await chrome.storage.local.set({ generation_running: false });
        return;
      }
    }

    await setBatchState("idle");
    await setStatus("Batch stopped.");
  } finally {
    isRunning = false;
    stopKeepAlive();
    await chrome.storage.local.set({ generation_running: false });
    if (!batchControl.stop) {
      const state = (await chrome.storage.local.get(BATCH_STATE_KEY))[BATCH_STATE_KEY];
      if (state === "running") await setBatchState("idle");
    } else {
      await setBatchState("idle");
    }
  }
}

async function revealJobFiles({ csvRow, jobDir }) {
  let filenamePrefix = jobDir || "";
  if (!filenamePrefix && csvRow != null) {
    const hist = (await chrome.storage.local.get(APPLY_HISTORY_KEY))[APPLY_HISTORY_KEY] || {};
    filenamePrefix = hist[String(csvRow)]?.jobDir || "";
  }
  if (!filenamePrefix) {
    const queue = await getQueue();
    const job = queue.find((j) => Number(j.csvRow) === Number(csvRow));
    filenamePrefix = job?.jobDir || "";
  }
  if (!filenamePrefix) {
    throw new Error("No saved folder for this job yet. Generate it first.");
  }

  const results = await chrome.downloads.search({
    filenameRegex: filenamePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\//g, "[\\\\/]") + ".*",
    limit: 20,
    orderBy: ["-startTime"]
  });

  if (!results?.length) {
    // Fallback: search by path segment
    const segment = filenamePrefix.split("/").pop();
    const loose = await chrome.downloads.search({
      query: [segment],
      limit: 20,
      orderBy: ["-startTime"]
    });
    if (!loose?.length) {
      throw new Error(`No downloads found under ${filenamePrefix}`);
    }
    await chrome.downloads.show(loose[0].id);
    return { shown: loose[0].filename };
  }

  await chrome.downloads.show(results[0].id);
  return { shown: results[0].filename };
}

function autofillPageFunc(contact) {
  const filled = [];
  const name = String(contact.name || "").trim();
  const email = String(contact.email || "").trim();
  const phone = String(contact.phone || "").trim();
  const linkedin = String(contact.linkedin || "").trim();
  const location = String(contact.location || "").trim();
  const first = name.split(/\s+/)[0] || "";
  const last = name.split(/\s+/).slice(1).join(" ") || "";

  const setNativeValue = (el, value) => {
    if (!el || value == null || value === "") return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag !== "input" && tag !== "textarea" && !el.isContentEditable) return false;
    if (el.disabled || el.readOnly) return false;
    const proto =
      tag === "textarea"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };

  const scoreField = (el, hints) => {
    const blob = [
      el.name,
      el.id,
      el.placeholder,
      el.getAttribute("aria-label"),
      el.getAttribute("autocomplete"),
      el.getAttribute("data-test"),
      el.className
    ]
      .join(" ")
      .toLowerCase();
    return hints.some((h) => blob.includes(h));
  };

  const inputs = Array.from(document.querySelectorAll("input, textarea"));
  const tryFill = (hints, value, label) => {
    if (!value) return;
    for (const el of inputs) {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["hidden", "submit", "button", "checkbox", "radio", "file"].includes(type)) continue;
      if (scoreField(el, hints) && setNativeValue(el, value)) {
        filled.push(label);
        return;
      }
    }
  };

  tryFill(["email", "e-mail"], email, "email");
  tryFill(["tel", "phone", "mobile"], phone, "phone");
  tryFill(["linkedin", "linked-in", "profile url", "profileurl"], linkedin, "linkedin");
  tryFill(["first name", "firstname", "given-name", "given_name"], first, "firstName");
  tryFill(["last name", "lastname", "family-name", "surname"], last, "lastName");
  tryFill(["full name", "fullname", "applicant", "candidate name", "your name"], name, "name");
  tryFill(["city", "location", "address locality"], location, "location");

  return { filled: filled.length, fields: filled };
}

async function autofillActiveTab() {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const tab =
    tabs.find((t) => t.active && t.id && t.url && !t.url.startsWith("chrome-extension://")) ||
    (await chrome.tabs.query({ active: true })).find(
      (t) => t.id && t.url && !/^chrome(-extension)?:\/\//.test(t.url || "")
    );

  if (!tab?.id) throw new Error("No active application tab. Focus the job form tab first.");
  if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("edge://"))) {
    throw new Error("Cannot autofill Chrome system pages. Focus the job application tab.");
  }

  const contact = await getAutofillContact();
  if (!contact.name && !contact.email && !contact.phone) {
    throw new Error("Active person has no contact fields. Edit person and save name/email/phone.");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [contact],
    func: autofillPageFunc
  });

  return results?.[0]?.result || { filled: 0, fields: [] };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;

  if (type === "reset_generation_state") {
    (async () => {
      try {
        isRunning = false;
        batchControl.stop = true;
        stopKeepAlive();
        const tab = await getOpenChatGptTab();
        if (tab?.id) {
          await chrome.tabs.reload(tab.id);
        }
        await chrome.storage.local.set({
          generation_status: "Reset complete. Ready for next run.",
          generation_running: false,
          last_response: "",
          [BATCH_STATE_KEY]: "idle"
        });
        safeSendResponse(sendResponse, { ok: true });
      } catch (err) {
        isRunning = false;
        stopKeepAlive();
        await chrome.storage.local.set({ generation_running: false });
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "send_prompt") {
    (async () => {
      try {
        const tab = await getOpenChatGptTab();
        if (!tab || typeof tab.id !== "number") {
          safeSendResponse(sendResponse, {
            ok: false,
            error: "Open ChatGPT in a browser tab first."
          });
          return;
        }
        await chatgptSendPrompt(tab.id, message.prompt || "", true);
        try {
          await chrome.tabs.update(tab.id, { active: true });
        } catch {
          // focusing the tab is best-effort
        }
        safeSendResponse(sendResponse, { ok: true });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "open_job_url") {
    (async () => {
      try {
        const url = String(message.url || "").trim();
        if (!url) throw new Error("Missing URL.");
        await chrome.tabs.create({ url, active: true });
        safeSendResponse(sendResponse, { ok: true });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "reveal_job_files") {
    (async () => {
      try {
        const result = await revealJobFiles({
          csvRow: message.csvRow,
          jobDir: message.jobDir
        });
        safeSendResponse(sendResponse, { ok: true, ...result });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "autofill_active_tab") {
    (async () => {
      try {
        const result = await autofillActiveTab();
        safeSendResponse(sendResponse, { ok: true, ...result });
      } catch (err) {
        safeSendResponse(sendResponse, { ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "batch_pause") {
    batchControl.pauseAfterCurrent = true;
    setStatus("Pause requested — will pause after the current job finishes writing files.");
    safeSendResponse(sendResponse, { ok: true, status: "Pause requested." });
    return false;
  }

  if (type === "batch_skip") {
    batchControl.skipCurrent = true;
    setStatus("Skip requested for current job.");
    safeSendResponse(sendResponse, { ok: true, status: "Skip requested." });
    return false;
  }

  if (type === "batch_stop") {
    batchControl.stop = true;
    batchControl.skipCurrent = true;
    setStatus("Stop requested — batch will halt.");
    setBatchState("idle");
    safeSendResponse(sendResponse, { ok: true, status: "Stop requested." });
    return false;
  }

  if (type === "batch_status") {
    (async () => {
      const data = await chrome.storage.local.get([BATCH_STATE_KEY, QUEUE_KEY, "generation_status"]);
      safeSendResponse(sendResponse, {
        ok: true,
        state: data[BATCH_STATE_KEY] || "idle",
        queue: data[QUEUE_KEY] || [],
        status: data.generation_status || ""
      });
    })();
    return true;
  }

  if (type === "batch_start" || type === "batch_resume") {
    if (isRunning) {
      safeSendResponse(sendResponse, { ok: false, error: "Generation already in progress." });
      return false;
    }
    isRunning = true;
    safeSendResponse(sendResponse, { ok: true, started: true, status: "Batch started…" });
    (async () => {
      // Clear leftover "running" rows from a killed service worker.
      await recoverInterruptedBatch("Starting batch…").catch(() => {});
      isRunning = true;
      await runBatchLoop(message.outputDir || "Resume Applications");
    })().catch(async (err) => {
      isRunning = false;
      stopKeepAlive();
      await setBatchState("idle");
      await chrome.storage.local.set({ generation_running: false });
      await setStatus(`Batch failed: ${String(err?.message || err)}`);
    });
    return false;
  }

  if (type === "run_one_off") {
    if (isRunning) {
      safeSendResponse(sendResponse, { ok: false, error: "Generation already in progress." });
      return false;
    }
    isRunning = true;
    startKeepAlive();
    chrome.storage.local.set({ generation_running: true });
    safeSendResponse(sendResponse, { ok: true, started: true });
    (async () => {
      try {
        const result = await runAutoJob(message.jobMeta || {});
        await chrome.storage.local.set({ generation_running: false });
        await setStatus(result.status);
      } catch (err) {
        await chrome.storage.local.set({ generation_running: false });
        await setStatus(`Generation failed: ${String(err?.message || err)}`);
      } finally {
        isRunning = false;
        stopKeepAlive();
      }
    })();
    return false;
  }

  if (type === "save_from_json") {
    if (isRunning) {
      safeSendResponse(sendResponse, { ok: false, error: "Generation already in progress." });
      return undefined;
    }

    isRunning = true;
    startKeepAlive();
    chrome.storage.local.set({ generation_running: true });
    setStatus("Rendering resume from pasted JSON...");
    safeSendResponse(sendResponse, { ok: true, started: true });

    (async () => {
      try {
        const result = await runGenerationPipeline({
          jobMeta: message.jobMeta || {},
          jsonText: message.jsonText || ""
        });
        await chrome.storage.local.set({ generation_running: false });
        await setStatus(result.status);
      } catch (err) {
        await chrome.storage.local.set({ generation_running: false });
        await setStatus(`Generation failed: ${String(err?.message || err)}`);
      } finally {
        isRunning = false;
        stopKeepAlive();
      }
    })();
    return false;
  }

  return undefined;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "autofill-page") {
    autofillActiveTab()
      .then((r) => setStatus(`Autofilled ${r.filled || 0} field(s).`))
      .catch((err) => setStatus(`Autofill failed: ${String(err?.message || err)}`));
  }
});
