/**
 * Workday assist engine for the Bid bot content script (no Node/Playwright).
 * Attaches to globalThis.BrightstarWorkdayEngine for content/autofill.js.
 * Keep rules aligned with packages/field-mapper, application-engine policy, workday classify.
 */
(() => {
  const CONFIDENCE_AUTOFILL = 0.95;
  const CONFIDENCE_ASK = 0.75;

  const CONSEQUENTIAL = new Set([
    "WORK_AUTHORIZATION",
    "SPONSORSHIP",
    "SALARY",
    "CLEARANCE",
    "CONFLICT_OF_INTEREST",
    "LEGAL_ATTESTATION",
    "DEMOGRAPHIC",
    "VOLUNTARY_DISCLOSURE"
  ]);

  const STEP_PATTERNS = [
    { re: /create account|sign in|account information/i, pageType: "AUTH", state: "AUTH_REQUIRED" },
    {
      re: /my information|personal information|contact information/i,
      pageType: "CONTACT_INFORMATION",
      state: "CONTACT_INFORMATION"
    },
    {
      re: /my experience|work experience|^experience$/i,
      pageType: "EXPERIENCE",
      state: "EXPERIENCE"
    },
    { re: /^education$/i, pageType: "EDUCATION", state: "EDUCATION" },
    {
      re: /application questions|^questions$/i,
      pageType: "QUESTIONNAIRE",
      state: "QUESTIONNAIRE"
    },
    { re: /voluntary/i, pageType: "VOLUNTARY_DISCLOSURE", state: "VOLUNTARY_DISCLOSURE" },
    { re: /self[- ]?identify/i, pageType: "VOLUNTARY_DISCLOSURE", state: "VOLUNTARY_DISCLOSURE" },
    { re: /review/i, pageType: "REVIEW", state: "REVIEW" },
    { re: /resume|curriculum/i, pageType: "RESUME", state: "RESUME" },
    { re: /captcha|robot/i, pageType: "CAPTCHA", state: "NEEDS_USER" },
    {
      re: /already applied|duplicate application/i,
      pageType: "ALREADY_APPLIED",
      state: "BLOCKED"
    },
    {
      re: /no longer available|job closed|position filled/i,
      pageType: "JOB_CLOSED",
      state: "BLOCKED"
    }
  ];

  const PROFILE_ALIASES = {
    firstName: ["first_name", "given_name", "legal_first_name"],
    lastName: ["last_name", "family_name", "surname", "legal_last_name"],
    middleName: ["middle_name", "middle_initial"],
    preferredName: ["preferred_name", "nickname"],
    email: ["email", "email_address", "e_mail"],
    phone: ["phone", "phone_number", "mobile", "mobile_phone", "home_phone"],
    country: ["country", "country_region"],
    addressLine1: ["address", "address_line_1", "street_address", "address1"],
    addressLine2: ["address_line_2", "address2", "apt", "suite"],
    city: ["city", "town"],
    state: ["state", "state_province", "province", "region"],
    zipCode: ["postal_code", "zip", "zip_code", "postcode"],
    linkedin: ["linkedin", "linkedin_url", "linkedin_profile"],
    workAuthorized: [
      "authorized_to_work",
      "work_authorization",
      "legally_authorized",
      "are_you_authorized_to_work"
    ],
    sponsorship: [
      "sponsorship",
      "require_sponsorship",
      "will_you_now_or_in_the_future_require_sponsorship"
    ]
  };

  const KEY_CATEGORY = {
    workAuthorized: "WORK_AUTHORIZATION",
    sponsorship: "SPONSORSHIP",
    gender: "DEMOGRAPHIC",
    ethnicity: "DEMOGRAPHIC",
    disability: "VOLUNTARY_DISCLOSURE",
    veteran: "VOLUNTARY_DISCLOSURE",
    hispanicLatino: "DEMOGRAPHIC",
    salaryExpectation: "SALARY",
    desiredSalary: "SALARY"
  };

  function normalizeLabel(label) {
    return String(label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, "_");
  }

  function classifyPageFromText({ url = "", heading = "", bodyText = "", progressLabels = [] } = {}) {
    const scores = new Map();
    const signals = [];

    function add(pageType, state, weight, kind, value) {
      signals.push({ kind, value: String(value).slice(0, 120), weight });
      const prev = scores.get(pageType);
      scores.set(pageType, {
        state,
        score: Math.min(0.99, (prev?.score || 0) + weight)
      });
    }

    function consider(kind, value, weight) {
      if (!value) return;
      for (const step of STEP_PATTERNS) {
        if (!step.re.test(value)) continue;
        add(step.pageType, step.state, weight, kind, value);
      }
    }

    consider("heading", heading, 0.55);
    for (const label of progressLabels) consider("progress", label, 0.2);
    consider("url", url, 0.15);
    consider("body", String(bodyText || "").slice(0, 500), 0.1);

    let best = null;
    for (const [pageType, { state, score }] of scores) {
      if (!best || score > best.confidence) {
        best = { pageType, state, confidence: score };
      }
    }

    if (heading) {
      for (const step of STEP_PATTERNS) {
        if (!step.re.test(heading)) continue;
        const headingScore = scores.get(step.pageType)?.score || 0;
        if (!best || headingScore + 0.01 >= best.confidence) {
          best = {
            pageType: step.pageType,
            state: step.state,
            confidence: Math.max(headingScore, best?.confidence || 0, 0.7)
          };
        }
      }
    }

    if (!best || best.confidence < 0.55) {
      return {
        pageType: "UNKNOWN",
        confidence: best?.confidence || 0.2,
        signals,
        applicationState: "NEEDS_USER"
      };
    }
    return {
      pageType: best.pageType,
      confidence: best.confidence,
      signals,
      applicationState: best.state
    };
  }

  function mapLabelToProfileKey(label) {
    const normalized = normalizeLabel(label);
    for (const [key, aliases] of Object.entries(PROFILE_ALIASES)) {
      if (aliases.includes(normalized)) {
        return {
          key,
          normalizedLabel: normalized,
          category: KEY_CATEGORY[key] || "CONTACT",
          confidence: 1
        };
      }
    }
    return {
      key: null,
      normalizedLabel: normalized,
      category: "UNKNOWN",
      confidence: 0
    };
  }

  /**
   * @param {{ type?: string, category?: string, confidence?: number, requiresApproval?: boolean, source?: string, value?: unknown }} action
   * @param {{ submissionAuthorized?: boolean, demographicPreference?: string }} context
   */
  function evaluatePolicy(action = {}, context = {}) {
    const type = String(action.type || "FILL").toUpperCase();
    const category = String(action.category || "UNKNOWN");
    const confidence = Number(action.confidence);
    const conf = Number.isFinite(confidence) ? confidence : 0;

    if (type === "CLICK" && /submit/i.test(String(action.value || action.source || ""))) {
      return context.submissionAuthorized ? "ALLOW" : "BLOCK";
    }

    if (action.source === "invented" || action.source === "fabricated") {
      return "BLOCK";
    }

    if (CONSEQUENTIAL.has(category)) {
      if (
        (category === "DEMOGRAPHIC" || category === "VOLUNTARY_DISCLOSURE") &&
        (context.demographicPreference || "always_ask") === "always_ask"
      ) {
        return "REQUIRE_USER";
      }
      return "REQUIRE_USER";
    }

    if (action.requiresApproval) return "REQUIRE_USER";
    if (conf >= CONFIDENCE_AUTOFILL) return "ALLOW";
    if (conf >= CONFIDENCE_ASK) return "REQUIRE_USER";
    return "REQUIRE_USER";
  }

  function shouldAutofillLabel(label, { demographicPreference = "always_ask" } = {}) {
    const mapped = mapLabelToProfileKey(label);
    const decision = evaluatePolicy(
      {
        type: "FILL",
        category: mapped.category,
        confidence: mapped.confidence,
        requiresApproval: mapped.category !== "CONTACT" && mapped.category !== "UNKNOWN"
      },
      { demographicPreference, submissionAuthorized: false }
    );
    return {
      ...mapped,
      decision,
      autofill: decision === "ALLOW" && Boolean(mapped.key)
    };
  }

  function isSecurityChallengeText(text) {
    const t = String(text || "");
    return /captcha|i'?m not a robot|verify you are human|two[- ]factor|multi[- ]factor|\bmfa\b|enter (the )?code|one[- ]time|verification email/i.test(
      t
    );
  }

  globalThis.BrightstarWorkdayEngine = {
    CONFIDENCE_AUTOFILL,
    CONFIDENCE_ASK,
    CONSEQUENTIAL,
    normalizeLabel,
    classifyPageFromText,
    mapLabelToProfileKey,
    evaluatePolicy,
    shouldAutofillLabel,
    isSecurityChallengeText
  };
})();
