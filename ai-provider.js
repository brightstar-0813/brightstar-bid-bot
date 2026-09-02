/** Shared ChatGPT / Claude provider preference for popup + background. */

export const AI_PROVIDER_KEY = "ai_provider";

export const AI_PROVIDERS = Object.freeze({
  CHATGPT: "chatgpt",
  CLAUDE: "claude"
});

export function normalizeAiProvider(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (v === "claude" || v === "anthropic") return AI_PROVIDERS.CLAUDE;
  return AI_PROVIDERS.CHATGPT;
}

export function aiProviderLabel(provider) {
  return normalizeAiProvider(provider) === AI_PROVIDERS.CLAUDE ? "Claude" : "ChatGPT";
}

export function aiProviderHomeUrl(provider) {
  return normalizeAiProvider(provider) === AI_PROVIDERS.CLAUDE
    ? "https://claude.ai/new"
    : "https://chatgpt.com/";
}

export function aiProviderNewChatUrl(provider) {
  return normalizeAiProvider(provider) === AI_PROVIDERS.CLAUDE
    ? "https://claude.ai/new"
    : "https://chatgpt.com/";
}

export function isChatGptUrl(url) {
  return (
    typeof url === "string" &&
    (url.startsWith("https://chatgpt.com/") || url.startsWith("https://chat.openai.com/"))
  );
}

export function isClaudeUrl(url) {
  return typeof url === "string" && /^https:\/\/claude\.ai(\/|$)/i.test(url);
}

export function isAiProviderUrl(url, provider) {
  return normalizeAiProvider(provider) === AI_PROVIDERS.CLAUDE
    ? isClaudeUrl(url)
    : isChatGptUrl(url);
}
