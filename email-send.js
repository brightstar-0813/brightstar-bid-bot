/**
 * Email Bid SMTP — active profile email + app password via native host.
 */

import { NATIVE_HOST_NAME } from "./csv-source.js";

export const EMAIL_BID_MAILBOX_KEY = "email_bid_mailbox";
export const EMAIL_BID_CUSTOM_RESUME_KEY = "email_bid_custom_resume";

/**
 * @param {string} email
 * @returns {"gmail"|"outlook"|"unknown"}
 */
export function mailProviderForEmail(email) {
  const domain = String(email || "")
    .trim()
    .toLowerCase()
    .split("@")[1] || "";
  if (!domain) return "unknown";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (
    domain === "outlook.com" ||
    domain === "hotmail.com" ||
    domain === "live.com" ||
    domain === "msn.com" ||
    domain.endsWith(".onmicrosoft.com")
  ) {
    return "outlook";
  }
  return "unknown";
}

/**
 * @param {string} email
 */
export function smtpPresetForEmail(email) {
  const provider = mailProviderForEmail(email);
  if (provider === "gmail") {
    return { host: "smtp.gmail.com", port: 587, secure: false, label: "Gmail SMTP" };
  }
  if (provider === "outlook") {
    const domain = String(email || "")
      .trim()
      .toLowerCase()
      .split("@")[1] || "";
    // Personal Outlook.com / Hotmail — not smtp.office365.com (that is M365 work mail).
    if (
      domain === "outlook.com" ||
      domain === "hotmail.com" ||
      domain === "live.com" ||
      domain === "msn.com"
    ) {
      return {
        host: "smtp-mail.outlook.com",
        port: 587,
        secure: false,
        label: "Outlook.com SMTP"
      };
    }
    return {
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      label: "Microsoft 365 SMTP"
    };
  }
  const domain = String(email || "").split("@")[1] || "mail";
  return { host: `smtp.${domain}`, port: 587, secure: false, label: "Generic SMTP" };
}

export async function getMailboxConfig() {
  const data = await chrome.storage.local.get([EMAIL_BID_MAILBOX_KEY]);
  const raw = data[EMAIL_BID_MAILBOX_KEY] || {};
  return {
    profiles: raw.profiles && typeof raw.profiles === "object" ? raw.profiles : {}
  };
}

export async function saveMailboxConfig(patch = {}) {
  const prev = await getMailboxConfig();
  const next = {
    ...prev,
    ...patch,
    profiles: { ...(prev.profiles || {}), ...(patch.profiles || {}) }
  };
  await chrome.storage.local.set({ [EMAIL_BID_MAILBOX_KEY]: next });
  return next;
}

export async function getProfileMailbox(profileId, email) {
  const cfg = await getMailboxConfig();
  const byId = profileId ? cfg.profiles?.[profileId] : null;
  const byEmail = email ? cfg.profiles?.[String(email).toLowerCase()] : null;
  const entry = byId || byEmail || null;
  if (!entry) return null;
  return {
    email: String(entry.email || "").trim().toLowerCase(),
    password: String(entry.password || ""),
    smtpHost: String(entry.smtpHost || "").trim(),
    smtpPort: Number(entry.smtpPort) || 587,
    connected: Boolean(entry.connected),
    testedAt: entry.testedAt || 0
  };
}

export async function saveProfileMailbox(opts) {
  const email = String(opts.email || "").trim().toLowerCase();
  const profileId = String(opts.profileId || email || "").trim();
  const preset = smtpPresetForEmail(email);
  const entry = {
    email,
    password: String(opts.password || ""),
    smtpHost: String(opts.smtpHost || preset.host).trim() || preset.host,
    smtpPort: Number(opts.smtpPort) || preset.port,
    connected: Boolean(opts.connected),
    testedAt: opts.connected ? Date.now() : 0
  };
  const profiles = {};
  if (profileId) profiles[profileId] = entry;
  if (email) profiles[email] = entry;
  await saveMailboxConfig({ profiles });
  return entry;
}

/**
 * @param {string} email
 * @returns {boolean}
 */
export function isPersonalMicrosoftMailbox(email) {
  const domain = String(email || "")
    .trim()
    .toLowerCase()
    .split("@")[1] || "";
  return (
    domain === "outlook.com" ||
    domain === "hotmail.com" ||
    domain === "live.com" ||
    domain === "msn.com"
  );
}

/**
 * Build Outlook / Gmail web compose URL (HTTPS — works when SMTP TLS is blocked).
 * Use encodeURIComponent (spaces → %20). URLSearchParams uses + for spaces, which
 * Outlook Live paste into the body literally.
 * @param {string} fromEmail
 * @param {{ to?: string[], subject?: string, body?: string }} opts
 */
export function buildWebComposeUrl(fromEmail, opts = {}) {
  const to = (opts.to || []).map((e) => String(e).trim()).filter(Boolean).join(",");
  const subject = String(opts.subject || "");
  const body = String(opts.body || "").slice(0, 1800);
  const provider = mailProviderForEmail(fromEmail);
  const q = [];
  if (provider === "gmail") {
    q.push("view=cm", "fs=1");
    if (to) q.push(`to=${encodeURIComponent(to)}`);
    if (subject) q.push(`su=${encodeURIComponent(subject)}`);
    if (body) q.push(`body=${encodeURIComponent(body)}`);
    return `https://mail.google.com/mail/?${q.join("&")}`;
  }
  if (to) q.push(`to=${encodeURIComponent(to)}`);
  if (subject) q.push(`subject=${encodeURIComponent(subject)}`);
  if (body) q.push(`body=${encodeURIComponent(body)}`);
  return `https://outlook.live.com/mail/0/deeplink/compose?${q.join("&")}`;
}

