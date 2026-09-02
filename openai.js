export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export function estimateTokensFromText(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

export function estimateTokensFromMessages(messages = []) {
  return (messages || []).reduce((n, m) => n + estimateTokensFromText(m?.content), 0);
}

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Call OpenAI Chat Completions from the background service worker.
 */
export async function chatCompletion({
  apiKey,
  model = DEFAULT_OPENAI_MODEL,
  messages,
  jsonMode = false,
  temperature = 0.4,
  maxTokens = DEFAULT_MAX_TOKENS
}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error(
      "OpenAI API key is missing. Add OPENAI_API_KEY to the extension .env file, then reload the extension."
    );
  }
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error("OpenAI messages are required.");
  }

  const body = {
    model: String(model || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error(`OpenAI request failed: ${String(err?.message || err)}`);
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
      throw new Error("OpenAI API key is invalid or revoked (401).");
    }
    if (response.status === 429) {
      throw new Error(`OpenAI rate limit exceeded (429): ${apiMessage}`);
    }
    throw new Error(`OpenAI error (HTTP ${response.status}): ${apiMessage}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI returned an empty response.");
  }
  const usageRaw = payload?.usage || {};
  const promptTokens = Number(usageRaw.prompt_tokens) || estimateTokensFromMessages(messages);
  const completionTokens = Number(usageRaw.completion_tokens) || estimateTokensFromText(content);
  return {
    content: content.trim(),
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: Number(usageRaw.total_tokens) || promptTokens + completionTokens,
      estimated: !usageRaw.prompt_tokens
    }
  };
}
