import { classicBlueTemplate } from "./classic-blue.js";
import { sandeepClassicTemplate } from "./sandeep-classic.js";
import { timesClassicTemplate } from "./times-classic.js";

/** Built-in resume PDF/HTML templates. Add new files here and register them. */
export const BUILTIN_TEMPLATES = [
  timesClassicTemplate,
  sandeepClassicTemplate,
  classicBlueTemplate
];

export const DEFAULT_TEMPLATE_ID = timesClassicTemplate.id;

export function getAllTemplates() {
  return BUILTIN_TEMPLATES;
}

export function getTemplateById(templateId) {
  return (
    BUILTIN_TEMPLATES.find((t) => t.id === templateId) ||
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
