import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEmailContactsPrompt } from "../prompts/email-contacts.js";
import { harvestContactsFromAiText, normalizeContacts } from "../email-contacts.js";
import { composeEmailBid } from "../email-compose.js";
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
  });
});

describe("harvestContactsFromAiText", () => {
  it("parses JSON contacts and drops weak confidence", () => {
    const text = `Here you go:
\`\`\`json
{"contacts":[
  {"name":"Pat Recruiter","role":"Recruiter","email":"pat@acme.com","source":"linkedin","confidence":0.9},
  {"name":"Low","role":"Intern","email":"low@acme.com","source":"inferred_pattern","confidence":0.1}
]}
\`\`\``;
    const contacts = harvestContactsFromAiText(text);
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].email, "pat@acme.com");
    assert.equal(contacts[0].role, "Recruiter");
  });

  it("dedupes emails", () => {
    const contacts = normalizeContacts({
      contacts: [
        { name: "A", email: "a@x.com", confidence: 0.8 },
        { name: "B", email: "A@x.com", confidence: 0.9 }
      ]
    });
    assert.equal(contacts.length, 1);
  });
});

describe("composeEmailBid", () => {
  it("builds subject/body and toEmails from hiring contacts", () => {
    const composed = composeEmailBid({
      contacts: [
        { name: "Sam Lead", role: "Engineering Manager", email: "sam@acme.com", confidence: 0.85 }
      ],
      person: { firstName: "Alex", lastName: "Lee", email: "alex@example.com" },
      job: { title: "Backend Engineer", company: "Acme" },
      resumeJson: null
    });
    assert.ok(composed.toEmails.includes("sam@acme.com"));
    assert.ok(String(composed.subject || "").length > 3);
    assert.ok(String(composed.body || "").length > 20);
    assert.ok(!/Best regards,[\s\S]*Alex Lee/i.test(composed.body));
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
