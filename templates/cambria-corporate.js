import {
  contactLine,
  escapeHtml,
  renderCerts,
  renderEducationRows,
  renderJobsStacked,
  renderSkills,
  renderTechnicalSummary,
  wrapHtmlDocument
} from "./shared.js";

/**
 * Fortune 500 / Microsoft Word “Elegant” look: Cambria, corporate-blue name.
 * Used by senior engineers at large US corporates (Microsoft, IBM, Oracle, GE).
 */
const CSS = `
    @page { size: A4; margin: 12mm 14mm; }

    * { box-sizing: border-box; }

    html, body {
      width: 210mm;
      margin: 0;
      padding: 0;
      font-family: Cambria, Georgia, "Times New Roman", serif;
      color: #222;
      background: #fff;
      font-size: 11pt;
      line-height: 1.28;
    }

    .resume { width: 100%; }

    header.top {
      margin: 0 0 8px;
      padding: 0 0 6px;
      border-bottom: 2px solid #1f4e79;
    }

    h1 {
      margin: 0;
      font-size: 22pt;
      font-weight: 700;
      color: #1f4e79;
      line-height: 1.1;
    }

    .headline {
      margin: 2px 0 4px;
      font-size: 11pt;
      font-weight: 700;
      color: #333;
    }

    .contact { margin: 0; font-size: 10pt; }

    a, a:visited { color: #1f4e79; text-decoration: underline; }

    section { margin: 0 0 8px; }

    h2 {
      margin: 0 0 4px;
      font-size: 12pt;
      font-weight: 700;
      color: #1f4e79;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      border-bottom: 1px solid #1f4e79;
    }

    p { margin: 0 0 4px; }

    h3.role-company {
      margin: 6px 0 0;
      font-size: 11pt;
      font-weight: 700;
    }

    p.role-title {
      margin: 0;
      font-size: 11pt;
      font-weight: 700;
      color: #1f4e79;
    }

    p.role-meta {
      margin: 0 0 2px;
      font-size: 10pt;
      font-style: italic;
    }

    .project {
      margin: 0 0 2px;
      font-size: 10pt;
      font-style: italic;
    }

    ul { margin: 2px 0 0; padding-left: 18px; }
    li { margin: 0 0 2px; }

    .skills-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 10pt;
      font-family: Calibri, Arial, sans-serif;
    }

    .skills-table th, .skills-table td {
      border: 1px solid #1f4e79;
      padding: 3px 6px;
      vertical-align: top;
      text-align: left;
    }

    .skills-table th {
      background: #1f4e79;
      color: #fff;
      font-weight: 700;
    }

    .skills-table .skill-cat { width: 30%; font-weight: 700; }

    .edu-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 4px;
    }

    .edu-degree { font-weight: 700; }
    .edu-year { white-space: nowrap; font-weight: 700; color: #1f4e79; }

    .tech-summary, .certifications { margin: 0; padding-left: 18px; }
`;

export const cambriaCorporateTemplate = {
  id: "cambria-corporate",
  label: "7 · Fortune 500 Cambria",
  description: "Cambria · corporate blue · US Fortune 500 / large-enterprise senior engineer.",
  render(data) {
    const name = escapeHtml(data.name || "Resume");
    const headline = escapeHtml(data.headline || "");
    const profile = String(data.profile || "").trim();
    const tech = renderTechnicalSummary(data.technicalSummary);
    const skills = renderSkills(data.skills);
    const jobs = renderJobsStacked(data.experience);
    const edu = renderEducationRows(data.education);
    const certs = (data.certifications || []).length ? renderCerts(data.certifications) : "";

    return wrapHtmlDocument({
      title: `${name} - Resume`,
      css: CSS,
      body: `<main class="resume">
  <header class="top">
    <h1>${name}</h1>
    ${headline ? `<p class="headline">${headline}</p>` : ""}
    <p class="contact">${contactLine(data, { linkColor: "#1f4e79" })}</p>
  </header>
  ${profile ? `<section><h2>Professional Summary</h2><p>${escapeHtml(profile)}</p></section>` : ""}
  ${tech ? `<section><h2>Technical Summary</h2>${tech}</section>` : ""}
  ${jobs ? `<section><h2>Professional Experience</h2>${jobs}</section>` : ""}
  ${skills ? `<section><h2>Core Competencies</h2>${skills}</section>` : ""}
  ${edu ? `<section><h2>Education</h2>${edu}</section>` : ""}
  ${certs ? `<section><h2>Certifications</h2>${certs}</section>` : ""}
</main>`
    });
  }
};
