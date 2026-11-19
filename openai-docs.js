/**
 * Optional resume + cover letter generation via the OpenAI API.
 * Off unless `.env` has OPENAI_DOCS=1. Q&A leftovers use OPENAI_API_KEY either way.
 */
import { chatCompletion, DEFAULT_OPENAI_MODEL } from "./openai.js";
import { getEnv } from "./env.js";
import { AI_PROVIDER_KEY, AI_PROVIDERS, normalizeAiProvider } from "./ai-provider.js";

/** True when `.env` has OPENAI_DOCS=1. The AI engine button is the other switch. */
export function isOpenAiDocsFlag(value) {
  return String(value ?? "").trim() === "1";
}

export async function isOpenAiDocsEnabled() {
  if (isOpenAiDocsFlag(await getEnv("OPENAI_DOCS", ""))) return true;
  try {
    const data = await chrome.storage.local.get(AI_PROVIDER_KEY);
    return normalizeAiProvider(data[AI_PROVIDER_KEY]) === AI_PROVIDERS.OPENAI;
  } catch {
    return false;
  }
}

export async function getOpenAiDocsSettings() {
  const apiKey = await getEnv("OPENAI_API_KEY");
  const model = (await getEnv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)) || DEFAULT_OPENAI_MODEL;
  return { apiKey, model };
}

export async function completeResumeJson({ apiKey, model = DEFAULT_OPENAI_MODEL, prompt }) {
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

export async function completeCoverLetter({ apiKey, model = DEFAULT_OPENAI_MODEL, prompt }) {
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
