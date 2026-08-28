/**
 * Jobright-style step wizard for Resume tab — import, work history, education.
 */

import { monthCandidates, dateBundle } from "./history.js";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

export const RESUME_STEPS = [
  { id: "import", label: "Import" },
  { id: "experience", label: "Work experience" },
  { id: "education", label: "Education" },
  { id: "details", label: "Resume details" }
];

const EMPTY_WORK = () => ({
  company: "",
  title: "",
  location: "",
  startMonth: "",
  startYear: "",
  endMonth: "",
  endYear: "",
  current: false,
  summary: ""
});

const EMPTY_EDU = () => ({
  school: "",
  degree: "",
  fieldOfStudy: "",
  startMonth: "",
  startYear: "",
  endMonth: "",
  endYear: ""
});

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function monthSelect(id, value) {
  const opts = ['<option value="">Month</option>']
    .concat(
      MONTHS.map((name, i) => {
        const num = String(i + 1).padStart(2, "0");
        const selected = value === name || value === num ? " selected" : "";
        return `<option value="${num}"${selected}>${name}</option>`;
      })
    )
    .join("");
  return `<select id="${id}" class="resume-month">${opts}</select>`;
}

function workEntryHtml(entry, index) {
  const e = entry || EMPTY_WORK();
  return `
    <article class="resume-entry-card" data-entry-index="${index}" data-entry-kind="work">
      <div class="resume-entry-head">
        <strong>Job ${index + 1}</strong>
        <button type="button" class="ghost compact resume-entry-remove" title="Remove">Remove</button>
      </div>
      <div class="grid-2">
        <label class="field">
          <span>Company</span>
          <input type="text" class="resume-work-company" value="${escapeHtml(e.company)}" placeholder="Employer name" />
        </label>
        <label class="field">
          <span>Job title</span>
          <input type="text" class="resume-work-title" value="${escapeHtml(e.title)}" placeholder="Your role" />
        </label>
      </div>
      <label class="field">
        <span>Location</span>
        <input type="text" class="resume-work-location" value="${escapeHtml(e.location)}" placeholder="City, ST or Remote" />
      </label>
      <div class="grid-2">
        <div class="field">
          <span>Start date</span>
          <div class="resume-date-row">
            ${monthSelect(`resumeWorkStartMonth${index}`, e.startMonth)}
            <input type="text" class="resume-year resume-work-start-year" value="${escapeHtml(e.startYear)}" placeholder="Year" inputmode="numeric" maxlength="4" />
          </div>
        </div>
        <div class="field">
          <span>End date</span>
          <div class="resume-date-row">
            ${monthSelect(`resumeWorkEndMonth${index}`, e.endMonth)}
            <input type="text" class="resume-year resume-work-end-year" value="${escapeHtml(e.endYear)}" placeholder="Year" inputmode="numeric" maxlength="4" ${e.current ? "disabled" : ""} />
          </div>
        </div>
      </div>
      <label class="field resume-check-field">
        <input type="checkbox" class="resume-work-current" ${e.current ? "checked" : ""} />
        <span>I currently work here</span>
      </label>
      <label class="field">
        <span>Summary (optional)</span>
        <textarea class="prompt-input resume-work-summary" rows="3" placeholder="Brief role summary for application forms">${escapeHtml(e.summary)}</textarea>
      </label>
    </article>
  `;
}

function eduEntryHtml(entry, index) {
  const e = entry || EMPTY_EDU();
  return `
    <article class="resume-entry-card" data-entry-index="${index}" data-entry-kind="education">
      <div class="resume-entry-head">
        <strong>School ${index + 1}</strong>
        <button type="button" class="ghost compact resume-entry-remove" title="Remove">Remove</button>
      </div>
      <div class="grid-2">
        <label class="field">
          <span>School</span>
          <input type="text" class="resume-edu-school" value="${escapeHtml(e.school)}" placeholder="University name" />
        </label>
        <label class="field">
          <span>Degree</span>
          <input type="text" class="resume-edu-degree" value="${escapeHtml(e.degree)}" placeholder="B.S. Computer Science" />
        </label>
      </div>
      <label class="field">
        <span>Field of study</span>
        <input type="text" class="resume-edu-field" value="${escapeHtml(e.fieldOfStudy)}" placeholder="Major / concentration" />
      </label>
      <div class="grid-2">
        <div class="field">
          <span>Start date</span>
          <div class="resume-date-row">
            ${monthSelect(`resumeEduStartMonth${index}`, e.startMonth)}
            <input type="text" class="resume-year resume-edu-start-year" value="${escapeHtml(e.startYear)}" placeholder="Year" inputmode="numeric" maxlength="4" />
          </div>
        </div>
        <div class="field">
          <span>Graduation date</span>
          <div class="resume-date-row">
            ${monthSelect(`resumeEduEndMonth${index}`, e.endMonth)}
            <input type="text" class="resume-year resume-edu-end-year" value="${escapeHtml(e.endYear)}" placeholder="Year" inputmode="numeric" maxlength="4" />
          </div>
        </div>
      </div>
    </article>
  `;
}

