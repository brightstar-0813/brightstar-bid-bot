/**
 * Resume + cover letter generation via the Anthropic Messages API.
 * On when the AI engine is Claude API (ANTHROPIC_API_KEY in .env).
 */
import { chatCompletion, DEFAULT_ANTHROPIC_MODEL } from "./anthropic.js";
import { getEnv } from "./env.js";
import { AI_PROVIDER_KEY, AI_PROVIDERS, normalizeAiProvider } from "./ai-provider.js";

export async function isClaudeApiDocsEnabled() {
  try {
    const data = await chrome.storage.local.get(AI_PROVIDER_KEY);
    return normalizeAiProvider(data[AI_PROVIDER_KEY]) === AI_PROVIDERS.CLAUDE_API;
  } catch {
    return false;
  }
}

export async function getClaudeDocsSettings() {
  const apiKey = await getEnv("ANTHROPIC_API_KEY");
  const model = (await getEnv("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)) || DEFAULT_ANTHROPIC_MODEL;
  return { apiKey, model };
}

export async function completeClaudeResumeJson({
  apiKey,
  model = DEFAULT_ANTHROPIC_MODEL,
  prompt
}) {
  const { content } = await chatCompletion({
    apiKey,
    model,
    messages: [
      {
        role: "system",
        content:
          "Return only the resume JSON object requested by the user. No markdown fences, no commentary."
      },
      { role: "user", content: String(prompt || "") }
    ],
    jsonMode: true,
    temperature: 0.4
  });
  return content;
}

export async function completeClaudeCoverLetter({
  apiKey,
  model = DEFAULT_ANTHROPIC_MODEL,
  prompt
}) {
  const { content } = await chatCompletion({
    apiKey,
    model,
    messages: [
      {
        role: "system",
        content:
          "Write only the cover letter plain text requested by the user. No JSON, no markdown fences, no commentary."
      },
      { role: "user", content: String(prompt || "") }
    ],
    jsonMode: false,
    temperature: 0.5,
    maxTokens: 1200
  });
  return content;
}
