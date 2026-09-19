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
  formatSmtpConnectError,
  isPersonalMicrosoftMailbox
} from "./email-send.js";

/**
 * @param {{
 *   getActivePerson: () => Promise<object|null>,
 *   setStatus: (msg: string) => void,
 *   setBusy: (busy: boolean) => void,
 *   showToast: (msg: string, opts?: object) => void,
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
    showToast,
    DEFAULT_TEMPLATE_ID,
    templateSelectEl,
    spreadsheetUrlEl,
    sheetsWebAppUrlEl
  } = deps;

  const toggleBtn = document.getElementById("toggleEmailBidPanel");
  const panelBody = document.getElementById("emailBidPanelBody");
  const fromHint = document.getElementById("emailBidFromHint");
  const titleEl = document.getElementById("emailBidTitle");
  const companyEl = document.getElementById("emailBidCompany");
  const jdLinkEl = document.getElementById("emailBidJdLink");
  const jdTextEl = document.getElementById("emailBidJdText");
  const fillTabBtn = document.getElementById("emailBidFillTab");
  const prepareBtn = document.getElementById("emailBidPrepare");
  const mailboxHint = document.getElementById("emailBidMailboxHint");
  const emailEl = document.getElementById("emailBidMailboxEmail");
  const passwordEl = document.getElementById("emailBidMailboxPassword");
  const mailboxSaveBtn = document.getElementById("emailBidMailboxSave");
  const mailboxDisconnectBtn = document.getElementById("emailBidMailboxDisconnect");
  const mailboxStatus = document.getElementById("emailBidMailboxStatus");
  const draftBlock = document.getElementById("emailBidDraftBlock");
  const toListEl = document.getElementById("emailBidToList");
  const subjectEl = document.getElementById("emailBidSubject");
  const bodyEl = document.getElementById("emailBidBody");
  const customResumeEl = document.getElementById("emailBidCustomResume");
  const attachHint = document.getElementById("emailBidAttachHint");
  const confirmBtn = document.getElementById("emailBidConfirmSend");
  const openWebBtn = document.getElementById("emailBidOpenWeb");
  const statusHint = document.getElementById("emailBidStatusHint");

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
    if (fromHint) {
      fromHint.textContent = email
        ? `From: ${email} · finds Recruiters, HR, CTO, Leads · sheet on send`
        : "From: — enter email below or set active profile email";
    }
    if (mailboxHint) {
      mailboxHint.textContent = isPersonalMicrosoftMailbox(email)
        ? "Outlook.com often blocks password SMTP — use Open in Outlook / Gmail if Connect fails."
        : "SMTP needs an app password. If Connect times out, use Open in Outlook / Gmail.";
    }
    if (emailEl && emailEl.dataset.touched !== "1") {
      emailEl.value = email;
    }
    if (passwordEl) {
      passwordEl.placeholder = box?.password
        ? "•••••••• (saved — leave blank to keep)"
        : "App password";
    }
    if (mailboxStatus) {
      mailboxStatus.textContent =
        box?.connected && box.email
          ? `Connected: ${box.email}`
          : "Not connected — enter email + password, then Connect";
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
        const src = c.source ? ` · ${escapeHtml(c.source)}` : "";
        return `<label class="email-bid-to-row">
          <input type="checkbox" data-email="${escapeHtml(email)}" ${checked ? "checked" : ""} />
          <span class="email-bid-to-meta">
            <strong>${escapeHtml(c.name || email)}</strong>
            <span class="email-bid-to-email">${escapeHtml(email)}</span>
            <span class="email-bid-to-role">${escapeHtml(c.role || "")}${conf}${src}</span>
          </span>
        </label>`;
      })
      .join("");
    if (!toListEl.innerHTML) {
      toListEl.innerHTML = `<p class="hint">No contacts yet — Find contacts &amp; draft.</p>`;
    }
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
    const names = (draft.attachments || []).map((a) => a.fileName).filter(Boolean);
    if (attachHint) {
      attachHint.textContent = names.length
        ? `Attachments: ${names.join(", ")}`
        : "Attachments: last generated resume/cover unless you pick a PDF";
    }
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
      showToast("Enter an email address", { kind: "err" });
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
      showToast(`Mailbox connected: ${email}`, { kind: "ok" });
    } catch (err) {
      const msg = formatSmtpConnectError(err, email);
      if (mailboxStatus) mailboxStatus.textContent = `Connect failed — ${msg.slice(0, 140)}`;
      setStatus(`Mailbox connect failed: ${msg}`);
      showToast(msg, { kind: "err", duration: 7000 });
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
    if (attachHint) attachHint.textContent = `Custom resume: ${file.name}`;
    setStatus(`Custom email resume: ${file.name}`);
    showToast("Custom resume saved for Email Bid", { kind: "ok" });
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
    if (statusHint) statusHint.textContent = "Finding hiring contacts…";
    setBusy(true);
    setStatus("Email Bid · finding hiring contacts & drafting…");
    const res = await chrome.runtime.sendMessage({ type: "email_bid_prepare", jobMeta });
    if (!res?.ok) {
      setBusy(false);
      if (statusHint) statusHint.textContent = res?.error || "Failed";
      setStatus(res?.error || "Email Bid prepare failed to start.");
    }
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
    const url = buildWebComposeUrl(from, { to: toEmails, subject, body });
    await chrome.tabs.create({ url, active: true });
    if (statusHint) {
      statusHint.textContent =
        "Opened web compose — attach resume PDF there, then Send. SMTP Connect not required.";
    }
    setStatus("Email Bid · opened Outlook/Gmail compose (attach resume, then Send)");
    showToast("Attach your resume in the browser, then Send", { kind: "ok", duration: 5000 });
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
      // This network often blocks SMTP TLS — fall back to web compose instead of failing.
      await openWebCompose();
      return;
    }
    const jobMeta = draftCache?.jobMeta || collectJobMeta(person);
    if (statusHint) statusHint.textContent = "Sending…";
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
      if (statusHint) statusHint.textContent = res?.error || "Failed";
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
      showToast(String(message.message || ""), { kind, duration: 4200 });
      if (message.message) setStatus(String(message.message));
      if (statusHint && message.message) statusHint.textContent = String(message.message);
      if (kind === "ok" || kind === "err") setBusy(false);
    }
    if (message?.type === "email_bid_prepare_done") {
      setBusy(false);
      if (!message.ok) {
        if (statusHint) statusHint.textContent = message.error || "Prepare failed";
        setStatus(message.error || "Email Bid prepare failed.");
        return;
      }
      applyDraft(message.draft);
      if (statusHint) {
        statusHint.textContent = `Draft ready — ${(message.draft?.toEmails || []).length} recipient(s). Review To, then Confirm & Send.`;
      }
      setPanelOpen(true);
    }
    if (message?.type === "email_bid_send_done") {
      setBusy(false);
      if (statusHint) {
        statusHint.textContent = message.ok
          ? message.status || "Sent"
          : message.error || "Send failed";
      }
      if (message.ok) showToast(message.status || "Email Bid sent", { kind: "ok" });
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