function normalizeWorkEntry(raw = {}) {
  return {
    company: String(raw.company || "").trim(),
    title: String(raw.title || "").trim(),
    location: String(raw.location || "").trim(),
    startMonth: String(raw.startMonth || raw.start?.monthNum || "").trim(),
    startYear: String(raw.startYear || raw.start?.year || "").trim(),
    endMonth: String(raw.endMonth || raw.end?.monthNum || "").trim(),
    endYear: String(raw.endYear || raw.end?.year || "").trim(),
    current: Boolean(raw.current),
    summary: String(raw.summary || "").trim()
  };
}

function normalizeEducationEntry(raw = {}) {
  return {
    school: String(raw.school || "").trim(),
    degree: String(raw.degree || "").trim(),
    fieldOfStudy: String(raw.fieldOfStudy || "").trim(),
    startMonth: String(raw.startMonth || raw.start?.monthNum || "").trim(),
    startYear: String(raw.startYear || raw.start?.year || "").trim(),
    endMonth: String(raw.endMonth || raw.end?.monthNum || "").trim(),
    endYear: String(raw.endYear || raw.end?.year || "").trim()
  };
}

export function normalizeWorkHistory(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeWorkEntry).filter((row) => row.company || row.title);
}

export function normalizeEducationHistory(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeEducationEntry).filter((row) => row.school || row.degree);
}

/** Convert stored flat entries to autofill history.js shape. */
export function workHistoryForAutofill(entries = []) {
  return normalizeWorkHistory(entries).map((job, index) => {
    const start = dateBundle(job.startMonth, job.startYear);
    const end = dateBundle(job.endMonth, job.endYear);
    return {
      index,
      company: job.company,
      title: job.title,
      location: job.location,
      dates: [start.display, end.display].filter(Boolean).join(" – "),
      current: job.current,
      start,
      end,
      summary: job.summary,
      bullets: []
    };
  });
}

export function educationHistoryForAutofill(entries = []) {
  return normalizeEducationHistory(entries).map((edu, index) => {
    const start = dateBundle(edu.startMonth || "08", edu.startYear);
    const end = dateBundle(edu.endMonth || "05", edu.endYear);
    return {
      index,
      school: edu.school,
      degree: edu.degree,
      fieldOfStudy: edu.fieldOfStudy,
      current: false,
      start,
      end
    };
  });
}

export function seedWorkHistoryFromEmployers(employers = []) {
  const names = (Array.isArray(employers) ? employers : [])
    .map((c) => String(c || "").trim())
    .filter(Boolean);
  if (!names.length) return [EMPTY_WORK()];
  return names.map((company) => ({ ...EMPTY_WORK(), company }));
}

function readWorkCardFixed(card) {
  if (!card) return null;
  const selects = card.querySelectorAll(".resume-date-row select");
  const current = card.querySelector(".resume-work-current")?.checked || false;
  return normalizeWorkEntry({
    company: card.querySelector(".resume-work-company")?.value,
    title: card.querySelector(".resume-work-title")?.value,
    location: card.querySelector(".resume-work-location")?.value,
    startMonth: selects[0]?.value,
    startYear: card.querySelector(".resume-work-start-year")?.value,
    endMonth: selects[1]?.value,
    endYear: card.querySelector(".resume-work-end-year")?.value,
    current,
    summary: card.querySelector(".resume-work-summary")?.value
  });
}

function readEduCard(card) {
  if (!card) return null;
  const selects = card.querySelectorAll(".resume-date-row select");
  return normalizeEducationEntry({
    school: card.querySelector(".resume-edu-school")?.value,
    degree: card.querySelector(".resume-edu-degree")?.value,
    fieldOfStudy: card.querySelector(".resume-edu-field")?.value,
    startMonth: selects[0]?.value,
    startYear: card.querySelector(".resume-edu-start-year")?.value,
    endMonth: selects[1]?.value,
    endYear: card.querySelector(".resume-edu-end-year")?.value
  });
}

export function readResumeWizard(root) {
  const wizard = root?.querySelector("#resumeWizard");
  if (!wizard) return { workHistory: [], educationHistory: [] };
  const workHistory = Array.from(wizard.querySelectorAll('[data-entry-kind="work"]'))
    .map(readWorkCardFixed)
    .filter(Boolean);
  const educationHistory = Array.from(wizard.querySelectorAll('[data-entry-kind="education"]'))
    .map(readEduCard)
    .filter(Boolean);
  return { workHistory, educationHistory };
}

