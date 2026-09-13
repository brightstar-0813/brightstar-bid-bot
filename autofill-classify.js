/**
 * Pure helpers for panel field classification and safe choice matching.
 * Used by the service worker / tests; mirrored in content/autofill.js scan path.
 */

/** Profile keys that may legitimately be empty — show as Leave blank, not Needs attention. */
export const OPTIONAL_EMPTY_PROFILE_KEYS = new Set([
  "addressLine2",
  "middleName",
  "preferredName",
  "selfIdentifyLanguage",
  "portfolioUrl",
  "githubUrl",
  "phoneDeviceType",
  "phoneCountryCode"
]);

/** Contact keys that stay unmatched when empty and required. */
export const REQUIRED_CONTACT_PROFILE_KEYS = new Set([
  "firstName",
  "lastName",
  "email",
  "phone",
  "addressLine1",
  "city",
  "state",
  "zipCode",
  "country"
]);

const SOURCE_RANK = {
  filled: 60,
  credential: 55,
  profile: 50,
  bank: 40,
  extra: 35,
  optional: 20,
  unmatched: 10
};

export function matchSourceRank(src) {
  return SOURCE_RANK[src] || 0;
}

export function isPasswordFieldLabel(label) {
  return /\b(password|passcode|retype password|confirm password|choose password|new password|current password)\b/i.test(
    String(label || "")
  );
}

export function isPasswordLikeControl(type, label) {
  const t = String(type || "").toLowerCase();
  if (t === "password") return true;
  return isPasswordFieldLabel(label);
}

/**
 * Classify an empty control that already mapped to a profile key.
 * @returns {"profile"|"optional"|"unmatched"}
 */
export function classifyEmptyProfileKey(profileKey, { required = false } = {}) {
  const key = String(profileKey || "").trim();
  if (!key) return "unmatched";
  if (OPTIONAL_EMPTY_PROFILE_KEYS.has(key)) return "optional";
  if (!required && !REQUIRED_CONTACT_PROFILE_KEYS.has(key)) return "optional";
  return "unmatched";
}

/**
 * Classify password / create-login fields for the panel inventory.
 * @returns {"credential"|"optional"}
 */
export function classifyPasswordMatchSource(hasCredentials) {
  return hasCredentials ? "credential" : "optional";
}

/** Short answers that are dangerous to reuse across dissimilar questions. */
export function isShortGenericAnswer(answer) {
  const a = String(answer || "").trim();
  if (!a) return false;
  if (/^(yes|no|y|n|n\/?a|na|none|nil|null|-|prefer not to say|decline|declined)$/i.test(a)) {
    return true;
  }
  return a.length <= 3;
}

/**
 * Loose option match for runner-side choice gating (mirrors content optionMatches intent).
 */
export function choiceAnswerMatchesOptions(answer, options = []) {
  const wantRaw = String(answer || "").trim();
  const want = wantRaw.toLowerCase();
  if (!want) return false;
  const list = Array.isArray(options) ? options.map((o) => String(o || "").trim()).filter(Boolean) : [];
  if (!list.length) return true; // unknown options — allow fill attempt

  const wantLoose = want.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const wantIsYesNo = /^(yes|y|no|n)$/i.test(wantRaw);

  for (const opt of list) {
    const o = opt.toLowerCase();
    const oLoose = o.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    if (o === want || oLoose === wantLoose) return true;

    if (wantIsYesNo) {
      if (/^(yes|y)$/i.test(wantRaw)) {
        if (/^(yes|y)\b/i.test(o) || /^(yes|y)$/i.test(oLoose)) return true;
      } else if (/^(no|n)$/i.test(wantRaw)) {
        if (
          (/^(no|n)\b/i.test(o) || /^(no|n)$/i.test(oLoose)) &&
          !/\bnon-?binary|non-?hispanic|none of the above\b/i.test(o)
        ) {
          return true;
        }
      }
      continue;
    }

    if (o.includes(want) || want.includes(o) || oLoose.includes(wantLoose) || wantLoose.includes(oLoose)) {
      // Avoid tiny substring traps unless yes/no handled above.
      if (want.length <= 2) continue;
      return true;
    }
  }
  return false;
}

/** Source priority when deciding whether a scraped answer may overwrite an existing bank row. */
const SOURCE_PRIORITY = {
  user: 50,
  ai: 40,
  profile: 35,
  extra: 30,
  scraped: 10
};

export function qaSourcePriority(source) {
  return SOURCE_PRIORITY[String(source || "").toLowerCase()] || 0;
}

/**
 * Whether an incoming save should replace an existing record.
 * Never let silent scraped answers clobber user/ai answers.
 */
export function shouldOverwriteQaRecord(existing, { source = "ai", answer = "", silent = false } = {}) {
  if (!existing) return true;
  const incomingPri = qaSourcePriority(source);
  const existingPri = qaSourcePriority(existing.source);
  if (silent && String(source).toLowerCase() === "scraped" && existingPri > incomingPri) {
    return false;
  }
  if (incomingPri < existingPri) {
    const next = String(answer || "").trim();
    const prev = String(existing.answer || "").trim();
    // Allow upgrade only when the new answer is clearly richer and sources are close.
    if (incomingPri + 5 < existingPri) return false;
    if (next.length <= prev.length) return false;
  }
  return true;
}
