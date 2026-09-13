import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_PROVIDERS,
  aiProviderHomeUrl,
  aiProviderLabel,
  isAiProviderUrl,
  normalizeAiProvider
} from "../ai-provider.js";

test("AI provider normalizes ChatGPT and Claude aliases", () => {
  assert.equal(normalizeAiProvider("chatgpt"), AI_PROVIDERS.CHATGPT);
  assert.equal(normalizeAiProvider(""), AI_PROVIDERS.CHATGPT);
  assert.equal(normalizeAiProvider("Claude"), AI_PROVIDERS.CLAUDE);
  assert.equal(normalizeAiProvider("anthropic"), AI_PROVIDERS.CLAUDE);
  assert.equal(aiProviderLabel("claude"), "Claude");
  assert.equal(aiProviderLabel("chatgpt"), "ChatGPT");
});

test("AI provider URLs and host checks", () => {
  assert.match(aiProviderHomeUrl("chatgpt"), /chatgpt\.com/);
  assert.match(aiProviderHomeUrl("claude"), /claude\.ai/);
  assert.equal(isAiProviderUrl("https://chatgpt.com/c/abc", "chatgpt"), true);
  assert.equal(isAiProviderUrl("https://claude.ai/chat/abc", "claude"), true);
  assert.equal(isAiProviderUrl("https://claude.ai/new", "chatgpt"), false);
});
