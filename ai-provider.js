/** Shared ChatGPT / Claude provider preference for popup + background. */

export const AI_PROVIDER_KEY = "ai_provider";

/** When true (default), finished job chats are removed from ChatGPT/Claude history. */
export const DELETE_AI_CHAT_HISTORY_KEY = "delete_ai_chat_history";

export const AI_PROVIDERS = Object.freeze({
  CHATGPT: "chatgpt",
  CLAUDE: "claude",
  OPENAI: "openai"
});

/** Logged-in ChatGPT Codex. Custom Q&A only — resume harvest stays on the selected engine. */
export const CODEX_HOME_URL = "https://chatgpt.com/codex";

export function normalizeAiProvider(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (v === "claude" || v === "anthropic") return AI_PROVIDERS.CLAUDE;
  if (v === "openai" || v === "openai-api") return AI_PROVIDERS.OPENAI;
  return AI_PROVIDERS.CHATGPT;
}

export function aiProviderLabel(provider) {
  const normalized = normalizeAiProvider(provider);
  if (normalized === AI_PROVIDERS.CLAUDE) return "Claude";
  if (normalized === AI_PROVIDERS.OPENAI) return "OpenAI";
  return "ChatGPT";
}

export function aiProviderHomeUrl(provider) {
  const normalized = normalizeAiProvider(provider);
  if (normalized === AI_PROVIDERS.CLAUDE) return "https://claude.ai/new";
  if (normalized === AI_PROVIDERS.OPENAI) return "";
  return "https://chatgpt.com/";
}

export function aiProviderNewChatUrl(provider) {
  const normalized = normalizeAiProvider(provider);
  if (normalized === AI_PROVIDERS.CLAUDE) return "https://claude.ai/new";
  if (normalized === AI_PROVIDERS.OPENAI) return "";
  return "https://chatgpt.com/";
}

export async function isDeleteAiChatHistoryEnabled() {
  try {
    const data = await chrome.storage.local.get(DELETE_AI_CHAT_HISTORY_KEY);
    return data[DELETE_AI_CHAT_HISTORY_KEY] !== false;
  } catch {
    return true;
  }
}

export function isChatGptUrl(url) {
  return (
    typeof url === "string" &&
    (url.startsWith("https://chatgpt.com/") || url.startsWith("https://chat.openai.com/"))
  );
}

/** True for the Codex app shell, not a normal ChatGPT /c/ thread. */
export function isCodexUrl(url) {
  if (!isChatGptUrl(url)) return false;
  try {
    const path = new URL(url).pathname || "";
    return path === "/codex" || path.startsWith("/codex/");
  } catch {
    return false;
  }
}

export function isClaudeUrl(url) {
  return typeof url === "string" && /^https:\/\/claude\.ai(\/|$)/i.test(url);
}

export function isAiProviderUrl(url, provider) {
  const normalized = normalizeAiProvider(provider);
  if (normalized === AI_PROVIDERS.OPENAI) return false;
  return normalized === AI_PROVIDERS.CLAUDE ? isClaudeUrl(url) : isChatGptUrl(url);
}
