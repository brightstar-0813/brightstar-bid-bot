/**
 * Generic application-form autofill (content script).
 * Fills text, textarea, select, checkbox, and radio controls from applicant info.
 * For dropdowns/comboboxes: never types "yes"/"no" — opens the list and picks a matching option.
 */
(() => {
  // Keyed by build, not a plain boolean: a tab that already ran an older copy of
  // this script would otherwise block the updated one from installing.
  const SCRIPT_BUILD = "2026-08-19.03";
  if (window.__brightstarAutofillBuild === SCRIPT_BUILD) return;
  window.__brightstarAutofillBuild = SCRIPT_BUILD;
  window.__brightstarAutofillInstalled = true;

  // Learn mode: capture answers the user types/selects. Suppressed briefly while
  // the extension autofills so we never re-store our own programmatic values.
  let learnEnabled = true;
  let learnSuppressUntil = 0;
  const learnSentByQuestion = new Map();
  function suppressLearn(ms = 2500) {
    learnSuppressUntil = Date.now() + ms;
  }

  function isJavascriptUrl(value) {
    return /^\s*javascript:/i.test(String(value || ""));
  }

  function javascriptUrlAttr(el) {
    if (!el?.getAttribute) return "";
    for (const attr of ["href", "formaction", "action"]) {
      const v = el.getAttribute(attr) || "";
      if (isJavascriptUrl(v)) return v;
    }
    return "";
  }

  function javascriptUrlNear(el) {
    let node = el;
    for (let i = 0; i < 8 && node && node !== document.body; i += 1) {
      const v = javascriptUrlAttr(node);
      if (v) return v;
      node = node.parentElement;
    }
    return "";
  }

  // composedPath() is the reliable chain: event.target is retargeted for clicks
  // that originate inside a shadow root, which hides the real <a href="javascript:">.
  function javascriptUrlOnPath(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (node === document || node === window) break;
      const v = javascriptUrlAttr(node);
      if (v) return v;
    }
    return javascriptUrlNear(event.target);
  }

  function parseDoPostBack(text) {
    const s = String(text || "").replace(/^\s*javascript:/i, "");
    const m = s.match(
      /__doPostBack\s*\(\s*(['"])((?:\\.|[^\\])*?)\1\s*,\s*(['"])((?:\\.|[^\\])*?)\3\s*\)/
    );
    if (!m) return null;
    const unquote = (x) => x.replace(/\\(.)/g, "$1");
    return { target: unquote(m[2]), argument: unquote(m[4]) };
  }

  const BRIDGE_READY_ATTR = "data-brightstar-bridge-ready";

  function bridgeReady() {
    return Boolean(document.documentElement?.hasAttribute(BRIDGE_READY_ATTR));
  }

  function injectPageBridge() {
    try {
      if (bridgeReady() || document.querySelector("script[data-brightstar-bridge]")) return;
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("content/page-bridge.js");
      s.dataset.brightstarBridge = "1";
      s.onload = () => {
        try {
          s.remove();
        } catch {
          /* ignore */
        }
      };
      (document.head || document.documentElement).appendChild(s);
    } catch {
      /* CSP or missing web_accessible_resources */
    }
  }

  const pendingPostbacks = [];

  function flushPagePostbacks() {
    if (!bridgeReady()) return;
    while (pendingPostbacks.length) {
      const post = pendingPostbacks.shift();
      try {
        document.dispatchEvent(
          new CustomEvent("__brightstar_page_cmd", {
            bubbles: true,
            detail: { cmd: "postback", target: post.target, argument: post.argument }
          })
        );
      } catch {
        /* ignore */
      }
    }
  }

  function invokePagePostback(post) {
    if (!post) return false;
    pendingPostbacks.push(post);
    if (bridgeReady()) {
      flushPagePostbacks();
      return true;
    }
    // The bridge <script> loads asynchronously — replay once it marks itself ready.
    injectPageBridge();
    for (const delay of [60, 200, 600, 1500]) setTimeout(flushPagePostbacks, delay);
    return true;
  }

  // iCIMS drives Next / dropdowns / ASP.NET postbacks through
  // <a href="javascript:__doPostBack(...)">. A javascript: navigation started from
  // our isolated world is checked against the extension CSP and blocked, so cancel
  // it and run the postback in the page instead. Only our own synthetic clicks are
  // intercepted; the user's real clicks are left completely alone.
  let syntheticClickDepth = 0;

  document.addEventListener(
    "click",
    (event) => {
      if (!syntheticClickDepth) return;
      const url = javascriptUrlOnPath(event);
      if (!url) return;
      event.preventDefault();
      invokePagePostback(parseDoPostBack(url));
    },
    true
  );
  injectPageBridge();

  function asSyntheticClick(fn) {
    syntheticClickDepth += 1;
    try {
      return fn();
    } finally {
      syntheticClickDepth -= 1;
    }
  }

  // Every programmatic click must go through here (or safeClick) so the guard
  // above can turn a javascript: href into a real postback.
  function nativeClick(el) {
    if (!el) return false;
    return asSyntheticClick(() => {
      try {
        el.click();
        return true;
      } catch {
        return false;
      }
    });
  }

  function safeClick(el) {
    if (!el) return false;
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    } catch {
      /* ignore */
    }
    nativeClick(el);
    try {
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
    } catch {
      /* ignore */
    }
    return true;
  }

  function queryAllDeep(selector, root = document) {
    const out = [];
    const seen = new Set();
    const visit = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      let matches = [];
      try {
        if (node.querySelectorAll) matches = [...node.querySelectorAll(selector)];
      } catch {
        matches = [];
      }
      for (const el of matches) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      }
      let all = [];
      try {
        if (node.querySelectorAll) all = [...node.querySelectorAll("*")];
      } catch {
        all = [];
      }
      if (node instanceof Element) all.unshift(node);
      for (const el of all) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return out;
  }

  let pendingUploadFile = null;
  let pendingUploadKind = "";

  function pendingFileFitsInput(input) {
    if (!pendingUploadFile || !input) return false;
    if (!pendingUploadKind) return true;
    const kind = classifyFileInput(input);
    return !kind || kind === pendingUploadKind;
  }

  function patchFileInputOpeners() {
    const proto = HTMLInputElement.prototype;
    if (proto.__brightstarFileOpenPatched) return;
    proto.__brightstarFileOpenPatched = true;
    const origClick = proto.click;
    proto.click = function (...args) {
      if (String(this.type || "").toLowerCase() === "file" && pendingFileFitsInput(this)) {
        setFileOnInput(this, pendingUploadFile);
        return;
      }
      return origClick.apply(this, args);
    };
    if (typeof proto.showPicker === "function") {
      const origPicker = proto.showPicker;
      proto.showPicker = function (...args) {
        if (String(this.type || "").toLowerCase() === "file" && pendingFileFitsInput(this)) {
          setFileOnInput(this, pendingUploadFile);
          return;
        }
        return origPicker.apply(this, args);
      };
    }
  }

  const FIELD_ALIASES = {
    firstName: ["first name", "firstname", "given name", "legal first name"],
    lastName: [
      "last name",
      "lastname",
      "surname",
      "family name",
      "legal last name",
      "preferred last name"
    ],
    middleName: ["middle name", "middle initial", "mi"],
    preferredName: ["preferred name", "preferred first name", "nickname", "what should we call you"],
    email: ["email", "e-mail", "email address", "work email"],
    phone: ["phone number", "mobile phone", "cell phone", "telephone number", "primary phone"],
    phoneDeviceType: ["phone device type", "device type"],
    phoneCountryCode: ["country phone code", "phone country code", "country code"],
    country: ["country", "country/region"],
    addressLine1: ["address line 1", "street address", "address 1", "home address", "street"],
    addressLine2: ["address line 2", "address 2", "apartment", "suite", "unit", "apt"],
    city: ["city", "town", "municipality"],
    state: ["state", "province", "state/province"],
    zipCode: ["zip", "zip code", "postal", "postal code", "zip/postal", "post code"],
    cityCountryOfResidence: [
      "city, country of residence",
      "city country of residence",
      "city and country of residence",
      "country of residence"
    ],

    workAuthorized: [
      "eligible to work in the united states",
      "eligible to work in the us",
      "eligible to work",
      "authorized to work in the united states",
      "authorized to work in the us",
      "authorized to work",
      "legally authorized",
      "legally authorized to work",
      "authorized to work in the country",
      "country where the job is located",
      "work authorization",
      "right to work",
      "legally entitled to work"
    ],
    needsSponsorship: [
      "require sponsorship or assistance",
      "require sponsorship",
      "visa sponsorship",
      "need sponsorship",
      "will you now or in the future require",
      "maintain work eligibility",
      "sponsorship or assistance"
    ],
    postEmploymentRestrictions: [
      "continuing employment restrictions",
      "employment restrictions or obligations",
      "restrictions or obligations with your current or former employer",
      "non-solicitation",
      "non solicitation",
      "non-competition",
      "non competition",
      "non-compete",
      "non compete",
      "post-employment",
      "post employment",
      "restrictive covenant",
      "subject to any contract"
    ],
    workedForCompanyBefore: [
      "worked for",
      "worked at",
      "employed by",
      "previously employed",
      "worked in the past",
      "any subsidiary"
    ],
    relatedToEmployee: [
      "closely related",
      "close personal relationship",
      "personal relationship with anyone who currently works",
      "related to anyone who works"
    ],
    governmentEmployee: [
      "current or former government employee",
      "government employee",
      "federal national state local or military"
    ],
    governmentEthicsRecusal: [
      "notified your ethics official",
      "recused yourself",
      "ethics official and recused"
    ],
    willingToRelocate: ["relocate", "willing to relocate", "relocation"],
    over18: ["over 18", "at least 18", "18 years of age", "age of majority"],
    felonyConviction: ["felony", "criminal conviction", "convicted of a crime", "criminal record"],
    felonyExplanation: ["please explain", "conviction explanation", "explain your"],

    yearsExperience: ["years of experience", "total experience", "years experience", "how many years"],
    relevantExperience: ["relevant experience", "describe your experience"],
    englishLevel: [
      "english level",
      "english proficiency",
      "level of english",
      "language proficiency",
      "fluency in english"
    ],
    linkedinUrl: [
      "linkedin",
      "linkedin url",
      "linkedin profile",
      "linkedin profile link",
      "linkedin profile url",
      "linkedin link"
    ],
    portfolioUrl: ["portfolio", "website", "personal website", "portfolio url"],
    githubUrl: ["github", "github url", "github profile"],

    highestDegree: ["highest degree", "degree", "education level", "highest level of education"],
    schoolName: ["school", "university", "college", "institution", "school name"],
    fieldOfStudy: ["field of study", "major", "concentration", "area of study"],
    graduationDate: [
      "graduation",
      "graduation date",
      "date graduated",
      "graduated",
      "graduation year"
    ],

    whyInterested: [
      "why are you interested",
      "why do you want",
      "why this role",
      "why this company",
      "cover letter",
      "additional information",
      "anything else"
    ],
    salaryExpectation: [
      "salary",
      "compensation",
      "expected salary",
      "salary expectations",
      "desired salary",
      "pay expectation",
      "hourly rate",
      "hourly rate for this job"
    ],
    earliestStartDate: [
      "start date",
      "earliest start",
      "available to start",
      "when can you start",
      "when are you available to start"
    ],
    backgroundCheckConsent: ["background check", "background screening"],
    drugTestConsent: ["drug test", "drug screen", "drug screening"],

    gender: ["gender", "gender identity", "sex"],
    hispanicLatino: [
      "hispanic/latino",
      "hispanic or latino",
      "are you hispanic",
      "hispanic latino",
      "latinx"
    ],
    raceEthnicity: [
      "identify your race",
      "please identify your race",
      "racial/ethnic background",
      "race/ethnicity",
      "race ethnicity",
      "racial background",
      "ethnicity",
      "race"
    ],
    veteranStatus: ["veteran", "military status", "protected veteran", "armed forces"],
    disabilityStatus: ["disability", "disabled", "chronic condition"]
  };

  /** Prefer matching on the direct field label, not section headers like "Address". */
  const FIELD_MATCH_ORDER = [
    "addressLine2",
    "addressLine1",
    "city",
    "state",
    "zipCode",
    "cityCountryOfResidence",
    "phoneCountryCode",
    "phoneDeviceType",
    "phone",
    "firstName",
    "lastName",
    "middleName",
    "preferredName",
    "email",
    "country",
    "workAuthorized",
    "needsSponsorship",
    "postEmploymentRestrictions",
    "workedForCompanyBefore",
    "relatedToEmployee",
    "governmentEmployee",
    "governmentEthicsRecusal",
    "willingToRelocate",
    "over18",
    "felonyConviction",
    "felonyExplanation",
    "yearsExperience",
    "relevantExperience",
    "englishLevel",
    "linkedinUrl",
    "portfolioUrl",
    "githubUrl",
    "highestDegree",
    "schoolName",
    "fieldOfStudy",
    "graduationDate",
    "salaryExpectation",
    "earliestStartDate",
    "whyInterested",
    "gender",
    "hispanicLatino",
    "raceEthnicity",
    "veteranStatus",
    "disabilityStatus",
    "backgroundCheckConsent",
    "drugTestConsent"
  ];

  const AUTOCOMPLETE_FIELD_MAP = {
    "given-name": "firstName",
    "family-name": "lastName",
    "additional-name": "middleName",
    nickname: "preferredName",
    email: "email",
    tel: "phone",
    "tel-national": "phone",
    "tel-local": "phone",
    "street-address": "addressLine1",
    "address-line1": "addressLine1",
    "address-line2": "addressLine2",
    "address-level2": "city",
    "address-level1": "state",
    "postal-code": "zipCode",
    "country-name": "country",
    country: "country"
  };

  const US_STATE_LABELS = {
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    DC: "District of Columbia",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming"
  };

  /** Fields whose answers should be chosen from a dropdown/list, not typed as free text. */
  const SELECT_LIKE_KEYS = new Set([
    "workAuthorized",
    "needsSponsorship",
    "postEmploymentRestrictions",
    "willingToRelocate",
    "over18",
    "felonyConviction",
    "backgroundCheckConsent",
    "drugTestConsent",
    "gender",
    "hispanicLatino",
    "raceEthnicity",
    "veteranStatus",
    "disabilityStatus",
    "englishLevel",
    "highestDegree",
    "state",
    "phoneDeviceType",
    "phoneCountryCode",
    "workedForCompanyBefore",
    "relatedToEmployee",
    "governmentEmployee",
    "governmentEthicsRecusal"
  ]);

  const VALUE_LABELS = {
    workAuthorized: { yes: ["Yes"], no: ["No"] },
    needsSponsorship: { yes: ["Yes"], no: ["No"] },
    willingToRelocate: { yes: ["Yes"], no: ["No"] },
    over18: { yes: ["Yes"], no: ["No"] },
    felonyConviction: { yes: ["Yes"], no: ["No"] },
    backgroundCheckConsent: { yes: ["Yes"], no: ["No"] },
    drugTestConsent: { yes: ["Yes"], no: ["No"] },
    postEmploymentRestrictions: { yes: ["Yes"], no: ["No"] },
    workedForCompanyBefore: { yes: ["Yes"], no: ["No"] },
    relatedToEmployee: { yes: ["Yes"], no: ["No"] },
    governmentEmployee: { yes: ["Yes"], no: ["No"] },
    governmentEthicsRecusal: { yes: ["Yes"], no: ["No"] },
    hispanicLatino: { yes: ["Yes"], no: ["No"] },
    gender: {
      female: ["Female", "Woman", "F"],
      male: ["Male", "Man", "M"],
      non_binary: ["Non-binary", "Nonbinary", "Non binary"],
      other: ["Other", "Self-describe", "Self describe"]
    },
    raceEthnicity: {
      american_indian: ["American Indian or Alaska Native", "American Indian", "Alaska Native"],
      asian: ["Asian"],
      black: ["Black or African American", "Black", "African American"],
      hispanic: [
        "Hispanic or Latino",
        "Hispanic, Latinx or of Spanish Origin",
        "Hispanic",
        "Latino",
        "Latinx",
        "Spanish Origin"
      ],
      native_hawaiian: [
        "Native Hawaiian or Other Pacific Islander",
        "Native Hawaiian",
        "Pacific Islander"
      ],
      white: ["White", "Caucasian"],
      two_or_more: ["Two or more races", "Two or more", "Multiracial"]
    },
    veteranStatus: {
      not_veteran: [
        "I am not a protected veteran",
        "No, I am not a veteran or active member",
        "I am not a veteran",
        "Not a veteran",
        "No"
      ],
      protected_veteran: [
        "I identify as a protected veteran",
        "Yes, I am a veteran",
        "Protected veteran",
        "Yes"
      ],
      decline: ["I decline to self-identify", "Prefer not to say", "I do not wish to answer"]
    },
    disabilityStatus: {
      yes: [
        "Yes, I have a disability, or have had one in the past",
        "Yes, I have a disability",
        "Yes"
      ],
      no: [
        "No, I do not have a disability and have not had one in the past",
        "No, I do not have a disability",
        "No"
      ],
      decline: ["I do not want to answer", "I do not wish to answer", "Prefer not to say"]
    },
    englishLevel: {
      A1: ["A1"],
      A2: ["A2"],
      B1: ["B1"],
      B2: ["B2"],
      C1: ["C1", "C1 Advanced", "Advanced"],
      C2: ["C2", "C2 Proficiency", "Proficient"],
      native: ["Native", "Native / bilingual", "Bilingual", "Fluent"]
    },
    highestDegree: {
      high_school: ["High School", "High School Diploma", "GED"],
      associate: ["Associate", "Associate's", "Associates"],
      bachelor: ["Bachelor", "Bachelor's", "Bachelors", "BS", "BA"],
      master: ["Master", "Master's", "Masters", "MS", "MA", "MBA"],
      doctorate: ["Doctorate", "PhD", "Ph.D.", "Doctoral"],
      other: ["Other"]
    },
    phoneDeviceType: {
      mobile: ["Mobile", "Cell", "Cell Phone", "Mobile Phone", "Smartphone"],
      home: ["Home", "Home Phone", "Landline"],
      work: ["Work", "Work Phone", "Business"]
    }
  };

  const YES_VALUES = new Set(["yes", "y", "true", "1"]);
  const NO_VALUES = new Set(["no", "n", "false", "0"]);

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function expandValueCandidates(key, value) {
    const raw = String(value ?? "").trim();
    if (!raw) return [];
    const out = [raw];
    const map = VALUE_LABELS[key];
    if (map && map[raw]) {
      for (const label of map[raw]) {
        if (label && !out.includes(label)) out.push(label);
      }
    }
    if (key === "state") {
      const code = raw.toUpperCase();
      const full = US_STATE_LABELS[code];
      if (full && !out.includes(full)) out.push(full);
      const byName = Object.entries(US_STATE_LABELS).find(
        ([, label]) => normalize(label) === normalize(raw)
      );
      if (byName && !out.includes(byName[0])) out.push(byName[0]);
    }
    if (key === "phoneCountryCode") {
      if (/united states|usa|\bus\b/i.test(raw)) {
        for (const label of [
          "United States of America (+1)",
          "United States (+1)",
          "US (+1)",
          "+1",
          "United States"
        ]) {
          if (!out.includes(label)) out.push(label);
        }
      }
    }
    if (/^(yes|no)$/i.test(raw)) {
      const titled = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
      if (!out.includes(titled)) out.push(titled);
    }
    return out;
  }

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    try {
      if (descriptor?.set) descriptor.set.call(el, value);
      else el.value = value;
    } catch {
      return false;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setNativeChecked(el, checked) {
    if (!el || el.disabled) return false;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
    try {
      if (descriptor?.set) descriptor.set.call(el, Boolean(checked));
      else el.checked = Boolean(checked);
    } catch {
      el.checked = Boolean(checked);
    }
    el.dispatchEvent(new Event("click", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return Boolean(el.checked) === Boolean(checked);
  }

  const DATE_LIKE_TYPES = new Set(["date", "month", "week", "time", "datetime-local"]);

  function toDateParts(raw) {
    const s = String(raw || "").trim();

    let m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (m) {
      return { year: m[1], month: m[2].padStart(2, "0"), day: (m[3] || "01").padStart(2, "0") };
    }

    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) {
      return { year: m[3], month: m[1].padStart(2, "0"), day: m[2].padStart(2, "0") };
    }

    // Only attempt free-form parsing when a 4-digit year is present, so values
    // like "5" are not silently reinterpreted as a date by the Date constructor.
    if (/\b\d{4}\b/.test(s)) {
      const parsed = Date.parse(s);
      if (!Number.isNaN(parsed)) {
        const d = new Date(parsed);
        return {
          year: String(d.getFullYear()),
          month: String(d.getMonth() + 1).padStart(2, "0"),
          day: String(d.getDate()).padStart(2, "0")
        };
      }
    }

    return null;
  }

  function withinInputRange(el, type, value) {
    const min = el.getAttribute("min");
    const max = el.getAttribute("max");
    if (!min && !max) return true;

    if (type === "number" || type === "range") {
      const n = Number(value);
      if (!Number.isFinite(n)) return false;
      if (min && Number.isFinite(Number(min)) && n < Number(min)) return false;
      if (max && Number.isFinite(Number(max)) && n > Number(max)) return false;
      return true;
    }

    // ISO date/time strings compare correctly as plain strings.
    if (min && value < min) return false;
    if (max && value > max) return false;
    return true;
  }

  /**
   * Reshape a profile answer into something the input type can actually store.
   * Returns null when the value cannot be represented, so the caller skips the
   * field instead of asking the browser to parse an invalid value.
   */
  function coerceValueForInput(el, rawValue) {
    const type = (el.type || "text").toLowerCase();
    const raw = String(rawValue ?? "").trim();
    if (!raw) return null;

    let out = raw;

    if (DATE_LIKE_TYPES.has(type)) {
      if (type === "time") {
        const m = raw.match(/^(\d{1,2}):(\d{2})(:\d{2})?$/);
        out = m ? `${m[1].padStart(2, "0")}:${m[2]}${m[3] || ""}` : null;
      } else if (type === "week") {
        out = /^\d{4}-W\d{2}$/i.test(raw) ? raw.toUpperCase() : null;
      } else {
        const parts = toDateParts(raw);
        if (!parts) {
          out = null;
        } else if (type === "month") {
          out = `${parts.year}-${parts.month}`;
        } else if (type === "date") {
          out = `${parts.year}-${parts.month}-${parts.day}`;
        } else {
          out = `${parts.year}-${parts.month}-${parts.day}T09:00`;
        }
      }
    } else if (type === "number" || type === "range") {
      const m = raw.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
      out = m ? m[0] : null;
    } else if (type === "color") {
      out = /^#[0-9a-f]{6}$/i.test(raw) ? raw : null;
    } else if (type === "email") {
      out = /\S+@\S+\.\S+/.test(raw) ? raw : null;
    } else if (type === "url") {
      if (/^https?:\/\/\S+$/i.test(raw)) out = raw;
      else if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(raw)) out = `https://${raw}`;
      else out = null;
    }

    if (out == null) return null;
    if (!withinInputRange(el, type, out)) return null;
    return out;
  }

  function cleanLabelText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function labelTextForControl(el) {
    const parts = [];
    if (el.id) {
      try {
        const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (byFor) parts.push(byFor.textContent || "");
      } catch {
        /* ignore invalid id */
      }
    }
    const wrapping = el.closest("label");
    if (wrapping) parts.push(wrapping.textContent || "");
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const node = document.getElementById(id);
        if (node) parts.push(node.textContent || "");
      }
    }
    parts.push(el.getAttribute("aria-label") || "");
    parts.push(el.getAttribute("placeholder") || "");
    parts.push(el.getAttribute("name") || "");
    parts.push(el.getAttribute("autocomplete") || "");
    const prev = el.previousElementSibling;
    if (prev && /LABEL|SPAN|DIV|P|LEGEND/i.test(prev.tagName)) {
      parts.push(prev.textContent || "");
    }
    // Walk up a few parents for ATS question wrappers (Ashby / Greenhouse).
    let parent = el.parentElement;
    for (let i = 0; i < 4 && parent; i += 1) {
      const heading = parent.querySelector(
        ":scope > label, :scope > legend, :scope > p, :scope > span, :scope > div > label"
      );
      if (heading && heading !== el) parts.push(heading.textContent || "");
      const q = parent.getAttribute?.("data-question") || parent.getAttribute?.("aria-label");
      if (q) parts.push(q);
      parent = parent.parentElement;
    }
    const fieldset = el.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector("legend");
      if (legend) parts.push(legend.textContent || "");
    }
    return normalize(parts.join(" "));
  }

  function aliasMatchesLabel(aliasNorm, labelNorm) {
    if (!aliasNorm || !labelNorm) return false;
    // Phrase aliases may be followed by more words ("eligible to work in the US").
    if (labelNorm.includes(aliasNorm)) return true;
    const escaped = aliasNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(labelNorm);
  }

  /**
   * Extract the question/field label above a control (Workday legend/label, fieldset,
   * formField containers, aria-labelledby, etc.).
   */
  function questionLabelForControl(el) {
    const candidates = [];

    if (el.id) {
      try {
        const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (byFor) candidates.push(cleanLabelText(byFor.textContent));
      } catch {
        /* ignore */
      }
    }

    const fieldset = el.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector(":scope > legend");
      if (legend) candidates.push(cleanLabelText(legend.textContent));
    }

    // Workday / generic ATS: label or legend inside the same form-field wrapper.
    let container = el.parentElement;
    for (let i = 0; i < 8 && container; i += 1) {
      const autoId = String(container.getAttribute?.("data-automation-id") || "");
      const isFormBlock =
        /formfield|form-field|formField|question|applicationquestion|multiselect/i.test(autoId) ||
        container.tagName === "FIELDSET";

      if (isFormBlock) {
        for (const labelEl of container.querySelectorAll(
          ':scope > label, :scope > legend, [data-automation-id="formLabel"], [data-automation-id*="formLabel"], label[data-automation-id]'
        )) {
          if (labelEl.contains(el)) continue;
          candidates.push(cleanLabelText(labelEl.textContent));
        }
      }

      const prev = container.previousElementSibling;
      if (prev && /^(LABEL|LEGEND|P|SPAN|DIV|H\d)$/i.test(prev.tagName)) {
        const t = cleanLabelText(prev.textContent);
        if (t.length >= 8 && t.length <= 900) candidates.push(t);
      }
      container = container.parentElement;
    }

    // Walk up: direct-child label/legend in each ancestor.
    let node = el.parentElement;
    for (let i = 0; i < 6 && node; i += 1) {
      for (const labelEl of node.querySelectorAll(":scope > label, :scope > legend")) {
        if (labelEl.contains(el)) continue;
        candidates.push(cleanLabelText(labelEl.textContent));
      }
      const prev = el.previousElementSibling;
      if (prev && /^(LABEL|LEGEND|P|SPAN|DIV|H\d)$/i.test(prev.tagName)) {
        candidates.push(cleanLabelText(prev.textContent));
      }
      node = node.parentElement;
    }

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const labelNode = document.getElementById(id);
        if (labelNode) candidates.push(cleanLabelText(labelNode.textContent));
      }
    }
    const aria = cleanLabelText(el.getAttribute("aria-label") || "");
    if (aria) candidates.push(aria);

    let best = "";
    for (const c of candidates) {
      const t = cleanLabelText(c);
      if (!t || t.length < 3) continue;
      if (/^(select one|please select|choose|--|\* indicates a required field)$/i.test(t)) continue;
      if (t.length > best.length) best = t;
    }
    return best;
  }

  /** Direct field label — uses Workday-aware question label extraction. */
  function primaryLabelForControl(el) {
    return normalize(questionLabelForControl(el));
  }

  function matchApplicantKey(labelNorm, primaryLabelNorm = "") {
    const primary = primaryLabelNorm || labelNorm;
    if (!primary && !labelNorm) return null;

    let best = null;
    let bestScore = 0;

    for (const key of FIELD_MATCH_ORDER) {
      const aliases = FIELD_ALIASES[key];
      if (!aliases) continue;
      for (const alias of aliases) {
        const a = normalize(alias);
        if (!a) continue;
        const onPrimary = primary && aliasMatchesLabel(a, primary);
        const onFull = labelNorm && aliasMatchesLabel(a, labelNorm);
        if (!onPrimary && !onFull) continue;

        // Prefer matches on the direct field label over section headers.
        let score = a.length + (onPrimary ? 1000 : 0);

        // City/state/zip must win over generic address section text.
        if (["city", "state", "zipCode", "addressLine2"].includes(key)) score += 200;
        if (key === "addressLine1" && /\b(line 1|street|address 1|home address)\b/.test(primary)) {
          score += 150;
        }
        if (key === "phone" && /\b(extension|device type|country phone code|phone code)\b/.test(primary)) {
          continue;
        }
        if (key === "workAuthorized" && /\bsponsorship\b/.test(primary)) continue;
        if (key === "needsSponsorship" && /\beligible to work\b/.test(primary) && !/\bsponsorship\b/.test(primary)) {
          continue;
        }
        if (key === "workedForCompanyBefore" && !/\b(worked|employed|subsidiary|past|before)\b/.test(primary)) {
          continue;
        }
        if (key === "relatedToEmployee" && !/\b(related|relationship)\b/.test(primary)) continue;
        if (key === "governmentEmployee" && !/\bgovernment\b/.test(primary)) continue;
        if (key === "governmentEthicsRecusal" && !/\b(ethics|recused)\b/.test(primary)) continue;

        if (score > bestScore) {
          best = key;
          bestScore = score;
        }
      }
    }
    return best;
  }

  function matchApplicantKeyFromControl(el) {
    const autocomplete = normalize(el.getAttribute("autocomplete") || "");
    if (autocomplete === "tel-extension") return null;
    if (AUTOCOMPLETE_FIELD_MAP[autocomplete]) return AUTOCOMPLETE_FIELD_MAP[autocomplete];

    const question = questionLabelForControl(el);
    const primary = normalize(question);
    const full = primary || labelTextForControl(el);

    if (/\bextension\b/.test(primary)) return null;
    if (/\bdevice type\b/.test(primary)) return "phoneDeviceType";
    if (/\b(country phone code|phone country code|phone code)\b/.test(primary)) {
      return "phoneCountryCode";
    }

    // High-confidence Workday / ATS compliance questions (company name varies).
    if (/\b(require|need)\b/.test(primary) && /\bsponsorship\b/.test(primary)) {
      return "needsSponsorship";
    }
    if (/\b(eligible|legally authorized|authorized)\b/.test(primary) && /\bwork\b/.test(primary)) {
      return "workAuthorized";
    }
    if (/\bcontinuing employment restrictions\b/.test(primary) || /\bemployment restrictions or obligations\b/.test(primary)) {
      return "postEmploymentRestrictions";
    }
    if (/\bhave you worked for\b/.test(primary) && /\b(past|before|previously|subsidiary)\b/.test(primary)) {
      return "workedForCompanyBefore";
    }
    if (/\bclosely related\b/.test(primary) || /\bpersonal relationship\b/.test(primary)) {
      return "relatedToEmployee";
    }
    if (/\bgovernment employee\b/.test(primary)) return "governmentEmployee";
    if (/\bethics official\b/.test(primary) || /\brecused yourself\b/.test(primary)) {
      return "governmentEthicsRecusal";
    }

    return matchApplicantKey(full, primary);
  }

  /**
   * Clearest question text for OpenAI — prefers real labels / previous sibling,
   * skips placeholder noise like "Type here...".
   */
  function questionTextForAi(el) {
    const candidates = [];
    if (el.id) {
      try {
        const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (byFor) candidates.push(cleanLabelText(byFor.textContent));
      } catch {
        /* ignore */
      }
    }
    const wrapping = el.closest("label");
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll("input, textarea, select, button").forEach((n) => n.remove());
      candidates.push(cleanLabelText(clone.textContent));
    }
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const node = document.getElementById(id);
        if (node) candidates.push(cleanLabelText(node.textContent));
      }
    }
    const aria = cleanLabelText(el.getAttribute("aria-label"));
    if (aria && !looksLikeEditorChromeValue(aria)) candidates.push(aria);

    const prev = el.previousElementSibling;
    if (prev && /LABEL|SPAN|DIV|P|LEGEND|H1|H2|H3|H4|H5|H6/i.test(prev.tagName)) {
      candidates.push(cleanLabelText(prev.textContent));
    }

    let best = "";
    for (const c of candidates) {
      if (!c) continue;
      if (looksLikeEditorChromeValue(c)) continue;
      if (/^(type here|enter text|write here|your answer)\.?$/i.test(c)) continue;
      if (c.length > best.length) best = c;
    }
    if (best) return best.slice(0, 1000);

    return cleanLabelText(labelTextForControl(el)).slice(0, 1000);
  }

  function isYesNoValue(value) {
    const v = normalize(value);
    return YES_VALUES.has(v) || NO_VALUES.has(v);
  }

  /**
   * Match a dropdown option against a desired answer.
   * For yes/no, prefer options that start with Yes/No — never use naive substring
   * matching (avoids "no" matching "Non-binary" / "non-hispanic").
   */
  function optionMatches(optionText, desired) {
    const opt = normalize(optionText);
    const want = normalize(desired);
    if (!opt || !want) return false;
    if (opt === want) return true;

    if (isYesNoValue(want)) {
      const yes = YES_VALUES.has(want);
      if (yes) {
        return opt === "yes" || opt === "y" || opt.startsWith("yes ") || opt.startsWith("yes,");
      }
      return opt === "no" || opt === "n" || opt.startsWith("no ") || opt.startsWith("no,");
    }

    if (opt.includes(want) || want.includes(opt)) return true;

    // Token overlap for longer labels (e.g. disability / veteran phrasing).
    const wantTokens = want.split(" ").filter((t) => t.length > 2);
    if (wantTokens.length >= 3) {
      const hit = wantTokens.filter((t) => opt.includes(t)).length;
      if (hit / wantTokens.length >= 0.6) return true;
    }
    return false;
  }

  function optionMatchesAny(optionText, candidates) {
    return candidates.some((c) => optionMatches(optionText, c));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function fillSelect(select, value, key = null) {
    if (value == null || value === "") return false;
    const candidates = key ? expandValueCandidates(key, value) : [String(value)];
    const match = [...select.options].find((o) =>
      optionMatchesAny(o.textContent || o.value, candidates)
    );
    if (!match) return false;
    select.value = match.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  /** Greenhouse / Ashby / generic React-Select control detection. */
  function getReactSelectRoot(el) {
    if (!el) return null;
    return (
      el.closest(".select__control") ||
      el.closest("[class*='select__control']") ||
      el.closest(".select__container") ||
      el.closest("[class*='react-select']") ||
      null
    );
  }

  function isReactSelectInput(el) {
    if (!el) return false;
    if (el.classList?.contains("select__input")) return true;
    if (/^react-select-\d+-input$/i.test(el.id || "")) return true;
    if (el.closest?.(".select__input-container, [class*='select__input']")) return true;
    return Boolean(getReactSelectRoot(el));
  }

  const EDITOR_STYLE_OPTION_RE =
    /^(heading\s*[1-6]|paragraph|normal(\s+text)?|body(\s+text)?|title|subtitle|blockquote|code block)$/i;

  function isEditorChrome(el) {
    if (!el?.closest) return false;
    if (
      el.closest(
        "[role='toolbar'], [role='menubar'], .ql-toolbar, .ql-formats, .ProseMirror-menubar, .tox-toolbar, .tox-editor-header, .tox-menubar"
      )
    ) {
      return true;
    }
    const cls = String(el.className || "");
    if (/\b(ql-|tox-|ProseMirror-menu|tiptap-toolbar|editor-toolbar|rich-text-toolbar)\b/i.test(cls)) {
      return true;
    }
    const t = buttonChoiceText(el);
    if (EDITOR_STYLE_OPTION_RE.test(t)) return true;
    const aria = `${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("title") || ""}`;
    if (
      /\b(text style|heading style|paragraph format|font family|font size|text align|align (left|center|right|justify)|bold|italic|underline)\b/i.test(
        aria
      )
    ) {
      return true;
    }
    if (el.closest("[contenteditable='true'], .ProseMirror, .ql-editor") && !isRichTextEditor(el)) {
      return true;
    }
    return Boolean(nearestEssayEditor(el));
  }

  function isLikelyEssayEditor(el) {
    if (!el) return false;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "combobox" || role === "listbox" || el.getAttribute("aria-haspopup") === "listbox") {
      return false;
    }
    try {
      const rect = el.getBoundingClientRect();
      return rect.width >= 120 && rect.height >= 48;
    } catch {
      return false;
    }
  }

  function nearestEssayEditor(el) {
    if (!el?.closest) return null;
    let node = el.parentElement;
    for (let i = 0; i < 6 && node && node !== document.body; i += 1) {
      const editors = [
        ...node.querySelectorAll("[contenteditable='true'], .ProseMirror, .ql-editor")
      ].filter(isLikelyEssayEditor);
      if (editors.length > 1) return null;
      if (editors.length === 1 && editors[0] !== el && !editors[0].contains(el)) {
        const rect = node.getBoundingClientRect();
        if (rect.height > 0 && rect.height < 520) return editors[0];
      }
      node = node.parentElement;
    }
    return null;
  }

  function looksLikeCombobox(el) {
    if (!el) return false;
    if (isRichTextEditor(el) || el.isContentEditable) return false;
    if (isEditorChrome(el)) return false;
    if (isReactSelectInput(el)) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "combobox" || role === "listbox") return true;
    if (el.getAttribute("aria-haspopup") === "listbox") return true;
    if (el.getAttribute("aria-haspopup") === "true" && el.getAttribute("aria-autocomplete")) {
      return true;
    }
    if (el.getAttribute("aria-autocomplete") === "list") return true;
    if (el.closest?.(".select__control, [class*='select__control']")) return true;
    const combo = el.closest?.('[role="combobox"]');
    if (combo && !isEditorChrome(combo) && !isRichTextEditor(combo)) return true;
    return false;
  }

  function collectVisibleOptions(root = document) {
    const selectors = [
      ".select__option",
      "[class*='select__option']",
      '[id*="react-select-"][id*="-option-"]',
      '[role="option"]',
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      '[role="treeitem"]',
      "li[data-value]",
      ".select-option"
    ];
    const nodes = [];
    for (const sel of selectors) {
      try {
        nodes.push(...root.querySelectorAll(sel));
      } catch {
        /* ignore */
      }
    }
    const seen = new Set();
    const out = [];
    for (const node of nodes) {
      if (seen.has(node)) continue;
      seen.add(node);
      // Skip disabled / placeholder options.
      if (node.getAttribute("aria-disabled") === "true") continue;
      if (node.classList?.contains("select__option--is-disabled")) continue;
      const text = cleanLabelText(node.textContent);
      if (!text || text.length > 300) continue;
      if (/^select\.\.\.?$/i.test(text)) continue;
      if (isEditorChrome(node) || EDITOR_STYLE_OPTION_RE.test(text)) continue;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      out.push(node);
    }
    return out;
  }

  function clickOptionNode(node) {
    if (!node) return false;
    const clickable =
      node.closest("[role='option'], .select__option, [class*='select__option'], li, button") ||
      node;
    // React-Select listens to mousedown more reliably than click alone.
    clickable.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window })
    );
    clickable.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
    );
    clickable.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
    );
    asSyntheticClick(() =>
      clickable.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      )
    );
    return true;
  }

  function openReactSelect(el) {
    if (isEditorChrome(el) || isRichTextEditor(el) || nearestEssayEditor(el)) return el;
    const control =
      getReactSelectRoot(el) ||
      el.closest?.("[class*='select__control']") ||
      el.closest?.('[role="combobox"]') ||
      el;
    const indicator =
      control.querySelector?.(
        ".select__dropdown-indicator, [class*='select__dropdown-indicator'], button[aria-label*='flyout'], button[aria-label*='Toggle']"
      ) || null;

    const target = indicator || control;
    target.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
    );
    target.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
    );
    nativeClick(target);

    // Focus the real search input so filtering / keyboard works.
    const input =
      (el.tagName === "INPUT" ? el : null) ||
      control.querySelector?.("input.select__input, input[role='combobox'], input") ||
      el;
    try {
      input.focus?.();
    } catch {
      /* ignore */
    }
    return input;
  }

  function setReactSelectFilter(input, text) {
    if (!input || input.tagName !== "INPUT") return;
    setNativeValue(input, text);
    // React-Select also watches InputEvent / keyup.
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: text.slice(-1) || "a" }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: text.slice(-1) || "a" }));
  }

  function clearReactSelectFilter(input) {
    if (!input || input.tagName !== "INPUT") return;
    setNativeValue(input, "");
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "", inputType: "deleteContentBackward" }));
  }

  async function waitForOptions(attempts = 8, delayMs = 80) {
    for (let i = 0; i < attempts; i += 1) {
      const options = collectVisibleOptions(document);
      if (options.length) return options;
      await sleep(delayMs);
    }
    return [];
  }

  async function fillCustomDropdown(el, value, key = null) {
    if (value == null || String(value).trim() === "") return false;
    if (isEditorChrome(el) || isRichTextEditor(el) || nearestEssayEditor(el)) return false;
    const candidates = key ? expandValueCandidates(key, value) : [String(value).trim()];
    const reactSelect = isReactSelectInput(el);

    // Prefer already-open menu options.
    let options = collectVisibleOptions(document);
    let match = options.find((n) => optionMatchesAny(n.textContent, candidates));
    if (match) return clickOptionNode(match);

    const input = openReactSelect(el);
    options = await waitForOptions(reactSelect ? 10 : 6, reactSelect ? 100 : 80);
    if (
      nearestEssayEditor(el) ||
      (options.length > 0 &&
        options.every((n) => EDITOR_STYLE_OPTION_RE.test(cleanLabelText(n.textContent))))
    ) {
      try {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })
        );
      } catch {
        /* ignore */
      }
      return false;
    }
    match = options.find((n) => optionMatchesAny(n.textContent, candidates));
    if (match) {
      const ok = clickOptionNode(match);
      if (reactSelect) clearReactSelectFilter(input);
      return ok;
    }

    // Filter the menu (Greenhouse React-Select), then pick — never leave typed text as the answer.
    const filterText =
      candidates.find((c) => String(c).trim().length >= 1 && !isYesNoValue(c)) ||
      candidates.find((c) => /^(Yes|No)$/i.test(String(c).trim())) ||
      candidates[0];

    if (input && input.tagName === "INPUT") {
      setReactSelectFilter(input, filterText);
      options = await waitForOptions(reactSelect ? 10 : 6, 100);
      match = options.find((n) => optionMatchesAny(n.textContent, candidates));
      if (match) {
        const ok = clickOptionNode(match);
        clearReactSelectFilter(input);
        return ok;
      }

      // Keyboard fallback: highlight first filtered option and confirm.
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown", code: "ArrowDown" })
      );
      await sleep(60);
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" })
      );
      await sleep(80);

      // Did a value chip / single-value appear?
      const root = getReactSelectRoot(el) || el.closest?.(".select__control")?.parentElement;
      const selected = root?.querySelector?.(
        ".select__single-value, .select__multi-value__label, [class*='select__single-value']"
      );
      if (selected && optionMatchesAny(selected.textContent, candidates)) {
        clearReactSelectFilter(input);
        return true;
      }

      // Never leave free-text in a React-Select / combobox.
      clearReactSelectFilter(input);
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape", code: "Escape" }));
    }

    return false;
  }

  function fillCheckboxOrRadio(el, value, key = null) {
    if (value == null || value === "") return false;
    const candidates = key ? expandValueCandidates(key, value) : [String(value)];
    const wantYes = YES_VALUES.has(normalize(value));
    const label = labelTextForControl(el);
    const optionSide = normalize(el.value || "") || label;

    if (el.type === "checkbox") {
      const shouldCheck = isYesNoValue(value)
        ? wantYes
        : optionMatchesAny(optionSide, candidates) || optionMatchesAny(label, candidates);
      if (el.checked !== shouldCheck) nativeClick(el);
      return true;
    }

    if (el.type === "radio") {
      const optionLabel = radioOptionLabel(el) || optionSide;
      const matchesOption =
        optionMatchesAny(el.value, candidates) ||
        optionMatchesAny(optionSide, candidates) ||
        optionMatchesAny(optionLabel, candidates);
      const yesNoOnGroup =
        isYesNoValue(value) &&
        ((wantYes && /^(yes|y)$/i.test(optionLabel)) ||
          (!wantYes && /^(no|n)$/i.test(optionLabel)) ||
          (wantYes && (optionSide.startsWith("yes") || optionSide === "y")) ||
          (!wantYes &&
            (optionSide === "no" ||
              optionSide.startsWith("no ") ||
              optionSide.startsWith("no,") ||
              optionSide === "n")));
      if (matchesOption || yesNoOnGroup) {
        clickChip(el);
        return true;
      }
    }
    return false;
  }

  function stripEmoji(text) {
    return String(text || "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buttonChoiceText(el) {
    const raw = stripEmoji(
      cleanLabelText(el?.textContent || el?.innerText || el?.getAttribute?.("aria-label") || el?.value || "")
    );
    return raw;
  }

  function isNavOrSubmitChip(el) {
    const t = normalize(buttonChoiceText(el));
    return /\b(send application|go back|submit|sign up|log in|next|continue)\b/.test(t);
  }

  const RATE_CHIP_RE = /^\$?\s*\d+(\.\d+)?$/;
  const YES_NO_CHIP_RE = /^(yes|no|y|n)$/i;

  function isYesNoChoiceButton(el) {
    if (!el || el.disabled) return false;
    return YES_NO_CHIP_RE.test(buttonChoiceText(el));
  }

  function isChoiceChip(el) {
    if (!el || el.disabled || isNavOrSubmitChip(el) || isEditorChrome(el)) return false;
    const tag = el.tagName.toLowerCase();
    const t = buttonChoiceText(el);
    if (!t || t.length > 60) return false;
    if (el.querySelector?.("textarea, select, [contenteditable='true']")) return false;
    const extraInput = el.querySelector?.(
      'input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])'
    );
    if (extraInput) return false;
    const rect = el.getBoundingClientRect();
    const hasHiddenChoice = Boolean(el.querySelector?.('input[type="radio"], input[type="checkbox"]'));
    if (!hasHiddenChoice && (rect.width < 24 || rect.height < 18 || rect.width > 640)) return false;
    if (YES_NO_CHIP_RE.test(t) || RATE_CHIP_RE.test(t) || /^custom$/i.test(t)) return true;
    if (/right away|two weeks after offer|after a specific date|prefer not/i.test(t)) return true;
    if (tag === "button" || el.getAttribute("role") === "button" || el.getAttribute("role") === "radio") {
      return t.split(/\s+/).length <= 8;
    }
    if (tag === "label" && hasHiddenChoice) return YES_NO_CHIP_RE.test(t) || t.split(/\s+/).length <= 8;
    return false;
  }

  function isChoiceButtonSelected(el) {
    if (!el) return false;
    const pressed = el.getAttribute("aria-pressed");
    const checked = el.getAttribute("aria-checked");
    if (pressed === "true" || checked === "true") return true;
    if (el.getAttribute("data-state") === "on" || el.getAttribute("data-selected") === "true") {
      return true;
    }
    return /\b(selected|active|checked|pressed)\b/i.test(el.className || "");
  }

  function questionTextNearNode(el, optionLabels = []) {
    const labelledBy = el?.getAttribute?.("aria-labelledby") || "";
    if (labelledBy) {
      const fromIds = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ");
      const t = stripEmoji(cleanLabelText(fromIds));
      if (t.length >= 8 && !looksLikeEditorChromeValue(t)) return t.slice(0, 1000);
    }
    const legend = el?.matches?.("fieldset, [role='radiogroup'], [role='group']")
      ? el.querySelector(":scope > legend")
      : el?.closest?.("fieldset")?.querySelector("legend");
    if (legend) {
      const t = stripEmoji(cleanLabelText(legend.textContent));
      if (t.length >= 8 && !looksLikeEditorChromeValue(t)) return t.slice(0, 1000);
    }

    let walk = el;
    for (let up = 0; up < 5 && walk; up += 1) {
      let sib = walk.previousElementSibling;
      while (sib) {
        const t = stripEmoji(cleanLabelText(sib.innerText || sib.textContent || ""));
        if (
          t.length >= 24 &&
          !looksLikeEditorChromeValue(t) &&
          (/[?]/.test(t) ||
            /\b(please (describe|share|answer|explain)|share an example|describe your|tell us about)\b/i.test(
              t
            ))
        ) {
          const qs = t.match(/[^?]*\?/g);
          return (qs?.[qs.length - 1] || t).trim().slice(0, 1000);
        }
        sib = sib.previousElementSibling;
      }
      walk = walk.parentElement;
    }

    let node = el;
    for (let i = 0; i < 6 && node; i += 1) {
      let stripped = stripEmoji(cleanLabelText(node.innerText || node.textContent || ""));
      for (const opt of optionLabels) {
        if (opt) stripped = stripped.replace(new RegExp(opt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
      }
      stripped = stripped
        .replace(/\brequired\b/gi, " ")
        .replace(/\bthe client has input a budget of\b[^.?\n]*/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (
        stripped.length >= 12 &&
        /[?]|\b(authorized|sponsorship|eligible|require|confirm|available|hourly rate|start|describe|share an example)\b/i.test(
          stripped
        )
      ) {
        const qs = stripped.match(/[^?]*\?/g);
        if (qs?.length) {
          const last = qs[qs.length - 1].trim();
          if (last.length >= 12) return last.slice(0, 1000);
        }
        return stripped.slice(0, 1000);
      }
      node = node.parentElement;
    }
    const prev = el.previousElementSibling || el.parentElement?.previousElementSibling;
    if (prev) {
      const t = stripEmoji(cleanLabelText(prev.textContent));
      if (t.length >= 12) return t.slice(0, 1000);
    }
    return "";
  }

  function siblingContainsOtherEssay(sib, self) {
    if (!sib?.querySelector) return false;
    return [...sib.querySelectorAll("[contenteditable='true'], .ProseMirror, .ql-editor")].some(
      (ed) => ed !== self && isLikelyEssayEditor(ed)
    );
  }

  function essayQuestionForEditor(el) {
    const promptRe =
      /[?]|\b(please (describe|share|answer|explain|confirm)|share an example|describe your|tell us about|what did you|which .+ (do you|you currently) hold|certif(?:ied|ication|ications)? you currently hold)\b/i;
    let node = el;
    for (let up = 0; up < 6 && node; up += 1) {
      let sib = node.previousElementSibling;
      while (sib) {
        if (siblingContainsOtherEssay(sib, el)) break;
        const t = stripEmoji(cleanLabelText(sib.innerText || sib.textContent || ""));
        if (t.length >= 24 && promptRe.test(t) && !looksLikeEditorChromeValue(t)) {
          const parts = t.split(/(?=please answer this question from the client)/i).filter((p) => p.trim());
          const chunk = (parts.length ? parts[parts.length - 1] : t)
            .replace(/please answer this question from the client\s*(required)?/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (chunk.length >= 24 && !looksLikeEditorChromeValue(chunk)) return chunk.slice(0, 1000);
        }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    const near = questionTextNearNode(el);
    return looksLikeEditorChromeValue(near) ? "" : near;
  }

  function collectChipCandidates() {
    const seen = new Set();
    const out = [];
    const push = (el) => {
      if (!el || seen.has(el) || !isChoiceChip(el)) return;
      seen.add(el);
      out.push(el);
    };
    for (const el of document.querySelectorAll(
      'button, [role="button"], [role="radio"], [aria-pressed], [tabindex="0"]'
    )) {
      push(el);
    }
    for (const el of document.querySelectorAll("div, span, label")) {
      if (el.childElementCount > 3) continue;
      const raw = el.innerText || el.textContent || "";
      if (raw.length > 80) continue;
      const t = buttonChoiceText(el);
      if (
        YES_NO_CHIP_RE.test(t) ||
        RATE_CHIP_RE.test(t) ||
        /^custom$/i.test(t) ||
        /^(right away|two weeks after offer|after a specific date)$/i.test(t)
      ) {
        push(el);
      }
    }
    return out;
  }

  function classifyChipGroup(buttons) {
    const labels = buttons.map((b) => buttonChoiceText(b));
    const styles = labels.filter((l) => EDITOR_STYLE_OPTION_RE.test(l)).length;
    if (styles >= 2) return "";
    const yesNo = labels.filter((l) => YES_NO_CHIP_RE.test(l)).length;
    const rates = labels.filter((l) => RATE_CHIP_RE.test(l)).length;
    const starts = labels.filter((l) =>
      /^(right away|two weeks after offer|after a specific date)$/i.test(l)
    ).length;
    if (yesNo === 2 && buttons.length <= 3) return "yesno";
    if (rates >= 2 && rates >= buttons.length - 1 && buttons.length <= 8) return "rate";
    if (starts >= 2 && starts >= buttons.length - 1 && buttons.length <= 5) return "start";
    if (buttons.length >= 2 && buttons.length <= 8 && yesNo < 2 && rates < 2) return "option";
    return "";
  }

  function collectNamedRadioGroups() {
    const radios = [...document.querySelectorAll('input[type="radio"]')].filter(
      (el) => !el.disabled && !isEditorChrome(el)
    );
    const byKey = new Map();
    for (const el of radios) {
      const key = el.name || `id:${el.id || ""}`;
      if (!key || key === "id:") continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(el);
    }
    const groups = [];
    for (const [, buttons] of byKey) {
      if (buttons.length < 2 || buttons.length > 8) continue;
      const labels = buttons.map((b) => radioOptionLabel(b));
      const yesNo = labels.filter((l) => YES_NO_CHIP_RE.test(l)).length;
      const rates = labels.filter((l) => RATE_CHIP_RE.test(l)).length;
      const starts = labels.filter((l) =>
        /^(right away|two weeks after offer|after a specific date)$/i.test(l)
      ).length;
      let kind = "";
      if (yesNo === 2 && labels.length <= 3) kind = "yesno";
      else if (rates >= 2 && rates >= labels.length - 1) kind = "rate";
      else if (starts >= 2 && starts >= labels.length - 1) kind = "start";
      else if (labels.length >= 2 && yesNo < 2 && rates < 2) kind = "option";
      if (!kind) continue;
      const root =
        buttons[0].closest("fieldset, [role='radiogroup'], [role='group']") ||
        (() => {
          let node = buttons[0].parentElement;
          while (node) {
            if (buttons.every((b) => node.contains(b))) {
              const tighter = [...node.children].find((k) => buttons.every((b) => k.contains(b)));
              if (tighter) {
                node = tighter;
                continue;
              }
              return node;
            }
            node = node.parentElement;
          }
          return buttons[0].parentElement;
        })();
      groups.push({
        root,
        buttons,
        kind,
        labels,
        question: questionTextNearNode(root || buttons[0].parentElement, labels),
        selected: buttons.some((b) => b.checked)
      });
    }
    return groups;
  }

  function collectChoiceChipGroups() {
    const used = new WeakSet();
    const groups = [];

    for (const group of collectNamedRadioGroups()) {
      group.buttons.forEach((b) => {
        used.add(b);
        const lab = b.closest("label");
        if (lab) used.add(lab);
      });
      groups.push(group);
    }

    const candidates = collectChipCandidates();
    for (const start of candidates) {
      if (used.has(start)) continue;
      let root = start.parentElement;
      let chosen = null;
      for (let i = 0; i < 5 && root; i += 1) {
        const found = candidates.filter((el) => root.contains(el) && !used.has(el));
        const kind = classifyChipGroup(found);
        if (kind) {
          chosen = { root, buttons: found, kind };
          break;
        }
        root = root.parentElement;
      }
      if (!chosen && isYesNoChoiceButton(start)) {
        const oppositeRe = /^(yes|y)$/i.test(buttonChoiceText(start)) ? /^(no|n)$/i : /^(yes|y)$/i;
        let node = start.parentElement;
        for (let i = 0; i < 4 && node && !chosen; i += 1) {
          const partner = candidates.find(
            (el) =>
              el !== start &&
              !used.has(el) &&
              node.contains(el) &&
              oppositeRe.test(buttonChoiceText(el))
          );
          if (partner) chosen = { root: node, buttons: [start, partner], kind: "yesno" };
          node = node.parentElement;
        }
      }
      if (!chosen) continue;
      chosen.buttons.forEach((b) => used.add(b));
      const labels = chosen.buttons.map((b) => buttonChoiceText(b));
      groups.push({
        root: chosen.root,
        buttons: chosen.buttons,
        kind: chosen.kind,
        labels,
        question: questionTextNearNode(chosen.root || start, labels),
        selected: chosen.buttons.some((b) => isChoiceButtonSelected(b) || b.checked)
      });
    }
    return groups;
  }

  function collectYesNoButtonGroups() {
    return collectChoiceChipGroups().filter((g) => g.kind === "yesno");
  }

  function radioOptionLabel(el) {
    if (!el) return "";
    if (el.id) {
      try {
        const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (byFor) {
          const clone = byFor.cloneNode(true);
          clone.querySelectorAll("input").forEach((n) => n.remove());
          const t = stripEmoji(cleanLabelText(clone.textContent));
          if (t) return t;
        }
      } catch {
        /* ignore */
      }
    }
    const wrap = el.closest?.("label");
    if (wrap) {
      const clone = wrap.cloneNode(true);
      clone.querySelectorAll("input").forEach((n) => n.remove());
      const t = stripEmoji(cleanLabelText(clone.textContent));
      if (t) return t;
    }
    return buttonChoiceText(el) || String(el.value || "").trim();
  }

  function matchYesNoGroupKey(question) {
    const primary = normalize(question);
    if (!primary) return null;
    if (/\b(require|need)\b/.test(primary) && /\bsponsorship\b/.test(primary)) {
      return "needsSponsorship";
    }
    if (/\b(eligible|legally authorized|authorized)\b/.test(primary) && /\bwork\b/.test(primary)) {
      return "workAuthorized";
    }
    if (/\bcountry where the job is located\b/.test(primary)) return "workAuthorized";
    if (/\brelocate\b/.test(primary)) return "willingToRelocate";
    if (/\bover 18\b|\bat least 18\b/.test(primary)) return "over18";
    return matchApplicantKey(primary, primary);
  }

  function parseDollarAmount(text) {
    const m = String(text || "").replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : NaN;
  }

  function pickRateOption(labels, applicantInfo, question) {
    const nums = labels
      .map((label) => ({ label, n: parseDollarAmount(label) }))
      .filter((row) => Number.isFinite(row.n));
    if (!nums.length) return "";
    const want = parseDollarAmount(
      applicantInfo?.salaryExpectation || applicantInfo?.desiredSalary || applicantInfo?.hourlyRate || ""
    );
    if (Number.isFinite(want)) {
      nums.sort((a, b) => Math.abs(a.n - want) - Math.abs(b.n - want));
      return nums[0].label;
    }
    const range = String(question || "").match(/\$\s*(\d+(?:\.\d+)?).{0,24}\$\s*(\d+(?:\.\d+)?)/);
    if (range) {
      const max = Number(range[2]);
      const hit = nums.find((row) => row.n === max);
      if (hit) return hit.label;
    }
    return nums[nums.length - 1].label;
  }

  function pickStartOption(labels, applicantInfo) {
    const want = normalize(applicantInfo?.earliestStartDate || applicantInfo?.availableToStart || "");
    const opts = labels.filter(Boolean);
    const find = (re) => opts.find((o) => re.test(normalize(o)));
    if (/two week|2 week|14 day/.test(want)) {
      return find(/two week|2 week/) || find(/right away|immediate|asap/) || "";
    }
    if (/specific date/.test(want) && !/right away|immediate|asap|now|today/.test(want)) {
      return find(/specific date/) || find(/right away|immediate|asap/) || "";
    }
    return find(/right away|immediate|asap/) || "";
  }

  function visibleChipTarget(el) {
    if (!el) return null;
    if (el.tagName !== "INPUT") return el;
    const wrap = el.closest("label");
    if (wrap) return wrap;
    if (el.id) {
      try {
        const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (byFor) return byFor;
      } catch {
        /* ignore */
      }
    }
    return el.parentElement || el;
  }

  function hiddenChoiceInput(el) {
    if (!el) return null;
    if (el.tagName === "INPUT" && (el.type === "radio" || el.type === "checkbox")) return el;
    return el.querySelector?.('input[type="radio"], input[type="checkbox"]') || null;
  }

  function clickChip(el) {
    if (!el) return false;
    const radio = hiddenChoiceInput(el);
    const target = visibleChipTarget(el);
    try {
      (target || el).scrollIntoView({ block: "center", inline: "nearest" });
    } catch {
      /* ignore */
    }
    const fire = (node) => {
      if (!node) return;
      try {
        node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
        node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      } catch {
        /* ignore */
      }
      nativeClick(node);
      try {
        node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
      } catch {
        /* ignore */
      }
    };
    fire(target);
    if (radio && target !== radio) fire(radio);
    if (radio && !radio.checked) setNativeChecked(radio, true);
    return true;
  }

  function chipChoiceText(el, fallback = "") {
    if (!el) return fallback;
    if (el.tagName === "INPUT") return radioOptionLabel(el) || fallback;
    const nested = hiddenChoiceInput(el);
    if (nested) return radioOptionLabel(nested) || buttonChoiceText(el) || fallback;
    return buttonChoiceText(el) || fallback;
  }

  function clickChipValue(group, value) {
    const want = String(value || "").trim();
    if (!want || !group?.buttons?.length) return false;
    const labels = group.buttons.map((b, i) => group.labels?.[i] || chipChoiceText(b));
    const wantNum = parseDollarAmount(want);
    const skipSpecificDate = !/specific date/.test(normalize(want));
    const usable = (label) => !(skipSpecificDate && /specific date/.test(normalize(label)));
    let idx = labels.findIndex((label) => usable(label) && optionMatches(label, want));
    if (idx < 0 && Number.isFinite(wantNum)) {
      idx = labels.findIndex((label) => parseDollarAmount(label) === wantNum);
    }
    if (idx < 0 && YES_VALUES.has(normalize(want))) {
      idx = labels.findIndex((label) => /^(yes|y)$/i.test(label));
    }
    if (idx < 0 && NO_VALUES.has(normalize(want))) {
      idx = labels.findIndex((label) => /^(no|n)$/i.test(label));
    }
    if (idx < 0) return false;
    return clickChip(group.buttons[idx]);
  }

  function fillChoiceChipGroups(applicantInfo = {}) {
    const filled = [];
    for (const group of collectChoiceChipGroups()) {
      if (group.selected) continue;
      let key = group.kind;
      let value = "";
      if (group.kind === "yesno") {
        key = matchYesNoGroupKey(group.question);
        value = key ? resolveApplicantValue(applicantInfo, key) : "";
      } else if (group.kind === "rate") {
        key = "salaryExpectation";
        value = pickRateOption(group.labels, applicantInfo, group.question);
      } else if (
        group.kind === "start" ||
        /available to start|when can you start|when are you available/i.test(group.question)
      ) {
        key = "earliestStartDate";
        value = pickStartOption(group.labels, applicantInfo);
      } else {
        const mapped = matchApplicantKey(normalize(group.question), normalize(group.question));
        if (mapped) {
          key = mapped;
          value = resolveApplicantValue(applicantInfo, mapped);
        }
      }
      if (!value) continue;
      if (clickChipValue(group, value)) {
        filled.push({ key, label: (group.question || value).slice(0, 80) });
      }
    }
    return filled;
  }

  function fillYesNoButtonGroups(applicantInfo = {}) {
    return fillChoiceChipGroups(applicantInfo);
  }

  function isRichTextEditor(el) {
    if (!el) return false;
    if (el.getAttribute("contenteditable") === "false") return false;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "combobox" || role === "listbox" || el.getAttribute("aria-haspopup") === "listbox") {
      return false;
    }
    if (el.closest("nav, header, [role='toolbar'], .ql-toolbar, [class*='toolbar']")) return false;
    if (el.getAttribute("contenteditable") === "true") return true;
    if (el.classList?.contains("ProseMirror") || el.classList?.contains("ql-editor")) return true;
    if (el.getAttribute("role") === "textbox" && el.isContentEditable) return true;
    return false;
  }

  function collectRichTextEditors() {
    const nodes = [
      ...document.querySelectorAll(
        '[contenteditable="true"], .ProseMirror, .ql-editor, [role="textbox"][contenteditable="true"]'
      )
    ];
    return nodes.filter((el) => {
      if (!isRichTextEditor(el) || !isLikelyEssayEditor(el)) return false;
      const nested = el.parentElement?.closest("[contenteditable='true']");
      if (nested && nested !== el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return true;
    });
  }

  function isEditorPlaceholderText(text) {
    const t = normalize(text);
    if (!t) return true;
    if (t.length > 240) return false;
    return (
      /format paragraph/.test(t) ||
      /heading dropdown/.test(t) ||
      /we want to hear from/.test(t) ||
      /authentic answer/.test(t) ||
      /communication style/.test(t) ||
      /fit for the role/.test(t) ||
      /on your own experience/.test(t) ||
      /^type (here|your answer|something)/.test(t) ||
      /^enter (text|your answer|a response)/.test(t) ||
      /^start typing/.test(t) ||
      /^write (your|an) answer/.test(t)
    );
  }

  function looksLikeEditorChromeValue(text) {
    const t = normalize(text);
    if (!t) return true;
    if (isEditorPlaceholderText(t)) return true;
    if (EDITOR_STYLE_OPTION_RE.test(t)) return true;
    if (/heading dropdown|text style|paragraph format|format paragraph/.test(t)) return true;
    return t.split(" ").length <= 8 && /\b(dropdown|toolbar|heading|placeholder)\b/.test(t);
  }

  function editorVisibleText(el) {
    const t = cleanLabelText(el?.innerText || el?.textContent || "");
    if (looksLikeEditorChromeValue(t)) return "";
    const ph = cleanLabelText(
      el?.getAttribute("data-placeholder") || el?.getAttribute("aria-placeholder") || ""
    );
    if (ph && (normalize(t) === normalize(ph) || t.startsWith(ph.slice(0, 16)))) return "";
    return t;
  }

  function isRichTextEmpty(el) {
    if (!el) return true;
    if (el.classList?.contains("is-editor-empty") || el.classList?.contains("ProseMirror-empty")) {
      return true;
    }
    if (el.querySelector?.(".is-editor-empty, .ProseMirror-empty, p.is-empty")) {
      const raw = cleanLabelText(el.innerText || el.textContent || "");
      if (isEditorPlaceholderText(raw) || looksLikeEditorChromeValue(raw) || raw.length < 8) {
        return true;
      }
    }
    return !editorVisibleText(el);
  }

  function rawEditorText(el) {
    return cleanLabelText(el?.innerText || el?.textContent || "");
  }

  function answerPresentInEditor(el, text) {
    const want = normalize(text).slice(0, 32);
    if (!want) return false;
    return normalize(rawEditorText(el)).includes(want);
  }

  function writeEditorPlainText(el, text) {
    el.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = text;
    el.appendChild(p);
    try {
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text
        })
      );
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function collapseDuplicatedAnswer(el, text) {
    const raw = rawEditorText(el);
    const t = String(text || "").trim();
    if (!t) return;
    const nRaw = normalize(raw);
    const nT = normalize(t);
    const rest = nRaw.startsWith(nT) ? nRaw.slice(nT.length) : "";
    const duplicated = rest && rest.includes(nT.slice(0, Math.min(40, nT.length)));
    const hasPlaceholder = /we want to hear from|format paragraph|heading dropdown/i.test(raw);
    if (duplicated || (hasPlaceholder && nRaw.includes(nT.slice(0, 32)))) {
      writeEditorPlainText(el, t);
    }
  }

  async function fillContentEditable(el, value) {
    const text = String(value || "").trim();
    if (!el || !text || looksLikeEditorChromeValue(text)) return false;

    if (answerPresentInEditor(el, text)) {
      collapseDuplicatedAnswer(el, text);
      return true;
    }

    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + Math.min(48, Math.max(12, rect.width / 2));
      const y = rect.top + Math.min(rect.height - 10, Math.max(56, rect.height * 0.4));
      const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
      el.focus();
    } catch {
      try {
        el.focus();
      } catch {
        /* ignore */
      }
    }

    const selectAll = () => {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      return sel;
    };

    try {
      const sel = selectAll();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      document.execCommand("insertText", false, text);
      sel.collapseToEnd();
    } catch {
      /* try other methods below */
    }
    await sleep(40);

    if (answerPresentInEditor(el, text)) {
      collapseDuplicatedAnswer(el, text);
      return true;
    }

    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", { value: dt });
      selectAll();
      document.execCommand("delete", false, null);
      el.dispatchEvent(ev);
    } catch {
      /* ignore */
    }
    await sleep(40);

    if (answerPresentInEditor(el, text)) {
      collapseDuplicatedAnswer(el, text);
      return true;
    }

    writeEditorPlainText(el, text);
    collapseDuplicatedAnswer(el, text);
    return answerPresentInEditor(el, text);
  }

  async function fillControl(el, value, key = null) {
    if (value == null || String(value).trim() === "") return false;
    if (el.disabled || el.readOnly) return false;
    if (isEditorChrome(el) && !isRichTextEditor(el)) return false;
    const tag = el.tagName.toLowerCase();

    if (tag === "select") return fillSelect(el, value, key);

    if (tag === "input") {
      const type = (el.type || "text").toLowerCase();
      if (type === "checkbox" || type === "radio") return fillCheckboxOrRadio(el, value, key);
      if (["hidden", "file", "submit", "button", "image", "reset"].includes(type)) return false;

      // React-Select / combobox: ONLY pick from the option list — never type an answer.
      if (isReactSelectInput(el) || looksLikeCombobox(el)) {
        return fillCustomDropdown(el, value, key);
      }

      // Known select-like profile fields: try list first; never leave lowercase yes/no typed in.
      if (SELECT_LIKE_KEYS.has(key) || isYesNoValue(value)) {
        const ok = await fillCustomDropdown(el, value, key);
        if (ok) return true;
        if (isYesNoValue(value) || SELECT_LIKE_KEYS.has(key)) return false;
      }

      const coerced = coerceValueForInput(el, value);
      if (coerced == null) return false;
      if (!setNativeValue(el, coerced)) return false;
      // Inputs such as date / number silently drop values they cannot represent.
      return Boolean(String(el.value || "").trim());
    }

    if (tag === "textarea") {
      if (SELECT_LIKE_KEYS.has(key) || isYesNoValue(value) || looksLikeCombobox(el)) {
        const ok = await fillCustomDropdown(el, value, key);
        if (ok) return true;
        if (isYesNoValue(value) || SELECT_LIKE_KEYS.has(key) || looksLikeCombobox(el)) return false;
      }
      setNativeValue(el, String(value));
      return true;
    }

    if (isRichTextEditor(el) || el.isContentEditable) {
      return await fillContentEditable(el, value);
    }

    if (
      tag === "button" ||
      el.getAttribute("role") === "button" ||
      el.getAttribute("role") === "radio"
    ) {
      const t = buttonChoiceText(el);
      if (optionMatches(t, value) || (isYesNoValue(value) && optionMatches(t, value))) {
        clickChip(el);
        return true;
      }
      return false;
    }

    // Non-input combobox buttons / divs / react-select controls
    if (nearestEssayEditor(el)) return false;
    if (looksLikeCombobox(el) || isReactSelectInput(el) || el.getAttribute("role") === "combobox") {
      return fillCustomDropdown(el, value, key);
    }

    return false;
  }

  function base64ToFile(base64, fileName, mimeType) {
    const binary = atob(String(base64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], fileName || "upload.pdf", {
      type: mimeType || "application/pdf",
      lastModified: Date.now()
    });
  }

  function localUploadText(el) {
    const parts = [
      labelTextForControl(el),
      el?.getAttribute?.("name"),
      el?.getAttribute?.("id"),
      el?.getAttribute?.("aria-label"),
      el?.getAttribute?.("accept")
    ];
    const zone =
      el.closest?.(
        "[class*='dropzone' i], [class*='Dropzone'], [class*='file-upload' i], [class*='FileUpload'], [data-testid*='upload'], label"
      ) || el.parentElement;
    if (zone && zone !== document.body) {
      const t = cleanLabelText(zone.innerText || zone.textContent || "");
      if (t && t.length <= 420) parts.push(t);
      const heading = zone.previousElementSibling;
      if (heading) {
        const ht = cleanLabelText(heading.innerText || heading.textContent || "");
        if (ht && ht.length <= 160) parts.push(ht);
      }
    }
    return cleanLabelText(parts.filter(Boolean).join(" "));
  }

  function isOptionalExtraAttachmentText(text) {
    const n = normalize(text);
    if (!n) return false;
    if (/cover letter (is )?not required/.test(n)) return true;
    if (/attach up to \d+\s+files/.test(n) && !/\b(resume|cv|curriculum vitae)\b/.test(n)) {
      return true;
    }
    if (
      /\b(additional|optional|supporting)\b/.test(n) &&
      /\b(files?|documents?|attachments?)\b/.test(n) &&
      !/\b(resume|cv|curriculum vitae|cover letter)\b/.test(n)
    ) {
      return true;
    }
    return false;
  }

  function uploadAttrBlob(el) {
    if (!el?.getAttribute) return "";
    return [
      el.getAttribute("name"),
      el.id,
      el.getAttribute("for"),
      el.getAttribute("data-field"),
      el.getAttribute("data-name"),
      el.getAttribute("data-testid"),
      el.getAttribute("aria-label"),
      el.className
    ]
      .filter(Boolean)
      .join(" ");
  }

  function mentionsCoverLetter(n) {
    return /cover\s*letter|covering\s*letter|coverletter|cover_letter/.test(n);
  }

  function mentionsResume(n) {
    return /\b(resume|curriculum vitae)\b/.test(n) || /(?:^|[^a-z])cv(?:[^a-z]|$)/.test(n);
  }

  function uploadKindFromText(text) {
    const n = normalize(text);
    if (!n || isOptionalExtraAttachmentText(text)) return "";
    const cover = mentionsCoverLetter(n);
    const resume = mentionsResume(n);
    if (cover && resume) {
      if (/use (your |my )?resume (as|for) (a |my )?cover/.test(n)) return "coverLetter";
      if (/cover letter (is )?(optional|not required)/.test(n)) return "resume";
      // Prefer the section label: "Cover Letter" + leftover "Name_Resume.pdf" is still cover.
      if (/^cover\s*letter\b/.test(n) || /\bcover\s*letter\b/.test(n.slice(0, 40))) return "coverLetter";
      if (/^resume\b/.test(n) || /\bresume\b/.test(n.slice(0, 40))) return "resume";
      return "";
    }
    if (cover && !/not required/.test(n)) return "coverLetter";
    if (resume) return "resume";
    return "";
  }

  function classifyFileInput(el) {
    let node = el;
    for (let i = 0; i < 8 && node && node !== document.body; i += 1) {
      const fromAttrs = uploadKindFromText(uploadAttrBlob(node));
      if (fromAttrs) return fromAttrs;
      // Dice / ATS section headings often sit as siblings above the dropzone.
      const heading = node.querySelector?.(
        "h1, h2, h3, h4, legend, label, [class*='title'], [class*='label'], [data-cy*='label']"
      );
      const headingKind = uploadKindFromText(heading?.textContent || "");
      if (headingKind) return headingKind;
      const prev = node.previousElementSibling;
      const prevKind = uploadKindFromText(prev?.textContent || "");
      if (prevKind) return prevKind;
      node = node.parentElement || node.host || node.getRootNode?.()?.host || null;
    }
    const nearby = localUploadText(el).replace(/a cover letter is not required/gi, " ");
    const nearKind = uploadKindFromText(nearby);
    if (nearKind) return nearKind;
    // Last resort: if the nearest section text clearly says Cover Letter, prefer that
    // even when a leftover resume filename is also shown in the same card.
    if (/cover\s*letter/i.test(nearby) && !/\bresume\b/i.test(nearby.replace(/[a-z0-9._-]*resume\.pdf/gi, ""))) {
      return "coverLetter";
    }
    if (/cover\s*letter/i.test(nearby) && /\.pdf\b/i.test(nearby)) {
      // Card titled Cover Letter that still shows a prior resume file name.
      return "coverLetter";
    }
    return "";
  }

  function setFileOnInput(input, file) {
    if (!input || !file) return false;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
      if (desc?.set) desc.set.call(input, dt.files);
      else input.files = dt.files;
      const fire = (target, type) => {
        try {
          target.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
        } catch {
          target.dispatchEvent(new Event(type, { bubbles: true }));
        }
      };
      fire(input, "input");
      fire(input, "change");
      const host = input.getRootNode?.()?.host;
      if (host) {
        fire(host, "input");
        fire(host, "change");
      }
      input.dispatchEvent(
        new CustomEvent("file-upload-success", { bubbles: true, composed: true, detail: { fileName: file.name } })
      );
      return Boolean(input.files && input.files.length > 0);
    } catch {
      return false;
    }
  }

  function collectFileInputs() {
    return queryAllDeep('input[type="file"]').filter((el) => {
      if (el.disabled) return false;
      if (el.getAttribute("data-brightstar-uploaded") === "1") return false;
      if (isOptionalExtraAttachmentText(localUploadText(el))) return false;
      return true;
    });
  }

  function findUploadCards() {
    const scored = [];
    for (const el of queryAllDeep("div, section, article, li, label, aside")) {
      const raw = el.innerText || "";
      if (raw.length < 8 || raw.length > 700) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 18) continue;
      const kind = uploadKindFromText(raw);
      if (!kind) continue;
      scored.push({ el, kind, len: raw.length });
    }
    scored.sort((a, b) => a.len - b.len);
    const best = {};
    for (const row of scored) {
      if (!best[row.kind]) best[row.kind] = row.el;
    }
    return Object.entries(best).map(([kind, el]) => ({ kind, el }));
  }

  function zoneLooksOccupied(el) {
    const t = normalize(el?.innerText || "");
    if (!t) return false;
    // Dice Easy Apply often pre-selects the profile resume and only shows the filename.
    if (/\buploaded to profile\b/.test(t)) return true;
    if (/\b(use my (dice )?profile|profile resume|from (your )?profile|saved resume)\b/.test(t)) {
      return true;
    }
    if (/\.(pdf|docx?|txt)\b/.test(t)) return true;
    return /\b(replace|remove|delete|attached|uploaded)\b/.test(t);
  }

  function zoneShowsExpectedFile(el, fileName) {
    const expected = String(fileName || "").trim().toLowerCase();
    if (!expected || !el) return false;
    const t = String(el.innerText || el.textContent || "").toLowerCase();
    if (t.includes(expected)) return true;
    const stem = expected.replace(/\.(pdf|docx?|txt)$/i, "");
    return Boolean(stem) && t.includes(stem);
  }

  function clickTextIn(el, re) {
    const nodes = queryAllDeep('button, a, [role="button"], [role="menuitem"], li, span', el || document);
    const hit = nodes.find((node) => {
      const label = `${elActionText(node) || ""} ${node.getAttribute?.("aria-label") || ""} ${node.textContent || ""}`;
      return re.test(cleanLabelText(label));
    });
    if (!hit) return false;
    safeClick(hit);
    return true;
  }

  async function clickReplaceInZone(zone) {
    if (!zone) return false;
    // Prefer an explicit Replace / Upload new control (Dice profile prefill).
    if (
      clickTextIn(
        zone,
        /^(replace|change|update|re-?upload|upload new|upload different|choose (a )?different|use (a )?different|remove|delete)$/i
      )
    ) {
      await sleep(400);
      return true;
    }
    if (
      clickTextIn(
        zone,
        /\b(replace|change file|upload new|re-?upload|remove file|delete file|use a different)\b/i
      )
    ) {
      await sleep(400);
      return true;
    }
    const menuBtn = queryAllDeep("button, [role='button'], [aria-haspopup]", zone).find((el) => {
      const popup = String(el.getAttribute("aria-haspopup") || "").toLowerCase();
      const label = `${el.getAttribute("aria-label") || ""} ${elActionText(el) || ""}`;
      return popup === "menu" || popup === "true" || /\b(more|options|actions|menu)\b/i.test(label);
    });
    if (menuBtn) {
      safeClick(menuBtn);
      await sleep(280);
    } else if (
      clickTextIn(
        zone,
        /\b(more|more options|more actions|open menu|actions menu|options)\b/i
      )
    ) {
      await sleep(280);
    }
    const items = queryAllDeep('[role="menuitem"], button, a, li, span').filter((el) => isElVisible(el));
    const replace = items.find((el) =>
      /\b(replace|change|update|remove|delete|upload new|re-?upload)\b/i.test(
        cleanLabelText(el.textContent || elActionText(el))
      )
    );
    if (replace) {
      safeClick(replace);
      await sleep(400);
      return true;
    }
    return Boolean(menuBtn);
  }

  function fieldContainer(el) {
    let node = el;
    for (let i = 0; i < 8 && node && node !== document.body; i += 1) {
      if (
        node.matches?.(
          "label, fieldset, .field, [data-field], [class*='field'], [class*='upload'], [class*='dropzone' i], [class*='Dropzone']"
        )
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return el;
  }

  function rectDistance(a, b) {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const dx = ra.left + ra.width / 2 - (rb.left + rb.width / 2);
    const dy = ra.top + ra.height / 2 - (rb.top + rb.height / 2);
    return dx * dx + dy * dy;
  }

  function findFileInputNear(zone, kind = "") {
    const marked = (el) => el?.getAttribute?.("data-brightstar-uploaded") === "1";
    const usable = (el) => el && !el.disabled && !marked(el);
    const fitsKind = (el) => {
      if (!kind) return true;
      const k = classifyFileInput(el);
      return !k || k === kind;
    };
    const pick = (list) => {
      const rows = (list || []).filter(usable);
      if (!rows.length) return null;
      const matched = rows.filter((el) => classifyFileInput(el) === kind);
      if (kind && matched.length) return matched[0];
      const ok = rows.filter(fitsKind);
      return ok.length === 1 || (kind && ok.length) ? ok[0] : rows.length === 1 ? rows[0] : null;
    };

    const inZone = pick(queryAllDeep('input[type="file"]', zone || document));
    if (inZone && zone && zone !== document) return inZone;

    const container = fieldContainer(zone);
    if (container && container !== document.body && container !== document.documentElement) {
      const inField = pick(queryAllDeep('input[type="file"]', container));
      if (inField) return inField;
    }

    const parent = zone?.parentElement;
    if (parent && parent !== document.body) {
      const inParent = pick(queryAllDeep('input[type="file"]', parent));
      if (inParent) return inParent;
    }

    const all = queryAllDeep('input[type="file"]').filter(usable);
    const kinded = kind ? all.filter((el) => classifyFileInput(el) === kind) : [];
    if (kinded.length === 1) return kinded[0];
    if (kinded.length > 1) {
      kinded.sort((a, b) => rectDistance(zone, a) - rectDistance(zone, b));
      return kinded[0];
    }
    const unknown = all.filter((el) => !classifyFileInput(el));
    if (unknown.length === 1) return unknown[0];
    if (all.length === 1) return all[0];
    if (zone && all.length) {
      const near = all
        .filter(fitsKind)
        .sort((a, b) => rectDistance(zone, a) - rectDistance(zone, b));
      if (near[0] && rectDistance(zone, near[0]) < 220 * 220) return near[0];
    }
    return null;
  }

  function looksLikeUploadDropzone(el) {
    const raw = el.innerText || el.textContent || "";
    const t = normalize(raw);
    if (!t || t.length > 500) return false;
    if (isOptionalExtraAttachmentText(raw)) return false;
    return /\b(drag|drop file|drop your|browse|upload (a |your )?(resume|cv|cover)|include your resume|attach (a |your )?(resume|cv|file))\b/.test(
      t
    );
  }

  function zoneIsBusy(el) {
    if (!el?.querySelector) return false;
    if (el.getAttribute("aria-busy") === "true") return true;
    if (el.querySelector("[aria-busy='true'], [role='progressbar']")) return true;
    if (
      el.querySelector(
        "[class*='CircularProgress'], [class*='circular-progress'], [class*='MuiCircularProgress'], [class*='animate-spin']"
      )
    ) {
      return true;
    }
    return /\b(uploading|processing|please wait)\b/i.test(el.innerText || "");
  }

  function zoneAlreadyHasFile(el) {
    if (!el) return false;
    if (el.getAttribute?.("data-brightstar-uploaded") === "1") return true;
    const input = el.matches?.('input[type="file"]') ? el : el.querySelector?.('input[type="file"]');
    if (input?.files?.length) return true;
    const t = el.innerText || "";
    return /\.(pdf|docx?|txt)\b/i.test(t) && /remove|replace|uploaded|attached|delete/i.test(t);
  }

  function markUploaded(el) {
    try {
      el?.setAttribute?.("data-brightstar-uploaded", "1");
    } catch {
      /* ignore */
    }
  }

  function findUploadDropzones() {
    return queryAllDeep("div, section, label, aside, form")
      .filter(looksLikeUploadDropzone)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 80 && rect.height > 24;
      })
      .slice(0, 10);
  }

  function dispatchFileDrop(target, file) {
    if (!target || !file) return false;
    const dt = new DataTransfer();
    try {
      dt.items.add(file);
    } catch {
      return false;
    }
    for (const type of ["dragenter", "dragover", "drop"]) {
      let event;
      try {
        event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
      } catch {
        event = new Event(type, { bubbles: true, cancelable: true });
      }
      try {
        Object.defineProperty(event, "dataTransfer", { value: dt, configurable: true });
      } catch {
        /* some browsers freeze dataTransfer */
      }
      target.dispatchEvent(event);
    }
    return true;
  }

  async function revealFileDropzones() {
    if (findUploadDropzones().length && !collectFileInputs().length) {
      await sleep(500);
    }
  }

  async function uploadApplicationFiles(uploadFiles = {}) {
    const uploaded = [];
    const skipped = [];
    const resumeDoc = uploadFiles.resume;
    const coverDoc = uploadFiles.coverLetter;

    const resumeFile =
      resumeDoc?.base64 &&
      base64ToFile(resumeDoc.base64, resumeDoc.fileName || "Resume.pdf", resumeDoc.mimeType);
    const coverFile =
      coverDoc?.base64 &&
      base64ToFile(
        coverDoc.base64,
        coverDoc.fileName || "Cover_Letter.pdf",
        coverDoc.mimeType
      );

    if (!resumeFile && !coverFile) {
      return { uploadedCount: 0, uploaded, skipped: [{ reason: "no-docs" }] };
    }

    patchFileInputOpeners();
    try {
    pendingUploadFile = null;
    pendingUploadKind = "";
    await revealFileDropzones();

    const used = new WeakSet();

    async function attachToZone(kind, file, zone) {
      if (!file || !zone || used.has(zone) || zoneIsBusy(zone)) return false;
      pendingUploadFile = file;
      pendingUploadKind = kind || "";

      // Dice / ATS often preselect profile or prior-job files — Replace first for resume AND cover.
      if (zoneLooksOccupied(zone) && !zoneShowsExpectedFile(zone, file.name)) {
        await clickReplaceInZone(zone);
        await sleep(450);
        try {
          zone.removeAttribute?.("data-brightstar-uploaded");
        } catch {
          /* ignore */
        }
      }

      let input = findFileInputNear(zone, kind);
      if (input && setFileOnInput(input, file)) {
        await sleep(500);
        if (zoneShowsExpectedFile(zone, file.name) || input.files?.[0]?.name === file.name) {
          used.add(zone);
          used.add(input);
          markUploaded(input);
          markUploaded(zone);
          return true;
        }
        // UI still shows the old profile file — force Replace and retry once.
        await clickReplaceInZone(zone);
        await sleep(450);
        input = findFileInputNear(zone, kind);
        if (input && setFileOnInput(input, file)) {
          await sleep(500);
          used.add(zone);
          used.add(input);
          markUploaded(input);
          markUploaded(zone);
          return zoneShowsExpectedFile(zone, file.name) || input.files?.[0]?.name === file.name;
        }
      }
      if (dispatchFileDrop(zone, file)) {
        await sleep(500);
        if (zoneShowsExpectedFile(zone, file.name)) {
          used.add(zone);
          markUploaded(zone);
          return true;
        }
      }
      if (clickTextIn(zone, /^(browse|upload|select file|choose file|attach)$/i)) {
        await sleep(250);
        input = findFileInputNear(zone, kind);
        if (input && setFileOnInput(input, file)) {
          await sleep(500);
          used.add(zone);
          used.add(input);
          markUploaded(input);
          markUploaded(zone);
          return zoneShowsExpectedFile(zone, file.name) || input.files?.[0]?.name === file.name;
        }
      }
      return false;
    }

    const inputs = collectFileInputs();
    for (const input of inputs) {
      if (used.has(input) || input.getAttribute("data-brightstar-uploaded") === "1") continue;
      const kind = classifyFileInput(input);
      let file = null;
      if (!kind) continue;
      if (kind === "coverLetter" && coverFile) file = coverFile;
      else if (kind === "resume" && resumeFile) file = resumeFile;
      else if (kind === "coverLetter" && !coverFile && resumeFile) {
        skipped.push({ reason: "no-cover-letter-doc", label: labelTextForControl(input) });
        continue;
      }
      if (!file) continue;
      pendingUploadFile = file;
      pendingUploadKind = kind;
      const zone = input.closest("div, section, label, form, article, aside") || input.parentElement;
      if (used.has(zone) || zoneIsBusy(zone)) continue;
      if (zoneLooksOccupied(zone) && !zoneShowsExpectedFile(zone, file.name)) {
        await clickReplaceInZone(zone);
        await sleep(450);
      }
      const ok = setFileOnInput(input, file);
      if (ok) {
        await sleep(500);
        if (!zoneShowsExpectedFile(zone, file.name) && input.files?.[0]?.name !== file.name) {
          await clickReplaceInZone(zone);
          await sleep(450);
          const again = findFileInputNear(zone, kind) || input;
          setFileOnInput(again, file);
          await sleep(500);
        }
        used.add(input);
        markUploaded(input);
        markUploaded(zone);
        uploaded.push({
          kind,
          fileName: file.name,
          label: labelTextForControl(input),
          verified: zoneShowsExpectedFile(zone, file.name) || input.files?.[0]?.name === file.name
        });
      }
    }

    for (const { kind, el } of findUploadCards()) {
      const file = kind === "coverLetter" ? coverFile : resumeFile;
      if (!file) continue;
      if (uploaded.some((row) => row.kind === kind && row.verified !== false)) continue;
      // Always try occupied Dice/profile cards — even if a prior unverified attempt exists.
      const ok = await attachToZone(kind, file, el);
      if (ok) {
        uploaded.push({
          kind,
          fileName: file.name,
          label: cleanLabelText(el.innerText || "").slice(0, 80),
          verified: zoneShowsExpectedFile(el, file.name)
        });
      } else if (zoneLooksOccupied(el) && !zoneShowsExpectedFile(el, file.name)) {
        skipped.push({
          reason: "could-not-replace-profile-file",
          kind,
          label: cleanLabelText(el.innerText || "").slice(0, 80),
          expected: file.name
        });
      }
    }

    if (!uploaded.some((row) => row.kind === "coverLetter") || !uploaded.some((row) => row.kind === "resume")) {
      for (const zone of findUploadDropzones()) {
        if (isOptionalExtraAttachmentText(zone.innerText || "")) continue;
        if (used.has(zone) || zoneIsBusy(zone)) continue;
        let kind = classifyFileInput(zone) || uploadKindFromText(zone.innerText || "");
        if (!kind) continue;
        if (uploaded.some((row) => row.kind === kind && row.verified !== false)) continue;
        const file = kind === "coverLetter" && coverFile ? coverFile : kind === "resume" ? resumeFile : null;
        if (!file) continue;
        const ok = await attachToZone(kind, file, zone);
        if (ok) {
          uploaded.push({
            kind,
            fileName: file.name,
            label: cleanLabelText(zone.innerText || "").slice(0, 80),
            via: "dropzone",
            verified: zoneShowsExpectedFile(zone, file.name)
          });
        }
      }
    }

    // Prefer verified uploads when summarizing — drop stale unverified duplicates.
    const preferred = [];
    for (const kind of ["resume", "coverLetter"]) {
      const rows = uploaded.filter((r) => r.kind === kind);
      const verified = rows.find((r) => r.verified);
      if (verified) preferred.push(verified);
      else if (rows[0]) preferred.push(rows[0]);
    }
    for (const row of uploaded) {
      if (!preferred.includes(row) && row.kind !== "resume" && row.kind !== "coverLetter") {
        preferred.push(row);
      }
    }

    if (!inputs.length && !preferred.length) {
      skipped.push({ reason: "no-file-inputs" });
    }

    return { uploadedCount: preferred.length, uploaded: preferred, skipped };
    } finally {
      pendingUploadFile = null;
      pendingUploadKind = "";
    }
  }

  function looksLikeQuestionLabel(label) {
    const t = String(label || "").trim();
    if (t.length < 12) return false;
    if (t.length > 1200) return false;
    if (/[?]/.test(t)) return true;
    if (
      /^(tell|describe|explain|share|what|why|how|please|list|provide|summarize|walk)\b/i.test(t)
    ) {
      return true;
    }
    if (
      /\b(experience|interested|motivation|challenge|strength|weakness|about yourself|additional|comment|approach|follow.?up)\b/i.test(
        t
      )
    ) {
      return true;
    }
    return false;
  }

  function isMultilineControl(el) {
    return el.tagName === "TEXTAREA" || Number(el.rows || 0) > 1;
  }

  function shouldSkipAiField(el, label) {
    const type = (el.type || "text").toLowerCase();
    if (
      ["password", "email", "tel", "url", "number", "date", "month", "week", "time", "color", "range"].includes(
        type
      )
    ) {
      return true;
    }
    // Never send React-Select / Greenhouse dropdowns to AI text fill.
    if (!isRichTextEditor(el)) {
      if (isReactSelectInput(el) || looksLikeCombobox(el) || isEditorChrome(el)) return true;
      if (el.getAttribute("role") === "combobox") return true;
      if (el.getAttribute("aria-autocomplete") === "list") return true;
      if (el.classList?.contains("select__input")) return true;
      if (/^react-select-/i.test(el.id || "")) return true;
    }

    const blob = normalize(
      [label, el.name, el.id, el.getAttribute("autocomplete"), el.getAttribute("placeholder")].join(
        " "
      )
    );
    if (
      /\b(password|otp|captcha|ssn|social security|credit card|card number|cvv|routing|account number|search)\b/.test(
        blob
      )
    ) {
      return true;
    }
    if (String(el.value || "").trim()) return true;
    return false;
  }

  const SKIP_AI_KNOWN_KEYS = new Set([
    "firstName",
    "lastName",
    "email",
    "phone",
    "zipCode",
    "city",
    "state",
    "country",
    "cityCountryOfResidence",
    "workAuthorized",
    "needsSponsorship",
    "postEmploymentRestrictions",
    "workedForCompanyBefore",
    "relatedToEmployee",
    "governmentEmployee",
    "governmentEthicsRecusal",
    "gender",
    "hispanicLatino",
    "raceEthnicity",
    "veteranStatus",
    "disabilityStatus",
    "englishLevel",
    "over18",
    "willingToRelocate",
    "felonyConviction",
    "backgroundCheckConsent",
    "drugTestConsent"
  ]);

  function isCertificationQuestion(label) {
    return /\b(certif(?:ied|ication|ications)?|credentials you (currently )?hold)\b/i.test(
      String(label || "")
    );
  }

  function essayNeedsRewrite(el, questionLabel) {
    const current = editorVisibleText(el);
    if (!current) return false;
    if (!isCertificationQuestion(questionLabel)) return false;
    if (/stakeholder|business objectives|adaptable for future/i.test(current) && !/\bcertified\b/i.test(current)) {
      return true;
    }
    if (!/\b(certif|credential|administrator|architect|platform developer|app builder|consultant)\b/i.test(current)) {
      return true;
    }
    if (/application architect/i.test(questionLabel) && /\badministrator\b/i.test(questionLabel)) {
      const mentionsArch = /application architect/i.test(current);
      const mentionsAdmin = /\badministrator\b/i.test(current);
      const mentionsBoth = /\bboth\b/i.test(current);
      if (!(mentionsBoth || (mentionsArch && mentionsAdmin))) return true;
    }
    return false;
  }

  function collectUnmatchedQuestions(applicantInfo = {}) {
    const questions = [];
    const nodes = [...document.querySelectorAll("input, textarea")].filter((el) => {
      const type = (el.type || "text").toLowerCase();
      if (el.tagName === "TEXTAREA") return true;
      if (el.tagName === "INPUT" && ["text", "search", ""].includes(type)) return true;
      return false;
    });

    for (const el of nodes) {
      // Hard skip Greenhouse / React-Select — never AI-fill dropdown search inputs.
      if (isReactSelectInput(el) || looksLikeCombobox(el)) continue;

      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (el.disabled || el.readOnly) continue;

      if (isHistoryFilled(el)) continue;
      const labelNorm = labelTextForControl(el);
      const questionLabel = questionTextForAi(el);
      if (!labelNorm && !questionLabel) continue;
      if (shouldSkipAiField(el, labelNorm || questionLabel)) continue;

      const multiline = isMultilineControl(el);
      const key = matchApplicantKeyFromControl(el);
      if (key) {
        const known = applicantInfo[key];
        if (known != null && String(known).trim()) continue;
        if (SKIP_AI_KNOWN_KEYS.has(key) || SELECT_LIKE_KEYS.has(key)) continue;
      }

      const labelForCheck = normalize(questionLabel || labelNorm);
      if (
        /\b(extension|device type|country phone code|phone code|password|captcha|search)\b/.test(
          labelForCheck
        )
      ) {
        continue;
      }

      const questionLike =
        looksLikeQuestionLabel(questionLabel) || looksLikeQuestionLabel(labelNorm);
      const hasUsefulLabel = String(questionLabel || labelNorm).trim().length >= 3;
      if (!questionLike && !multiline && !hasUsefulLabel) continue;
      if (multiline && !questionLike && String(questionLabel || labelNorm).trim().length < 8) {
        continue;
      }

      if (questions.length >= 25) break;

      const labelForAi = (questionLabel || labelNorm).slice(0, 1000);
      const id = `rbq_${questions.length}_${Math.abs(
        Array.from(labelForAi).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) | 0, 7)
      )}`;
      el.setAttribute("data-resume-bot-qid", id);
      questions.push({
        id,
        label: labelForAi,
        multiline,
        fieldType: el.tagName === "TEXTAREA" ? "textarea" : "text"
      });
    }

    for (const el of collectRichTextEditors()) {
      if (questions.length >= 25) break;
      const near = essayQuestionForEditor(el);
      const fromAi = questionTextForAi(el);
      let questionLabel = near || fromAi;
      if (looksLikeEditorChromeValue(questionLabel)) {
        questionLabel = looksLikeEditorChromeValue(near) ? fromAi : near;
      }
      if (!isRichTextEmpty(el) && !essayNeedsRewrite(el, questionLabel)) continue;
      if (el.getAttribute("data-resume-bot-qid") && !essayNeedsRewrite(el, questionLabel)) continue;
      if (!questionLabel || looksLikeEditorChromeValue(questionLabel)) continue;
      if (shouldSkipAiField(el, questionLabel)) continue;
      if (matchApplicantKeyFromControl(el) && SKIP_AI_KNOWN_KEYS.has(matchApplicantKeyFromControl(el))) {
        continue;
      }
      const labelForAi = questionLabel.slice(0, 1000);
      const id = `rbq_${questions.length}_${Math.abs(
        Array.from(labelForAi).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) | 0, 7)
      )}`;
      el.setAttribute("data-resume-bot-qid", id);
      questions.push({
        id,
        label: labelForAi,
        multiline: true,
        fieldType: "textarea"
      });
    }

    return questions;
  }

  async function fillAiAnswers(answers = []) {
    suppressLearn();
    const filled = [];
    for (const row of answers) {
      const id = String(row?.id || "").trim();
      let answer = String(row?.answer || "").trim();
      if (!id || !answer) continue;
      const el = document.querySelector(`[data-resume-bot-qid="${CSS.escape(id)}"]`);
      if (!el) continue;
      // Combobox / React-Select must never receive free-text AI answers.
      // Rich-text editors can look combobox-adjacent because of their toolbars.
      if (!isRichTextEditor(el) && (isReactSelectInput(el) || looksLikeCombobox(el) || isEditorChrome(el))) {
        el.removeAttribute("data-resume-bot-qid");
        continue;
      }
      if (/^(yes|no)([.,!]|$)/i.test(answer)) {
        answer = answer.charAt(0).toUpperCase() + answer.slice(1);
      }
      if (looksLikeEditorChromeValue(answer)) continue;
      if (await fillControl(el, answer, null)) {
        filled.push({ id, label: labelTextForControl(el), preview: answer.slice(0, 80) });
      }
    }
    return { filledCount: filled.length, filled };
  }

  /**
   * Collect novel CHOICE questions (native select / radio / checkbox) that are
   * NOT mapped to a known profile field. These get answered from the Q&A bank
   * (stable, reusable selections) — never from AI.
   */
  function collectUnmatchedChoiceQuestions() {
    const out = [];
    const groupIds = new Map(); // labelNorm -> id (radio/checkbox groups share one)
    const nodes = [
      ...document.querySelectorAll('select, input[type="radio"], input[type="checkbox"]')
    ];

    for (const el of nodes) {
      if (out.length >= 40) break;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (el.disabled) continue;
      if (isHistoryFilled(el)) continue;
      if (isReactSelectInput(el)) continue;

      // Known profile / rule fields are handled by the deterministic autofill loop.
      if (matchApplicantKeyFromControl(el)) continue;
      if (!isChoiceControlEmpty(el)) continue;

      const label = captureQuestionText(el);
      if (!label) continue;
      if (LEARN_SENSITIVE_RE.test(label)) continue;
      const labelNorm = normalize(label);
      if (!labelNorm || labelNorm.length < 6) continue;

      const options = collectControlOptions(el);
      if (!options.length) continue;

      const isGroup = el.type === "radio" || el.type === "checkbox";
      if (isGroup && groupIds.has(labelNorm)) {
        el.setAttribute("data-resume-bot-choice-qid", groupIds.get(labelNorm));
        continue;
      }

      const id = `rbc_${out.length}_${Math.abs(
        Array.from(labelNorm).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) | 0, 7)
      )}`;
      el.setAttribute("data-resume-bot-choice-qid", id);
      if (isGroup) groupIds.set(labelNorm, id);
      const fieldType =
        el.tagName === "SELECT"
          ? "select"
          : el.type === "checkbox"
            ? "checkbox"
            : el.type === "radio"
              ? "radio"
              : "select";
      out.push({ id, label: label.slice(0, 1000), options, fieldType });
    }

    for (const group of collectChoiceChipGroups()) {
      if (out.length >= 40) break;
      if (group.selected) continue;
      if (group.buttons.some(isEditorChrome)) continue;
      if ((group.labels || []).some((l) => EDITOR_STYLE_OPTION_RE.test(l))) continue;
      if (group.kind === "start") continue;
      const label = group.question;
      if (!label || LEARN_SENSITIVE_RE.test(label)) continue;
      const labelNorm = normalize(label);
      if (!labelNorm || labelNorm.length < 6) continue;
      const id = `rbc_${out.length}_${Math.abs(
        Array.from(labelNorm).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) | 0, 7)
      )}`;
      for (const btn of group.buttons) {
        btn.setAttribute("data-resume-bot-choice-qid", id);
      }
      out.push({
        id,
        label: label.slice(0, 1000),
        options: group.labels.filter(Boolean).slice(0, 20),
        fieldType: group.kind === "yesno" ? "radio" : "select"
      });
    }

    const seenLabels = new Set(out.map((q) => normalize(q.label)));
    const comboNodes = [
      ...document.querySelectorAll(
        '[role="combobox"], input.select__input, [aria-haspopup="listbox"]'
      )
    ];
    for (const el of comboNodes) {
      if (out.length >= 40) break;
      if (isEditorChrome(el) || isRichTextEditor(el) || nearestEssayEditor(el)) continue;
      if (!looksLikeCombobox(el) && !isReactSelectInput(el)) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (el.disabled) continue;
      if (isHistoryFilled(el)) continue;
      if (matchApplicantKeyFromControl(el)) continue;
      if (String(el.value || "").trim() && !isPlaceholderChoiceValue(el.value)) continue;

      const label = captureQuestionText(el);
      if (!label || LEARN_SENSITIVE_RE.test(label)) continue;
      const labelNorm = normalize(label);
      if (!labelNorm || labelNorm.length < 6 || seenLabels.has(labelNorm)) continue;

      const expanded = el.getAttribute("aria-expanded") === "true";
      const options = expanded
        ? collectVisibleOptions(document)
            .map((node) => cleanLabelText(node.textContent))
            .filter(Boolean)
            .slice(0, 40)
        : [];

      const id = `rbc_${out.length}_${Math.abs(
        Array.from(labelNorm).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) | 0, 7)
      )}`;
      el.setAttribute("data-resume-bot-choice-qid", id);
      seenLabels.add(labelNorm);
      out.push({
        id,
        label: label.slice(0, 1000),
        options,
        fieldType: "combobox"
      });
    }

    return out;
  }

  async function fillChoiceAnswers(answers = []) {
    suppressLearn();
    const filled = [];
    for (const row of answers) {
      const id = String(row?.id || "").trim();
      const answer = String(row?.answer || "").trim();
      if (!id || !answer) continue;
      const els = [
        ...document.querySelectorAll(`[data-resume-bot-choice-qid="${CSS.escape(id)}"]`)
      ];
      if (!els.length) continue;
      let ok = false;
      for (const el of els) {
        if (isEditorChrome(el) || nearestEssayEditor(el)) continue;
        if (await fillControl(el, answer, null)) {
          ok = true;
          if (el.tagName === "SELECT") break; // one select is enough
        }
      }
      if (ok) filled.push({ id, preview: answer.slice(0, 80) });
    }
    return { filledCount: filled.length, filled };
  }

  function collectFillableControls() {
    const nodes = queryAllDeep(
      'input, textarea, select, [role="combobox"], [aria-haspopup="listbox"], .select__control, [class*="select__control"]'
    );
    return nodes.filter((el) => {
      if (isEditorChrome(el) || isRichTextEditor(el) || nearestEssayEditor(el)) return false;
      const type = (el.type || "").toLowerCase();
      if (type === "file") return false;
      if (type === "hidden" || type === "submit" || type === "button") return false;
      // Prefer the inner input over the outer .select__control wrapper when both match.
      if (
        el.classList?.contains("select__control") ||
        /select__control/.test(el.className || "")
      ) {
        const inner = el.querySelector("input.select__input, input[role='combobox'], input");
        if (inner) return false;
      }
      const style = window.getComputedStyle(el);
      const hiddenChoice = type === "radio" || type === "checkbox";
      if (!hiddenChoice && (style.display === "none" || style.visibility === "hidden")) return false;
      return true;
    });
  }

  function isFieldFillable(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (typeof el.value === "undefined") return false;
    const type = (el.type || "").toLowerCase();
    const hiddenChoice = type === "radio" || type === "checkbox";
    try {
      const style = window.getComputedStyle(el);
      if (!hiddenChoice && (style.display === "none" || style.visibility === "hidden")) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        if (type !== "file" && !hiddenChoice) return false;
      }
    } catch {
      return hiddenChoice;
    }
    return true;
  }

  function setCredentialValue(el, value) {
    if (!el || value == null || String(value) === "") return false;
    try {
      el.focus?.();
    } catch {
      /* focus is best-effort */
    }
    const ok = setNativeValue(el, String(value));
    try {
      el.blur?.();
    } catch {
      /* blur is best-effort */
    }
    return ok;
  }

  function firstCredentialField(selectors, used) {
    for (const sel of selectors) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const el of nodes) {
        if (used.has(el)) continue;
        if (isFieldFillable(el)) return el;
      }
    }
    return null;
  }

  /**
   * Fill saved login / sign-up credentials (email, username, password) on an
   * auth / "create a login" section. Only acts when a password field is present,
   * so plain contact-email fields stay with profile autofill. Never submits.
   *
   * iCIMS uses a bare "Login*" field (not always name=username) — match by label too.
   */
  function fillLoginCredentials(credentials = {}) {
    const email = String(credentials.email || "").trim();
    const username = String(credentials.username || "").trim();
    const password = String(credentials.password || "").trim();
    if (!email && !username && !password) return { filledCount: 0, filled: [] };

    const passwordFields = Array.from(
      document.querySelectorAll('input[type="password"]')
    ).filter(isFieldFillable);
    // No password field ⇒ this is not a login/register form; don't touch it.
    if (!passwordFields.length) return { filledCount: 0, filled: [] };

    suppressLearn();
    const filled = [];
    const used = new Set();

    if (password) {
      // Fill the primary password and any confirm-password field with the same value.
      for (const el of passwordFields) {
        if (setCredentialValue(el, password)) {
          used.add(el);
          filled.push("password");
        }
      }
    }

    const loginValue = username || email;

    // Prefer an explicit Login / Username field (iCIMS "Login*") over the contact Email.
    if (loginValue) {
      let loginEl = firstCredentialField(
        [
          'input[autocomplete="username"]',
          'input[name*="login" i]',
          'input[id*="login" i]',
          'input[name*="user" i]',
          'input[id*="user" i]',
          'input[placeholder*="user" i]',
          'input[aria-label*="user" i]',
          'input[placeholder*="login" i]',
          'input[aria-label*="login" i]'
        ],
        used
      );
      if (!loginEl) {
        for (const el of document.querySelectorAll("input")) {
          if (used.has(el) || !isFieldFillable(el)) continue;
          const type = (el.type || "text").toLowerCase();
          if (["password", "hidden", "file", "submit", "button", "checkbox", "radio"].includes(type)) {
            continue;
          }
          const label = normalize(labelTextForControl(el));
          if (!label) continue;
          // Exact-ish "login" / "username" — avoid matching "LinkedIn" etc.
          if (
            label === "login" ||
            label === "username" ||
            label === "user name" ||
            label.startsWith("login ") ||
            /\b(login|username|user name)\b/.test(label)
          ) {
            if (/linkedin|email|password|phone/.test(label)) continue;
            loginEl = el;
            break;
          }
        }
      }
      if (loginEl && setCredentialValue(loginEl, loginValue)) {
        used.add(loginEl);
        filled.push(username ? "username" : "login");
      }
    }

    if (email) {
      const el = firstCredentialField(
        [
          'input[type="email"]',
          'input[autocomplete="email"]',
          'input[name*="email" i]',
          'input[id*="email" i]',
          'input[placeholder*="email" i]',
          'input[aria-label*="email" i]'
        ],
        used
      );
      if (el && setCredentialValue(el, email)) {
        used.add(el);
        filled.push("email");
      }
    }

    return { filledCount: filled.length, filled };
  }

  /** Prefer the profile field; fall back preferredName → firstName. */
  function resolveApplicantValue(applicantInfo, key) {
    const direct = applicantInfo?.[key];
    if (direct != null && String(direct).trim()) return String(direct).trim();
    if (key === "preferredName") {
      const first = applicantInfo?.firstName;
      if (first != null && String(first).trim()) return String(first).trim();
    }
    if (key === "phoneDeviceType") return "mobile";
    if (key === "phoneCountryCode") {
      const country = String(applicantInfo?.country || "").trim();
      if (/united states|usa|\bus\b/i.test(country)) return "United States of America (+1)";
    }
    if (key === "cityCountryOfResidence") {
      const city = String(applicantInfo?.city || "").trim();
      const state = String(applicantInfo?.state || "").trim();
      const country = String(applicantInfo?.country || "").trim();
      const stateLabel = US_STATE_LABELS[state.toUpperCase()] || state;
      const parts = [city, stateLabel, country].filter(Boolean);
      if (parts.length) return parts.join(", ");
    }
    // Sensible defaults for common yes/no compliance questions when profile is blank.
    if (key === "workAuthorized") return "yes";
    if (key === "needsSponsorship") return "no";
    if (key === "postEmploymentRestrictions") return "no";
    if (key === "workedForCompanyBefore") return "no";
    if (key === "relatedToEmployee") return "no";
    if (key === "governmentEmployee") return "no";
    if (key === "governmentEthicsRecusal") return "no";
    return "";
  }

  function isPlaceholderChoiceValue(text) {
    const t = cleanLabelText(text);
    return !t || /^(select one|please select|choose|--|-)$/i.test(t);
  }

  function isChoiceControlEmpty(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      const opt = el.options?.[el.selectedIndex];
      const t = cleanLabelText(opt?.textContent || opt?.value || "");
      return isPlaceholderChoiceValue(t);
    }
    if (el.type === "radio" && el.name) {
      const checked = document.querySelector(
        `input[type="radio"][name="${CSS.escape(el.name)}"]:checked`
      );
      return !checked;
    }
    if (el.type === "checkbox") return !el.checked;
    return false;
  }

  function collectControlOptions(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      return [...el.options]
        .map((o) => cleanLabelText(o.textContent || o.value || ""))
        .filter((t) => !isPlaceholderChoiceValue(t));
    }
    if (el.type === "radio" && el.name) {
      const opts = [];
      const seen = new Set();
      for (const r of document.querySelectorAll(
        `input[type="radio"][name="${CSS.escape(el.name)}"]`
      )) {
        const wrap = r.closest("label");
        let t = wrap ? cleanLabelText(wrap.textContent) : cleanLabelText(r.value || "");
        if (wrap) {
          const clone = wrap.cloneNode(true);
          clone.querySelectorAll("input").forEach((n) => n.remove());
          t = cleanLabelText(clone.textContent);
        }
        if (!t) t = cleanLabelText(r.getAttribute("aria-label") || r.value || "");
        const norm = normalize(t);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        opts.push(t);
      }
      return opts;
    }
    if (el.type === "checkbox") return ["Yes", "No"];
    return [];
  }

  /** Second pass: fill empty dropdowns/radios using profile defaults + rule-based keys. */
  async function fillRemainingChoiceControls(applicantInfo = {}) {
    const filled = [];
    const handledRadioGroups = new Set();

    const yesNoFilled = fillYesNoButtonGroups(applicantInfo);
    for (const row of yesNoFilled) filled.push(row);

    const nodes = [
      ...document.querySelectorAll('select, input[type="radio"], input[type="checkbox"]')
    ];

    for (const el of nodes) {
      if (el.disabled) continue;
      if (isHistoryFilled(el)) continue;
      const type = (el.type || "").toLowerCase();
      const style = window.getComputedStyle(el);
      const hiddenChoice = type === "radio" || type === "checkbox";
      if (!hiddenChoice && (style.display === "none" || style.visibility === "hidden")) continue;
      if (el.type === "radio" && el.name) {
        if (handledRadioGroups.has(el.name)) continue;
        handledRadioGroups.add(el.name);
        if (!isChoiceControlEmpty(el)) continue;
        const key = matchApplicantKeyFromControl(el);
        if (!key) continue;
        const value = resolveApplicantValue(applicantInfo, key);
        if (!value) continue;
        const group = [
          ...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)
        ];
        let ok = false;
        for (const radio of group) {
          if (await fillControl(radio, value, key)) {
            ok = true;
            break;
          }
        }
        if (ok) filled.push({ key, label: questionLabelForControl(el) });
        continue;
      }

      if (!isChoiceControlEmpty(el)) continue;
      const key = matchApplicantKeyFromControl(el);
      if (!key) continue;
      const value = resolveApplicantValue(applicantInfo, key);
      if (!value) continue;
      if (await fillControl(el, value, key)) {
        filled.push({ key, label: questionLabelForControl(el) });
      }
    }

    return { filledCount: filled.length, filled };
  }

  function markHistoryFilled(el) {
    if (!el) return;
    el.setAttribute("data-resume-bot-history", "1");
  }

  function isHistoryFilled(el) {
    return el?.getAttribute?.("data-resume-bot-history") === "1";
  }

  function historyContext(el) {
    const parts = [
      questionLabelForControl(el),
      el.getAttribute?.("aria-label") || "",
      el.getAttribute?.("placeholder") || "",
      el.name || "",
      el.id || ""
    ];
    let node = el.parentElement;
    for (let i = 0; i < 4 && node; i += 1) {
      const aria = node.getAttribute?.("aria-label") || "";
      if (aria) parts.push(aria);
      const kid = node.querySelector(
        ":scope > legend, :scope > label, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > p, :scope > span"
      );
      if (kid) parts.push(String(kid.textContent || "").slice(0, 120));
      node = node.parentElement;
    }
    return normalize(parts.filter(Boolean).join(" "));
  }

  function classifyHistoryField(el, sectionKind) {
    const type = (el.type || "").toLowerCase();
    const label = normalize(questionLabelForControl(el) || labelTextForControl(el));
    const ctx = `${label} ${historyContext(el)}`;
    const isCheck = type === "checkbox" || type === "radio";

    if (/\b(street|address line|zip|postal|ssn|password|salary|compensation)\b/.test(ctx)) {
      return null;
    }

    if (
      isCheck &&
      /\b(currently (work|employed)|i currently work|current (job|position|role|employer)|still work here)\b/.test(
        ctx
      )
    ) {
      return "current";
    }

    if (sectionKind === "education") {
      if (/\b(school|university|college|institution)\b/.test(ctx) && !/\b(email|phone)\b/.test(ctx)) {
        return "school";
      }
      if (/\b(field of study|major|concentration|area of study)\b/.test(ctx)) return "fieldOfStudy";
      if (/\b(degree|diploma)\b/.test(ctx)) return "degree";
    }

    if (sectionKind === "work") {
      if (/\b(company|employer|organization|organisation)\b/.test(ctx) && !/\b(email|phone|website)\b/.test(ctx)) {
        return "company";
      }
      if (
        /^(title|role|position)$/.test(label) ||
        /\b(job title|position title|role title|title of (the )?(job|role|position)|position held)\b/.test(ctx)
      ) {
        return "title";
      }
      if (
        /\b(job location|work location|employment location)\b/.test(ctx) ||
        (/^(location|city)$/.test(label) && !/\b(address|street|home)\b/.test(ctx))
      ) {
        return "location";
      }
    }

    const startish = /\b(start|from|begin|beginning|date from)\b/.test(ctx);
    const endish = /\b(end|to|through|until|till|date to|finish)\b/.test(ctx) && !/\b(together|today)\b/.test(ctx);
    const monthish =
      /^(month)$/.test(label) ||
      /\b(start month|end month|from month|to month|month)\b/.test(ctx);
    const yearish =
      /^(year)$/.test(label) ||
      /\b(start year|end year|from year|to year|year)\b/.test(ctx);

    if (monthish && startish && !endish) return "startMonth";
    if (monthish && endish && !startish) return "endMonth";
    if (yearish && startish && !endish) return "startYear";
    if (yearish && endish && !startish) return "endYear";
    if (monthish) return "month";
    if (yearish) return "year";

    if (/\b(start date|from date|begin date|date from|starting date)\b/.test(ctx)) return "startDate";
    if (/\b(end date|to date|through date|date to|ending date|finish date)\b/.test(ctx)) return "endDate";

    if (
      el.tagName === "TEXTAREA" ||
      /\b(description|summary|responsibilities|highlights|duties|role overview|job details)\b/.test(ctx)
    ) {
      if (sectionKind === "work" || /\b(job|role|position|experience|employment)\b/.test(ctx)) {
        return "summary";
      }
    }

    return null;
  }

  function assignDateSlots(slot, kind, el) {
    if (kind === "month") {
      if (!slot.startMonth) slot.startMonth = el;
      else if (!slot.endMonth) slot.endMonth = el;
      return;
    }
    if (kind === "year") {
      if (!slot.startYear) slot.startYear = el;
      else if (!slot.endYear) slot.endYear = el;
      return;
    }
    if (!slot[kind]) slot[kind] = el;
  }

  function collectHistoryGroups(scope, sectionKind) {
    const root = scope && scope.querySelectorAll ? scope : document;
    const controls = collectFillableControls().filter((el) => root === document || root.contains(el));
    const fields = [];
    for (const el of controls) {
      const kind = classifyHistoryField(el, sectionKind);
      if (!kind) continue;
      fields.push({ el, kind });
    }
    if (!fields.length) return [];

    const identity = sectionKind === "education" ? "school" : "company";
    const groups = [];
    let slot = {};
    for (const field of fields) {
      const startsNew =
        (field.kind === identity && slot[identity]) ||
        (field.kind === "title" && slot.title && (slot.company || slot.school));
      if (startsNew) {
        groups.push(slot);
        slot = {};
      }
      assignDateSlots(slot, field.kind, field.el);
    }
    if (Object.keys(slot).length) groups.push(slot);
    return groups.filter((g) =>
      sectionKind === "education" ? g.school || g.degree : g.company || g.title
    );
  }

  function findHistorySectionScope(sectionKind) {
    const re =
      sectionKind === "education"
        ? /\b(education|academic|school history|schools)\b/i
        : /\b(work (history|experience)|employment( history)?|professional experience|experience)\b/i;
    const nodes = [
      ...document.querySelectorAll("h1, h2, h3, h4, h5, legend, [role='heading'], label, p, span, div")
    ];
    for (const node of nodes) {
      if (!isElVisible(node)) continue;
      const text = cleanLabelText(node.textContent || "");
      if (!text || text.length > 80) continue;
      if (!re.test(text)) continue;
      const section = node.closest("section, fieldset, form, [role='group'], [class*='section'], [class*='experience'], [class*='education']");
      if (section && section.querySelectorAll("input, select, textarea").length >= 2) return section;
      const parent = node.parentElement;
      if (parent && parent.querySelectorAll("input, select, textarea").length >= 2) return parent;
    }
    return null;
  }

  function findAddHistoryButton(scope, sectionKind) {
    const root = scope && scope.querySelectorAll ? scope : document;
    const re =
      sectionKind === "education"
        ? /\badd(\s+(another|an|a))?\s*(education|school|degree|institution)\b|\badd another\b/i
        : /\badd(\s+(another|an|a))?\s*(job|position|role|experience|employer|work)\b|\badd another\b|\badd an? (item|entry)\b/i;
    const buttons = [
      ...root.querySelectorAll('button, a, [role="button"], input[type="button"]')
    ].filter((el) => isElVisible(el) && isElEnabled(el));
    return (
      buttons.find((el) => re.test(elActionText(el))) ||
      buttons.find((el) => /^add$/i.test(elActionText(el)) && /experience|education|employment|history/i.test(historyContext(el)))
    );
  }

  async function ensureHistoryGroups(sectionKind, needed) {
    const headingScope = findHistorySectionScope(sectionKind);
    const scope = headingScope || document;
    let groups = collectHistoryGroups(scope, sectionKind);
    if (!groups.length) return groups;
    const want = Math.min(Math.max(1, Number(needed) || 1), 8);
    if (!headingScope) return groups;
    for (let i = 0; i < 8 && groups.length < want; i += 1) {
      const btn = findAddHistoryButton(headingScope, sectionKind);
      if (!btn) break;
      scrollElIntoView(btn);
      safeClick(btn);
      await sleep(550);
      groups = collectHistoryGroups(headingScope, sectionKind);
    }
    return groups;
  }

  function historyDateValues(bundle = {}, extra = []) {
    const out = [];
    for (const v of [
      ...(Array.isArray(bundle.candidates) ? bundle.candidates : []),
      bundle.month,
      bundle.monthShort,
      bundle.monthNum,
      bundle.year,
      bundle.isoMonth,
      bundle.isoDate,
      bundle.display,
      ...extra
    ]) {
      const s = String(v || "").trim();
      if (s && !out.includes(s)) out.push(s);
    }
    return out;
  }

  async function fillHistoryValue(el, values) {
    if (!el) return false;
    const list = Array.isArray(values) ? values : [values];
    for (const value of list) {
      if (value == null || String(value).trim() === "") continue;
      if (await fillControl(el, String(value).trim(), null)) {
        markHistoryFilled(el);
        return true;
      }
    }
    return false;
  }

  async function fillOneHistoryGroup(slot, entry, sectionKind) {
    const filled = [];
    const tryFill = async (kind, values) => {
      const el = slot[kind];
      if (!el || isHistoryFilled(el)) return;
      if (await fillHistoryValue(el, values)) filled.push(kind);
    };

    if (sectionKind === "education") {
      await tryFill("school", [entry.school]);
      await tryFill("degree", [entry.degree]);
      await tryFill("fieldOfStudy", [entry.fieldOfStudy, entry.degree]);
    } else {
      await tryFill("company", [entry.company]);
      await tryFill("title", [entry.title]);
      await tryFill("location", [entry.location]);
      await tryFill("summary", [entry.summary]);
    }

    await tryFill("startMonth", historyDateValues(entry.start));
    await tryFill("startYear", [entry.start?.year, entry.start?.display]);
    await tryFill("startDate", historyDateValues(entry.start));
    await tryFill("month", historyDateValues(entry.start));
    await tryFill("year", [entry.start?.year]);

    if (entry.current && slot.current) {
      const el = slot.current;
      if (el.type === "checkbox" && !el.checked) nativeClick(el);
      else await fillHistoryValue(el, ["yes", "Yes", "Present"]);
      markHistoryFilled(el);
      filled.push("current");
      await tryFill("endDate", ["Present", "Current"]);
    } else {
      await tryFill("endMonth", historyDateValues(entry.end));
      await tryFill("endYear", [entry.end?.year, entry.end?.display]);
      await tryFill("endDate", historyDateValues(entry.end));
    }

    return filled;
  }

  async function fillHistorySections(workHistory = [], educationHistory = []) {
    const filled = [];
    const jobs = Array.isArray(workHistory) ? workHistory : [];
    const schools = Array.isArray(educationHistory) ? educationHistory : [];

    if (jobs.length) {
      const groups = await ensureHistoryGroups("work", jobs.length);
      const count = Math.min(groups.length, jobs.length);
      for (let i = 0; i < count; i += 1) {
        const kinds = await fillOneHistoryGroup(groups[i], jobs[i], "work");
        if (kinds.length) filled.push({ key: `workHistory[${i}]`, label: jobs[i].company || jobs[i].title });
      }
    }

    if (schools.length) {
      const groups = await ensureHistoryGroups("education", schools.length);
      const use = groups.length ? groups : collectHistoryGroups(document, "education");
      const count = Math.min(use.length, schools.length);
      for (let i = 0; i < count; i += 1) {
        const kinds = await fillOneHistoryGroup(use[i], schools[i], "education");
        if (kinds.length) filled.push({ key: `education[${i}]`, label: schools[i].school || schools[i].degree });
      }
    }

    return filled;
  }

  function looksLikeHistoryForm() {
    const work = collectHistoryGroups(document, "work");
    const edu = collectHistoryGroups(document, "education");
    return work.length > 0 || edu.length > 0;
  }

  async function autofillApplication(
    applicantInfo = {},
    uploadFiles = {},
    credentials = {},
    history = {}
  ) {
    suppressLearn();
    const filled = [];
    const historyFilled = await fillHistorySections(history.workHistory, history.educationHistory);
    for (const row of historyFilled) filled.push(row);

    const controls = collectFillableControls();

    for (const el of controls) {
      if (isHistoryFilled(el)) continue;
      const label = labelTextForControl(el);
      const key = matchApplicantKeyFromControl(el);
      if (!key) continue;
      const value = resolveApplicantValue(applicantInfo, key);
      if (!value) continue;
      if (await fillControl(el, value, key)) filled.push({ key, label });
    }

    const choicePass = await fillRemainingChoiceControls(applicantInfo);
    for (const row of choicePass.filled || []) filled.push(row);

    // Fill saved login/sign-up credentials when this page has a Create Login section.
    const creds = {
      email: String(credentials.email || applicantInfo.email || "").trim(),
      username: String(credentials.username || "").trim(),
      password: String(credentials.password || "")
    };
    const credResult = fillLoginCredentials(creds);

    const uploadResult = await uploadApplicationFiles(uploadFiles);
    const unmatchedQuestions = collectUnmatchedQuestions(applicantInfo);
    const unmatchedChoiceQuestions = collectUnmatchedChoiceQuestions();

    return {
      ok: true,
      filledCount: filled.length,
      filled,
      credentialFilledCount: credResult.filledCount,
      credentialFilled: credResult.filled,
      uploadedCount: uploadResult.uploadedCount,
      uploaded: uploadResult.uploaded,
      uploadSkipped: uploadResult.skipped,
      unmatchedQuestions,
      unmatchedChoiceQuestions
    };
  }

  function collectApplyUrlCandidates() {
    const applyUrls = [];
    const seen = new Set();

    const applyRe =
      /\bapply\b|\bstart application\b|\bbegin application\b|\bcontinue\b|\bget started\b|\bsubmit\b|\bnext\b/i;

    function pushUrl(href) {
      const url = String(href || "").trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) return;
      if (seen.has(url)) return;
      seen.add(url);
      applyUrls.push(url);
    }

    const diceId = String(location.href || "").match(
      /dice\.com\/(?:job-detail|job-applications)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (diceId && !/\/job-applications\//i.test(location.href || "")) {
      pushUrl(`https://www.dice.com/job-applications/${diceId[1]}/wizard`);
    }

    for (const a of queryAllDeep("a[href]")) {
      try {
        const text = String(a.textContent || a.getAttribute("aria-label") || "").trim();
        if (applyRe.test(text)) pushUrl(a.href);
      } catch {
        /* ignore */
      }
      if (applyUrls.length >= 5) break;
    }

    if (applyUrls.length < 5) {
      for (const el of document.querySelectorAll("button[formaction], input[type='submit'][formaction]")) {
        try {
          const href = el.getAttribute("formaction");
          if (href) pushUrl(href);
        } catch {
          /* ignore */
        }
        if (applyUrls.length >= 5) break;
      }
    }

    if (applyUrls.length < 5) {
      for (const btn of document.querySelectorAll("button, input[type='button']")) {
        try {
          const text = String(btn.textContent || btn.getAttribute("aria-label") || "").trim();
          if (!applyRe.test(text)) continue;
          const href = btn.getAttribute("data-href") || btn.getAttribute("data-url") || "";
          if (href) pushUrl(href);
        } catch {
          /* ignore */
        }
        if (applyUrls.length >= 5) break;
      }
    }

    return applyUrls;
  }

  function detectPageBlocker() {
    if (document.querySelector('input[type="password"]')) {
      return "A sign-in form is on the page. Log in, then retry.";
    }
    if (
      document.querySelector(
        '.g-recaptcha, #g-recaptcha, [data-sitekey], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"]'
      )
    ) {
      return "A CAPTCHA is on the page. Solve it, then retry.";
    }
    return "";
  }

  // Phrases that mean the posting is gone (expired / filled / removed / 404).
  const JOB_GONE_RE = new RegExp(
    [
      "sorry[, ]*this job is no longer available",
      "no longer (available|accepting applications|active|open|exists)",
      "(job|position|posting|listing|role|opening|opportunity) (is |has been )?(no longer|not) (available|active|open)",
      "(position|role|job) (has been |is )?(filled|closed)",
      "(posting|job posting|application|applications|listing) (has |have )?(now )?(expired|closed|ended)",
      "we (are|'re) no longer accepting",
      "this (job|position|posting|listing) (has expired|is closed|was removed|has been removed|no longer exists)",
      "(job|page) not found",
      "this listing has been removed",
      "404 error|error 404",
      "couldn'?t find (this|that|the) (job|page|posting)",
      "the (job|position) you(?:'| a)?re looking for"
    ].join("|"),
    "i"
  );

  function unavailableTextSnippet() {
    const parts = [];
    const title = String(document.title || "");
    if (title) parts.push(title);
    const nodes = document.querySelectorAll(
      [
        "h1",
        "h2",
        "[role='heading']",
        "[role='alert']",
        ".error",
        "[class*='error']",
        "[class*='alert']",
        "[class*='Alert']",
        "[class*='banner']",
        "[class*='Banner']",
        "[class*='not-found']",
        "[class*='notFound']",
        "[class*='expired']",
        "[class*='unavailable']",
        "[class*='empty-state']",
        "[data-testid*='unavailable']",
        "[data-cy*='unavailable']"
      ].join(", ")
    );
    let count = 0;
    for (const el of nodes) {
      const t = cleanLabelText(el.textContent);
      if (t && t.length <= 400) parts.push(t);
      if (++count > 60) break;
    }
    // Dice inactive jobs put the message in a plain alert div — also scan body.
    const body = cleanLabelText(document.body?.innerText || document.body?.textContent || "");
    if (body) parts.push(body.slice(0, 6000));
    return parts.join("  ").slice(0, 8000);
  }

  /** @returns {string} a short reason when the job is gone, else "" */
  function detectJobUnavailable() {
    const match = unavailableTextSnippet().match(JOB_GONE_RE);
    if (match) {
      return "inactive job";
    }
    return "";
  }

  // Dice confirmation after successful Easy Apply submit.
  const DICE_APPLY_SUCCESS_RE =
    /hooray!\s*your application is on its way|your application is on its way|find the job listing for this role in your\s+applied jobs/i;

  /**
   * @returns {{ ok: boolean, text?: string }} when Dice shows the post-submit success screen
   */
  function detectDiceApplySuccess() {
    const bodyText = cleanLabelText(document.body?.innerText || document.body?.textContent || "");
    if (!bodyText) return { ok: false };
    const match = bodyText.match(DICE_APPLY_SUCCESS_RE);
    if (!match) return { ok: false };
    // Prefer heading text when present.
    const headings = queryAllDeep("h1, h2, [role='heading']")
      .map((el) => cleanLabelText(el.textContent))
      .filter(Boolean);
    const headingHit = headings.find((t) => DICE_APPLY_SUCCESS_RE.test(t));
    return {
      ok: true,
      text: (headingHit || match[0] || "Your application is on its way").slice(0, 160)
    };
  }

  /**
   * Decide whether this page is really an application form. Job search / listing
   * pages also contain inputs (search boxes, filters), so field count alone is
   * not enough to justify autofilling.
   */
  function probeApplicationForm() {
    const controls = collectFillableControls();
    const fillableCount = controls.length;

    const hasFileInput = collectFileInputs().length > 0;
    const hasUploadUi = findUploadCards().length > 0 || findUploadDropzones().length > 0;

    let identityFields = 0;
    let filterFields = 0;
    for (const el of controls) {
      const key = matchApplicantKeyFromControl(el);
      if (!key) continue;
      if (["firstName", "lastName", "email", "phone", "linkedinUrl", "addressLine1"].includes(key)) {
        identityFields += 1;
      } else {
        filterFields += 1;
      }
    }

    const hasApplyForm = [...document.querySelectorAll("form")].some((form) => {
      const blob = normalize(
        [form.getAttribute("action"), form.getAttribute("id"), form.className].join(" ")
      );
      return /appl(y|ication)|candidate|submission/.test(blob);
    });

    const isApplicationForm =
      hasFileInput ||
      hasUploadUi ||
      identityFields >= 2 ||
      (hasApplyForm && fillableCount >= 2) ||
      looksLikeHistoryForm();

    return {
      ok: true,
      hasFormFields: fillableCount >= 1,
      isApplicationForm,
      fillableCount,
      identityFields,
      filterFields,
      hasFileInput,
      blockedReason: detectPageBlocker(),
      jobUnavailable: detectJobUnavailable(),
      applyUrls: collectApplyUrlCandidates()
    };
  }

  // ---- Multi-step Auto Apply (any ATS / Dice / Jobright) ---------------------

  const EASY_NEXT_RE =
    /\b(next(\s+step)?|continue|save\s*(and|&)\s*continue|save\s*(and|&)\s*next|agree\s*(and|&)\s*continue|proceed|forward)\b/i;
  const EASY_REVIEW_RE = /\b(review(\s+(application|answers|info|information))?|preview)\b/i;
  const EASY_SUBMIT_RE =
    /\b(submit(\s+application)?|send(\s+application)?|finish(\s+application)?|complete(\s+application)?|apply\s+now|confirm\s+(and\s+)?submit)\b/i;
  const EASY_BACK_RE = /\b(back|previous|cancel|close|dismiss|return)\b/i;
  const EASY_ENTRY_RE =
    /\b(easy apply|1-?click apply|one-?click apply|quick apply|apply with|apply now|apply)\b/i;

  function elActionText(el) {
    return cleanLabelText(
      el.textContent || el.value || el.getAttribute?.("aria-label") || ""
    );
  }

  function isElVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isElEnabled(el) {
    return !el.disabled && el.getAttribute?.("aria-disabled") !== "true";
  }

  function scrollElIntoView(el) {
    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch {
      /* ignore */
    }
  }

  /** The most form-dense visible dialog/modal, or the document when none. */
  function getApplyScope() {
    const sel =
      '[role="dialog"], dialog[open], dialog, [aria-modal="true"], .modal, [class*="modal"], [class*="apply"], [id*="apply"]';
    let best = null;
    let bestCount = -1;
    for (const node of queryAllDeep(sel)) {
      if (!isElVisible(node)) continue;
      const count = queryAllDeep("input, textarea, select, button", node).length;
      if (count > bestCount) {
        best = node;
        bestCount = count;
      }
    }
    return best || document;
  }

  function classifyActionButton(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 80) return null;
    if (EASY_NEXT_RE.test(t)) return "next";
    if (EASY_REVIEW_RE.test(t)) return "review";
    if (EASY_SUBMIT_RE.test(t)) return "submit";
    return null;
  }

  /**
   * Pick the forward action.
   * If Next/Continue exists, advance; only treat Submit/Apply as final when
   * there is no Next button (final page of a multi-step form).
   *
   * Dice keeps Submit in a sticky footer outside the densest form card.
   * getApplyScope() often picks that card (lots of inputs/buttons) and excludes
   * the footer — so we ALWAYS also scan document unless the caller already
   * passed document as the scope.
   */
  function findActionButton(scope) {
    function collectFrom(scopeEl) {
      const buttons = queryAllDeep(
        'button, [role="button"], input[type="submit"], input[type="button"], a[role="button"]',
        scopeEl
      ).filter((el) => isElVisible(el));

      let next = null;
      let review = null;
      let submit = null;
      for (const btn of buttons) {
        const text = elActionText(btn);
        // Keep disabled Submit visible in the snapshot (Dice enables it late);
        // skip other disabled controls.
        if (!isElEnabled(btn) && !EASY_SUBMIT_RE.test(text)) continue;
        if (!text && btn.getAttribute?.("type") === "submit") {
          if (!submit) submit = { type: "submit", el: btn, text: "Submit" };
          continue;
        }
        if (EASY_BACK_RE.test(text) && !EASY_NEXT_RE.test(text) && !EASY_SUBMIT_RE.test(text)) {
          continue;
        }
        const cls = classifyActionButton(text);
        if (cls === "next" && !next) next = { type: "next", el: btn, text };
        else if (cls === "review" && !review) review = { type: "review", el: btn, text };
        else if (cls === "submit" && !submit) submit = { type: "submit", el: btn, text };
      }
      return { next, review, submit };
    }

    const scopedRoot = scope || getApplyScope();
    const primary = collectFrom(scopedRoot);
    // Bug fix: previously `scope && …` meant the no-arg call never left the
    // dense card, so sticky footer Submit was invisible to the runner.
    const docWide = scopedRoot === document ? primary : collectFrom(document);
    // Prefer scoped Next/Continue, but never miss a document-level Submit on Dice.
    if (primary.next) return primary.next;
    if (docWide.next) return docWide.next;
    if (primary.review) return primary.review;
    if (docWide.review) return docWide.review;
    if (primary.submit) return primary.submit;
    if (docWide.submit) return docWide.submit;
    return null;
  }

  function describeAction(action) {
    if (!action) return null;
    return { type: action.type, text: action.text || elActionText(action.el) };
  }

  async function clickEasyApplyEntry() {
    // Dice / DHI web components first (stable hosts), then generic Easy Apply labels.
    const hosts = [
      ...queryAllDeep("apply-button-wc, dhi-apply-button, dice-apply-button"),
      ...queryAllDeep(
        "[class*='apply-button-wc'], [class*='easy-apply'], [data-cy*='apply'], [data-testid*='apply']"
      )
    ];
    const seenHosts = new Set();
    for (const host of hosts) {
      if (!host || seenHosts.has(host)) continue;
      seenHosts.add(host);
      const root = host.shadowRoot;
      const shadowButtons = root
        ? [...root.querySelectorAll("button, a, [role='button']")]
        : [];
      const target =
        shadowButtons.find((el) => /apply/i.test(elActionText(el) || host.textContent || "")) ||
        shadowButtons[0];
      if (target && (isElVisible(target) || isElVisible(host))) {
        scrollElIntoView(host);
        safeClick(target);
        await sleep(1200);
        return { ok: true, clicked: true, text: elActionText(target) || "Easy Apply" };
      }
      if (isElVisible(host) && /apply/i.test(elActionText(host) || host.textContent || "")) {
        scrollElIntoView(host);
        safeClick(host);
        await sleep(1200);
        return { ok: true, clicked: true, text: "Easy Apply" };
      }
    }
    // On Dice wizard pages, a primary CTA may already be Next/Continue rather than Apply.
    if (/dice\.com\/job-applications\//i.test(location.href)) {
      const wizardAction = findActionButton();
      if (wizardAction && wizardAction.type !== "submit") {
        return { ok: true, clicked: false, text: wizardAction.text || "", alreadyOpen: true };
      }
      if (probeApplicationForm().isApplicationForm) {
        return { ok: true, clicked: false, text: "wizard", alreadyOpen: true };
      }
    }
    const controls = queryAllDeep("button, a, [role='button']").filter(
      (el) => isElVisible(el) && isElEnabled(el)
    );
    const preferred = controls.find((el) =>
      /easy apply|1-?click apply|one-?click apply|quick apply/i.test(elActionText(el))
    );
    const target = preferred || controls.find((el) => EASY_ENTRY_RE.test(elActionText(el)));
    if (!target) return { ok: false, clicked: false };
    scrollElIntoView(target);
    safeClick(target);
    await sleep(1200);
    return { ok: true, clicked: true, text: elActionText(target) };
  }

  function stepSignature() {
    const scope = getApplyScope();
    const heading = cleanLabelText(
      scope.querySelector?.('h1, h2, h3, [role="heading"], legend')?.textContent || ""
    );
    const fields = queryAllDeep("input, textarea, select", scope).length || 0;
    return `${location.href}|${heading}|${fields}`;
  }

  function getApplyActionSnapshot() {
    const probe = probeApplicationForm();
    const success = detectDiceApplySuccess();
    let action = findActionButton();
    // On a job listing (not the form yet), "Apply" / "Apply now" is an entry
    // control — not the final submit. Remap so the SW can click through.
    if (action?.type === "submit" && !probe.isApplicationForm) {
      const t = action.text || elActionText(action.el);
      if (EASY_ENTRY_RE.test(t)) {
        action = { type: "entry", el: action.el, text: t };
      }
    }
    return {
      ok: true,
      href: location.href,
      signature: stepSignature(),
      isApplicationForm: Boolean(probe.isApplicationForm),
      blockedReason: probe.blockedReason || "",
      jobUnavailable: probe.jobUnavailable || "",
      applySuccess: Boolean(success.ok),
      applySuccessText: success.text || "",
      action: describeAction(action),
      applyUrls: probe.applyUrls || []
    };
  }

  async function clickApplyAction(preferredType = "", { autoSubmit = false } = {}) {
    const before = getApplyActionSnapshot();
    let action = findActionButton();
    if (preferredType === "entry") {
      const entryRes = await clickEasyApplyEntry();
      await sleep(400);
      return {
        ok: Boolean(entryRes?.clicked || entryRes?.alreadyOpen),
        clicked: Boolean(entryRes?.clicked),
        isSubmit: false,
        action: entryRes?.clicked || entryRes?.alreadyOpen
          ? { type: "entry", text: entryRes.text || "" }
          : null,
        before,
        after: getApplyActionSnapshot()
      };
    }
    if (preferredType) {
      // Search dense scope first, then full document (Dice footer Submit).
      const roots = [];
      const scopeEl = getApplyScope();
      if (scopeEl) roots.push(scopeEl);
      if (scopeEl !== document) roots.push(document);
      let match = null;
      for (const root of roots) {
        const buttons = queryAllDeep(
          'button, [role="button"], input[type="submit"], input[type="button"], a[role="button"]',
          root
        ).filter((el) => {
          const text = elActionText(el);
          if (preferredType === "submit" && EASY_SUBMIT_RE.test(text)) return isElVisible(el);
          return isElVisible(el) && isElEnabled(el);
        });
        match = buttons.find((btn) => {
          const text = elActionText(btn);
          const cls = classifyActionButton(text);
          if (preferredType === "entry") return EASY_ENTRY_RE.test(text);
          return cls === preferredType;
        });
        if (match) break;
      }
      if (match) {
        action = {
          type: preferredType,
          el: match,
          text: elActionText(match)
        };
      }
    }
    // Remap listing-page Apply → entry (same as snapshot).
    if (action?.type === "submit" && !before.isApplicationForm) {
      const t = action.text || elActionText(action.el);
      if (EASY_ENTRY_RE.test(t)) {
        action = { type: "entry", el: action.el, text: t };
      }
    }
    if (!action) {
      return { ok: false, clicked: false, before, after: before };
    }
    // Final submit: only click when autoSubmit is explicitly enabled.
    if (action.type === "submit") {
      if (!autoSubmit) {
        return {
          ok: true,
          clicked: false,
          isSubmit: true,
          submitted: false,
          action: describeAction(action),
          before,
          after: before
        };
      }
      scrollElIntoView(action.el);
      safeClick(action.el);
      await sleep(800);
      return {
        ok: true,
        clicked: true,
        isSubmit: true,
        submitted: true,
        action: describeAction(action),
        before,
        after: getApplyActionSnapshot()
      };
    }
    scrollElIntoView(action.el);
    safeClick(action.el);
    await sleep(400);
    return {
      ok: true,
      clicked: true,
      isSubmit: false,
      action: describeAction(action),
      before,
      after: getApplyActionSnapshot()
    };
  }

  async function waitForStepChange(prevSig, timeoutMs = 12000) {
    const start = Date.now();
    const prevHref = location.href;
    while (Date.now() - start < timeoutMs) {
      await sleep(350);
      if (location.href !== prevHref) {
        await sleep(500);
        return true;
      }
      if (stepSignature() !== prevSig) {
        await sleep(300);
        return true;
      }
    }
    return false;
  }

  async function requestAnswersFromSw(questions, profileId, jobMeta, site) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: "easy_apply_answer_questions",
        questions,
        profileId,
        jobMeta,
        site
      });
      return Array.isArray(res?.answers) ? res.answers : [];
    } catch {
      return [];
    }
  }

  async function requestChoiceAnswersFromSw(questions, profileId, site = "") {
    try {
      const res = await chrome.runtime.sendMessage({
        type: "easy_apply_choice_answers",
        questions,
        profileId,
        site
      });
      return Array.isArray(res?.answers) ? res.answers : [];
    } catch {
      return [];
    }
  }

  async function runEasyApply({
    applicantInfo = {},
    uploadFiles = {},
    credentials = {},
    profileId = "",
    jobMeta = {},
    site = "generic",
    autoSubmit = false,
    maxSteps = 12,
    workHistory = [],
    educationHistory = []
  } = {}) {
    const summary = {
      ok: true,
      site,
      steps: 0,
      filled: 0,
      uploaded: 0,
      aiFilled: 0,
      answered: 0,
      status: "",
      detail: ""
    };

    const goneAtStart = detectJobUnavailable();
    if (goneAtStart) {
      summary.status = "unavailable";
      summary.detail = goneAtStart;
      return summary;
    }
    const successAtStart = detectDiceApplySuccess();
    if (successAtStart.ok) {
      summary.status = "submitted";
      summary.detail = successAtStart.text || "Your application is on its way";
      return summary;
    }
    if (detectPageBlocker()) {
      summary.status = "needs_review";
      summary.detail = detectPageBlocker();
      return summary;
    }

    // Open the apply modal if we're still on the job listing view.
    let probe = probeApplicationForm();
    if (!probe.isApplicationForm) {
      await clickEasyApplyEntry();
      probe = probeApplicationForm();
      if (detectPageBlocker()) {
        summary.status = "needs_review";
        summary.detail = detectPageBlocker();
        return summary;
      }
    }

    let noAdvance = 0;
    for (let step = 0; step < maxSteps; step += 1) {
      const goneNow = detectJobUnavailable();
      if (goneNow) {
        summary.status = "unavailable";
        summary.detail = goneNow;
        return summary;
      }
      if (detectPageBlocker()) {
        summary.status = "needs_review";
        summary.detail = detectPageBlocker();
        return summary;
      }

      const fillRes = await autofillApplication(applicantInfo, uploadFiles, credentials, {
        workHistory,
        educationHistory
      });
      summary.filled += Number(fillRes.filledCount || 0);
      summary.uploaded += Number(fillRes.uploadedCount || 0);

      // Reuse stored answers for novel dropdown/checkbox/radio questions.
      const choiceQuestions = Array.isArray(fillRes.unmatchedChoiceQuestions)
        ? fillRes.unmatchedChoiceQuestions
        : [];
      if (choiceQuestions.length) {
        const choiceAnswers = await requestChoiceAnswersFromSw(choiceQuestions, profileId, site);
        if (choiceAnswers.length) {
          const r = await fillChoiceAnswers(choiceAnswers);
          summary.filled += Number(r.filledCount || 0);
        }
      }

      // Free-text questions are always answered fresh by AI (role/JD specific).
      const questions = Array.isArray(fillRes.unmatchedQuestions) ? fillRes.unmatchedQuestions : [];
      if (questions.length) {
        const answers = await requestAnswersFromSw(questions, profileId, jobMeta, site);
        if (answers.length) {
          const r = await fillAiAnswers(answers);
          summary.aiFilled += Number(r.filledCount || 0);
          summary.answered += answers.length;
        }
      }
      summary.steps = step + 1;

      const action = findActionButton();
      if (!action) {
        const stillForm = probeApplicationForm().isApplicationForm;
        summary.status = stillForm ? "ready_for_review" : "needs_review";
        summary.detail = stillForm
          ? "Filled the form. No Next/Submit button detected — please review and submit."
          : "No application form or action button found on this page.";
        return summary;
      }

      if (action.type === "submit") {
        if (autoSubmit) {
          scrollElIntoView(action.el);
          safeClick(action.el);
          await sleep(800);
          const start = Date.now();
          while (Date.now() - start < 20000) {
            const success = detectDiceApplySuccess();
            if (success.ok) {
              summary.status = "submitted";
              summary.detail = success.text || "Your application is on its way";
              return summary;
            }
            await sleep(400);
          }
          summary.status = "needs_review";
          summary.detail =
            "Submit was clicked but the Dice success screen was not detected. Confirm in the tab, then retry.";
          return summary;
        }
        summary.status = "ready_for_review";
        summary.detail = "Reached the final Submit step. Stopped so you can review and submit.";
        return summary;
      }

      const sigBefore = stepSignature();
      scrollElIntoView(action.el);
      safeClick(action.el);
      const advanced = await waitForStepChange(sigBefore);
      if (advanced) {
        noAdvance = 0;
      } else {
        noAdvance += 1;
        if (noAdvance >= 2) {
          summary.status = "needs_review";
          summary.detail =
            "Could not advance past this step (a required field or validation likely needs your input).";
          return summary;
        }
      }
    }

    summary.status = "ready_for_review";
    summary.detail = "Reached the step limit; please review the remaining steps.";
    return summary;
  }

  // ---- Learn mode: passively grow the Q&A bank from real user answers -------

  // Skip identity / PII / secrets / protected-class fields — those are handled by
  // deterministic profile fields and must never be persisted to an exportable bank.
  const LEARN_SENSITIVE_RE =
    /\b(password|otp|captcha|ssn|social security|credit card|card number|cvv|routing|account number|search|first name|last name|full name|middle name|legal name|email|e-mail|phone|mobile|telephone|address|street|city|state|province|zip|postal|country|linkedin|github|portfolio|website|date of birth|dob|birthday|salary|compensation|desired pay|expected pay|disability|veteran|military|\brace\b|ethnic|gender|\bsex\b|hispanic|latino|felony|conviction|criminal)\b/i;

  function captureQuestionText(el) {
    const q = questionLabelForControl(el);
    if (q) return q;
    const fieldset = el.closest("fieldset");
    const legend = fieldset?.querySelector(":scope > legend");
    if (legend) {
      const t = cleanLabelText(legend.textContent);
      if (t) return t;
    }
    const group = el.closest('[role="radiogroup"], [role="group"]');
    const aria = group?.getAttribute?.("aria-label");
    if (aria) return cleanLabelText(aria);
    return questionTextForAi(el);
  }

  function readControlAnswer(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      const opt = el.options?.[el.selectedIndex];
      const t = cleanLabelText(opt?.textContent || opt?.value || "");
      return /^(select\.\.\.?|please select|choose|--)$/i.test(t) ? "" : t;
    }
    const type = (el.type || "text").toLowerCase();
    if (type === "checkbox") return el.checked ? "Yes" : "No";
    if (type === "radio") {
      if (!el.checked) return "";
      return cleanLabelText(questionTextForAi(el) || el.value);
    }
    return cleanLabelText(el.value || "");
  }

  /** Map a chosen option/answer back to the profile's canonical stored value. */
  function canonicalValueForKey(key, text) {
    const t = normalize(text);
    if (!t) return String(text || "").trim();
    const map = VALUE_LABELS[key];
    if (map) {
      for (const canon of Object.keys(map)) {
        if (normalize(canon) === t) return canon;
        for (const label of map[canon]) {
          if (normalize(label) === t) return canon;
        }
      }
    }
    if (YES_VALUES.has(t)) return "yes";
    if (NO_VALUES.has(t)) return "no";
    return String(text || "").trim();
  }

  function maybeCaptureLearn(el) {
    if (!learnEnabled) return;
    if (Date.now() < learnSuppressUntil) return;
    if (!el || typeof el.matches !== "function") return;
    if (!el.matches("input, textarea, select")) return;

    const type = (el.type || "text").toLowerCase();
    if (["hidden", "file", "submit", "button", "image", "reset", "password"].includes(type)) return;
    // Combobox search inputs hold transient text, not a final answer.
    if (isReactSelectInput(el) || looksLikeCombobox(el)) return;

    const answer = readControlAnswer(el);
    if (!answer || answer.length > 2000) return;
    if (looksLikeEditorChromeValue(answer)) return;

    // Known profile field (name, contact, links, work-eligibility, education,
    // EEO, salary, ...) → learn into the PROFILE with fill-if-empty semantics so
    // the deterministic autofill reuses it. These are the most common questions
    // and are kept out of the exportable Q&A bank.
    const profileKey = matchApplicantKeyFromControl(el);
    if (profileKey) {
      const value = canonicalValueForKey(profileKey, answer);
      if (!value) return;
      const sig = `k:${profileKey}`;
      if (learnSentByQuestion.get(sig) === value) return;
      learnSentByQuestion.set(sig, value);
      try {
        chrome.runtime.sendMessage({ type: "profile_learn_capture", key: profileKey, value });
      } catch {
        /* extension context invalidated — ignore */
      }
      return;
    }

    // Novel questions (dropdown / checkbox / radio / short text) go into the
    // per-profile Q&A bank. Long essays stay out — those are JD-specific.
    const isChoice = el.tagName === "SELECT" || type === "radio" || type === "checkbox";
    if (!isChoice) {
      if (el.tagName === "TEXTAREA" && answer.length > 160) return;
      if (answer.length > 400) return;
    }

    const label = captureQuestionText(el);
    if (!label) return;
    if (LEARN_SENSITIVE_RE.test(label)) return;

    const labelNorm = normalize(label);
    if (!labelNorm || labelNorm.length < 6) return;

    if (learnSentByQuestion.get(labelNorm) === answer) return;
    learnSentByQuestion.set(labelNorm, answer);

    const fieldType =
      el.tagName === "SELECT"
        ? "select"
        : el.tagName === "TEXTAREA"
          ? "textarea"
          : type === "checkbox"
            ? "checkbox"
            : type === "radio"
              ? "radio"
              : "text";

    try {
      chrome.runtime.sendMessage({
        type: "qa_learn_capture",
        question: label.slice(0, 1000),
        answer: answer.slice(0, 2000),
        fieldType,
        site: location.hostname
      });
    } catch {
      /* extension context invalidated — ignore */
    }
  }

  function onLearnEvent(event) {
    try {
      maybeCaptureLearn(event.target);
    } catch {
      /* never let capture break the page */
    }
  }

  function initLearnMode() {
    chrome.storage.local
      .get("qa_learn_enabled")
      .then((data) => {
        learnEnabled = data.qa_learn_enabled !== false;
      })
      .catch(() => {});

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.qa_learn_enabled) {
        learnEnabled = changes.qa_learn_enabled.newValue !== false;
      }
    });

    document.addEventListener("change", onLearnEvent, true);
    document.addEventListener("focusout", onLearnEvent, true);
  }

  initLearnMode();

  // ---- Job page scraping (site-specific, extensible) ------------------------
  //
  // Each site posts its job data in a slightly different shape. We keep a small
  // registry of site scrapers keyed by hostname, and always fall back to the
  // schema.org JobPosting JSON-LD block that most boards/ATS embed. To add a new
  // site, append an entry to JOB_SCRAPERS with a host matcher and a scrape().

  function htmlToPlainText(html) {
    let s = String(html || "");
    if (!s) return "";
    s = s
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*li[^>]*>/gi, "- ")
      .replace(/<\/\s*li\s*>/gi, "\n")
      .replace(/<\/\s*(p|div|h[1-6]|ul|ol|section|article|tr|table)\s*>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&rsquo;/gi, "\u2019");
    return s
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function readJsonScript(id, root = document) {
    const el =
      typeof root.getElementById === "function"
        ? root.getElementById(id)
        : root.querySelector(`#${CSS.escape(id)}`);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || el.innerText || "");
    } catch {
      return null;
    }
  }

  function jobrightIdFromUrl() {
    const m = String(location.pathname || "").match(/\/jobs\/info\/([A-Za-z0-9]+)/);
    return m ? m[1] : "";
  }

  function canonicalPageUrl() {
    const link = document.querySelector('link[rel="canonical"]');
    const href = link?.getAttribute("href");
    if (href && /^https?:\/\//i.test(href)) return href;
    try {
      const u = new URL(location.href);
      u.hash = "";
      return u.toString();
    } catch {
      return location.href;
    }
  }

  function normalizeEmploymentType(value) {
    const v = String(Array.isArray(value) ? value[0] : value || "").trim();
    if (!v) return "";
    const map = {
      FULL_TIME: "Full-time",
      PART_TIME: "Part-time",
      CONTRACTOR: "Contract",
      CONTRACT: "Contract",
      TEMPORARY: "Temporary",
      INTERN: "Internship",
      INTERNSHIP: "Internship",
      VOLUNTEER: "Volunteer",
      PER_DIEM: "Per diem",
      OTHER: "Other"
    };
    return map[v.toUpperCase().replace(/[\s-]+/g, "_")] || v;
  }

  function sectionLines(title, arr) {
    const items = (Array.isArray(arr) ? arr : [])
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    if (!items.length) return [];
    return [`${title}:`, ...items.map((it) => `- ${it}`), ""];
  }

  function buildJobrightJdText(jr = {}, cr = {}) {
    const lines = [];
    const summary = String(jr.jobSummary || "").trim();
    if (summary) lines.push(summary, "");
    lines.push(...sectionLines("Responsibilities", jr.coreResponsibilities));
    lines.push(...sectionLines("Qualifications / Skills", jr.skillSummaries));
    lines.push(...sectionLines("Education", jr.educationSummaries));
    lines.push(...sectionLines("Benefits", jr.benefitsSummaries));
    const companyDesc = String(cr.companyDesc || "").trim();
    if (companyDesc) lines.push("Company Overview:", companyDesc);
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function companyFromJobrightChrome(doc = document) {
    const title = String(
      doc.querySelector?.("title")?.textContent || doc.title || ""
    ).trim();
    // e.g. "Sr Applications Developer (Salesforce) @ HealthEquity | Jobright.ai"
    let m = title.match(/\s@\s(.+?)\s*\|\s*Jobright/i);
    if (m?.[1]) return m[1].trim();

    const og = doc.querySelector?.('meta[property="og:title"], meta[name="title"]');
    const ogTitle = String(og?.getAttribute?.("content") || "").trim();
    m = ogTitle.match(/\s@\s(.+?)\s*\|\s*Jobright/i);
    if (m?.[1]) return m[1].trim();

    return "";
  }

  /**
   * Pull the job/company/posting payloads out of a document, keeping only the
   * ones that belong to `urlId`. Jobright is a Next.js SPA: `__NEXT_DATA__` is
   * baked in at the FIRST server render and is NOT updated on client-side
   * navigation, so it can describe a previously viewed job. Matching on the job
   * id in the URL is what prevents returning the wrong (stale) job.
   */
  function pickJobrightSources(doc, urlId) {
    const nextDs = readJsonScript("__NEXT_DATA__", doc)?.props?.pageProps?.dataSource || null;
    const helper = readJsonScript("jobright-helper-job-detail-info", doc);
    const posting = readJsonScript("job-posting", doc);

    const candidates = [];
    // Prefer sources that include companyResult (helper is the head-managed
    // payload that updates on SPA navigation; __NEXT_DATA__ can be stale).
    if (helper?.jobResult) {
      candidates.push([helper.jobResult, helper.companyResult || {}]);
    }
    if (nextDs?.jobResult) {
      candidates.push([nextDs.jobResult, nextDs.companyResult || {}]);
    }

    let jr = null;
    let cr = {};
    for (const [cjr, ccr] of candidates) {
      if (urlId && String(cjr.jobId || "") !== urlId) continue;
      if (!jr) jr = cjr;
      if (ccr?.companyName) {
        cr = ccr;
        break;
      }
      if (!cr?.companyName && ccr && Object.keys(ccr).length) cr = ccr;
    }

    // If we matched a job without company, steal companyResult from any
    // same-id candidate (e.g. helper job + nextData company, or vice versa).
    if (jr && !cr?.companyName) {
      for (const [cjr, ccr] of candidates) {
        if (String(cjr.jobId || "") === String(jr.jobId || "") && ccr?.companyName) {
          cr = ccr;
          break;
        }
      }
      if (!cr?.companyName && helper?.companyResult?.companyName) {
        const helperJobId = String(helper?.jobResult?.jobId || "");
        if (!urlId || !helperJobId || helperJobId === urlId) {
          cr = helper.companyResult;
        }
      }
    }

    let validPosting = null;
    if (posting) {
      const pid = String(posting?.identifier?.value || "");
      // Accept posting when id matches, or when id is absent (SPA-updated head
      // scripts sometimes omit identifier while still describing the open job).
      if (!urlId || !pid || pid === urlId) validPosting = posting;
    }

    return {
      jr,
      cr,
      posting: validPosting,
      pageCompany: companyFromJobrightChrome(doc)
    };
  }

  function assembleJobright({ jr, cr, posting, pageCompany }) {
    if (!jr && !posting) return null;
    jr = jr || {};
    cr = cr || {};

    const jobTitle = String(jr.jobTitle || jr.jobNlpTitle || posting?.title || "")
      .replace(/^\[Remote\]\s*/i, "")
      .trim();
    const socialCompany = Array.isArray(jr.socialConnections)
      ? String(
          jr.socialConnections.find((c) => c?.companyName)?.companyName || ""
        ).trim()
      : "";
    const companyName = String(
      cr.companyName ||
        jr.companyName ||
        socialCompany ||
        posting?.hiringOrganization?.name ||
        pageCompany ||
        ""
    ).trim();

    // Prefer the full schema.org JobPosting description (richest, includes
    // responsibilities/skills/benefits/company overview), then fall back to
    // rebuilding the JD from the structured jobResult fields.
    let jdText = htmlToPlainText(posting?.description || "");
    if (!jdText) jdText = buildJobrightJdText(jr, cr);

    const sal = posting?.baseSalary?.value || {};
    const remoteFromPosting =
      String(posting?.jobLocationType || "").toUpperCase() === "TELECOMMUTE" ? "Remote" : "";

    return {
      jobId: String(jr.jobId || posting?.identifier?.value || ""),
      jobTitle,
      companyName,
      jdLink: canonicalPageUrl(),
      jdText,
      applyLink: String(jr.applyLink || jr.originalUrl || posting?.url || "").trim(),
      workArrangement: String(
        jr.workModel || (jr.isRemote ? "Remote" : "") || remoteFromPosting
      ).trim(),
      employmentType: normalizeEmploymentType(jr.employmentType || posting?.employmentType),
      salaryMin:
        jr.minSalary != null && jr.minSalary !== ""
          ? String(jr.minSalary)
          : sal.minValue != null
            ? String(sal.minValue)
            : "",
      salaryMax:
        jr.maxSalary != null && jr.maxSalary !== ""
          ? String(jr.maxSalary)
          : sal.maxValue != null
            ? String(sal.maxValue)
            : "",
      datePosted: String(jr.publishTime || posting?.datePosted || "").trim(),
      jobLocation: String(jr.jobLocation || "").trim()
    };
  }

  async function scrapeJobright() {
    const urlId = jobrightIdFromUrl();

    // 1) Use the in-page data, but only if it belongs to the job in the URL.
    let data = assembleJobright(pickJobrightSources(document, urlId));
    // Prefer a complete scrape (company included). If company is missing, keep
    // going to the fresh HTML fetch — SPA pages often have job text but no
    // companyResult until the server render is re-fetched.
    if (
      data &&
      (!urlId || data.jobId === urlId) &&
      (data.jobTitle || data.jdText) &&
      data.companyName
    ) {
      return data;
    }

    // 2) The embedded payload was stale (SPA navigation) or missing company —
    //    re-fetch the current URL's server-rendered HTML and parse it.
    try {
      const res = await fetch(location.href, {
        credentials: "include",
        headers: { Accept: "text/html" },
        cache: "no-store"
      });
      if (res.ok) {
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const fetched = assembleJobright(pickJobrightSources(doc, urlId));
        if (fetched && (fetched.jobTitle || fetched.jdText)) {
          // Merge: prefer fetched company/title, keep any richer in-page JD.
          if (data) {
            return {
              ...data,
              ...fetched,
              companyName: fetched.companyName || data.companyName || "",
              jobTitle: fetched.jobTitle || data.jobTitle || "",
              jdText: fetched.jdText || data.jdText || ""
            };
          }
          return fetched;
        }
      }
    } catch {
      /* network/parse failure — fall back to whatever we had */
    }

    return data && (data.jobTitle || data.jdText) ? data : null;
  }

  function findJobPostingLdJson(root = document) {
    const scripts = root.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      let data;
      try {
        data = JSON.parse(s.textContent || "");
      } catch {
        continue;
      }
      const nodes = Array.isArray(data)
        ? data
        : Array.isArray(data?.["@graph"])
          ? data["@graph"]
          : [data];
      for (const node of nodes) {
        const type = node?.["@type"];
        const isJob =
          type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
        if (isJob) return node;
      }
    }
    return null;
  }

  function extractSchemaLocation(node) {
    const loc = Array.isArray(node?.jobLocation) ? node.jobLocation[0] : node?.jobLocation;
    const addr = loc?.address || {};
    return [addr.addressLocality, addr.addressRegion, addr.addressCountry]
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .join(", ");
  }

  function scrapeSchemaOrgJobPosting() {
    const node = findJobPostingLdJson();
    if (!node) return null;

    const jobTitle = String(node.title || node.name || "").trim();
    const org = node.hiringOrganization;
    const companyName = String(
      (org && (org.name || org.legalName)) || (typeof org === "string" ? org : "") || ""
    ).trim();
    const jdText = htmlToPlainText(node.description || "");
    if (!jobTitle && !jdText) return null;

    const salaryValue = node.baseSalary?.value || node.estimatedSalary?.value || {};
    const remote =
      String(node.jobLocationType || "").toUpperCase() === "TELECOMMUTE" ? "Remote" : "";

    return {
      jobTitle,
      companyName,
      jdLink: canonicalPageUrl(),
      jdText,
      applyLink: String(node.url || "").trim(),
      workArrangement: remote,
      employmentType: normalizeEmploymentType(node.employmentType),
      salaryMin: salaryValue.minValue != null ? String(salaryValue.minValue) : "",
      salaryMax: salaryValue.maxValue != null ? String(salaryValue.maxValue) : "",
      datePosted: String(node.datePosted || "").trim(),
      jobLocation: extractSchemaLocation(node)
    };
  }

  function diceIdFromUrl(url = location.href) {
    try {
      const u = new URL(String(url || ""), "https://www.dice.com");
      const selected = u.searchParams.get("selectedJobId");
      if (selected) return selected;
      const parts = u.pathname.split("/").filter(Boolean);
      const detailIdx = parts.findIndex((p) => p === "job-detail" || p === "detail");
      if (detailIdx >= 0 && parts[detailIdx + 1]) {
        // Modern Dice: /job-detail/{uuid}
        // Legacy: /job-detail/{slug}/{id} or /jobs/detail/{id}
        if (parts[detailIdx] === "job-detail" && parts[detailIdx + 2]) {
          return parts[detailIdx + 2];
        }
        return parts[detailIdx + 1];
      }
      return u.searchParams.get("jobId") || u.searchParams.get("id") || "";
    } catch {
      return "";
    }
  }

  function elementText(el) {
    return el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function locationFromLd(ld) {
    if (!ld) return "";
    if (ld.applicantLocationRequirements?.name) {
      return String(ld.applicantLocationRequirements.name).trim();
    }
    const loc = ld.jobLocation;
    if (typeof loc === "string") return loc.trim();
    const first = Array.isArray(loc) ? loc[0] : loc;
    if (!first) return "";
    if (typeof first === "string") return first.trim();
    const addr = first.address || {};
    return (
      [addr.addressLocality, addr.addressRegion, addr.addressCountry]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .join(", ") ||
      String(first.name || "").trim()
    );
  }

  function salaryBoundsFromLd(ld) {
    const raw = ld?.baseSalary?.value ?? ld?.estimatedSalary?.value;
    if (raw == null || raw === "") return { min: "", max: "" };
    if (typeof raw === "number" || typeof raw === "string") {
      const n = String(raw).trim();
      return { min: n, max: n };
    }
    return {
      min: raw.minValue != null ? String(raw.minValue) : "",
      max: raw.maxValue != null ? String(raw.maxValue) : ""
    };
  }

  function diceDetailRoot(doc = document) {
    return (
      doc.querySelector('[class*="@container/job-detail"]') ||
      doc.querySelector('[class*="job-detail"]') ||
      doc.querySelector("main") ||
      doc.body ||
      doc
    );
  }

  function diceCompanyFromDom(root) {
    const links = Array.from(root.querySelectorAll('a[href*="/company-profile/"]'));
    for (const a of links) {
      const t = elementText(a);
      if (t) return t;
    }
    return (
      elementText(root.querySelector('[data-cy="companyNameLink"]')) ||
      elementText(root.querySelector('[data-cy="companyName"]')) ||
      elementText(root.querySelector("[class*='companyName']")) ||
      ""
    );
  }

  function diceIdFromDom(doc = document) {
    const fromUrl = diceIdFromUrl(doc.defaultView?.location?.href || location.href);
    if (fromUrl) return fromUrl;
    const root = diceDetailRoot(doc);
    const href =
      root.querySelector('a[href*="/job-detail/"]')?.getAttribute("href") ||
      doc.querySelector('a[href*="/job-detail/"]')?.getAttribute("href") ||
      "";
    return diceIdFromUrl(href) || "";
  }

  function diceCanonicalLink(jobId) {
    if (jobId) return `https://www.dice.com/job-detail/${jobId}`;
    try {
      if (/\/job-detail\//i.test(location.pathname)) {
        const u = new URL(location.href);
        u.hash = "";
        u.search = "";
        return u.toString();
      }
    } catch {
      /* ignore */
    }
    return canonicalPageUrl();
  }

  function assembleDiceFromLd(ld, { jobId = "", dom = null } = {}) {
    if (!ld && !dom) return null;
    ld = ld || {};
    dom = dom || {};

    const ldOrg = ld.hiringOrganization;
    const ldCompany =
      (ldOrg && (ldOrg.name || ldOrg.legalName)) ||
      (typeof ldOrg === "string" ? ldOrg : "") ||
      "";
    const salary = salaryBoundsFromLd(ld);
    const remoteFromLd =
      String(ld.jobLocationType || "").toUpperCase() === "TELECOMMUTE" ? "Remote" : "";

    let jdText = String(dom.jdText || "").trim();
    if (!jdText && ld.description) jdText = htmlToPlainText(ld.description);

    const skills = Array.isArray(dom.skills) ? dom.skills.filter(Boolean) : [];
    if (skills.length && jdText && !/^Key skills:/i.test(jdText)) {
      jdText = `Key skills:\n${skills.join("; ")}\n\n${jdText}`;
    } else if (skills.length && !jdText) {
      jdText = `Key skills:\n${skills.join("; ")}`;
    }

    const id =
      jobId ||
      String(ld.identifier?.value || "") ||
      diceIdFromUrl(String(ld.url || "")) ||
      "";
    const jobTitle =
      String(dom.jobTitle || "").trim() || String(ld.title || ld.name || "").trim();
    const companyName = String(dom.companyName || "").trim() || String(ldCompany).trim();

    if (!jobTitle && !jdText) return null;

    return {
      jobId: id,
      jobTitle,
      companyName,
      jdLink: diceCanonicalLink(id),
      jdText,
      applyLink: String(ld.url || "").trim(),
      workArrangement: String(dom.workArrangement || "").trim() || remoteFromLd,
      employmentType: normalizeEmploymentType(
        dom.employmentType || ld.employmentType
      ),
      salaryMin: salary.min,
      salaryMax: salary.max,
      datePosted:
        String(dom.datePosted || "").trim() || String(ld.datePosted || "").trim(),
      jobLocation: String(dom.jobLocation || "").trim() || locationFromLd(ld)
    };
  }

  /**
   * Dice scrape for the current redesigned UI:
   * - Dedicated /job-detail/{uuid} pages embed schema.org JobPosting JSON-LD.
   * - Search SERP uses a side panel (`?selectedJobId=`) with NO JSON-LD and no
   *   legacy data-cy hooks; JD lives in a CSS-module class containing
   *   "jobDescription". When the panel is incomplete we fetch the detail URL.
   */
  function scrapeDiceDom(doc = document) {
    const root = diceDetailRoot(doc);
    const text = elementText;

    const titleEl =
      root.querySelector('[data-cy="jobTitle"]') ||
      root.querySelector("h1") ||
      root.querySelector('[class*="jobTitle"]') ||
      doc.querySelector("h1");

    const locationEl =
      root.querySelector('[data-cy="location"]') ||
      root.querySelector('[data-cy="jobLocation"]');

    // Modern Dice: job-detail-description-module__…__jobDescription
    // Legacy: #jobDescription / data-cy / job-description
    const descEl =
      root.querySelector('[class*="jobDescription"]') ||
      root.querySelector('[class*="job-detail-description"]') ||
      root.querySelector("#jobDescription") ||
      root.querySelector('[data-cy="jobDescription"]') ||
      root.querySelector('[class*="job-description"]') ||
      root.querySelector('[id*="description"]');

    let jdText = "";
    if (descEl) {
      jdText = String(descEl.innerText || descEl.textContent || "")
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    const skills = Array.from(
      root.querySelectorAll(
        '[data-cy="skillsList"] li, [data-cy="chip"], [class*="skill"] li, [class*="SkillChip"], [class*="SkillBadge"]'
      )
    )
      .map((el) => text(el))
      .filter(Boolean)
      .slice(0, 40);

    // Header line often looks like "Remote or Olympia, Washington•Today"
    let workArrangement = "";
    let datePosted = "";
    const headerBits = Array.from(
      root.querySelectorAll("span, div, p, li, time")
    )
      .map((el) => text(el))
      .filter((t) => t && t.length < 80);
    for (const t of headerBits) {
      if (!workArrangement && /\b(Remote|Hybrid|On-?site)\b/i.test(t)) {
        if (/remote/i.test(t)) workArrangement = "Remote";
        else if (/hybrid/i.test(t)) workArrangement = "Hybrid";
        else workArrangement = "On-site";
      }
      if (!datePosted && /^(today|yesterday|\d+\s*(day|hour|week|month)s?\s*ago)$/i.test(t)) {
        datePosted = t;
      }
    }
    datePosted =
      datePosted ||
      text(root.querySelector('[data-cy="postedDate"]')) ||
      text(root.querySelector("time")) ||
      "";

    return {
      jobTitle: text(titleEl),
      companyName: diceCompanyFromDom(root),
      jobLocation: text(locationEl),
      jdText,
      workArrangement:
        workArrangement ||
        text(root.querySelector('[data-cy="workplaceType"]')) ||
        text(root.querySelector('[data-cy="workSettings"]')) ||
        "",
      employmentType:
        text(root.querySelector('[data-cy="employmentDetails"]')) ||
        text(root.querySelector('[data-cy="employmentType"]')) ||
        "",
      datePosted,
      skills
    };
  }

  function scrapeDiceOnce(doc = document) {
    const jobId = diceIdFromDom(doc);
    const dom = scrapeDiceDom(doc);
    const ld = findJobPostingLdJson(doc);
    return assembleDiceFromLd(ld, { jobId, dom });
  }

  async function fetchDiceDetailDocument(jobId) {
    if (!jobId) return null;
    try {
      const res = await fetch(`https://www.dice.com/job-detail/${jobId}`, {
        credentials: "include",
        headers: { Accept: "text/html" },
        cache: "no-store"
      });
      if (!res.ok) return null;
      const html = await res.text();
      return new DOMParser().parseFromString(html, "text/html");
    } catch {
      return null;
    }
  }

  function mergeDiceScrapes(base, next) {
    if (!base) return next;
    if (!next) return base;
    return {
      ...base,
      ...next,
      companyName: next.companyName || base.companyName || "",
      jobTitle: next.jobTitle || base.jobTitle || "",
      jdText: next.jdText || base.jdText || "",
      workArrangement: next.workArrangement || base.workArrangement || "",
      employmentType: next.employmentType || base.employmentType || "",
      salaryMin: next.salaryMin || base.salaryMin || "",
      salaryMax: next.salaryMax || base.salaryMax || "",
      datePosted: next.datePosted || base.datePosted || "",
      jobLocation: next.jobLocation || base.jobLocation || "",
      jobId: next.jobId || base.jobId || "",
      jdLink: next.jdLink || base.jdLink || ""
    };
  }

  async function scrapeDice() {
    let data = scrapeDiceOnce(document);
    if (data?.jobTitle && data?.companyName && data?.jdText) return data;

    // SERP side panel often has title/company in the DOM but no JSON-LD / incomplete
    // JD. Fetch the canonical /job-detail/{id} HTML (has JobPosting JSON-LD).
    const jobId = data?.jobId || diceIdFromDom(document);
    if (jobId) {
      const detailDoc = await fetchDiceDetailDocument(jobId);
      if (detailDoc) {
        const fetched = scrapeDiceOnce(detailDoc);
        data = mergeDiceScrapes(data, fetched);
        if (data?.jobTitle && data?.companyName && data?.jdText) return data;
      }
    }

    // Brief retries for client-side hydration on the open tab.
    for (const waitMs of [400, 800]) {
      await new Promise((r) => setTimeout(r, waitMs));
      data = mergeDiceScrapes(data, scrapeDiceOnce(document));
      if (data?.jobTitle && data?.companyName && data?.jdText) return data;
    }

    return data && (data.jobTitle || data.jdText) ? data : null;
  }

  // Registry of site-specific scrapers. Extend this as new sites are supported.
  const JOB_SCRAPERS = [
    { id: "jobright", host: /(^|\.)jobright\.ai$/i, scrape: scrapeJobright },
    { id: "dice", host: /(^|\.)dice\.com$/i, scrape: scrapeDice }
  ];

  async function scrapeJobPage() {
    const host = location.hostname || "";

    for (const scraper of JOB_SCRAPERS) {
      if (!scraper.host.test(host)) continue;
      try {
        const data = await scraper.scrape();
        if (data && (data.jobTitle || data.jdText)) {
          return { ok: true, site: scraper.id, jobData: data };
        }
      } catch {
        /* fall through to the generic schema.org scraper */
      }
    }

    // Generic fallback: most job boards / ATS embed a schema.org JobPosting.
    try {
      const data = scrapeSchemaOrgJobPosting();
      if (data && (data.jobTitle || data.jdText)) {
        return { ok: true, site: "schema.org", jobData: data };
      }
    } catch {
      /* ignore and report not-found below */
    }

    return {
      ok: false,
      error:
        "Could not detect job details on this page yet. Wait for it to finish loading, or paste the JD manually."
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "autofill_ping") {
      sendResponse({ ok: true, build: SCRIPT_BUILD });
      return false;
    }
    if (message?.type === "scrape_job_page") {
      scrapeJobPage()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    }
    if (message?.type === "probe_application_form") {
      try {
        sendResponse(probeApplicationForm());
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return true;
    }
    if (message?.type === "autofill_ai_answers") {
      fillAiAnswers(message.answers || [])
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    }
    if (message?.type === "autofill_choice_answers") {
      fillChoiceAnswers(message.answers || [])
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    }
    if (message?.type === "autofill_credentials") {
      try {
        sendResponse({ ok: true, ...fillLoginCredentials(message.credentials || {}) });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return true;
    }
    if (message?.type === "get_apply_action") {
      try {
        sendResponse(getApplyActionSnapshot());
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return true;
    }
    if (message?.type === "click_apply_action") {
      clickApplyAction(message.preferredType || "", { autoSubmit: Boolean(message.autoSubmit) })
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    }
    if (message?.type === "click_easy_apply_entry") {
      clickEasyApplyEntry()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    }
    if (message?.type === "wait_apply_step_change") {
      waitForStepChange(message.prevSignature || "", Number(message.timeoutMs) || 12000)
        .then((advanced) => sendResponse({ ok: true, advanced }))
        .catch((err) => sendResponse({ ok: false, advanced: false, error: String(err?.message || err) }));
      return true;
    }
    if (message?.type === "easy_apply_run") {
      runEasyApply({
        applicantInfo: message.applicantInfo || {},
        uploadFiles: message.uploadFiles || {},
        credentials: message.credentials || {},
        profileId: message.profileId || "",
        jobMeta: message.jobMeta || {},
        site: message.site || "generic",
        autoSubmit: Boolean(message.autoSubmit),
        workHistory: message.workHistory || [],
        educationHistory: message.educationHistory || []
      })
        .then((summary) => sendResponse(summary))
        .catch((err) => sendResponse({ ok: false, status: "failed", error: String(err?.message || err) }));
      return true;
    }
    if (message?.type !== "autofill_application") return undefined;
    autofillApplication(
      message.applicantInfo || {},
      message.uploadFiles || {},
      message.credentials || {},
      {
        workHistory: message.workHistory || [],
        educationHistory: message.educationHistory || []
      }
    )
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  });
})();
