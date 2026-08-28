import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAtsScore, boostResumeForAts, ATS_TARGET_SCORE } from "../ats-score.js";

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

test("boostResumeForAts lifts a weak resume toward the 90+ target", () => {
  const weak = {
    name: "Candidate",
    email: "candidate@example.com",
    headline: "Engineer",
    profile: "Experienced technology professional.",
    skills: [{ category: "General", items: "Communication" }],
    experience: [{ company: "Acme", title: "Engineer", bullets: ["Worked with business teams."] }],
    education: [{ school: "University" }]
  };
  const before = evaluateAtsScore(weak, {
    jdText: jd,
    jobTitle: "Salesforce Technical Architect"
  });
  const { data, evaluation, changed } = boostResumeForAts(weak, {
    jdText: jd,
    jobTitle: "Salesforce Technical Architect"
  });
  assert.equal(changed, true);
  assert.ok(evaluation.score > before.score, `expected lift ${before.score} → ${evaluation.score}`);
  assert.ok(
    evaluation.score >= ATS_TARGET_SCORE,
    `expected ≥${ATS_TARGET_SCORE}, got ${evaluation.score}; missing=${evaluation.missingKeywords}`
  );
  assert.ok(String(data.headline || "").includes("Salesforce"));
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
