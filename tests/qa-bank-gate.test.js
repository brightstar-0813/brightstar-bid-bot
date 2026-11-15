import test from "node:test";
import assert from "node:assert/strict";
import { isBankableQa } from "../autofill-junk.js";

// Real entries found in the Avash / Lewis banks on 2026-11-15.
const JUNK = [
  ["expv2 13", "ah0"],
  ["AspireIT Solutions", "Save Job"],
  ["AspireIT Solutions Apply Salesforce Business Systems Analyst – Data Cloud", "Create alert"],
  ["pmd twitter title", "Salesforce Architect (Genesys Cloud CX) - VLink Inc - Remote"],
  ["It seems like a fake job", "It seems like a fake job"],
  ["The offer is expired", "The offer is expired"],
  ["It is an advertisement", "It is an advertisement"],
  ["I agree with Jobgether's Terms, Cookies and Privacy policies.", "No"],
  ["What is your expected hourly rate in USD?", "$40/hour"],
  ["Cover Letter", '<WritingBlock id="58321" variant="document">Dear Hiring Manager'],
  ["Targeting Cookies", "No"],
  ["Performance Cookies", "No"],
  ["Switch Label label", "No"],
  ["checkbox label", "No"],
  ["no section 1747783397549 question 9 no no", "No"],
  ["Are you comfortable using macOS as your primary workstation?", "-- No answer --"],
  ["What's your citizenship / employment eligibility?", "No answer"],
  ["Product or Service of Interest", "Product or Service of Interest"],
  ["Company Name (required)", "Attain Partners"],
  ["Responsibilities", "Architected enterprise Salesforce Education Cloud implementations"],
  ["We may use SMS during the hiring process. Do you give us permission to text you?", "No"],
  ["Are you sure you want to leave this page?", "Yes"],
  ["6 results are available.", "6707 Westcott Rd"],
  ["United States", "1"],
  ["Virginia", "47"],
  ["Select Resume to Upload", "Yes"],
  ["section 1747783397549 question 1", "? undefined:undefined ?"],
  ["Which location are you applying for", "?"],
  ["Link to This Job", "https://faye.bamboohr.com/careers/84"],
  ["Don’t show this again this session", "Yes"],
  ["company start date", "Attain Partners"],
  ["school start date", "The George Washington University"],
  ["login personprofilefields login username login", "avash.chapagain0219@outlook.com"],
  ["County", "Fairfax"],
  ["Date Available", "11/02/2026"],
  ["GDPR Acknowledge Note", "Acknowledge"],
  ["Consent Leg.Interest", "No"],
  ["GenderDecline to answerFemaleMale", "Decline to answer"],
  ["Product or Service of Interest", "Product or Service of InterestRemove item"],
  ["If Other, please specify", "Not Applicable"],
  ["Please specify", "Not Applicable"],
  ["Which Salesforce verticals or industries do you have the most experience with?", "No"]
];

const KEEP = [
  ["School Name (required)", "Virginia Commonwealth University"],
  ["Degree Obtained", "Bachelor"],
  ["School Type", "College / University"],
  ["How did you hear about us?", "Online Job Board"],
  ["Have you applied for a job with us before?", "No"],
  ["How many years of Salesforce development experience do you have?", "9"],
  ["Are you willing to work EST hours?", "Yes"],
  ["Do you have a Salesforce Platform Developer I certification?", "Yes"],
  ["Do you have any planned time off in the next 3 months? If yes, please specify the dates.", "No"],
  ["Where did you learn about this opportunity?", "LinkedIn"],
  ["Do you currently require employer sponsorship for a Visa?", "No"],
  ["Do you have a notice period at your current job before being able to start a new role?", "No"],
  ["Area of Study", "Computer Science"]
];

test("junk Q&A pairs are never banked", () => {
  for (const [q, a] of JUNK) assert.equal(isBankableQa(q, a), false, `should reject: ${q} → ${a}`);
});

test("real answers are still banked", () => {
  for (const [q, a] of KEEP) assert.equal(isBankableQa(q, a), true, `should keep: ${q} → ${a}`);
});