function renderEntryList(container, kind, entries, renderFn) {
  if (!container) return;
  const list = entries?.length ? entries : kind === "work" ? [EMPTY_WORK()] : [EMPTY_EDU()];
  container.innerHTML = list.map((entry, i) => renderFn(entry, i)).join("");
}

export function fillResumeWizard(root, person = {}) {
  const wizard = root?.querySelector("#resumeWizard");
  if (!wizard) return;
  const workList = wizard.querySelector("#resumeWorkList");
  const eduList = wizard.querySelector("#resumeEducationList");
  const work = normalizeWorkHistory(person.workHistory);
  const edu = normalizeEducationHistory(person.educationHistory);
  renderEntryList(workList, "work", work.length ? work : seedWorkHistoryFromEmployers(person.requiredExperience), workEntryHtml);
  renderEntryList(eduList, "education", edu.length ? edu : [EMPTY_EDU()], eduEntryHtml);
}

export function initResumeWizard(root, { onStepChange } = {}) {
  const wizard = root?.querySelector("#resumeWizard");
  if (!wizard || wizard.dataset.bound === "1") return;
  wizard.dataset.bound = "1";

  let stepIndex = 0;

  const stepTabs = Array.from(wizard.querySelectorAll(".resume-step-tab"));
  const stepPanels = Array.from(wizard.querySelectorAll(".resume-step-panel"));
  const backBtn = wizard.querySelector("#resumeStepBack");
  const nextBtn = wizard.querySelector("#resumeStepNext");
  const workList = wizard.querySelector("#resumeWorkList");
  const eduList = wizard.querySelector("#resumeEducationList");

  function setStep(index) {
    stepIndex = Math.max(0, Math.min(index, RESUME_STEPS.length - 1));
    stepTabs.forEach((tab, i) => {
      const active = i === stepIndex;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    stepPanels.forEach((panel, i) => {
      const active = i === stepIndex;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    if (backBtn) backBtn.disabled = stepIndex === 0;
    if (nextBtn) {
      nextBtn.textContent = stepIndex === RESUME_STEPS.length - 1 ? "Done" : "Next step";
    }
    onStepChange?.(stepIndex, RESUME_STEPS[stepIndex]?.id);
  }

  stepTabs.forEach((tab, i) => {
    tab.addEventListener("click", () => setStep(i));
  });

  backBtn?.addEventListener("click", () => setStep(stepIndex - 1));
  nextBtn?.addEventListener("click", () => {
    if (stepIndex < RESUME_STEPS.length - 1) setStep(stepIndex + 1);
  });

  wizard.querySelector("#addWorkEntry")?.addEventListener("click", () => {
    const cards = workList.querySelectorAll('[data-entry-kind="work"]');
    workList.insertAdjacentHTML("beforeend", workEntryHtml(EMPTY_WORK(), cards.length));
  });

  wizard.querySelector("#addEducationEntry")?.addEventListener("click", () => {
    const cards = eduList.querySelectorAll('[data-entry-kind="education"]');
    eduList.insertAdjacentHTML("beforeend", eduEntryHtml(EMPTY_EDU(), cards.length));
  });

  wizard.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".resume-entry-remove");
    if (!removeBtn) return;
    const card = removeBtn.closest(".resume-entry-card");
    const list = card?.parentElement;
    if (!card || !list) return;
    const cards = list.querySelectorAll(".resume-entry-card");
    if (cards.length <= 1) {
      card.querySelectorAll("input:not([type=checkbox]), textarea, select").forEach((el) => {
        if (el.type === "checkbox") el.checked = false;
        else el.value = "";
      });
      return;
    }
    card.remove();
    Array.from(list.querySelectorAll(".resume-entry-card")).forEach((node, i) => {
      node.dataset.entryIndex = String(i);
      const strong = node.querySelector(".resume-entry-head strong");
      if (strong) strong.textContent = `${node.dataset.entryKind === "education" ? "School" : "Job"} ${i + 1}`;
    });
  });

  wizard.addEventListener("change", (e) => {
    const current = e.target.closest(".resume-work-current");
    if (!current) return;
    const card = current.closest(".resume-entry-card");
    const endYear = card?.querySelector(".resume-work-end-year");
    const endMonth = card?.querySelectorAll(".resume-date-row select")[1];
    if (endYear) endYear.disabled = current.checked;
    if (endMonth) endMonth.disabled = current.checked;
    if (current.checked && endYear) endYear.value = "";
  });

  setStep(0);
}

export { monthCandidates };
