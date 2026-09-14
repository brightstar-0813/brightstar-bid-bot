import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateAtsScore,
  boostResumeForAts,
  buildAtsScoreRetryPrompt,
  selectProjectBankExcerpts,
  describeAtsGaps
} from "../ats-score.js";
import { stripClearanceFromTitle } from "../resume-json.js";
import { SF_ENTERPRISE_PROJECT_BANK } from "../prompts/sf-enterprise-projects.js";

const jd = `
Salesforce Technical Architect
Design Service Cloud solutions using Apex, Lightning Web Components, SOQL, and MuleSoft.
Lead integrations, data migration, security, and enterprise architecture.
`;

const strongResume = {
  name: "Candidate",
  email: "candidate@example.com",
  headline: "Salesforce Technical Architect",
  profile:
    "Salesforce architect delivering enterprise Service Cloud integrations, security, and data migration.",
  technicalSummary: ["Apex", "Lightning Web Components", "SOQL", "MuleSoft"],
  skills: [
    { category: "Salesforce Clouds", items: "Service Cloud" },
    { category: "Development", items: "Apex, LWC, SOQL, MuleSoft" }
  ],
  experience: [
    {
      company: "Acme",
      title: "Salesforce Technical Architect",
      bullets: [
        "Led Service Cloud architecture and MuleSoft integrations.",
        "Built Apex, Lightning Web Components, and SOQL data migration services."
      ]
    }
  ],
  education: [{ school: "University" }]
};

test("ATS score rewards JD keyword and Salesforce product coverage", () => {
  const strong = evaluateAtsScore(strongResume, {
    jdText: jd,
    jobTitle: "Salesforce Technical Architect",
    roleTrack: "sf"
  });
  const weak = evaluateAtsScore(
    {
      name: "Candidate",
      email: "candidate@example.com",
      profile: "Experienced technology professional.",
      skills: [{ category: "General", items: "Communication" }],
      experience: [{ company: "Acme", bullets: ["Worked with business teams."] }]
    },
    { jdText: jd, jobTitle: "Salesforce Technical Architect", roleTrack: "sf" }
  );

  assert.ok(strong.score >= 80, `expected strong baseline score, received ${strong.score}`);
  assert.ok(strong.score > weak.score);
  assert.equal(strong.missingProducts.length, 0);
  assert.ok(weak.missingProducts.includes("Service Cloud"));
});

test("ATS scoring is deterministic for identical inputs", () => {
  const first = evaluateAtsScore(strongResume, {
    jdText: jd,
    jobTitle: "Salesforce Technical Architect"
  });
  const second = evaluateAtsScore(strongResume, {
    jdText: jd,
    jobTitle: "Salesforce Technical Architect"
  });
  assert.equal(first.score, second.score);
  assert.deepEqual(first.components, second.components);
  assert.deepEqual(first.missingKeywords, second.missingKeywords);
});

test("boostResumeForAts cleans JD Keywords and aligns headline without token dumps", () => {
  const weak = {
    name: "Candidate",
    email: "candidate@example.com",
    headline: "Engineer",
    profile: "Experienced technology professional.",
    skills: [
      { category: "JD Keywords", items: "herndon, sponsorship, candidates" },
      { category: "Development", items: "Apex" }
    ],
    experience: [{ company: "Acme", title: "Engineer", bullets: ["Worked with business teams."] }],
    education: [{ school: "University" }]
  };
  const { data, changed } = boostResumeForAts(weak, {
    jdText: jd,
    jobTitle: "Salesforce Technical Architect"
  });
  assert.equal(changed, true);
  assert.equal(data.headline, "Engineer", "must not paste the JD title into headline");
  assert.ok(!(data.skills || []).some((r) => /keyword/i.test(String(r.category || ""))));
  assert.ok((data.skills || []).some((r) => r.category === "Development"));
  assert.ok(!/Hands-on with/i.test(String(data.profile || "")), "must not append product dump to profile");
});

test("stripClearanceFromTitle removes Public Trust and Secret notes", () => {
  assert.equal(
    stripClearanceFromTitle("Senior Salesforce Developer (Public Trust Clearance)"),
    "Senior Salesforce Developer"
  );
  assert.equal(
    stripClearanceFromTitle("Salesforce Architect - Secret Clearance Required"),
    "Salesforce Architect"
  );
  assert.equal(stripClearanceFromTitle("Senior Salesforce Engineer | TS/SCI"), "Senior Salesforce Engineer");
});

