import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalKey,
  cleanJdForKeywords,
  coverTerms,
  extractJdTerms,
  normalizeAtsText,
  stemTerm,
  topKeywords
} from "../ats-keywords.js";
import { evaluateAtsScore } from "../ats-score.js";

/** A realistic scrape: real job body wrapped in company blurb, benefits and EEO. */
const NOISY_JD = `
Salesforce API Architect
Bright Vision Technologies · United States · Remote

About Bright Vision Technologies
Bright Vision Technologies is a fast-growing technology consulting company. We partner with
enterprise clients to deliver digital transformation. Our team is passionate about building
solutions that scale.

Responsibilities:
- Design and architect scalable API integration solutions on the Salesforce platform.
- Lead the design of REST and SOAP web services, Platform Events, and MuleSoft integrations.
- Develop Apex classes, triggers, and Lightning Web Components following best practices.
- Ensure data quality, governance, security, and compliance across integrated systems.
- Document architecture decisions and maintain technical documentation.

Required Qualifications:
- Strong experience with Apex, SOQL, Lightning Web Components, and Visualforce.
- Deep expertise in API design, REST, SOAP, OAuth, JSON, XML, and integration patterns.
- Experience with MuleSoft, Boomi, or similar integration middleware.

Benefits:
We offer a competitive salary, comprehensive health, dental, and vision insurance, 401(k) with
company match, paid time off, paid holidays, and professional development reimbursement.

Bright Vision Technologies is an equal opportunity employer. All qualified applicants will
receive consideration for employment without regard to race, color, religion, sex, national
origin, disability, or protected veteran status. Applicants must be authorized to work in the
United States.
`;

const STRONG_RESUME = {
  name: "Jane Candidate",
  email: "jane@example.com",
  phone: "+1 555 010 2048",
  headline: "Salesforce Integration Architect",
  profile:
    "Salesforce Integration Architect designing scalable API integration architecture. Expert in REST and SOAP web services, Platform Events, OAuth, MuleSoft middleware, and data governance.",
  technicalSummary: [
    "Architected REST and SOAP API integration layers connecting Salesforce to ERP systems.",
    "Led MuleSoft and Boomi middleware programs with OAuth, JSON, and XML contracts.",
    "Built Apex classes, triggers, Lightning Web Components, and Visualforce pages."
  ],
  skills: [
    {
      category: "Salesforce Platform",
      items: "Apex, SOQL, Lightning Web Components, Visualforce, Platform Events"
    },
    { category: "Integration", items: "REST, SOAP, OAuth, JSON, XML, MuleSoft, Boomi, API design" },
    { category: "Governance", items: "Data quality, governance, security, compliance" }
  ],
  experience: [
    {
      company: "Acme Consulting",
      title: "Salesforce Integration Architect",
      dates: "2020 - Present",
      bullets: [
        "Designed scalable API integration solutions on the Salesforce platform for 14 enterprise clients.",
        "Led design of REST and SOAP web services, Platform Events, and MuleSoft integrations.",
        "Developed Apex classes, triggers, and Lightning Web Components; tuned SOQL for governor limits.",
        "Ensured data quality, governance, security, and compliance with OAuth across integrated systems.",
        "Documented architecture decisions and maintained technical documentation."
      ]
    },
    {
      company: "Harbor Systems",
      title: "Senior Salesforce Developer",
      dates: "2016 - 2020",
      bullets: [
        "Built REST and SOAP integrations with Boomi and MuleSoft middleware using JSON and XML.",
        "Delivered Apex, Visualforce, and Lightning Web Components backed by SOQL queries.",
        "Maintained technical documentation for the integration platform."
      ]
    }
  ],
  education: [{ school: "State University", degree: "B.S. Computer Science" }],
  certifications: ["Salesforce Certified Application Architect"]
};

const SCORE_OPTS = {
  jdText: NOISY_JD,
  jobTitle: "Salesforce API Architect",
  roleTrack: "sf",
  companyName: "Bright Vision Technologies"
};

test("a sentence-final word is the same token as the bare word", () => {
  assert.equal(normalizeAtsText("technical documentation."), "technical documentation");
  assert.equal(stemTerm("documentation."), stemTerm("documentation"));
});

test("internal dots survive normalization but C++/C#/.NET are folded", () => {
  assert.equal(normalizeAtsText("Node.js"), "node.js");
  assert.equal(normalizeAtsText("C++ and C# and .NET"), "cplusplus and csharp and dotnet");
});

test("stemming bridges honest phrasing without collapsing unrelated words", () => {
  assert.equal(stemTerm("integration"), stemTerm("integrated"));
  assert.equal(stemTerm("integration"), stemTerm("integrate"));
  assert.equal(stemTerm("development"), stemTerm("developed"));
  assert.notEqual(stemTerm("architect"), stemTerm("salesforce"));
  // The -ment rule must not shred short stems.
  assert.equal(stemTerm("document"), "document");
});

test("acronyms and full names share a match key", () => {
  assert.equal(canonicalKey("k8s"), canonicalKey("Kubernetes"));
  assert.equal(canonicalKey("LWC"), canonicalKey("Lightning Web Components"));
  assert.equal(canonicalKey("Postgres"), canonicalKey("PostgreSQL"));
  assert.notEqual(canonicalKey("Apex"), canonicalKey("MuleSoft"));
});

test("JD cleaning drops company blurb, benefits and EEO blocks", () => {
  const cleaned = cleanJdForKeywords(NOISY_JD, { companyName: "Bright Vision Technologies" });
  assert.doesNotMatch(cleaned, /equal opportunity/i);
  assert.doesNotMatch(cleaned, /dental/i);
  assert.doesNotMatch(cleaned, /digital transformation/i);
  assert.doesNotMatch(cleaned, /Bright/);
  // ...while keeping the actual job.
  assert.match(cleaned, /MuleSoft/);
  assert.match(cleaned, /Lightning Web Components/);
});

