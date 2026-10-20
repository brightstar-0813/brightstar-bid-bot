/**
 * Shared autofill result text for popup, background status, and on-page toast.
 * @param {object} result
 */
export function formatAutofillSummary(result = {}) {
  const filled = Number(result.filledCount ?? result.filled ?? 0);
  const bankHits = Number(result.bankHits ?? 0);
  const aiHits = Number(result.aiHits ?? 0);
  const uploaded = Number(result.uploadedCount ?? result.uploaded ?? 0);
  const unmatched = Number(
    result.unmatchedAfterSecondPass ?? result.unmatched ?? result.unmatchedCount ?? 0
  );

  const parts = [];
  if (filled) parts.push(`Filled ${filled} field${filled === 1 ? "" : "s"}`);
  if (bankHits) parts.push(`${bankHits} from Q&A bank`);
  if (aiHits) parts.push(`${aiHits} from OpenAI`);
  if (uploaded) parts.push(`uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}`);

  let text = parts.length ? parts.join(" · ") : "Autofill complete";
  if (unmatched > 0) {
    text += ` · ${unmatched} unmatched — add to Q&A bank or set OPENAI_API_KEY`;
  }
  return text;
}
