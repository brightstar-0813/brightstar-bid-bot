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

const CSS = `
    @page { size: A4; margin: 12mm; }

    * { box-sizing: border-box; }

    html, body {
      width: 210mm;
      margin: 0;
      padding: 0;
      font-family: Calibri, Arial, Helvetica, sans-serif;
      color: #000;
      background: #fff;
      font-size: 11pt;
      line-height: 1.28;
    }

    .resume { width: 100%; }

    header.top {
      margin: 0 0 8px;
      padding-bottom: 6px;
      border-bottom: 1.5px solid #1f4e79;
    }

    h1 {
      margin: 0;
      font-size: 20pt;
      font-weight: 700;
      color: #1f4e79;
      line-height: 1.1;
    }

    .headline {
      margin: 2px 0 4px;
      font-size: 11pt;
      font-weight: 700;
      color: #000;
    }

    .contact {
      margin: 0;
      font-size: 10pt;
    }

    a, a:visited { color: #000; text-decoration: underline; }

    section { margin: 0 0 8px; }

    h2 {
      margin: 0 0 4px;
      padding: 0;
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
      color: #000;
    }

    p.role-title {
      margin: 0;
      font-size: 11pt;
      font-weight: 700;
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
    }

    .skills-table th, .skills-table td {
      border: 1px solid #1f4e79;
      padding: 3px 6px;
      vertical-align: top;
      text-align: left;
    }

    .skills-table th {
      background: #e7eef5;
      font-weight: 700;
      color: #1f4e79;
    }

    .skills-table .skill-cat { width: 30%; font-weight: 700; }

    .edu-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 4px;
    }

    .edu-degree { font-weight: 700; }
    .edu-year { white-space: nowrap; font-weight: 700; }

    .tech-summary, .certifications { margin: 0; padding-left: 18px; }
`;

export const atsModernTemplate = {
  id: "ats-modern",
  label: "2 · ATS Calibri",
  description: "Calibri · Workday/Taleo-safe · US Fortune 500 ATS.",
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
    <p class="contact">${contactLine(data)}</p>
  </header>
  ${profile ? `<section><h2>Professional Summary</h2><p>${escapeHtml(profile)}</p></section>` : ""}
  ${tech ? `<section><h2>Technical Summary</h2>${tech}</section>` : ""}
  ${skills ? `<section><h2>Skills</h2>${skills}</section>` : ""}
  ${jobs ? `<section><h2>Professional Experience</h2>${jobs}</section>` : ""}
  ${edu ? `<section><h2>Education</h2>${edu}</section>` : ""}
  ${certs ? `<section><h2>Certifications</h2>${certs}</section>` : ""}
</main>`
    });
  }
};
