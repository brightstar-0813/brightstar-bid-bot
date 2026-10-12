import {
  contactLine,
  escapeHtml,
  pathAttr,
  renderCerts,
  renderEducationRows,
  renderJobsTitleFirst,
  renderSkillsInline,
  renderTechnicalSummary,
  richHtml,
  wrapHtmlDocument
} from "./shared.js";

/**
 * Tight one-column slate resume: short rules, inline skill categories, small type.
 */
const CSS = `
    @page { size: A4; margin: 11mm 13mm; }

    * { box-sizing: border-box; }

    html, body {
      width: 210mm;
      margin: 0;
      padding: 0;
      font-family: Calibri, "Segoe UI", Arial, sans-serif;
      color: #1c2834;
      background: #fff;
      font-size: 10pt;
      line-height: 1.22;
    }

    .resume { width: 100%; }

    header.top { margin: 0 0 6px; }

    h1 {
      margin: 0;
      font-size: 16pt;
      font-weight: 700;
      letter-spacing: 0.2px;
      line-height: 1.05;
    }

    .headline {
      margin: 1px 0 2px;
      font-size: 10pt;
      color: #4b5563;
    }

    .contact {
      margin: 0;
      font-size: 9pt;
      color: #374151;
    }

    a, a:visited { color: #1c2834; text-decoration: none; }

    section { margin: 0 0 6px; }

    h2 {
      margin: 0 0 3px;
      padding-bottom: 1px;
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 1.1px;
      text-transform: uppercase;
      border-bottom: 1px solid #d0d5dd;
    }

    p { margin: 0 0 2px; }

    .tech-summary, .certifications { margin: 0; padding-left: 14px; }

    .job { margin: 0 0 5px; }

    .job-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
    }

    .job-title { margin: 0; font-size: 10.5pt; font-weight: 700; }

    .job-dates {
      flex: 0 0 auto;
      white-space: nowrap;
      font-size: 9pt;
      color: #4b5563;
    }

    .job-meta, .project { margin: 0; font-size: 9pt; color: #4b5563; }

    ul { margin: 1px 0 0; padding-left: 14px; }
    li { margin: 0 0 1px; }

    .skill-inline { margin: 0 0 1px; }
    .skill-inline .skill-cat { font-weight: 700; }

    .edu-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin: 0 0 2px;
      align-items: baseline;
    }

    .edu-degree { font-weight: 700; }
    .edu-school { color: #374151; }
    .edu-year { white-space: nowrap; font-weight: 700; }
`;

export const compactSlateTemplate = {
  id: "compact-slate",
  label: "12 · Compact Slate",
  description: "Calibri · tight spacing · inline skill categories · one-page senior resume.",
  render(data) {
    const name = String(data.name || "Resume").trim() || "Resume";
    const headline = String(data.headline || "").trim();
    const profile = String(data.profile || "").trim();
    const tech = renderTechnicalSummary(data.technicalSummary);
    const skills = renderSkillsInline(data.skills);
    const jobs = renderJobsTitleFirst(data.experience);
    const edu = renderEducationRows(data.education);
    const certs = (data.certifications || []).length ? renderCerts(data.certifications) : "";

    return wrapHtmlDocument({
      title: `${name} - Resume`,
      css: CSS,
      body: `<main class="resume">
  <header class="top">
    <h1${pathAttr("name")}>${escapeHtml(name)}</h1>
    ${headline ? `<p class="headline"${pathAttr("headline")}>${richHtml(headline)}</p>` : ""}
    <p class="contact">${contactLine(data)}</p>
  </header>
  ${profile ? `<section><h2>Summary</h2><p${pathAttr("profile")}>${richHtml(profile)}</p></section>` : ""}
  ${skills ? `<section><h2>Skills</h2>${skills}</section>` : ""}
  ${jobs ? `<section><h2>Experience</h2>${jobs}</section>` : ""}
  ${tech ? `<section><h2>Highlights</h2>${tech}</section>` : ""}
  ${edu ? `<section><h2>Education</h2>${edu}</section>` : ""}
  ${certs ? `<section><h2>Certifications</h2>${certs}</section>` : ""}
</main>`
    });
  }
};
