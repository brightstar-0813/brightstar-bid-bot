/**
 * Notify Slack via Incoming Webhook when a CSV batch finishes.
 * Create a webhook in Slack → Apps → Incoming WebHooks (or api.slack.com/apps)
 * and paste the https://hooks.slack.com/services/... URL into the extension.
 */

export function isSlackWebhookUrl(url) {
  const raw = String(url || "").trim();
  return /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_+-]+$/i.test(raw);
}

/**
 * @param {{
 *   webhookUrl: string,
 *   done?: number,
 *   failed?: number,
 *   skipped?: number,
 *   total?: number,
 *   personLabel?: string,
 *   outputDir?: string,
 *   isTest?: boolean
 * }} opts
 */
export async function notifySlackBatchComplete({
  webhookUrl,
  done = 0,
  failed = 0,
  skipped = 0,
  total = 0,
  personLabel = "",
  outputDir = "",
  isTest = false
}) {
  const endpoint = String(webhookUrl || "").trim();
  if (!isSlackWebhookUrl(endpoint)) {
    throw new Error(
      "Invalid Slack webhook URL. Paste a hooks.slack.com Incoming Webhook URL."
    );
  }

  const headline = isTest
    ? "*Brightstar Bid bot* — Slack webhook test ✅"
    : "*Brightstar Bid bot* — CSV batch complete";

  const lines = [
    headline,
    `• Done: ${done}`,
    `• Failed: ${failed}`,
    `• Skipped: ${skipped}`,
    `• Queue total: ${total || done + failed + skipped}`
  ];
  if (personLabel) lines.push(`• Person: ${personLabel}`);
  if (outputDir) lines.push(`• Output: Downloads / ${outputDir}`);
  if (isTest) lines.push("_If you see this, batch-complete alerts are ready._");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Slack notify failed (HTTP ${response.status}).`);
  }
  // Incoming Webhooks return plain "ok" on success
  if (text && text !== "ok" && !/^ok\b/i.test(text)) {
    throw new Error(text);
  }
  return { ok: true };
}