/**
 * Rewrite opaque SMTP failures into actionable copy.
 * @param {unknown} err
 * @param {string} email
 */
export function formatSmtpConnectError(err, email = "") {
  const raw = String(err?.message || err || "");
  const personalMs = isPersonalMicrosoftMailbox(email);
  if (/timed out|unexpectedly closed|handshake|TLS|SSL/i.test(raw)) {
    return (
      (personalMs
        ? "Outlook.com password SMTP is blocked here (TLS timeout). "
        : "SMTP TLS is blocked on this network. ") +
      "Use Open in Outlook / Gmail below — no Connect needed. Or try Gmail app-password SMTP from another network."
    );
  }
  if (/basic authentication is disabled|5\.7\.139|auth/i.test(raw) && personalMs) {
    return "Outlook.com no longer allows password/app-password SMTP. Use Open in Outlook below, or send from a Gmail address.";
  }
  return raw || "SMTP connect failed.";
}

export function mailboxMatchesProfile(fromEmail, connectedEmail) {
  const a = String(fromEmail || "").trim().toLowerCase();
  const b = String(connectedEmail || "").trim().toLowerCase();
  return Boolean(a && b && a === b);
}

/** Chrome native messaging hard-caps ~1MB per message. */
const NATIVE_MSG_SOFT_LIMIT = 900_000;

function sendNativeMessage(payload, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.sendNativeMessage) {
      reject(new Error("Native host required for SMTP. See native-host/README.md."));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          "Native host timed out (SMTP). Reinstall native-host if this persists; for @outlook.com use an app password on smtp-mail.outlook.com."
        )
      );
    }, timeoutMs);
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const err = chrome.runtime.lastError?.message;
      if (err) {
        reject(
          new Error(
            /Specified native messaging host not found|Access to the specified native messaging host is forbidden/i.test(
              err
            )
              ? "Native host not installed — run native-host/install-windows.ps1, then Connect again."
              : err
          )
        );
        return;
      }
      resolve(response);
    });
  });
}

function estimateNativePayloadBytes(payload) {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    return NATIVE_MSG_SOFT_LIMIT + 1;
  }
}

export async function testSmtpMailbox(creds) {
  const email = String(creds.email || "").trim().toLowerCase();
  const password = String(creds.password || "");
  if (!email) throw new Error("Email is missing.");
  if (!password) throw new Error("Enter the mailbox password.");
  const preset = smtpPresetForEmail(email);
  const host = String(creds.smtpHost || preset.host).trim() || preset.host;
  const port = Number(creds.smtpPort) || preset.port;
  try {
    const res = await sendNativeMessage(
      {
        type: "smtp_test",
        email,
        password,
        smtpHost: host,
        smtpPort: port
      },
      35000
    );
    if (!res?.ok) {
      throw new Error(formatSmtpConnectError(res?.error || "SMTP test failed.", email));
    }
    return { ok: true, host, port, email };
  } catch (err) {
    throw new Error(formatSmtpConnectError(err, email));
  }
}

export async function sendEmailBidMessage(msg) {
  const from = String(msg.from || "").trim().toLowerCase();
  const to = (msg.to || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  if (!from) throw new Error("Profile email is missing — set it on the active person.");
  if (!to.length) throw new Error("No contact emails to send to.");

  const box = await getProfileMailbox(msg.profileId || "", from);
  if (!box?.password) {
    throw new Error("Mailbox not connected — Email Bid → enter email + password, then Connect.");
  }
  if (box.email && !mailboxMatchesProfile(from, box.email)) {
    throw new Error(`Saved mailbox ${box.email} does not match From ${from}`);
  }
  if (!box.connected) {
    throw new Error("Mailbox not connected — click Connect successfully before sending.");
  }

  // Always use domain preset so a prior wrong host (e.g. office365 for outlook.com) cannot stick.
  const preset = smtpPresetForEmail(from);
  const attachments = (msg.attachments || [])
    .filter((a) => a?.fileName && (a?.base64 || a?.path))
    .map((a) => {
      const out = {
        fileName: a.fileName,
        mimeType: a.mimeType || "application/pdf"
      };
      if (a.path) out.path = String(a.path);
      if (a.base64) out.base64 = String(a.base64).replace(/^data:[^;]+;base64,/, "");
      return out;
    });

  const payload = {
    type: "smtp_send",
    email: from,
    password: box.password,
    smtpHost: preset.host,
    smtpPort: preset.port,
    to,
    subject: String(msg.subject || ""),
    bodyText: String(msg.bodyText || ""),
    attachments
  };
  const bytes = estimateNativePayloadBytes(payload);
  if (bytes > NATIVE_MSG_SOFT_LIMIT) {
    throw new Error(
      "Resume PDF is too large to send via the native host (~1MB limit). Use a smaller PDF or generate docs in-bot first."
    );
  }

  const res = await sendNativeMessage(payload, 120000);
  if (!res?.ok) throw new Error(res?.error || "SMTP send failed.");
  return { ok: true, provider: "smtp", to, from };
}
