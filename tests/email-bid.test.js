import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEmailContactsPrompt } from "../prompts/email-contacts.js";
import { harvestContactsFromAiText, normalizeContacts, extractContactsFromJobText, mergeContacts } from "../email-contacts.js";
import { composeEmailBid, harvestEmailDraftFromAiText } from "../email-compose.js";
import { pickTemplateVariant, selectTemplateForRole } from "../prompts/email-templates.js";
import { buildEmailComposePrompt } from "../prompts/email-compose.js";
import {
  smtpPresetForEmail,
  mailProviderForEmail,
  buildWebComposeUrl,
  formatSmtpConnectError,
  isPersonalMicrosoftMailbox
} from "../email-send.js";

describe("email contacts prompt", () => {
  it("targets hiring roles not CEOs by default", () => {
    const prompt = buildEmailContactsPrompt({
      company: "Acme",
      title: "Senior Engineer",
      jdLink: "https://example.com/jobs/1"
    });
    assert.match(prompt, /Recruiter/i);
    assert.match(prompt, /HR/i);
    assert.match(prompt, /CTO/i);
    assert.match(prompt, /lead/i);
    assert.match(prompt, /do NOT chase CEOs/i);
    assert.match(prompt, /"phone"/);
    assert.match(prompt, /name.*email.*role.*phone/i);
    assert.match(prompt, /already written in the JD/i);
    assert.match(prompt, /empty list/i);
  });
});

describe("harvestContactsFromAiText", () => {
  it("parses JSON contacts and drops weak confidence", () => {
    const text = `Here you go:
\`\`\`json
{"contacts":[
  {"name":"Pat Recruiter","role":"Recruiter","email":"pat@acme.com","phone":"+1 555-0100","confidence":0.9},
  {"name":"Low","role":"Intern","email":"low@acme.com","confidence":0.1}
]}
\`\`\``;
    const contacts = harvestContactsFromAiText(text);
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].email, "pat@acme.com");
    assert.equal(contacts[0].role, "Recruiter");
    assert.equal(contacts[0].phone, "+1 555-0100");
    assert.equal(contacts[0].name, "Pat Recruiter");
  });

  it("dedupes emails", () => {
    const contacts = normalizeContacts({
      contacts: [
        { name: "A", email: "a@x.com", role: "HR", phone: "" },
        { name: "B", email: "A@x.com", role: "Recruiter", phone: "555-1212" }
      ]
    });
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].phone, "");
  });

  it("keeps name email role phone only", () => {
    const contacts = normalizeContacts({
      contacts: [
        {
          name: "Sam",
          email: "sam@acme.com",
          role: "Hiring Manager",
          phone: "(415) 555-0199",
          source: "linkedin",
          confidence: 0.9,
          evidence: "noise"
        }
      ]
    });
    assert.deepEqual(Object.keys(contacts[0]).sort(), ["email", "name", "phone", "role"]);
    assert.equal(contacts[0].phone, "(415) 555-0199");
  });

  it("reads a recruiter signature already in the JD", () => {
    const contacts = extractContactsFromJobText(
      "Thanks, Anjali Jaiswal, Raas Infotek, Newark, DE - 19702, Email: anjali.jaiswal@raasinfotek.com"
    );
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].email, "anjali.jaiswal@raasinfotek.com");
    assert.equal(contacts[0].name, "Anjali Jaiswal");
    assert.equal(contacts[0].role, "Hiring contact");
  });

  it("merges JD contacts when the AI reply is empty", () => {
    const fromJob = extractContactsFromJobText(
      "Thanks, Anjali Jaiswal, Email: anjali.jaiswal@raasinfotek.com"
    );
    const fromAi = harvestContactsFromAiText(",");
    const contacts = mergeContacts(fromJob, fromAi);
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].email, "anjali.jaiswal@raasinfotek.com");
    assert.equal(contacts[0].name, "Anjali Jaiswal");
  });
});

