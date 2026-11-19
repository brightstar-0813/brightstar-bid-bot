/**
 * Shared US phone / ZIP coercion for Workday national fields.
 * Keep in sync with helpers inside content/autofill.js.
 */

/** @param {string} raw */
export function formatPhoneForWorkday(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  let national = digits;
  if (national.length === 11 && national.startsWith("1")) national = national.slice(1);
  if (national.length > 10) national = national.slice(-10);
  if (national.length !== 10) return national;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/**
 * @param {string} raw
 * @param {string} [country]
 */
export function formatZipForWorkday(raw, country = "") {
  const s = String(raw || "").trim();
  const isUs =
    !country ||
    /^(us|usa|united states|united states of america)$/i.test(String(country).trim());
  if (!isUs) return s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 5) return digits;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  if (/^\d{5}(-\d{4})?$/.test(s)) return s;
  return "";
}
