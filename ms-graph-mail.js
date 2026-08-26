/**
 * Microsoft Graph mail helper for Greenhouse security codes (personal Outlook).
 * OAuth via chrome.identity.launchWebAuthFlow; tokens in chrome.storage.local.
 */

import { getEnv } from "./env.js";

const TOKEN_STORAGE_KEY = "ms_graph_tokens";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const AUTH_BASE = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPES = ["openid", "profile", "offline_access", "Mail.Read", "User.Read"].join(" ");

/**
 * Extract Greenhouse-style security codes from email body text/HTML.
 * Prefers standalone alphanumeric tokens (e.g. 0wPbvHmX).
 * @param {string} body
 * @returns {string}
 */
export function extractGreenhouseSecurityCode(body = "") {
  const text = String(body || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "");

  const isPlausibleCode = (token) => {
    const t = String(token || "").trim();
    if (!/^[A-Za-z0-9]{6,12}$/.test(t)) return false;
    if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return false;
    if (
      /^(security|verification|greenhouse|application|resubmit|continue|submit|confirm)$/i.test(t)
    ) {
      return false;
    }
    return true;
  };

  const labeled =
    text.match(
      /(?:security\s*code|verification\s*code|enter\s+(?:the\s+)?code|copy\s+and\s+paste\s+this\s+code)[\s\S]{0,120}?([A-Za-z0-9]{6,12})\b/i
    ) || text.match(/(?:code\s*(?:is|:))\s*([A-Za-z0-9]{6,12})\b/i);
  if (labeled?.[1] && isPlausibleCode(labeled[1])) {
    return labeled[1];
  }

  // Prominent standalone token on its own line (common in Greenhouse emails).
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (isPlausibleCode(line)) return line;
  }

  const loose = text.match(/\b([A-Za-z0-9]{8})\b/g) || [];
  for (const token of loose) {
    if (isPlausibleCode(token)) return token;
  }
  return "";
}

export async function getMsGraphClientId() {
  return getEnv("MS_GRAPH_CLIENT_ID", "");
}

export async function getGraphAuthStatus() {
  const data = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
  const tokens = data[TOKEN_STORAGE_KEY] || null;
  if (!tokens?.access_token && !tokens?.refresh_token) {
    return { connected: false, email: "", expiresAt: 0 };
  }
  return {
    connected: true,
    email: String(tokens.email || "").trim(),
    expiresAt: Number(tokens.expires_at || 0)
  };
}

export async function disconnectMsGraph() {
  await chrome.storage.local.remove(TOKEN_STORAGE_KEY);
  return { ok: true };
}

function redirectUri() {
  return chrome.identity.getRedirectURL("oauth2");
}

async function exchangeCode(clientId, code) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    scope: SCOPES
  });
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `Token exchange failed (${res.status})`);
  }
  return json;
}

async function refreshAccessToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: SCOPES
  });
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `Token refresh failed (${res.status})`);
  }
  return json;
}