test("JD cleaning falls back rather than gutting a single-block scrape", () => {
  const oneBlock =
    "Senior Data Engineer. Build Airflow pipelines and dbt models on Snowflake. Benefits include dental.";
  const cleaned = cleanJdForKeywords(oneBlock, { companyName: "" });
  assert.match(cleaned, /Airflow/);
  assert.match(cleaned, /Snowflake/);
});

test("extracted terms exclude the employer name and hiring boilerplate", () => {
  const terms = topKeywords(NOISY_JD, 35, { companyName: "Bright Vision Technologies" });
  for (const junk of ["bright", "vision", "technologies", "dental", "applicants", "veteran"]) {
    assert.ok(!terms.includes(junk), `"${junk}" should not be a required keyword`);
  }
  assert.ok(terms.includes("mulesoft"));
  assert.ok(terms.includes("apex"));
});

test("hard skills outweigh soft skills", () => {
  const terms = extractJdTerms(NOISY_JD, { companyName: "Bright Vision Technologies" });
  const mulesoft = terms.find((t) => t.term === "mulesoft");
  const soft = terms.find((t) => t.kind === "soft");
  assert.ok(mulesoft, "expected MuleSoft among extracted terms");
  assert.equal(mulesoft.kind, "hard");
  if (soft) assert.ok(mulesoft.weight > soft.weight);
});

test("repeated multi-word phrases are extracted as single terms", () => {
  const terms = extractJdTerms(NOISY_JD, { companyName: "Bright Vision Technologies" });
  assert.ok(terms.some((t) => t.phrase && t.term === "lightning web components"));
});

test("job-title phrases are not double-charged against keyword match", () => {
  const terms = extractJdTerms(NOISY_JD, {
    companyName: "Bright Vision Technologies",
    jobTitle: "Salesforce API Architect"
  });
  assert.ok(!terms.some((t) => t.term === "salesforce api architect"));
  assert.ok(!terms.some((t) => t.term === "api architect"));
});

test("coverage is weighted, so a missing hard skill costs more than a missing soft one", () => {
  const terms = [
    { term: "mulesoft", key: canonicalKey("mulesoft"), kind: "hard", weight: 1 },
    { term: "collaboration", key: canonicalKey("collaboration"), kind: "soft", weight: 0.2 }
  ];
  const hardOnly = coverTerms(terms, "Built MuleSoft integrations.");
  const softOnly = coverTerms(terms, "Known for collaboration.");
  assert.ok(hardOnly.ratio > softOnly.ratio);
});

test("a strong resume clears the target on a boilerplate-heavy JD", () => {
  // Regression guard: the old extractor scored this exact pair 70 because the
  // employer name, the benefits block and "documentation." were required keywords.
  const ev = evaluateAtsScore(STRONG_RESUME, SCORE_OPTS);
  assert.ok(ev.score >= 85, `expected >= 85 for a well-matched resume, received ${ev.score}`);
  assert.equal(ev.missingProducts.length, 0);
});

test("the score still separates proof from keyword stuffing", () => {
  const stuffed = {
    ...STRONG_RESUME,
    profile: "Salesforce architect.",
    technicalSummary: ["Salesforce specialist."],
    experience: [
      {
        company: "Acme Consulting",
        title: "Architect",
        bullets: ["Delivered projects for clients.", "Led teams."]
      },
      {
        company: "Harbor Systems",
        title: "Developer",
        bullets: ["Supported releases.", "Fixed bugs."]
      }
    ]
  };
  const strong = evaluateAtsScore(STRONG_RESUME, SCORE_OPTS);
  const stuffedEval = evaluateAtsScore(stuffed, SCORE_OPTS);
  assert.ok(
    stuffedEval.score < 70,
    `skills-only resume should stay low but scored ${stuffedEval.score}`
  );
  assert.ok(strong.score - stuffedEval.score >= 25);
  assert.equal(stuffedEval.components.productBulletProof.score, 0);
});

test("an off-domain resume scores near zero", () => {
  const off = {
    name: "Candidate",
    email: "c@example.com",
    headline: "Marketing Manager",
    profile: "Marketing manager focused on brand campaigns and social media growth.",
    skills: [{ category: "Marketing", items: "SEO, content strategy, social media" }],
    experience: [
      { company: "Brandco", title: "Marketing Manager", bullets: ["Ran paid social campaigns."] }
    ],
    education: [{ school: "State University" }]
  };
  assert.ok(evaluateAtsScore(off, SCORE_OPTS).score < 20);
});

test("missing keywords never name the employer or soft skills", () => {
  const thin = { ...STRONG_RESUME, skills: [], experience: [] };
  const ev = evaluateAtsScore(thin, SCORE_OPTS);
  for (const kw of ev.missingKeywords) {
    assert.ok(!/bright|vision|technologies/i.test(kw), `"${kw}" is the employer's own name`);
    assert.ok(!/collaborat|communicat|stakeholder/i.test(kw), `"${kw}" is a soft skill`);
  }
});

test("experience evidence max reflects what can actually be earned", () => {
  const noCatalogJd = "We need someone to run community events and write newsletters.";
  const ev = evaluateAtsScore(STRONG_RESUME, { jdText: noCatalogJd, jobTitle: "Community Manager" });
  const exp = ev.components.experienceEvidence;
  assert.ok(exp.max <= 8, `unreachable ceiling: max was ${exp.max} with no catalog products`);
});