test("boostResumeForAts never copies clearance wording or exact JD title into headline", () => {
  const weak = {
    name: "Candidate",
    email: "candidate@example.com",
    headline: "Senior Salesforce Engineer (Public Trust Clearance)",
    profile: "Experienced technology professional.",
    skills: [{ category: "Development", items: "Apex" }],
    experience: [{ company: "Acme", title: "Engineer", bullets: ["Built Salesforce flows."] }],
    education: [{ school: "University" }]
  };
  const jdTitle = "Senior Salesforce Developer (Public Trust Clearance)";
  const { data } = boostResumeForAts(weak, {
    jdText: `${jdTitle} required.`,
    jobTitle: jdTitle
  });
  assert.equal(data.headline, "Senior Salesforce Engineer");
  assert.ok(!/clearance|public trust/i.test(String(data.headline || "")));
  assert.notEqual(String(data.headline || "").toLowerCase(), "senior salesforce developer");
});

test("selectProjectBankExcerpts prefers JD-aligned SF projects", () => {
  const excerpt = selectProjectBankExcerpts({
    jdText: "Health Cloud Epic FHIR MuleSoft patient integration",
    missingProducts: ["Health Cloud", "MuleSoft"],
    bank: SF_ENTERPRISE_PROJECT_BANK,
    maxProjects: 2
  });
  assert.ok(/Health Cloud|FHIR|Epic/i.test(excerpt));
  assert.ok(excerpt.length > 200);
});

test("buildAtsScoreRetryPrompt uses project bank and forbids JD Keywords", () => {
  const evaluation = evaluateAtsScore(
    {
      name: "Candidate",
      email: "c@x.com",
      skills: [{ category: "General", items: "Communication" }],
      experience: [{ company: "Acme", bullets: ["Did work."] }]
    },
    { jdText: jd, jobTitle: "Salesforce Technical Architect", roleTrack: "sf" }
  );
  const prompt = buildAtsScoreRetryPrompt(
    { experience: [{ company: "Acme" }, { company: "Beta" }] },
    evaluation,
    { jdText: jd, jobTitle: "Salesforce Technical Architect", roleTrack: "sf" }
  );
  assert.ok(/PROJECT BANK/i.test(prompt));
  assert.ok(/HARD FORBIDDEN/i.test(prompt));
  assert.ok(/JD Keywords/i.test(prompt));
  assert.ok(!/MISSING JD KEYWORD TOKENS/i.test(prompt));
});

test("JD Keywords dump does not prop up ATS after boost", () => {
  const base = {
    name: "Candidate",
    email: "candidate@example.com",
    headline: "Engineer",
    profile: "Experienced technology professional.",
    skills: [{ category: "Development", items: "Apex" }],
    experience: [{ company: "Acme", title: "Engineer", bullets: ["Worked with business teams."] }],
    education: [{ school: "University" }]
  };
  const withDump = {
    ...base,
    skills: [
      ...base.skills,
      {
        category: "JD Keywords",
        items:
          "salesforce, technical, architect, service, cloud, apex, lightning, components, soql, mulesoft, integrations, data, migration, security, enterprise, architecture, design, solutions"
      }
    ]
  };
  const beforeStrip = evaluateAtsScore(withDump, {
    jdText: jd,
    jobTitle: "Salesforce Technical Architect",
    roleTrack: "sf"
  });
  const { data, evaluation } = boostResumeForAts(withDump, {
    jdText: jd,
    jobTitle: "Salesforce Technical Architect",
    roleTrack: "sf"
  });
  assert.ok(!(data.skills || []).some((r) => /keyword/i.test(String(r.category || ""))));
  assert.ok(
    evaluation.score < beforeStrip.score,
    `expected dump strip to lower score (${beforeStrip.score} → ${evaluation.score})`
  );
  assert.ok(evaluation.score < 80, `dump-only coverage must not clear 80 after strip, got ${evaluation.score}`);
});

test("DE and FS ATS retry prompts forbid JD Keywords without PROJECT BANK", () => {
  const deEval = evaluateAtsScore(
    {
      name: "Candidate",
      email: "c@x.com",
      skills: [{ category: "General", items: "SQL" }],
      experience: [{ company: "Acme", bullets: ["Pipelines."] }]
    },
    {
      jdText: "Snowflake dbt Airflow Kafka Senior Data Engineer",
      jobTitle: "Senior Data Engineer",
      roleTrack: "de"
    }
  );
  const dePrompt = buildAtsScoreRetryPrompt(
    { experience: [{ company: "Acme" }, { company: "Beta" }] },
    deEval,
    { jdText: "Snowflake dbt Airflow", jobTitle: "Senior Data Engineer", roleTrack: "de" }
  );
  assert.ok(/HARD FORBIDDEN/i.test(dePrompt));
  assert.ok(/JD Keywords/i.test(dePrompt));
  assert.ok(!/PROJECT BANK/i.test(dePrompt));
  assert.ok(/data-platform|pipeline workstream|data stack/i.test(dePrompt));

  const fsPrompt = buildAtsScoreRetryPrompt(
    { experience: [{ company: "Acme" }] },
    {
      score: 40,
      missingProducts: ["React"],
      missingKeywords: ["typescript", "kubernetes"]
    },
    { jdText: "React TypeScript Node.js", jobTitle: "Senior Full Stack Engineer", roleTrack: "fs" }
  );
  assert.ok(/HARD FORBIDDEN/i.test(fsPrompt));
  assert.ok(/JD Keywords/i.test(fsPrompt));
  assert.ok(!/PROJECT BANK/i.test(fsPrompt));
  assert.ok(/product \/ platform workstream|application stack/i.test(fsPrompt));
});