async function saveTokens(tokenResponse, prior = {}) {
  const expiresIn = Number(tokenResponse.expires_in || 3600);
  const next = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || prior.refresh_token || "",
    expires_at: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    email: prior.email || "",
    scope: tokenResponse.scope || prior.scope || SCOPES
  };
  if (!next.email && next.access_token) {
    try {
      const me = await fetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName`, {
        headers: { Authorization: `Bearer ${next.access_token}` }
      });
      if (me.ok) {
        const profile = await me.json();
        next.email = String(profile.mail || profile.userPrincipalName || "").trim();
      }
    } catch {
      /* ignore */
    }
  }
  await chrome.storage.local.set({ [TOKEN_STORAGE_KEY]: next });
  return next;
}

export async function connectMsGraph() {
  const clientId = await getMsGraphClientId();
  if (!clientId) {
    throw new Error(
      "MS_GRAPH_CLIENT_ID is missing. Add it to .env after registering an Azure app (personal Microsoft accounts)."
    );
  }
  const authUrl =
    `${AUTH_BASE}/authorize?` +
    new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri(),
      response_mode: "query",
      scope: SCOPES,
      prompt: "select_account"
    }).toString();

  const redirected = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true
  });
  if (!redirected) throw new Error("Outlook sign-in was cancelled.");
  const redirectedUrl = new URL(redirected);
  const err = redirectedUrl.searchParams.get("error_description") || redirectedUrl.searchParams.get("error");
  if (err) throw new Error(err);
  const code = redirectedUrl.searchParams.get("code");
  if (!code) throw new Error("No authorization code returned from Microsoft.");
  const tokenResponse = await exchangeCode(clientId, code);
  const tokens = await saveTokens(tokenResponse);
  return { ok: true, email: tokens.email || "" };
}

async function getValidAccessToken() {
  const clientId = await getMsGraphClientId();
  if (!clientId) {
    throw new Error("MS_GRAPH_CLIENT_ID is missing in .env.");
  }
  const data = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
  let tokens = data[TOKEN_STORAGE_KEY] || null;
  if (!tokens?.access_token && !tokens?.refresh_token) {
    throw new Error("Outlook is not connected. Use Connect Outlook in the popup.");
  }
  if (tokens.access_token && Number(tokens.expires_at || 0) > Date.now() + 15_000) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) {
    throw new Error("Outlook session expired. Reconnect Outlook in the popup.");
  }
  const refreshed = await refreshAccessToken(clientId, tokens.refresh_token);
  tokens = await saveTokens(refreshed, tokens);
  return tokens.access_token;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll Graph for the newest Greenhouse security-code email after afterEpochMs.
 * @param {{ afterEpochMs?: number, timeoutMs?: number, pollMs?: number, mailboxHint?: string }} [opts]
 */
export async function fetchLatestGreenhouseSecurityCode(opts = {}) {
  const afterEpochMs = Number(opts.afterEpochMs || Date.now() - 5 * 60_000);
  const timeoutMs = Number(opts.timeoutMs || 120_000);
  const pollMs = Number(opts.pollMs || 4000);
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const accessToken = await getValidAccessToken();
      // Prefer $search for subject; fall back to recent inbox scan.
      const searchUrl =
        `${GRAPH_BASE}/me/messages?` +
        new URLSearchParams({
          $search: `"Security code"`,
          $select: "id,subject,from,receivedDateTime,bodyPreview,body",
          $top: "15",
          $orderby: "receivedDateTime desc"
        }).toString();

      let res = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ConsistencyLevel: "eventual"
        }
      });

      if (!res.ok) {
        // Fallback without $search (some tenants restrict it).
        const listUrl =
          `${GRAPH_BASE}/me/mailFolders/inbox/messages?` +
          new URLSearchParams({
            $select: "id,subject,from,receivedDateTime,bodyPreview,body",
            $top: "25",
            $orderby: "receivedDateTime desc"
          }).toString();
        res = await fetch(listUrl, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      }

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error?.message || `Graph mail failed (${res.status})`);
      }

      const messages = Array.isArray(json.value) ? json.value : [];
      const ranked = messages
        .map((msg) => {
          const from =
            String(msg.from?.emailAddress?.address || "").toLowerCase() +
            " " +
            String(msg.from?.emailAddress?.name || "").toLowerCase();
          const subject = String(msg.subject || "");
          const received = Date.parse(msg.receivedDateTime || "") || 0;
          const greenhouseLike =
            /greenhouse/i.test(from) ||
            /greenhouse-mail\.io/i.test(from) ||
            /security\s*code/i.test(subject) ||
            /greenhouse/i.test(subject);
          return { msg, from, subject, received, greenhouseLike };
        })
        .filter((row) => row.greenhouseLike && row.received >= afterEpochMs - 30_000)
        .sort((a, b) => b.received - a.received);

      for (const row of ranked) {
        const bodyText =
          String(row.msg.body?.content || "") ||
          String(row.msg.bodyPreview || "");
        const code = extractGreenhouseSecurityCode(bodyText);
        if (code) {
          return {
            ok: true,
            code,
            subject: row.subject,
            receivedDateTime: row.msg.receivedDateTime || "",
            from: row.msg.from?.emailAddress?.address || ""
          };
        }
      }
    } catch (err) {
      lastError = String(err?.message || err);
      // Auth errors should stop early.
      if (/not connected|MS_GRAPH_CLIENT_ID|expired|Reconnect/i.test(lastError)) {
        return { ok: false, code: "", error: lastError };
      }
    }
    await sleep(pollMs);
  }

  return {
    ok: false,
    code: "",
    error: lastError || "Timed out waiting for a Greenhouse security code email."
  };
}