describe("composeEmailBid", () => {
  it("builds subject/body and toEmails from hiring contacts", () => {
    const composed = composeEmailBid({
      contacts: [
        { name: "Sam Lead", role: "Engineering Manager", email: "sam@acme.com", confidence: 0.85 }
      ],
      person: { firstName: "Alex", lastName: "Lee", name: "Alex Lee", email: "alex@example.com" },
      job: {
        title: "Backend Engineer",
        company: "Acme",
        jdText: "Requirements: Python and AWS. We build cloud platforms for fintech customers."
      },
      resumeJson: {
        skills: ["Python", "AWS", "SQL"],
        experience: [
          {
            company: "PriorCo",
            title: "Engineer",
            bullets: ["Led Python services on AWS that cut latency 30%"]
          }
        ]
      }
    });
    assert.ok(composed.toEmails.includes("sam@acme.com"));
    assert.ok(String(composed.subject || "").length > 3);
    assert.ok(String(composed.body || "").length > 20);
    assert.match(composed.body, /(?:Warm regards|Thank you|Best regards|Thanks),?\s*$/i);
    assert.ok(!/Best regards,[\s\S]*Alex Lee/i.test(composed.body));
    assert.ok(!/I recently learned about/i.test(composed.body));
  });

  it("picks different local variants for different jobs", () => {
    const family = selectTemplateForRole("recruiter");
    const a = pickTemplateVariant(family, { company: "Acme", title: "SE", jdText: "aaa" });
    const b = pickTemplateVariant(family, { company: "Beta", title: "PM", jdText: "zzz different" });
    assert.ok(a.subject);
    assert.ok(b.subject);
    // Same job is stable
    const a2 = pickTemplateVariant(family, { company: "Acme", title: "SE", jdText: "aaa" });
    assert.equal(a.subject, a2.subject);
    assert.equal(a.body, a2.body);
    // Different jobs usually differ (hash collision possible but unlikely here)
    assert.notEqual(`${a.subject}|${a.body}`, `${b.subject}|${b.body}`);
  });

  it("harvests AI draft JSON", () => {
    const draft = harvestEmailDraftFromAiText(
      `{"subject":"Quick note on Salesforce at Acme","body":"Hi Pat,\\n\\nI saw the Salesforce Developer role and wanted to share how my Apex and Lightning work maps to what you need.\\n\\nResume attached.","angle":"JD Apex match"}`
    );
    assert.equal(draft.subject, "Quick note on Salesforce at Acme");
    assert.match(draft.body, /Hi Pat/);
    assert.match(draft.body, /(?:Warm regards|Thank you|Best regards|Thanks),?\s*$/i);
    assert.ok(!/Alex Lee|LinkedIn|\\d{3}[-.]\\d{3}/i.test(draft.body));
    assert.ok(buildEmailComposePrompt({ company: "Acme", title: "SE" }).includes("closing greeting"));
  });
});

describe("smtp presets", () => {
  it("maps outlook and gmail", () => {
    assert.equal(mailProviderForEmail("me@outlook.com"), "outlook");
    assert.equal(smtpPresetForEmail("me@outlook.com").host, "smtp-mail.outlook.com");
    assert.equal(smtpPresetForEmail("me@hotmail.com").host, "smtp-mail.outlook.com");
    assert.equal(smtpPresetForEmail("user@contoso.onmicrosoft.com").host, "smtp.office365.com");
    assert.equal(mailProviderForEmail("me@gmail.com"), "gmail");
    assert.equal(smtpPresetForEmail("me@gmail.com").host, "smtp.gmail.com");
  });
});

describe("web compose fallback", () => {
  it("builds outlook and gmail compose urls", () => {
    assert.equal(isPersonalMicrosoftMailbox("a@outlook.com"), true);
    const outlook = buildWebComposeUrl("a@outlook.com", {
      to: ["r@co.com"],
      subject: "Hi there",
      body: "Hello world"
    });
    assert.match(outlook, /outlook\.live\.com/);
    assert.match(outlook, /r%40co\.com/);
    assert.match(outlook, /Hello%20world/);
    assert.doesNotMatch(outlook, /Hello\+world/);
    const gmail = buildWebComposeUrl("a@gmail.com", {
      to: ["r@co.com"],
      subject: "Hi",
      body: "Hello world"
    });
    assert.match(gmail, /mail\.google\.com/);
    assert.match(gmail, /Hello%20world/);
  });

  it("formats TLS timeout for outlook", () => {
    const msg = formatSmtpConnectError(
      new Error("Connection unexpectedly closed: timed out"),
      "dmario@outlook.com"
    );
    assert.match(msg, /Open in Outlook/i);
  });
});