test("DE track scores Snowflake and dbt from JD", () => {
  const deJd = `
Senior Data Engineer
Snowflake warehouse, dbt transformations, Apache Airflow orchestration, Kafka streaming.
`;
  const deResume = {
    name: "Candidate",
    email: "candidate@example.com",
    headline: "Senior Data Engineer",
    profile: "Data engineer building Snowflake warehouses with dbt and Airflow pipelines.",
    skills: [
      { category: "ETL & Data Pipeline Development", items: "Snowflake, dbt, Apache Airflow" },
      { category: "Programming Languages", items: "Python, SQL" }
    ],
    experience: [
      {
        company: "Acme",
        title: "Senior Data Engineer",
        bullets: [
          "Built Snowflake marts and dbt incremental models fed by Airflow DAGs.",
          "Implemented Kafka consumers for streaming ingestion into the warehouse."
        ]
      }
    ],
    education: [{ school: "University" }]
  };
  const result = evaluateAtsScore(deResume, {
    jdText: deJd,
    jobTitle: "Senior Data Engineer",
    roleTrack: "de"
  });
  assert.ok(result.score >= 75, `expected strong DE score, received ${result.score}`);
  assert.equal(result.missingProducts.length, 0);
  assert.ok(result.components.domainProducts.matched >= 2);
});

test("FS track scores React and Node from JD", () => {
  const fsJd = `
Senior Full Stack Engineer
React, TypeScript, Node.js, AWS, Docker, Kubernetes, PostgreSQL.
`;
  const fsResume = {
    name: "Candidate",
    email: "candidate@example.com",
    headline: "Senior Full Stack Engineer",
    profile: "Full stack engineer shipping React and Node.js services on AWS with Docker and Kubernetes.",
    skills: [
      { category: "Programming Languages", items: "TypeScript, JavaScript" },
      { category: "Frontend", items: "React" },
      { category: "Backend & APIs", items: "Node.js, REST APIs" },
      { category: "Cloud & DevOps", items: "AWS, Docker, Kubernetes" }
    ],
    experience: [
      {
        company: "Acme",
        title: "Senior Full Stack Engineer",
        bullets: [
          "Delivered React TypeScript UI backed by Node.js APIs on AWS.",
          "Containerized services with Docker and deployed via Kubernetes."
        ]
      }
    ],
    education: [{ school: "University" }]
  };
  const result = evaluateAtsScore(fsResume, {
    jdText: fsJd,
    jobTitle: "Senior Full Stack Engineer",
    roleTrack: "fs"
  });
  assert.ok(result.score >= 70, `expected strong FS score, received ${result.score}`);
  assert.ok(result.components.domainProducts.matched >= 3);
});

test("describeAtsGaps lists missing items and how-to-improve tips", () => {
  const weak = evaluateAtsScore(
    {
      name: "Candidate",
      email: "c@x.com",
      headline: "Engineer",
      profile: "Technology professional.",
      skills: [{ category: "General", items: "Communication" }],
      experience: [{ company: "Acme", bullets: ["Supported teams."] }]
    },
    { jdText: jd, jobTitle: "Salesforce Technical Architect", roleTrack: "sf" }
  );
  const detail = describeAtsGaps(weak);
  assert.ok(detail.breakdown.length >= 3);
  assert.ok(detail.missingProducts.includes("Service Cloud"));
  assert.ok(detail.tips.some((t) => /Service Cloud|skills categories|bullets/i.test(t)));
  assert.ok(detail.tips.some((t) => /JD Keywords|Mirror these JD terms/i.test(t)));

  const strongDetail = describeAtsGaps(
    evaluateAtsScore(strongResume, {
      jdText: jd,
      jobTitle: "Salesforce Technical Architect",
      roleTrack: "sf"
    })
  );
  assert.equal(strongDetail.missingProducts.length, 0);
  assert.ok(strongDetail.tips.length >= 1);
});
