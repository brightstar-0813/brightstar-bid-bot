/**
 * Notify Slack via Incoming Webhook.
 * Create a webhook in Slack → Apps → Incoming WebHooks (or api.slack.com/apps)
 * and paste the https://hooks.slack.com/services/... URL into the extension.
 */

export function isSlackWebhookUrl(url) {
  const raw = String(url || "").trim();
  return /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_+-]+$/i.test(raw);
}

/**
 * Low-level POST to an Incoming Webhook.
 * @param {string} webhookUrl
 * @param {string} text
 */
export async function postSlackMessage(webhookUrl, text) {
  const endpoint = String(webhookUrl || "").trim();
  if (!isSlackWebhookUrl(endpoint)) {
    throw new Error(
      "Invalid Slack webhook URL. Paste a hooks.slack.com Incoming Webhook URL."
    );
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: String(text || "").trim() || "(empty)" })
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(body || `Slack notify failed (HTTP ${response.status}).`);
  }
  // Incoming Webhooks return plain "ok" on success
  if (body && body !== "ok" && !/^ok\b/i.test(body)) {
    throw new Error(body);
  }
  return { ok: true };
}

function truncate(text, max = 180) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * @param {{
 *   csvRow?: number|string,
 *   company?: string,
 *   title?: string,
 *   error?: string,
 *   status?: string
 * }} job
 */
function formatErrorLine(job) {
  const row = job.csvRow != null ? `#${job.csvRow}` : "?";
  const who = [job.company, job.title].filter(Boolean).join(" / ") || "job";
  const err = truncate(job.error || job.status || "unknown error");
  return `• ${row} ${who}: ${err}`;
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
 *   isTest?: boolean,
 *   errors?: Array<{csvRow?: number|string, company?: string, title?: string, error?: string, status?: string}>
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
  isTest = false,
  errors = []
}) {
  const headline = isTest
    ? "*Brightstar Bid bot* — Slack webhook test ✅"
    : failed > 0
      ? "*Brightstar Bid bot* — CSV batch complete ⚠️"
      : "*Brightstar Bid bot* — CSV batch complete ✅";

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

  const errList = Array.isArray(errors) ? errors.filter((e) => e && (e.error || e.status)) : [];
  if (errList.length) {
    lines.push("", `*Errors (${errList.length}):*`);
    // Cap so a huge queue doesn't blow Slack's message size.
    const shown = errList.slice(0, 15);
    for (const job of shown) lines.push(formatErrorLine(job));
    if (errList.length > shown.length) {
      lines.push(`• …and ${errList.length - shown.length} more`);
    }
  }

  return postSlackMessage(webhookUrl, lines.join("\n"));
}

/**
 * Per-job status ping (success / fail / retry) so you can watch the bot live.
 * @param {{
 *   webhookUrl: string,
 *   outcome: "done"|"failed"|"error"|"skipped",
 *   csvRow?: number|string,
 *   company?: string,
 *   jobTitle?: string,
 *   personLabel?: string,
 *   message?: string,
 *   jdLink?: string,
 *   attempts?: number,
 *   maxAttempts?: number,
 *   progress?: { done?: number, failed?: number, remaining?: number, total?: number }
 * }} opts
 */
export async function notifySlackJobStatus({
  webhookUrl,
  outcome,
  csvRow,
  company = "",
  jobTitle = "",
  personLabel = "",
  message = "",
  jdLink = "",
  attempts,
  maxAttempts,
  progress
}) {
  const icons = {
    done: "✅",
    failed: "❌",
    error: "⚠️",
    skipped: "⏭️"
  };
  const labels = {
    done: "Job done",
    failed: "Job failed",
    error: "Job error — retrying",
    skipped: "Job skipped"
  };
  const key = String(outcome || "error");
  const icon = icons[key] || "•";
  const label = labels[key] || "Job update";

  const who = [company, jobTitle].filter(Boolean).join(" / ") || "job";
  const lines = [`*Brightstar Bid bot* — ${label} ${icon}`];
  lines.push(csvRow != null ? `• Job: #${csvRow} ${who}` : `• Job: ${who}`);
  if (personLabel) lines.push(`• Person: ${personLabel}`);
  if (key === "done" && message) lines.push(`• Status: ${truncate(message, 200)}`);
  if ((key === "failed" || key === "error") && message) {
    lines.push(`• Error: ${truncate(message, 400)}`);
  }
  if (attempts != null) {
    lines.push(
      maxAttempts != null
        ? `• Attempt: ${attempts}/${maxAttempts}`
        : `• Attempt: ${attempts}`
    );
  }
  if (progress) {
    const parts = [];
    if (progress.done != null) parts.push(`${progress.done} done`);
    if (progress.failed != null) parts.push(`${progress.failed} failed`);
    if (progress.remaining != null) parts.push(`${progress.remaining} left`);
    else if (progress.total != null && progress.done != null) {
      parts.push(`${Math.max(0, progress.total - progress.done - (progress.failed || 0))} left`);
    }
    if (parts.length) lines.push(`• Queue: ${parts.join(", ")}`);
  }
  if (jdLink) lines.push(`• Link: ${jdLink}`);

  return postSlackMessage(webhookUrl, lines.join("\n"));
}

/**
 * Ad-hoc alert (batch pause, fatal failure, etc.).
 * @param {{
 *   webhookUrl: string,
 *   title: string,
 *   message?: string,
 *   personLabel?: string,
 *   csvRow?: number|string,
 *   company?: string,
 *   jobTitle?: string
 * }} opts
 */
export async function notifySlackAlert({
  webhookUrl,
  title,
  message = "",
  personLabel = "",
  csvRow,
  company = "",
  jobTitle = ""
}) {
  const lines = [`*Brightstar Bid bot* — ${String(title || "Alert").trim()}`];
  if (csvRow != null || company || jobTitle) {
    const who = [company, jobTitle].filter(Boolean).join(" / ");
    lines.push(
      csvRow != null ? `• Job: #${csvRow}${who ? ` ${who}` : ""}` : `• Job: ${who || "—"}`
    );
  }
  if (personLabel) lines.push(`• Person: ${personLabel}`);
  if (message) lines.push(`• Error: ${truncate(message, 400)}`);
  return postSlackMessage(webhookUrl, lines.join("\n"));
}
