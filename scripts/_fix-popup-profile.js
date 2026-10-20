import fs from "node:fs";

const p = "d:/Work/JobHunting/Prompts/Bots/brightstar-auto-apply-bot/popup.js";
let s = fs.readFileSync(p, "utf8");
const fixed = `async function onProfileChange() {
  const profileId = profileSelectEl.value;
  syncActivePersonChip();
  await setActivePersonId(profileId);
  await loadActivePersonIntoForm();
  const person = await getActivePerson();
  const rules = resolveExperienceRulesForPerson(person);
  const { resumeFilePrefix } = await syncActivePersonOutputContext(person);
  await chrome.storage.local.set({
    resume_file_prefix: resumeFilePrefix,
    experience_validation_rules: rules,
    experience_validation_person: person.name || person.label || ""
  });
}

async function copyAppsScript`;
s = s.replace(/async function onProfileChange\(\) \{[\s\S]*?\nasync function copyAppsScript/, fixed);
fs.writeFileSync(p, s);
console.log("still bad?", /await\s+await/.test(s));
