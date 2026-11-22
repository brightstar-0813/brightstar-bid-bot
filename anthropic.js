export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";
/** Optional stronger model for one-off Custom Q&A Ask (costs more). */
export const QUALITY_ANTHROPIC_MODEL = "claude-opus-4-5";

const DEFAULT_MAX_TOKENS = 4096;
const ANTHROPIC_VERSION = "2023-06-01";

function estimateTokensFromText(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

function estimateTokensFromMessages(messages = []) {
  return (messages || []).reduce((n, m) => n + estimateTokensFromText(m?.content), 0);
}

/** Split OpenAI-style messages into Anthropic system + messages. */
export function toAnthropicPayload(messages = []) {
  const systemParts = [];
  const out = [];
  for (const m of messages || []) {
    const role = String(m?.role || "").trim();
    const content = String(m?.content || "");
    if (!role || !content) continue;
    if (role === "system") {
      systemParts.push(content);
      continue;
    }
    if (role === "user" || role === "assistant") {
      out.push({ role, content });
    }
  }
  return {
    system: systemParts.join("\n\n").trim(),
    messages: out
  };
}

/**
 * Call Anthropic Messages API from the background service worker.
 * Accepts OpenAI-style messages (system/user/assistant).
 */
export async function chatCompletion({
  apiKey,
  model = DEFAULT_ANTHROPIC_MODEL,
  messages,
  jsonMode = false,
  temperature = 0.4,
  maxTokens = DEFAULT_MAX_TOKENS
}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error(
      "Anthropic API key is missing. Add ANTHROPIC_API_KEY to the extension .env file, then reload the extension."
    );
  }
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error("Anthropic messages are required.");
  }

  const { system, messages: anthropicMessages } = toAnthropicPayload(messages);
  if (!anthropicMessages.length) {
    throw new Error("Anthropic user/assistant messages are required.");
  }

  let systemText = system;
  if (jsonMode) {
    systemText = [systemText, "Return only valid JSON. No markdown fences, no commentary."]
      .filter(Boolean)
      .join("\n\n");
  }

  const body = {
    model: String(model || DEFAULT_ANTHROPIC_MODEL).trim() || DEFAULT_ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    temperature,
    messages: anthropicMessages
  };
  if (systemText) body.system = systemText;

  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error(`Anthropic request failed: ${String(err?.message || err)}`);
  }

  let payload = null;
  const rawText = await response.text();
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const apiMessage = payload?.error?.message || rawText.slice(0, 200);
    if (response.status === 401) {
      throw new Error("Anthropic API key is invalid or revoked (401).");
    }
    if (response.status === 429) {
      throw new Error(`Anthropic rate limit exceeded (429): ${apiMessage}`);
    }
    throw new Error(`Anthropic error (HTTP ${response.status}): ${apiMessage}`);
  }

  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const content = blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!content) {
    throw new Error("Anthropic returned an empty response.");
  }

  const usageRaw = payload?.usage || {};
  const promptTokens = Number(usageRaw.input_tokens) || estimateTokensFromMessages(messages);
  const completionTokens = Number(usageRaw.output_tokens) || estimateTokensFromText(content);
  return {
    content,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      estimated: !usageRaw.input_tokens
    }
  };
}
