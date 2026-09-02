import { timesClassicTemplate } from "./times-classic.js";
import { atsModernTemplate } from "./ats-modern.js";
import { consultingClassicTemplate } from "./consulting-classic.js";
import { svSeniorTemplate } from "./sv-senior.js";
import { nycFinanceTemplate } from "./nyc-finance.js";
import { harvardRuleTemplate } from "./harvard-rule.js";
import { cambriaCorporateTemplate } from "./cambria-corporate.js";
import { skillsFirstTemplate } from "./skills-first.js";
import { modernSansTemplate } from "./modern-sans.js";
import { executiveNavyTemplate } from "./executive-navy.js";

/** Built-in resume PDF/HTML templates. Add new files here and register them. */
export const BUILTIN_TEMPLATES = [
  timesClassicTemplate,
  atsModernTemplate,
  consultingClassicTemplate,
  svSeniorTemplate,
  nycFinanceTemplate,
  harvardRuleTemplate,
  cambriaCorporateTemplate,
  skillsFirstTemplate,
  modernSansTemplate,
  executiveNavyTemplate
];

export const DEFAULT_TEMPLATE_ID = timesClassicTemplate.id;

/** Old ids kept so saved people still resolve after renames. */
const TEMPLATE_ID_ALIASES = {
  "sandeep-classic": "ats-modern",
  "ruled-sans": "ats-modern",
  "classic-blue": "ats-modern",
  "modern-timeline": "modern-sans",
  "uk-city": "nyc-finance",
  "eu-structured": "harvard-rule"
};

export function getAllTemplates() {
  return BUILTIN_TEMPLATES;
}

export function getTemplateById(templateId) {
  const resolved = TEMPLATE_ID_ALIASES[templateId] || templateId;
  return (
    BUILTIN_TEMPLATES.find((t) => t.id === resolved) ||
    BUILTIN_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID) ||
    BUILTIN_TEMPLATES[0]
  );
}

/**
 * Render resume JSON to a full HTML document using the selected template.
 * Drops GPT placeholder headlines / schema echo that make resumes look broken.
 * @param {object} data - Parsed resume JSON
 * @param {string} [templateId] - Template id from BUILTIN_TEMPLATES
 */
function sanitizeResumeData(raw) {
  const data = { ...(raw || {}) };
  const headline = String(data.headline || "").trim();
  if (
    !headline ||
    /JD-aligned|role list above|from the (job|role)|placeholder|TODO|TBD|\{JOB/i.test(headline) ||
    headline.length > 90
  ) {
    data.headline = "";
  }

  if (Array.isArray(data.experience)) {
    data.experience = data.experience.map((job) => {
      const next = { ...(job || {}) };
      const bullets = Array.isArray(next.bullets) ? next.bullets : [];
      next.bullets = bullets
        .map((b) => String(b || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .filter((b) => !/while ensuring production reliability/i.test(b));
      return next;
    });
  }

  return data;
}

export function resumeJsonToHtml(data, templateId) {
  const template = getTemplateById(templateId);
  return template.render(sanitizeResumeData(data));
}
