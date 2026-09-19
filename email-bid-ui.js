/**
 * Email Bid popup UI — hiring contacts, mailbox, To checklist, confirm send.
 */

import {
  EMAIL_BID_CUSTOM_RESUME_KEY,
  EMAIL_BID_MAILBOX_KEY,
  getProfileMailbox,
  saveProfileMailbox,
  testSmtpMailbox,
  smtpPresetForEmail,
  buildWebComposeUrl,
  formatSmtpConnectError
} from "./email-send.js";

/**
 * @param {{
 *   getActivePerson: () => Promise<object|null>,
 *   setStatus: (msg: string) => void,
 *   setBusy: (busy: boolean) => void,
 *   setIconButton?: (button: HTMLElement, icon: string, label: string) => void,
 *   DEFAULT_TEMPLATE_ID: string,
 *   templateSelectEl: HTMLSelectElement|null,
 *   spreadsheetUrlEl: HTMLInputElement|null,
 *   sheetsWebAppUrlEl: HTMLInputElement|null
 * }} deps
 */
export function initEmailBidUi(deps) {
  const {
    getActivePerson,
    setStatus,
    setBusy,
    setIconButton,
    DEFAULT_TEMPLATE_ID,
    templateSelectEl,
    spreadsheetUrlEl,
    sheetsWebAppUrlEl
  } = deps;

  const toggleBtn = document.getElementById("toggleEmailBidPanel");
  const panelBody = document.getElementById("emailBidPanelBody");
  const titleEl = document.getElementById("emailBidTitle");
  const companyEl = document.getElementById("emailBidCompany");
  const jdLinkEl = document.getElementById("emailBidJdLink");
  const jdTextEl = document.getElementById("emailBidJdText");
  const fillTabBtn = document.getElementById("emailBidFillTab");
  const prepareBtn = document.getElementById("emailBidPrepare");
  const emailEl = document.getElementById("emailBidMailboxEmail");
  const passwordEl = document.getElementById("emailBidMailboxPassword");
  const mailboxSaveBtn = document.getElementById("emailBidMailboxSave");
  const mailboxDisconnectBtn = document.getElementById("emailBidMailboxDisconnect");
  const draftBlock = document.getElementById("emailBidDraftBlock");
  const toListEl = document.getElementById("emailBidToList");
  const subjectEl = document.getElementById("emailBidSubject");
  const bodyEl = document.getElementById("emailBidBody");
  const customResumeEl = document.getElementById("emailBidCustomResume");
  const confirmBtn = document.getElementById("emailBidConfirmSend");
  const openWebBtn = document.getElementById("emailBidOpenWeb");

  if (typeof setIconButton === "function") {
    if (fillTabBtn) setIconButton(fillTabBtn, "scrape", "Fill from tab");
    if (prepareBtn) setIconButton(prepareBtn, "search", "Find contacts & draft");
    if (mailboxSaveBtn) setIconButton(mailboxSaveBtn, "connect", "Connect mailbox");
    if (mailboxDisconnectBtn) setIconButton(mailboxDisconnectBtn, "disconnect", "Disconnect mailbox");
    if (confirmBtn) setIconButton(confirmBtn, "apply", "Confirm & Send (SMTP)");
    if (openWebBtn) setIconButton(openWebBtn, "mail", "Open in Outlook / Gmail");
  }

  /** @type {null|object} */
  let draftCache = null;

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setPanelOpen(open) {
    if (!panelBody || !toggleBtn) return;
    panelBody.hidden = !open;
    toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    toggleBtn.textContent = open ? "Hide Email Bid" : "Expand Email Bid";
  }

  async function refreshFromAndMailbox() {
    const person = await getActivePerson().catch(() => null);
    const profileEmail = String(person?.email || "").trim().toLowerCase();
    const box = await getProfileMailbox(person?.id || "", profileEmail).catch(() => null);
    const email =
      (emailEl?.dataset.touched === "1" && String(emailEl.value || "").trim().toLowerCase()) ||
      String(box?.email || profileEmail).trim().toLowerCase();
    if (emailEl && emailEl.dataset.touched !== "1") {
      emailEl.value = email;
    }
    if (passwordEl) {
      passwordEl.placeholder = box?.password ? "••••••••" : "App password";
    }
  }

  function renderToList(contacts = [], selectedEmails = null) {
    if (!toListEl) return;
    const selected = selectedEmails
      ? new Set(selectedEmails.map((e) => String(e).toLowerCase()))
      : null;
    toListEl.innerHTML = (contacts || [])
      .filter((c) => c?.email)
      .map((c) => {
        const email = String(c.email).trim().toLowerCase();
        const checked = selected ? selected.has(email) : true;
        const conf =
          c.confidence != null && Number.isFinite(Number(c.confidence))
            ? ` · ${Math.round(Number(c.confidence) * 100)}%`
            : "";
        return `<label class="email-bid-to-row">
          <input type="checkbox" data-email="${escapeHtml(email)}" ${checked ? "checked" : ""} />
          <span class="email-bid-to-meta">
            <strong>${escapeHtml(c.name || email)}</strong>
            <span class="email-bid-to-email">${escapeHtml(email)}</span>
            <span class="email-bid-to-role">${escapeHtml(c.role || "")}${conf}</span>
          </span>
        </label>`;
      })
      .join("");
  }

  function selectedRecipients() {
    if (!toListEl) return [];
    return Array.from(toListEl.querySelectorAll('input[type="checkbox"][data-email]:checked'))
      .map((el) => String(el.getAttribute("data-email") || "").trim().toLowerCase())
      .filter(Boolean);
  }

  function applyDraft(draft) {
    draftCache = draft || null;
    if (!draft || !draftBlock) {
      if (draftBlock) draftBlock.hidden = true;
      return;
    }
    draftBlock.hidden = false;
    renderToList(draft.contacts || [], draft.toEmails || []);
    if (subjectEl) subjectEl.value = draft.subject || "";
    if (bodyEl) bodyEl.value = draft.body || "";
  }

  function collectJobMeta(person) {
    const title = titleEl?.value?.trim() || "";
    const company = companyEl?.value?.trim() || "";
    return {
      title,
      jobTitle: title,
      company,
      companyName: company,
      jdLink: jdLinkEl?.value?.trim() || "",
      jdText: jdTextEl?.value?.trim() || "",
      bidSource: "email-bid",
      templateId: templateSelectEl?.value || person?.templateId || DEFAULT_TEMPLATE_ID,
      spreadsheetUrl: spreadsheetUrlEl?.value?.trim() || "",
      sheetsWebAppUrl: sheetsWebAppUrlEl?.value?.trim() || "",
      profileId: person?.id || ""
    };
  }

  function readMailboxEmail() {
    return String(emailEl?.value || "").trim().toLowerCase();
  }

  async function saveMailbox() {
    const person = await getActivePerson().catch(() => null);
    const profileEmail = String(person?.email || "").trim().toLowerCase();
    const email = readMailboxEmail() || profileEmail;
    if (!email) {
      setStatus("Enter an email address.");
      return;
    }
    if (emailEl) emailEl.value = email;
    const existing = await getProfileMailbox(person?.id || "", email).catch(() => null);
    const password = String(passwordEl?.value || "").trim() || String(existing?.password || "");
    if (!password) {
      setStatus("Enter the mailbox password.");
      return;
    }
    const preset = smtpPresetForEmail(email);
    setStatus(`Connecting ${email}…`);
    try {
      await testSmtpMailbox({ email, password, smtpHost: preset.host, smtpPort: preset.port });
      await saveProfileMailbox({
        profileId: person?.id || email,
        email,
        password,
        smtpHost: preset.host,
        smtpPort: preset.port,
        connected: true
      });
      if (passwordEl) passwordEl.value = "";
      if (emailEl) emailEl.dataset.touched = "0";
      await refreshFromAndMailbox();
      setStatus(`Mailbox connected: ${email}`);
    } catch (err) {
      setStatus(`Mailbox connect failed: ${formatSmtpConnectError(err, email)}`);
    }
  }

  async function disconnectMailbox() {
    const person = await getActivePerson().catch(() => null);
    const email = readMailboxEmail() || String(person?.email || "").trim().toLowerCase();
    await saveProfileMailbox({
      profileId: person?.id || email,
      email,
      password: "",
      connected: false
    });
    if (passwordEl) passwordEl.value = "";
    if (emailEl) emailEl.dataset.touched = "0";
    await refreshFromAndMailbox();
    setStatus("Mailbox disconnected.");
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        resolve(result.includes(",") ? result.split(",")[1] : result);
      };
      reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }

  async function storeCustomResume(file) {
    if (!file) return;
    const person = await getActivePerson().catch(() => null);
    const base64 = await readFileAsBase64(file);
    await chrome.storage.local.set({
      [EMAIL_BID_CUSTOM_RESUME_KEY]: {
        profileId: person?.id || "",
        fileName: file.name || "Resume.pdf",
        mimeType: file.type || "application/pdf",
        base64,
        savedAt: Date.now()
      }
    });
    setStatus(`Custom email resume: ${file.name}`);
  }

  async function prepare() {
    const person = await getActivePerson().catch(() => null);
    if (!person?.email) {
      setStatus("Set the active profile email first.");
      return;
    }
    const jobMeta = collectJobMeta(person);
    if (!jobMeta.company && !jobMeta.jdLink && !jobMeta.jdText) {
      setStatus("Add company, link, or JD for Email Bid.");
      return;
    }
    setBusy(true);
    setStatus("Email Bid · finding hiring contacts & drafting…");
    const res = await chrome.runtime.sendMessage({ type: "email_bid_prepare", jobMeta });
    if (!res?.ok) {
      setBusy(false);
      setStatus(res?.error || "Email Bid prepare failed to start.");
    }
  }

  async function resolveResumeAttachment() {
    const person = await getActivePerson().catch(() => null);
    const store = await chrome.storage.local.get([EMAIL_BID_CUSTOM_RESUME_KEY]);
    const custom = store[EMAIL_BID_CUSTOM_RESUME_KEY];
    if (
      custom?.base64 &&
      (!custom.profileId || !person?.id || custom.profileId === person.id)
    ) {
      return {
        fileName: custom.fileName || "Resume.pdf",
        mimeType: custom.mimeType || "application/pdf",
        base64: String(custom.base64).replace(/^data:[^;]+;base64,/, "")
      };
    }
    const res = await chrome.runtime
      .sendMessage({
        type: "email_bid_resume_attachment",
        jobMeta: draftCache?.jobMeta || collectJobMeta(person)
      })
      .catch(() => null);
    if (res?.ok && res.attachment?.base64) {
      return {
        fileName: res.attachment.fileName || "Resume.pdf",
        mimeType: res.attachment.mimeType || "application/pdf",
        base64: String(res.attachment.base64).replace(/^data:[^;]+;base64,/, "")
      };
    }
    return null;
  }

  async function downloadResumeAttachment(att) {
    if (!att?.base64) return null;
    const safeName = String(att.fileName || "Resume.pdf").replace(/[\\/:*?"<>|]/g, "_");
    const url = `data:${att.mimeType || "application/pdf"};base64,${att.base64}`;
    const downloadId = await chrome.downloads.download({
      url,
      filename: `EmailBid/${safeName}`,
      conflictAction: "uniquify",
      saveAs: false
    });
    return { downloadId, fileName: safeName };
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Attach PDF once via Outlook/Gmail "Attach file" input — never Pictures, never retries
   * that re-fire change on every file input (that was duplicating the resume).
   */
  async function tryAttachResumeInComposeTab(tabId, att) {
    if (!att?.base64 || !tabId) return false;
    if (att.base64.length > 700_000) return false;
    const wantName = String(att.fileName || "Resume.pdf");

    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(attempt === 0 ? 2000 : 800);
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          args: [wantName, att.base64, att.mimeType || "application/pdf"],
          func: (fileName, base64, mimeType) => {
            try {
              const FLAG = "__brightstarEmailBidAttached";
              if (window[FLAG]) {
                return { ok: true, via: "already-injected", skipped: true };
              }

              const pageText = String(document.body?.innerText || "");
              // Outlook shows each attachment chip with the file name — bail if present.
              if (fileName && pageText.includes(fileName)) {
                window[FLAG] = true;
                return { ok: true, via: "already-on-page", skipped: true };
              }

              const labelOf = (el) =>
                `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${
                  el.textContent || ""
                }`.toLowerCase();

              const isPictureControl = (el) => {
                const t = labelOf(el);
                return /picture|photo|image|inline image|insert picture/.test(t);
              };

              const acceptsPdf = (input) => {
                const accept = String(input.getAttribute("accept") || "")
                  .toLowerCase()
                  .trim();
                if (/image\//.test(accept) && !/pdf|application\//.test(accept)) return false;
                if (!accept || accept === "*" || accept === "*/*") return true;
                return /pdf|application\/pdf|\.pdf|application\/\*/.test(accept);
              };

              const scoreInput = (input) => {
                const accept = String(input.getAttribute("accept") || "").toLowerCase();
                const id = `${input.id || ""} ${input.name || ""} ${input.className || ""}`.toLowerCase();
                let score = 0;
                if (/pdf/.test(accept)) score += 5;
                if (/attach|file|upload|document/.test(id)) score += 3;
                if (/image\//.test(accept)) score -= 10;
                if (input.multiple) score -= 1;
                return score;
              };

              // Reveal Attach file once (do not click on every retry after inject).
              if (!window.__brightstarEmailBidAttachClicked) {
                const candidates = Array.from(
                  document.querySelectorAll(
                    'button, div[role="button"], span[role="button"], div[data-icon-name], button[data-icon-name]'
                  )
                );
                const preferred = candidates.find((el) => {
                  if (isPictureControl(el)) return false;
                  const t = labelOf(el);
                  const icon = `${el.getAttribute("data-icon-name") || ""}`.toLowerCase();
                  return (
                    /attach file|attach files/.test(t) ||
                    icon === "attach" ||
                    icon === "attachregular" ||
                    icon === "attach20regular"
                  );
                });
                if (preferred) {
                  preferred.click();
                  window.__brightstarEmailBidAttachClicked = true;
                }
              }

              const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
                .filter(acceptsPdf)
                .sort((a, b) => scoreInput(b) - scoreInput(a));

              const input = inputs[0];
              if (!input) {
                // Allow another Attach click on the next poll if the ribbon wasn't ready.
                window.__brightstarEmailBidAttachClicked = false;
                return {
                  ok: false,
                  inputs: document.querySelectorAll('input[type="file"]').length,
                  pdfInputs: 0
                };
              }

              const bin = atob(base64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const file = new File([bytes], fileName, { type: mimeType || "application/pdf" });
              const dt = new DataTransfer();
              dt.items.add(file);

              // Mark BEFORE dispatch so concurrent/retry scripts cannot multi-attach.
              window[FLAG] = true;
              input.files = dt.files;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));

              return {
                ok: true,
                via: "file-input-once",
                accept: input.getAttribute("accept") || "",
                inputCount: inputs.length
              };
            } catch (err) {
              return { ok: false, error: String(err?.message || err) };
            }
          }
        });
        const result = results?.[0]?.result;
        if (result?.ok) return true;
      } catch {
        /* tab may still be loading */
      }
    }
    return false;
  }

  async function openWebCompose() {
    const person = await getActivePerson().catch(() => null);
    const from =
      readMailboxEmail() ||
      String(person?.email || "").trim().toLowerCase();
    const toEmails = selectedRecipients();
    if (!toEmails.length) {
      setStatus("Select at least one recipient in To.");
      return;
    }
    const subject = subjectEl?.value?.trim() || "";
    const body = bodyEl?.value?.trim() || "";
    if (!subject || !body) {
      setStatus("Subject and message are required.");
      return;
    }

    const att = await resolveResumeAttachment();
    let downloadedName = "";
    if (att) {
      try {
        const dl = await downloadResumeAttachment(att);
        downloadedName = dl?.fileName || att.fileName || "Resume.pdf";
      } catch (err) {
        setStatus(`Resume download failed: ${String(err?.message || err)}`);
      }
    } else {
      setStatus("No resume PDF — pick Resume PDF first.");
    }

    const url = buildWebComposeUrl(from, { to: toEmails, subject, body });
    const tab = await chrome.tabs.create({ url, active: true });

    let injected = false;
    if (att && tab?.id) {
      injected = await tryAttachResumeInComposeTab(tab.id, att);
    }

    setStatus(
      injected
        ? "Email Bid · compose opened with resume attached"
        : downloadedName
          ? `Email Bid · resume in Downloads/EmailBid/${downloadedName} — use Attach file (paperclip), not Pictures`
          : "Email Bid · opened compose (no resume PDF)"
    );

    chrome.runtime
      .sendMessage({ type: "email_bid_cleanup_chats", quiet: true })
      .catch(() => {});
  }

  async function confirmSend() {
    const person = await getActivePerson().catch(() => null);
    const from =
      readMailboxEmail() ||
      String(person?.email || "").trim().toLowerCase();
    if (!from) {
      setStatus("Enter an email address first.");
      return;
    }
    const toEmails = selectedRecipients();
    if (!toEmails.length) {
      setStatus("Select at least one recipient in To.");
      return;
    }
    const subject = subjectEl?.value?.trim() || "";
    const body = bodyEl?.value?.trim() || "";
    if (!subject || !body) {
      setStatus("Subject and message are required.");
      return;
    }
    const box = await getProfileMailbox(person?.id || "", from).catch(() => null);
    if (!box?.connected) {
      await openWebCompose();
      return;
    }
    const jobMeta = draftCache?.jobMeta || collectJobMeta(person);
    setBusy(true);
    setStatus(`Email Bid · sending to ${toEmails.length} recipient(s)…`);
    const res = await chrome.runtime.sendMessage({
      type: "email_bid_send",
      toEmails,
      subject,
      body,
      jobMeta
    });
    if (!res?.ok) {
      setBusy(false);
      setStatus(res?.error || "Email Bid send failed to start.");
    }
  }

  async function fillFromTab() {
    setStatus("Scraping active tab for Email Bid…");
    try {
      const res = await chrome.runtime.sendMessage({ type: "scrape_active_job_tab" });
      if (!res?.ok) {
        setStatus(res?.error || "Could not scrape this tab.");
        return;
      }
      if (titleEl && (res.jobTitle || res.title)) titleEl.value = res.jobTitle || res.title;
      if (companyEl && (res.companyName || res.company)) {
        companyEl.value = res.companyName || res.company;
      }
      if (jdLinkEl && res.jdLink) jdLinkEl.value = res.jdLink;
      if (jdTextEl && (res.jdText || res.description)) {
        jdTextEl.value = res.jdText || res.description;
      }
      setStatus("Email Bid fields filled from tab.");
    } catch (err) {
      setStatus(`Scrape failed: ${String(err?.message || err)}`);
    }
  }

  toggleBtn?.addEventListener("click", () => {
    setPanelOpen(Boolean(panelBody?.hidden));
    if (panelBody && !panelBody.hidden) refreshFromAndMailbox().catch(() => {});
  });
  fillTabBtn?.addEventListener("click", () => fillFromTab().catch((e) => setStatus(String(e.message || e))));
  prepareBtn?.addEventListener("click", () => prepare().catch((e) => setStatus(String(e.message || e))));
  confirmBtn?.addEventListener("click", () => confirmSend().catch((e) => setStatus(String(e.message || e))));
  openWebBtn?.addEventListener("click", () => openWebCompose().catch((e) => setStatus(String(e.message || e))));
  mailboxSaveBtn?.addEventListener("click", () => saveMailbox().catch((e) => setStatus(String(e.message || e))));
  mailboxDisconnectBtn?.addEventListener("click", () =>
    disconnectMailbox().catch((e) => setStatus(String(e.message || e)))
  );
  emailEl?.addEventListener("input", () => {
    if (emailEl) emailEl.dataset.touched = "1";
  });
  customResumeEl?.addEventListener("change", () => {
    const file = customResumeEl.files?.[0];
    if (file) storeCustomResume(file).catch((e) => setStatus(String(e.message || e)));
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "email_bid_toast") {
      const kind = message.kind === "err" || message.kind === "info" ? message.kind : "ok";
      if (message.message) setStatus(String(message.message));
      if (kind === "ok" || kind === "err") setBusy(false);
    }
    if (message?.type === "email_bid_prepare_done") {
      setBusy(false);
      if (!message.ok) {
        setStatus(message.error || "Email Bid prepare failed.");
        return;
      }
      applyDraft(message.draft);
      setStatus(
        `Email Bid draft ready — ${(message.draft?.toEmails || []).length} recipient(s)`
      );
      setPanelOpen(true);
    }
    if (message?.type === "email_bid_send_done") {
      setBusy(false);
      setStatus(
        message.ok ? message.status || "Email Bid sent" : message.error || "Email Bid send failed"
      );
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[EMAIL_BID_CUSTOM_RESUME_KEY] || changes[EMAIL_BID_MAILBOX_KEY]) {
      refreshFromAndMailbox().catch(() => {});
    }
    if (changes.active_person_id || changes.selected_profile_id) {
      refreshFromAndMailbox().catch(() => {});
    }
  });

  refreshFromAndMailbox().catch(() => {});

  return { refreshFromAndMailbox, setPanelOpen };
}
