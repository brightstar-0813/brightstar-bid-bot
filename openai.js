export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
/** Optional stronger model for one-off Custom Q&A Ask (costs more). */
export const QUALITY_OPENAI_MODEL = "gpt-4o";
/** Codex Custom Q&A. Served only by the Responses API, not Chat Completions. */
export const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";

/** Storage: when false, Autofill skips OpenAI leftovers (Custom Q&A Ask OpenAI engine still available). */
export const OPENAI_QA_ASSIST_KEY = "openai_qa_assist_enabled";

export async function isOpenAiQaAssistEnabled() {
  try {
    const data = await chrome.storage.local.get(OPENAI_QA_ASSIST_KEY);
    return data[OPENAI_QA_ASSIST_KEY] !== false;
  } catch {
    return true;
  }
}

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

/** Pull plain text from a Responses API payload. */
export function responsesOutputText(payload) {
  const direct = String(payload?.output_text || "").trim();
  if (direct) return direct;
  const chunks = [];
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      const text = String(part?.text || part?.refusal || "").trim();
      if (text) chunks.push(text);
    }
  }
  return chunks.join("\n").trim();
}

/**
 * Call the OpenAI Responses API. Required for Codex models such as gpt-5.3-codex.
 */
export async function responsesCompletion({
  apiKey,
  model = DEFAULT_CODEX_MODEL,
  messages,
  maxTokens = DEFAULT_MAX_TOKENS
}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error(
      "Codex API key is missing. Add CODEX_API_KEY or OPENAI_API_KEY to the extension .env file, then reload the extension."
    );
  }
  if (!Array.isArray(messages) || !messages.length) {
    throw new Error("Codex messages are required.");
  }

  const instructions = messages
    .filter((message) => message?.role === "system" && message.content)
    .map((message) => String(message.content))
    .join("\n\n");
  const input = messages
    .filter((message) => message && (message.role === "user" || message.role === "assistant") && message.content)
    .map((message) => ({
      role: message.role,
      content: String(message.content)
    }));
  if (!input.length) throw new Error("Codex messages are required.");

  const body = {
    model: String(model || DEFAULT_CODEX_MODEL).trim() || DEFAULT_CODEX_MODEL,
    input,
    max_output_tokens: maxTokens
  };
  if (instructions) body.instructions = instructions;

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error(`Codex request failed: ${String(err?.message || err)}`);
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
      throw new Error("Codex API key is invalid or revoked (401).");
    }
    if (response.status === 429) {
      throw new Error(`Codex rate limit exceeded (429): ${apiMessage}`);
    }
    throw new Error(`Codex error (HTTP ${response.status}): ${apiMessage}`);
  }

  const content = responsesOutputText(payload);
  if (!content) throw new Error("Codex returned an empty response.");
  const usageRaw = payload?.usage || {};
  const promptTokens = Number(usageRaw.input_tokens) || estimateTokensFromMessages(messages);
  const completionTokens = Number(usageRaw.output_tokens) || estimateTokensFromText(content);
  return {
    content,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: Number(usageRaw.total_tokens) || promptTokens + completionTokens,
      estimated: !usageRaw.input_tokens
    }
  };
}
